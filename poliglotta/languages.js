// Elenco lingue e utilità condivise tra content script e popup.
(function (g) {
  'use strict';

  // Codici usati da Google Translate.
  const CODES = [
    'it', 'en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'ro', 'ru', 'uk', 'cs', 'sk', 'hu',
    'el', 'tr', 'ar', 'iw', 'fa', 'ur', 'hi', 'bn', 'pa', 'zh-CN', 'zh-TW', 'ja', 'ko',
    'vi', 'th', 'id', 'ms', 'tl', 'sv', 'da', 'no', 'fi', 'et', 'lv', 'lt', 'sl', 'hr',
    'sr', 'bs', 'bg', 'sq', 'mk', 'ca', 'eu', 'gl', 'ga', 'cy', 'is', 'mt', 'lb', 'af',
    'sw', 'am', 'so', 'ha', 'yo', 'zu', 'az', 'ka', 'hy', 'kk', 'uz', 'ky', 'mn', 'ne',
    'si', 'ta', 'te', 'ml', 'kn', 'mr', 'gu', 'km', 'lo', 'my'
  ];

  // Codici storici di Google -> codici standard.
  const ALIAS = { iw: 'he', jw: 'jv', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };

  let names = null;
  try { names = new Intl.DisplayNames(['it'], { type: 'language' }); } catch (e) { names = null; }

  function name(code) {
    if (!code) return '';
    try {
      const n = names && names.of(ALIAS[code] || code);
      if (n && n.toLowerCase() !== code.toLowerCase()) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* codice sconosciuto */ }
    return code.toUpperCase();
  }

  // Lingua base: 'pt-PT' -> 'pt', 'iw' -> 'he'. Il cinese tiene la variante.
  function base(code) {
    if (!code) return '';
    if (/^zh/i.test(code)) return /tw|hant|hk/i.test(code) ? 'zh-TW' : 'zh-CN';
    const c = code.split('-')[0].toLowerCase();
    return c === 'iw' ? 'he' : c === 'jw' ? 'jv' : c;
  }

  function sameLang(a, b) {
    if (!a || !b) return false;
    return base(a) === base(b);
  }

  // Codice da passare a Google (accetta sia 'he' che 'iw').
  function google(code) {
    const b = base(code);
    return b === 'he' ? 'iw' : b;
  }

  function short(code) {
    return base(code).replace('zh-CN', 'ZH').replace('zh-TW', 'ZH-TW').toUpperCase();
  }

  function sortedCodes(exclude) {
    return CODES.filter((c) => !sameLang(c, exclude))
      .sort((a, b) => name(a).localeCompare(name(b), 'it'));
  }

  g.PG_LANGS = { CODES, name, base, sameLang, google, short, sortedCodes };
})(globalThis);
