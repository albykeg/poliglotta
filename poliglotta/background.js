// Poliglotta – service worker: chiamate di traduzione, cache, statistiche.
'use strict';

const DEFAULTS = { enabled: true, myLang: 'it', incoming: true, outgoing: true, showOwn: false, keepWords: 'Projet' };

// Due canali gratuiti di Google, senza chiave API. Se il primo rifiuta, si passa al secondo.
const ENGINES = [
  { id: 'google', url: 'https://translate.googleapis.com/translate_a/t?client=gtx' },
  { id: 'google-alt', url: 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex' }
];
const COOLDOWN_MS = 90 * 1000;
const cooldownUntil = {};

const MAX_ITEMS = 25;      // testi per richiesta
const MAX_CHARS = 4500;    // caratteri per richiesta

// ---------- cache in memoria (LRU semplice)
const cache = new Map();
const CACHE_MAX = 4000;
function cacheGet(k) {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); }
  return v;
}
function cacheSet(k, v) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// ---------- impostazioni
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...DEFAULTS, ...(settings || {}) } });
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-translation') return;
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  s.enabled = !s.enabled;
  await chrome.storage.local.set({ settings: s });
});

// ---------- traduzione
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

async function callEngine(engine, texts, sl, tl, format) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  const html = format === 'html';
  // In modalità HTML Google conserva i tag (grassetto, corsivo, codici da non tradurre).
  const url = `${engine.url}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}${html ? '&format=html' : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      signal: ctrl.signal,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
    });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    let data = await res.json();
    if (typeof data === 'string') data = [data];
    if (!Array.isArray(data) || data.length !== texts.length) throw new Error('Risposta inattesa');
    return data.map((item) => {
      let text = item;
      let src = sl;
      if (Array.isArray(item)) { text = item[0]; src = item[1]; }
      if (typeof text !== 'string') throw new Error('Risposta inattesa');
      // In modalità HTML le entità le decodifica chi legge i tag.
      return { text: html ? text : decodeEntities(text), src: src && src !== 'auto' ? src : null };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callWithFallback(texts, sl, tl, format) {
  let lastErr = null;
  for (const engine of ENGINES) {
    if ((cooldownUntil[engine.id] || 0) > Date.now()) continue;
    try {
      return await callEngine(engine, texts, sl, tl, format);
    } catch (err) {
      lastErr = err;
      // Troppe richieste o accesso negato: metto in pausa quel canale per un po'.
      if (err.status === 429 || err.status === 403 || err.status === 503) {
        cooldownUntil[engine.id] = Date.now() + COOLDOWN_MS;
      }
    }
  }
  throw new Error('UNAVAILABLE' + (lastErr ? ': ' + lastErr.message : ''));
}

function chunk(indexes, texts) {
  const out = [];
  let cur = [];
  let chars = 0;
  for (const i of indexes) {
    const len = texts[i].length;
    if (cur.length && (cur.length >= MAX_ITEMS || chars + len > MAX_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function translateTexts(texts, tl, sl, format) {
  sl = sl || 'auto';
  format = format === 'html' ? 'html' : 'text';
  const out = new Array(texts.length);
  const missing = [];
  texts.forEach((t, i) => {
    const hit = cacheGet(`${format}|${sl}|${tl}|${t}`);
    if (hit) out[i] = hit; else missing.push(i);
  });
  let chars = 0;
  for (const group of chunk(missing, texts)) {
    const batch = group.map((i) => texts[i]);
    const results = await callWithFallback(batch, sl, tl, format);
    group.forEach((i, j) => {
      out[i] = results[j];
      cacheSet(`${format}|${sl}|${tl}|${texts[i]}`, results[j]);
      chars += texts[i].length;
    });
  }
  if (chars) addStats(chars);
  return out;
}

// ---------- statistiche (solo per curiosità: il costo resta 0 €)
let pendingChars = 0;
let statsTimer = null;
function addStats(n) {
  pendingChars += n;
  clearTimeout(statsTimer);
  statsTimer = setTimeout(flushStats, 1500);
}
async function flushStats() {
  const n = pendingChars;
  pendingChars = 0;
  if (!n) return;
  const today = new Date().toISOString().slice(0, 10);
  const { stats = {} } = await chrome.storage.local.get('stats');
  if (stats.day !== today) { stats.day = today; stats.today = 0; }
  stats.today = (stats.today || 0) + n;
  stats.total = (stats.total || 0) + n;
  await chrome.storage.local.set({ stats });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'translate') return false;
  const texts = Array.isArray(msg.texts) ? msg.texts.map(String) : [];
  translateTexts(texts, msg.tl, msg.sl, msg.format).then(
    (results) => sendResponse({ ok: true, results }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // risposta asincrona
});

// ---------- aggiornamenti (GitHub)
// update.json nella cartella dice dove sono pubblicate le versioni: { "repo": "utente/poliglotta" }.
// Ogni 6 ore controllo l'ultima versione pubblicata; ogni 2 minuti controllo se i file nella cartella
// sono già stati aggiornati (dallo script "Aggiorna Poliglotta") e manca solo la ricarica.
const CHECK_EVERY_MIN = 360;
const DISK_EVERY_MIN = 2;

function cmpVer(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function readOwnFile(name) {
  try {
    const r = await fetch(chrome.runtime.getURL(name), { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

async function refreshBadge(state) {
  const running = chrome.runtime.getManifest().version;
  const ready = state.installed && cmpVer(state.installed, running) > 0;
  const avail = state.available && cmpVer(state.available.version, state.installed || running) > 0;
  await chrome.action.setBadgeText({ text: ready || avail ? '1' : '' });
  if (ready || avail) await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setTitle({
    title: ready ? 'Poliglotta: aggiornamento pronto, clicca Ricarica'
      : avail ? `Poliglotta: disponibile la versione ${state.available.version}` : 'Poliglotta'
  });
}

async function checkDisk() {
  const { update = {} } = await chrome.storage.local.get('update');
  const disk = await readOwnFile('manifest.json');
  const running = chrome.runtime.getManifest().version;
  update.running = running;
  update.installed = disk && cmpVer(disk.version, running) > 0 ? disk.version : null;
  await chrome.storage.local.set({ update });
  await refreshBadge(update);
  return update;
}

async function checkUpdates() {
  const update = await checkDisk();
  const cfg = (await readOwnFile('update.json')) || {};
  update.repo = cfg.repo || null;
  update.checked = Date.now();
  update.error = null;
  if (cfg.repo) {
    try {
      const api = String(cfg.api || 'https://api.github.com').replace(/\/+$/, '');
      const res = await fetch(`${api}/repos/${cfg.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', credentials: 'omit'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/i, '');
      const asset = (rel.assets || []).find((a) => /\.zip$/i.test(a.name || ''));
      update.available = version && cmpVer(version, update.installed || update.running) > 0 ? {
        version,
        notes: String(rel.body || '').slice(0, 800),
        page: rel.html_url || null,
        zip: asset ? asset.browser_download_url : null
      } : null;
    } catch (e) {
      update.error = String((e && e.message) || e).slice(0, 120);
    }
  }
  await chrome.storage.local.set({ update });
  await refreshBadge(update);
  return update;
}

async function ensureAlarms() {
  if (!(await chrome.alarms.get('pg-update'))) {
    await chrome.alarms.create('pg-update', { periodInMinutes: CHECK_EVERY_MIN, delayInMinutes: 1 });
  }
  if (!(await chrome.alarms.get('pg-disk'))) {
    await chrome.alarms.create('pg-disk', { periodInMinutes: DISK_EVERY_MIN });
  }
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'pg-update') checkUpdates();
  else if (a.name === 'pg-disk') checkDisk();
});
chrome.runtime.onInstalled.addListener(() => { ensureAlarms(); checkUpdates(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarms(); checkUpdates(); });
ensureAlarms();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'checkUpdates') return false;
  checkUpdates().then(sendResponse, () => sendResponse(null));
  return true;
});
