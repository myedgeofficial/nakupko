// Nakupko iOS: most med spletno aplikacijo in iPhonom.
// Naloži se le v iOS aplikaciji, pred app.js. Spletne kode ne spreminja:
// 1) navigator.geolocation zamenja z iOS lokacijo (brez dodatnega vprašanja spletne strani),
// 2) seznam trgovin in odprte izdelke pošilja iPhonu, ki trgovine spremlja tudi, ko je aplikacija zaprta.
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) {
    // Diagnostika: v aplikaciji brez povezave z iPhonom to pokažemo v Nastavitvah.
    if (/Nakupko|iPhone/.test(navigator.userAgent) && !/Safari\//.test(navigator.userAgent)) {
      window.addEventListener("load", function () {
        var st = document.getElementById("locStatus");
        if (st) { var d = document.createElement("div"); d.className = "small"; d.style.color = "#c0392b"; d.textContent = "iPhone: povezava ni naložena (" + (Cap ? "ni native" : "ni Capacitor") + ")"; st.parentNode.appendChild(d); }
      });
    }
    return;
  }
  // Brez @capacitor/core (spletna aplikacija nima bundlerja) registerPlugin ne obstaja,
  // zato iPhone kličemo neposredno prek mostu Capacitor.
  var Geo = Cap.registerPlugin ? Cap.registerPlugin("NakupkoGeo") : (function () {
    var api = {
      addListener: function (event, cb) { return Cap.addListener("NakupkoGeo", event, cb); }
    };
    ["startWatch", "stopWatch", "setConfig", "getStatus", "shopping", "takePendingStore", "takeDone", "setZoom", "openSettings", "requestAlways"].forEach(function (m) {
      api[m] = function (opts) { return Cap.nativePromise("NakupkoGeo", m, opts || {}); };
    });
    return api;
  })();
  document.documentElement.classList.add("native-ios");

  // ---------- navigator.geolocation prek iOS ----------
  var watchers = {}, nextId = 1, posSub = null, errSub = null, lastNativePos = null, geoOverridden = false;
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
      lastNativePos = d;
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
  try { Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true }); geoOverridden = navigator.geolocation === geo; }
  catch (e) { /* ostane spletna lokacija */ }

  // ---------- Odprti izdelki po oddelkih (vrstni red kot pot po trgovini) ----------
  var CATS = [
    ["Sadje in zelenjava", "🥦"], ["Kruh in pecivo", "🥖"], ["Mlečni izdelki", "🥛"], ["Meso in ribe", "🥩"],
    ["Shramba", "🥫"], ["Brez glutena", "🌾"], ["Prigrizki", "🍫"], ["Pijače", "🥤"], ["Zamrznjeno", "🧊"],
    ["Otroci", "🍼"], ["Gospodinjstvo", "🧽"], ["Higiena", "🧴"], ["Zdravje", "💊"], ["Športna prehrana", "💪"], ["Tobak", "🚬"],
    ["Ljubljenčki", "🐾"], ["Dom in vrt", "🔨"], ["Drugo", "🛒"]
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

  // Izdelki z id-ji za kljukanje na zaklenjenem zaslonu (vrstni red oddelkov, nato abecedno).
  function liveItemsOf(items) {
    function ci(i) { var k = -1; CATS.forEach(function (c, n) { if (c[0] === (i.cat || "Drugo")) k = n; }); return k < 0 ? CATS.length - 1 : k; }
    return items.slice().sort(function (a, b) { return ci(a) - ci(b) || a.name.localeCompare(b.name, "sl"); })
      .map(function (i) {
        var api = window.__nakupko, e = api && api.emojiFor ? api.emojiFor(i) : "";
        return { id: i.id, label: itemLabel(i), icon: e || CATS[ci(i)][1], cat: i.cat || "Drugo" };
      });
  }

  // ---------- Sinhronizacija z iPhonom (spremljanje trgovin v ozadju) ----------
  var lastSent = "";
  function sync() {
    var api = window.__nakupko;
    if (!api || !api.state) return;
    var s = api.state();
    var on = !!(s.settings && s.settings.locOn);
    var cfg = { enabled: on, radius: (s.settings && s.settings.radius) || 75, stores: [], groups: [], items: [], dbUrl: window.NAKUPKO_SYNC_URL || "https://nakupko-8ad19-default-rtdb.europe-west1.firebasedatabase.app", household: window.__nakupkoHousehold ? window.__nakupkoHousehold() : null };
    if (on) {
      var list = (s.storesCache && s.storesCache.list) || [];
      // Samo verige in dežurne trgovine; urnik iPhonu pove, ali je trgovina odprta.
      cfg.stores = list.filter(function (x) { return !/^test\//.test(x.id) && (x.chain || x.duty); }).map(function (x) {
        return { id: x.id, name: x.short || x.name, lat: x.lat, lon: x.lon, chain: x.chain || null, duty: !!x.duty, hours: x.hours || "",
          only: x.chain && api.chainOnly ? api.chainOnly(x.chain) : "" };
      });
      cfg.groups = groupsOf((s.items || []).filter(function (i) { return !i.done; }));
      cfg.items = liveItemsOf((s.items || []).filter(function (i) { return !i.done; }));
    }
    var key = JSON.stringify(cfg);
    if (key === lastSent) return;
    lastSent = key;
    Geo.setConfig(cfg).catch(function () { lastSent = ""; });
  }

  // ---------- Seznam na zaklenjenem zaslonu med nakupovanjem ----------
  // Ko je odprt način »V trgovini«, iPhone pokaže preostale izdelke na zaklenjenem zaslonu.
  var lastShop = "", shopStartedAt = 0, shopWasActive = false;
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
      msg.items = liveItemsOf(open);
      msg.done = done;
      msg.total = open.length + done;
      shopWasActive = true;
    } else {
      shopStartedAt = 0;
      // Seznam, ki ga je ob prihodu odprl iPhone sam, pustimo pri miru, dokler ne zapustiš trgovine.
      if (!shopWasActive) return;
      shopWasActive = false;
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
      var api = window.__nakupko, sm0 = document.getElementById("storeMode");
      // Iz seznama na zaklenjenem zaslonu: nakupovanje odpremo takoj.
      if (r.storeId === "live" && api && api.openStore) { if (sm0 && sm0.classList.contains("hidden")) api.openStore(); return; }
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

  // Izdelki, odkljukani na zaklenjenem zaslonu, se odkljukajo tudi v aplikaciji.
  function applyLiveDone() {
    var api = window.__nakupko;
    if (!api || !api.state || !api.toggle) return;
    Geo.takeDone().then(function (r) {
      var ids = (r && r.ids) || {};
      Object.keys(ids).forEach(function (id) {
        var it = (api.state().items || []).find(function (i) { return i.id === id; });
        if (it && !it.done) api.toggle(id);
      });
    }).catch(function () {});
  }

  // Velikost prikaza (Mlajši / Srednja leta / Starejši): povečamo celo stran prek iPhona.
  var lastZoom = 0;
  function syncZoom() {
    var c = document.documentElement.classList;
    var z = c.contains("size-senior") ? 1.25 : c.contains("size-mid") ? 1.1 : 1;
    if (z === lastZoom) return;
    lastZoom = z;
    Geo.setZoom({ zoom: z }).catch(function () { lastZoom = 0; });
  }
  if (window.MutationObserver) new MutationObserver(syncZoom).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("load", syncZoom);

  // Brez lokacije »Vedno« aplikacija v ozadju ne deluje: celozaslonsko okno z enim gumbom.
  var isIOS = !Cap.getPlatform || Cap.getPlatform() === "ios";
  var gateLater = false, askedAlways = false;
  try { askedAlways = localStorage.getItem("nakupko-asked-always") === "1"; } catch (e) { /* nič */ }
  function missingOf(s) {
    var m = [];
    if (s.authorization !== "always") m.push("Lokacija: <b>Vedno</b>");
    if (s.precise === false) m.push("Natančna lokacija: <b>vklopljeno</b>");
    if (!s.notifications) m.push("Obvestila: <b>Dovoli obvestila</b>");
    return m;
  }
  function fixPermissions(s) {
    // iOS prošnjo za »Vedno« pokaže samo enkrat; potem pomagajo le Nastavitve.
    if (s.authorization === "whenInUse" && !askedAlways) {
      askedAlways = true;
      try { localStorage.setItem("nakupko-asked-always", "1"); } catch (e) { /* nič */ }
      Geo.requestAlways().catch(function () {});
      setTimeout(showBackgroundStatus, 2500);
      return;
    }
    Geo.openSettings();
  }
  function showGate(s, missing) {
    var g = document.getElementById("alwaysGate");
    if (!missing.length || gateLater) { if (g) g.remove(); return; }
    if (!g) {
      g = document.createElement("div");
      g.id = "alwaysGate";
      g.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:32px 24px calc(32px + env(safe-area-inset-bottom));text-align:center;color:#1b1b1f;font-size:17px;line-height:1.45";
      document.body.appendChild(g);
    }
    g.innerHTML =
      '<div style="font-size:56px;margin-bottom:8px">📍</div>' +
      '<h2 style="margin:0 0 10px;font-size:24px">Vklopi lokacijo »Vedno«</h2>' +
      '<p style="margin:0 0 18px;color:#5b5b66">Samo tako ti Nakupko pokaže seznam, ko prideš v trgovino, tudi ko je aplikacija zaprta.</p>' +
      '<div style="background:#f4f1fb;border-radius:16px;padding:14px 16px;margin:0 auto 22px;text-align:left;max-width:340px">' +
      '<div style="color:#5b5b66;font-size:15px;margin-bottom:6px">Stisni gumb, nato izberi:</div>' +
      missing.map(function (m) { return '<div style="margin:4px 0">• ' + m + '</div>'; }).join("") +
      '</div>' +
      '<button id="gateGo" type="button" style="border:0;border-radius:16px;padding:16px;font-size:18px;font-weight:700;background:#8A3FFC;color:#fff;width:100%;max-width:340px;margin:0 auto">Vklopi zdaj</button>' +
      '<button id="gateLater" type="button" style="border:0;background:none;color:#8a8a96;padding:16px;font-size:15px;margin-top:6px">Kasneje</button>';
    document.getElementById("gateGo").onclick = function () { fixPermissions(s); };
    document.getElementById("gateLater").onclick = function () { gateLater = true; g.remove(); };
  }
  // Gumb Akcija (iPhone 15 Pro in novejši): Apple ga ne pusti nastaviti iz aplikacije, zato pokažemo pot.
  function actionButtonHint() {
    var st = document.getElementById("locStatus");
    if (!st || document.getElementById("actionHint")) return;
    var b = document.createElement("button");
    b.id = "actionHint"; b.type = "button"; b.className = "link small";
    b.style.display = "block"; b.style.marginTop = "10px";
    b.textContent = "Nakupko na gumb Akcija";
    b.onclick = function () {
      alert("Nastavitve iPhona → Gumb Akcija → podrsaj do »Bližnjica« → Izberi bližnjico → Nakupko → Odpri Nakupko.\n\nPotem Nakupko odpreš tako, da držiš gumb Akcija.");
    };
    st.parentNode.appendChild(b);
  }

  function showBackgroundStatus() {
    if (!isIOS) return;
    actionButtonHint();
    var st = document.getElementById("locStatus");
    var api = window.__nakupko;
    var on = api && api.state && (api.state().settings || {}).locOn;
    if (!on) { var old = document.getElementById("bgStatus"); if (old) old.remove(); showGate({}, []); return; }
    var timer = setTimeout(function () { diag("iPhone se ne odziva (getStatus)"); }, 4000);
    Geo.getStatus().then(function (s) {
      clearTimeout(timer);
      diag(diagText(s));
      showLog(s);
      if (s.authorization === "notDetermined") return; // iOS še sprašuje
      var missing = missingOf(s);
      showGate(s, missing);
      if (!st) return;
      var box = document.getElementById("bgStatus");
      if (!box) {
        box = document.createElement("div");
        box.id = "bgStatus";
        box.style.marginTop = "6px";
        st.parentNode.appendChild(box);
      }
      box.textContent = "";
      if (!missing.length) {
        box.className = "small muted";
        box.style.color = "";
        box.textContent = "✓ Deluje tudi, ko je aplikacija zaprta.";
        return;
      }
      box.className = "small";
      box.style.color = "#c0392b";
      box.appendChild(document.createTextNode("Ko je aplikacija zaprta, ne deluje. "));
      var b = document.createElement("button");
      b.type = "button"; b.className = "link"; b.textContent = "Vklopi";
      b.onclick = function () { gateLater = false; showGate(s, missing); };
      box.appendChild(b);
    }).catch(function (e) { clearTimeout(timer); diag("iPhone napaka: " + (e && e.message || e)); });
  }
  // Kratka diagnostika za testiranje: kaj iPhone ve in kako daleč je najbližja trgovina.
  function diagText(s) {
    var parts = ["lokacija " + s.authorization, "obvestila " + (s.notifications ? "da" : "ne"), "spremljam " + s.regions + "/" + s.stores];
    if (!geoOverridden) parts.push("spletna lokacija");
    var list = ((window.__nakupko && window.__nakupko.state().storesCache) || {}).list || [];
    if (lastNativePos && list.length) {
      var best = null;
      list.forEach(function (x) {
        var dLat = (x.lat - lastNativePos.lat) * 111320, dLon = (x.lon - lastNativePos.lon) * 111320 * Math.cos(x.lat * Math.PI / 180);
        var d = Math.sqrt(dLat * dLat + dLon * dLon);
        if (!best || d < best.d) best = { d: d, n: x.short || x.name };
      });
      parts.push("najbližja " + best.n + " " + Math.round(best.d) + " m");
    } else parts.push("trgovin " + list.length);
    return "iPhone: " + parts.join(" · ");
  }
  // Dnevnik zaznavanja trgovin: samo v razvijalskem načinu (7 tapov na »Cene«).
  function showLog(s) {
    var st = document.getElementById("locStatus"), api = window.__nakupko;
    var box = document.getElementById("geoLog");
    var dev = api && api.state && (api.state().settings || {}).dev;
    if (!st || !dev) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("pre"); box.id = "geoLog"; box.className = "small muted"; box.style.cssText = "white-space:pre-wrap;margin:6px 0 0;font-size:12px;line-height:1.4"; st.parentNode.appendChild(box); }
    var lines = (s.log || []).slice(-12).reverse();
    box.textContent = "Seznam na zaklenjenem zaslonu: " + (s.liveToken ? "pripravljen" : "ni žetona (odpri aplikacijo)") + "\n" + (lines.length ? lines.join("\n") : "Še ni zaznanih trgovin.");
  }
  function diag(text) {
    var st = document.getElementById("locStatus");
    if (!st) return;
    var d = document.getElementById("geoDiag");
    if (!d) { d = document.createElement("div"); d.id = "geoDiag"; d.className = "small muted"; d.style.marginTop = "4px"; st.parentNode.appendChild(d); }
    d.textContent = text;
  }
  window.addEventListener("load", function () { setTimeout(showBackgroundStatus, 1500); });
  setInterval(showBackgroundStatus, 5000);

  // Navodila za dovoljenje naj kažejo na aplikacijo, ne na Safari.
  window.addEventListener("DOMContentLoaded", function () {
    var st = document.getElementById("locStatus");
    if (!st || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (/Safari/.test(st.textContent)) st.textContent = "Dostop do lokacije je zavrnjen. Na iPhonu: Nastavitve → Nakupko → Lokacija → Vedno.";
    }).observe(st, { childList: true, characterData: true, subtree: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      // Zaklepanje med odštevanjem »odpiram čez …«: nakupovanje odpremo takoj, da je seznam na zaklenjenem zaslonu.
      var sm = document.getElementById("storeMode"), btn = document.querySelector("#detectBar:not(.hidden) button");
      if (btn && sm && sm.classList.contains("hidden") && /odpiram/.test((document.getElementById("detectBar") || {}).textContent || "")) btn.click();
      sync(); syncShopping();
    }
    else { setTimeout(applyLiveDone, 200); setTimeout(openFromNotification, 300); setTimeout(showBackgroundStatus, 500); }
  });
  window.addEventListener("load", function () { setTimeout(applyLiveDone, 300); setTimeout(sync, 500); setTimeout(openFromNotification, 800); });
})();
