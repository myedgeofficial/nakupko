// Nakupko Plus: naročnina 1 €/mesec prek App Store (samo v iOS aplikaciji).
// Način (NAKUPKO_PLUS_MODE):
//   "full"       – brez naročnine se pokaže le okno za naročnino (prvi mesec je brezplačen, nastavi se v App Store Connect),
//   "background" – seznam je zastonj, zaznavanje trgovine v ozadju je za naročnike,
//   "support"    – vse zastonj, v Nastavitvah je le gumb za podporo.
// Dokler naročnine v App Store še ni, aplikacija nikogar ne zaklene.
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  if (Cap.getPlatform && Cap.getPlatform() !== "ios") return; // Android: ko bo aplikacija na Google Play
  var MODE = window.NAKUPKO_PLUS_MODE || "full";
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
  function locked() { return MODE !== "support" && !!st && st.product === true && !active(); }
  window.__nakupkoPlus = { active: active, locked: function (what) { return locked() && (MODE === "full" || what === MODE); }, mode: MODE };

  function save(s, offline) {
    if (offline) { if (st) { st.offline = true; st.active = false; } }
    else st = s;
    try { localStorage.setItem("nakupko-plus", JSON.stringify(st)); } catch (e) { /* nič */ }
    render();
  }
  function refresh() {
    Pay.status().then(function (s) {
      // Brez povezave App Store vrne product=false: obdržimo zadnje znano stanje.
      if (s.product === false && st && st.product) save(null, true);
      else save(s);
    }).catch(function () { render(); });
  }

  function priceText() { return (st && st.price) || "1 €"; }
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
    if (!anchor || !st || st.product !== true) { var o = document.getElementById("plusCard"); if (o && (!st || st.product !== true)) o.remove(); return; }
    var c = document.getElementById("plusCard");
    if (!c) {
      c = document.createElement("div");
      c.id = "plusCard"; c.className = "card settings";
      anchor.parentNode.insertBefore(c, anchor.nextSibling);
    }
    var on = active();
    var line = on
      ? (st.trial ? "Brezplačno obdobje" : "Naročen") + (st.expires ? " · " + (st.trial ? "do " : "podaljša se ") + expiresText() : "")
      : (MODE === "support" ? "Podpri razvoj Nakupka" : "Ni naročnine") + " · " + priceText() + "/mesec";
    c.innerHTML =
      '<div class="set-row"><div class="set-text"><b>Nakupko Plus</b><span class="muted small">' + line + '</span></div>' +
      '<button id="plusCardBtn" class="mini" type="button"' + (busy ? " disabled" : "") + ">" + (on ? "Upravljaj" : "Naroči se") + "</button></div>" +
      (on ? "" : '<button id="plusCardRestore" class="link small" type="button">Obnovi nakup</button>');
    document.getElementById("plusCardBtn").onclick = on ? manage : buy;
    var r = document.getElementById("plusCardRestore");
    if (r) r.onclick = restore;
  }

  function render() {
    if (!document.body) return;
    renderGate();
    renderCard();
  }

  Pay.addListener("change", function (s) { save(s); });
  window.addEventListener("load", function () { render(); refresh(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  // Način »background«: okno pokažemo, ko nekdo vklopi zaznavanje trgovine.
  setInterval(function () { if (MODE === "background") renderGate(); if (!document.getElementById("plusCard")) renderCard(); }, 2000);
})();
