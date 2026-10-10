(function () {
  "use strict";

  // ---------- Osnovni podatki ----------
  var CHAINS = [
    { key: "spar", name: "Spar", factor: 1.0, color: "#2E9D4A", match: /spar|interspar/i },
    { key: "mercator", name: "Mercator", factor: 1.04, color: "#D9372B", match: /mercator|hipermarket m|mere/i },
    { key: "tus", name: "Tuš", factor: 1.02, color: "#E8792B", match: /tu[sš]\b|tus |tuš/i },
    { key: "lidl", name: "Lidl", factor: 0.87, color: "#1F5FBF", match: /lidl/i },
    { key: "hofer", name: "Hofer", factor: 0.86, color: "#2B3A78", match: /hofer|aldi/i },
    { key: "eurospin", name: "Eurospin", factor: 0.85, color: "#2B8FD6", match: /eurospin/i },
    { key: "jager", name: "Jager", factor: 1.0, color: "#8A5A2B", match: /jager/i },
    { key: "leclerc", name: "E.Leclerc", factor: 0.96, color: "#0066B3", match: /leclerc/i, hours: "Mo-Sa 08:00-21:00; Su off; PH off" },
    // Specializirane trgovine: zaznamo jih le, ko imaš na seznamu izdelke zanje (only).
    { key: "babycenter", name: "Baby Center", factor: 1.05, color: "#E86A9A", match: /baby ?cent(er|ar)/i, only: /^otroci |plenic|robčk/i },
    { key: "mrpet", name: "Mr. Pet", factor: 1.0, color: "#C4572B", match: /mr\.? ?pet\b/i, only: /^ljubljenčki /i },
    { key: "premiumpet", name: "Premium Pet", factor: 1.0, color: "#3E6B8A", match: /premium ?pet\b/i, only: /^ljubljenčki /i },
    { key: "obi", name: "OBI", factor: 1.0, color: "#F18E00", match: /\bobi\b/i, only: /^dom in vrt /i },
    { key: "bauhaus", name: "Bauhaus", factor: 0.98, color: "#C8102E", match: /bauhaus/i, only: /^dom in vrt /i },
    { key: "merkur", name: "Merkur", factor: 1.02, color: "#0B4EA2", match: /merkur/i, only: /^dom in vrt /i },
    { key: "kalcer", name: "Kalcer", factor: 1.0, color: "#5B7F2B", match: /kalcer/i, only: /^dom in vrt /i },
    // Tobak: trafike in bencinske servise predlagamo, ko imaš na seznamu samo tobak.
    { key: "trafika", name: "Trafika", factor: 1.0, color: "#6D4C41", match: /trafik|3dva|tobačn|tobacn/i, only: /^tobak /i, hours: "Mo-Fr 07:00-19:00; Sa 07:00-13:00; Su off; PH off" },
    { key: "kiosk", name: "Kiosk", factor: 1.0, color: "#8D6E63", match: /(?!)/, only: /^tobak /i },
    { key: "bencinska", name: "Bencinski servis", factor: 1.0, color: "#00A651", match: /\bpetrol\b|\bomv\b|\bmol\b|shell|lukoil|\bagip\b|\beni\b|bencinsk/i, only: /^tobak /i, hours: "Mo-Su 06:00-22:00; PH 06:00-22:00" },
    { key: "proteini", name: "Proteini.si", factor: 1.0, color: "#E30613", match: /proteini\.?si/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "thenutrition", name: "THE Nutrition", factor: 1.0, color: "#111111", match: /the ?nutrition/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "maxximum", name: "Maxximum", factor: 1.0, color: "#F2A900", match: /maxximum/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "dm", name: "dm", factor: 1.0, color: "#2A4B9B", match: /^dm\b|dm[ -]drogerie|dm drogerija/i, only: /^(higiena|gospodinjstvo|otroci|zdravje|brez glutena|ljubljenčki) |protein|pralni|detergent|mehčal/i },
    { key: "muller", name: "Müller", factor: 1.02, color: "#F39200", match: /m[uü]ller/i, only: /^(higiena|gospodinjstvo|otroci|zdravje) |pralni|detergent|mehčal/i }
  ];
  // ---------- Pravila države (drzave.js): jezik, kje so cigarete, nedelje, vir cen ----------
  var DRZAVE = window.NAKUPKO_DRZAVE || { privzeto: {}, drzave: {} };
  (function () {
    // Najnovejša baza s strežnika (shranjena ob prejšnjem zagonu) ima prednost pred vgrajeno.
    try { var d = JSON.parse(localStorage.getItem("nakupko-drzave") || "null"); if (d && d.drzave && d.verzija >= (DRZAVE.verzija || "")) DRZAVE = d; } catch (e) { /* vgrajena */ }
  })();
  function refreshDrzave() {
    fetch("https://myedgeofficial.github.io/nakupko/drzave.js?d=" + new Date().toISOString().slice(0, 10), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) {
        if (!t) return;
        var d = JSON.parse(t.slice(t.indexOf("{", t.indexOf("=")), t.lastIndexOf("}") + 1));
        if (!d || !d.drzave || !d.privzeto || d.verzija < (DRZAVE.verzija || "")) return;
        DRZAVE = d;
        try { localStorage.setItem("nakupko-drzave", JSON.stringify(d)); } catch (e) { /* poln */ }
      })
      .catch(function () { /* brez povezave: ostane shranjena */ });
  }
  function countryCode() { return (state && state.storesCache && state.storesCache.country) || "SI"; }
  function rules(c) { c = c || countryCode(); return Object.assign({}, DRZAVE.privzeto, (DRZAVE.drzave || {})[c] || {}); }
  // Vrsta prodajalne za tobak: trafika, kiosk, bencinska ali trgovina (supermarket).
  function tobaccoKind(s) { var k = s && s.chain; return k === "trafika" || k === "kiosk" || k === "bencinska" ? k : "trgovina"; }
  function sellsTobacco(s) { return (rules().tobak || []).indexOf(tobaccoKind(s)) >= 0; }
  // Ali trgovina prodaja izdelek: specializirane samo svoje, običajne vse razen orodja in vrta.
  // Cigarete le tam, kjer jih v tej državi smejo prodajati (npr. na Madžarskem samo v trafiki).
  function sells(s, it) {
    var c = CHAIN_BY_KEY[s && s.chain], t = (it.cat || "") + " " + it.name, o = c && onlyOf(c);
    if (/^tobak /i.test(t) && s && !sellsTobacco(s)) return false;
    return o ? o.test(t) : !/^dom in vrt /i.test(t);
  }
  // Ali izdelek kupiš v tej trgovini: dodeljen trgovini (it.store = veriga, npr. »dm«) le tam;
  // nedodeljen v vsaki trgovini, ki ga prodaja. Enako forStore/wants na iPhonu.
  function forStore(s, it) {
    if (!s) return true;
    if (it.store) return it.store === s.chain || it.store === s.id;
    return sells(s, it);
  }
  // Ob nedeljah in praznikih so trgovine zaprte: bencinski servis takrat šteje tudi za pijačo in prigrizke.
  var FUEL_DAY_ONLY = /^(tobak|pijače|prigrizki) /i;
  // Dan, ko so trgovine zaprte: v Sloveniji nedelje in prazniki; drugje nedelje, če so tam zaprte (drzave.js).
  function fuelDay(dt) {
    dt = dt || new Date();
    if (countryCode() !== "SI") return dt.getDay() === 0 && rules().nedelja === "zaprto";
    return dt.getDay() === 0 || isHoliday(dt);
  }
  function onlyOf(c) { return c.key === "bencinska" && fuelDay() ? FUEL_DAY_ONLY : c.only; }
  // Izdelki za drugo trgovino: zloženi na dnu seznama.
  function otherSection(items, big, storeCtx) {
    var sub = el("ul", { class: "list" + (big ? " big" : "") });
    items.forEach(function (it) { sub.appendChild(itemRow(it, big, storeCtx)); });
    return el("li", { class: "other" }, [el("details", { class: "more" }, [el("summary", { text: "Iz druge trgovine rabiš še (" + items.length + ")" }), sub])]);
  }
  // Zunaj Slovenije verig ne poznamo: trgovino zaznamo po vrsti iz OpenStreetMap (oznaka shop).
  var NEVER = /$^/;
  CHAINS.push(
    { key: "trgovina", name: "Trgovina", factor: 1.0, color: "#8A3FFC", match: NEVER },
    { key: "zelenjava", name: "Sadje in zelenjava", factor: 1.0, color: "#5B8C2A", match: NEVER, only: /^sadje in zelenjava /i },
    { key: "zivali", name: "Trgovina za živali", factor: 1.0, color: "#C4572B", match: NEVER, only: /^ljubljenčki /i },
    { key: "otroska", name: "Otroška trgovina", factor: 1.0, color: "#E86A9A", match: NEVER, only: /^otroci |plenic|robčk/i },
    { key: "dom", name: "Dom in vrt", factor: 1.0, color: "#F18E00", match: NEVER, only: /^dom in vrt /i },
    { key: "drogerija", name: "Drogerija", factor: 1.0, color: "#2A4B9B", match: NEVER, only: /^(higiena|gospodinjstvo|otroci|zdravje) |pralni|detergent|mehčal/i }
  );
  var ABROAD_SHOP = {
    supermarket: "trgovina", convenience: "trgovina", grocery: "trgovina", discount: "trgovina", greengrocer: "zelenjava",
    pet: "zivali", baby_goods: "otroska", doityourself: "dom", hardware: "dom", garden_centre: "dom", chemist: "drogerija",
    tobacco: "trafika", kiosk: "kiosk", newsagent: "kiosk"
  };
  // Groba meja Slovenije (lat, lon, ...), le kadar OpenStreetMap države ne vrne.
  var SI_BORDER = [45.46,13.64,45.49,13.59,45.52,13.6,45.54,13.57,45.55,13.75,45.59,13.71,45.58,13.85,45.63,13.89,45.65,13.86,45.74,13.78,45.81,13.58,45.86,13.57,45.97,13.62,45.99,13.61,45.97,13.51,46.01,13.46,46.07,13.51,46.13,13.62,46.16,13.65,46.18,13.64,46.18,13.56,46.22,13.47,46.23,13.42,46.21,13.44,46.21,13.41,46.29,13.37,46.35,13.43,46.39,13.53,46.44,13.6,46.45,13.68,46.52,13.7,46.48,14.05,46.44,14.15,46.44,14.41,46.41,14.45,46.42,14.5,46.38,14.54,46.43,14.59,46.46,14.68,46.49,14.71,46.51,14.79,46.6,14.85,46.62,14.93,46.6,14.97,46.64,15.0,46.65,15.06,46.65,15.39,46.61,15.46,46.63,15.51,46.67,15.55,46.68,15.63,46.72,15.64,46.7,15.73,46.72,15.85,46.67,16.02,46.74,15.97,46.82,15.97,46.86,16.09,46.86,16.27,46.84,16.33,46.78,16.3,46.69,16.37,46.69,16.41,46.67,16.41,46.64,16.37,46.63,16.38,46.54,16.5,46.5,16.52,46.55,16.34,46.49,16.23,46.4,16.25,46.37,16.28,46.37,16.19,46.39,16.14,46.37,16.11,46.38,16.06,46.33,16.06,46.3,16.02,46.26,15.82,46.21,15.75,46.22,15.66,46.19,15.62,46.11,15.59,46.04,15.7,45.99,15.67,45.89,15.66,45.84,15.68,45.82,15.63,45.82,15.45,45.78,15.43,45.72,15.26,45.71,15.25,45.68,15.28,45.68,15.33,45.64,15.37,45.63,15.3,45.6,15.27,45.52,15.3,45.48,15.36,45.45,15.33,45.43,15.14,45.48,15.06,45.51,14.92,45.51,14.9,45.47,14.88,45.47,14.8,45.49,14.78,45.53,14.67,45.56,14.67,45.6,14.6,45.67,14.58,45.6,14.5,45.53,14.47,45.48,14.37,45.5,14.22,45.47,14.09,45.51,13.97,45.49,13.96,45.48,13.98,45.42,13.89,45.46,13.76];
  function inSlovenia(lat, lon) {
    var c = false, n = SI_BORDER.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var yi = SI_BORDER[i], xi = SI_BORDER[i + 1], yj = SI_BORDER[j], xj = SI_BORDER[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  var CHAIN_BY_KEY = {};
  CHAINS.forEach(function (c) { CHAIN_BY_KEY[c.key] = c; });
  var COMPARE_CHAINS = ["spar", "mercator", "tus", "lidl", "hofer"];
  var CAT_META = {
    "Sadje in zelenjava": ["🥦", "#E3F3DF"], "Kruh in pecivo": ["🥖", "#F7EBDA"], "Mlečni izdelki": ["🥛", "#E4EEF8"],
    "Meso in ribe": ["🥩", "#F8E3E1"], "Shramba": ["🥫", "#F4E9DC"], "Prigrizki": ["🍫", "#F1E6F4"], "Pijače": ["🥤", "#DFF1F3"],
    "Zamrznjeno": ["🧊", "#E3ECF8"], "Gospodinjstvo": ["🧽", "#EEF0D9"], "Higiena": ["🧴", "#E9E6F6"], "Tobak": ["🚬", "#ECE7E2"], "Brez glutena": ["🌾", "#FBEFD9"], "Otroci": ["🍼", "#FDE8EF"], "Zdravje": ["💊", "#E6F4EE"],
    "Ljubljenčki": ["🐾", "#F6ECDD"], "Športna prehrana": ["💪", "#FCE8E6"], "Dom in vrt": ["🔨", "#E8EDE2"], "Drugo": ["🛒", "#E9EEEA"]
  };
  function chainDot(c) { return el("i", { class: "dot", style: "background:" + ((CHAIN_BY_KEY[c] || {}).color || "#999") }); }

  var CATALOG = (window.NAKUPKO_PRODUCTS || []).map(function (p) {
    return { name: p[0], cat: p[1], brands: p[2] || [], base: p[3], unit: p[4] || "", fixed: !!p[5] };
  });
  var CATALOG_BY_KEY = {};
  CATALOG.forEach(function (p) { CATALOG_BY_KEY[norm(p.name)] = p; });
  // Angleška imena izdelkov (products-i18n.js): iskanje deluje v obeh jezikih.
  var I18N = window.NAKUPKO_I18N || {};
  CATALOG.forEach(function (p) { p.en = I18N[p.name] ? norm(I18N[p.name][0]) : ""; });
  // Ime v jeziku aplikacije (i18n.js, npr. »Milch« v Avstriji): iskanje deluje tudi v jeziku države.
  CATALOG.forEach(function (p) { var t = window.NK_T ? norm(window.NK_T(p.name)) : ""; p.loc = t && t !== norm(p.name) && t !== p.en ? t : ""; });
  function catalogFind(name) {
    var k = norm(name);
    return CATALOG_BY_KEY[k] || CATALOG.filter(function (p) { return (p.en && p.en === k) || (p.loc && p.loc === k); })[0] || null;
  }

  var DEFAULT_QUICK = ["Mleko", "Kruh beli", "Jajca", "Banane", "Jogurt navadni", "Maslo", "Voda", "Toaletni papir", "Kava mleta", "Paradižnik"];
  var DAY = 86400000;
  var STORE_KEY = "nakupko-v2";

  // ---------- Stanje ----------
  var state = load();
  function defaults() {
    return {
      items: [],
      history: [],
      usage: {},
      usageNames: {},
      prices: {},
      pricesUpdated: null,
      settings: { locOn: true, locDefault2: true, detect30: true, radius: 30, delay: 15 },
      storesCache: null,
      dismissed: {},
      dismissN: {}
    };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === null) s[k] = d[k]; });
        var migrate = !(s.settings && s.settings.locDefault2);
        s.settings = Object.assign({}, d.settings, s.settings);
        // Samodejno zaznavanje je privzeto vklopljeno (tudi za obstoječe uporabnike, enkrat).
        if (migrate) { s.settings.locOn = true; s.settings.locDefault2 = true; }
        // Novo zaznavanje (enkrat): prihod pri ~30 m in ~15 s (prej 75 m, napačni prihodi v mimovožnji).
        if (!s.settings.detect30) { s.settings.radius = 30; s.settings.delay = 15; s.settings.detect30 = true; }
        return s;
      }
    } catch (e) { /* prazno stanje */ }
    return d;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("Shranjevanje ni uspelo (poln pomnilnik brskalnika)."); }
    if (window.__nakupkoAfterSave) window.__nakupkoAfterSave(); // skupen seznam (household.js)
  }

  // ---------- Pomočniki ----------
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function eur(v) {
    if (v == null || isNaN(v)) return "–";
    if (moneyScale() > 1) return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " Ft";
    return v.toFixed(2).replace(".", ",") + " €";
  }
  function capital(s) { s = String(s).trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function parseQty(s) {
    var n = parseFloat(String(s || "1").replace(",", "."));
    return isFinite(n) && n > 0 ? n : 1;
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }
  function distM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km"; }
  function chainOf(text) {
    for (var i = 0; i < CHAINS.length; i++) if (CHAINS[i].match.test(text || "")) return CHAINS[i].key;
    return null;
  }

  // Prikažemo samo prave trgovine: velike verige in dežurne trgovine (Korenček, Betka, Market Ekspres ...).
  var DUTY_MATCH = /koren[cč]ek|betka|ekspres|de[zž]urn|non ?-?stop/i;
  function storeKind(text, hours) {
    var c = chainOf(text);
    if (c) return c;
    if (DUTY_MATCH.test(text || "") || /24\/7/.test(hours || "")) return "duty";
    return null;
  }
  function allowedStore(s) { return s && s.id && (s.id.indexOf("test/") === 0 || !!(s.chain || s.duty)); }

  // ---------- Delovni čas ----------
  // Razume običajen OSM zapis, npr. "Mo-Sa 07:00-21:00; Su off; PH off".
  var DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  var DAY_SL = ["v nedeljo", "v ponedeljek", "v torek", "v sredo", "v četrtek", "v petek", "v soboto"];
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mon = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mon - 1, day);
  }
  // Slovenski dela prosti dnevi (trgovine so po zakonu zaprte).
  function isHoliday(dt) {
    var md = (dt.getMonth() + 1) + "-" + dt.getDate();
    if (["1-1", "1-2", "2-8", "4-27", "5-1", "5-2", "6-25", "8-15", "10-31", "11-1", "12-25", "12-26"].indexOf(md) >= 0) return true;
    var e = easter(dt.getFullYear()), em = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
    return dt.getMonth() === em.getMonth() && dt.getDate() === em.getDate();
  }
  function parseHours(str) {
    str = (str || "").trim();
    if (!str) return null;
    if (/^24\/7$/.test(str)) return { always: true };
    var days = {}, ph = null, ok = false;
    // Pravila so ločena s ";" ali z vejico pred novim naborom dni ("Mo-Fr 07:00-20:00, Sa 07:00-13:00").
    var raw = str.split(/\s*;\s*|\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s+(?:\d|off|closed))/), rules = [];
    for (var q = 0; q < raw.length; q++) {
      if (/^(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+$/.test(raw[q]) && q + 1 < raw.length) raw[q + 1] = raw[q] + "," + raw[q + 1];
      else rules.push(raw[q]);
    }
    for (var r = 0; r < rules.length; r++) {
      var m = rules[r].match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)\s*(.*)$/);
      var sel, times;
      if (m) { sel = m[1]; times = m[2].trim(); }
      else if (/^\d/.test(rules[r])) { sel = "Mo-Su"; times = rules[r].trim(); }
      else continue;
      var spans = [];
      if (!/^(off|closed)$/i.test(times)) {
        var parts = times.split(/\s*,\s*/);
        for (var p = 0; p < parts.length; p++) {
          var t = parts[p].match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
          if (!t) { spans = null; break; }
          spans.push([+t[1] * 60 + +t[2], +t[3] * 60 + +t[4]]);
        }
        if (!spans) continue;
      }
      ok = true;
      sel.split(/\s*,\s*/).forEach(function (tok) {
        tok = tok.trim(); if (!tok) return;
        if (tok === "PH") { ph = spans; return; }
        var ab = tok.split("-"), a = DAYS.indexOf(ab[0]), b = ab[1] ? DAYS.indexOf(ab[1]) : a;
        if (a < 0 || b < 0) return;
        for (var d = a, n = 0; n < 7; d = (d + 1) % 7, n++) { days[d] = spans; if (d === b) break; }
      });
    }
    return ok ? { days: days, ph: ph } : null;
  }
  // Če trgovina urnika nima vpisanega: verige so ob nedeljah in praznikih zaprte, sicer predpostavimo, da je odprto.
  var CHAIN_DEFAULT_HOURS = "Mo-Sa 07:00-21:00; Su off; PH off";
  // Uradni odpiralni časi trgovin (hours.json, osveženo vsako noč s strani trgovin); OSM je pogosto zastarel.
  var OFFICIAL = [], OFFICIAL_DATE = "", officialMemo = {};
  function useOfficial(d) {
    if (!d || !d.trgovine) return;
    OFFICIAL = d.trgovine; OFFICIAL_DATE = d.datum || ""; officialMemo = {};
  }
  try { useOfficial(JSON.parse(localStorage.getItem("nakupko-hours") || "null")); } catch (e) { /* nič */ }
  function officialHours(s) {
    if (!s || !s.chain || !OFFICIAL.length || s.lat == null) return null;
    var k = s.chain + "|" + s.lat + "|" + s.lon;
    if (officialMemo.hasOwnProperty(k)) return officialMemo[k];
    var best = null, bd = 1e9;
    OFFICIAL.forEach(function (t) {
      if (t.v !== s.chain) return;
      var dLat = (t.lat - s.lat) * 111320, dLon = (t.lon - s.lon) * 111320 * Math.cos(s.lat * Math.PI / 180);
      var d = Math.sqrt(dLat * dLat + dLon * dLon);
      // koordinate iz naslova so manj natančne
      if (d < bd && d <= (t.g ? 400 : 250)) { bd = d; best = t; }
    });
    return (officialMemo[k] = best ? best.h : null);
  }
  function applyOfficial(list) {
    (list || []).forEach(function (s) { var h = officialHours(s); if (h) { s.hours = h; s.official = true; } });
  }
  function refreshOfficial() {
    if (!window.fetch) return;
    fetch("https://myedgeofficial.github.io/nakupko/hours.json?d=" + new Date().toISOString().slice(0, 10), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.trgovine || !d.trgovine.length) return;
        var raw = JSON.stringify(d), prev = null;
        try { prev = localStorage.getItem("nakupko-hours"); } catch (e) { /* nič */ }
        if (raw === prev) return;
        try { localStorage.setItem("nakupko-hours", raw); } catch (e) { /* poln */ }
        useOfficial(d);
        applyOfficial(stores);
        if (state.storesCache) { state.storesCache.list = stores; save(); }
        renderAll();
      })
      .catch(function () { /* brez povezave */ });
  }
  function spansFor(s, dt) {
    // V tujini ne ugibamo urnika in ne upoštevamo slovenskih praznikov.
    var h = parseHours(officialHours(s) || s.hours || (s.chain && !s.tuj ? CHAIN_DEFAULT_HOURS : ""));
    if (h && h.always) return [[0, 1440]];
    var hol = !s.tuj && isHoliday(dt), dow = dt.getDay();
    if (h) {
      if (hol && h.ph !== null) return h.ph;
      if (hol && s.chain) return [];
      return h.days.hasOwnProperty(dow) ? h.days[dow] : [];
    }
    return null;
  }
  // Vrne {open: true/false/null, text: "Odprto do 21:00" | "Zaprto · odpre ob 7:30"}.
  function hm(m) { return Math.floor(m / 60) + ":" + ("0" + (m % 60)).slice(-2); }
  function openState(s, now) {
    var r = openState0(s, now);
    // Za verige brez vpisanega urnika uporabimo običajni delovni čas.
    if (s.chain && !s.tuj && !s.hours && !officialHours(s) && r.open !== null) r.text += " (okvirno)";
    return r;
  }
  function openState0(s, now) {
    now = now || new Date();
    var spans = spansFor(s, now);
    if (spans === null) return { open: null, text: s.hours || "Urnik ni znan" };
    var mins = now.getHours() * 60 + now.getMinutes();
    for (var i = 0; i < spans.length; i++) {
      var a = spans[i][0], b = spans[i][1];
      if (b <= a) b += 1440;
      if (mins >= a && mins < b) return { open: true, text: b - a >= 1440 ? "Odprto 24 ur" : "Odprto do " + hm(b % 1440) };
    }
    // Kdaj se odpre?
    for (var k = 0; k < 8; k++) {
      var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
      var sp = spansFor(s, dt) || [];
      var starts = sp.map(function (x) { return x[0]; }).filter(function (x) { return k > 0 || x > mins; }).sort(function (x, y) { return x - y; });
      if (starts.length) return { open: false, text: "Zaprto · odpre " + (k === 0 ? "ob " : k === 1 ? "jutri ob " : DAY_SL[dt.getDay()] + " ob ") + hm(starts[0]) };
    }
    return { open: false, text: "Zaprto" };
  }

  // ---------- Cene ----------
  // Vrne {price, est} za izdelek v verigi. Uvožene cene imajo prednost; če za verigo ni cene,
  // vzamemo povprečje uvoženih cen drugih trgovin; sicer oceno iz kataloga.
  // Cene, ki jih je Nakupko poiskal na spletu (prices.js); uvožene cene jih prepišejo.
  // Cene se osvežijo vsako noč; aplikacija (tudi iPhone/Android) si sveže prenese sama.
  var BASE_PRICES = {}, PRICES_DATE = "";
  var SALE_PRICES = {};
  function useBasePrices(data) {
    if (!data || !data.izdelki) return;
    BASE_PRICES = {}; SALE_PRICES = {}; PRICES_DATE = data.datum || "";
    data.izdelki.forEach(function (e) {
      var rec = {};
      Object.keys(e.cene || {}).forEach(function (c) { if (typeof e.cene[c] === "number" && e.cene[c] > 0) rec[c] = e.cene[c]; });
      // cene po znamki (npr. Energijska pijača · Red Bull) imajo ključ »ime|znamka«
      var k = norm(e.ime) + (e.znamka ? "|" + norm(e.znamka) : "");
      if (Object.keys(rec).length) BASE_PRICES[k] = rec;
      // akcijska cena (cene so vedno redne; akcija se pokaže posebej)
      if (e.akcija && !Array.isArray(e.akcija)) SALE_PRICES[k] = e.akcija;
    });
  }
  var PRICES_URL = "https://myedgeofficial.github.io/nakupko/prices.json";
  (function () {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem("nakupko-prices") || "null"); } catch (e) { /* nič */ }
    var bundled = window.NAKUPKO_PRICES;
    useBasePrices(cached && (!bundled || (cached.datum || "") > (bundled.datum || "")) ? cached : bundled);
  })();
  function refreshPrices() {
    if (!window.fetch) return;
    fetch(PRICES_URL + "?d=" + new Date().toISOString().slice(0, 13), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // isti dan se cene lahko osvežijo večkrat: sprejmi tudi enak datum, če so podatki drugačni
        if (!d || !d.izdelki || (d.datum || "") < PRICES_DATE) return;
        var raw = JSON.stringify(d), prev = null;
        try { prev = localStorage.getItem("nakupko-prices"); } catch (e) { /* nič */ }
        if (raw === prev) return;
        try { localStorage.setItem("nakupko-prices", raw); } catch (e) { /* poln */ }
        useBasePrices(d);
        renderAll();
      })
      .catch(function () { /* brez povezave */ });
  }
  // ---------- Cene v sosednjih državah ----------
  // Avstrija, Hrvaška in Madžarska objavljajo cene zastonj; nočna osvežitev jih shrani v prices-xx.json.
  // Drugje v tujini cen ne pišemo, samo seznam in zaznavanje trgovin.
  // Države z vključenim virom cen (drzave.js: cene); drugje le trgovine, brez cen.
  var FOREIGN_LANDS = {};
  Object.keys(DRZAVE.drzave || {}).forEach(function (k) { var c = rules(k).cene; if (c && k !== "SI") FOREIGN_LANDS[k] = c; });
  var FOREIGN = null;
  function useForeign(d) {
    if (!d || !d.izdelki || !d.verige || !d.drzava) return false;
    var keys = Object.keys(d.verige);
    keys.forEach(function (k) {
      var v = d.verige[k], re;
      try { re = new RegExp(v.vzorec, "i"); } catch (e) { re = NEVER; }
      var c = CHAIN_BY_KEY[k];
      if (!c) { c = { key: k, name: v.ime, factor: 1.0, color: v.barva || "#8A3FFC", match: NEVER }; CHAINS.push(c); CHAIN_BY_KEY[k] = c; }
      c.tuj = re;
    });
    var cene = {};
    d.izdelki.forEach(function (e) { if (e.ime && e.cene) cene[norm(e.ime)] = e.cene; });
    FOREIGN = { drzava: d.drzava, valuta: d.valuta || "EUR", datum: d.datum || "", chains: keys, cene: cene };
    return true;
  }
  function foreignOn() { return abroad() && !!FOREIGN && FOREIGN.drzava === state.storesCache.country; }
  function moneyScale() { return foreignOn() && FOREIGN.valuta === "HUF" ? 400 : 1; }
  function foreignKey(c) { return "nakupko-prices-" + c.toLowerCase(); }
  // Trgovina v tujini dobi verigo (npr. Billa, Konzum, Tesco), če jo poznamo iz cen.
  function foreignChainOf(s) {
    if (!FOREIGN || s.gk !== "trgovina") return null;
    for (var i = 0; i < FOREIGN.chains.length; i++) {
      var c = CHAIN_BY_KEY[FOREIGN.chains[i]];
      if (c && c.tuj && c.tuj.test(s.bt || "")) return c.key;
    }
    return null;
  }
  function remapForeign(list) { (list || []).forEach(function (s) { if (s.tuj && s.gk) s.chain = foreignChainOf(s) || s.gk; }); }
  function loadForeign(ctry) {
    if (!FOREIGN_LANDS[ctry]) return;
    if (!FOREIGN || FOREIGN.drzava !== ctry) {
      try { useForeign(JSON.parse(localStorage.getItem(foreignKey(ctry)) || "null")); } catch (e) { /* nič */ }
    }
    if (!window.fetch) return;
    fetch("https://myedgeofficial.github.io/nakupko/prices-" + ctry.toLowerCase() + ".json?d=" + new Date().toISOString().slice(0, 13), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.drzava !== ctry || (FOREIGN && FOREIGN.drzava === ctry && (d.datum || "") <= FOREIGN.datum)) return;
        try { localStorage.setItem(foreignKey(ctry), JSON.stringify(d)); } catch (e) { /* poln */ }
        if (!useForeign(d)) return;
        remapForeign(stores);
        if (state.storesCache) remapForeign(state.storesCache.list);
        renderAll();
      })
      .catch(function () { /* brez povezave */ });
  }
  // Izdelek z znamko (Red Bull) ima svojo ceno, če jo poznamo; brez znamke velja glavna znamka, sicer cena izdelka na splošno.
  function brandPriceKey(it) {
    var key = norm(it.name), p = CATALOG_BY_KEY[key], b = norm(it.brand);
    if (!p) return null;
    // brez izbrane znamke: cena glavne znamke iz kataloga (npr. Red Bull), ne povprečje s cenenimi in akcijami
    if (!b) {
      var first = brandGroups(p).filter(function (x) { return BASE_PRICES[key + "|" + norm(x.name)]; })[0];
      if (!first) return null;
      var fk = key + "|" + norm(first.name);
      // Cena glavne znamke iz ene same trgovine, ki je dosti višja od splošne cene (npr. jajca Jata 5,09 € v Sparu,
      // drugje 2 €), je verjetno drugo pakiranje: takrat velja splošna cena izdelka.
      var nums = function (o) { return Object.keys(o || {}).map(function (c) { return o[c]; }).filter(function (v) { return typeof v === "number"; }); };
      var fb = nums(BASE_PRICES[fk]), gen = nums(BASE_PRICES[key]);
      if (fb.length === 1 && gen.length >= 2) {
        var ga = gen.reduce(function (a, v) { return a + v; }, 0) / gen.length;
        if (fb[0] > ga * 1.8) return null;
      }
      return fk;
    }
    var g = brandGroups(p).filter(function (x) { var n = norm(x.name); return b === n || b.indexOf(n + " ") === 0; })[0];
    var k = g ? key + "|" + norm(g.name) : null;
    return k && BASE_PRICES[k] ? k : null;
  }
  function priceFor(name, chain) {
    if (abroad()) {
      var fp = foreignOn() && FOREIGN.cene[norm(name && typeof name === "object" ? name.name : name)];
      return { price: fp && typeof fp[chain] === "number" ? fp[chain] : null, est: false };
    }
    var bk = name && typeof name === "object" ? brandPriceKey(name) : null;
    if (name && typeof name === "object") name = name.name;
    var key = norm(name);
    var imp = Object.assign({}, BASE_PRICES[bk || key] || {}, bk ? {} : state.prices[key] || {});
    if (!Object.keys(imp).some(function (k) { return typeof imp[k] === "number"; })) imp = null;
    if (imp && typeof imp[chain] === "number") {
      var sp = (SALE_PRICES[bk || key] || {})[chain];
      return { price: imp[chain], est: false, sale: typeof sp === "number" && sp < imp[chain] ? sp : null };
    }
    if (imp) {
      var vals = Object.keys(imp).map(function (k) { return imp[k]; }).filter(function (v) { return typeof v === "number"; });
      if (vals.length) {
        var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        return { price: Math.round(avg * 100) / 100, est: true };
      }
    }
    var p = CATALOG_BY_KEY[key];
    if (p && typeof p.base === "number") {
      var c = CHAIN_BY_KEY[chain];
      // izdelki z enotno ceno (npr. tobak) stanejo povsod enako
      if (p.fixed) return { price: p.base, est: false };
      return { price: Math.round(p.base * (c ? c.factor : 1) * 100) / 100, est: true };
    }
    return { price: null, est: true };
  }

  // ---------- Seznam ----------
  var filter = "all";
  var pendingProduct = null; // izbran izdelek iz kataloga, čaka na znamko
  var pendingGroup = null;   // izbrana znamka, čaka na okus/vrsto

  function addItem(name, brand, qty, opts) {
    name = capital(name || "");
    if (!name) return;
    var hitName = catalogFind(name);
    if (hitName) name = hitName.name; // angleško ime → izdelek iz kataloga
    var key = norm(name);
    var existing = state.items.find(function (i) { return norm(i.name) === key && !i.done && (i.brand || "") === (brand || ""); });
    if (existing) {
      existing.qty = (existing.qty || 1) + (qty || 1);
    } else {
      var prod = CATALOG_BY_KEY[key];
      state.items.unshift({
        id: uid(), name: prod ? prod.name : name, brand: brand || "", qty: qty || 1,
        cat: prod ? prod.cat : "Drugo", done: false, addedAt: Date.now()
      });
    }
    state.usage[key] = (state.usage[key] || 0) + 1;
    state.usageNames[key] = (CATALOG_BY_KEY[key] || {}).name || name;
    save();
    renderAll();
    if (!(opts && opts.silent)) {
      var msg = "Dodano: " + name + (brand ? " (" + brand + ")" : "");
      toast(msg);
      // Obvestilo tudi takoj pod iskalnikom: spodnjega toasta tipkovnica pogosto zakrije.
      var note = $("addedNote");
      if (note) {
        note.textContent = "✓ " + msg; note.classList.remove("hidden");
        clearTimeout(addedTimer);
        addedTimer = setTimeout(function () { note.classList.add("hidden"); }, 3000);
      }
    }
  }
  var addedTimer = null;

  function toggleItem(id, storeCtx) {
    var it = state.items.find(function (i) { return i.id === id; });
    if (!it) return;
    it.done = !it.done;
    if (it.done) {
      it.doneAt = Date.now();
      var st = storeCtx || currentStore();
      if (st && /^test\//.test(st.id)) st = null; // testni nakupi ne vplivajo na navade
      state.history.push({
        name: it.name, brand: it.brand || "", qty: it.qty || 1, ts: Date.now(),
        storeId: st ? st.id : null, storeName: st ? st.name : null, chain: st ? st.chain : null
      });
      if (state.history.length > 3000) state.history = state.history.slice(-3000);
      delete state.dismissN[norm(it.name)]; // kupljeno: predlogi spet po običajnem ritmu
      it.historyTs = state.history[state.history.length - 1].ts;
    } else {
      // razveljavi zapis nakupa
      var idx = -1;
      for (var k = state.history.length - 1; k >= 0; k--) {
        if (state.history[k].ts === it.historyTs && state.history[k].name === it.name) { idx = k; break; }
      }
      if (idx >= 0) state.history.splice(idx, 1);
      delete it.doneAt; delete it.historyTs;
    }
    save();
    renderAll();
  }
  function removeItem(id) {
    state.items = state.items.filter(function (i) { return i.id !== id; });
    save(); renderAll();
  }

  function itemMeta(it) {
    var parts = [];
    // količina je pred imenom (»5x Panakota«)
    if (it.brand) parts.push(it.brand);
    var usual = usualStore(it.name);
    if (usual && !it.store) parts.push("običajno: " + usual);
    return parts.join(" · ");
  }
  // ---------- Izdelek za določeno trgovino (npr. šampon v dm, mleko v Sparu) ----------
  // it.store = veriga (»dm«) ali, v tujini, id trgovine. V »V trgovini« in na zaklenjenem zaslonu
  // je izdelek le v tej trgovini; nedodeljeni so povsod, kjer jih prodajajo.
  function storeKeyName(k) {
    if (!k) return "";
    if (CHAIN_BY_KEY[k]) return CHAIN_BY_KEY[k].name;
    var st = storeById(k);
    return st ? (st.short || st.name) : k;
  }
  function storeChoices(it) {
    var keys = [];
    function add(k) { if (k && keys.indexOf(k) < 0) keys.push(k); }
    add(it.store);
    if (abroad()) {
      // V tujini brez verig: bližnje trgovine po imenu.
      var seen = {};
      stores.slice().sort(function (a, b) { return lastPos ? distM(lastPos, a) - distM(lastPos, b) : 0; }).forEach(function (x) {
        var n = (x.short || x.name || "").toLowerCase();
        if (keys.length < 8 && n && !seen[n]) { seen[n] = 1; add(x.id); }
      });
      return keys;
    }
    (myChains() || []).forEach(add);
    stores.forEach(function (x) { if (x.chain && CHAIN_BY_KEY[x.chain] && !/^(bencinska|trafika|kiosk)$/.test(x.chain)) add(x.chain); });
    COMPARE_CHAINS.concat(["dm", "muller"]).forEach(add);
    return keys;
  }
  var pickOpen = null;
  function setItemStore(it, k) {
    it.store = k || "";
    if (!it.store) delete it.store;
    pickOpen = null;
    save();
    renderAll();
    toast(k ? it.name + " → " + storeKeyName(k) : it.name + ": v katerikoli trgovini");
  }
  function storePicker(it) {
    var delBtn = el("button", { type: "button", class: "chip chip-del", onclick: function () { pickOpen = null; removeItem(it.id); } }, ["Izbriši"]);
    if (it.done) return el("div", { class: "store-pick" }, [delBtn]);
    var box = el("div", { class: "store-pick" }, [el("span", { class: "muted small", text: "Kje kupiš?" })]);
    box.appendChild(el("button", { type: "button", class: "chip" + (!it.store ? " on" : ""), onclick: function () { setItemStore(it, ""); } }, ["Kjerkoli"]));
    storeChoices(it).forEach(function (k) {
      box.appendChild(el("button", { type: "button", class: "chip" + (it.store === k ? " on" : ""), onclick: function () { setItemStore(it, k); } },
        CHAIN_BY_KEY[k] ? [chainDot(k), storeKeyName(k)] : [storeKeyName(k)]));
    });
    box.appendChild(delBtn);
    return box;
  }
  // ---------- Izbira trgovin za izračun cen ----------
  var PREFS = {
    discount: { label: "Hofer in Lidl", short: "Hofer/Lidl", chains: ["hofer", "lidl"] },
    eurojag: { label: "Eurospin in Jager", short: "Eurospin/Jager", chains: ["eurospin", "jager"] },
    classic: { label: "Tuš, Spar in Mercator", short: "Tuš/Spar/Mercator", chains: ["tus", "spar", "mercator"] },
    all: { label: "Kjerkoli je najceneje", short: "najceneje", chains: null },
    none: { label: "Cene me ne zanimajo", short: "", chains: null }
  };
  function pref() {
    if (abroad() && state.settings.pricePref !== "none") return PREFS.all; // v tujini: kjerkoli je najceneje
    return PREFS[state.settings.pricePref] || PREFS.all;
  }
  // V tujini pišemo cene samo, kjer jih imamo (Avstrija, Hrvaška, Madžarska).
  function abroad() { var c = state.storesCache && state.storesCache.country; return !!c && c !== "SI"; }
  function pricesOff() { return state.settings.pricePref === "none" || (abroad() && !foreignOn()); }
  function pref2() { if (abroad()) return null; var k = state.settings.pricePref2; return k && k !== state.settings.pricePref && PREFS[k] && PREFS[k].chains ? PREFS[k] : null; }
  // trgovine, ki jih uporabnik sploh obiskuje (prva + druga izbira); null = vse
  function myChains() {
    if (!pref().chains) return null;
    var l = pref().chains.slice();
    if (pref2()) pref2().chains.forEach(function (c) { if (l.indexOf(c) < 0) l.push(c); });
    return l;
  }
  function compareChains() {
    if (abroad()) return foreignOn() ? FOREIGN.chains.slice() : [];
    var list = COMPARE_CHAINS.slice();
    (myChains() || []).forEach(function (c) { if (list.indexOf(c) < 0) list.push(c); });
    return list;
  }
  // Cena po izbiri uporabnika: povprečje izbranih trgovin ali najnižja cena.
  function prefPrice(name) {
    if (pricesOff()) return null;
    var chains = pref().chains;
    if (!chains) { var b = cheapestChain(name); return b ? { price: b.price, est: b.est, chain: b.chain, sale: b.sale } : null; }
    var sum = 0, n = 0, est = false;
    var sale = null;
    chains.forEach(function (c) { var p = priceFor(name, c); if (p.price != null) { sum += p.price; n++; est = est || p.est; sale = p.sale; } });
    if (!n) return null;
    return { price: Math.round(sum / n * 100) / 100, est: est, chain: chains.length === 1 ? chains[0] : null, group: chains.length > 1, sale: chains.length === 1 ? sale : null };
  }
  function cheapestChain(name) {
    var best = null;
    compareChains().forEach(function (c) {
      var p = priceFor(name, c);
      if (p.price != null && (!best || p.price < best.price)) best = { chain: c, price: p.price, est: p.est, sale: p.sale };
    });
    return best;
  }

  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  // Cena v vrstici: cena za kos/pakiranje z enoto (»2,49 € / 250 g«), meso in sir na kg; akcija posebej.
  function priceChip(it, storeCtx) {
    if (pricesOff()) return null;
    var chain = null, p = null;
    if (storeCtx && storeCtx.chain) { chain = storeCtx.chain; p = priceFor(it, chain); if (p.price == null) p = null; }
    if (!p) { p = prefPrice(it); if (p) chain = p.chain; }
    if (!p) return null;
    var kg = perKg(it.name), prod = CATALOG_BY_KEY[norm(it.name)];
    var unit = kg ? kg.unit : String((prod && prod.unit) || "").replace(/^.*,\s+/, ""); // »tekoči, kos« → »kos«
    return el("div", { class: "price" + (p.est ? " est" : ""), title: chain ? CHAIN_BY_KEY[chain].name : pref().label }, [
      el("span", { class: "pmain" }, [
        chain ? chainDot(chain) : el("i", { class: "avg", text: "Ø" }),
        (kg ? eur(p.price / kg.amount) : eur(p.price)) + (p.est ? "*" : ""),
        unit ? " / " : null, unit ? el("span", { class: "unit", text: unit }) : null
      ]),
      chain && p.sale ? el("b", { class: "sale", text: (window.NK_T ? window.NK_T("akcija") : "akcija") + " " + (kg ? eur(p.sale / kg.amount) : eur(p.sale)) }) : null
    ]);
  }
  // Sir, meso, ribe ipd. so v zelo različnih pakiranjih: pokažemo ceno na kg (izdelki na kg vedno).
  var PER_KG_RE = /\bsir|sirni|mozzarel|parmez|feta|gorgonzol|mascarpon|ricott|brie|camembert|grana|skuta|cottage|halloumi/;
  function perKg(name) {
    var p = CATALOG_BY_KEY[norm(name)];
    if (!p) return null;
    var m = String(p.unit || "").replace(",", ".").match(/^\s*([\d.]+)?\s*(g|kg)\s*$/i);
    if (!m) return null;
    var amount = (m[1] ? parseFloat(m[1]) : 1) / (m[2].toLowerCase() === "g" ? 1000 : 1);
    if (!(amount > 0)) return null;
    if (m[2].toLowerCase() === "kg" && amount === 1) return { amount: 1, unit: "kg" };
    if (p.cat === "Meso in ribe" || (p.cat === "Mlečni izdelki" && PER_KG_RE.test(norm(p.name)))) return { amount: amount, unit: "kg" };
    return null;
  }
  // ---------- Ikone izdelkov ----------
  // Barvne ikone (Microsoft Fluent Emoji, MIT) iz mape icons/, izbrane po imenu izdelka; sicer po kategoriji.
  var ICONS = window.NAKUPKO_ICONS || { rules: [], cat: {} };
  var ICON_RULES = ICONS.rules.map(function (r) { return [new RegExp(r[0]), r[1]]; });
  var iconMemo = {};
  function iconFor(it) {
    var n = norm(it.name);
    if (iconMemo[n]) return iconMemo[n];
    var hit = null;
    for (var i = 0; i < ICON_RULES.length; i++) { if (ICON_RULES[i][0].test(n)) { hit = ICON_RULES[i][1]; break; } }
    if (!hit) { var p = CATALOG_BY_KEY[n]; hit = ICONS.cat[(p && p.cat) || it.cat] || ICONS.cat.Drugo || "shopping-cart"; }
    return (iconMemo[n] = hit);
  }
  function thumbFor(it) {
    var m = CAT_META[it.cat] || CAT_META.Drugo;
    return el("span", { class: "thumb", "aria-hidden": "true", style: "background:" + m[1] }, [el("img", { src: "icons/" + iconFor(it) + ".svg", alt: "" })]);
  }
  try { localStorage.removeItem("nakupko-img"); delete state.imgCache; } catch (e) { /* nič */ }

  function qtyText(q) { return q && q !== 1 ? String(q).replace(".", ",") + "x" : ""; }
  function itemRow(it, big, storeCtx) {
    var meta = itemMeta(it);
    var check = el("button", { class: "check", type: "button", "aria-label": it.done ? "Označi kot nekupljeno" : "Označi kot kupljeno",
      onclick: function () { toggleItem(it.id, storeCtx); } });
    check.innerHTML = CHECK_SVG;
    // Brisanje: povleci vrstico v levo (gumb za njo) ali tapni ime in »Izbriši«.
    var del = el("button", { class: "del", type: "button", "aria-label": "Izbriši " + it.name, onclick: function () { removeItem(it.id); } });
    del.innerHTML = X_SVG;
    // Tap na ime: izbira trgovine za ta izdelek.
    var tag = it.store ? el("span", { class: "store-tag" }, [CHAIN_BY_KEY[it.store] ? chainDot(it.store) : null, storeKeyName(it.store)]) : null;
    var q = qtyText(it.qty);
    var row = el("div", { class: "irow" }, [
      thumbFor(it),
      el("div", { class: "ibody", role: "button", tabindex: "0", onclick: function () { pickOpen = pickOpen === it.id ? null : it.id; renderAll(); } }, [
        el("div", { class: "iname" }, [q ? el("i", { class: "iqty", text: q }) : null, el("span", { text: it.name })]),
        it.done ? null : priceChip(it, storeCtx),
        meta || tag ? el("div", { class: "imeta" }, [tag, meta ? document.createTextNode((tag ? " · " : "") + meta) : null]) : null
      ]),
      check
    ]);
    var li = el("li", { class: "item" + (it.done ? " done" : "") + (pickOpen === it.id ? " picking" : "") }, [
      del,
      row,
      pickOpen === it.id ? storePicker(it) : null
    ]);
    swipeable(li, row);
    return li;
  }
  // Povleci v levo: pokaže gumb za brisanje (kot na iPhonu). Navpično drsenje ostane brskalniku.
  var swipedRow = null;
  function closeSwipe() { if (swipedRow) { swipedRow.classList.remove("swiped"); swipedRow.querySelector(".irow").style.transform = ""; swipedRow = null; } }
  function swipeable(li, row) {
    var x0 = null, y0 = 0, dx = 0, moved = false, id = null;
    row.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (swipedRow && swipedRow !== li) closeSwipe();
      x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; id = e.pointerId;
    });
    row.addEventListener("pointermove", function (e) {
      if (x0 === null || e.pointerId !== id) return;
      var ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!moved && (Math.abs(ddx) < 10 || Math.abs(ddx) < Math.abs(ddy) * 1.2)) { if (Math.abs(ddy) > 12) x0 = null; return; }
      if (!moved) { moved = true; try { row.setPointerCapture(id); } catch (err) { /* nič */ } li.classList.add("dragging"); }
      var base = li.classList.contains("swiped") ? -88 : 0;
      dx = Math.max(-110, Math.min(0, base + ddx));
      row.style.transform = "translateX(" + dx + "px)";
    });
    function end() {
      if (x0 === null) return;
      x0 = null;
      li.classList.remove("dragging");
      if (!moved) return;
      if (dx < -44) { li.classList.add("swiped"); row.style.transform = "translateX(-88px)"; swipedRow = li; }
      else { li.classList.remove("swiped"); row.style.transform = ""; if (swipedRow === li) swipedRow = null; }
    }
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
    // Tap po vlečenju ne odkljuka izdelka; tap na odprto vrstico jo zapre.
    row.addEventListener("click", function (e) {
      if (moved) { moved = false; e.stopPropagation(); e.preventDefault(); return; }
      if (li.classList.contains("swiped")) { e.stopPropagation(); e.preventDefault(); closeSwipe(); }
    }, true);
  }
  function renderList() {
    var ul = $("list");
    ul.innerHTML = "";
    var st = currentStore() || lastNearStore;
    var other = [];
    var items = state.items.filter(function (i) {
      if (filter === "done") return i.done;
      if (i.done) return false;
      if (filter === "store") {
        if (!st) return true;
        var u = usualStoreInfo(i.name);
        if (i.store ? forStore(st, i) : sells(st, i) && (!u || u.chain === st.chain || u.storeId === st.id)) return true;
        other.push(i);
        return false;
      }
      return true;
    });
    // razvrsti po kategoriji (kot pot po trgovini)
    var order = ["Sadje in zelenjava", "Kruh in pecivo", "Mlečni izdelki", "Meso in ribe", "Shramba", "Prigrizki", "Pijače", "Zamrznjeno", "Gospodinjstvo", "Higiena", "Tobak", "Brez glutena", "Otroci", "Zdravje", "Športna prehrana", "Ljubljenčki", "Dom in vrt", "Drugo"];
    items.sort(function (a, b) { return order.indexOf(a.cat || "Drugo") - order.indexOf(b.cat || "Drugo"); });
    var lastCat = null;
    // Izdelki, dodeljeni trgovinam, so zgoraj po trgovinah (npr. »dm: šampon, zobna pasta«), ostali po oddelkih.
    if (filter === "all" || filter === undefined) {
      var byStore = {}, keys = [];
      items = items.filter(function (it) {
        if (!it.store) return true;
        if (!byStore[it.store]) { byStore[it.store] = []; keys.push(it.store); }
        byStore[it.store].push(it);
        return false;
      });
      keys.sort(function (x, y) { return storeKeyName(x).localeCompare(storeKeyName(y), "sl"); }).forEach(function (k) {
        ul.appendChild(el("li", { class: "cat store-head" }, [CHAIN_BY_KEY[k] ? chainDot(k) : el("span", { class: "cat-bar", style: "background:#E9EEEA" }), storeKeyName(k)]));
        byStore[k].forEach(function (it) { ul.appendChild(itemRow(it)); });
      });
      if (keys.length && items.length) { ul.appendChild(el("li", { class: "cat store-head" }, [el("span", { class: "cat-bar", style: "background:#E9EEEA" }), "Kjerkoli"])); }
    }
    items.forEach(function (it) {
      if (filter !== "done" && it.cat !== lastCat) {
        var m = CAT_META[it.cat] || CAT_META.Drugo;
        ul.appendChild(el("li", { class: "cat" }, [el("span", { class: "cat-bar", style: "background:" + m[1] }), it.cat || "Drugo"]));
        lastCat = it.cat;
      }
      ul.appendChild(itemRow(it));
    });
    if (other.length) ul.appendChild(otherSection(other));
    $("listEmpty").classList.toggle("hidden", items.length + other.length > 0);
    $("listEmpty").textContent = filter === "store" && !st ? "Nisi v bližini trgovine. Vklopi zaznavanje trgovine v Nastavitvah." : (filter === "done" ? "Še nič kupljenega." : "Seznam je prazen.");
    if (filter === "store" && !st) $("listEmpty").classList.remove("hidden");
    $("countOpen").textContent = state.items.filter(function (i) { return !i.done; }).length;
    $("clearDone").classList.toggle("hidden", !state.items.some(function (i) { return i.done; }));
  }

  function renderQuick() {
    var box = $("quick");
    box.innerHTML = "";
    var used = Object.keys(state.usage).sort(function (a, b) { return state.usage[b] - state.usage[a]; });
    var names = [];
    used.forEach(function (k) { var p = CATALOG_BY_KEY[k]; names.push(p ? p.name : (state.usageNames[k] || capital(k))); });
    DEFAULT_QUICK.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var open = state.items.filter(function (i) { return !i.done; }).map(function (i) { return norm(i.name); });
    names.slice(0, 14).forEach(function (n) {
      var on = open.indexOf(norm(n)) >= 0;
      box.appendChild(el("button", { class: "chip" + (on ? " on" : ""), type: "button", onclick: function () {
        var p = CATALOG_BY_KEY[norm(n)], lb = lastBrandFor(n) || "";
        var known = !p || !lb || p.brands.some(function (b) { return brandLabel(b) === lb; }) || brandGroups(p).some(function (g) { return g.name === lb && !g.variants.length; });
        // Znamka iz starejše verzije kataloga (npr. samo »Terea«): vprašamo za okus.
        if (!known) { $("addInput").value = n; pickProduct(n, (brandGroups(p).filter(function (g) { return g.name === lb; })[0] || {}).name); window.scrollTo(0, 0); return; }
        addItem(n, lb, 1);
      } }, [n]));
    });
  }

  // ---------- Iskanje in znamke ----------
  var selIdx = -1;
  function searchCatalog(q) {
    var nq = norm(q);
    if (!nq) return [];
    var starts = [], contains = [];
    CATALOG.forEach(function (p) {
      var n = norm(p.name), en = p.en, loc = p.loc;
      var b = p.brands.map(norm).join(" ");
      var wordStart = function (x) { return x.indexOf(nq) === 0 || x.split(" ").some(function (w) { return w.indexOf(nq) === 0; }); };
      if (wordStart(n) || (en && wordStart(en)) || (loc && wordStart(loc))) starts.push(p);
      else if (n.indexOf(nq) >= 0 || (en && en.indexOf(nq) >= 0) || (loc && loc.indexOf(nq) >= 0) || b.indexOf(nq) >= 0 || norm(p.cat).indexOf(nq) === 0) contains.push(p);
    });
    // izdelki, ki jih pogosto kupuješ, najprej
    var byUse = function (a, b) { return (state.usage[norm(b.name)] || 0) - (state.usage[norm(a.name)] || 0); };
    return starts.sort(byUse).concat(contains.sort(byUse)).slice(0, 10);
  }
  // Znamke imajo lahko različice: "Terea › Amber" (znamka › okus/vrsta). Shranimo "Terea Amber".
  function brandLabel(b) { return String(b || "").replace(/\s*›\s*/, " "); }
  function brandGroups(p) {
    var out = [], by = {};
    p.brands.forEach(function (b) {
      var parts = String(b).split(/\s*›\s*/), g = parts[0];
      if (!by[g]) { by[g] = { name: g, variants: [] }; out.push(by[g]); }
      if (parts[1]) by[g].variants.push(parts[1]);
    });
    return out;
  }
  function squash(s) { return norm(s).replace(/[^a-z0-9]/g, ""); }
  // Zadetki po znamki ali različici: »redbull« → Energijska pijača (Red Bull), »bronze« → Terea Bronze ...
  function searchBrands(q) {
    var sq = squash(q), nq = norm(q), out = [];
    if (sq.length < 2) return out;
    CATALOG.forEach(function (p) {
      brandGroups(p).forEach(function (g) {
        var gs = squash(g.name);
        var gHit = gs.indexOf(sq) === 0 || (sq.length >= 3 && norm(g.name).split(" ").some(function (w) { return squash(w).indexOf(sq) === 0; }));
        var vHits = g.variants.filter(function (v) {
          var full = squash(g.name + " " + v);
          return (full.indexOf(sq) === 0 && sq.length > gs.length) || (nq.length >= 3 && squash(v).indexOf(sq) === 0);
        });
        if (vHits.length) vHits.forEach(function (v) { out.push({ p: p, group: g, brand: g.name + " " + v }); });
        else if (gHit) {
          out.push({ p: p, group: g, brand: g.variants.length ? null : g.name });
          // Celo ime znamke (»redbull«): takoj ponudimo tudi vse okuse/vrste.
          if (sq.length >= gs.length) g.variants.forEach(function (v) { out.push({ p: p, group: g, brand: g.name + " " + v }); });
        }
      });
    });
    var byUse = function (a, b) { return (state.usage[norm(b.p.name)] || 0) - (state.usage[norm(a.p.name)] || 0); };
    return out.sort(byUse);
  }
  // Predlogi: izdelki po imenu, nato znamke, nato ostali zadetki.
  function searchAll(q) {
    var nq = norm(q);
    if (!nq) return [];
    var prods = searchCatalog(q);
    var starts = prods.filter(function (p) { var n = norm(p.name); return n.indexOf(nq) === 0 || n.split(" ").some(function (w) { return w.indexOf(nq) === 0; }); });
    var rest = prods.filter(function (p) { return starts.indexOf(p) < 0; });
    var brands = searchBrands(q).slice(0, 8);
    var brandProducts = brands.map(function (b) { return b.p; });
    rest = rest.filter(function (p) { return brandProducts.indexOf(p) < 0; });
    return starts.map(function (p) { return { p: p }; }).concat(brands, rest.map(function (p) { return { p: p }; })).slice(0, 12);
  }
  var lastResults = [];
  function renderSuggest() {
    var q = $("addInput").value;
    var res = lastResults = searchAll(q);
    var ul = $("suggest");
    ul.innerHTML = "";
    if (!q.trim() || !res.length) { ul.classList.add("hidden"); return; }
    res.forEach(function (r, i) {
      var title = r.group ? (r.brand || r.group.name) : r.p.name;
      var sub = r.group ? r.p.name + (r.brand ? "" : " · izberi vrsto") : r.p.cat;
      ul.appendChild(el("li", { class: i === selIdx ? "sel" : "", role: "option",
        onmousedown: function (e) { e.preventDefault(); chooseResult(r); } }, [
        el("span", { text: title }), el("span", { class: "muted small", text: sub })
      ]));
    });
    ul.classList.remove("hidden");
  }
  function chooseResult(r) {
    if (!r.group) return pickProduct(r.p.name);
    if (r.brand) { addItem(r.p.name, r.brand, parseQty($("addQty").value)); resetAdd(); return; }
    pickProduct(r.p.name, r.group.name);
  }
  function pickProduct(name, group) {
    var p = CATALOG_BY_KEY[norm(name)];
    $("suggest").classList.add("hidden");
    selIdx = -1;
    var groups = p ? brandGroups(p) : [];
    if (p && (groups.length > 1 || (groups[0] && groups[0].variants.length))) {
      pendingProduct = p;
      pendingGroup = group || (groups.length === 1 ? groups[0].name : null);
      pendingBrand = null;
      $("addInput").value = p.name;
      renderBrandPick();
    } else {
      addItem(p ? p.name : name, groups.length === 1 ? groups[0].name : "", parseQty($("addQty").value));
      resetAdd();
    }
  }
  // Znamko izbereš (✓), na seznam pa doda šele gumb »Dodaj na seznam« (ali + zgoraj).
  var pendingBrand = null;   // izbrana znamka/vrsta ("" = katerakoli)
  function renderBrandPick() {
    var box = $("brandPick");
    box.innerHTML = "";
    if (!pendingProduct) { box.classList.add("hidden"); return; }
    var p = pendingProduct;
    var lastBrand = lastBrandFor(p.name) || "";
    var groups = brandGroups(p);
    var g = pendingGroup && groups.filter(function (x) { return x.name === pendingGroup; })[0];
    function chip(label, value, extra) {
      return el("button", { class: "chip" + (pendingBrand === value ? " on" : ""), type: "button",
        onclick: extra || function () { pendingBrand = value; renderBrandPick(); } }, [label]);
    }
    if (g && g.variants.length) {
      // Druga raven: okus / vrsta znotraj znamke.
      box.appendChild(el("span", { class: "muted small", text: g.name + " – katera?" }));
      if (groups.length > 1) box.appendChild(el("button", { class: "chip ghosty", type: "button", onclick: function () { pendingGroup = null; pendingBrand = ""; renderBrandPick(); } }, ["‹ Znamke"]));
      var vs = g.variants.slice(), lastV = lastBrand.indexOf(g.name + " ") === 0 ? lastBrand.slice(g.name.length + 1) : "";
      if (lastV && vs.indexOf(lastV) > 0) { vs.splice(vs.indexOf(lastV), 1); vs.unshift(lastV); }
      if (pendingBrand === null || (pendingBrand !== g.name && pendingBrand.indexOf(g.name + " ") !== 0)) pendingBrand = lastV ? g.name + " " + lastV : g.name;
      vs.forEach(function (v) { box.appendChild(chip(v, g.name + " " + v)); });
      box.appendChild(chip("Katerakoli " + g.name, g.name));
    } else {
      box.appendChild(el("span", { class: "muted small", text: "Znamka za " + p.name + ":" }));
      var lastG = groups.filter(function (x) { return lastBrand === x.name || lastBrand.indexOf(x.name + " ") === 0; })[0];
      if (lastG && groups.indexOf(lastG) > 0) { groups.splice(groups.indexOf(lastG), 1); groups.unshift(lastG); }
      if (pendingBrand === null) pendingBrand = lastG && !lastG.variants.length ? lastG.name : "";
      box.appendChild(chip("Katerakoli", ""));
      groups.forEach(function (x) {
        box.appendChild(chip(x.name + (x.variants.length ? " ›" : ""), x.name, x.variants.length ? function () { pendingGroup = x.name; pendingBrand = null; renderBrandPick(); } : null));
      });
    }
    var label = p.name + (pendingBrand ? " (" + pendingBrand + ")" : "");
    box.appendChild(el("button", { class: "primary full confirm", type: "button", onclick: confirmPick }, ["Dodaj na seznam: " + label]));
    box.classList.remove("hidden");
  }
  function confirmPick() {
    if (!pendingProduct) return;
    addItem(pendingProduct.name, pendingBrand || "", parseQty($("addQty").value));
    resetAdd();
  }
  function resetAdd() {
    pendingGroup = null;
    pendingBrand = null;
    pendingProduct = null;
    $("addInput").value = "";
    $("addQty").value = "1";
    $("brandPick").classList.add("hidden");
    $("suggest").classList.add("hidden");
  }
  function lastBrandFor(name) {
    var key = norm(name);
    for (var i = state.history.length - 1; i >= 0; i--) {
      if (norm(state.history[i].name) === key && state.history[i].brand) return state.history[i].brand;
    }
    return null;
  }

  // ---------- Učenje navad in predlogi ----------
  function purchasesOf(name) {
    var key = norm(name);
    return state.history.filter(function (h) { return norm(h.name) === key; });
  }
  function usualStoreInfo(name) {
    var ps = purchasesOf(name).filter(function (h) { return h.storeId || h.chain; });
    if (ps.length < 2) return null;
    var counts = {};
    ps.forEach(function (h) {
      var k = h.storeId || h.chain;
      counts[k] = counts[k] || { n: 0, storeId: h.storeId, chain: h.chain, name: h.storeName || (CHAIN_BY_KEY[h.chain] || {}).name };
      counts[k].n++;
    });
    var best = Object.keys(counts).map(function (k) { return counts[k]; }).sort(function (a, b) { return b.n - a.n; })[0];
    return best && best.n >= 2 ? best : null;
  }
  function usualStore(name) { var u = usualStoreInfo(name); return u ? u.name : null; }

  // Za vsak izdelek z vsaj 2 nakupoma: povprečen razmik in dan v mesecu.
  function habits() {
    var groups = {};
    state.history.forEach(function (h) {
      var k = norm(h.name);
      (groups[k] = groups[k] || []).push(h);
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var hs = groups[k].slice().sort(function (a, b) { return a.ts - b.ts; });
      // nakupi na isti dan štejejo kot en
      var days = [];
      hs.forEach(function (h) {
        var d = Math.floor(h.ts / DAY);
        if (days[days.length - 1] !== d) days.push(d);
      });
      if (days.length < 2) return;
      var gaps = [];
      for (var i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
      // štejejo zadnji 4 razmiki, da se ob spremembi rutine hitro prilagodi
      gaps = gaps.slice(-4).sort(function (a, b) { return a - b; });
      var median = gaps[Math.floor(gaps.length / 2)];
      // dan v tednu: vsaj 3 nakupi in večina na isti dan
      var recentDays = days.slice(-6), wd = [0, 0, 0, 0, 0, 0, 0];
      recentDays.forEach(function (d) { wd[new Date(d * DAY + 12 * 3600000).getDay()]++; });
      var topWd = wd.indexOf(Math.max.apply(null, wd));
      var weekday = recentDays.length >= 3 && wd[topWd] / recentDays.length >= 0.6 ? topWd : null;
      var last = hs[hs.length - 1];
      var since = (Date.now() - last.ts) / DAY;
      var dom = hs.map(function (h) { return new Date(h.ts).getDate(); });
      var domMean = dom.reduce(function (a, b) { return a + b; }, 0) / dom.length;
      var domSd = Math.sqrt(dom.reduce(function (a, b) { return a + (b - domMean) * (b - domMean); }, 0) / dom.length);
      out.push({
        key: k, name: last.name, brand: last.brand, count: hs.length, interval: Math.max(1, median),
        since: since, domMean: Math.round(domMean), monthly: hs.length >= 3 && domSd <= 3 && median >= 20, weekday: weekday,
        store: usualStoreInfo(last.name)
      });
    });
    return out;
  }
  var WEEKDAYS = ["ob nedeljah", "ob ponedeljkih", "ob torkih", "ob sredah", "ob četrtkih", "ob petkih", "ob sobotah"];
  function agoDays(d) { d = Math.floor(d); return d <= 0 ? "manj kot dnevom" : d === 1 ? "1 dnevom" : d + " dnevi"; }
  function recommendations(storeCtx) {
    var openKeys = state.items.filter(function (i) { return !i.done; }).map(function (i) { return norm(i.name); });
    var today = new Date().getDate();
    var wdNow = new Date().getDay(), wdNext = (wdNow + 1) % 7;
    var res = [];
    habits().forEach(function (h) {
      if (openKeys.indexOf(h.key) >= 0) return;
      // vsak »Ne« podaljša čakanje, dokler izdelka spet ne kupiš
      var nDis = state.dismissN[h.key] || 0;
      var dis = state.dismissed[h.key];
      if (dis && Date.now() - dis < Math.max(1, h.interval / 3) * (1 + nDis) * DAY) return;
      var interval = h.interval * (1 + 0.5 * nDis);
      var reason = null, score = 0;
      if (h.monthly && Math.abs(today - h.domMean) <= 2 && h.since > 15) {
        reason = "Običajno kupiš okoli " + h.domMean + ". v mesecu"; score = 3;
      } else if (h.weekday != null && (h.weekday === wdNow || h.weekday === wdNext) && h.since >= Math.min(4, interval * 0.6)) {
        reason = "Običajno kupiš " + WEEKDAYS[h.weekday] + (h.weekday === wdNext ? " (jutri)" : ""); score = 3 + (h.weekday === wdNow ? 0.5 : 0);
      } else if (h.since >= interval * 0.85) {
        reason = (interval >= 5 && interval <= 9 ? "Kupiš ga vsak teden" : "Kupiš ga vsakih ~" + Math.round(interval) + " dni") + ", zadnjič pred " + agoDays(h.since);
        score = 2 + h.since / interval;
      }
      if (storeCtx && h.store && (h.store.storeId === storeCtx.id || h.store.chain === storeCtx.chain)) {
        if (reason) { reason += " · tu ga običajno kupiš"; score += 2; }
        else if (h.since >= h.interval * 0.6) { reason = "Tu ga običajno kupiš, zadnjič pred " + Math.floor(h.since) + " dnevi"; score = 1.5; }
      }
      if (reason) res.push({ h: h, reason: reason, score: score });
    });
    return res.sort(function (a, b) { return b.score - a.score; }).slice(0, 6);
  }
  function renderRecoInto(ul, storeCtx) {
    ul.innerHTML = "";
    var recs = recommendations(storeCtx);
    recs.forEach(function (r) {
      ul.appendChild(el("li", null, [
        el("div", null, [el("b", { text: r.h.name + (r.h.brand ? " (" + r.h.brand + ")" : "") }), el("small", { text: r.reason })]),
        el("div", { class: "row" }, [
          el("button", { class: "mini ghosty", type: "button", "aria-label": "Skrij predlog", onclick: function () { state.dismissed[r.h.key] = Date.now(); state.dismissN[r.h.key] = (state.dismissN[r.h.key] || 0) + 1; save(); renderAll(); } }, ["Ne"]),
          el("button", { class: "mini", type: "button", onclick: function () { addItem(r.h.name, r.h.brand, 1); } }, ["+ Dodaj"])
        ])
      ]));
    });
    return recs.length;
  }
  function renderReco() {
    var n = renderRecoInto($("recoList"), currentStore());
    $("recoBox").classList.toggle("hidden", n === 0);
    $("recoAll").classList.toggle("hidden", n < 2);
  }
  $("recoAll").addEventListener("click", function () {
    var recs = recommendations(currentStore());
    recs.forEach(function (r) { addItem(r.h.name, r.h.brand, 1, { silent: true }); });
    renderAll();
    toast("Dodanih " + recs.length + " izdelkov.");
  });

  // ---------- Lokacija in trgovine ----------
  var watchId = null, lastPos = null, stores = [], lastFetchPos = null, fetching = false;
  var lastNearStore = null, activeStore = null, countdownTimer = null;

  if (state.storesCache && state.storesCache.list) {
    // Stari predpomnilnik je lahko vseboval tudi druge trgovine.
    stores = state.storesCache.list.filter(function (s) {
      if (s.duty === undefined) { s.duty = !s.chain && storeKind(s.name, s.hours) === "duty"; }
      return allowedStore(s);
    });
    lastFetchPos = state.storesCache.pos;
    applyOfficial(stores);
  }

  function currentStore() { return activeStore; }

  function startLocation() {
    if (!("geolocation" in navigator)) { setLocStatus("Ta brskalnik ne podpira lokacije."); return; }
    if (watchId !== null) return;
    setLocStatus("Iščem tvojo lokacijo …");
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    state.settings.locOn = true; save();
    $("btnLoc").setAttribute("aria-checked", "true");
  }
  function stopLocation() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    state.settings.locOn = false; save();
    $("btnLoc").setAttribute("aria-checked", "false");
    setLocStatus("Lokacija je izklopljena.");
    if (det) det.pending = null;
    stopCountdown();
    $("detectBar").classList.add("hidden");
  }
  function onPosErr(err) {
    if (err.code === 1) {
      setLocStatus("Dostop do lokacije je zavrnjen. Na iPhonu: Nastavitve → Zasebnost → Lokacijske storitve → Safari → Med uporabo.");
      watchId = null;
      $("btnLoc").setAttribute("aria-checked", "false");
    } else {
      setLocStatus("Lokacije trenutno ne dobim (" + (err.message || "napaka") + "). Poskušam znova …");
    }
  }
  function setLocStatus(t) { $("locStatus").textContent = t; }

  function onPos(pos) {
    lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy || 999, speed: pos.coords.speed == null ? -1 : pos.coords.speed };
    setLocStatus("Lokacija vklopljena · natančnost ±" + Math.round(lastPos.acc) + " m");
    if (!lastFetchPos || distM(lastFetchPos, lastPos) > 700 || !stores.length) fetchStores(lastPos);
    evaluateNear();
    renderStores();
    renderTrip();
  }

  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  function fetchStores(p, force) {
    if (fetching && !force) return;
    fetching = true;
    // Najprej država (is_in), nato trgovine.
    var q = "[out:json][timeout:20];is_in(" + p.lat + "," + p.lon + ")->.a;area.a[\"ISO3166-1\"][\"admin_level\"=\"2\"]->.c;.c out tags;(" +
      "nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store|baby_goods|pet|doityourself|hardware|garden_centre|nutrition_supplements|health_food|chemist|tobacco|kiosk|newsagent)$\"](around:3000," + p.lat + "," + p.lon + ");" +
      "nwr[\"amenity\"=\"fuel\"](around:3000," + p.lat + "," + p.lon + ");" +
      ");out center tags 250;";
    var tryAt = function (i) {
      if (i >= OVERPASS.length) {
        fetching = false;
        if (!stores.length) setLocStatus("Trgovin ne morem naložiti (ni povezave). Poskusi »Osveži trgovine«.");
        return;
      }
      fetch(OVERPASS[i], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) {
          fetching = false;
          var els = data.elements || [], ctry = null;
          els.forEach(function (e) { if (e.type === "area" && e.tags && e.tags["ISO3166-1"]) ctry = e.tags["ISO3166-1"].toUpperCase(); });
          if (!ctry) ctry = inSlovenia(p.lat, p.lon) ? "SI" : "XX";
          var tuj = ctry !== "SI", wasAbroad = abroad();
          if (tuj) loadForeign(ctry);
          stores = els.map(function (e) {
            var t = e.tags || {};
            var lat = e.lat != null ? e.lat : (e.center && e.center.lat);
            var lon = e.lon != null ? e.lon : (e.center && e.center.lon);
            if (lat == null || lon == null) return null;
            var nm = t.name || t.brand || t.operator || "Trgovina";
            if (tuj) {
              // V tujini: vse trgovine z živili (in specializirane) po vrsti, brez slovenskih cen in urnikov.
              var gk = t.amenity === "fuel" ? "bencinska" : ABROAD_SHOP[t.shop];
              if (!gk) return null;
              var ad = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
              var fs = { id: e.type + "/" + e.id, name: nm + (ad ? ", " + ad : ""), short: nm, chain: gk, gk: gk, bt: [t.brand, t.name, t.operator].filter(Boolean).join(" "), duty: false, tuj: true, lat: lat, lon: lon, hours: t.opening_hours || "" };
              fs.chain = foreignChainOf(fs) || gk;
              return fs;
            }
            var kind = storeKind([t.brand, t.name, t.operator].join(" "), t.opening_hours);
            if (!kind && t.amenity === "fuel") kind = "bencinska";
            if (!kind) return null;
            var chain = kind === "duty" ? null : kind;
            // Bencinski servis brez imena verige: vseeno ga upoštevamo za tobak.
            if (!chain && t.amenity === "fuel") chain = "bencinska";
            var defHours = chain && CHAIN_BY_KEY[chain] && CHAIN_BY_KEY[chain].hours;
            var addr = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
            return { id: e.type + "/" + e.id, name: nm + (addr ? ", " + addr : ""), short: nm, chain: chain, duty: kind === "duty", lat: lat, lon: lon, hours: t.opening_hours || defHours || "" };
          }).filter(Boolean);
          applyOfficial(stores);
          lastFetchPos = { lat: p.lat, lon: p.lon };
          state.storesCache = { pos: lastFetchPos, list: stores, at: Date.now(), country: ctry };
          save();
          // Jezik po državi: preklopimo takoj, razen med nakupovanjem (takrat ob naslednjem odprtju).
          if (window.NK_COUNTRY) window.NK_COUNTRY(ctry, !activeStore);
          if (abroad() !== wasAbroad) renderAll();
          evaluateNear();
          renderStores();
          renderTrip(true);
        })
        .catch(function () { tryAt(i + 1); });
    };
    tryAt(0);
  }

  // ---------- Zaznavanje prihoda in odhoda (store-detect.js, enako kot iPhone v ozadju) ----------
  // Prihod: ~30 m od trgovine, natančen GPS, ne voziš, ~15 s. Odhod: 2–3 zanesljive meritve dlje od ~45 m.
  var det = window.NakupkoDetect ? new window.NakupkoDetect.Detector() : null;
  function detCfg() { if (det) det.config({ entry: state.settings.radius, dwell: state.settings.delay }); }
  detCfg();
  // Trgovine, ki pridejo v poštev: specializirana (npr. dm) le, če imaš izdelke zanjo.
  function candidates() {
    if (!lastPos) return [];
    return stores.filter(function (s) {
      if (s.lat == null || distM(lastPos, s) > 300) return false;
      var c = CHAIN_BY_KEY[s.chain];
      return !(c && c.only && !storeHasItems(s));
    }).map(function (s) { return { id: s.id, lat: s.lat, lon: s.lon, hasItems: storeHasItems(s) }; });
  }
  function storeHasItems(s) { return state.items.some(function (i) { return !i.done && forStore(s, i); }); }
  function storeById(id) {
    return stores.concat((state.storesCache && state.storesCache.list) || []).filter(function (x) { return x.id === id; })[0] || null;
  }
  function nearestStore() {
    if (!lastPos || !stores.length) return null;
    var best = null;
    stores.forEach(function (s) {
      if (CHAIN_BY_KEY[s.chain] && CHAIN_BY_KEY[s.chain].only && !storeHasItems(s)) return;
      var d = distM(lastPos, s);
      if (!best || d < best.d) best = { s: s, d: d };
    });
    return best;
  }
  // Trgovina je »tukaj«, ko si znotraj polmera prihoda (z upoštevanjem natančnosti GPS).
  function inRange(d, acc) { return d <= state.settings.radius + Math.min(acc || 0, 20) * 0.5; }
  var lastFixAt = 0;
  // repeat: ista meritev znova (GPS se ne oglasi, ko stojiš); šteje za prihod, ne pa za odhod.
  function feed(repeat) {
    if (!det || !lastPos) return;
    detCfg();
    var ev = det.update({ lat: lastPos.lat, lon: lastPos.lon, acc: lastPos.acc, speed: lastPos.speed == null ? -1 : lastPos.speed, time: Date.now() / 1000, repeat: !!repeat }, candidates());
    if (ev && ev.type === "left") leftStore(ev.id, false);
    if (ev && ev.type === "arrived") {
      var s = storeById(ev.id);
      lastNearStore = s;
      if (s && !(activeStore && activeStore.id === s.id) && !snoozed(s.id) && openState(s).open !== false) openStoreMode(s);
    }
  }
  // Odšel si: zapremo »V trgovini« (fromPhone: zaznal je iPhone v ozadju).
  function leftStore(id, fromPhone) {
    if (!activeStore || activeStore.id !== id) return;
    var name = activeStore.short || activeStore.name;
    if (!fromPhone) window.__nakupkoLeftAt = Date.now();  // iPhone: umakni seznam z zaklenjenega zaslona
    if (det && fromPhone) det.stop(Date.now() / 1000);
    activeStore = null;   // brez »snooze«: ob naslednjem prihodu se odpre znova
    $("storeMode").classList.add("hidden");
    document.body.style.overflow = "";
    renderAll();
    toast("Zapustil si " + name + ". Nakupovanje zaprto.");
  }
  function evaluateNear() {
    feed(false);
    lastFixAt = Date.now();
    updateBar();
  }
  // Vsako sekundo: odštevanje in ista meritev znova (ko stojiš, GPS ne pošilja novih).
  setInterval(function () {
    if (!lastPos || !det) return;
    if (!det.active && Date.now() - lastFixAt < 60000) feed(true);
    updateBar();
  }, 1000);
  function snoozed(id) {
    var t = state.dismissed["store:" + id];
    return t && Date.now() - t < 45 * 60000;
  }
  function stopCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; }
  function updateBar() {
    var bar = $("detectBar");
    var pend = det && det.pending ? storeById(det.pending.id) : null;
    if (activeStore || !pend || !lastPos) {
      lastNearStore = activeStore || (pend || null);
      bar.classList.add("hidden");
      return;
    }
    lastNearStore = pend;
    var left = det.remaining(Date.now() / 1000);
    bar.innerHTML = "";
    var sub = fmtDist(distM(lastPos, pend)) + " · GPS ±" + Math.round(lastPos.acc) + " m";
    var info = el("div", { class: "detect-info" }, [el("b", { text: pend.short || pend.name }), el("span", { text: sub })]);
    var os = openState(pend);
    if (os.open === false) {
      // Trgovina je zaprta: seznama ne odpremo sami, le povemo, kdaj se odpre.
      info.lastChild.textContent = os.text;
      bar.appendChild(info);
      bar.appendChild(el("button", { type: "button", onclick: function () { openStoreMode(pend); } }, ["Vseeno odpri"]));
      bar.classList.remove("hidden");
      return;
    }
    if (!snoozed(pend.id)) info.lastChild.textContent = sub + " · odpiram čez " + left + " s";
    bar.appendChild(info);
    bar.appendChild(el("button", { type: "button", onclick: function () { openStoreMode(pend); } }, ["Odpri"]));
    bar.classList.remove("hidden");
  }

  function renderStores() {
    var ul = $("storeList");
    ul.innerHTML = "";
    if (!lastPos && !stores.length) return;
    var ref = lastPos || lastFetchPos;
    var list = stores.map(function (s) { return { s: s, d: distM(ref, s) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 25);
    if (!list.length) { ul.appendChild(el("li", null, [el("span", { class: "muted", text: "V bližini ni najdenih trgovin." })])); return; }
    list.forEach(function (x) {
      var near = lastPos && inRange(x.d, lastPos.acc);
      var os = openState(x.s);
      var badge = el("span", { class: "store-badge", style: "background:" + ((CHAIN_BY_KEY[x.s.chain] || {}).color || "#7A8A84") }, [(x.s.short || "?").charAt(0).toUpperCase()]);
      ul.appendChild(el("li", { class: near ? "near" : "" }, [
        badge,
        el("div", { class: "sbody" }, [
          el("div", { class: "sname", text: x.s.name }),
          el("div", { class: "shours" + (os.open === false ? " closed" : ""), text: (near ? "Tukaj si · " : "") + os.text })
        ]),
        el("div", { class: "sright" }, [
          el("span", { class: "dist", text: fmtDist(x.d) }),
          el("button", { class: "mini", type: "button", onclick: function () { openStoreMode(x.s); } }, ["Sem tu"])
        ])
      ]));
    });
  }

  // ---------- Testni prihod v trgovino ----------
  // Prikaže, kaj se zgodi ob prihodu v trgovino, brez prave lokacije.
  var testMode = false;
  function startTest() {
    testMode = true;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (!state.items.some(function (i) { return !i.done; })) {
      ["Mleko", "Kruh beli", "Banane", "Jajca", "Kava mleta"].forEach(function (n) { addItem(n, "", 1, { silent: true }); });
    }
    delete state.dismissed["store:test/1"];
    lastPos = { lat: 46.0500, lon: 14.5000, acc: 12 };
    stores = [{ id: "test/1", name: "Spar (testna trgovina)", short: "Spar (test)", chain: "spar", lat: 46.0502, lon: 14.5003, hours: "Mo-Sa 07:00-21:00" }];
    if (det) det.pending = null;
    setLocStatus("Testni način: simuliram prihod v trgovino.");
    evaluateNear();
    renderStores();
    toast("Test: čez " + state.settings.delay + " s se odpre »V trgovini«.");
  }

  // Testni prihod lahko sproži tudi razvijalec na daljavo (datoteka remote.json).
  function checkRemote() {
    if (document.visibilityState !== "visible") return;
    fetch("remote.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.test) return;
        var t = Date.parse(d.test);
        if (!t || t <= (state.settings.remoteSeen || 0) || Date.now() - t > 15 * 60000) return;
        state.settings.remoteSeen = t; save();
        startTest();
      })
      .catch(function () {});
  }

  // ---------- Način »V trgovini« ----------
  var storeModeOpenedAt = 0;
  function openStoreMode(store) {
    activeStore = store || lastNearStore || null;
    storeModeOpenedAt = Date.now();
    // Odhod iz te trgovine spremljamo od zdaj (tudi če si jo odprl ročno).
    if (det) { if (activeStore && activeStore.lat != null) det.start(activeStore, Date.now() / 1000); else det.stop(Date.now() / 1000); }
    $("smTitle").textContent = activeStore ? activeStore.name : "Nakupovanje";
    $("storeMode").classList.remove("hidden");
    $("detectBar").classList.add("hidden");
    document.body.style.overflow = "hidden";
    renderStoreMode();
  }
  function closeStoreMode() {
    if (activeStore) { state.dismissed["store:" + activeStore.id] = Date.now(); save(); }
    if (det) det.stop(Date.now() / 1000);
    activeStore = null;
    $("storeMode").classList.add("hidden");
    document.body.style.overflow = "";
    renderAll();
  }
  function renderStoreMode() {
    if ($("storeMode").classList.contains("hidden")) return;
    var ul = $("smList");
    ul.innerHTML = "";
    var all = state.items.filter(function (i) { return !i.done; });
    var open = all.filter(function (i) { return forStore(activeStore, i); });
    var other = all.filter(function (i) { return !forStore(activeStore, i); });
    // kupljeno pokažemo samo, če je bilo odkljukano zdaj v trgovini (da lahko razveljaviš)
    var done = state.items.filter(function (i) { return i.done && i.doneAt && i.doneAt >= storeModeOpenedAt; });
    open.concat(done).forEach(function (it) { ul.appendChild(itemRow(it, true, activeStore)); });
    if (other.length) ul.appendChild(otherSection(other, true, activeStore));
    $("smEmpty").classList.toggle("hidden", open.length > 0);
    var total = open.length + done.length;
    $("smBar").style.width = (total ? Math.round(done.length / total * 100) : 100) + "%";
    var sum = 0;
    open.forEach(function (it) { var p = activeStore && activeStore.chain ? priceFor(it, activeStore.chain) : null; if (!p || p.price == null) p = prefPrice(it); if (p) sum += p.price * (it.qty || 1); });
    $("smProgress").textContent = done.length + " od " + total + " v košarici" + (open.length && !pricesOff() ? " · še ≈ " + eur(sum) : "");
    renderRecoInto($("smReco"), activeStore);
  }

  // ---------- Cene: primerjava, tabela, uvoz ----------
  function compareRows(open) {
    return compareChains().map(function (c) {
      var sum = 0, est = 0, missing = 0;
      open.forEach(function (it) {
        var p = priceFor(it, c);
        if (p.price == null) missing++;
        else { sum += p.price * (it.qty || 1); if (p.est) est++; }
      });
      return { c: c, sum: sum, est: est, missing: missing };
    }).sort(function (a, b) { return (abroad() ? a.missing - b.missing : 0) || a.sum - b.sum; });
  }
  function renderHero() {
    var open = state.items.filter(function (i) { return !i.done; });
    $("heroCount").textContent = open.length;
    $("heroCount").parentNode.classList.toggle("long", open.length > 99);
    $("heroSide").classList.toggle("hidden", pricesOff());
    if (pricesOff()) return;
    $("heroLabel").textContent = "Ocena košarice";
    if (!open.length) { $("heroTotal").textContent = "–"; $("heroBest").textContent = ""; return; }
    // »≈ 10,61 €« in pod njim trgovina v oklepaju: najcenejša ali tvoje trgovine (npr. Hofer/Lidl).
    if (pref().chains) {
      var total = 0;
      open.forEach(function (it) { var p = prefPrice(it); if (p) total += p.price * (it.qty || 1); });
      $("heroTotal").textContent = "≈ " + eur(total);
      $("heroBest").textContent = "(" + pref().chains.map(function (c) { return CHAIN_BY_KEY[c].name; }).join("/") + ")";
      return;
    }
    var rows = compareRows(open);
    if (!rows.length) { $("heroTotal").textContent = "–"; $("heroBest").textContent = ""; return; }
    $("heroTotal").textContent = "≈ " + eur(rows[0].sum);
    $("heroBest").textContent = "(" + CHAIN_BY_KEY[rows[0].c].name + ")";
  }
  // ---------- Zavihek »Trgovine«: skupna cena seznama po trgovinah ----------
  var LOGO_IMG = { hofer: "hofer", lidl: "lidl", spar: "spar", eurospin: "eurospin" };
  var LOGO_WORD = { mercator: ["#E2231A", "Mercator", 11], tus: ["#E30613", "TUŠ", 20], jager: ["#2E8B3E", "JAGER", 14] };
  function chainLogo(c) {
    if (LOGO_IMG[c]) return el("span", { class: "slogo" }, [el("img", { src: "logos/" + LOGO_IMG[c] + ".png", alt: "" })]);
    var w = LOGO_WORD[c], ch = CHAIN_BY_KEY[c] || {};
    if (w) return el("span", { class: "slogo" }, [el("span", { class: "wm", style: "background:" + w[0] + ";font-size:" + w[2] + "px", text: w[1] })]);
    return el("span", { class: "slogo" }, [el("span", { class: "wm", style: "background:" + (ch.color || "#8A3FFC") + ";font-size:26px", text: (ch.name || c).charAt(0).toUpperCase() })]);
  }
  // Najbližja trgovina te verige (za pot do nje), če poznamo lokacijo.
  function nearestOfChain(c) {
    var ref = lastPos || lastFetchPos, best = null;
    if (!ref) return null;
    stores.forEach(function (s) {
      if (s.chain !== c || s.lat == null || /^test\//.test(s.id)) return;
      var d = distM(ref, s);
      if (!best || d < best.d) best = { s: s, d: d };
    });
    return best;
  }
  function openChainMap(c) {
    var n = nearestOfChain(c);
    if (n) { openRoute(n.s); return; }
    var q = encodeURIComponent((CHAIN_BY_KEY[c] || {}).name || c);
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    window.open(ios ? "https://maps.apple.com/?q=" + q : "https://www.google.com/maps/search/?api=1&query=" + q, "_blank");
  }
  var storeSort = "price";
  function renderStoresPane() {
    var grid = $("storeGrid"), note = $("storesNote");
    if (!grid) return;
    grid.innerHTML = "";
    var open = state.items.filter(function (i) { return !i.done; });
    var msg = "";
    if (!open.length) msg = "Dodaj izdelke na seznam za primerjavo.";
    else if (pricesOff()) msg = state.settings.pricePref === "none" ? "Cene so izklopljene. Vklopiš jih v Nastavitvah pod »Moje trgovine«." : "Za trgovine v tej državi cen še nimamo.";
    var rows = msg ? [] : compareRows(open).filter(function (r) { return r.missing < open.length; });
    if (!msg && !rows.length) msg = "Za trgovine v tej državi cen še nimamo.";
    note.textContent = msg;
    note.classList.toggle("hidden", !msg);
    $("storesBar").classList.toggle("hidden", !rows.length);
    if (!rows.length) return;
    var best = rows[0];
    rows.forEach(function (r) { r.near = nearestOfChain(r.c); });
    var hasDist = rows.some(function (r) { return r.near; });
    var opt = $("storeSort").querySelector('option[value="dist"]');
    if (opt) opt.disabled = !hasDist;
    $("storesBar").classList.toggle("one", !hasDist);
    var list = rows.slice();
    if (storeSort === "dist" && hasDist) list.sort(function (a, b) { return (a.near ? a.near.d : 1e12) - (b.near ? b.near.d : 1e12); });
    list.forEach(function (r) {
      var c = CHAIN_BY_KEY[r.c], isBest = r === best;
      var tot = eur(r.sum);
      grid.appendChild(el("div", { class: "stile" + (isBest ? " best" : "") }, [
        el("div", { class: "stop" }, [
          chainLogo(r.c),
          el("div", { class: "sname-wrap" }, [
            el("div", { class: "stname", text: c.name }),
            isBest ? el("div", { class: "stag", text: "Najceneje" }) : el("div", { class: "stag m", text: "+" + eur(r.sum - best.sum) }),
            r.near ? el("div", { class: "sdist", text: fmtDist(r.near.d) }) : null,
            r.missing ? el("div", { class: "sdist" }, [r.missing + " ", el("span", { text: "brez cene" })]) : null
          ])
        ]),
        el("div", { class: "sbot" }, [
          el("div", null, [el("div", { class: "sk", text: "Skupaj" }), el("div", { class: "sv" + (tot.length > 8 ? " long" : ""), text: tot })]),
          el("button", { class: "spin", type: "button", "aria-label": "Pokaži pot", onclick: function () { openChainMap(r.c); } },
            [svgEl('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>')])
        ])
      ]));
    });
  }
  function svgEl(inner) {
    var w = document.createElement("span");
    w.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + "</svg>";
    return w.firstChild;
  }
  function renderCompare() {
    var ul = $("compare");
    ul.innerHTML = "";
    var open = state.items.filter(function (i) { return !i.done; });
    if (!open.length) { ul.appendChild(el("li", { class: "muted" }, ["Dodaj izdelke na seznam za primerjavo."])); return; }
    var rows = compareRows(open);
    if (!rows.length) return;
    var max = Math.max.apply(null, rows.map(function (r) { return r.sum; })) || 1;
    rows.forEach(function (r, i) {
      var note = r.missing ? r.missing + " brez cene" : "";
      ul.appendChild(el("li", { class: i === 0 ? "best" : "" }, [
        el("div", { class: "cmp-row" }, [
          el("span", { class: "cmp-name" }, [chainDot(r.c), CHAIN_BY_KEY[r.c].name, i === 0 ? el("span", { class: "tag ok", text: "najceneje" }) : null,
            (myChains() || []).indexOf(r.c) >= 0 ? el("span", { class: "tag", text: "tvoja" }) : null]),
          el("span", { class: "cmp-sum", text: eur(r.sum) + (i > 0 ? "  +" + eur(r.sum - rows[0].sum) : "") })
        ]),
        el("div", { class: "cmp-track" }, [el("div", { class: "cmp-fill", style: "width:" + Math.max(6, Math.round(r.sum / max * 100)) + "%;background:" + CHAIN_BY_KEY[r.c].color })]),
        note ? el("div", { class: "cmp-note", text: note }) : null
      ]));
    });
  }
  function renderPriceTable() {
    var q = norm($("priceSearch").value);
    var list = CATALOG.filter(function (p) { return !q || norm(p.name).indexOf(q) >= 0 || norm(p.cat).indexOf(q) >= 0; });
    // dodaj uvožene izdelke, ki jih ni v katalogu
    Object.keys(state.prices).forEach(function (k) {
      if (!CATALOG_BY_KEY[k] && (!q || k.indexOf(q) >= 0)) list.push({ name: state.prices[k]._name || capital(k), unit: "" });
    });
    var table = el("table");
    var head = el("tr", null, [el("th", { text: "Izdelek" })].concat(COMPARE_CHAINS.map(function (c) { return el("th", { text: CHAIN_BY_KEY[c].name }); })));
    table.appendChild(head);
    list.slice(0, 300).forEach(function (p) {
      var ps = COMPARE_CHAINS.map(function (c) { return priceFor(p.name, c); });
      var min = Math.min.apply(null, ps.map(function (x) { return x.price == null ? Infinity : x.price; }));
      table.appendChild(el("tr", null, [el("td", { text: p.name + (p.unit ? " (" + p.unit + ")" : "") })].concat(ps.map(function (x) {
        return el("td", { class: x.price === min ? "min" : "", text: x.price == null ? "–" : x.price.toFixed(2).replace(".", ",") + (x.est ? "*" : "") });
      }))));
    });
    var box = $("priceTable");
    box.innerHTML = "";
    box.appendChild(table);
    var n = Object.keys(state.prices).length;
    var auto = Object.keys(BASE_PRICES).length;
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(PRICES_DATE || "");
    var dateTxt = d ? Number(d[3]) + ". " + Number(d[2]) + ". " + d[1] : "";
    $("pricesInfo").textContent = auto
      ? "Cene se samodejno osvežujejo vsako noč ob 3h" + (dateTxt ? ", zadnja osvežitev " + dateTxt : "") + ". Zvezdica (*) pomeni, da za to trgovino ni cene in je prikazana ocena."
      : "Samodejne cene še niso prenesene. Prikazane so okvirne ocene (*).";
    $("importInfo").textContent = n
      ? "Ročno uvoženih cen: " + n + (state.pricesUpdated ? ", uvoženo " + new Date(state.pricesUpdated).toLocaleDateString("sl-SI") : "") + "."
      : "";
  }

  var HELP = [
    "Prilepi to v ChatGPT ali Claude:",
    "",
    "»Pripravi JSON s trenutnimi cenami v trgovinah Spar, Mercator, Tuš, Lidl in Hofer v Sloveniji za te izdelke: " +
      "[naštej izdelke]. Če cene za trgovino ne najdeš, to trgovino izpusti. Vrni samo JSON v obliki:",
    '{"izdelki":[{"ime":"Mleko","cene":{"spar":1.19,"mercator":1.25,"tus":1.22,"lidl":0.99,"hofer":0.99}}]}«',
    "",
    "Nato JSON shrani v datoteko in jo uvozi z »Uvozi cene« ali ga prilepi z »Prilepi JSON«.",
    "Ključi trgovin: spar, mercator, tus, lidl, hofer, eurospin, jager, leclerc.",
    "Če za kakšno trgovino ni cene, Nakupko uporabi povprečje cen drugih trgovin."
  ].join("\n");

  function importPrices(text) {
    var data;
    try { data = JSON.parse(String(text).trim().replace(/^```(json)?/i, "").replace(/```$/, "")); }
    catch (e) { toast("To ni veljaven JSON."); return; }
    var entries = [];
    if (Array.isArray(data)) entries = data;
    else if (data && Array.isArray(data.izdelki)) entries = data.izdelki;
    else if (data && Array.isArray(data.products)) entries = data.products;
    else if (data && typeof data === "object") entries = Object.keys(data).map(function (k) { return { ime: k, cene: data[k] }; });
    var count = 0;
    entries.forEach(function (e) {
      var name = e.ime || e.name || e.izdelek;
      var cene = e.cene || e.prices;
      if (!name || !cene || typeof cene !== "object") return;
      var rec = {};
      Object.keys(cene).forEach(function (k) {
        var ck = CHAIN_BY_KEY[norm(k)] ? norm(k) : chainOf(k);
        var v = typeof cene[k] === "string" ? parseFloat(cene[k].replace(",", ".")) : cene[k];
        if (ck && typeof v === "number" && isFinite(v) && v > 0) rec[ck] = Math.round(v * 100) / 100;
      });
      if (Object.keys(rec).length) {
        var key = norm(name);
        var p = CATALOG_BY_KEY[key];
        rec._name = p ? p.name : capital(name);
        state.prices[key] = Object.assign(state.prices[key] || {}, rec);
        count++;
      }
    });
    if (!count) { toast("V datoteki ni najdenih cen."); return; }
    state.pricesUpdated = Date.now();
    save();
    renderAll();
    toast("Uvoženih cen: " + count);
  }
  function priceKeysClean() {
    // _name ni cena; poskrbi, da ga priceFor ne šteje
    Object.keys(state.prices).forEach(function (k) {
      var r = state.prices[k];
      if (r && typeof r._name !== "string") delete r._name;
    });
  }

  // ---------- Izris ----------
  function renderPrefChoices(box, onPick, opts) {
    opts = opts || {};
    box.innerHTML = "";
    var keys = opts.second ? ["discount", "eurojag", "classic"].filter(function (k) { return k !== state.settings.pricePref; }).concat(["skip"])
      : ["discount", "eurojag", "classic", "all", "none"];
    var cur = opts.second ? (pref2() ? state.settings.pricePref2 : "skip") : state.settings.pricePref;
    keys.forEach(function (k) {
      if (k === "skip") {
        box.appendChild(el("button", { class: "pref-opt" + (cur === "skip" ? " on" : ""), type: "button", onclick: function () { onPick(null); } }, [
          el("div", { class: "pref-text" }, [el("b", { text: "Ni druge izbire" }), el("span", { text: "Hodim samo v prve" })])
        ]));
        return;
      }
      var p = PREFS[k];
      var dots = el("span", { class: "pref-dots" }, (p.chains || (k === "all" ? COMPARE_CHAINS : [])).map(chainDot));
      var sub = { discount: "Diskontni trgovini", eurojag: "Ugodni trgovini", classic: "Klasični supermarketi", all: "Primerjam vse in pokažem najnižjo ceno", none: "Brez cen, samo seznam" }[k];
      box.appendChild(el("button", { class: "pref-opt" + (cur === k ? " on" : ""), type: "button", onclick: function () { onPick(k); } }, [
        el("div", { class: "pref-text" }, [el("b", { text: p.label }), el("span", { text: sub })]), dots
      ]));
    });
  }
  function renderPrefs() {
    renderPrefChoices($("prefBox"), setPref);
    $("pref2Wrap").classList.toggle("hidden", !pref().chains);
    if (pref().chains) renderPrefChoices($("pref2Box"), setPref2, { second: true });
  }
  function setPref(k) {
    var first = !state.settings.pricePref;
    state.settings.pricePref = k;
    if (state.settings.pricePref2 === k) state.settings.pricePref2 = null;
    save();
    renderPrefs();
    renderAll();
    // ob prvem zagonu še vprašaj za drugo izbiro
    if (first && PREFS[k].chains) {
      $("obTitle").textContent = "Pa druga izbira?";
      $("obText").textContent = "Kam greš, ko ne greš v " + PREFS[k].short + "? Tako lahko Nakupko predlaga, kdaj se splača obiskati dve bližnji trgovini.";
      renderPrefChoices($("onboardBox"), function (k2) { setPref2(k2); askSize(); }, { second: true });
      return;
    }
    if (first && !state.settings.size) { askSize(); return; }
    $("onboard").classList.add("hidden");
    toast(k === "none" ? "Cene so skrite." : "Cene računam za: " + PREFS[k].label);
  }
  function setPref2(k) {
    state.settings.pricePref2 = k; save();
    renderPrefs();
    renderAll();
    toast(k ? "Druga izbira: " + PREFS[k].label : "Brez druge izbire.");
  }
  // ---------- Velikost prikaza po starosti ----------
  var SIZES = {
    young: { label: "Mlajši", sub: "Običajen prikaz, krepkejše črke", zoom: 1 },
    mid: { label: "Srednja leta", sub: "Malo večje besedilo in slike", zoom: 1.1 },
    senior: { label: "Starejši", sub: "Veliko besedilo in slike, preprostejši prikaz", zoom: 1.25 }
  };
  function applySize() {
    var k = SIZES[state.settings.size] ? state.settings.size : "young";
    document.documentElement.classList.remove("size-young", "size-mid", "size-senior");
    document.documentElement.classList.add("size-" + k);
  }
  function renderSizeChoices(box, onPick) {
    box.innerHTML = "";
    ["young", "mid", "senior"].forEach(function (k) {
      var s = SIZES[k];
      box.appendChild(el("button", { class: "pref-opt size-opt" + (state.settings.size === k ? " on" : ""), type: "button", onclick: function () { onPick(k); } }, [
        el("div", { class: "pref-text" }, [el("b", { text: s.label }), el("span", { text: s.sub })]),
        el("span", { class: "size-aa", style: "font-size:" + Math.round(16 * s.zoom) + "px", text: "Aa" })
      ]));
    });
  }
  function setSize(k) {
    state.settings.size = k; save();
    applySize();
    renderSizeChoices($("sizeBox"), setSize);
  }
  function askSize() {
    $("obTitle").textContent = "Kako velik naj bo prikaz?";
    $("obText").textContent = "Izberi, kar ti je najlažje brati. Spremeniš lahko kadar koli v Nastavitvah.";
    renderSizeChoices($("onboardBox"), function (k) { setSize(k); $("onboard").classList.add("hidden"); toast("Prikaz: " + SIZES[k].label); });
    $("onboard").classList.remove("hidden");
  }
  function maybeOnboard() {
    if (state.settings.pricePref && !state.settings.size) { askSize(); return; }
    if (state.settings.pricePref) return;
    renderPrefChoices($("onboardBox"), setPref);
    $("onboard").classList.remove("hidden");
  }

  // ---------- Ena ali dve trgovini? ----------
  // Primerja nakup v eni trgovini z nakupom v dveh, ki sta druga ob drugi (do 400 m).
  var PAIR_MAX = 400, TRIP_MAX = 4000;
  function tripPlan() {
    if (pricesOff()) return null;
    var open = state.items.filter(function (i) { return !i.done && sells(null, i); });
    if (open.length < 2) return null;
    var ref = lastPos || lastFetchPos;
    if (!ref || !stores.length) return null;
    var allowed = myChains();
    var mine = abroad() ? compareChains() : allowed;
    var cand = stores.filter(function (s) { return s.chain && CHAIN_BY_KEY[s.chain] && !CHAIN_BY_KEY[s.chain].only && !/^test\//.test(s.id) && (!mine || mine.indexOf(s.chain) >= 0); })
      .map(function (s) { return { s: s, d: distM(ref, s) }; })
      .filter(function (x) { return x.d <= TRIP_MAX; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 60);
    if (!cand.length) return { none: true };
    var price = {}, cost = {};
    cand.forEach(function (x) {
      var c = x.s.chain;
      if (cost[c] != null) return;
      price[c] = open.map(function (it) { var p = priceFor(it, c); return p.price == null ? null : p.price * (it.qty || 1); });
      cost[c] = price[c].reduce(function (a, v) { return a + (v || 0); }, 0);
    });
    // V tujini cene niso popolne: manjkajočo ceno štejemo kot najdražjo znano, da trgovina brez podatkov ni »najcenejša«.
    if (abroad()) {
      var mx = open.map(function (it, k) { return Object.keys(price).reduce(function (m, c) { return Math.max(m, price[c][k] || 0); }, 0); });
      Object.keys(price).forEach(function (c) { cost[c] = price[c].reduce(function (a, v, k) { return a + (v == null ? mx[k] : v); }, 0); });
    }
    // ena trgovina: najbližja, razen če je druga občutno cenejša
    var nearest = cand[0];
    var cheapest = cand.slice().sort(function (a, b) { return cost[a.s.chain] - cost[b.s.chain] || a.d - b.d; })[0];
    var diff = cost[nearest.s.chain] - cost[cheapest.s.chain];
    var M = moneyScale();
    var single = diff >= Math.max(1.5 * M, cost[nearest.s.chain] * 0.05) ? cheapest : nearest;
    var singleCost = cost[single.s.chain];
    // dve trgovini, ki sta skupaj
    var pairCost = {}, best = null;
    for (var i = 0; i < cand.length; i++) {
      for (var j = i + 1; j < cand.length; j++) {
        var a = cand[i], b = cand[j];
        if (a.s.chain === b.s.chain) continue;
        var gap = distM(a.s, b.s);
        if (gap > PAIR_MAX) continue;
        var key = [a.s.chain, b.s.chain].sort().join("+");
        if (pairCost[key] == null) {
          var pa = price[a.s.chain], pb = price[b.s.chain];
          pairCost[key] = pa.reduce(function (sum, v, k) { var w = pb[k]; return sum + (v == null ? (w || 0) : w == null ? v : Math.min(v, w)); }, 0);
        }
        var far = Math.max(a.d, b.d);
        if (!best || pairCost[key] < best.cost - 0.01 || (Math.abs(pairCost[key] - best.cost) <= 0.01 && far < best.far)) best = { a: a, b: b, gap: gap, cost: pairCost[key], far: far };
      }
    }
    var plan = { single: single, singleCost: singleCost, nearest: nearest, nearestCost: cost[nearest.s.chain], items: open };
    if (best) {
      var saving = singleCost - best.cost;
      plan.pair = best; plan.saving = saving;
      plan.split = saving >= Math.max(2 * M, singleCost * 0.08);
      if (plan.split) {
        var pa2 = price[best.a.s.chain], pb2 = price[best.b.s.chain];
        plan.listA = []; plan.listB = [];
        open.forEach(function (it, k) { var v = pa2[k], w = pb2[k]; ((w != null && (v == null || w < v)) ? plan.listB : plan.listA).push(it.name); });
      }
    }
    return plan;
  }
  function mapsLink(s) { return "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lon; }
  // ---------- Pot do trgovine ----------
  // iPhone: zemljevid s potjo (Apple Zemljevidi) in en dotik do navigacije; drugje izbira aplikacije za navigacijo.
  function openRoute(s) {
    if (!s || s.lat == null) return;
    if (window.__nakupkoShowRoute) { window.__nakupkoShowRoute(s); return; }
    var sheet = el("div", { class: "route-sheet", role: "dialog", "aria-modal": "true" });
    var close = function () { sheet.remove(); };
    var ll = s.lat + "," + s.lon;
    sheet.appendChild(el("div", { class: "route-box" }, [
      el("h2", { text: s.short || s.name }),
      el("p", { class: "muted small", text: routeEtaText(s) }),
      el("a", { class: "primary full", href: "https://maps.apple.com/?daddr=" + ll + "&dirflg=d", target: "_blank", rel: "noopener" }, ["Apple Zemljevidi"]),
      el("a", { class: "ghost full", href: mapsLink(s), target: "_blank", rel: "noopener" }, ["Google Zemljevidi"]),
      el("a", { class: "ghost full", href: "https://waze.com/ul?ll=" + ll + "&navigate=yes", target: "_blank", rel: "noopener" }, ["Waze"]),
      el("button", { class: "link", type: "button", onclick: close }, ["Zapri"])
    ]));
    sheet.addEventListener("click", function (e) { if (e.target === sheet) close(); });
    document.body.appendChild(sheet);
  }
  // Okviren čas poti iz razdalje (ceste so ~1,3× daljše od zračne črte); iPhone ga nadomesti s pravim (Apple Zemljevidi).
  var routeEta = {};
  function routeEtaText(s) {
    var r = routeEta[s.id];
    if (r && r.walkMin != null) return "≈ " + r.walkMin + " min peš · " + (r.driveMin != null ? r.driveMin : "–") + " min z avtom";
    var ref = lastPos || lastFetchPos;
    if (!ref) return "";
    var d = distM(ref, s) * 1.3;
    return "≈ " + Math.max(1, Math.round(d / 80)) + " min peš · " + Math.max(1, Math.round(d / 450 + 1)) + " min z avtom";
  }
  function routeButton(s) {
    var wrap = el("div", { class: "trip-route" }, [
      el("span", { class: "muted small trip-eta", text: routeEtaText(s) }),
      el("button", { class: "mini trip-go", type: "button", onclick: function () { openRoute(s); } }, ["Pokaži pot"])
    ]);
    // pravi čas poti z iPhona (Apple Zemljevidi), ko je na voljo
    if (window.__nakupkoRouteInfo && !routeEta[s.id]) {
      routeEta[s.id] = {};
      window.__nakupkoRouteInfo(s).then(function (r) {
        if (r && r.walkMin != null) { routeEta[s.id] = r; var e = wrap.querySelector(".trip-eta"); if (e) e.textContent = routeEtaText(s); }
      }).catch(function () { delete routeEta[s.id]; });
    }
    return wrap;
  }
  function storeLabel(x) { return el("span", { class: "trip-store" }, [chainDot(x.s.chain), CHAIN_BY_KEY[x.s.chain].name, el("small", { text: " " + fmtDist(x.d) })]); }
  // Samo tobak na seznamu: najbližja trafika in bencinski servis namesto supermarketa.
  function tobaccoPlan() {
    var open = state.items.filter(function (i) { return !i.done; });
    var catOf = function (i) { var p = CATALOG_BY_KEY[norm(i.name)]; return (p && p.cat) || i.cat || "Drugo"; };
    if (!open.length) return null;
    var onlyTobacco = open.every(function (i) { return catOf(i) === "Tobak"; });
    // Nedelja/praznik: tobak, pijača in prigrizki → bencinski servis (trgovine so zaprte).
    var sunday = !onlyTobacco && fuelDay() && open.every(function (i) { return /^(Tobak|Pijače|Prigrizki)$/.test(catOf(i)); });
    if (!onlyTobacco && !sunday) return null;
    var ref = lastPos || lastFetchPos;
    if (!ref) return null;
    var best = {};
    stores.forEach(function (s) {
      // Cigarete le v prodajalnah, kjer jih ta država dovoli (drzave.js); ob zaprti nedelji bencinska.
      if (sunday ? s.chain !== "bencinska" : !/^(trafika|kiosk|bencinska)$/.test(s.chain || "") || !sellsTobacco(s)) return;
      if (openState(s).open === false) return;
      var d = distM(ref, s);
      if (d > TRIP_MAX * 2) return;
      if (!best[s.chain] || d < best[s.chain].d) best[s.chain] = { s: s, d: d };
    });
    return { sunday: sunday, list: [best.trafika, best.kiosk, best.bencinska].filter(Boolean).sort(function (a, b) { return a.d - b.d; }) };
  }
  function renderTobaccoInto(box, tp) {
    box.innerHTML = "";
    box.classList.remove("hidden");
    box.appendChild(el("div", { class: "card-head" }, [el("h2", { text: "Kam po nakup?" }), el("span", { class: "tag", text: tp.sunday ? "trgovine so zaprte" : "samo tobak" })]));
    if (!tp.list.length) { box.appendChild(el("p", { class: "muted small", text: tp.sunday ? "V bližini ni odprtega bencinskega servisa." : "V bližini ni odprte trafike ali bencinskega servisa. Tobak imajo tudi trgovine." })); return; }
    var x = tp.list[0];
    box.appendChild(el("div", { class: "trip-main" }, [
      el("div", { class: "trip-title", text: tp.sunday ? "Bencinski servis ima vse s tvojega seznama" : "Na seznamu imaš samo tobak" }),
      el("div", { class: "trip-stores" }, tp.list.map(function (y) { return el("span", { class: "trip-store" }, [chainDot(y.s.chain), y.s.short || CHAIN_BY_KEY[y.s.chain].name, el("small", { text: " " + fmtDist(y.d) })]); })),
      el("div", { class: "trip-sub", text: (tp.sunday ? "Danes so trgovine zaprte. " : "Hitreje kot v supermarketu: ") + (x.s.short || CHAIN_BY_KEY[x.s.chain].name) + " je " + fmtDist(x.d) + " stran. " + openState(x.s).text + "." })
    ]));
    box.appendChild(routeButton(x.s));
  }
  function renderTripInto(box) {
    var tp = tobaccoPlan();
    if (tp) return renderTobaccoInto(box, tp);
    var plan = tripPlan();
    box.innerHTML = "";
    if (!plan) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.appendChild(el("div", { class: "card-head" }, [el("h2", { text: "Kam po nakup?" }), el("span", { class: "tag", text: "glede na tvojo lokacijo" })]));
    if (plan.none) { box.appendChild(el("p", { class: "muted small", text: "V bližini ni tvojih trgovin." })); return; }
    if (plan.split) {
      var p = plan.pair;
      box.appendChild(el("div", { class: "trip-main split" }, [
        el("div", { class: "trip-title", text: "Splača se iti v dve trgovini" }),
        el("div", { class: "trip-stores" }, [storeLabel(p.a), el("b", { text: "+" }), storeLabel(p.b)]),
        el("div", { class: "trip-sub", text: "Sta " + fmtDist(p.gap) + " narazen. Prihraniš ≈ " + eur(plan.saving) + " (" + eur(p.cost) + " namesto " + eur(plan.singleCost) + " samo v trgovini " + CHAIN_BY_KEY[plan.single.s.chain].name + ")." })
      ]));
      var lists = el("div", { class: "trip-lists" }, [
        el("div", null, [el("b", { text: CHAIN_BY_KEY[p.a.s.chain].name + ": " }), plan.listA.join(", ") || "–"]),
        el("div", null, [el("b", { text: CHAIN_BY_KEY[p.b.s.chain].name + ": " }), plan.listB.join(", ") || "–"])
      ]);
      box.appendChild(lists);
      box.appendChild(routeButton(p.a.d <= p.b.d ? p.a.s : p.b.s));
      return;
    }
    var s = plan.single;
    var sub = "Celoten seznam ≈ " + eur(plan.singleCost) + ".";
    if (s !== plan.nearest) sub += " Najbližja " + CHAIN_BY_KEY[plan.nearest.s.chain].name + " bi bila ≈ " + eur(plan.nearestCost - plan.singleCost) + " dražja.";
    if (plan.pair) sub += plan.saving > 0.05 ? " Dve trgovini bi prihranili le " + eur(plan.saving) + ", ne splača se." : " Druga trgovina ne bi nič prihranila.";
    else sub += " Dveh tvojih trgovin skupaj ni v bližini.";
    box.appendChild(el("div", { class: "trip-main" }, [
      el("div", { class: "trip-title", text: "Pojdi v eno trgovino" }),
      el("div", { class: "trip-stores" }, [storeLabel(s)]),
      el("div", { class: "trip-sub", text: sub })
    ]));
    box.appendChild(routeButton(s.s));
  }
  var tripPos = null;
  function renderTrip(force) {
    if (!force && lastPos && tripPos && distM(tripPos, lastPos) < 150) return;
    tripPos = lastPos;
    renderTripInto($("tripBox"));
    renderTripInto($("tripBox2"));
  }

  function renderAll() {
    renderTrip(true);
    renderHero();
    renderList();
    renderQuick();
    renderReco();
    renderCompare();
    renderStoresPane();
    if ($("pricesMore").open) renderPriceTable();
    renderStoreMode();
  }

  // ---------- Dogodki ----------
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.id === "tab-" + b.dataset.tab); });
      if (b.dataset.tab === "prices") renderPriceTable();
      if (b.dataset.tab === "stores") renderStores();
      window.scrollTo(0, 0);
    });
  });
  $("pricesMore").addEventListener("toggle", function () { if ($("pricesMore").open) renderPriceTable(); });
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      document.querySelectorAll(".seg button").forEach(function (x) { x.classList.toggle("on", x === b); });
      $("filterLabel").textContent = b.textContent;
      setFilterMenu(false);
      renderList();
    });
  });
  // Izbira »Hiter seznam / Ta trgovina / Kupljeno« kot spustni seznam.
  function setFilterMenu(open) {
    document.querySelector("#listBar .seg").classList.toggle("hidden", !open);
    $("filterBtn").setAttribute("aria-expanded", open ? "true" : "false");
  }
  $("filterBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    setFilterMenu($("filterBtn").getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#listBar .dd")) setFilterMenu(false);
    if (swipedRow && (!e.target.closest || !e.target.closest("li.item.swiped"))) closeSwipe();
  });
  // Zavihka nad seznamom: SEZNAM / TRGOVINE.
  function setPane(p) {
    var stores_ = p === "stores";
    $("ftList").classList.toggle("on", !stores_); $("ftList").setAttribute("aria-selected", String(!stores_));
    $("ftStores").classList.toggle("on", stores_); $("ftStores").setAttribute("aria-selected", String(stores_));
    $("paneList").classList.toggle("hidden", stores_);
    $("paneStores").classList.toggle("hidden", !stores_);
    if (stores_) renderStoresPane();
  }
  $("ftList").addEventListener("click", function () { setPane("list"); });
  $("ftStores").addEventListener("click", function () { setPane("stores"); });
  $("storeSort").addEventListener("change", function (e) { storeSort = e.target.value; renderStoresPane(); });

  $("addInput").addEventListener("input", function () {
    pendingProduct = null; pendingBrand = null; $("brandPick").classList.add("hidden"); selIdx = -1; renderSuggest();
  });
  $("addInput").addEventListener("keydown", function (e) {
    var items = $("suggest").querySelectorAll("li");
    if (e.key === "ArrowDown" && items.length) { selIdx = Math.min(items.length - 1, selIdx + 1); renderSuggest(); e.preventDefault(); }
    else if (e.key === "ArrowUp" && items.length) { selIdx = Math.max(-1, selIdx - 1); renderSuggest(); e.preventDefault(); }
    else if (e.key === "Escape") { $("suggest").classList.add("hidden"); }
  });
  $("addInput").addEventListener("blur", function () { setTimeout(function () { $("suggest").classList.add("hidden"); }, 150); });
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("addInput").value.trim();
    if (pendingProduct) { confirmPick(); return; }
    if (!v) return;
    var res = searchAll(v);
    if (selIdx >= 0 && res[selIdx]) { chooseResult(res[selIdx]); return; }
    var exact = catalogFind(v);
    if (exact) return pickProduct(exact.name);
    // »redbull« → Energijska pijača (Red Bull), če se ime izdelka ne ujema.
    var b = res.filter(function (r) { return r.group; })[0];
    if (b && !res.some(function (r) { return !r.group && norm(r.p.name).indexOf(norm(v)) === 0; })) return chooseResult(b);
    pickProduct(v);
  });
  $("clearDone").addEventListener("click", function () {
    state.items = state.items.filter(function (i) { return !i.done; });
    save(); renderAll();
  });

  $("btnStoreMode").addEventListener("click", function () { openStoreMode(lastNearStore); });
  $("smClose").addEventListener("click", closeStoreMode);
  $("smAdd").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("smInput").value.trim();
    if (!v) return;
    var exact = catalogFind(v) || searchCatalog(v)[0];
    var lead = exact && (norm(exact.name).indexOf(norm(v)) === 0 || exact.en.indexOf(norm(v)) === 0);
    var bm = !lead && searchBrands(v)[0];
    if (bm) addItem(bm.p.name, bm.brand || bm.group.name, 1);
    else addItem(lead ? exact.name : v, "", 1);
    $("smInput").value = "";
  });

  $("btnLoc").addEventListener("click", function () { if (watchId === null) startLocation(); else stopLocation(); });
  // Namig o cenejši trgovini v obvestilu (privzeto vklopljen).
  function renderTipSwitch() { $("btnTip").setAttribute("aria-checked", state.settings.cheaperTip === false ? "false" : "true"); }
  renderTipSwitch();
  $("btnTip").addEventListener("click", function () {
    state.settings.cheaperTip = state.settings.cheaperTip === false; save(); renderTipSwitch();
    toast(state.settings.cheaperTip ? "Namig o cenejši trgovini je vklopljen." : "Namig o cenejši trgovini je izklopljen.");
  });
  // Ročni uvoz cen je samo za razvijalca: 7 hitrih tapov na naslov »Cene« ga pokaže ali skrije (velja za ta telefon).
  function applyDevMode() { $("manualImport").classList.toggle("hidden", !state.settings.dev); }
  applyDevMode();
  var devTaps = 0, devTimer = null;
  $("pricesTitle").addEventListener("click", function () {
    devTaps++;
    clearTimeout(devTimer);
    devTimer = setTimeout(function () { devTaps = 0; }, 1500);
    if (devTaps < 7) return;
    devTaps = 0;
    state.settings.dev = !state.settings.dev; save();
    applyDevMode();
    toast(state.settings.dev ? "Ročni uvoz cen je prikazan." : "Ročni uvoz cen je skrit.");
  });
  $("btnTest").addEventListener("click", function () { window.scrollTo(0, 0); startTest(); });
  $("btnRefreshStores").addEventListener("click", function () {
    if (!lastPos) { startLocation(); return; }
    fetchStores(lastPos, true); toast("Osvežujem trgovine …");
  });
  $("radius").value = state.settings.radius;
  $("delay").value = state.settings.delay;
  $("radiusVal").textContent = state.settings.radius + " m";
  $("delayVal").textContent = state.settings.delay + " s";
  $("radius").addEventListener("input", function (e) {
    state.settings.radius = +e.target.value; $("radiusVal").textContent = e.target.value + " m"; save(); evaluateNear(); renderStores();
  });
  $("delay").addEventListener("input", function (e) {
    state.settings.delay = +e.target.value; $("delayVal").textContent = e.target.value + " s"; save();
  });

  $("priceSearch").addEventListener("input", renderPriceTable);
  $("importFile").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(importPrices); e.target.value = "";
  });
  $("btnPaste").addEventListener("click", function () { $("pasteBox").classList.toggle("hidden"); $("pasteText").focus(); });
  $("btnPasteDo").addEventListener("click", function () {
    var t = $("pasteText").value.trim();
    if (!t) return;
    importPrices(t); $("pasteText").value = ""; $("pasteBox").classList.add("hidden");
  });
  $("btnHelp").addEventListener("click", function () {
    var h = $("helpText"); h.textContent = HELP; h.classList.toggle("hidden");
    if (navigator.clipboard) navigator.clipboard.writeText(HELP).then(function () { toast("Navodila kopirana."); }, function () {});
  });
  var resetArmed = 0;
  $("btnResetPrices").addEventListener("click", function () {
    if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); toast("Tapni še enkrat za izbris uvoženih cen."); return; }
    resetArmed = 0;
    state.prices = {}; state.pricesUpdated = null; save(); renderAll(); renderPriceTable();
  });
  $("btnExport").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "nakupko-" + new Date().toISOString().slice(0, 10) + ".json" });
    document.body.appendChild(a); a.click(); a.remove();
  });
  $("importBackup").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) {
      try {
        var s = JSON.parse(t);
        if (!s || !Array.isArray(s.items)) throw new Error("bad");
        var d = defaults();
        Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === null) s[k] = d[k]; });
        state = s; save(); renderAll(); toast("Kopija obnovljena.");
      } catch (err) { toast("Datoteka ni veljavna kopija Nakupka."); }
    });
    e.target.value = "";
  });

  // iPhone ustavi sledenje, ko je aplikacija v ozadju: ob vrnitvi ga zaženemo znova.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.settings.locOn && !testMode) {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (det) det.pending = null;
      startLocation();
    }
  });

  // ---------- Način aplikacije ----------
  var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (standalone) document.documentElement.classList.add("standalone");
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(navigator.userAgent);
  if (!standalone && isIOS && !state.settings.installHintClosed) $("installHint").classList.remove("hidden");
  if (!standalone && isAndroid && !state.settings.installHintClosed) {
    $("installText").textContent = "V Chromu tapni ⋮ zgoraj desno in nato »Namesti aplikacijo« ali »Dodaj na začetni zaslon«.";
    $("installHint").classList.remove("hidden");
  }
  // Android/Chrome: pravi gumb za namestitev
  var installEvt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); installEvt = e;
    if (state.settings.installHintClosed) return;
    $("installText").textContent = "Dodaj Nakupko na začetni zaslon in ga odpiraj kot aplikacijo.";
    $("installBtn").classList.remove("hidden");
    $("installHint").classList.remove("hidden");
  });
  $("installBtn").addEventListener("click", function () {
    if (!installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.then(function () { installEvt = null; $("installHint").classList.add("hidden"); });
  });
  window.addEventListener("appinstalled", function () { $("installHint").classList.add("hidden"); toast("Nakupko je nameščen."); });
  $("installClose").addEventListener("click", function () {
    $("installHint").classList.add("hidden"); state.settings.installHintClosed = true; save();
  });

  // ---------- Zagon ----------
  applySize();
  renderSizeChoices($("sizeBox"), setSize);
  (function () {
    // Jezik: samodejno po državi, kjer si (privzeto), ali ročna izbira, ki jo aplikacija ohrani.
    var box = $("langBox"), mode = window.NK_LANG_MODE || "auto", langs = window.NK_LANGS || { sl: "Slovenščina", en: "English" };
    if (!box) return;
    var c = countryCode(), ime = (rules(c).ime || c);
    [["auto", "Samodejno (po lokaciji)", lastFetchPos ? ime + " · " + (langs[window.NK_LANG] || window.NK_LANG) : ""]].concat(Object.keys(langs).map(function (k) { return [k, langs[k], ""]; })).forEach(function (l) {
      box.appendChild(el("button", { class: "pref-opt" + (mode === l[0] ? " on" : ""), type: "button",
        onclick: function () { if (l[0] !== mode && window.NK_SET_LANG) window.NK_SET_LANG(l[0]); } },
        [el("div", { class: "pref-text" }, [el("b", { text: l[1] }), l[2] ? el("span", { class: "muted small", text: l[2] }) : null])]));
    });
  })();
  renderPrefs();
  maybeOnboard();
  priceKeysClean();
  renderAll();
  renderStores();
  refreshPrices();
  if (abroad()) { loadForeign(state.storesCache.country); renderAll(); }
  refreshOfficial();
  refreshDrzave();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshPrices(); });
  setInterval(checkRemote, 10000);
  checkRemote();
  if (/[?&]test\b/.test(location.search)) startTest();
  else if (state.settings.locOn) startLocation();
  if (/[?&]trgovina\b/.test(location.search)) openStoreMode(null);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // za teste
  window.__nakupko = { state: function () { return state; }, emojiFor: function (it) { return (window.NAKUPKO_EMOJI || {})[iconFor(it)] || ""; }, chainOnly: function (k) { var c = CHAIN_BY_KEY[k], o = c && onlyOf(c); return o ? o.source : ""; }, toggle: function (id) { toggleItem(id); }, add: function (n) { addItem(n, "", 1, { silent: true }); }, openStore: function () { openStoreMode(lastNearStore || activeStore || null); }, openStoreById: function (id) {
    // Klik na obvestilo »trgovina je blizu«: odpremo prav to trgovino, brez čakanja na GPS v aplikaciji.
    var list = stores.concat((state.storesCache && state.storesCache.list) || []);
    var st = list.filter(function (x) { return x.id === id; })[0] || lastNearStore || null;
    if (!$("storeMode").classList.contains("hidden") && activeStore && st && activeStore.id === st.id) return;
    openStoreMode(st);
  }, activeStore: function () { return activeStore; }, leftStore: function (id) { leftStore(id, true); }, forStore: forStore,
  setItems: function (l) { state.items = l; save(); renderAll(); }, toast: toast, priceFor: priceFor, recommendations: recommendations, habits: habits, inRange: inRange, tripPlan: tripPlan, setStores: function (l, p) { stores = l; lastPos = p; renderAll(); } };
})();
