// Skupen seznam za gospodinjstvo: isti seznam na več telefonih prek kode.
// Seznam hrani Firebase Realtime Database (REST + EventSource, brez knjižnic).
// Privolitev: kdor se pridruži s kodo, čaka, da ga nekdo s seznama sprejme (dobi obvestilo).
// »… je v trgovini« se pošilja samo, če je član to sam vklopil (loc), izklopi se v Nastavitvah.
(function () {
  "use strict";
  var DB = window.NAKUPKO_SYNC_URL || "https://nakupko-8ad19-default-rtdb.europe-west1.firebasedatabase.app";
  var CODE_KEY = "nakupko-household", DIRTY_KEY = "nakupko-household-dirty", MEMBER_KEY = "nakupko-member", NAME_KEY = "nakupko-name";
  var STATUS_KEY = "nakupko-hh-status", LOC_KEY = "nakupko-hh-loc";
  var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var api = window.__nakupko;
  if (!api || !api.setItems) return;

  var code = "", shared = null, dirty = {}, es = null, online = false, retry = null;
  var members = null, mes = null, asked = {};
  try { code = localStorage.getItem(CODE_KEY) || ""; dirty = JSON.parse(localStorage.getItem(DIRTY_KEY) || "{}") || {}; } catch (e) { /* nič */ }

  function $(id) { return document.getElementById(id); }
  function url(path) { return DB + "/h/" + code + "/items" + (path || "") + ".json"; }
  function canon(v) {
    if (!v || typeof v !== "object") return JSON.stringify(v);
    return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function cleanCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function pretty(c) { return c.replace(/^(.{4})(.{4})(.*)$/, "$1-$2-$3"); }
  function newCode() {
    var a = new Uint32Array(10), s = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < 10; i++) s += ALPHA[a[i] % ALPHA.length];
    return s;
  }
  function saveDirty() { try { localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty)); } catch (e) { /* nič */ } }

  // Seznam = stanje na strežniku + lokalne spremembe, ki še niso poslane.
  function apply() {
    var map = Object.assign({}, shared);
    Object.keys(dirty).forEach(function (id) { if (dirty[id] === null) delete map[id]; else map[id] = dirty[id]; });
    var list = Object.keys(map).map(function (id) { return map[id]; }).filter(function (i) { return i && i.id && i.name; });
    list.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    var cur = api.state().items;
    if (canon(cur.slice().sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); })) === canon(list)) return;
    api.setItems(JSON.parse(JSON.stringify(list)));  // kopija: aplikacija izdelke spreminja na mestu
  }

  // Po vsakem shranjevanju pošljemo spremenjene izdelke.
  function afterSave() {
    if (!code || !shared) return;
    var local = {};
    api.state().items.forEach(function (i) { local[i.id] = i; });
    var changed = false;
    Object.keys(local).forEach(function (id) {
      var base = id in dirty ? dirty[id] : shared[id];
      if (canon(base) !== canon(local[id])) { dirty[id] = JSON.parse(JSON.stringify(local[id])); changed = true; }
    });
    Object.keys(shared).concat(Object.keys(dirty)).forEach(function (id) {
      if (!local[id] && (id in dirty ? dirty[id] !== null : true)) { dirty[id] = null; changed = true; }
    });
    if (changed) { saveDirty(); flush(); }
  }

  function flush() {
    if (!code || !Object.keys(dirty).length) return;
    var sent = JSON.parse(JSON.stringify(dirty)), c = code;
    fetch(url(), { method: "PATCH", body: JSON.stringify(sent) }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      if (c !== code) return;
      Object.keys(sent).forEach(function (id) {
        if (sent[id] === null) delete shared[id]; else shared[id] = sent[id];
        if (canon(dirty[id]) === canon(sent[id])) delete dirty[id];
      });
      saveDirty();
    }).catch(function () {
      clearTimeout(retry);
      retry = setTimeout(flush, 8000);
    });
  }

  function connect() {
    disconnect();
    if (!code || !DB || !window.EventSource) return;
    var first = true;
    es = new EventSource(url());
    function onData(kind) {
      return function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m) return;
        if (m.path === "/") {
          if (kind === "put") shared = m.data || {};
          else Object.keys(m.data || {}).forEach(function (id) { if (m.data[id] === null) delete shared[id]; else shared[id] = m.data[id]; });
        } else if (shared) {
          var parts = m.path.split("/").filter(Boolean), id = parts[0];
          if (parts.length === 1) { if (m.data === null) delete shared[id]; else shared[id] = m.data; }
          else if (shared[id]) { if (m.data === null) delete shared[id][parts[1]]; else shared[id][parts[1]] = m.data; }
        }
        if (!shared) return;
        if (first) {
          // Ob pridružitvi ohranimo tudi izdelke, ki so bili do zdaj samo na tem telefonu.
          first = false;
          api.state().items.forEach(function (i) { if (!shared[i.id] && !(i.id in dirty)) dirty[i.id] = JSON.parse(JSON.stringify(i)); });
          saveDirty();
        }
        online = true; renderCard();
        apply(); flush();
      };
    }
    es.addEventListener("put", onData("put"));
    es.addEventListener("patch", onData("patch"));
    es.addEventListener("cancel", function () { online = false; renderCard(); });
    es.onerror = function () { online = false; renderCard(); };
  }
  function disconnect() { if (es) { es.close(); es = null; } shared = null; online = false; }

  // Kdo si: ime vidijo ostali v obvestilu »Teo je v Sparu«.
  function member() {
    var m = "";
    try { m = localStorage.getItem(MEMBER_KEY) || ""; if (!m) { m = newCode(); localStorage.setItem(MEMBER_KEY, m); } } catch (e) { /* nič */ }
    return m;
  }
  function myName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function askName() {
    var n = (prompt("Tvoje ime (vidijo ga ostali v skupnem seznamu):", myName()) || "").trim().slice(0, 30);
    if (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* nič */ } }
    return n;
  }
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* nič */ } }
  // Stanje pridružitve: "pending" = čaka na potrditev; prazno (starejše različice) ali "ok" = sprejet.
  function pending() { return get(STATUS_KEY) === "pending"; }
  // Ali smem ostalim sporočiti, ko sem v trgovini: "1" da, "0" ne, prazno = še nisem odgovoril (= ne).
  function locOn() { return get(LOC_KEY) === "1"; }
  function memberUrl(id) { return DB + "/h/" + code + "/members/" + id + ".json"; }
  function nativeSync() { if (window.__nakupkoNativeSync) window.__nakupkoNativeSync(); }

  function announce() {
    if (!code || pending()) return;
    fetch(memberUrl(member()), { method: "PATCH", body: JSON.stringify({ name: myName() || "Član", lang: window.NK_LANG || "sl", at: { ".sv": "timestamp" } }) }).catch(function () {});
  }

  function setLoc(on) {
    set(LOC_KEY, on ? "1" : "0");
    if (code && !pending()) fetch(memberUrl(member()), { method: "PATCH", body: JSON.stringify({ loc: !!on }) }).catch(function () {});
    renderCard(); nativeSync();
  }
  // Vprašamo enkrat, ko je na seznamu še kdo drug; odgovor se da kadarkoli spremeniti s stikalom.
  function askLoc() {
    if (get(LOC_KEY) || !othersOk().length) return;
    setLoc(confirm("Naj ostali na skupnem seznamu dobijo obvestilo, ko si v trgovini? Vidijo samo ime trgovine, ne tvoje lokacije. Izklopiš lahko kadarkoli v Nastavitvah."));
  }

  // ---------- Člani: prošnje za pridružitev ----------
  function othersOk() {
    return Object.keys(members || {}).filter(function (id) { return id !== member() && members[id] && members[id].status !== "pending"; });
  }
  function requests() {
    return Object.keys(members || {}).filter(function (id) { return id !== member() && members[id] && members[id].status === "pending"; });
  }
  function accept(id) {
    fetch(memberUrl(id), { method: "PATCH", body: JSON.stringify({ status: "ok" }) }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      api.toast("Sprejeto. Seznam je zdaj skupen.");
      if (members && members[id]) members[id].status = "ok";
      renderCard(); askLoc();
    }).catch(function () { api.toast("Ni povezave. Poskusi znova."); });
  }
  function decline(id) {
    fetch(memberUrl(id), { method: "DELETE" }).then(function () {
      if (members) delete members[id];
      renderCard();
    }).catch(function () { api.toast("Ni povezave. Poskusi znova."); });
  }
  function onMembers() {
    var me = members[member()];
    if (pending()) {
      if (me && me.status === "ok") {
        set(STATUS_KEY, "ok");
        api.toast("Sprejet si. Seznam je zdaj skupen.");
        connect(); announce(); askLoc(); nativeSync();
      } else if (!me) {  // prošnja je bila zapisana, zdaj je ni: zavrnjena
        api.toast("Prošnja za pridružitev ni bila sprejeta.");
        reset();
      }
      renderCard();
      return;
    }
    if (!me) announce();
    else if (typeof me.loc !== "boolean" && get(LOC_KEY)) setLoc(locOn());  // stanje s telefona na strežnik
    renderCard();
    requests().forEach(function (id) {
      if (asked[id]) return;
      asked[id] = 1;
      if (!document.hidden && confirm((members[id].name || "Član") + " se želi pridružiti skupnemu seznamu. Sprejmeš?")) accept(id);
    });
    askLoc();
  }
  function watchMembers() {
    if (mes) { mes.close(); mes = null; }
    members = null;
    if (!code || !window.EventSource) return;
    mes = new EventSource(DB + "/h/" + code + "/members.json");
    function onData(kind) {
      return function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m) return;
        var parts = m.path.split("/").filter(Boolean);
        if (!parts.length) {
          if (kind === "put") members = m.data || {};
          else { members = members || {}; Object.keys(m.data || {}).forEach(function (id) { if (m.data[id] === null) delete members[id]; else members[id] = m.data[id]; }); }
        } else if (members) {
          var id = parts[0];
          if (parts.length === 1) { if (m.data === null) delete members[id]; else members[id] = m.data; }
          else if (kind === "put" && m.data === null) { if (members[id]) delete members[id][parts[1]]; }
          else { members[id] = members[id] || {}; if (parts.length === 2) members[id][parts[1]] = m.data; }
        }
        if (members) onMembers();
      };
    }
    mes.addEventListener("put", onData("put"));
    mes.addEventListener("patch", onData("patch"));
  }

  function reset() {
    disconnect();
    if (mes) { mes.close(); mes = null; }
    members = null; code = ""; dirty = {}; saveDirty();
    set(CODE_KEY, ""); set(STATUS_KEY, ""); set(LOC_KEY, "");
    renderCard(); nativeSync();
  }

  // Nov seznam: ustvarjalec je takoj član. Obstoječi seznam: prošnja, ki jo mora nekdo s seznama sprejeti.
  function join(c, creator) {
    c = cleanCode(c);
    if (c.length < 10) { api.toast("Koda ima 10 znakov."); return Promise.resolve(false); }
    if (!myName()) askName();
    var me = { name: myName() || "Član", lang: window.NK_LANG || "sl", status: creator ? "ok" : "pending", at: { ".sv": "timestamp" } };
    var check = creator ? Promise.resolve(true) : fetch(DB + "/h/" + c + "/members.json?shallow=true", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) { return !!(m && Object.keys(m).length); });
    return check.then(function (exists) {
      if (!exists) { api.toast("Seznama s to kodo ni."); return false; }
      return fetch(DB + "/h/" + c + "/members/" + member() + ".json", { method: "PATCH", body: JSON.stringify(me) }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        disconnect(); code = c; dirty = {}; saveDirty();
        set(CODE_KEY, code); set(STATUS_KEY, me.status); set(LOC_KEY, "");
        watchMembers();
        if (creator) { connect(); api.toast("Skupen seznam je ustvarjen."); }
        else api.toast("Prošnja poslana. Ko te sprejmejo, se seznam poveže.");
        renderCard(); nativeSync();
        return true;
      });
    }).catch(function () { api.toast("Ni povezave. Poskusi znova."); return false; });
  }
  function leave() {
    if (!confirm(pending() ? "Prekličeš prošnjo za pridružitev?" : "Prenehaš deliti seznam? Izdelki ostanejo na tem telefonu, ostali tvojih sprememb ne bodo več videli.")) return;
    // Odjava iz gospodinjstva: ostali ne dobijo več obvestil »… je v trgovini«.
    fetch(memberUrl(member()), { method: "DELETE" }).catch(function () {});
    var was = pending();
    reset();
    api.toast(was ? "Prošnja preklicana." : "Seznam ni več deljen.");
  }
  function share() {
    var link = "https://myedgeofficial.github.io/nakupko/?dom=" + code;
    var text = "Pridruži se mojemu seznamu v Nakupku. Koda: " + pretty(code) + "\n" + link;
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { api.toast("Koda kopirana."); });
  }

  // ---------- Nastavitve ----------
  function renderCard() {
    var box = $("hhBox");
    if (!box) return;
    box.innerHTML = "";
    function add(tag, attrs, text, parent) {
      var e = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text) e.textContent = text;
      (parent || box).appendChild(e);
      return e;
    }
    if (code && pending()) {
      var pc = add("p", { class: "hh-code" });
      pc.appendChild(document.createTextNode("Koda: "));
      var pb = document.createElement("b"); pb.textContent = pretty(code); pc.appendChild(pb);
      add("p", { class: "muted small" }, "Čakam, da te sprejme nekdo s tega seznama. Dobil je obvestilo.");
      var x = add("button", { class: "ghost full hh-leave", type: "button" }, "Prekliči prošnjo"); x.onclick = leave;
    } else if (code) {
      var p = add("p", { class: "hh-code" });
      p.appendChild(document.createTextNode("Koda: "));
      var b = document.createElement("b"); b.textContent = pretty(code); p.appendChild(b);
      add("p", { class: "muted small" }, online ? "Povezano kot " + (myName() || "Član") + ". Kar doda kdorkoli, vidijo vsi." : "Ni povezave. Spremembe se pošljejo, ko bo internet.");
      requests().forEach(function (id) {
        var q = add("div", { class: "hh-req" });
        add("p", {}, (members[id].name || "Član") + " se želi pridružiti skupnemu seznamu.", q);
        var qr = add("div", { class: "row" }, "", q);
        var ok = add("button", { class: "primary", type: "button" }, "Sprejmi", qr); ok.onclick = function () { accept(id); };
        var no = add("button", { class: "link", type: "button" }, "Zavrni", qr); no.onclick = function () { decline(id); };
      });
      var row = add("div", { class: "set-row hh-loc" });
      var t = add("div", { class: "set-text" }, "", row);
      add("b", {}, "Sporoči, ko sem v trgovini", t);
      add("span", { class: "muted small" }, "Ostali dobijo obvestilo z imenom trgovine. Tvoje lokacije ne vidi nihče.", t);
      var sw = add("button", { class: "switch", type: "button", role: "switch", "aria-checked": locOn() ? "true" : "false", "aria-label": "Sporoči, ko sem v trgovini" }, "", row);
      sw.onclick = function () { setLoc(!locOn()); };
      var s = add("button", { class: "primary full", type: "button" }, "Pošlji kodo"); s.onclick = share;
      var l = add("button", { class: "ghost full hh-leave", type: "button" }, "Prenehaj deliti seznam"); l.onclick = leave;
    } else {
      add("p", { class: "muted small" }, "Isti seznam na več telefonih, npr. s partnerjem. Kar doda eden, vidi drugi.");
      var c = add("button", { class: "primary full", type: "button" }, "Ustvari skupen seznam");
      c.onclick = function () { join(newCode(), true).then(function (ok) { if (ok) share(); }); };
      var r = add("div", { class: "row hh-join" });
      var i = document.createElement("input"); i.type = "text"; i.placeholder = "Vpiši kodo"; i.autocapitalize = "characters"; i.className = "full"; r.appendChild(i);
      var j = document.createElement("button"); j.className = "ghost"; j.type = "button"; j.textContent = "Pridruži se"; j.onclick = function () { join(i.value); }; r.appendChild(j);
    }
  }

  if (!DB) return;  // brez strežnika skupnega seznama ni
  var card = $("hhCard");
  if (card) card.classList.remove("hidden");
  window.__nakupkoAfterSave = afterSave;
  // Telefon (native.js): dokler prošnja ni sprejeta, seznama ni; obisk trgovine pošlje le, če je član to dovolil.
  window.__nakupkoHousehold = function () { return code && DB && !pending() ? { url: DB, code: code, member: member(), name: myName() || "Član", share: locOn() } : null; };
  renderCard();
  if (!pending()) { connect(); announce(); }
  watchMembers();
  window.addEventListener("online", flush);

  // Povezava ?dom=KODA iz sporočila.
  var m = /[?&]dom=([A-Za-z0-9-]+)/.exec(location.search);
  if (m) {
    history.replaceState(null, "", location.pathname);
    var c = cleanCode(m[1]);
    if (c !== code && confirm("Se pridružiš skupnemu seznamu " + pretty(c) + "?")) join(c);
  }
})();
