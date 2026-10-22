// Recepti v aplikaciji: vodeno izbiranje (čas → težavnost → mapa) ali iskanje,
// recept z izbiro števila oseb in količinami, ki gredo na seznam.
// Podatki so isti kot na nakupko.com (recepti.json, količine za 4 osebe).
(function () {
  "use strict";
  var REC = null, rt = null, rd = null, rm = null, cur = null, off = {};
  var SL = (window.NK_LANG || "sl") === "sl";
  var T = function (s) { return window.NK_T ? window.NK_T(s) : s; };
  var KEY = "nakupko-osebe";
  var servings = 4;
  try { servings = Math.min(20, Math.max(1, +localStorage.getItem(KEY) || 4)); } catch (e) { /* nič */ }
  var CASI = [["t20", 0, 20, "Do 20 minut", "Ko se mudi"], ["t45", 21, 45, "Do 45 minut", "Za vsak dan"],
    ["t90", 46, 90, "Do ure in pol", "Ko imaš malo več časa"], ["tvec", 91, 9999, "Več kot ura in pol", "Za vikend in praznike"]];
  var TEZ = [[1, "Enostavno", "Zmore vsak"], [2, "Srednje", "Nekaj izkušenj"], [3, "Zahtevno", "Za prave kuharje"]];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  function ico(k) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ((window.IKONE_JEDI || {})[k] || "") + "</svg>"; }
  function mins(m) { if (m < 60) return m + " min"; var h = Math.floor(m / 60), r = m % 60; return h + " h" + (r ? " " + r + " min" : ""); }
  function dots(n) { return '<span class="rdots">' + [1, 2, 3].map(function (i) { return '<i class="' + (i <= n ? "on" : "") + '"></i>'; }).join("") + "</span>"; }
  function nm(r) { return SL ? r[1] : r[2]; }
  function mapName(m) { return SL ? m[1] : m[2]; }
  function casOf(r) { return CASI.filter(function (c) { return r[3] >= c[1] && r[3] <= c[2]; })[0][0]; }
  function pool(t, d, m) {
    return REC.jedi.map(function (r, i) { return i; }).filter(function (i) {
      var r = REC.jedi[i];
      return (!t || t === "vse" || casOf(r) === t) && (!d || d === "vse" || r[4] === d) && (!m || r[5] === m);
    });
  }
  function jedi(n) { return n + " " + T(n === 1 ? "jed" : "jedi"); }
  function items() { var a = window.__nakupko; return a && a.state ? (a.state().items || []) : []; }
  function cards(ids) {
    var open = {}; items().forEach(function (y) { if (!y.done) open[norm(y.name)] = 1; });
    return '<div class="rgrid">' + ids.map(function (i) {
      var r = REC.jedi[i], has = r[6].every(function (x) { return open[norm(x[0])]; });
      return '<button type="button" class="rc' + (has ? " added" : "") + '" data-i="' + i + '"><span class="ric">' + ico(r[0]) + '</span><span class="rtx"><b>' + esc(nm(r)) + '</b><span class="rmeta">' + mins(r[3]) + dots(r[4]) + "</span></span></button>";
    }).join("") + "</div>";
  }
  function step(k, h, body, skip) {
    return '<div class="rstep"><span class="rk">' + esc(T(k)) + "</span><h2>" + esc(h) + "</h2>" + body + (skip ? '<button type="button" class="rskip" data-skip="1">' + esc(T(skip)) + "</button>" : "") + "</div>";
  }
  function draw() {
    var box = $("rflow"); if (!box) return;
    if (!REC) { box.innerHTML = '<p class="empty">' + esc(T("Nalagam recepte …")) + "</p>"; return; }
    var q = norm($("rq").value), words = q.split(" ").filter(Boolean), h = "";
    if (words.length) {
      var mapa = {}; REC.mape.forEach(function (m) { mapa[m[0]] = m; });
      var res = REC.jedi.map(function (r, i) { return i; }).filter(function (i) {
        var r = REC.jedi[i];
        var hay = r.hay || (r.hay = norm([r[1], r[2], mapa[r[5]][1], mapa[r[5]][2]].concat(r[6].map(function (x) { return x[0] + " " + T(x[0]); })).join(" ")));
        return words.every(function (w) { return hay.indexOf(w.length >= 6 ? w.slice(0, -2) : w) >= 0; });
      });
      box.innerHTML = step("Iskanje", jedi(res.length), res.length ? cards(res) : '<p class="empty">' + esc(T("Ni zadetkov. Poskusi z drugo besedo.")) + "</p>");
      return;
    }
    var cr = [];
    if (rt) cr.push(["t", rt === "vse" ? T("Ves čas") : T(CASI.filter(function (c) { return c[0] === rt; })[0][3])]);
    if (rd) cr.push(["d", rd === "vse" ? T("Vsa zahtevnost") : T(TEZ[rd - 1][1])]);
    if (rm) cr.push(["m", mapName(REC.mape.filter(function (m) { return m[0] === rm; })[0])]);
    if (cr.length) h += '<div class="rcrumbs">' + cr.map(function (c) { return '<button type="button" data-back="' + c[0] + '">' + esc(c[1]) + " ×</button>"; }).join("") + "</div>";
    if (!rt) {
      h += step("Korak 1 od 3", T("Koliko časa imaš?"), '<div class="ropts">' + CASI.map(function (c) {
        return '<button type="button" class="ropt" data-t="' + c[0] + '"><b>' + esc(T(c[3])) + "</b><span>" + esc(T(c[4])) + "</span><small>" + jedi(pool(c[0]).length) + "</small></button>";
      }).join("") + "</div>", "Vseeno mi je, pokaži vse");
    } else if (!rd) {
      h += step("Korak 2 od 3", T("Kako zahtevno naj bo?"), '<div class="ropts">' + TEZ.map(function (t) {
        var n = pool(rt, t[0]).length; if (!n) return "";
        return '<button type="button" class="ropt" data-d="' + t[0] + '">' + dots(t[0]) + "<b>" + esc(T(t[1])) + "</b><span>" + esc(T(t[2])) + "</span><small>" + jedi(n) + "</small></button>";
      }).join("") + "</div>", "Vseeno, pokaži vse");
    } else if (!rm) {
      h += step("Korak 3 od 3", T("Na kaj imaš danes apetit?"), '<div class="rfold">' + REC.mape.map(function (m) {
        var ids = pool(rt, rd, m[0]); if (!ids.length) return "";
        var seen = {}, ics = ids.map(function (i) { return REC.jedi[i][0]; }).filter(function (x) { return seen[x] ? false : (seen[x] = 1); }).slice(0, 3);
        return '<button type="button" class="rf" data-m="' + m[0] + '"><span class="rfi">' + ics.map(ico).join("") + "</span><b>" + esc(mapName(m)) + "</b><span>" + jedi(ids.length) + "</span></button>";
      }).join("") + "</div>");
    } else {
      h += step("Izberi jed", mapName(REC.mape.filter(function (m) { return m[0] === rm; })[0]), cards(pool(rt, rd, rm)));
    }
    box.innerHTML = h;
  }

  // ---------- recept: število oseb in sestavine ----------
  function scaleAmt(a, u, f) {
    if (!a) return null; var v = a * f;
    if (u === "kg") { v *= 1000; u = "g"; } if (u === "l") { v *= 1000; u = "ml"; }
    if (u === "g" || u === "ml") v = v < 100 ? Math.ceil(v / 5) * 5 : Math.ceil(v / 10) * 10;
    else v = Math.max(1, Math.ceil(v * 2 - 0.25) / 2);
    return [v, u];
  }
  function amtOf(g) { var a = scaleAmt(g[1], g[2], servings / 4), m = null; if (a) { m = {}; m[a[1]] = a[0]; } return m; }
  function osebe(n) { return SL ? n + (n === 1 ? " osebo" : n === 2 ? " osebi" : n < 5 ? " osebe" : " oseb") : n + (n === 1 ? " person" : " people"); }
  function drawSheet() {
    var r = cur, api = window.__nakupko, sh = $("rsheet"); if (!sh || !r) return;
    sh.querySelector(".rsh-ic").innerHTML = ico(r[0]);
    sh.querySelector(".rsh-t").textContent = nm(r);
    sh.querySelector(".rsh-m").textContent = mins(r[3]) + " · " + T(TEZ[r[4] - 1][1]);
    sh.querySelector(".rsh-n").textContent = servings;
    sh.querySelector(".rsh-list").innerHTML = r[6].map(function (g, i) {
      var a = amtOf(g), txt = a && api && api.amtText ? api.amtText(a) : T("po okusu");
      return '<button type="button" class="rsh-i' + (off[i] ? "" : " on") + '" data-i="' + i + '"><span class="rcb"></span><span class="rnm">' + esc(T(g[0])) + '</span><span class="ram">' + esc(txt) + "</span></button>";
    }).join("");
    var n = r[6].filter(function (g, i) { return !off[i]; }).length, b = sh.querySelector(".rsh-add");
    b.textContent = T("Dodaj na seznam") + " (" + n + ")"; b.disabled = !n;
  }
  function openRecipe(i) {
    cur = REC.jedi[i]; off = {};
    var w = document.createElement("div");
    w.className = "sheet-wrap"; w.id = "rsheetWrap";
    w.innerHTML = '<div class="sheet rsheet" id="rsheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>' +
      '<div class="rsh-head"><span class="rsh-ic"></span><div><b class="rsh-t"></b><span class="rsh-m"></span></div></div>' +
      '<div class="rsh-serv"><span>' + esc(T("Za koliko oseb?")) + '</span><span class="rsh-step"><button type="button" class="rsh-minus" aria-label="−">−</button><b class="rsh-n"></b><button type="button" class="rsh-plus" aria-label="+">+</button></span></div>' +
      '<div class="rsh-list"></div><p class="muted small">' + esc(T("Odkljukaj, kar že imaš doma.")) + '</p>' +
      '<button type="button" class="btn primary full rsh-add"></button></div>';
    document.body.appendChild(w);
    w.addEventListener("click", function (e) {
      if (e.target === w) { close(); return; }
      var b = e.target.closest && e.target.closest("button"); if (!b) return;
      if (b.classList.contains("rsh-minus")) servings = Math.max(1, servings - 1);
      else if (b.classList.contains("rsh-plus")) servings = Math.min(20, servings + 1);
      else if (b.dataset.i) off[+b.dataset.i] = !off[+b.dataset.i];
      else if (b.classList.contains("rsh-add")) { addAll(); return; }
      try { localStorage.setItem(KEY, servings); } catch (err) { /* nič */ }
      drawSheet();
    });
    drawSheet();
  }
  function close() { var w = $("rsheetWrap"); if (w) w.remove(); }
  function addAll() {
    var api = window.__nakupko, n = 0; if (!api) return;
    cur[6].forEach(function (g, i) { if (off[i]) return; api.add(g[0], amtOf(g)); n++; });
    close(); draw();
    if (api.toast) api.toast(SL ? "Na seznam dodano: " + n + " sestavin za " + osebe(servings) : T("Dodano na seznam") + ": " + n + " · " + osebe(servings));
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#rflow button"); if (!b) return;
    if (b.dataset.i) { openRecipe(+b.dataset.i); return; }
    if (b.dataset.t) rt = b.dataset.t; else if (b.dataset.d) rd = +b.dataset.d; else if (b.dataset.m) rm = b.dataset.m;
    else if (b.dataset.skip) { if (!rt) rt = "vse"; else rd = "vse"; }
    else if (b.dataset.back) { var k = b.dataset.back; if (k === "t") { rt = rd = rm = null; } else if (k === "d") { rd = rm = null; } else rm = null; }
    draw();
    var p = $("paneRecipes"); if (p && p.getBoundingClientRect().top < 0) p.scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "rq") draw(); });

  window.NK_RECEPTI = {
    show: function () {
      if (REC) { draw(); return; }
      draw();
      fetch("recepti.json").then(function (r) { return r.json(); }).then(function (d) { REC = d; draw(); }).catch(function () { /* brez povezave: ostane obvestilo */ });
    }
  };
})();
