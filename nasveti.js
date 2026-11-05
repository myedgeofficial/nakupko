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
    // V zavihku samo 6 najnovejših; starejši gredo sproti v Revijo (listaš jo kot katalog).
    var rest = list().slice(NOVI);
    box.innerHTML = list().slice(0, NOVI).map(function (a, i) {
      return '<button type="button" class="nasvet-card' + (i === 0 ? " prvi" : "") + '" data-clanek="' + esc(a.id) + '">' +
        '<span class="nasvet-k">' + esc(datum(a.datum)) + (read[a.id] ? "" : ' <i class="nasvet-nov">nov</i>') + "</span>" +
        "<b>" + esc(a.naslov) + '</b><span class="nasvet-o">' + esc(a.opis) + "</span></button>";
    }).join("") + (rest.length ? '<button type="button" class="revija-teaser" data-revija="0">' +
      '<span class="rt-book" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="rt-txt"><span class="rt-k">Revija Nakupko</span><b>Listaj kot katalog ›</b>' +
      '<span class="rt-o"><b>' + rest.length + "</b> <span>starejših člankov</span></span></span></button>" : "");
  }

  // ---------- Revija: starejši članki, listaš jih kot tedenski katalog ----------
  var NOVI = 6;
  function revija(start) {
    var rest = list().slice(NOVI); if (!rest.length) return;
    var old = $("revija"); if (old) old.remove();
    var w = document.createElement("div");
    w.id = "revija"; w.className = "revija"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    var pages = ['<section class="rv-page rv-cover"><div class="rv-in"><p class="rv-k">Revija Nakupko</p>' +
      "<h2>Vsi starejši nasveti na enem mestu.</h2><p class=\"rv-hint\">Listaj levo in desno, kot katalog.</p>" +
      '<p class="rv-k rv-toc-k">Kazalo</p><ol class="rv-toc">' + rest.map(function (a, i) {
        return '<li><button type="button" data-rv="' + (i + 1) + '"><span>' + (i + 2) + "</span>" + esc(a.naslov) + "</button></li>";
      }).join("") + "</ol></div></section>"].concat(rest.map(function (a, i) {
        return '<section class="rv-page" style="--c:' + BARVE[i % BARVE.length] + '"><div class="rv-in">' +
          '<p class="rv-k">' + esc(datum(a.datum)) + "</p><h2>" + esc(a.naslov) + '</h2><p class="rv-o">' + esc(a.opis) + "</p>" +
          '<button type="button" class="rv-beri" data-clanek="' + esc(a.id) + '">Beri članek ›</button>' +
          '<span class="rv-st">' + (i + 2) + "</span></div></section>";
      }));
    w.innerHTML = '<div class="rv-top"><b class="rv-t">📖 <span>Revija Nakupko</span></b><span class="rv-n"></span>' +
      '<button type="button" class="rv-x" aria-label="Zapri"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="rv-pages">' + pages.join("") + "</div>" +
      '<div class="rv-nav"><button type="button" class="rv-prev" aria-label="Nazaj">‹</button><button type="button" class="rv-next" aria-label="Naprej">›</button></div>';
    document.body.appendChild(w);
    document.body.style.overflow = "hidden";
    var box = w.querySelector(".rv-pages"), all = w.querySelectorAll(".rv-page"), n = w.querySelector(".rv-n");
    function go(i) { box.scrollTo({ left: Math.max(0, Math.min(all.length - 1, i)) * box.clientWidth, behavior: "smooth" }); }
    // listanje: stran se ob robu nagne kot list v katalogu
    function tilt() {
      var x = box.scrollLeft / Math.max(1, box.clientWidth);
      [].forEach.call(all, function (p, i) {
        var d = Math.max(-1, Math.min(1, i - x));
        p.firstChild.style.transform = "perspective(1400px) rotateY(" + (-d * 32).toFixed(1) + "deg) scale(" + (1 - Math.abs(d) * 0.07).toFixed(3) + ")";
        p.firstChild.style.transformOrigin = d > 0 ? "left center" : "right center";
      });
      n.textContent = (Math.round(x) + 1) + " / " + all.length;
    }
    box.addEventListener("scroll", function () { requestAnimationFrame(tilt); }, { passive: true });
    w.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      if (t.closest(".rv-x")) { w.remove(); document.body.style.overflow = ""; return; }
      if (t.closest(".rv-prev")) return go(Math.round(box.scrollLeft / box.clientWidth) - 1);
      if (t.closest(".rv-next")) return go(Math.round(box.scrollLeft / box.clientWidth) + 1);
      var j = t.closest("[data-rv]"); if (j) return go(+j.dataset.rv);
      var b = t.closest("[data-clanek]"); if (b) open(b.dataset.clanek);
    });
    requestAnimationFrame(function () { box.scrollLeft = (start || 0) * box.clientWidth; tilt(); });
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
  // vsak razdelek (od h2 do naslednjega h2) dobi svojo barvo: naslov, krepke besede, številke in oznake
  var BARVE = ["#7C3AED", "#2563EB", "#DB2777", "#0D9488", "#EA580C"];
  function pobarvaj(root) {
    var k = -1;
    [].forEach.call(root.children, function (el) {
      if (el.tagName === "H2") k++;
      if (k >= 0) el.style.setProperty("--c", BARVE[k % BARVE.length]);
    });
  }
  function poudari(root) {
    if (!root) return;
    pobarvaj(root);
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
    var r = e.target.closest && e.target.closest("#nasvetiList [data-revija]");
    if (r) revija(+r.dataset.revija);
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
