// Nakupko v več jezikih: prevede besedila na zaslonu (slovenska koda ostane nespremenjena).
//
// Jezik: ročna izbira v Nastavitvah, sicer samodejno po državi, v kateri je telefon (drzave.js),
// in ne po jeziku telefona. Dokler države še ne poznamo, jezik telefona (če prevod obstaja).
// Če za jezik države prevoda še ni, angleščina.
//
// Prevodi so v i18n/xx.js (en jezik = ena datoteka, ključi so slovenska besedila); nov jezik dodaš
// z novo datoteko in vrstico v PACKS. Pogon (tr, opazovanje strani, pogovorna okna) je skupen.
(function () {
  "use strict";
  var KEY = "nakupko-lang", CKEY = "nakupko-country";
  // Jeziki s prevodom (ime v izbiri jezika).
  var PACKS = { sl: "Slovenščina", en: "English", de: "Deutsch", hr: "Hrvatski", it: "Italiano", hu: "Magyar", fr: "Français", es: "Español" };
  // Jeziki, ki imajo imena izdelkov v svojem jeziku (i18n/products-xx.js); drugje angleška imena.
  var PRODUCT_PACKS = { de: 1, hr: 1 };
  // Sorodni jeziki, dokler nimajo svojega prevoda.
  var ALIAS = { bs: "hr", sr: "hr", cnr: "hr" };
  function supported(l) {
    l = String(l || "").toLowerCase().replace(/[^a-z].*$/, "");
    return PACKS[l] ? l : (ALIAS[l] || null);
  }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* nič */ } }
  function countryLang(c) {
    var db = window.NAKUPKO_DRZAVE, d = db && db.drzave && db.drzave[c];
    if (!c || !db) return null;
    return supported((d && d.jezik) || (db.privzeto && db.privzeto.jezik)) || "en";
  }
  // Država, v kateri je telefon: zapiše jo aplikacija ob nalaganju trgovin.
  function country() {
    var c = get(CKEY);
    if (c) return c;
    try { var st = JSON.parse(get("nakupko-v2") || "null"); return (st && st.storesCache && st.storesCache.country) || null; } catch (e) { return null; }
  }
  function autoLang() {
    var c = country();
    if (c && c !== "XX") return countryLang(c);
    return supported((navigator.languages && navigator.languages[0]) || navigator.language) || "en";
  }
  var saved = get(KEY);
  var MODE = saved && PACKS[saved] ? saved : "auto";
  var LANG = MODE === "auto" ? autoLang() : MODE;
  window.NK_LANG = LANG;
  window.NK_LANG_MODE = MODE;
  window.NK_LANGS = PACKS;
  window.NK_SET_LANG = function (l) {
    set(KEY, l === "auto" ? null : l);
    location.reload();
  };
  // Aplikacija je ugotovila državo: v samodejnem načinu po potrebi preklopi jezik (stran se naloži znova).
  // canReload = false (npr. med nakupovanjem): jezik se zamenja ob naslednjem odprtju.
  window.NK_COUNTRY = function (c, canReload) {
    if (!c || c === "XX") return false;
    if (get(CKEY) !== c) set(CKEY, c);
    if (MODE !== "auto") return false;
    if ((countryLang(c) || "en") === LANG || !canReload) return false;
    location.reload();
    return true;
  };
  window.NK_T = function (s) { return s; };
  if (LANG === "sl") return;
  document.documentElement.lang = LANG;

  var EXACT = {}, RULES = [], PROD = {};
  function word(s) { return EXACT[s] || PROD[s] || s; }
  function prodBrand(s) {
    var m = s.match(/^(.+?) \((.+)\)$/);
    return m && PROD[m[1]] ? PROD[m[1]] + " (" + m[2] + ")" : null;
  }
  function tr(s) {
    if (!s) return s;
    var t = s.trim();
    if (!t) return s;
    var out = EXACT[t] || PROD[t] || prodBrand(t);
    if (!out) {
      for (var i = 0; i < RULES.length; i++) {
        var m = t.match(RULES[i][0]);
        if (m) { out = typeof RULES[i][1] === "function" ? RULES[i][1](m) : t.replace(RULES[i][0], RULES[i][1]); break; }
      }
    }
    if (!out || out === t) return s;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + out + trail;
  }
  window.NK_T = tr;

  // Paket jezika (i18n/xx.js) se prijavi tukaj.
  window.NK_PACK = function (lang, make) {
    if (lang !== LANG) return;
    var p = make({ tr: tr, word: word });
    EXACT = p.exact || {};
    RULES = p.rules || [];
    // Izdelki: products-i18n.js ima angleška imena; paket vrne ime v svojem jeziku.
    var I18N = window.NAKUPKO_I18N || {};
    Object.keys(I18N).forEach(function (k) { var v = p.prod ? p.prod(k, I18N[k]) : null; if (v) PROD[k] = v; });
    if (!PRODUCT_PACKS[LANG]) { if (document.body) start(); else document.addEventListener("DOMContentLoaded", start); }
  };
  // Imena izdelkov v jeziku države (i18n/products-xx.js) imajo prednost pred angleškimi.
  window.NK_PRODUCTS = function (lang, map) {
    if (lang !== LANG) return;
    Object.keys(map || {}).forEach(function (k) { PROD[k] = map[k]; });
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  };
  // Paket naložimo takoj (pred app.js), da se stran ne pokaže najprej v slovenščini.
  document.write('<script src="i18n/' + LANG + '.js"><\/script>');
  if (PRODUCT_PACKS[LANG]) document.write('<script src="i18n/products-' + LANG + '.js"><\/script>');

  var ATTRS = ["placeholder", "aria-label", "title"];
  var busy = false;
  function walk(root) {
    if (root.nodeType === 3) {
      var v = root.nodeValue, n = tr(v);
      if (n !== v) root.nodeValue = n;
      return;
    }
    if (root.nodeType !== 1 || root.tagName === "SCRIPT" || root.tagName === "STYLE") return;
    for (var a = 0; a < ATTRS.length; a++) {
      var av = root.getAttribute && root.getAttribute(ATTRS[a]);
      if (av) { var an = tr(av); if (an !== av) root.setAttribute(ATTRS[a], an); }
    }
    // vnosna polja: prevedemo le namig, ne vsebine
    if (root.tagName === "INPUT" || root.tagName === "TEXTAREA") return;
    for (var c = root.firstChild; c; c = c.nextSibling) walk(c);
  }
  function run(muts) {
    if (busy) return;
    busy = true;
    try {
      if (!muts) walk(document.body);
      else muts.forEach(function (m) {
        if (m.type === "characterData") walk(m.target);
        else if (m.type === "attributes") walk(m.target);
        else for (var i = 0; i < m.addedNodes.length; i++) walk(m.addedNodes[i]);
      });
    } finally { busy = false; }
  }
  var started = false, observer = null;
  function start() {
    if (started) return;
    started = true;
    document.title = tr(document.title);
    run();
    if (!observer) {
      observer = new MutationObserver(run);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
  }

  // Pogovorna okna
  var _c = window.confirm, _a = window.alert, _p = window.prompt;
  window.confirm = function (m) { return _c.call(window, tr(String(m))); };
  window.alert = function (m) { return _a.call(window, tr(String(m))); };
  window.prompt = function (m, d) { return _p.call(window, tr(String(m)), d); };
})();
