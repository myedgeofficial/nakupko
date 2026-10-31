// Nasveti o hrani in nakupovanju (zavihek Recepti, zgoraj).
// Članki so na nakupko.com (vodnik); aplikacija ob odprtju prenese data/clanki.json, zato nov članek
// ne potrebuje posodobitve v trgovini. Zadnji prenos je shranjen v napravi (deluje tudi brez povezave).
// Članki so v slovenščini, zato jih kažemo samo v slovenskem jeziku.
(function () {
  "use strict";
  if ((window.NK_LANG || "sl") !== "sl") return;
  var URL = "https://nakupko.com/data/clanki.json", KEY = "nakupko-clanki", RKEY = "nakupko-clanki-prebrano";
  var data = null, read = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { /* nič */ }
  try { read = JSON.parse(localStorage.getItem(RKEY) || "{}") || {}; } catch (e) { /* nič */ }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function list() { return data && data.clanki ? data.clanki : []; }
  function datum(d) { var p = String(d || "").split("-"); return p.length === 3 ? +p[2] + ". " + +p[1] + ". " + p[0] : ""; }

  function card() {
    var box = $("nasvet"); if (!box) return;
    var a = list()[0];
    box.classList.toggle("hidden", !a);
    if (!a) return;
    var novo = !read[a.id];
    box.innerHTML = '<button type="button" class="nasvet-card" data-clanek="' + esc(a.id) + '">' +
      '<span class="nasvet-k">' + (novo ? "Nov nasvet" : "Nasvet") + '</span><b>' + esc(a.naslov) + '</b><span class="nasvet-o">' + esc(a.opis) + "</span></button>" +
      (list().length > 1 ? '<button type="button" class="nasvet-vsi" data-vsi="1">Vsi nasveti (' + list().length + ") ›</button>" : "");
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
        var h = l.getAttribute("href"), m = h.match(/\/vodnik\/([a-z0-9-]+)\.html/);
        e.preventDefault();
        if (m && byId(m[1])) open(m[1]); else window.open(/^https?:/.test(h) ? h : "https://nakupko.com" + h, "_blank");
      }
    });
  }
  function byId(id) { return list().filter(function (a) { return a.id === id; })[0]; }
  function open(id) {
    var a = byId(id); if (!a) return;
    read[a.id] = 1; try { localStorage.setItem(RKEY, JSON.stringify(read)); } catch (e) { /* nič */ }
    // vsebina prihaja z naše strani nakupko.com (tools/generiraj.py), ne od uporabnikov
    sheet('<article class="clanek"><p class="clanek-d">' + esc(datum(a.datum)) + "</p><h1>" + esc(a.naslov) + "</h1>" + a.html + "</article>" +
      '<button type="button" class="btn full" data-vsi="1">Vsi nasveti ›</button>');
    card();
  }
  function all() {
    sheet("<h1>Nasveti</h1>" + list().map(function (a) {
      return '<button type="button" class="nasvet-li" data-clanek="' + esc(a.id) + '"><b>' + esc(a.naslov) + (read[a.id] ? "" : ' <i class="nasvet-nov">nov</i>') + "</b><span>" + esc(a.opis) + "</span></button>";
    }).join(""));
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-clanek], [data-vsi]");
    if (!b || !(b.closest("#nasvet") || b.closest("#nasvetWrap"))) return;
    if (b.dataset.clanek) open(b.dataset.clanek); else all();
  });
  function refresh() {
    fetch(URL, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.clanki) return;
      data = d; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* nič */ }
      card();
    }).catch(function () { /* brez povezave: ostane zadnji prenos */ });
  }
  card();
  refresh();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
