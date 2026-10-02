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

  // ---------- Sinhronizacija z iPhonom (spremljanje trgovin v ozadju) ----------
  var lastSent = "";
  function sync() {
    var api = window.__nakupko;
    if (!api || !api.state) return;
    var s = api.state();
    var on = !!(s.settings && s.settings.locOn);
    var cfg = { enabled: on, radius: (s.settings && s.settings.radius) || 75, stores: [], items: [] };
    if (on) {
      var list = (s.storesCache && s.storesCache.list) || [];
      cfg.stores = list.filter(function (x) { return !/^test\//.test(x.id); }).map(function (x) {
        return { id: x.id, name: x.short || x.name, lat: x.lat, lon: x.lon };
      });
      cfg.items = (s.items || []).filter(function (i) { return !i.done; }).map(function (i) {
        return (i.qty > 1 ? i.qty + "× " : "") + i.name + (i.brand ? " (" + i.brand + ")" : "");
      });
    }
    var key = JSON.stringify(cfg);
    if (key === lastSent) return;
    lastSent = key;
    Geo.setConfig(cfg).catch(function () { lastSent = ""; });
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
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sync(); });
  window.addEventListener("load", function () { setTimeout(sync, 500); });
})();
