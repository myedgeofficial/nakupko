// Nakupko iOS/Android: most med spletno aplikacijo in telefonom.
// Naloži se le v aplikaciji (iOS ali Android), pred app.js. Spletne kode ne spreminja:
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
  var platform = Cap.getPlatform ? Cap.getPlatform() : "ios";
  document.documentElement.classList.add("native-" + platform);

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

  // ---------- Skupen seznam: EventSource prek rednega branja ----------
  // V iOS aplikaciji (capacitor://) se tok do Firebase ne vzpostavi in seznam ostane »Ni povezave«.
  // Zato household.js namesto toka dobi enako obliko dogodkov z branjem vsake 3 s.
  function PollSource(u) {
    var self = this, last = null, timer = null, stopped = false, handlers = {};
    self.url = u; self.onerror = null;
    self.addEventListener = function (t, fn) { (handlers[t] = handlers[t] || []).push(fn); };
    self.close = function () { stopped = true; clearTimeout(timer); };
    function emit(t, data) { (handlers[t] || []).forEach(function (fn) { fn({ type: t, data: data }); }); }
    function tick() {
      if (stopped) return;
      if (document.hidden) { timer = setTimeout(tick, 3000); return; }
      fetch(u, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      }).then(function (t) {
        if (stopped) return;
        if (t !== last) { last = t; emit("put", JSON.stringify({ path: "/", data: JSON.parse(t) })); }
      }).catch(function () {
        last = null;
        if (!stopped && self.onerror) self.onerror({ type: "error" });
      }).then(function () { if (!stopped) timer = setTimeout(tick, 3000); });
    }
    tick();
  }
  window.EventSource = PollSource;

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

  // ---------- Stikalo »Obvestilo, ko je trgovina blizu« (največ 1× na 15 min) ----------
  var NEAR_KEY = "nakupko.nearNotify";
  function nearNotifyOn() { try { return localStorage.getItem(NEAR_KEY) !== "0"; } catch (e) { return true; } }
  function nearSwitch() {
    var tip = document.getElementById("btnTip"), row = tip && tip.closest(".set-row");
    if (!row || document.getElementById("btnNear")) return;
    var r = document.createElement("div");
    r.className = "set-row";
    r.innerHTML = '<div class="set-text"><b>Obvestilo »trgovina je blizu«</b>' +
      '<span class="muted small">Ko greš mimo trgovine. Največ enkrat na 15 minut. Seznam ob prihodu v trgovino deluje tudi brez tega.</span></div>' +
      '<button id="btnNear" class="switch" type="button" role="switch" aria-label="Obvestilo trgovina je blizu"></button>';
    row.parentNode.insertBefore(r, row);
    var b = document.getElementById("btnNear");
    function paint() { b.setAttribute("aria-checked", nearNotifyOn() ? "true" : "false"); }
    paint();
    b.onclick = function () {
      try { localStorage.setItem(NEAR_KEY, nearNotifyOn() ? "0" : "1"); } catch (e) { /* ni shrambe */ }
      paint(); sync();
    };
  }
  window.addEventListener("DOMContentLoaded", nearSwitch);

  // ---------- Skupen seznam: vidna oznaka nad seznamom (s kom je povezan) ----------
  var hhKnown = null;
  function hhBadge() {
    var hh = window.__nakupkoHousehold ? window.__nakupkoHousehold() : null;
    var head = document.querySelector("#countOpen") && document.querySelector("#countOpen").closest(".card-head");
    var b = document.getElementById("hhBadge");
    if (!hh || !head) { if (b) b.remove(); hhKnown = null; return; }
    if (!b) {
      b = document.createElement("button");
      b.id = "hhBadge"; b.type = "button"; b.className = "hh-badge";
      b.onclick = function () { var t = document.querySelector('[data-tab="stores"]'); if (t) t.click(); var c = document.getElementById("hhCard"); if (c) setTimeout(function () { c.scrollIntoView({ behavior: "smooth", block: "center" }); }, 100); };
      head.parentNode.insertBefore(b, head.nextSibling);
    }
    fetch(hh.url + "/h/" + hh.code + "/members.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (m) {
      var others = Object.keys(m || {}).filter(function (k) { return k !== hh.member && m[k]; })
        .map(function (k) { return m[k].name || "Član"; });
      b.classList.remove("off");
      b.textContent = others.length ? "👥 Skupen seznam z: " + others.join(", ") : "👥 Skupen seznam · čakam, da se pridruži še kdo";
      if (hhKnown) others.filter(function (n) { return hhKnown.indexOf(n) < 0; }).forEach(function (n) {
        var api = window.__nakupko; if (api && api.toast) api.toast("👥 " + n + " je zdaj na tvojem seznamu");
      });
      hhKnown = others;
    }).catch(function () {
      b.classList.add("off");
      b.textContent = "👥 Skupen seznam · ni povezave";
    });
  }
  window.addEventListener("load", function () { setTimeout(hhBadge, 600); });
  setInterval(function () { if (!document.hidden) hhBadge(); }, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(hhBadge, 300); });

  // ---------- Sinhronizacija z iPhonom (spremljanje trgovin v ozadju) ----------
  var lastSent = "";
  function sync() {
    var api = window.__nakupko;
    if (!api || !api.state) return;
    var s = api.state();
    // Brez naročnine Nakupko Plus (če jo ta način zahteva) iPhone trgovin v ozadju ne spremlja.
    var on = !!(s.settings && s.settings.locOn) && !(window.__nakupkoPlus && window.__nakupkoPlus.locked("background"));
    var cfg = { enabled: on, radius: (s.settings && s.settings.radius) || 75, stores: [], groups: [], items: [], dbUrl: window.NAKUPKO_SYNC_URL || "https://nakupko-8ad19-default-rtdb.europe-west1.firebasedatabase.app", household: window.__nakupkoHousehold ? window.__nakupkoHousehold() : null, nearNotify: nearNotifyOn() };
    if (on) {
      var list = (s.storesCache && s.storesCache.list) || [];
      // Samo verige in dežurne trgovine; urnik iPhonu pove, ali je trgovina odprta.
      cfg.stores = list.filter(function (x) { return !/^test\//.test(x.id) && (x.chain || x.duty); }).map(function (x) {
        return { id: x.id, name: x.short || x.name, lat: x.lat, lon: x.lon, chain: x.chain || null, duty: !!x.duty, hours: x.hours || "",
          only: x.chain && api.chainOnly ? api.chainOnly(x.chain) : "" };
      });
      cfg.groups = groupsOf((s.items || []).filter(function (i) { return !i.done; }));
      cfg.items = liveItemsOf((s.items || []).filter(function (i) { return !i.done; }));
      // Cena seznama po verigah (za namig »drugje je ceneje« v obvestilu).
      cfg.chainCost = {};
      if (api.priceFor && (s.settings || {}).cheaperTip !== false) {
        var openIt = (s.items || []).filter(function (i) { return !i.done && !/^(Dom in vrt|Tobak)$/.test(i.cat || ""); });
        var keys = {};
        cfg.stores.forEach(function (x) { if (x.chain && !x.only) keys[x.chain] = 1; });
        Object.keys(keys).forEach(function (k) {
          var sum = 0, miss = 0;
          openIt.forEach(function (i) { var p = api.priceFor(i.name, k); if (p && p.price != null) sum += p.price * (i.qty || 1); else miss++; });
          if (openIt.length && !miss) cfg.chainCost[k] = Math.round(sum * 100) / 100;
        });
      }
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
      // Obvestilo »trgovina je blizu«: odpremo prav to trgovino, ne čakamo na GPS v aplikaciji.
      if (api && api.openStoreById) { api.openStoreById(r.storeId); return; }
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

  // Ena velikost za vse (tudi za starejše): stran je 12 % večja prek viewporta – postavitev se
  // prilagodi ožjemu zaslonu, zato se ne da premikati levo-desno. Izbire velikosti v aplikaciji ni.
  var VIEW_ZOOM = 1.12;
  (function () {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) return;
    var w = Math.min(screen.width, screen.height);
    m.setAttribute("content", "width=" + Math.round(w / VIEW_ZOOM) + ", initial-scale=" + VIEW_ZOOM + ", maximum-scale=" + VIEW_ZOOM + ", user-scalable=no, viewport-fit=cover");
  })();
  function oneSize() {
    var api = window.__nakupko, st = api && api.state && api.state().settings;
    if (st) st.size = "young";
    var c = document.documentElement.classList;
    c.remove("size-mid", "size-senior"); c.add("size-young");
  }
  window.addEventListener("DOMContentLoaded", function () {
    oneSize();
    // Uvodno vprašanje »Kako velik naj bo prikaz?« preskočimo.
    var t = document.getElementById("obTitle"), ob = document.getElementById("onboard");
    if (!t || !ob || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (/Kako velik/.test(t.textContent) && !ob.classList.contains("hidden")) { ob.classList.add("hidden"); oneSize(); }
    }).observe(ob, { attributes: true, childList: true, subtree: true, characterData: true });
  });
  var lastZoom = 0;
  function syncZoom() {
    var z = 1;
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
  // Hitro odpiranje: gumb Akcija in dvojni dotik zadaj. Apple tega ne pusti nastaviti iz aplikacije,
  // zato pokažemo kratko animacijo korakov (enkrat ob prvem obisku Nastavitev, potem na tap).
  var QUICK_KEY = "nakupko.quickOpenSeen";
  // Vsak korak: naslov zaslona, vrstice, katero tapnemo (indeks, "plus", "done", "search", "back"), napis.
  var FLOWS = {
    back: [
      { home: true, tap: 0, cap: "Odpri app Shortcuts" },
      { sc: "all", cap: "Tapni + spodaj na sredini" },
      { sc: "new", cap: "Zgoraj desno tapni »Edit«" },
      { sc: "actions", cap: "Spodaj tapni »Search«" },
      { sc: "search", cap: "Vpiši Nakupko in tapni »Odpri Nakupko«" },
      { sc: "done", cap: "Zgoraj levo tapni ‹ in bližnjica je shranjena" },
      { dark: true, title: "Settings", rows: ["General", "Accessibility", "Action Button", "Camera"], tap: 1, cap: "Odpri Settings → Accessibility" },
      { dark: true, title: "Accessibility", rows: ["Read & Speak", "Audio Descriptions", "Touch", "Face ID & Attention"], tap: 2, cap: "Pomakni dol do »Physical and Motor« → Touch" },
      { dark: true, title: "Touch", rows: ["Vibration", "Prevent Lock to End Call", "Call Audio Routing", "Back Tap"], tap: 3, cap: "Pomakni čisto dol → Back Tap" },
      { dark: true, title: "Back Tap", rows: ["Double Tap", "Triple Tap"], tap: 0, cap: "Tapni »Double Tap« (ali Triple Tap)" },
      { dark: true, title: "Double Tap", rows: ["None", "Screenshot", "Odpri Nakupko"], tap: 2, check: 2, cap: "Pod »Shortcuts« izberi »Odpri Nakupko«" },
      { knock: true, cap: "Dvakrat potrkaj po hrbtu telefona in Nakupko se odpre" }
    ],
    action: [
      { dark: true, title: "Settings", rows: ["General", "Accessibility", "Action Button", "Camera"], tap: 2, cap: "Odpri Settings → Action Button" },
      { dark: true, title: "Action Button", rows: [], big: "Shortcut", cap: "Podrsaj do »Shortcut«" },
      { dark: true, title: "Action Button", rows: [], big: "Shortcut", btn: "Choose a Shortcut…", tap: "btn", cap: "Tapni »Choose a Shortcut«" },
      { dark: true, title: "Shortcuts", rows: ["Notes", "Nakupko", "Clock"], tap: 1, cap: "Tapni »Nakupko«" },
      { dark: true, title: "Nakupko", rows: ["🧺  Odpri Nakupko"], tap: 0, check: 0, cap: "Izberi »Odpri Nakupko«" },
      { press: true, cap: "Drži gumb Action Button in Nakupko se odpre" }
    ]
  };
  function quickScreen(st) {
    if (st.home) {
      var apps = ["⚡️|Shortcuts", "⚙️|Settings", "📷|Camera", "🧺|Nakupko"];
      return '<div class="qo-home">' + apps.map(function (a, i) {
        var x = a.split("|");
        return '<div class="qo-app' + (i === st.tap ? " qo-hit" : "") + '"><span>' + x[0] + '</span><small>' + x[1] + '</small></div>';
      }).join("") + '</div>';
    }
    if (st.sc) {
      var hit = ' qo-hit';
      if (st.sc === "all") return '<div class="qo-sc"><div class="qo-sc-top"><i>‹</i><i class="pill">Select</i></div><b class="qo-sc-h">All Shortcuts</b>' +
        '<div class="qo-sc-search">🔍 Search</div><div class="qo-sc-tiles"><span>Jarvis</span><span class="pink">Time of Day</span></div>' +
        '<div class="qo-sc-plus' + hit + '">+</div></div>';
      if (st.sc === "new") return '<div class="qo-sc"><div class="qo-sc-top"><i>‹</i><small>New Shortcut</small><i class="pill' + hit + '">Edit</i></div>' +
        '<div class="qo-sc-ask">What do you want your shortcut to do?</div><div class="qo-sc-desc">Describe a shortcut</div></div>';
      if (st.sc === "actions") return '<div class="qo-sc"><div class="qo-sc-top"><i>‹</i><small>New Shortcut</small><i></i></div>' +
        '<p class="qo-sc-note">Add actions from below to create a shortcut.</p><div class="qo-sc-sheet"><div class="qo-sc-search' + hit + '">🔍 Search</div>' +
        '<div class="qo-sc-act">💬 Send Message</div><div class="qo-sc-act">↗ Open App</div></div></div>';
      if (st.sc === "search") return '<div class="qo-sc"><div class="qo-sc-sheet top"><div class="qo-sc-search">🔍 <span class="qo-type">Nakupko</span></div>' +
        '<div class="qo-sc-app">🧺 Nakupko</div><div class="qo-sc-act' + hit + '">🧺 Odpri Nakupko</div></div></div>';
      return '<div class="qo-sc"><div class="qo-sc-top"><i class="' + hit.trim() + '">‹</i><small>Odpri Nakupko</small><i></i></div>' +
        '<div class="qo-sc-act" style="margin-top:20px">🧺 Odpri Nakupko</div></div>';
    }
    if (st.knock || st.press) {
      return '<div class="qo-end"><div class="qo-phone-back' + (st.press ? " qo-side" : "") + '">' +
        (st.knock ? '<i class="qo-ripple"></i><i class="qo-ripple qo-r2"></i>' : '<i class="qo-btn"></i>') +
        '</div><div class="qo-open">🧺 Nakupko</div></div>';
    }
    var h = '<div class="qo-bar"><span>' + (st.tap === "back" ? "‹" : "") + '</span><b>' + st.title + '</b>' +
      '<span class="' + (st.tap === "plus" ? "qo-hit" : "") + '">' + (st.tap === "plus" ? "+" : st.tap === "done" ? "" : "") + '</span>' +
      (st.tap === "done" ? '<span class="qo-done qo-hit">Done</span>' : "") + '</div>';
    if (st.search) h += '<div class="qo-search">🔍 <span class="qo-type">' + st.search + '</span></div>';
    if (st.big) h += '<div class="qo-big">⚡️<br>' + st.big + '</div>';
    if (st.btn) h += '<div class="qo-btn2' + (st.tap === "btn" ? " qo-hit" : "") + '">' + st.btn + '</div>';
    h += st.rows.map(function (r, i) {
      return '<div class="qo-row' + (i === st.tap ? " qo-hit" : "") + '">' + r + (i === st.check ? '<span class="qo-check">✓</span>' : '<span class="qo-chev">›</span>') + '</div>';
    }).join("");
    return h;
  }
  function quickPlayer(box) {
    var flow = "back", i = 0, timer = null;
    var phone = box.querySelector(".qo-screen"), cap = box.querySelector(".qo-cap"), dots = box.querySelector(".qo-dots");
    function show() {
      var steps = FLOWS[flow], st = steps[i];
      phone.classList.remove("qo-in"); void phone.offsetWidth;
      phone.innerHTML = quickScreen(st);
      phone.classList.toggle("qo-dk", !!(st.sc || st.dark));
      phone.classList.add("qo-in");
      cap.textContent = (i + 1) + ". " + st.cap;
      dots.innerHTML = steps.map(function (_, k) { return '<i class="' + (k === i ? "on" : "") + '"></i>'; }).join("");
      clearTimeout(timer);
      if (!paused) timer = setTimeout(function () { i = (i + 1) % steps.length; show(); }, st.knock || st.press ? 6000 : 4500);
    }
    var paused = false;
    function go(d) { paused = true; var n = FLOWS[flow].length; i = (i + d + n) % n; show(); }
    box.querySelector(".qo-prev").onclick = function () { go(-1); };
    box.querySelector(".qo-next").onclick = function () { go(1); };
    box.querySelectorAll(".qo-tab").forEach(function (b) {
      b.onclick = function () {
        flow = b.dataset.flow; i = 0; paused = false;
        box.querySelectorAll(".qo-tab").forEach(function (x) { x.classList.toggle("on", x === b); });
        show();
      };
    });
    phone.onclick = function () { go(1); };
    return { start: show, stop: function () { clearTimeout(timer); } };
  }
  function quickOpenCard() {
    var card = document.querySelector("#tab-stores .card.settings");
    if (!card || document.getElementById("quickOpen")) return;
    var seen = false;
    try { seen = localStorage.getItem(QUICK_KEY) === "1"; } catch (e) { /* ni shrambe */ }
    var box = document.createElement("div");
    box.id = "quickOpen"; box.className = "card";
    box.innerHTML =
      '<button id="quickOpenHead" type="button" class="link" style="padding:0;font-weight:700">Hitro odpiranje Nakupka</button>' +
      '<div id="quickOpenBody" style="margin-top:10px">' +
      '<div class="qo-tabs"><button type="button" class="qo-tab on" data-flow="back">Dotik zadaj</button><button type="button" class="qo-tab" data-flow="action">Gumb Akcija</button></div>' +
      '<div class="qo-phone"><div class="qo-screen"></div></div>' +
      '<div class="qo-nav"><button type="button" class="qo-prev" aria-label="Nazaj">‹</button><div class="qo-dots"></div><button type="button" class="qo-next" aria-label="Naprej">›</button></div><p class="qo-cap"></p>' +
      '<button id="quickOpenOk" type="button" class="primary">V redu</button></div>';
    card.parentNode.insertBefore(box, card.nextSibling);
    var body = document.getElementById("quickOpenBody"), player = quickPlayer(box);
    function setOpen(o) { body.style.display = o ? "" : "none"; if (o) player.start(); else player.stop(); }
    setOpen(!seen);
    document.getElementById("quickOpenHead").onclick = function () { setOpen(body.style.display === "none"); };
    document.getElementById("quickOpenOk").onclick = function () {
      setOpen(false);
      try { localStorage.setItem(QUICK_KEY, "1"); } catch (e) { /* ni shrambe */ }
    };
  }

  // Razdalja in zamik sta za vse enaka (preizkušeno najbolj tekoče), drsnikov v aplikaciji ni.
  function fixedDetection() {
    var api = window.__nakupko, st = api && api.state && api.state().settings;
    if (!st) return;
    st.radius = 75; st.delay = 10;
  }

  function showBackgroundStatus() {
    if (isIOS) quickOpenCard();
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
      // Zaznava je vklopljena, dovoljenje je, a stikalo je ostalo izklopljeno (npr. med prvim vprašanjem): spet vklopi.
      var sw = document.getElementById("btnLoc");
      if (s.authorization !== "denied" && sw && sw.getAttribute("aria-checked") !== "true") sw.click();
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
    return (isIOS ? "iPhone: " : "Telefon: ") + parts.join(" · ");
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
    var st = document.getElementById("locStatus"), api = window.__nakupko;
    var d = document.getElementById("geoDiag");
    // Tehnični podatki samo v razvijalskem načinu (7 tapov na »Cene«).
    if (!st || !(api && api.state && (api.state().settings || {}).dev)) { if (d) d.remove(); return; }
    if (!d) { d = document.createElement("div"); d.id = "geoDiag"; d.className = "small muted"; d.style.marginTop = "4px"; st.parentNode.appendChild(d); }
    d.textContent = text;
  }
  window.addEventListener("load", function () { fixedDetection(); quickOpenCard(); setTimeout(showBackgroundStatus, 1500); });
  setInterval(showBackgroundStatus, 5000);

  // Navodila za dovoljenje naj kažejo na aplikacijo, ne na Safari.
  window.addEventListener("DOMContentLoaded", function () {
    var st = document.getElementById("locStatus");
    if (!st || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (!/Safari/.test(st.textContent)) return;
      st.textContent = platform === "android"
        ? "Dostop do lokacije je zavrnjen. Na telefonu: Nastavitve → Aplikacije → Nakupko → Dovoljenja → Lokacija → Vedno dovoli."
        : "Dostop do lokacije je zavrnjen. Na iPhonu: Nastavitve → Nakupko → Lokacija → Vedno.";
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
