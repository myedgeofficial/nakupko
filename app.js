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
    { key: "jager", name: "Jager", factor: 1.0, color: "#8A5A2B", match: /jager/i }
  ];
  var CHAIN_BY_KEY = {};
  CHAINS.forEach(function (c) { CHAIN_BY_KEY[c.key] = c; });
  var COMPARE_CHAINS = ["spar", "mercator", "tus", "lidl", "hofer"];
  var CAT_META = {
    "Sadje in zelenjava": ["🥦", "#E3F3DF"], "Kruh in pecivo": ["🥖", "#F7EBDA"], "Mlečni izdelki": ["🥛", "#E4EEF8"],
    "Meso in ribe": ["🥩", "#F8E3E1"], "Shramba": ["🥫", "#F4E9DC"], "Prigrizki": ["🍫", "#F1E6F4"], "Pijače": ["🥤", "#DFF1F3"],
    "Zamrznjeno": ["🧊", "#E3ECF8"], "Gospodinjstvo": ["🧽", "#EEF0D9"], "Higiena": ["🧴", "#E9E6F6"], "Tobak": ["🚬", "#ECE7E2"],
    "Ljubljenčki": ["🐾", "#F6ECDD"], "Drugo": ["🛒", "#E9EEEA"]
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
      settings: { locOn: false, radius: 75, delay: 15 },
      storesCache: null,
      dismissed: {}
    };
  }
  function load() {
    var d = defaults();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === null) s[k] = d[k]; });
        s.settings = Object.assign({}, d.settings, s.settings);
        return s;
      }
    } catch (e) { /* prazno stanje */ }
    return d;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("Shranjevanje ni uspelo (poln pomnilnik brskalnika)."); }
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

  // ---------- Cene ----------
  // Vrne {price, est} za izdelek v verigi. Uvožene cene imajo prednost; če za verigo ni cene,
  // vzamemo povprečje uvoženih cen drugih trgovin; sicer oceno iz kataloga.
  // Cene, ki jih je Nakupko poiskal na spletu (prices.js); uvožene cene jih prepišejo.
  var BASE_PRICES = {};
  ((window.NAKUPKO_PRICES && window.NAKUPKO_PRICES.izdelki) || []).forEach(function (e) {
    var rec = {};
    Object.keys(e.cene || {}).forEach(function (c) { if (typeof e.cene[c] === "number" && e.cene[c] > 0) rec[c] = e.cene[c]; });
    if (Object.keys(rec).length) BASE_PRICES[norm(e.ime)] = rec;
  });
  function priceFor(name, chain) {
    var key = norm(name);
    var imp = Object.assign({}, BASE_PRICES[key] || {}, state.prices[key] || {});
    if (!Object.keys(imp).some(function (k) { return typeof imp[k] === "number"; })) imp = null;
    if (imp && typeof imp[chain] === "number") return { price: imp[chain], est: false };
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
    if (!(opts && opts.silent)) toast("Dodano: " + name + (brand ? " (" + brand + ")" : ""));
  }

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
  function cheapestChain(name) {
    var best = null;
    COMPARE_CHAINS.forEach(function (c) {
      var p = priceFor(name, c);
      if (p.price != null && (!best || p.price < best.price)) best = { chain: c, price: p.price, est: p.est };
    });
    return best;
  }

  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  function priceChip(it, storeCtx) {
    var q = it.qty || 1, chain = null, p = null;
    if (storeCtx && storeCtx.chain) { chain = storeCtx.chain; p = priceFor(it.name, chain); if (p.price == null) p = null; }
    if (!p) { var b = cheapestChain(it.name); if (b) { chain = b.chain; p = { price: b.price, est: b.est }; } }
    if (!p) return null;
    return el("span", { class: "price" + (p.est ? " est" : ""), title: (CHAIN_BY_KEY[chain] || {}).name || "" }, [
      chainDot(chain), eur(p.price * q) + (p.est ? "*" : "")
    ]);
  }
  function itemRow(it, big, storeCtx) {
    var meta = itemMeta(it);
    var check = el("button", { class: "check", type: "button", "aria-label": it.done ? "Označi kot nekupljeno" : "Označi kot kupljeno",
      onclick: function () { toggleItem(it.id, storeCtx); } });
    check.innerHTML = CHECK_SVG;
    var del = el("button", { class: "del", type: "button", "aria-label": "Izbriši " + it.name, onclick: function () { removeItem(it.id); } });
    del.innerHTML = X_SVG;
    return el("li", { class: "item" + (it.done ? " done" : "") }, [
      check,
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
    var items = state.items.filter(function (i) {
      if (filter === "done") return i.done;
      if (i.done) return false;
      if (filter === "store") {
        if (!st) return true;
        var u = usualStoreInfo(i.name);
        return !u || u.chain === st.chain || u.storeId === st.id;
      }
      return true;
    });
    // razvrsti po kategoriji (kot pot po trgovini)
    var order = ["Sadje in zelenjava", "Kruh in pecivo", "Mlečni izdelki", "Meso in ribe", "Shramba", "Prigrizki", "Pijače", "Zamrznjeno", "Gospodinjstvo", "Higiena", "Tobak", "Ljubljenčki", "Drugo"];
    items.sort(function (a, b) { return order.indexOf(a.cat || "Drugo") - order.indexOf(b.cat || "Drugo"); });
    var lastCat = null;
    items.forEach(function (it) {
      if (filter !== "done" && it.cat !== lastCat) {
        var m = CAT_META[it.cat] || CAT_META.Drugo;
        ul.appendChild(el("li", { class: "cat" }, [el("span", { class: "cat-ico", style: "background:" + m[1] }, [m[0]]), it.cat || "Drugo"]));
        lastCat = it.cat;
      }
      ul.appendChild(itemRow(it));
    });
    $("listEmpty").classList.toggle("hidden", items.length > 0);
    $("listEmpty").textContent = filter === "store" && !st ? "Nisi v bližini trgovine. Vklopi lokacijo v zavihku Trgovine." : (filter === "done" ? "Še nič kupljenega." : "Seznam je prazen.");
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
      box.appendChild(el("button", { class: "chip" + (on ? " on" : ""), type: "button", onclick: function () { addItem(n, lastBrandFor(n) || "", 1); } }, [n]));
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
  function renderSuggest() {
    var q = $("addInput").value;
    var res = searchCatalog(q);
    var ul = $("suggest");
    ul.innerHTML = "";
    if (!q.trim() || !res.length) { ul.classList.add("hidden"); return; }
    res.forEach(function (p, i) {
      ul.appendChild(el("li", { class: i === selIdx ? "sel" : "", role: "option",
        onmousedown: function (e) { e.preventDefault(); pickProduct(p.name); } }, [
        el("span", { text: p.name }), el("span", { class: "muted small", text: p.cat })
      ]));
    });
    ul.classList.remove("hidden");
  }
  function pickProduct(name) {
    var p = CATALOG_BY_KEY[norm(name)];
    $("suggest").classList.add("hidden");
    selIdx = -1;
    if (p && p.brands.length > 1) {
      pendingProduct = p;
      $("addInput").value = p.name;
      renderBrandPick();
    } else {
      addItem(p ? p.name : name, p && p.brands.length === 1 ? p.brands[0] : "", parseQty($("addQty").value));
      resetAdd();
    }
  }
  function renderBrandPick() {
    var box = $("brandPick");
    box.innerHTML = "";
    if (!pendingProduct) { box.classList.add("hidden"); return; }
    var p = pendingProduct;
    box.appendChild(el("span", { class: "muted small", text: "Znamka za " + p.name + ":" }));
    var lastBrand = lastBrandFor(p.name);
    var brands = p.brands.slice();
    if (lastBrand && brands.indexOf(lastBrand) > 0) { brands.splice(brands.indexOf(lastBrand), 1); brands.unshift(lastBrand); }
    box.appendChild(el("button", { class: "chip", type: "button", onclick: function () { addItem(p.name, "", parseQty($("addQty").value)); resetAdd(); } }, ["Katerakoli"]));
    brands.forEach(function (b) {
      box.appendChild(el("button", { class: "chip" + (b === lastBrand ? " on" : ""), type: "button",
        onclick: function () { addItem(p.name, b, parseQty($("addQty").value)); resetAdd(); } }, [b]));
    });
    box.classList.remove("hidden");
  }
  function resetAdd() {
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
      gaps.sort(function (a, b) { return a - b; });
      var median = gaps[Math.floor(gaps.length / 2)];
      var last = hs[hs.length - 1];
      var since = (Date.now() - last.ts) / DAY;
      var dom = hs.map(function (h) { return new Date(h.ts).getDate(); });
      var domMean = dom.reduce(function (a, b) { return a + b; }, 0) / dom.length;
      var domSd = Math.sqrt(dom.reduce(function (a, b) { return a + (b - domMean) * (b - domMean); }, 0) / dom.length);
      out.push({
        key: k, name: last.name, brand: last.brand, count: hs.length, interval: Math.max(1, median),
        since: since, domMean: Math.round(domMean), monthly: hs.length >= 3 && domSd <= 3 && median >= 20,
        store: usualStoreInfo(last.name)
      });
    });
    return out;
  }
  function recommendations(storeCtx) {
    var openKeys = state.items.filter(function (i) { return !i.done; }).map(function (i) { return norm(i.name); });
    var today = new Date().getDate();
    var res = [];
    habits().forEach(function (h) {
      if (openKeys.indexOf(h.key) >= 0) return;
      var dis = state.dismissed[h.key];
      if (dis && Date.now() - dis < Math.max(1, h.interval / 3) * DAY) return;
      var reason = null, score = 0;
      if (h.monthly && Math.abs(today - h.domMean) <= 2 && h.since > 15) {
        reason = "Običajno kupiš okoli " + h.domMean + ". v mesecu"; score = 3;
      } else if (h.since >= h.interval * 0.85) {
        reason = "Kupiš vsakih ~" + Math.round(h.interval) + " dni, zadnjič pred " + Math.floor(h.since) + " dnevi"; score = 2 + h.since / h.interval;
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
          el("button", { class: "mini ghosty", type: "button", "aria-label": "Skrij predlog", onclick: function () { state.dismissed[r.h.key] = Date.now(); save(); renderAll(); } }, ["Ne"]),
          el("button", { class: "mini", type: "button", onclick: function () { addItem(r.h.name, r.h.brand, 1); } }, ["+ Dodaj"])
        ])
      ]));
    });
    return recs.length;
  }
  function renderReco() {
    var n = renderRecoInto($("recoList"), currentStore());
    $("recoBox").classList.toggle("hidden", n === 0);
  }

  // ---------- Lokacija in trgovine ----------
  var watchId = null, lastPos = null, stores = [], lastFetchPos = null, fetching = false;
  var nearState = { id: null, since: 0 }, lastNearStore = null, activeStore = null, countdownTimer = null;

  if (state.storesCache && state.storesCache.list) {
    stores = state.storesCache.list;
    lastFetchPos = state.storesCache.pos;
  }

  function currentStore() { return activeStore; }

  function startLocation() {
    if (!("geolocation" in navigator)) { setLocStatus("Ta brskalnik ne podpira lokacije."); return; }
    if (watchId !== null) return;
    setLocStatus("Iščem tvojo lokacijo …");
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    state.settings.locOn = true; save();
    $("btnLoc").textContent = "Izklopi lokacijo";
  }
  function stopLocation() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    state.settings.locOn = false; save();
    $("btnLoc").textContent = "Vklopi lokacijo";
    setLocStatus("Lokacija je izklopljena.");
    nearState = { id: null, since: 0 };
    stopCountdown();
    $("detectBar").classList.add("hidden");
  }
  function onPosErr(err) {
    if (err.code === 1) {
      setLocStatus("Dostop do lokacije je zavrnjen. Na iPhonu: Nastavitve → Zasebnost → Lokacijske storitve → Safari → Med uporabo.");
      watchId = null;
      $("btnLoc").textContent = "Vklopi lokacijo";
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
  }

  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  function fetchStores(p, force) {
    if (fetching && !force) return;
    fetching = true;
    var q = "[out:json][timeout:20];(" +
      "nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store)$\"](around:3000," + p.lat + "," + p.lon + ");" +
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
            var chain = chainOf([t.brand, t.name, t.operator].join(" "));
            var addr = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
            return { id: e.type + "/" + e.id, name: nm + (addr ? ", " + addr : ""), short: nm, chain: chain, lat: lat, lon: lon, hours: t.opening_hours || "" };
          }).filter(Boolean);
          lastFetchPos = { lat: p.lat, lon: p.lon };
          state.storesCache = { pos: lastFetchPos, list: stores, at: Date.now() };
          save();
          evaluateNear();
          renderStores();
        })
        .catch(function () { tryAt(i + 1); });
    };
    tryAt(0);
  }

  function nearestStore() {
    if (!lastPos || !stores.length) return null;
    var best = null;
    stores.forEach(function (s) {
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
  function evaluateNear() {
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
      var badge = el("span", { class: "store-badge", style: "background:" + ((CHAIN_BY_KEY[x.s.chain] || {}).color || "#7A8A84") }, [(x.s.short || "?").charAt(0).toUpperCase()]);
      ul.appendChild(el("li", { class: near ? "near" : "" }, [
        badge,
        el("div", { class: "sbody" }, [
          el("div", { class: "sname", text: x.s.name }),
          el("div", { class: "shours", text: (near ? "Tukaj si · " : "") + (x.s.hours ? x.s.hours : "Urnik ni podan") })
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
    var open = state.items.filter(function (i) { return !i.done; });
    // kupljeno pokažemo samo, če je bilo odkljukano zdaj v trgovini (da lahko razveljaviš)
    var done = state.items.filter(function (i) { return i.done && i.doneAt && i.doneAt >= storeModeOpenedAt; });
    open.concat(done).forEach(function (it) { ul.appendChild(itemRow(it, true, activeStore)); });
    $("smEmpty").classList.toggle("hidden", open.length > 0);
    var total = open.length + done.length;
    $("smBar").style.width = (total ? Math.round(done.length / total * 100) : 100) + "%";
    var sum = 0;
    open.forEach(function (it) { var p = activeStore && activeStore.chain ? priceFor(it.name, activeStore.chain) : null; if (!p || p.price == null) { var b = cheapestChain(it.name); p = b ? { price: b.price } : null; } if (p) sum += p.price * (it.qty || 1); });
    $("smProgress").textContent = done.length + " od " + total + " v košarici" + (open.length ? " · še ≈ " + eur(sum) : "");
    renderRecoInto($("smReco"), activeStore);
  }

  // ---------- Cene: primerjava, tabela, uvoz ----------
  function compareRows(open) {
    return COMPARE_CHAINS.map(function (c) {
      var sum = 0, est = 0, missing = 0;
      open.forEach(function (it) {
        var p = priceFor(it.name, c);
        if (p.price == null) missing++;
        else { sum += p.price * (it.qty || 1); if (p.est) est++; }
      });
      return { c: c, sum: sum, est: est, missing: missing };
    }).sort(function (a, b) { return a.sum - b.sum; });
  }
  function renderHero() {
    var open = state.items.filter(function (i) { return !i.done; });
    $("heroCount").textContent = open.length;
    if (!open.length) { $("heroTotal").textContent = "–"; $("heroBest").textContent = "Dodaj izdelke na seznam"; return; }
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
          el("span", { class: "cmp-name" }, [chainDot(r.c), CHAIN_BY_KEY[r.c].name, i === 0 ? el("span", { class: "tag ok", text: "najceneje" }) : null]),
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
    $("pricesInfo").textContent = n
      ? "Uvoženih cen za " + n + " izdelkov" + (state.pricesUpdated ? ", posodobljeno " + new Date(state.pricesUpdated).toLocaleDateString("sl-SI") : "") + "."
      : "Trenutno so prikazane okvirne ocene cen. Za točne cene uvozi tedenski cenik.";
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
  function renderAll() {
    renderHero();
    renderList();
    renderQuick();
    renderReco();
    renderCompare();
    if ($("tab-prices").classList.contains("active")) renderPriceTable();
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
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      document.querySelectorAll(".seg button").forEach(function (x) { x.classList.toggle("on", x === b); });
      renderList();
    });
  });

  $("addInput").addEventListener("input", function () {
    pendingProduct = null; $("brandPick").classList.add("hidden"); selIdx = -1; renderSuggest();
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
    if (pendingProduct) { addItem(pendingProduct.name, "", parseQty($("addQty").value)); resetAdd(); return; }
    if (!v) return;
    var res = searchCatalog(v);
    if (selIdx >= 0 && res[selIdx]) { pickProduct(res[selIdx].name); return; }
    var exact = CATALOG_BY_KEY[norm(v)];
    pickProduct(exact ? exact.name : v);
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
    addItem(exact && norm(exact.name).indexOf(norm(v)) === 0 ? exact.name : v, "", 1);
    $("smInput").value = "";
  });

  $("btnLoc").addEventListener("click", function () { if (watchId === null) startLocation(); else stopLocation(); });
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
  if (!standalone && isIOS && !state.settings.installHintClosed) $("installHint").classList.remove("hidden");
  $("installClose").addEventListener("click", function () {
    $("installHint").classList.add("hidden"); state.settings.installHintClosed = true; save();
  });

  // ---------- Zagon ----------
  priceKeysClean();
  renderAll();
  renderStores();
  setInterval(checkRemote, 10000);
  checkRemote();
  if (/[?&]test\b/.test(location.search)) startTest();
  else if (state.settings.locOn) startLocation();
  if (/[?&]trgovina\b/.test(location.search)) openStoreMode(null);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // za teste
  window.__nakupko = { state: function () { return state; }, priceFor: priceFor, recommendations: recommendations, habits: habits, inRange: inRange };
})();
