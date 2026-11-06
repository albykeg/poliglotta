// Poliglotta – conserva formattazione, link e nomi durante la traduzione.
// Messenger usa simboli: *grassetto*, _corsivo_, ~barrato~, `monospazio`, ``` blocco di codice ```.
// Ogni riga viene tradotta da sola (così a capo, righe vuote ed elenchi restano identici).
// I simboli diventano tag HTML che Google conserva; link, email, nomi e `codici` vengono marcati
// translate="no" e dopo la traduzione si controlla che siano rimasti identici.
(function (g) {
  'use strict';

  // Ordine: prima i simboli doppi, poi quelli singoli.
  const MARKS = [
    ['~~', 'del'], ['~', 's'],
    ['**', 'strong'], ['*', 'b'],
    ['__', 'em'], ['_', 'i']
  ];
  const TAG2MARK = Object.fromEntries(MARKS.map(([m, t]) => [t, m]));
  const TAGS = MARKS.map(([, t]) => t).concat('code', 'keep');

  // Segnaposto interni (caratteri ad uso privato, non compaiono nei messaggi).
  const C0 = '', C1 = '', K0 = '', K1 = '';
  const CODE_PH = /(\d+)/g;
  const KEEP_PH = /(\d+)/g;

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
  const letters = (s) => ((s || '').replace(/https?:\/\/\S+/g, '').match(/\p{L}/gu) || []).length;

  const markRe = {};
  for (const [m] of MARKS) {
    const E = reEsc(m);
    const C = reEsc(m[0]);
    markRe[m] = new RegExp(
      `(^|[^\\p{L}\\p{N}${C}])${E}(?=[^\\s${C}])((?:(?!${E}).)*?[^\\s${C}])${E}(?![\\p{L}\\p{N}${C}])`, 'gu');
  }

  // Inizio riga da non tradurre: rientro, punto elenco, numero, emoji.
  const EMO = '(?:[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}](?:\\uFE0F|\\u200D|[\\u{1F3FB}-\\u{1F3FF}]|[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}])*|[0-9#*]\\uFE0F?\\u20E3)';
  const BULLET = '(?:[•◦▪▫‣⁃∙·●○■□►▸▹▶➤➜➔→⇒✓✔✗✘\\-–—+>*](?=\\s)|\\d{1,3}[.)](?=\\s))';
  const PREFIX_RE = new RegExp(`^\\s*(?:${BULLET}\\s*)?(?:${EMO}\\s*)*`, 'u');
  const SUFFIX_RE = new RegExp(`(?:\\s*${EMO})+\\s*$`, 'u');

  // ------------------------------------------------------------ link e nomi da non toccare
  const TLDS = 'com|it|net|org|eu|de|fr|es|nl|be|ch|at|uk|co|io|app|shop|store|info|biz|me|tv|ly|gl|gg|link|site|online|pl|se|no|dk|fi|pt|ro|cz|sk|hu|gr|ru|ua|tr|us|ca|au|ie|lu|si|hr|bg|lt|lv|ee|is|mt|cy|al|rs|ba|mk|xyz|club|sport|pro|store|page|cloud|ai|tech|team';
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`-]+/giu;
  const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
  const DOMAIN_RE = new RegExp(`(?<![\\p{L}\\p{N}@./\\-\\uE003])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![\\p{L}\\p{N}\\-])(?:[/?#][^\\s<>"'\`\\uE000-\\uE003]*)?`, 'giu');
  const MENTION_RE = /(?<![\p{L}\p{N}_@])@[\p{L}\p{N}_.]*[\p{L}\p{N}_]/gu;
  const HASHTAG_RE = /(?<![\p{L}\p{N}_&#])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu;

  // Parole con la maiuscola che NON sono nomi: pronomi di cortesia, saluti, formule, titoli.
  const STOP = new Set(('lei la le lo li gli ne suo sua suoi sue loro ti te tu tuo tua tuoi tue vi voi vostro vostra vostri vostre ' +
    'mi me mio mia miei mie ci noi nostro nostra nostri nostre io egli ella esso essa ' +
    'il un una uno e ed o ma per con di da in su tra fra che chi non sì si no ok okay ' +
    'ciao salve buongiorno buonasera buonanotte grazie prego gentile gentilissimo gentilissima gentilissimi ' +
    'caro cara cari care carissimo carissima egregio egregia spett spettabile distinti cordiali saluti ' +
    'cliente clienti azienda ditta società signore signora signor signori signorina dottore dottoressa ' +
    'direttore direttrice responsabile titolare amico amica amici amiche team staff ' +
    'sig sigg sigra sig.ra dott dott.ssa dr ing avv prof geom arch rag mr mrs ms ' +
    'hi hello dear thanks thank you yes').split(/\s+/));
  // Luoghi e feste: si traducono (Europa → Europe), tranne quando fanno parte di un nome.
  const PLACES = new Set(('italia europa asia africa america oceania germania francia spagna inghilterra irlanda scozia galles ' +
    'olanda belgio lussemburgo svizzera austria polonia svezia norvegia danimarca finlandia islanda portogallo grecia cipro ' +
    'malta croazia slovenia serbia bosnia albania macedonia montenegro romania bulgaria ungheria slovacchia estonia lettonia ' +
    'lituania ucraina russia turchia canada messico brasile argentina cina giappone corea india australia ' +
    'torino milano roma napoli firenze venezia genova bologna palermo bari verona londra parigi berlino bruxelles lisbona ' +
    'madrid barcellona varsavia vienna praga atene mosca amsterdam copenaghen stoccolma oslo helsinki dublino zurigo ginevra monaco ' +
    'natale pasqua capodanno ferragosto epifania ' +
    'lunedì martedì mercoledì giovedì venerdì sabato domenica ' +
    'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre').split(/\s+/)
    .concat(['regno unito', 'gran bretagna', 'paesi bassi', 'stati uniti', 'repubblica ceca']));
  const ABBR = /(?:^|[\s(])(?:sig|sigg|sig\.ra|sig\.na|dott|dott\.ssa|dr|mr|mrs|ms|ing|avv|prof|geom|arch|rag|st)\.$/i;
  const GAP_RE = /[\s"“”„«»'‘’(\[{*_~•·\-–—\p{Extended_Pictographic}️‍]+$/u;

  function protectCaps(s, put) {
    const words = [...s.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)].map((m) => {
      const w = m[0].replace(/[-'’]+$/, '');
      return { w, i: m.index };
    });
    const nLetters = (w) => (w.match(/\p{L}/gu) || []).length;
    const isAllCaps = (w) => !/\p{Ll}/u.test(w) && nLetters(w) >= 2;
    const sentenceStart = (i) => {
      const before = s.slice(0, i);
      const stripped = before.replace(GAP_RE, '');
      const gap = before.slice(stripped.length);
      if (!stripped.trim()) return true;
      if (/\p{Extended_Pictographic}/u.test(gap)) return true;   // dopo un'emoji riparte la frase
      if (/\.$/.test(stripped) && ABBR.test(stripped)) return false;
      return /[.!?…:;]$/.test(stripped);
    };
    const cand = words.map((t) => ({
      ...t,
      cap: /^\p{Lu}/u.test(t.w) && nLetters(t.w) >= 2 && !STOP.has(t.w.toLowerCase()),
      allcaps: isAllCaps(t.w)
    }));
    const ranges = [];
    let k = 0;
    while (k < cand.length) {
      if (!cand[k].cap) { k++; continue; }
      let j = k;
      while (j + 1 < cand.length && cand[j + 1].cap &&
        /^[  ]$/.test(s.slice(cand[j].i + cand[j].w.length, cand[j + 1].i))) j++;
      const run = cand.slice(k, j + 1);
      k = j + 1;
      if (run.length >= 2 && run.every((r) => r.allcaps)) continue;     // TESTO URLATO: si traduce
      const phrase = run.map((r) => r.w).join(' ').toLowerCase();
      if (PLACES.has(phrase)) continue;
      if (run.length === 1) {
        if (sentenceStart(run[0].i)) continue;   // prima parola della frase: non posso sapere se è un nome
      }
      const last = run[run.length - 1];
      ranges.push([run[0].i, last.i + last.w.length]);
    }
    for (const [a, b] of ranges.reverse()) s = s.slice(0, a) + put(s.slice(a, b)) + s.slice(b);
    return s;
  }

  function protect(s, opts) {
    const kept = [];
    const put = (t) => { kept.push(t); return `${K0}${kept.length - 1}${K1}`; };
    const trimEnd = (m) => {
      const t = m.replace(/[.,;:!?)\]}»”’'"…]+$/u, '');
      return [t, m.slice(t.length)];
    };
    const link = (re) => {
      s = s.replace(re, (m) => {
        const [t, rest] = trimEnd(m);
        return t ? put(t) + rest : m;
      });
    };
    link(URL_RE);
    s = s.replace(EMAIL_RE, (m) => put(m));
    link(DOMAIN_RE);
    s = s.replace(MENTION_RE, (m) => put(m));
    s = s.replace(HASHTAG_RE, (m) => put(m));
    const phrases = (list, flags) => {
      for (const w of [...new Set(list)].filter((x) => x && x.length >= 2).sort((a, b) => b.length - a.length)) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}_\\uE002])${reEsc(w)}(?![\\p{L}\\p{N}_])`, flags);
        s = s.replace(re, (m) => put(m));
      }
    };
    phrases(opts.keep || [], 'giu');     // la tua lista "Mai tradurre" (maiuscole/minuscole indifferenti)
    phrases(opts.names || [], 'gu');     // nome della persona con cui chatti
    if (opts.caps !== false) s = protectCaps(s, put);
    return { s, kept };
  }

  function countTags(html) {
    const c = {};
    for (const t of TAGS) c[t] = 0;
    const re = /<(del|s|strong|b|em|i|code|span)\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const t = m[1].toLowerCase();
      if (t === 'span') { if (/translate\s*=\s*["']?no/i.test(m[0])) c.keep++; } else c[t]++;
    }
    return c;
  }

  // Simboli Messenger -> HTML.
  function toHtml(body, opts) {
    const codes = [];
    let s = body.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `${C0}${codes.length - 1}${C1}`; });
    const prot = protect(s, opts || {});
    s = prot.s;
    const seg = s.replace(CODE_PH, (m, i) => '`' + codes[+i] + '`');   // per la riserva "a pezzi"
    s = escapeHtml(s);
    for (const [m, tag] of MARKS) s = s.replace(markRe[m], `$1<${tag}>$2</${tag}>`);
    s = s.replace(CODE_PH, (m, i) => `<code translate="no">${escapeHtml(codes[+i])}</code>`);
    s = s.replace(KEEP_PH, (m, i) => `<span translate="no">${escapeHtml(prot.kept[+i])}</span>`);
    return { html: s, codes, kept: prot.kept, counts: countTags(s), seg };
  }

  function sameCounts(a, b) {
    return TAGS.every((t) => (a[t] || 0) === (b[t] || 0));
  }

  function sameList(a, b) {
    const x = [...(a || [])].sort();
    const y = [...(b || [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }

  // Ogni parte protetta deve comparire identica almeno tante volte quante nell'originale.
  function hasAll(text, list) {
    const need = {};
    for (const t of list || []) need[t] = (need[t] || 0) + 1;
    return Object.entries(need).every(([t, n]) => text.split(t).length - 1 >= n);
  }

  // HTML di Google -> simboli Messenger.
  function fromHtml(html, tl) {
    const root = { tag: null, attrs: '', kids: [] };
    const stack = [root];
    for (const tok of html.split(/(<\/?[a-zA-Z][^>]*>)/)) {
      if (!tok) continue;
      const m = tok.match(/^<(\/)?([a-zA-Z]+)([^>]*)>$/);
      if (!m) { stack[stack.length - 1].kids.push(decode(tok)); continue; }
      const name = m[2].toLowerCase();
      if (name === 'br') { stack[stack.length - 1].kids.push(' '); continue; }
      if (m[1]) {
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k].tag === name) { stack.length = k; break; }
        }
      } else {
        const node = { tag: name, attrs: m[3] || '', kids: [] };
        stack[stack.length - 1].kids.push(node);
        stack.push(node);
      }
    }
    const isFr = /^fr/i.test(tl || '');
    const afterPunct = isFr ? /^[ \t ]+(?=[.,)\]}…%])/ : /^[ \t ]+(?=[.,;:!?)\]}»”’…%])/;
    const beforePunct = /(?<=[(\[{«„“‘¿¡])[ \t ]+$/;
    const textOf = (n) => n.kids.map((k) => (typeof k === 'string' ? k : textOf(k))).join('');
    const kept = [];
    const codes = [];

    function render(node) {
      const parts = [];
      for (let i = 0; i < node.kids.length; i++) {
        const k = node.kids[i];
        if (typeof k === 'string') { parts.push(k); continue; }
        // Google a volte aggiunge spazi attorno ai tag: li tolgo davanti alla punteggiatura.
        if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(beforePunct, '');
        const r = renderTag(k);
        if (parts.length && (isFr ? /^[,.]/ : /^[,.;:!?]/).test(r)) {
          parts[parts.length - 1] = parts[parts.length - 1].replace(/[ \t ]+$/, '');
        }
        parts.push(r);
        const next = node.kids[i + 1];
        if (typeof next === 'string') node.kids[i + 1] = next.replace(afterPunct, '');
      }
      return parts.join('');
    }

    // Il simbolo deve stare attaccato al testo: sposto fuori spazi e punteggiatura ai bordi.
    function wrap(inner, m) {
      const lead = inner.match(/^[\s,;:.!?)\]}]*/u)[0];
      const rest = inner.slice(lead.length);
      const trail = rest.match(/[\s(\[{«„“‘¿¡]*$/u)[0];
      const core = rest.slice(0, rest.length - trail.length);
      if (!core) return inner;
      const glue = lead && !/\s$/.test(lead) && /[,;:.!?]$/.test(lead) ? ' ' : '';
      return `${lead}${glue}${m}${core}${m}${trail}`;
    }

    function renderTag(n) {
      if (n.tag === 'code') { const t = textOf(n); codes.push(t); return '`' + t + '`'; }
      if (n.tag === 'span' && /translate\s*=\s*["']?no/i.test(n.attrs)) { const t = textOf(n); kept.push(t); return t; }
      const inner = render(n);
      const m = TAG2MARK[n.tag];
      return m ? wrap(inner, m) : inner;
    }

    const closeGap = isFr ? /(?<=\S[*_~`])[ \t ]+(?=[.,)\]}…%](?:\s|$))/gu
      : /(?<=\S[*_~`])[ \t ]+(?=[.,;:!?)\]}»”’…%](?:\s|$))/gu;
    let text = render(root).replace(closeGap, '').replace(/[ \t ]{2,}/g, ' ').trim();
    if (/^(ja|zh)/i.test(tl || '')) {
      // In giapponese e cinese niente spazi attaccati alla punteggiatura (、。！？…)
      text = text.replace(/[  ]+(?=[、。，．！？：；）」』】〉》])/gu, '').replace(/(?<=[、。，．！？：；（「『【〈《])[  ]+/gu, '');
    }
    return { text, counts: countTags(html), kept, codes };
  }

  // Riserva senza HTML: stringo "* testo *" in "*testo*" e rimetto i `codici` al loro posto.
  function fixPlain(text, item) {
    let s = text;
    for (const [m, tag] of MARKS) {
      if (!item.counts[tag]) continue;
      const E = reEsc(m);
      const re = new RegExp(`(^|[\\s(\\[{«„“"'¿¡])${E}[ \\t]+([^\\n]*?\\S)[ \\t]*${E}(?=$|[\\s.,;:!?)\\]}»”"'…])|(^|[\\s(\\[{«„“"'¿¡])${E}(\\S[^\\n]*?)[ \\t]+${E}(?=$|[\\s.,;:!?)\\]}»”"'…])`, 'gu');
      s = s.replace(re, (all, a1, c1, a2, c2) => (a1 !== undefined ? `${a1}${m}${c1}${m}` : `${a2}${m}${c2}${m}`));
    }
    for (const c of item.codes) {
      if (s.includes('`' + c + '`')) continue;
      const i = s.indexOf(c);
      if (i < 0) continue;
      let a = i;
      let b = i + c.length;
      const Q = /[„“”"«»‹›「」『』'‘’‚]/;
      if (a > 0 && /[  ]/.test(s[a - 1]) && a > 1 && Q.test(s[a - 2])) a -= 2;
      else if (a > 0 && Q.test(s[a - 1])) a -= 1;
      if (/[  ]/.test(s[b] || '') && Q.test(s[b + 1] || '')) b += 2;
      else if (Q.test(s[b] || '')) b += 1;
      s = s.slice(0, a) + '`' + c + '`' + s.slice(b);
    }
    return s;
  }

  // Ultima difesa: traduco solo i pezzi tra una parte protetta e l'altra.
  function segments(item) {
    const out = [];
    let last = 0;
    item.seg.replace(KEEP_PH, (m, i, at) => {
      out.push({ text: item.seg.slice(last, at) });
      out.push({ keep: item.kept[+i] });
      last = at + m.length;
      return m;
    });
    out.push({ text: item.seg.slice(last) });
    return out.map((p) => (p.keep !== undefined ? p : { ...p, tr: letters(p.text) > 0 }));
  }

  function joinSegments(parts, translated) {
    let j = 0;
    return parts.map((p) => {
      if (p.keep !== undefined) return p.keep;
      if (!p.tr) return p.text;
      const lead = p.text.match(/^\s*/)[0];
      const trail = p.text.match(/\s*$/)[0];
      return lead + String(translated[j++] || '').trim() + trail;
    }).join('');
  }

  // Prepara il messaggio: una voce per riga.
  function plan(lines, opts) {
    let inCode = false;
    return lines.map((text) => {
      if (/^\s*```/.test(text)) {
        const fences = (text.match(/```/g) || []).length;
        if (fences % 2 === 1) inCode = !inCode;
        return { text, keep: true };
      }
      if (inCode) return { text, keep: true };
      const prefix = (text.match(PREFIX_RE) || [''])[0];
      let rest = text.slice(prefix.length);
      const sm = rest.match(SUFFIX_RE);
      const suffix = sm ? sm[0] : '';
      if (suffix) rest = rest.slice(0, rest.length - suffix.length);
      const lead = rest.match(/^\s*/)[0];
      const body = rest.trim();
      const t = toHtml(body, opts);
      const free = t.seg.replace(KEEP_PH, '').replace(/`[^`\n]+`/g, '');
      if (letters(free) < 1) return { text, keep: true };   // solo link, nomi, numeri o emoji
      const fmt = TAGS.reduce((n, tag) => n + t.counts[tag], 0);
      return { text, keep: false, prefix: prefix + lead, body, suffix, ...t, fmt };
    });
  }

  function assemble(item, translated) {
    const t = translated.replace(/[​﻿]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    return item.prefix + t + item.suffix;
  }

  function parseList(str) {
    return [...new Set(String(str || '').split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x.length >= 2))];
  }

  // Nomi da un titolo di chat ("Sven Larsson") -> parole con la maiuscola.
  function nameTokens(str) {
    return (String(str || '').match(/\p{Lu}[\p{L}\p{M}'’-]+/gu) || []).filter((w) => !STOP.has(w.toLowerCase()));
  }

  const api = {
    plan, toHtml, fromHtml, fixPlain, sameCounts, sameList, hasAll, segments, joinSegments,
    assemble, countTags, parseList, nameTokens, protect
  };
  g.PG_FMT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
