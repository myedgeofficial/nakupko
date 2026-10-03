// Skupen seznam za gospodinjstvo: isti seznam na več telefonih prek kode.
// Seznam hrani Firebase Realtime Database (REST + EventSource, brez knjižnic).
(function () {
  "use strict";
  var DB = window.NAKUPKO_SYNC_URL || "https://nakupko-8ad19-default-rtdb.europe-west1.firebasedatabase.app";
  var CODE_KEY = "nakupko-household", DIRTY_KEY = "nakupko-household-dirty";
  var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var api = window.__nakupko;
  if (!api || !api.setItems) return;

  var code = "", shared = null, dirty = {}, es = null, online = false, retry = null;
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

  function join(c) {
    c = cleanCode(c);
    if (c.length < 10) { api.toast("Koda ima 10 znakov."); return; }
    code = c; dirty = {}; saveDirty();
    try { localStorage.setItem(CODE_KEY, code); } catch (e) { /* nič */ }
    connect(); renderCard();
    api.toast("Povezano s skupnim seznamom.");
  }
  function leave() {
    if (!confirm("Zapustiš skupen seznam? Izdelki ostanejo na tem telefonu.")) return;
    disconnect(); code = ""; dirty = {}; saveDirty();
    try { localStorage.removeItem(CODE_KEY); } catch (e) { /* nič */ }
    renderCard();
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
    function add(tag, attrs, text) {
      var e = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text) e.textContent = text;
      box.appendChild(e);
      return e;
    }
    if (code) {
      var p = add("p", { class: "hh-code" });
      p.appendChild(document.createTextNode("Koda: "));
      var b = document.createElement("b"); b.textContent = pretty(code); p.appendChild(b);
      add("p", { class: "muted small" }, online ? "Povezano. Kar doda kdorkoli, vidita oba." : "Ni povezave. Spremembe se pošljejo, ko bo internet.");
      var row = add("div", { class: "row" });
      var s = document.createElement("button"); s.className = "primary"; s.type = "button"; s.textContent = "Pošlji kodo"; s.onclick = share; row.appendChild(s);
      var l = document.createElement("button"); l.className = "link"; l.type = "button"; l.textContent = "Zapusti"; l.onclick = leave; row.appendChild(l);
    } else {
      add("p", { class: "muted small" }, "Isti seznam na več telefonih, npr. s partnerjem. Kar doda eden, vidi drugi.");
      var c = add("button", { class: "primary full", type: "button" }, "Ustvari skupen seznam");
      c.onclick = function () { join(newCode()); share(); };
      var r = add("div", { class: "row hh-join" });
      var i = document.createElement("input"); i.type = "text"; i.placeholder = "Vpiši kodo"; i.autocapitalize = "characters"; i.className = "full"; r.appendChild(i);
      var j = document.createElement("button"); j.className = "ghost"; j.type = "button"; j.textContent = "Pridruži se"; j.onclick = function () { join(i.value); }; r.appendChild(j);
    }
  }

  if (!DB) return;  // brez strežnika skupnega seznama ni
  var card = $("hhCard");
  if (card) card.classList.remove("hidden");
  window.__nakupkoAfterSave = afterSave;
  window.__nakupkoHousehold = function () { return code && DB ? { url: DB, code: code } : null; };
  renderCard();
  connect();
  window.addEventListener("online", flush);

  // Povezava ?dom=KODA iz sporočila.
  var m = /[?&]dom=([A-Za-z0-9-]+)/.exec(location.search);
  if (m) {
    history.replaceState(null, "", location.pathname);
    var c = cleanCode(m[1]);
    if (c !== code && confirm("Se pridružiš skupnemu seznamu " + pretty(c) + "?")) join(c);
  }
})();
