// Nasveti o hrani in nakupovanju (spodnji zavihek »Nasveti«).
// Članki so na nakupko.com (vodnik); aplikacija ob odprtju prenese data/clanki.json, zato nov članek
// ne potrebuje posodobitve v trgovini. Zadnji prenos je shranjen v napravi (deluje tudi brez povezave).
// Članki so v slovenščini, zato jih kažemo samo v slovenskem jeziku.
(function () {
  "use strict";
  var LANG = window.NK_LANG || "sl", SL = LANG === "sl";
  var BASE = "https://nakupko.com/data/clanki", URL = BASE + (SL ? "" : "-" + LANG) + ".json";
  var KEY = "nakupko-clanki" + (SL ? "" : "-" + LANG), RKEY = "nakupko-clanki-prebrano";
  var data = null, read = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { /* nič */ }
  try { read = JSON.parse(localStorage.getItem(RKEY) || "{}") || {}; } catch (e) { /* nič */ }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function list() { return data && data.clanki ? data.clanki : []; }
  function datum(d) { var p = String(d || "").split("-"); return p.length === 3 ? +p[2] + ". " + +p[1] + ". " + p[0] : ""; }

  // seznam v zavihku + pika na zavihku, ko je nov neprebran članek
  function card() {
    var dot = $("nasvetiDot"), box = $("nasvetiList");
    var a = list()[0];
    if (dot) dot.classList.toggle("hidden", !a || !!read[a.id]);
    if (!box) return;
    if (!list().length) { box.innerHTML = '<p class="muted">Nalagam nasvete …</p>'; return; }
    box.innerHTML = list().map(function (a, i) {
      return '<button type="button" class="nasvet-card' + (i === 0 ? " prvi" : "") + '" data-clanek="' + esc(a.id) + '">' +
        '<span class="nasvet-k">' + esc(datum(a.datum)) + (read[a.id] ? "" : ' <i class="nasvet-nov">nov</i>') + "</span>" +
        "<b>" + esc(a.naslov) + '</b><span class="nasvet-o">' + esc(a.opis) + "</span></button>";
    }).join("");
  }
  function sheet(inner) {
    var old = $("nasvetWrap"); if (old) old.remove();
    var w = document.createElement("div");
    w.className = "sheet-wrap"; w.id = "nasvetWrap";
    w.innerHTML = '<div class="sheet nasvet-sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>' +
      '<button type="button" class="sheet-x" aria-label="Zapri"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' + inner + "</div>";
    document.body.appendChild(w);
    w.addEventListener("click", function (e) {
      if (e.target === w || (e.target.closest && e.target.closest(".sheet-x"))) { w.remove(); return; }
      var l = e.target.closest && e.target.closest("a[href]");
      if (l) { // povezave na druge članke odpremo v aplikaciji, ostale v brskalniku
        var h = l.getAttribute("href"), m = h.match(/\/vodnik\/([a-z0-9-]+)\.html/), r = h.match(/\/recept\/([a-z0-9-]+)\.html/);
        var web = function () { window.open(/^https?:/.test(h) ? h : "https://nakupko.com" + h, "_blank"); };
        e.preventDefault();
        if (m && byId(m[1])) open(m[1]);
        else if (r && window.NK_RECEPTI && window.NK_RECEPTI.openSlug) { // recept odpremo kar v aplikaciji (doda sestavine na seznam)
          window.NK_RECEPTI.openSlug(r[1], function (ok) { if (ok) w.remove(); else web(); });
        } else web();
      }
    });
  }
  // številke z enoto (5 g, 2,5, 100 g, 30 %) izstopajo, da oko hitro najde bistvo
  var NUM = /(\d+(?:[.,]\d+)?\s?(?:%|g|kg|mg|ml|dl|l|kcal|€|minut|min)(?![\wčšžćđ])|\d+,\d+)/g;
  function poudari(root) {
    if (!root) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = tw.nextNode())) if ((NUM.lastIndex = 0, NUM.test(n.nodeValue)) && !n.parentNode.closest("a,h1,h2,h3,.clanek-d,.hl")) nodes.push(n);
    nodes.forEach(function (t) {
      var f = document.createDocumentFragment(), parts = t.nodeValue.split(NUM);
      parts.forEach(function (s, i) {
        if (!s) return;
        if (i % 2) { var m = document.createElement("span"); m.className = "hl"; m.textContent = s; f.appendChild(m); }
        else f.appendChild(document.createTextNode(s));
      });
      t.parentNode.replaceChild(f, t);
    });
  }
  function byId(id) { return list().filter(function (a) { return a.id === id; })[0]; }
  function open(id) {
    var a = byId(id); if (!a) return;
    read[a.id] = 1; try { localStorage.setItem(RKEY, JSON.stringify(read)); } catch (e) { /* nič */ }
    // vsebina prihaja z naše strani nakupko.com (tools/generiraj.py), ne od uporabnikov
    sheet('<article class="clanek"><p class="clanek-d">' + esc(datum(a.datum)) + "</p><h1>" + esc(a.naslov) + "</h1>" + a.html + "</article>");
    poudari(document.querySelector("#nasvetWrap .clanek"));
    card();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#nasvetiList [data-clanek]");
    if (b) open(b.dataset.clanek);
  });
  function refresh() {
    fetch(URL, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      // jezik brez prevodov: angleščina
      if ((!d || !d.clanki || !d.clanki.length) && LANG !== "en" && !SL) return fetch(BASE + "-en.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; });
      return d;
    }).then(function (d) {
      if (!d || !d.clanki) return;
      data = d; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* nič */ }
      card();
    }).catch(function () { /* brez povezave: ostane zadnji prenos */ });
  }
  window.NK_NASVETI = { show: function () { card(); refresh(); } };
  card();
  refresh();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
