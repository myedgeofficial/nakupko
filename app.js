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
    { key: "bencinska", name: "Bencinski servis", factor: 1.0, color: "#00A651", match: /\bpetrol\b|\bomv\b|\bmol\b|shell|lukoil|\bagip\b|\beni\b|bencinsk/i, only: /^tobak /i, hours: "Mo-Su 06:00-22:00; PH 06:00-22:00" },
    { key: "proteini", name: "Proteini.si", factor: 1.0, color: "#E30613", match: /proteini\.?si/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "thenutrition", name: "THE Nutrition", factor: 1.0, color: "#111111", match: /the ?nutrition/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "maxximum", name: "Maxximum", factor: 1.0, color: "#F2A900", match: /maxximum/i, only: /^športna prehrana |protein|elektrolit|izotoni/i },
    { key: "dm", name: "dm", factor: 1.0, color: "#2A4B9B", match: /^dm\b|dm[ -]drogerie|dm drogerija/i, only: /^(higiena|gospodinjstvo|otroci|zdravje|brez glutena|ljubljenčki) |protein|pralni|detergent|mehčal/i },
    { key: "muller", name: "Müller", factor: 1.02, color: "#F39200", match: /m[uü]ller/i, only: /^(higiena|gospodinjstvo|otroci|zdravje) |pralni|detergent|mehčal/i }
  ];
  // Ali trgovina prodaja izdelek: specializirane samo svoje, običajne vse razen orodja in vrta.
  function sells(s, it) {
    var c = CHAIN_BY_KEY[s && s.chain], t = (it.cat || "") + " " + it.name, o = c && onlyOf(c);
    return o ? o.test(t) : !/^dom in vrt /i.test(t);
  }
  // Ob nedeljah in praznikih so trgovine zaprte: bencinski servis takrat šteje tudi za pijačo in prigrizke.
  var FUEL_DAY_ONLY = /^(tobak|pijače|prigrizki) /i;
  function fuelDay(dt) { dt = dt || new Date(); return dt.getDay() === 0 || isHoliday(dt); }
  function onlyOf(c) { return c.key === "bencinska" && fuelDay() ? FUEL_DAY_ONLY : c.only; }
  // Izdelki za drugo trgovino: zloženi na dnu seznama.
  function otherSection(items, big, storeCtx) {
    var sub = el("ul", { class: "list" + (big ? " big" : "") });
    items.forEach(function (it) { sub.appendChild(itemRow(it, big, storeCtx)); });
    return el("li", { class: "other" }, [el("details", { class: "more" }, [el("summary", { text: "Iz druge trgovine rabiš še (" + items.length + ")" }), sub])]);
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
      settings: { locOn: true, locDefault2: true, radius: 75, delay: 15 },
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
  function eur(v) { return v == null || isNaN(v) ? "–" : v.toFixed(2).replace(".", ",") + " €"; }
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
  function spansFor(s, dt) {
    var h = parseHours(s.hours || (s.chain ? CHAIN_DEFAULT_HOURS : ""));
    if (h && h.always) return [[0, 1440]];
    var hol = isHoliday(dt), dow = dt.getDay();
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
    if (s.chain && !s.hours && r.open !== null) r.text += " (okvirno)";
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
  // Izdelek z znamko (Red Bull) ima svojo ceno, če jo poznamo; brez znamke velja glavna znamka, sicer cena izdelka na splošno.
  function brandPriceKey(it) {
    var key = norm(it.name), p = CATALOG_BY_KEY[key], b = norm(it.brand);
    if (!p) return null;
    // brez izbrane znamke: cena glavne znamke iz kataloga (npr. Red Bull), ne povprečje s cenenimi in akcijami
    if (!b) {
      var first = brandGroups(p).filter(function (x) { return BASE_PRICES[key + "|" + norm(x.name)]; })[0];
      return first ? key + "|" + norm(first.name) : null;
    }
    var g = brandGroups(p).filter(function (x) { var n = norm(x.name); return b === n || b.indexOf(n + " ") === 0; })[0];
    var k = g ? key + "|" + norm(g.name) : null;
    return k && BASE_PRICES[k] ? k : null;
  }
  function priceFor(name, chain) {
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
    if (it.qty && it.qty !== 1) parts.push(String(it.qty).replace(".", ",") + " ×");
    if (it.brand) parts.push(it.brand);
    var usual = usualStore(it.name);
    if (usual) parts.push("običajno: " + usual);
    return parts.join(" · ");
  }
  // ---------- Izbira trgovin za izračun cen ----------
  var PREFS = {
    discount: { label: "Hofer in Lidl", short: "Hofer/Lidl", chains: ["hofer", "lidl"] },
    eurojag: { label: "Eurospin in Jager", short: "Eurospin/Jager", chains: ["eurospin", "jager"] },
    classic: { label: "Tuš, Spar in Mercator", short: "Tuš/Spar/Mercator", chains: ["tus", "spar", "mercator"] },
    all: { label: "Kjerkoli je najceneje", short: "najceneje", chains: null },
    none: { label: "Cene me ne zanimajo", short: "", chains: null }
  };
  function pref() { return PREFS[state.settings.pricePref] || PREFS.all; }
  function pricesOff() { return state.settings.pricePref === "none"; }
  function pref2() { var k = state.settings.pricePref2; return k && k !== state.settings.pricePref && PREFS[k] && PREFS[k].chains ? PREFS[k] : null; }
  // trgovine, ki jih uporabnik sploh obiskuje (prva + druga izbira); null = vse
  function myChains() {
    if (!pref().chains) return null;
    var l = pref().chains.slice();
    if (pref2()) pref2().chains.forEach(function (c) { if (l.indexOf(c) < 0) l.push(c); });
    return l;
  }
  function compareChains() {
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
  function priceChip(it, storeCtx) {
    if (pricesOff()) return null;
    var q = it.qty || 1, chain = null, p = null;
    if (storeCtx && storeCtx.chain) { chain = storeCtx.chain; p = priceFor(it, chain); if (p.price == null) p = null; }
    if (!p) { p = prefPrice(it); if (p) chain = p.chain; }
    if (!p) return null;
    var kg = perKg(it.name);
    var txt = kg ? eur(p.price / kg.amount) + "/" + kg.unit : eur(p.price * q);
    return el("span", { class: "price" + (p.est ? " est" : ""), title: chain ? CHAIN_BY_KEY[chain].name : pref().label }, [
      chain ? chainDot(chain) : el("i", { class: "avg", text: "Ø" }), txt + (p.est ? "*" : ""),
      chain && p.sale ? el("b", { class: "sale", text: "akcija " + (kg ? eur(p.sale / kg.amount) : eur(p.sale * q)) }) : null
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
    return el("span", { class: "thumb", "aria-hidden": "true" }, [el("img", { src: "icons/" + iconFor(it) + ".svg", alt: "" })]);
  }
  try { localStorage.removeItem("nakupko-img"); delete state.imgCache; } catch (e) { /* nič */ }

  function itemRow(it, big, storeCtx) {
    var meta = itemMeta(it);
    var check = el("button", { class: "check", type: "button", "aria-label": it.done ? "Označi kot nekupljeno" : "Označi kot kupljeno",
      onclick: function () { toggleItem(it.id, storeCtx); } });
    check.innerHTML = CHECK_SVG;
    var del = el("button", { class: "del", type: "button", "aria-label": "Izbriši " + it.name, onclick: function () { removeItem(it.id); } });
    del.innerHTML = X_SVG;
    return el("li", { class: "item" + (it.done ? " done" : "") }, [
      check,
      thumbFor(it),
      el("div", { class: "ibody" }, [
        el("div", { class: "iname", text: it.name }),
        meta ? el("div", { class: "imeta", text: meta }) : null
      ]),
      it.done ? null : priceChip(it, storeCtx),
      del
    ]);
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
        if (sells(st, i) && (!u || u.chain === st.chain || u.storeId === st.id)) return true;
        other.push(i);
        return false;
      }
      return true;
    });
    // razvrsti po kategoriji (kot pot po trgovini)
    var order = ["Sadje in zelenjava", "Kruh in pecivo", "Mlečni izdelki", "Meso in ribe", "Shramba", "Prigrizki", "Pijače", "Zamrznjeno", "Gospodinjstvo", "Higiena", "Tobak", "Brez glutena", "Otroci", "Zdravje", "Športna prehrana", "Ljubljenčki", "Dom in vrt", "Drugo"];
    items.sort(function (a, b) { return order.indexOf(a.cat || "Drugo") - order.indexOf(b.cat || "Drugo"); });
    var lastCat = null;
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
      var n = norm(p.name);
      var b = p.brands.map(norm).join(" ");
      if (n.indexOf(nq) === 0 || n.split(" ").some(function (w) { return w.indexOf(nq) === 0; })) starts.push(p);
      else if (n.indexOf(nq) >= 0 || b.indexOf(nq) >= 0 || norm(p.cat).indexOf(nq) === 0) contains.push(p);
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
  var nearState = { id: null, since: 0 }, lastNearStore = null, activeStore = null, countdownTimer = null;

  if (state.storesCache && state.storesCache.list) {
    // Stari predpomnilnik je lahko vseboval tudi druge trgovine.
    stores = state.storesCache.list.filter(function (s) {
      if (s.duty === undefined) { s.duty = !s.chain && storeKind(s.name, s.hours) === "duty"; }
      return allowedStore(s);
    });
    lastFetchPos = state.storesCache.pos;
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
    nearState = { id: null, since: 0 };
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
    lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy || 999 };
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
    var q = "[out:json][timeout:20];(" +
      "nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store|baby_goods|pet|doityourself|hardware|garden_centre|nutrition_supplements|health_food|chemist|tobacco|kiosk|newsagent)$\"](around:3000," + p.lat + "," + p.lon + ");" +
      "nwr[\"amenity\"=\"fuel\"](around:3000," + p.lat + "," + p.lon + ");" +
      ");out center tags 120;";
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
          stores = (data.elements || []).map(function (e) {
            var t = e.tags || {};
            var lat = e.lat != null ? e.lat : (e.center && e.center.lat);
            var lon = e.lon != null ? e.lon : (e.center && e.center.lon);
            if (lat == null || lon == null) return null;
            var nm = t.name || t.brand || t.operator || "Trgovina";
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
          lastFetchPos = { lat: p.lat, lon: p.lon };
          state.storesCache = { pos: lastFetchPos, list: stores, at: Date.now() };
          save();
          evaluateNear();
          renderStores();
          renderTrip(true);
        })
        .catch(function () { tryAt(i + 1); });
    };
    tryAt(0);
  }

  function nearestStore() {
    if (!lastPos || !stores.length) return null;
    var best = null;
    stores.forEach(function (s) {
      if (CHAIN_BY_KEY[s.chain] && CHAIN_BY_KEY[s.chain].only && !state.items.some(function (i) { return !i.done && sells(s, i); })) return;
      var d = distM(lastPos, s);
      if (!best || d < best.d) best = { s: s, d: d };
    });
    return best;
  }
  // Trgovina je zaznana, ko si znotraj nastavljene razdalje, ali ko te tja postavi natančnost GPS.
  function inRange(d, acc) {
    var r = state.settings.radius;
    return d <= r || (d - Math.min(acc, 60)) <= r * 0.6;
  }
  // Ko se oddaljiš od trgovine, se način »V trgovini« sam zapre (po 20 s, da GPS ne zaniha).
  var leftSince = 0;
  function checkLeftStore() {
    if (!activeStore || activeStore.lat == null || !lastPos || testMode) { leftSince = 0; return; }
    var limit = Math.max(150, state.settings.radius * 2.5) + Math.min(lastPos.acc || 0, 60);
    // V stavbi je GPS nenatančen: za odhod štejemo le razdaljo, ki je gotovo daljša od meje.
    var d = distM(lastPos, activeStore) - Math.min(lastPos.acc || 0, 150);
    if (d <= limit) { leftSince = 0; return; }
    if (!leftSince && d < 1000) { leftSince = Date.now(); setTimeout(checkLeftStore, 20500); return; }
    if (d >= 1000 || Date.now() - leftSince >= 20000) {
      leftSince = 0;
      var name = activeStore.short || activeStore.name;
      window.__nakupkoLeftAt = Date.now();  // iPhone: umakni seznam z zaklenjenega zaslona
      closeStoreMode();
      toast("Zapustil si " + name + ". Nakupovanje zaprto.");
    }
  }
  function evaluateNear() {
    checkLeftStore();
    var n = nearestStore();
    var bar = $("detectBar");
    if (!n || !inRange(n.d, lastPos.acc)) {
      if (nearState.id) { nearState = { id: null, since: 0 }; stopCountdown(); }
      if (!activeStore) bar.classList.add("hidden");
      lastNearStore = null;
      return;
    }
    lastNearStore = n.s;
    if (activeStore && activeStore.id === n.s.id) { bar.classList.add("hidden"); return; }
    if (nearState.id !== n.s.id) {
      nearState = { id: n.s.id, since: Date.now() };
      startCountdown();
    }
    updateBar();
  }
  function snoozed(id) {
    var t = state.dismissed["store:" + id];
    return t && Date.now() - t < 45 * 60000;
  }
  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(updateBar, 1000);
    updateBar();
  }
  function stopCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; }
  function updateBar() {
    var n = nearestStore();
    var bar = $("detectBar");
    if (!n || nearState.id !== n.s.id) return;
    var left = Math.max(0, Math.ceil(state.settings.delay - (Date.now() - nearState.since) / 1000));
    bar.innerHTML = "";
    var sub = fmtDist(n.d) + " · GPS ±" + Math.round(lastPos.acc) + " m";
    var info = el("div", { class: "detect-info" }, [el("b", { text: n.s.short }), el("span", { text: sub })]);
    var os = openState(n.s);
    if (os.open === false) {
      // Trgovina je zaprta: seznama ne odpremo sami, le povemo, kdaj se odpre.
      stopCountdown();
      info.lastChild.textContent = os.text;
      bar.appendChild(info);
      bar.appendChild(el("button", { type: "button", onclick: function () { openStoreMode(n.s); } }, ["Vseeno odpri"]));
      bar.classList.remove("hidden");
      return;
    }
    if (snoozed(n.s.id)) {
      bar.appendChild(info);
    } else {
      if (left === 0) { stopCountdown(); openStoreMode(n.s); return; }
      info.lastChild.textContent = sub + " · odpiram čez " + left + " s";
      bar.appendChild(info);
    }
    bar.appendChild(el("button", { type: "button", onclick: function () { stopCountdown(); openStoreMode(n.s); } }, ["Odpri"]));
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
    nearState = { id: null, since: 0 };
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
    leftSince = 0;
    $("smTitle").textContent = activeStore ? activeStore.name : "Nakupovanje";
    $("storeMode").classList.remove("hidden");
    $("detectBar").classList.add("hidden");
    document.body.style.overflow = "hidden";
    renderStoreMode();
  }
  function closeStoreMode() {
    if (activeStore) { state.dismissed["store:" + activeStore.id] = Date.now(); save(); }
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
    var open = all.filter(function (i) { return !activeStore || sells(activeStore, i); });
    var other = all.filter(function (i) { return activeStore && !sells(activeStore, i); });
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
    }).sort(function (a, b) { return a.sum - b.sum; });
  }
  function renderHero() {
    var open = state.items.filter(function (i) { return !i.done; });
    $("heroCount").textContent = open.length;
    $("heroSide").classList.toggle("hidden", pricesOff());
    if (pricesOff()) return;
    $("heroLabel").textContent = pref().chains ? "Košarica · " + pref().short : "Ocena košarice";
    if (!open.length) { $("heroTotal").textContent = "–"; $("heroBest").textContent = "Dodaj izdelke na seznam"; return; }
    if (pref().chains) {
      var total = 0;
      open.forEach(function (it) { var p = prefPrice(it); if (p) total += p.price * (it.qty || 1); });
      $("heroTotal").textContent = "≈ " + eur(total);
      var grp = compareRows(open).filter(function (r) { return pref().chains.indexOf(r.c) >= 0; });
      $("heroBest").innerHTML = "";
      if (grp.length > 1) { $("heroBest").appendChild(chainDot(grp[0].c)); $("heroBest").appendChild(document.createTextNode("od teh najceneje " + CHAIN_BY_KEY[grp[0].c].name)); }
      else $("heroBest").textContent = "povprečje izbranih trgovin";
      if (pref2()) {
        var t2 = 0, n2 = 0;
        open.forEach(function (it) {
          var s = 0, n = 0;
          pref2().chains.forEach(function (c) { var p = priceFor(it, c); if (p.price != null) { s += p.price; n++; } });
          if (n) { t2 += s / n * (it.qty || 1); n2++; }
        });
        if (n2) $("heroBest").appendChild(el("div", { class: "hero-alt", text: pref2().short + " ≈ " + eur(t2) }));
      }
      return;
    }
    var rows = compareRows(open);
    $("heroTotal").textContent = "≈ " + eur(rows[0].sum);
    $("heroBest").innerHTML = "";
    $("heroBest").appendChild(chainDot(rows[0].c));
    $("heroBest").appendChild(document.createTextNode("najceneje v " + CHAIN_BY_KEY[rows[0].c].name + (rows.length > 1 ? " · prihranek " + eur(rows[rows.length - 1].sum - rows[0].sum) : "")));
  }
  function renderCompare() {
    var ul = $("compare");
    ul.innerHTML = "";
    var open = state.items.filter(function (i) { return !i.done; });
    if (!open.length) { ul.appendChild(el("li", { class: "muted" }, ["Dodaj izdelke na seznam za primerjavo."])); return; }
    var rows = compareRows(open);
    var max = rows[rows.length - 1].sum || 1;
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
    "Ključi trgovin: spar, mercator, tus, lidl, hofer, eurospin, jager.",
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
    var cand = stores.filter(function (s) { return s.chain && CHAIN_BY_KEY[s.chain] && !CHAIN_BY_KEY[s.chain].only && !/^test\//.test(s.id) && (!allowed || allowed.indexOf(s.chain) >= 0); })
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
    // ena trgovina: najbližja, razen če je druga občutno cenejša
    var nearest = cand[0];
    var cheapest = cand.slice().sort(function (a, b) { return cost[a.s.chain] - cost[b.s.chain] || a.d - b.d; })[0];
    var diff = cost[nearest.s.chain] - cost[cheapest.s.chain];
    var single = diff >= Math.max(1.5, cost[nearest.s.chain] * 0.05) ? cheapest : nearest;
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
      plan.split = saving >= Math.max(2, singleCost * 0.08);
      if (plan.split) {
        var pa2 = price[best.a.s.chain], pb2 = price[best.b.s.chain];
        plan.listA = []; plan.listB = [];
        open.forEach(function (it, k) { var v = pa2[k], w = pb2[k]; ((w != null && (v == null || w < v)) ? plan.listB : plan.listA).push(it.name); });
      }
    }
    return plan;
  }
  function mapsLink(s) { return "https://www.google.com/maps/dir/?api=1&destination=" + s.lat + "," + s.lon; }
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
      if (s.chain !== "bencinska" && (sunday || s.chain !== "trafika")) return;
      if (openState(s).open === false) return;
      var d = distM(ref, s);
      if (d > TRIP_MAX * 2) return;
      if (!best[s.chain] || d < best[s.chain].d) best[s.chain] = { s: s, d: d };
    });
    return { sunday: sunday, list: [best.trafika, best.bencinska].filter(Boolean).sort(function (a, b) { return a.d - b.d; }) };
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
    box.appendChild(el("a", { class: "mini trip-go", href: mapsLink(x.s), target: "_blank", rel: "noopener" }, ["Pokaži pot"]));
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
      box.appendChild(el("a", { class: "mini trip-go", href: mapsLink(p.a.d <= p.b.d ? p.a.s : p.b.s), target: "_blank", rel: "noopener" }, ["Pokaži pot"]));
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
    box.appendChild(el("a", { class: "mini trip-go", href: mapsLink(s.s), target: "_blank", rel: "noopener" }, ["Pokaži pot"]));
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
      renderList();
    });
  });

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
    var exact = CATALOG_BY_KEY[norm(v)];
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
    var exact = CATALOG_BY_KEY[norm(v)] || searchCatalog(v)[0];
    var bm = !(exact && norm(exact.name).indexOf(norm(v)) === 0) && searchBrands(v)[0];
    if (bm) addItem(bm.p.name, bm.brand || bm.group.name, 1);
    else addItem(exact && norm(exact.name).indexOf(norm(v)) === 0 ? exact.name : v, "", 1);
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
      nearState = { id: null, since: 0 };
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
  renderPrefs();
  maybeOnboard();
  priceKeysClean();
  renderAll();
  renderStores();
  refreshPrices();
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
  window.__nakupko = { state: function () { return state; }, emojiFor: function (it) { return (window.NAKUPKO_EMOJI || {})[iconFor(it)] || ""; }, chainOnly: function (k) { var c = CHAIN_BY_KEY[k], o = c && onlyOf(c); return o ? o.source : ""; }, toggle: function (id) { toggleItem(id); }, openStore: function () { openStoreMode(lastNearStore || activeStore || null); }, openStoreById: function (id) {
    // Klik na obvestilo »trgovina je blizu«: odpremo prav to trgovino, brez čakanja na GPS v aplikaciji.
    var list = stores.concat((state.storesCache && state.storesCache.list) || []);
    var st = list.filter(function (x) { return x.id === id; })[0] || lastNearStore || null;
    if (!$("storeMode").classList.contains("hidden") && activeStore && st && activeStore.id === st.id) return;
    openStoreMode(st);
  }, setItems: function (l) { state.items = l; save(); renderAll(); }, toast: toast, priceFor: priceFor, recommendations: recommendations, habits: habits, inRange: inRange, tripPlan: tripPlan, setStores: function (l, p) { stores = l; lastPos = p; renderAll(); } };
})();
