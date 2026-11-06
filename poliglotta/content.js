// Poliglotta – logica su Facebook/Messenger.
// 1) Traduce i messaggi ricevuti nella tua lingua (sotto l'originale).
// 2) Rileva la lingua di ogni chat dai messaggi ricevuti.
// 3) Invio: traduce la tua risposta nella lingua della chat; Invio di nuovo: invia. Esc: annulla.
(() => {
  'use strict';
  if (window.__poliglotta) return;
  window.__poliglotta = true;

  const L = globalThis.PG_LANGS;
  const DEFAULTS = { enabled: true, myLang: 'it', incoming: true, outgoing: true, showOwn: false, keepWords: 'Projet' };
  const ROW = '[role="row"]';
  const MSG_SCOPE = '[data-scope="messages_table"]';
  const MSG_MARK = '[role="row"], [data-scope="messages_table"], [role="log"]';
  const COMPOSER = '[contenteditable="true"][role="textbox"], textarea';
  const MSG_LABEL = /messag|nachricht|mensaj|mensag|wiadomo|bericht|сообщ|mesaj|üzenet|zpráv/i;

  let settings = { ...DEFAULTS };
  let threads = {};
  let observer = null;

  // ---------------------------------------------------------------- utilità
  const letters = (s) => ((s || '').replace(/https?:\/\/\S+/g, '').match(/\p{L}/gu) || []).length;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function similar(a, b) {
    const ta = new Set(norm(a).split(' ').filter(Boolean));
    const tb = norm(b).split(' ').filter(Boolean);
    if (!tb.length || !ta.size) return 0;
    let hit = 0;
    for (const w of tb) if (ta.has(w)) hit++;
    return hit / Math.max(tb.length, ta.size);
  }

  // ---------------------------------------------------------------- traduzione
  function askBackground(texts, tl, sl, format) {
    return new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error('CONTEXT'));
      try {
        chrome.runtime.sendMessage({ type: 'translate', texts, tl, sl, format }, (res) => {
          const e = chrome.runtime.lastError;
          if (e) return reject(new Error(e.message));
          if (!res || !res.ok) return reject(new Error((res && res.error) || 'ERR'));
          resolve(res.results);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Riserva: traduttore integrato di Chrome (sul computer, senza rete), se disponibile.
  const builtinCache = new Map();
  function detectLocal(text) {
    return new Promise((resolve) => {
      try {
        chrome.i18n.detectLanguage(text, (res) => {
          const l = res && res.languages && res.languages[0];
          resolve(l && l.language && l.language !== 'und' ? l.language : null);
        });
      } catch (e) { resolve(null); }
    });
  }
  async function builtinTranslate(texts, tl, sl) {
    if (!('Translator' in self)) throw new Error('UNAVAILABLE');
    const out = [];
    for (const t of texts) {
      let src = sl && sl !== 'auto' ? sl : await detectLocal(t);
      if (!src) throw new Error('UNAVAILABLE');
      if (L.sameLang(src, tl)) { out.push({ text: t, src }); continue; }
      const pair = { sourceLanguage: L.base(src), targetLanguage: L.base(tl) };
      const k = pair.sourceLanguage + '>' + pair.targetLanguage;
      let tr = builtinCache.get(k);
      if (!tr) {
        const av = await self.Translator.availability(pair);
        if (av !== 'available') throw new Error('UNAVAILABLE');
        tr = await self.Translator.create(pair);
        builtinCache.set(k, tr);
      }
      out.push({ text: await tr.translate(t), src });
    }
    return out;
  }

  async function translate(texts, tl, sl, format) {
    try {
      return await askBackground(texts, L.google(tl), sl || 'auto', format);
    } catch (err) {
      if (/CONTEXT|invalidated/i.test(err.message)) {
        pill.status('Poliglotta è stata aggiornata: ricarica la pagina (F5)', true);
        throw err;
      }
      if (format === 'html') throw err;   // chi chiama riprova in modalità testo
      try { return await builtinTranslate(texts, tl, sl); } catch (e) { throw err; }
    }
  }

  // ---------------------------------------------------------------- chat e lingue
  function isMessagesPage() {
    const h = location.hostname;
    const p = location.pathname;
    return /(^|\.)messenger\.com$/.test(h) || /^\/messages(\/|$)/.test(p) ||
      (h === 'business.facebook.com' && /inbox/.test(p));
  }

  function urlThreadId() {
    const m = location.pathname.match(/\/t\/([^/?#]+)/);
    if (m) return m[1];
    const q = new URLSearchParams(location.search);
    return q.get('selected_item_id') || q.get('thread_id') || null;
  }

  // Il contenitore più vicino che ha sia messaggi sia casella di scrittura = una conversazione.
  const rootOf = new WeakMap();
  function convRoot(el) {
    const cached = rootOf.get(el);
    if (cached && cached.isConnected && cached.contains(el)) return cached;
    let n = el.parentElement;
    for (let depth = 0; n && n !== document.body && depth < 40; depth++, n = n.parentElement) {
      if (n.querySelector(COMPOSER) && n.querySelector(MSG_MARK)) {
        rootOf.set(el, n);
        return n;
      }
    }
    return null;
  }

  const bubbleKeys = new WeakMap();
  let bubbleSeq = 0;
  function bubbleKey(root) {
    let k = bubbleKeys.get(root);
    if (k) return k;
    const a = root.querySelector('a[href*="/t/"]');
    const m = a && (a.getAttribute('href') || '').match(/\/t\/([^/?#]+)/);
    if (m) {
      k = 'u:' + m[1];
    } else {
      const h = root.querySelector('[role="heading"], h1, h2, h3, h4');
      const label = ((h && h.innerText) || root.getAttribute('aria-label') || '').trim().slice(0, 80);
      k = label ? 'n:' + label : 'b:' + (++bubbleSeq);
    }
    bubbleKeys.set(root, k);
    return k;
  }

  function keyFor(el) {
    if (isMessagesPage()) {
      const id = urlThreadId();
      if (id) return 'u:' + id;
    }
    const root = convRoot(el);
    return root ? bubbleKey(root) : null;
  }

  function targetFor(key) {
    if (!key) return null;
    const th = threads[key];
    if (th && th.pin === 'off') return null;
    const lang = (th && (th.pin || th.auto)) || null;
    if (!lang || L.sameLang(lang, settings.myLang)) return null;
    return lang;
  }

  let saveTimer = null;
  function saveThreads() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!alive()) return;
      const keys = Object.keys(threads);
      if (keys.length > 600) {
        keys.sort((a, b) => (threads[a].t || 0) - (threads[b].t || 0))
          .slice(0, keys.length - 500)
          .forEach((k) => delete threads[k]);
      }
      try { chrome.storage.local.set({ threads }); } catch (e) { /* contesto chiuso */ }
    }, 600);
  }

  function mergeThreads(incoming) {
    for (const [k, v] of Object.entries(incoming || {})) {
      if (!threads[k] || (v.t || 0) >= (threads[k].t || 0)) threads[k] = v;
    }
    pill.render();
  }

  // Messaggio ricevuto = bolla appoggiata a sinistra della riga (o dell'elenco messaggi).
  const unitOf = new WeakMap();
  function isIncoming(el) {
    const ref = el.closest(ROW) || unitOf.get(el) || el.closest('[role="log"], [role="main"]');
    if (!ref) return true;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    const rr = ref.getBoundingClientRect();
    if (!r.width || !rr.width) return true;
    return (r.left - rr.left) <= (rr.right - r.right);
  }

  // Lingua della chat: ultimi messaggi ricevuti, i più recenti pesano di più.
  function recomputeAuto(key, scope) {
    if (!key) return;
    const uiLang = (document.documentElement.lang || '').split('-')[0];
    const cands = [];
    for (const e of (scope || document).querySelectorAll('[data-pg-lang][data-pg-in="1"]')) {
      const n = +e.dataset.pgN || 0;
      const lang = e.dataset.pgLang;
      if (!lang || n < 8) continue;
      // Scritte brevi dell'interfaccia di Facebook ("Ha risposto", "Oggi alle 10") non contano.
      if (uiLang && L.sameLang(lang, uiLang) && n < 30) continue;
      cands.push({ lang: L.base(lang), n });
    }
    const recent = cands.slice(-6).reverse();
    if (!recent.length) return;
    const score = {};
    recent.forEach((c, i) => { score[c.lang] = (score[c.lang] || 0) + Math.min(c.n, 80) * Math.pow(0.6, i); });
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    const th = threads[key] || (threads[key] = {});
    if (th.auto !== best) {
      th.auto = best;
      th.t = Date.now();
      saveThreads();
      if (pill.key === key) pill.render();
    }
  }

  // ---------------------------------------------------------------- messaggi ricevuti
  const textCache = new Map();
  const queue = [];
  let flushTimer = null;
  let failedAt = 0;
  const diag = { units: 0, mode: null, found: 0, ok: 0, fail: 0, lastError: null };

  function clearMark(el) {
    el.removeAttribute('data-pg-tr');
    delete el.dataset.pgLang;
    delete el.dataset.pgN;
    delete el.dataset.pgIn;
  }

  function applyResult(el, text, r) {
    if (!r) return;
    const src = r.src || '';
    el.dataset.pgLang = src;
    el.dataset.pgN = String(letters(text));
    const incoming = isIncoming(el);
    el.dataset.pgIn = incoming ? '1' : '0';
    const show = src && !L.sameLang(src, settings.myLang) && norm(r.text) !== norm(text) &&
      (incoming || settings.showOwn);
    if (show) el.setAttribute('data-pg-tr', `${L.short(src)} · ${r.text}`);
    else el.removeAttribute('data-pg-tr');
  }

  // Dove stanno i messaggi. Facebook cambia struttura spesso, quindi provo in ordine:
  //  1) marcatori [data-scope="messages_table"]: se stanno dentro righe uso le righe,
  //     altrimenti il contenitore che li raccoglie tutti (l'elenco dei messaggi di quella chat);
  //  2) il contenitore accessibile della chat [role="log"];
  //  3) le classiche righe [role="row"].
  const NAV = '[role="navigation"], [role="banner"]';
  function commonAncestor(nodes) {
    let a = nodes[0].parentElement;
    while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
    return a;
  }
  function messageUnits() {
    const ds = [...document.querySelectorAll(MSG_SCOPE)].filter((e) => !e.closest(NAV));
    if (ds.length) {
      const rows = [...new Set(ds.map((e) => e.closest(ROW)).filter((r) => r && !r.closest(NAV)))];
      if (rows.length) return { units: rows, mode: 'scope-rows' };
      // Raggruppo per conversazione (pagina messaggi o singola bolla della home).
      const groups = new Map();
      for (const e of ds) {
        const root = convRoot(e) || document.body;
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(e);
      }
      const units = [];
      for (const list of groups.values()) {
        const box = list.length > 1 ? commonAncestor(list)
          : (list[0].closest('[role="log"], [role="grid"], [role="main"]') || list[0]);
        if (box && box !== document.body && box !== document.documentElement) units.push(box);
      }
      if (units.length) return { units, mode: 'scope-box' };
    }
    const logs = [...document.querySelectorAll('[role="log"]')]
      .filter((l) => !l.closest(NAV) && /\p{L}/u.test(l.textContent));
    if (logs.length) return { units: logs, mode: 'log' };
    return { units: [...document.querySelectorAll(ROW)], mode: 'row' };
  }

  // Blocchi di testo dentro un contenitore: parto dai nodi di testo veri, così non dipendo da dir="auto".
  const SKIP = '[contenteditable="true"], textarea, [role="navigation"], [role="banner"], [aria-hidden="true"], button, h1, h2, h3, h4, h5, h6';
  function textHosts(unit) {
    const hosts = [];
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/\p{L}/u.test(n.nodeValue)) continue;
      const p = n.parentElement;
      if (!p || p.closest(SKIP)) continue;
      const host = p.closest('[dir="auto"]') || p.closest('div, p, li');
      if (!host || host === unit || !unit.contains(host)) continue;
      if (!hosts.includes(host)) hosts.push(host);
    }
    // Tengo i blocchi più interni: un contenitore che ne racchiude altri (es. un giorno intero) non è un messaggio.
    return hosts.filter((h) => !hosts.some((o) => o !== h && h.contains(o)));
  }

  function scan() {
    if (!settings.enabled || !alive()) return;
    if (Date.now() - failedAt < 30000) return;
    const onMsgPage = isMessagesPage();
    const touched = new Map();
    const { units, mode } = messageUnits();
    diag.units = units.length;
    diag.mode = mode;
    for (const row of units) {
      const rowRaw = row.textContent;
      if (row.dataset.pgRow === rowRaw) continue;                  // contenitore già visto, invariato
      if (row.closest(NAV)) continue;
      if (mode === 'row' && row.querySelector('a[href*="/t/"]')) continue; // elenco chat, non messaggi
      if (!onMsgPage && (row.closest('[role="article"]') || !convRoot(row))) continue;
      row.dataset.pgRow = rowRaw;
      for (const el of textHosts(row)) {
        unitOf.set(el, row);
        const raw = el.textContent;
        if (el.dataset.pgRaw === raw) continue;
        const text = (el.innerText || '').trim();
        el.dataset.pgRaw = raw;
        el.dataset.pgText = text;
        clearMark(el);
        if (letters(text) < 2) continue;
        diag.found++;
        const cached = textCache.get(text);
        if (cached) {
          applyResult(el, text, cached);
          const key = keyFor(el);
          if (key) touched.set(key, convRoot(el));
          continue;
        }
        queue.push({ el, text });
      }
    }
    for (const [key, scope] of touched) recomputeAuto(key, scope);
    if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 120);
  }

  async function flush() {
    flushTimer = null;
    const items = queue.splice(0, queue.length);
    if (!items.length) return;
    const uniq = [...new Set(items.map((i) => i.text))];
    try {
      const res = await translate(uniq, settings.myLang, 'auto');
      diag.ok++;
      uniq.forEach((t, i) => textCache.set(t, res[i]));
      if (textCache.size > 3000) {
        for (const k of [...textCache.keys()].slice(0, 1000)) textCache.delete(k);
      }
      const touched = new Map();
      for (const { el, text } of items) {
        if (!el.isConnected || el.dataset.pgText !== text) continue;
        applyResult(el, text, textCache.get(text));
        const key = keyFor(el);
        if (key) touched.set(key, convRoot(el));
      }
      for (const [key, scope] of touched) recomputeAuto(key, scope);
    } catch (err) {
      failedAt = Date.now();
      diag.fail++;
      diag.lastError = String((err && err.message) || err).slice(0, 200);
      for (const { el, text } of items) {
        if (el.dataset.pgText === text) {
          delete el.dataset.pgText;
          delete el.dataset.pgRaw;
          const unit = unitOf.get(el) || el.closest(ROW);
          if (unit) delete unit.dataset.pgRow;   // il contenitore verrà ritentato
        }
      }
    }
    if (queue.length && !flushTimer) flushTimer = setTimeout(flush, 120);
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 300);
  }

  // ---------------------------------------------------------------- casella di scrittura
  const edState = new Map();   // editor -> { translated, original, target }
  const busy = new Set();

  function isComposer(ed) {
    if (!ed) return false;
    if (ed.tagName === 'TEXTAREA' && !isMessagesPage()) return false;
    if (ed.closest('[role="article"]')) return false;
    if (isMessagesPage()) return true;
    const label = [ed.getAttribute('aria-label'), ed.getAttribute('aria-placeholder'), ed.getAttribute('placeholder')].join(' ');
    if (MSG_LABEL.test(label)) return true;
    return !!convRoot(ed);
  }

  function composerFrom(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    const ed = el && el.closest ? el.closest(COMPOSER) : null;
    return ed && isComposer(ed) ? ed : null;
  }

  // Lettura della casella riga per riga: ogni riga, e per ogni a capo se era un "a capo" (Maiusc+Invio)
  // o un nuovo paragrafo. Così posso riscrivere il testo con la stessa identica struttura.
  const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'SECTION']);
  const normLine = (s) => s.replace(/ /g, ' ').replace(/[​﻿]/g, '');

  function readStructure(ed) {
    let lines = [];
    let seps = [];
    if (ed.tagName === 'TEXTAREA') {
      lines = ed.value.split('\n');
      seps = lines.slice(1).map(() => 'br');
    } else {
      const emit = (parts) => parts.forEach((t, k) => {
        if (lines.length) seps.push(k === 0 ? 'p' : 'br');
        lines.push(normLine(t));
      });
      const splitInline = (nodes) => {
        const parts = [''];
        let lastBr = false;
        const walk = (n) => {
          if (n.nodeType === 3) {
            if (n.nodeValue) { parts[parts.length - 1] += n.nodeValue; lastBr = false; }
            return;
          }
          if (n.nodeType !== 1) return;
          if (n.tagName === 'BR') { parts.push(''); lastBr = true; return; }
          if (n.tagName === 'IMG') {
            const alt = n.getAttribute('alt') || '';
            if (alt) { parts[parts.length - 1] += alt; lastBr = false; }
            return;
          }
          for (const c of n.childNodes) walk(c);
        };
        nodes.forEach(walk);
        if (lastBr) parts.pop();   // l'ultimo <br> di un paragrafo è solo un segnaposto
        return parts;
      };
      const container = (node) => {
        let inline = [];
        const flush = () => {
          if (inline.some((c) => c.nodeType !== 3 || c.nodeValue.trim())) emit(splitInline(inline));
          inline = [];
        };
        for (const c of node.childNodes) {
          if (c.nodeType === 1 && BLOCK_TAGS.has(c.tagName)) {
            flush();
            if ([...c.children].some((x) => BLOCK_TAGS.has(x.tagName))) container(c);
            else emit(splitInline([c]));
          } else {
            inline.push(c);
          }
        }
        flush();
      };
      container(ed);
    }
    // Tolgo le righe vuote all'inizio e alla fine (Messenger non le invia comunque).
    while (lines.length && !lines[0].trim()) { lines.shift(); seps.shift(); }
    while (lines.length && !lines[lines.length - 1].trim()) { lines.pop(); seps.pop(); }
    return { lines, seps };
  }

  const editorText = (ed) => readStructure(ed).lines.join('\n');

  function selectAllIn(ed) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  function insertText(text) {
    try { document.execCommand('insertText', false, text); } catch (e) { /* ignora */ }
  }

  // A capo come lo farebbe la tastiera: l'editor di Facebook (Lexical) gestisce questi eventi da solo.
  function insertBreak(ed, kind) {
    const inputType = kind === 'p' ? 'insertParagraph' : 'insertLineBreak';
    const ev = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, composed: true });
    const sel = window.getSelection();
    const at = (sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)) || ed;
    (ed.contains(at) ? at : ed).dispatchEvent(ev);
    if (!ev.defaultPrevented) {
      try { document.execCommand(inputType, false); } catch (e) { /* ignora */ }
    }
  }

  // Scrive le righe nella casella. Restituisce true se la struttura è identica a quella voluta.
  async function writeStructure(ed, lines, seps) {
    ed.focus();
    const want = lines.join('\n');
    if (ed.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ed, want);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const ok = () => editorText(ed) === want;

    // 1) riga per riga, con gli stessi a capo dell'originale
    selectAllIn(ed);
    await tick();
    insertText(lines[0] || '');
    await tick();
    for (let i = 1; i < lines.length; i++) {
      insertBreak(ed, seps[i - 1]);
      await tick();
      if (lines[i]) { insertText(lines[i]); await tick(); }
    }
    await frame();
    if (ok()) return true;

    // 2) incolla tutto in una volta
    selectAllIn(ed);
    await tick();
    const dt = new DataTransfer();
    dt.setData('text/plain', want);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await frame();
    if (ok()) return true;

    // 3) ultima spiaggia
    selectAllIn(ed);
    await tick();
    insertText(want);
    await frame();
    return ok();
  }

  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Nomi della persona con cui stai chattando (titolo della chat), da non tradurre mai.
  const CONV_WITH = /(?:conversazione con|conversation with|chat con|chat with|gespräch mit|conversación con|conversa com|conversation avec)\s+(.+)/i;
  const GENERIC = new Set(['Chat', 'Messaggi', 'Messenger', 'Facebook', 'Attivo', 'Attiva', 'Ora', 'Oggi', 'Ieri', 'Active', 'Now']);
  function chatNames(ed) {
    const F = globalThis.PG_FMT;
    const scope = convRoot(ed) || document.querySelector('[role="main"]') || document.body;
    const out = new Set();
    for (const h of scope.querySelectorAll('[role="heading"], h1, h2, h3, h4')) {
      if (h.closest('[role="navigation"], [role="banner"]') || h.contains(ed)) continue;
      const t = (h.innerText || '').trim();
      if (t && t.length <= 60 && t.split(/\s+/).length <= 5) F.nameTokens(t).forEach((w) => out.add(w));
    }
    for (const el of scope.querySelectorAll('[aria-label]')) {
      const m = (el.getAttribute('aria-label') || '').match(CONV_WITH);
      if (m) F.nameTokens(m[1]).forEach((w) => out.add(w));
    }
    return [...out].filter((w) => !GENERIC.has(w));
  }

  // Traduce il messaggio riga per riga conservando a capo, elenchi, emoji, *grassetto*, _corsivo_, ~barrato~,
  // `codici`, e senza mai toccare link, email, @menzioni, #hashtag e nomi.
  async function translateMessage(lines, target, opts) {
    const F = globalThis.PG_FMT;
    const plan = F.plan(lines, opts);
    const out = plan.map((p) => (p.keep ? p.text : null));
    const plainIdx = [];
    const htmlIdx = [];
    plan.forEach((p, i) => { if (!p.keep) (p.fmt ? htmlIdx : plainIdx).push(i); });
    const finish = (i, text, src) => {
      out[i] = src && L.sameLang(src, target) ? plan[i].text : F.assemble(plan[i], text);
    };
    // 1) modalità HTML: le parti protette sono marcate "non tradurre"
    const retry = [];
    if (htmlIdx.length) {
      let res = null;
      try { res = await translate(htmlIdx.map((i) => plan[i].html), target, 'auto', 'html'); } catch (e) { res = null; }
      htmlIdx.forEach((i, j) => {
        const r = res && res[j];
        const md = r && F.fromHtml(r.text, target);
        const intact = md && F.sameCounts(md.counts, plan[i].counts) &&
          F.sameList(md.kept, plan[i].kept) && F.sameList(md.codes, plan[i].codes) && F.hasAll(md.text, plan[i].kept);
        if (intact) finish(i, md.text, r.src);
        else retry.push(i);
      });
    }
    // 2) modalità testo (righe semplici, o riserva se l'HTML non è tornato intatto)
    const pieces = [];
    const textIdx = plainIdx.concat(retry);
    if (textIdx.length) {
      const res = await translate(textIdx.map((i) => plan[i].body), target, 'auto');
      textIdx.forEach((i, j) => {
        const r = res[j];
        const t = retry.includes(i) ? F.fixPlain(r.text, plan[i]) : r.text;
        if (retry.includes(i) && !F.hasAll(t, plan[i].kept)) pieces.push(i);   // un nome o un link è cambiato
        else finish(i, t, r.src);
      });
    }
    // 3) ultima difesa: traduco solo i pezzi tra le parti protette, che restano identiche per forza
    for (const i of pieces) {
      const parts = F.segments(plan[i]);
      const todo = parts.filter((p) => p.tr).map((p) => p.text.trim());
      const res = todo.length ? await translate(todo, target, 'auto') : [];
      out[i] = F.assemble(plan[i], F.joinSegments(parts, res.map((r) => r.text)));
    }
    return out;
  }

  const markBusy = () => document.documentElement.toggleAttribute('data-pg-busy', busy.size > 0);

  async function translateOutgoing(ed, struct, target) {
    busy.add(ed);
    markBusy();
    pill.show(ed);
    pill.status('Traduzione…');
    const text = struct.lines.join('\n');
    try {
      const F = globalThis.PG_FMT;
      const opts = { names: chatNames(ed), keep: F.parseList(settings.keepWords), caps: true };
      const lines = await translateMessage(struct.lines, target, opts);
      if (!ed.isConnected) return;
      if (editorText(ed) !== text) return;   // hai continuato a scrivere: non tocco nulla
      const translated = lines.join('\n');
      if (norm(translated) === norm(text)) {
        edState.set(ed, { translated: text, original: struct, target });
        pill.status(`Già in ${L.name(target)} · Invio per inviare`);
        return;
      }
      const exact = await writeStructure(ed, lines, struct.seps);
      edState.set(ed, { translated: editorText(ed), original: struct, target });
      pill.status(exact
        ? `Tradotto in ${L.name(target)} · Invio per inviare · Esc per annullare`
        : `Tradotto in ${L.name(target)}, ma controlla gli a capo prima di inviare · Esc per annullare`, !exact);
    } catch (err) {
      if (!/CONTEXT|invalidated/i.test(err.message)) pill.status('Traduzione non riuscita: riprova tra poco', true);
    } finally {
      busy.delete(ed);
      markBusy();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') return onEscape(e);
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    if (!settings.enabled || !settings.outgoing || !alive()) return;
    const ed = composerFrom(e.target);
    if (!ed) return;
    if (busy.has(ed)) return stop(e);
    const struct = readStructure(ed);
    const text = struct.lines.join('\n');
    if (!text.trim()) return;
    const target = targetFor(keyFor(ed));
    if (!target) return;
    const st = edState.get(ed);
    if (st && (norm(text) === norm(st.translated) || similar(text, st.translated) >= 0.5)) {
      edState.delete(ed);   // secondo Invio: lascio inviare a Messenger
      return;
    }
    stop(e);
    translateOutgoing(ed, struct, target);
  }

  function onEscape(e) {
    const ed = composerFrom(e.target);
    if (!ed) return;
    const st = edState.get(ed);
    if (!st || st.original.lines.join('\n') === st.translated) return;
    stop(e);
    edState.delete(ed);
    writeStructure(ed, st.original.lines, st.original.seps).then(() => pill.status('Testo originale ripristinato'));
  }

  function resetEmptyEditors() {
    for (const ed of edState.keys()) {
      if (!ed.isConnected || !editorText(ed).trim()) edState.delete(ed);
    }
  }

  // ---------------------------------------------------------------- etichetta lingua sopra la casella
  const pill = (() => {
    const host = document.createElement('div');
    host.id = 'poliglotta-pill';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;display:none;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `
      <style>
        :host { all: initial; }
        .box { font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #10233a;
               background: #ffffff; border: 1px solid #c9d6e3; border-radius: 999px; box-shadow: 0 2px 10px rgba(0,0,0,.12);
               display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; }
        .lab { font-weight: 650; letter-spacing: .02em; white-space: nowrap; }
        select { font: inherit; font-size: 12px; color: inherit; background: #eef3f8; border: 0; border-radius: 999px;
                 padding: 3px 6px; max-width: 190px; cursor: pointer; }
        .msg { display: none; margin-top: 4px; font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
               background: #10233a; color: #fff; padding: 5px 9px; border-radius: 8px; max-width: 320px; }
        .msg.show { display: block; }
        .msg.err { background: #a8322d; }
        @media (prefers-color-scheme: dark) {
          .box { background: #1f2a36; color: #e6eef6; border-color: #34465a; }
          select { background: #2b3a4b; }
          .msg { background: #e6eef6; color: #10233a; }
        }
      </style>
      <div class="box" part="box"><span aria-hidden="true">🌐</span><span class="lab"></span><select title="Lingua delle tue risposte in questa chat"></select></div>
      <div class="msg" role="status"></div>`;
    const lab = sh.querySelector('.lab');
    const select = sh.querySelector('select');
    const msg = sh.querySelector('.msg');
    let current = null;
    let key = null;
    let posTimer = null;
    let msgTimer = null;

    function render() {
      if (!current) return;
      const th = threads[key] || {};
      const target = targetFor(key);
      const me = L.short(settings.myLang);
      lab.textContent = th.pin === 'off' ? 'Non tradotta' : target ? `${me} → ${L.short(target)}` : `${me} → ?`;
      lab.title = target ? `Le tue risposte vengono tradotte in ${L.name(target)}`
        : th.pin === 'off' ? 'Traduzione disattivata per questa chat'
        : 'Lingua non ancora rilevata: scegline una dal menu o aspetta un messaggio';
      const autoLabel = th.auto
        ? (L.sameLang(th.auto, settings.myLang) ? `Automatico (${L.name(th.auto)}: non traduco)` : `Automatico (${L.name(th.auto)})`)
        : 'Automatico (in attesa di un messaggio)';
      const opts = [`<option value="auto">${autoLabel}</option>`, '<option value="off">Non tradurre questa chat</option>', '<option disabled>──────────</option>'];
      for (const c of L.sortedCodes(settings.myLang)) opts.push(`<option value="${c}">${L.name(c)}</option>`);
      select.innerHTML = opts.join('');
      select.value = th.pin && (th.pin === 'off' || L.CODES.includes(th.pin)) ? th.pin : 'auto';
    }

    function position() {
      if (!current || !current.isConnected) return hide();
      const k = keyFor(current);
      if (k !== key) { key = k; render(); }
      const r = current.getBoundingClientRect();
      if (!r.width) return;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      let top = r.top - h - 6;
      if (top < 4) top = r.bottom + 6;
      let left = Math.min(r.right - w, window.innerWidth - w - 8);
      left = Math.max(8, left);
      host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    function show(ed) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      current = ed;
      key = keyFor(ed);
      render();
      host.style.display = 'block';
      position();
      clearInterval(posTimer);
      posTimer = setInterval(position, 300);
    }

    function hide() {
      host.style.display = 'none';
      clearInterval(posTimer);
      current = null;
      key = null;
    }

    function status(text, isErr) {
      msg.textContent = text;
      msg.className = 'msg show' + (isErr ? ' err' : '');
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { msg.className = 'msg'; position(); }, isErr ? 6000 : 4500);
      if (current) position();
    }

    select.addEventListener('change', () => {
      if (!key) return;
      const v = select.value;
      const th = threads[key] || (threads[key] = {});
      th.pin = v === 'auto' ? null : v;
      th.t = Date.now();
      saveThreads();
      render();
      const target = targetFor(key);
      status(v === 'off' ? 'Questa chat non verrà tradotta'
        : target ? `Le tue risposte andranno in ${L.name(target)}`
        : 'Lingua automatica: aspetto un messaggio per rilevarla');
      if (current) current.focus();
    });

    return {
      show, hide, render, status, host,
      get key() { return key; },
      get current() { return current; }
    };
  })();

  function onFocusIn(e) {
    if (!settings.enabled || !settings.outgoing) return;
    const ed = composerFrom(e.target);
    if (!ed) return;
    pill.show(ed);
    // Estensione aggiornata o ricaricata: questa pagina usa ancora la versione vecchia.
    if (!alive()) pill.status('Poliglotta è stata aggiornata: premi F5 per ricaricare la pagina', true);
  }

  function onFocusOut(e) {
    const ed = composerFrom(e.target);
    if (!ed) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (a === pill.host || composerFrom(a)) return;
      pill.hide();
    }, 200);
  }

  // ---------------------------------------------------------------- diagnostica (anonima)
  // Struttura della pagina senza il testo dei messaggi: solo tag, ruoli e quante lettere ci sono.
  function outlineOf(node, depth, budget) {
    if (budget.n-- <= 0) return '…';
    const parts = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const n = letters(c.nodeValue);
        if (n) parts.push(`"${n}L"`);
      } else if (c.nodeType === 1 && depth < 30) {
        parts.push(outlineOf(c, depth + 1, budget));
      }
    }
    const a = [];
    for (const attr of ['role', 'dir', 'data-scope', 'aria-hidden', 'contenteditable', 'data-pg-tr']) {
      const v = node.getAttribute(attr);
      if (v != null) a.push(attr === 'data-pg-tr' ? 'TRADOTTO' : `${attr}=${v}`);
    }
    if (node.hasAttribute('aria-label')) a.push('aria-label');
    if (node.tagName === 'A') a.push(/\/t\//.test(node.getAttribute('href') || '') ? 'href=/t/' : 'href');
    const tag = node.tagName.toLowerCase() + (a.length ? `[${a.join(' ')}]` : '');
    return parts.length ? `${tag}{${parts.join(',')}}` : tag;
  }

  function tagOf(node) {
    const a = [];
    for (const attr of ['role', 'dir', 'data-scope', 'aria-live', 'aria-hidden']) {
      const v = node.getAttribute(attr);
      if (v != null) a.push(`${attr}=${v}`);
    }
    if (node.hasAttribute('aria-label')) a.push('aria-label');
    a.push(`figli=${node.childElementCount}`);
    return node.tagName.toLowerCase() + `[${a.join(' ')}]`;
  }

  function chainOf(node, max) {
    const out = [];
    for (let n = node; n && n !== document.documentElement && out.length < max; n = n.parentElement) out.push(tagOf(n));
    return out;
  }

  async function buildDiag() {
    const q = (s) => { try { return document.querySelectorAll(s).length; } catch (e) { return -1; } };
    const { units, mode } = messageUnits();
    const hostList = [];
    for (const u of units.slice(-200)) hostList.push(...textHosts(u));
    let test;
    try {
      const [r] = await translate(['Guten Morgen, wie geht es dir?'], settings.myLang, 'auto');
      test = { ok: true, src: r && r.src, len: r && r.text.length };
    } catch (e) {
      test = { ok: false, error: String((e && e.message) || e).slice(0, 200) };
    }
    const ds = [...document.querySelectorAll(MSG_SCOPE)].filter((e) => !e.closest(NAV));
    return {
      version: chrome.runtime.getManifest().version,
      host: location.hostname,
      path: location.pathname.replace(/\d+/g, '#'),
      messagesPage: isMessagesPage(),
      uiLang: document.documentElement.lang || null,
      settings,
      counts: {
        main: q('[role="main"]'), grid: q('[role="grid"]'), rows: q('[role="row"]'),
        dataScope: q(MSG_SCOPE), dataScopeWithText: ds.filter((e) => /\p{L}/u.test(e.textContent)).length,
        dirAuto: q('[dir="auto"]'), log: q('[role="log"]'), units: units.length, textHosts: hostList.length,
        processed: q('[data-pg-text]'), translated: q('[data-pg-tr]'), composers: q(COMPOSER)
      },
      mode,
      run: { ...diag, failedAgoS: failedAt ? Math.round((Date.now() - failedAt) / 1000) : null },
      testTranslate: test,
      scopeChain: ds.length ? chainOf(ds[ds.length - 1], 25) : [],
      scopeOutline: ds.slice(-2).map((e) => outlineOf(e, 0, { n: 60 })),
      logs: [...document.querySelectorAll('[role="log"]')].slice(0, 3).map((l) => ({ tag: tagOf(l), letters: letters(l.textContent), inNav: !!l.closest(NAV) })),
      hostsSample: hostList.slice(-4).map((h) => ({ tag: tagOf(h), letters: letters(h.textContent), lang: h.dataset.pgLang || null, inc: h.dataset.pgIn || null, tr: h.hasAttribute('data-pg-tr') }))
    };
  }

  function onMessage(msg, sender, sendResponse) {
    if (!msg || msg.type !== 'diag') return false;
    buildDiag().then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
    return true;
  }

  // ---------------------------------------------------------------- impostazioni e avvio
  function applyEnabled() {
    document.documentElement.classList.toggle('pg-off', !settings.enabled || !settings.incoming);
    if (!settings.enabled || !settings.outgoing) pill.hide();
  }

  function resetAll() {
    textCache.clear();
    for (const el of document.querySelectorAll('[data-pg-text]')) {
      delete el.dataset.pgText;
      delete el.dataset.pgRaw;
      clearMark(el);
    }
    for (const row of document.querySelectorAll('[data-pg-row]')) delete row.dataset.pgRow;
    scheduleScan();
  }

  function onStorage(changes, area) {
    if (area !== 'local' || !alive()) return;
    if (changes.settings) {
      const old = settings;
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      applyEnabled();
      if (old.myLang !== settings.myLang || old.showOwn !== settings.showOwn) resetAll();
      else scheduleScan();
      pill.render();
    }
    if (changes.threads) mergeThreads(changes.threads.newValue);
  }

  async function start() {
    try {
      const data = await chrome.storage.local.get(['settings', 'threads']);
      settings = { ...DEFAULTS, ...(data.settings || {}) };
      threads = data.threads || {};
    } catch (e) { /* uso i valori predefiniti */ }
    applyEnabled();
    chrome.storage.onChanged.addListener(onStorage);
    chrome.runtime.onMessage.addListener(onMessage);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    observer = new MutationObserver((mutations) => {
      if (!alive()) { observer.disconnect(); return; }
      if (edState.size) resetEmptyEditors();
      // Le modifiche dentro la casella di scrittura (mentre digiti) non richiedono una nuova scansione.
      for (const m of mutations) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!t || !t.closest('[contenteditable="true"]')) { scheduleScan(); break; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan();
    const active = composerFrom(document.activeElement);
    if (active) onFocusIn({ target: active });
  }

  start();
})();
