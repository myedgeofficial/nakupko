// Nakupko Plus: naročnina 0,99 €/mesec prek App Store (samo v iOS aplikaciji).
// Samo v gradnji za App Store (window.NAKUPKO_RELEASE); testne gradnje na TestFlightu nimajo reklam ne naročnine.
// Način (NAKUPKO_PLUS_MODE):
//   "ads"        – aplikacija je zastonj z reklamo spodaj, naročnina odstrani reklame (privzeto),
//   "full"       – brez naročnine se pokaže le okno za naročnino (prvi teden je brezplačen, nastavi se v App Store Connect),
//   "background" – seznam je zastonj, zaznavanje trgovine v ozadju je za naročnike,
//   "support"    – vse zastonj, v Nastavitvah je le gumb za podporo.
// Dokler naročnine v App Store še ni, aplikacija nikogar ne zaklene.
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  if (Cap.getPlatform && Cap.getPlatform() !== "ios") return; // Android: ko bo aplikacija na Google Play
  if (window.NAKUPKO_RELEASE !== true) return;
  var MODE = window.NAKUPKO_PLUS_MODE || "ads";
  // AdMob: ID oglasne enote za banner.
  var AD_UNIT = window.NAKUPKO_AD_UNIT || "ca-app-pub-1387718701947622/2328125258";
  var GRACE = 3 * 24 * 3600 * 1000; // brez povezave velja zadnja znana naročnina še 3 dni po izteku

  var Pay = {
    addListener: function (event, cb) { return Cap.addListener("NakupkoPay", event, cb); }
  };
  ["status", "buy", "restore", "manage"].forEach(function (m) {
    Pay[m] = function (opts) { return Cap.nativePromise("NakupkoPay", m, opts || {}); };
  });

  var st = null, busy = false, dismissed = false;
  try { st = JSON.parse(localStorage.getItem("nakupko-plus") || "null"); } catch (e) { st = null; }

  function active() {
    if (!st) return false;
    if (st.active) return true;
    return !!(st.offline && st.expires && st.expires + GRACE > Date.now());
  }
  // Zaklenjeno samo, če naročnina v App Store obstaja in je nimaš.
  function locked() { return MODE !== "support" && MODE !== "ads" && !!st && st.product === true && !active(); }
  window.__nakupkoPlus = { active: active, locked: function (what) { return locked() && (MODE === "full" || what === MODE); }, mode: MODE };

  function save(s, offline) {
    if (offline) { if (st) { st.offline = true; st.active = false; } }
    else st = s;
    try { localStorage.setItem("nakupko-plus", JSON.stringify(st)); } catch (e) { /* nič */ }
    render();
  }
  var retries = 0;
  function retryLater() {
    // App Store včasih izdelka ne vrne takoj (slaba povezava, pregled): poskusimo znova.
    if (retries < 5) setTimeout(refresh, 3000 * Math.pow(2, retries++));
  }
  function refresh() {
    Pay.status().then(function (s) {
      if (s.product !== true) retryLater(); else retries = 0;
      // Brez povezave App Store vrne product=false: obdržimo zadnje znano stanje.
      if (s.product === false && st && st.product) save(null, true);
      else save(s);
    }).catch(function () { render(); retryLater(); });
  }

  function priceText() { return (st && st.price) || "0,99 €"; }
  function trialText() {
    if (!st || !st.trialEligible || !st.trialDays) return "";
    var d = st.trialDays;
    return d >= 28 && d <= 31 ? "Prvi mesec brezplačno" : d % 7 === 0 ? (d / 7 === 1 ? "Prvi teden brezplačno" : "Prvih " + d / 7 + " tednov brezplačno") : "Prvih " + d + " dni brezplačno";
  }
  function expiresText() {
    if (!st || !st.expires) return "";
    var d = new Date(st.expires);
    return d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear();
  }

  function buy() {
    if (busy) return;
    busy = true; render();
    Pay.buy().then(function (s) {
      busy = false;
      save(s);
      if (s.result === "pending") alert("Nakup čaka na potrditev (npr. »Vprašaj starše«). Ko bo potrjen, se Nakupko odklene sam.");
    }).catch(function (e) {
      busy = false; render();
      alert("Nakup ni uspel: " + (e && e.message || e));
    });
  }
  function restore() {
    if (busy) return;
    busy = true; render();
    Pay.restore().then(function (s) {
      busy = false; save(s);
      if (!s.active) alert("Na tem Apple ID-ju ni aktivne naročnine.");
    }).catch(function () { busy = false; render(); });
  }
  function manage() { Pay.manage().then(save).catch(function () {}); }

  function btn(id, text, primary) {
    return '<button id="' + id + '" type="button" style="' + (primary
      ? "border:0;border-radius:16px;padding:16px;font-size:18px;font-weight:700;background:#8A3FFC;color:#fff;width:100%;max-width:340px;margin:0 auto"
      : "border:0;background:none;color:#8a8a96;padding:14px;font-size:15px") + '"' + (busy ? " disabled" : "") + ">" + text + "</button>";
  }

  // ---------- Okno za naročnino ----------
  function renderGate() {
    var g = document.getElementById("plusGate");
    var show = locked() && (MODE === "full" || (MODE === "background" && !dismissed && bgWanted()));
    if (!show) { if (g) g.remove(); return; }
    if (!g) {
      g = document.createElement("div");
      g.id = "plusGate";
      g.style.cssText = "position:fixed;inset:0;z-index:10000;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:32px 24px calc(24px + env(safe-area-inset-bottom));text-align:center;color:#1b1b1f;font-size:17px;line-height:1.45;overflow:auto";
      document.body.appendChild(g);
    }
    var trial = trialText();
    var what = MODE === "background"
      ? "Seznam se ti odpre sam, ko prideš v trgovino, tudi ko je aplikacija zaprta."
      : "Seznam, ki ve, kdaj si v trgovini.";
    g.innerHTML =
      '<img src="icon.svg" alt="" style="width:84px;height:84px;margin:0 auto 10px">' +
      '<h2 style="margin:0 0 8px;font-size:26px">Nakupko Plus</h2>' +
      '<p style="margin:0 0 20px;color:#5b5b66">' + what + '</p>' +
      '<div style="font-size:22px;font-weight:700;margin-bottom:4px">' + priceText() + ' na mesec</div>' +
      (trial ? '<div style="color:#8A3FFC;font-weight:600;margin-bottom:18px">' + trial + '</div>' : '<div style="margin-bottom:18px"></div>') +
      btn("plusBuy", busy ? "Trenutek …" : (trial ? "Začni brezplačno" : "Naroči se"), true) +
      btn("plusRestore", "Obnovi nakup") +
      (MODE === "background" ? btn("plusLater", "Ne zdaj") : "") +
      '<p style="margin:14px auto 0;max-width:340px;font-size:12px;color:#8a8a96">' +
      (trial ? "Po brezplačnem obdobju se naročnina" : "Naročnina se") + " vsak mesec samodejno podaljša, dokler je ne prekličeš najmanj 24 ur pred koncem obdobja v Nastavitvah → Apple ID → Naročnine. " +
      '<a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" style="color:#8a8a96">Pogoji uporabe</a> · ' +
      '<a href="zasebnost.html" style="color:#8a8a96">Zasebnost</a></p>';
    document.getElementById("plusBuy").onclick = buy;
    document.getElementById("plusRestore").onclick = restore;
    var later = document.getElementById("plusLater");
    if (later) later.onclick = function () { dismissed = true; renderGate(); };
  }
  function bgWanted() {
    var api = window.__nakupko;
    return !!(api && api.state && (api.state().settings || {}).locOn);
  }

  // ---------- Vrstica v Nastavitvah ----------
  function renderCard() {
    var anchor = document.querySelector("#tab-stores .card.settings");
    // Način »ads«: kartica je vedno vidna (tudi če App Store izdelka še ni naložil), nakup ga naloži znova.
    var ready = MODE === "ads" || (!!st && st.product === true);
    if (!anchor || !ready) { var o = document.getElementById("plusCard"); if (o && !ready) o.remove(); return; }
    var c = document.getElementById("plusCard");
    if (!c) {
      c = document.createElement("div");
      c.id = "plusCard"; c.className = "card settings";
      anchor.parentNode.insertBefore(c, anchor.nextSibling);
    }
    var on = active();
    var line = on
      ? (st.trial ? "Brezplačno obdobje" : "Naročen") + (st.expires ? " · " + (st.trial ? "do " : "podaljša se ") + expiresText() : "")
      : (MODE === "support" ? "Podpri razvoj Nakupka" : MODE === "ads" ? "Brez reklam" : "Ni naročnine") + " · " + priceText() + "/mesec";
    c.innerHTML =
      '<div class="set-row"><div class="set-text"><b>Nakupko Plus</b><span class="muted small">' + line + '</span></div>' +
      '<button id="plusCardBtn" class="mini" type="button"' + (busy ? " disabled" : "") + ">" + (on ? "Upravljaj" : MODE === "ads" ? "Odstrani reklame" : "Naroči se") + "</button></div>" +
      (on ? "" : '<button id="plusCardRestore" class="link small" type="button">Obnovi nakup</button>');
    document.getElementById("plusCardBtn").onclick = on ? manage : buy;
    var r = document.getElementById("plusCardRestore");
    if (r) r.onclick = restore;
  }

  // ---------- Reklama (način »ads«) ----------
  var Ads = {
    addListener: function (event, cb) { return Cap.addListener("AdMob", event, cb); },
    call: function (m, opts) { return Cap.nativePromise("AdMob", m, opts || {}); }
  };
  var ad = { started: false, shown: false, busy: false };
  function setAdHeight(h) {
    document.documentElement.style.setProperty("--ad-h", (h > 0 ? Math.round(h) : 0) + "px");
  }
  var adsStart = null;
  function startAds() {
    if (adsStart) return adsStart;
    ad.started = true;
    Ads.addListener("bannerAdSizeChanged", function (s) {
      // Reklama, ki se naloži šele po nakupu naročnine, takoj odstranimo.
      if (!ad.shown && !ad.busy && s && s.height > 0) Ads.call("removeBanner", {}).catch(function () {});
      setAdHeight(ad.shown && s ? s.height : 0);
    });
    // Privolitev (EU): Googlov obrazec se pokaže samo, če ga zakon zahteva in še ni odgovora.
    return (adsStart = Ads.call("initialize", {})
      .then(function () { return Ads.call("requestConsentInfo", {}); })
      .then(function (info) {
        if (info && info.status === "REQUIRED" && info.isConsentFormAvailable) return Ads.call("showConsentForm", {});
      })
      .catch(function () {}));
  }
  function renderAds() {
    if (MODE !== "ads" || ad.busy) return;
    var want = !!st && !active();
    if (want === ad.shown && ad.started) return;
    ad.busy = true;
    var p = startAds();
    p.then(function () {
      if (want) return Ads.call("showBanner", { adId: AD_UNIT, adSize: "ADAPTIVE_BANNER", position: "BOTTOM_CENTER", margin: 0 });
      return Ads.call("removeBanner", {});
    }).then(function () { ad.shown = want; if (!want) setAdHeight(0); })
      .catch(function () { setAdHeight(0); })
      .then(function () { ad.busy = false; if ((!!st && !active()) !== ad.shown) renderAds(); });
  }

  // ---------- Reklama čez cel zaslon: največ 2× na teden, ob 3. in 6. odprtju v tednu ----------
  // Ne ob samem odprtju: pokaže se ob naslednjem premoru (konec nakupa ali menjava zavihka).
  var AD_INTER = window.NAKUPKO_AD_INTER || "ca-app-pub-1387718701947622/3310034439";
  var OPEN_KEY = "nakupko-odprtja", AWAY = 10 * 60 * 1000;
  var inter = { ready: false, loading: false, listening: false }, openedAt = 0, hiddenAt = 0;
  function weekKey() {
    var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); // ponedeljek
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function opens() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); } catch (e) { o = null; }
    if (!o || o.week !== weekKey()) o = { week: weekKey(), n: 0, pending: false };
    return o;
  }
  function saveOpens(o) { try { localStorage.setItem(OPEN_KEY, JSON.stringify(o)); } catch (e) { /* nič */ } }
  function countOpen() {
    var o = opens();
    o.n++;
    if (o.n === 3 || o.n === 6) o.pending = true;
    saveOpens(o);
    openedAt = Date.now();
    if (o.pending) prepareInter();
  }
  function interWanted() { return MODE === "ads" && !!AD_INTER && !!st && st.product === true && !active() && opens().pending; }
  function prepareInter() {
    if (!interWanted() || inter.ready || inter.loading) return;
    if (!inter.listening) {
      inter.listening = true;
      Ads.addListener("interstitialAdDismissed", function () { inter.ready = false; });
      Ads.addListener("interstitialAdFailedToShow", function () { inter.ready = false; });
    }
    inter.loading = true;
    startAds()
      .then(function () { return Ads.call("prepareInterstitial", { adId: AD_INTER }); })
      .then(function () { inter.ready = true; }, function () { inter.ready = false; })
      .then(function () { inter.loading = false; });
  }
  function maybeShowInter() {
    if (!inter.ready || !interWanted() || Date.now() - openedAt < 5000) return;
    var o = opens(); o.pending = false; saveOpens(o);
    inter.ready = false;
    Ads.call("showInterstitial", {}).catch(function () {});
  }
  function watchBreaks() {
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".tabs button")) setTimeout(maybeShowInter, 300);
    }, true);
    var sm = document.getElementById("storeMode"), wasOpen = false;
    if (sm && window.MutationObserver) new MutationObserver(function () {
      var open = !sm.classList.contains("hidden");
      if (wasOpen && !open) setTimeout(maybeShowInter, 600);
      wasOpen = open;
    }).observe(sm, { attributes: true, attributeFilter: ["class"] });
  }

  function render() {
    if (!document.body) return;
    renderGate();
    renderCard();
    renderAds();
    prepareInter();
  }

  Pay.addListener("change", function (s) { save(s); });
  window.addEventListener("load", function () { countOpen(); watchBreaks(); render(); refresh(); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > AWAY) countOpen(); // vrnitev po 10+ minutah šteje kot novo odprtje
    refresh();
  });
  // Način »background«: okno pokažemo, ko nekdo vklopi zaznavanje trgovine.
  setInterval(function () { if (MODE === "background") renderGate(); if (!document.getElementById("plusCard")) renderCard(); }, 2000);
})();
