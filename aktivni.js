// Anonimno štetje aktivnih uporabnikov: enkrat na dan zapišemo naključno številko naprave,
// platformo in ali ima Nakupko Plus. Brez imen, lokacije in vsebine seznama.
(function () {
  "use strict";
  var DB = window.NAKUPKO_SYNC_URL || "https://nakupko-8ad19-default-rtdb.europe-west1.firebasedatabase.app";
  var ID_KEY = "nakupko-naprava", DAY_KEY = "nakupko-aktiven";
  var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* nič */ } }
  function deviceId() {
    var id = get(ID_KEY);
    if (/^[A-Z0-9]{20}$/.test(id)) return id;
    var a = new Uint32Array(20); id = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < 20; i++) id += ALPHA[a[i] % ALPHA.length];
    set(ID_KEY, id);
    return id;
  }
  function today() {
    try { return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function platform() {
    var c = window.Capacitor;
    try { if (c && c.getPlatform) return c.getPlatform(); } catch (e) { /* nič */ }
    return "web";
  }
  function ping() {
    var day = today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || get(DAY_KEY) === day || !window.fetch || !window.crypto) return;
    var plus = window.__nakupkoPlus;
    var body = { p: platform(), plus: plus && plus.active && plus.active() ? 1 : 0, r: window.NAKUPKO_RELEASE ? 1 : 0 };
    fetch(DB + "/akt/" + day + "/" + deviceId() + ".json", { method: "PUT", body: JSON.stringify(body) })
      .then(function (r) { if (r.ok) set(DAY_KEY, day); })
      .catch(function () { /* poskusimo ob naslednjem odprtju */ });
  }
  setTimeout(ping, 4000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(ping, 1000); });
})();
