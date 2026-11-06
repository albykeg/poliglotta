'use strict';

const L = globalThis.PG_LANGS;
const DEFAULTS = { enabled: true, myLang: 'it', incoming: true, outgoing: true, showOwn: false, keepWords: 'Projet' };
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('it-IT');

let settings = { ...DEFAULTS };

function render() {
  $('enabled').checked = settings.enabled;
  $('incoming').checked = settings.incoming;
  $('outgoing').checked = settings.outgoing;
  $('showOwn').checked = settings.showOwn;
  $('myLang').value = L.base(settings.myLang) === 'he' ? 'iw' : settings.myLang;
  $('opts').classList.toggle('off', !settings.enabled);
  const kw = $('keepWords');
  if (document.activeElement !== kw) kw.value = settings.keepWords || '';
}

function save() {
  chrome.storage.local.set({ settings });
}

function renderStats(stats) {
  const today = new Date().toISOString().slice(0, 10);
  const s = stats || {};
  $('today').textContent = fmt.format(s.day === today ? s.today || 0 : 0);
  $('total').textContent = fmt.format(s.total || 0);
}

async function init() {
  const sel = $('myLang');
  const codes = [...L.CODES].sort((a, b) => L.name(a).localeCompare(L.name(b), 'it'));
  sel.innerHTML = codes.map((c) => `<option value="${c}">${L.name(c)}</option>`).join('');

  const data = await chrome.storage.local.get(['settings', 'stats']);
  settings = { ...DEFAULTS, ...(data.settings || {}) };
  render();
  renderStats(data.stats);

  for (const id of ['enabled', 'incoming', 'outgoing', 'showOwn']) {
    $(id).addEventListener('change', (e) => {
      settings[id] = e.target.checked;
      render();
      save();
    });
  }
  sel.addEventListener('change', () => {
    settings.myLang = sel.value;
    save();
  });

  let keepTimer = null;
  $('keepWords').addEventListener('input', (e) => {
    clearTimeout(keepTimer);
    $('keepSaved').textContent = '';
    keepTimer = setTimeout(() => {
      settings.keepWords = e.target.value;
      save();
      $('keepSaved').textContent = 'Salvato';
    }, 400);
  });

  $('diagBtn').addEventListener('click', runDiag);

  $('verText').textContent = 'Versione ' + chrome.runtime.getManifest().version;
  const upd = await chrome.storage.local.get('update');
  renderUpdate(upd.update);
  $('checkBtn').addEventListener('click', async () => {
    $('checkBtn').textContent = 'Controllo…';
    const st = await chrome.runtime.sendMessage({ type: 'checkUpdates' }).catch(() => null);
    renderUpdate(st);
    $('checkBtn').textContent = st && !st.repo ? 'Aggiornamenti non configurati'
      : st && st.error ? 'GitHub non raggiungibile, riprova'
      : st && (st.available || st.installed) ? 'Controlla aggiornamenti' : 'Nessun aggiornamento';
  });
  $('updReload').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });
  chrome.runtime.sendMessage({ type: 'checkUpdates' }).then(renderUpdate).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) }; render(); }
    if (changes.stats) renderStats(changes.stats.newValue);
    if (changes.update) renderUpdate(changes.update.newValue);
  });
}

const cmpVer = (a, b) => {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

function renderUpdate(st) {
  const box = $('upd');
  const running = chrome.runtime.getManifest().version;
  const ready = st && st.installed && cmpVer(st.installed, running) > 0;
  const avail = st && st.available && cmpVer(st.available.version, (st && st.installed) || running) > 0;
  box.hidden = !(ready || avail);
  $('updReload').hidden = !ready;
  $('updNotes').hidden = true;
  $('updLink').hidden = true;
  if (ready) {
    $('updTitle').textContent = `Aggiornamento ${st.installed} pronto`;
    $('updText').textContent = 'I file sono già aggiornati. Per attivarlo clicca «Ricarica» (↻) su Poliglotta nella pagina delle estensioni, oppure chiudi e riapri Chrome. Poi premi F5 su Facebook.';
  } else if (avail) {
    $('updTitle').textContent = `Nuova versione ${st.available.version} disponibile`;
    $('updText').textContent = 'Apri la cartella di Poliglotta sul computer e fai doppio clic su «Aggiorna Poliglotta».';
    if (st.available.notes && st.available.notes.trim()) {
      $('updNotes').textContent = st.available.notes.trim();
      $('updNotes').hidden = false;
    }
    const href = st.available.zip || st.available.page;
    if (href) { $('updLink').href = href; $('updLink').hidden = false; }
  }
}

async function runDiag() {
  const msg = $('diagMsg');
  const out = $('diagOut');
  msg.className = '';
  msg.textContent = 'Analisi della pagina…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('nessuna scheda');
    const report = await chrome.tabs.sendMessage(tab.id, { type: 'diag' });
    if (!report) throw new Error('nessuna risposta');
    const text = 'POLIGLOTTA-DIAG ' + JSON.stringify(report);
    out.value = text;
    out.hidden = false;
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = 'Copiato! Incollalo nella chat con Claude.';
    } catch (e) {
      out.select();
      msg.textContent = 'Seleziona il testo qui sotto e copialo (Ctrl+C).';
    }
    msg.className = 'ok';
  } catch (e) {
    msg.textContent = 'Apri una chat su Facebook (scheda attiva), ricarica con F5 e riprova.';
    msg.className = 'err';
  }
}

init();
