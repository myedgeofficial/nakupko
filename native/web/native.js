// Nakupko iOS: most med spletno aplikacijo in iPhonom.
// Naloži se le v iOS aplikaciji, pred app.js. Spletne kode ne spreminja:
// 1) navigator.geolocation zamenja z iOS lokacijo (brez dodatnega vprašanja spletne strani),
// 2) seznam trgovin in odprte izdelke pošilja iPhonu, ki trgovine spremlja tudi, ko je aplikacija zaprta.
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  var Geo = Cap.registerPlugin("NakupkoGeo");
  document.documentElement.classList.add("native-ios");

  // ---------- navigator.geolocation prek iOS ----------
  var watchers = {}, nextId = 1, posSub = null, errSub = null;
  function toPosition(d) {
    return {
      coords: { latitude: d.lat, longitude: d.lon, accuracy: d.acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: d.time || Date.now()
    };
  }
  function toError(e) {
    return { code: e.code || 2, message: e.message || "Lokacija ni na voljo", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
  }
  function ensureListeners() {
    if (posSub) return;
    posSub = Geo.addListener("position", function (d) {
      Object.keys(watchers).forEach(function (id) { var w = watchers[id]; if (w) w.ok(toPosition(d)); });
    });
    errSub = Geo.addListener("locationError", function (e) {
      Object.keys(watchers).forEach(function (id) { var w = watchers[id]; if (w && w.err) w.err(toError(e)); });
    });
  }
  var geo = {
    watchPosition: function (ok, err) {
      var id = nextId++;
      watchers[id] = { ok: ok, err: err };
      ensureListeners();
      Geo.startWatch().catch(function (e) { if (err) err(toError({ code: 2, message: String(e && e.message || e) })); });
      return id;
    },
    clearWatch: function (id) {
      delete watchers[id];
      if (!Object.keys(watchers).length) Geo.stopWatch();
    },
    getCurrentPosition: function (ok, err) {
      var id = geo.watchPosition(function (p) { geo.clearWatch(id); ok(p); }, function (e) { geo.clearWatch(id); if (err) err(e); });
    }
  };
  try { Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true }); }
  catch (e) { /* ostane spletna lokacija */ }

  // ---------- Odprti izdelki po oddelkih (vrstni red kot pot po trgovini) ----------
  var CATS = [
    ["Sadje in zelenjava", "🥦"], ["Kruh in pecivo", "🥖"], ["Mlečni izdelki", "🥛"], ["Meso in ribe", "🥩"],
    ["Shramba", "🥫"], ["Brez glutena", "🌾"], ["Prigrizki", "🍫"], ["Pijače", "🥤"], ["Zamrznjeno", "🧊"],
    ["Otroci", "🍼"], ["Gospodinjstvo", "🧽"], ["Higiena", "🧴"], ["Zdravje", "💊"], ["Tobak", "🚬"],
    ["Ljubljenčki", "🐾"], ["Drugo", "🛒"]
  ];
  function itemLabel(i) { return (i.qty > 1 ? i.qty + "× " : "") + i.name + (i.brand ? " (" + i.brand + ")" : ""); }
  function groupsOf(items) {
    var by = {};
    items.forEach(function (i) {
      var c = i.cat || "Drugo";
      if (!CATS.some(function (x) { return x[0] === c; })) c = "Drugo";
      (by[c] = by[c] || []).push(i);
    });
    return CATS.filter(function (c) { return by[c[0]]; }).map(function (c) {
      return {
        icon: c[1], name: c[0],
        items: by[c[0]].sort(function (a, b) { return a.name.localeCompare(b.name, "sl"); }).map(itemLabel)
      };
    });
  }

  // ---------- Sinhronizacija z iPhonom (spremljanje trgovin v ozadju) ----------
  var lastSent = "";
  function sync() {
    var api = window.__nakupko;
    if (!api || !api.state) return;
    var s = api.state();
    var on = !!(s.settings && s.settings.locOn);
    var cfg = { enabled: on, radius: (s.settings && s.settings.radius) || 75, stores: [], groups: [] };
    if (on) {
      var list = (s.storesCache && s.storesCache.list) || [];
      cfg.stores = list.filter(function (x) { return !/^test\//.test(x.id); }).map(function (x) {
        return { id: x.id, name: x.short || x.name, lat: x.lat, lon: x.lon };
      });
      cfg.groups = groupsOf((s.items || []).filter(function (i) { return !i.done; }));
    }
    var key = JSON.stringify(cfg);
    if (key === lastSent) return;
    lastSent = key;
    Geo.setConfig(cfg).catch(function () { lastSent = ""; });
  }

  // ---------- Seznam na zaklenjenem zaslonu med nakupovanjem ----------
  // Ko je odprt način »V trgovini«, iPhone pokaže preostale izdelke na zaklenjenem zaslonu.
  var lastShop = "", shopStartedAt = 0;
  function syncShopping() {
    var api = window.__nakupko, sm = document.getElementById("storeMode");
    if (!api || !api.state || !sm) return;
    var active = !sm.classList.contains("hidden");
    var msg = { active: active };
    if (active) {
      if (!shopStartedAt) shopStartedAt = Date.now();
      var items = api.state().items || [];
      var open = items.filter(function (i) { return !i.done; });
      var done = items.filter(function (i) { return i.done && i.doneAt && i.doneAt >= shopStartedAt; }).length;
      var title = (document.getElementById("smTitle") || {}).textContent || "Nakupovanje";
      msg.store = title.split(",")[0];
      msg.groups = groupsOf(open);
      msg.done = done;
      msg.total = open.length + done;
    } else {
      shopStartedAt = 0;
    }
    var key = JSON.stringify(msg);
    if (key === lastShop) return;
    lastShop = key;
    Geo.shopping(msg).catch(function () { lastShop = ""; });
  }
  setInterval(syncShopping, 1500);

  // Tap na obvestilo »Si v trgovini«: nakupovanje odpremo takoj, brez odštevanja.
  function openFromNotification() {
    Geo.takePendingStore().then(function (r) {
      if (!r || !r.storeId) return;
      var tries = 0;
      var t = setInterval(function () {
        var sm = document.getElementById("storeMode");
        var btn = document.querySelector("#detectBar:not(.hidden) button");
        if ((sm && !sm.classList.contains("hidden")) || ++tries > 40) { clearInterval(t); return; }
        if (btn) { btn.click(); clearInterval(t); }
      }, 500);
    }).catch(function () {});
  }
  setInterval(sync, 4000);

  // Navodila za dovoljenje naj kažejo na aplikacijo, ne na Safari.
  window.addEventListener("DOMContentLoaded", function () {
    var st = document.getElementById("locStatus");
    if (!st || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (/Safari/.test(st.textContent)) st.textContent = "Dostop do lokacije je zavrnjen. Na iPhonu: Nastavitve → Nakupko → Lokacija → Vedno.";
    }).observe(st, { childList: true, characterData: true, subtree: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { sync(); syncShopping(); }
    else setTimeout(openFromNotification, 300);
  });
  window.addEventListener("load", function () { setTimeout(sync, 500); setTimeout(openFromNotification, 800); });
})();
