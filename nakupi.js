// Moji nakupi (Nastavitve › Moji nakupi): pregled odkljukanih izdelkov po obdobju, skupinah in dnevih.
// Bere state.history iz app.js (zapis ob vsakem odkljukanem izdelku). Brez cen, podatki ostanejo v telefonu.
// Besedila so slovenska; i18n.js jih prevede (ključi v i18n/xx.js), zato so števila v svojih elementih.
(function () {
  "use strict";
  var LANG = window.NK_LANG || "sl", DAN = 24 * 3600 * 1000;
  var obdobje = "30", dni = 14;
  // barve skupin (kot ikone kategorij), ostalo sivo
  var BARVE = { "Sadje in zelenjava": "#7C5CFA", "Kruh in pecivo": "#4F8EF7", "Mlečni izdelki": "#3BB8C3", "Meso in ribe": "#E9A04A",
    "Shramba": "#B57EDC", "Prigrizki": "#E57FAA", "Pijače": "#8FA3B8", "Zamrznjeno": "#6FB1E8", "Gospodinjstvo": "#9BB55A", "Higiena": "#A79BE0" };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api() { return window.__nakupko; }
  function zapisi() {
    var a = api(), h = a && a.state ? a.state().history || [] : [];
    var od = obdobje === "30" ? Date.now() - 30 * DAN : obdobje === "leto" ? new Date(new Date().getFullYear(), 0, 1).getTime() : 0;
    return h.filter(function (x) { return x && x.ts >= od; });
  }
  function vsi() { var a = api(); return a && a.state ? a.state().history || [] : []; }
  function kratko(d, o) { try { return d.toLocaleDateString(LANG, o); } catch (e) { return d.getDate() + "." + (d.getMonth() + 1) + "."; } }
  // stolpčni graf: [[oznaka, vrednost]], najvišji stolpec poudarjen; števila so v svojih elementih
  function stolpci(v, cls) {
    var max = Math.max.apply(null, v.map(function (x) { return x[1]; }).concat([1]));
    return '<div class="nk-graf' + (cls ? " " + cls : "") + '">' + v.map(function (x) {
      return '<div class="nk-st' + (x[1] === max && x[1] > 0 ? " naj" : "") + '"><span class="nk-st-n">' + (x[1] || "") + "</span>" +
        '<i style="height:' + Math.max(3, Math.round(100 * x[1] / max)) + '%"></i><span class="nk-st-o">' + esc(x[0]) + "</span></div>";
    }).join("") + "</div>";
  }
  function catOf(n) { var a = api(); return (a && a.catOf && a.catOf(n)) || "Drugo"; }
  function datum(ts) {
    try { return new Date(ts).toLocaleDateString(LANG, { weekday: "long", day: "numeric", month: "long" }); }
    catch (e) { var d = new Date(ts); return d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear(); }
  }

  function vsebina() {
    var z = zapisi();
    var seg = '<div class="nk-seg">' + [["30", "30 dni"], ["leto", "Letos"], ["vse", "Vse"]].map(function (o) {
      return '<button type="button" data-ob="' + o[0] + '" class="' + (obdobje === o[0] ? "on" : "") + '">' + o[1] + "</button>";
    }).join("") + "</div>";
    if (!z.length) return seg + '<p class="muted nk-prazno">Ko v trgovini odkljukaš izdelke, jih vidiš tukaj.</p>';

    // zgodovina po nakupih, najnovejši prvi: ista trgovina in manj kot 3 ure razmika = en nakup (tudi čez polnoč)
    var po = [];
    z.slice().sort(function (a, b) { return b.ts - a.ts; }).forEach(function (x) {
      var g = po[po.length - 1];
      if (g && g.s === (x.storeName || "") && g.od - x.ts < 3 * 3600 * 1000) { g.l.push(x); g.od = x.ts; }
      else po.push({ s: x.storeName || "", ts: x.ts, od: x.ts, l: [x] });
    });
    // povzetek: izdelki, nakupi, trgovine
    var trg = {};
    z.forEach(function (x) { if (x.storeName) trg[x.storeName] = (trg[x.storeName] || 0) + 1; });
    var naj = Object.keys(trg).sort(function (a, b) { return trg[b] - trg[a]; })[0];
    var h = seg + '<div class="nk-tiles">' +
      '<div><b>' + z.length + "</b><span>Izdelkov</span></div>" +
      '<div><b>' + po.length + "</b><span>Nakupov</span></div>" +
      '<div><b>' + Object.keys(trg).length + "</b><span>Trgovin</span></div></div>" +
      (naj ? '<p class="nk-naj"><span>Največkrat v trgovini</span> <b>' + esc(naj) + "</b></p>" : "");

    // 1) skozi čas: 30 dni po tednih, sicer po mesecih
    var cas = [], zdaj = new Date();
    if (obdobje === "30") {
      // 4 tedni, najstarejši zajame še 2 dneva do 30
      for (var t = 3; t >= 0; t--) {
        var od = t === 3 ? Date.now() - 30 * DAN : Date.now() - (t + 1) * 7 * DAN, do_ = Date.now() - t * 7 * DAN;
        cas.push([kratko(new Date(od + DAN), { day: "numeric", month: "numeric" }), z.filter(function (x) { return x.ts > od && x.ts <= do_; }).length]);
      }
    } else {
      var prvi = obdobje === "leto" ? new Date(zdaj.getFullYear(), 0, 1) : new Date(Math.min.apply(null, z.map(function (x) { return x.ts; })));
      var m = new Date(prvi.getFullYear(), prvi.getMonth(), 1);
      while (m <= zdaj) {
        var n = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        cas.push([kratko(m, { month: "short" }), z.filter(function (x) { return x.ts >= m.getTime() && x.ts < n.getTime(); }).length]);
        m = n;
      }
      cas = cas.slice(-12);
    }
    h += '<h2 class="nk-h">Skozi čas</h2><div class="nk-card"><p class="nk-pod">' + (obdobje === "30" ? "Izdelkov na teden" : "Izdelkov na mesec") + "</p>" + stolpci(cas) + "</div>";

    // po skupinah
    var sk = {};
    z.forEach(function (x) { var c = catOf(x.name); sk[c] = (sk[c] || 0) + 1; });
    var vrste = Object.keys(sk).sort(function (a, b) { return sk[b] - sk[a]; });
    h += '<h2 class="nk-h">Po skupinah</h2><div class="nk-card"><div class="nk-bar">' + vrste.map(function (c) {
      return '<i style="flex:' + sk[c] + ";background:" + (BARVE[c] || "#C9C3D9") + '"></i>';
    }).join("") + "</div>" + vrste.map(function (c) {
      return '<div class="nk-row"><i style="background:' + (BARVE[c] || "#C9C3D9") + '"></i><span class="nk-ime">' + esc(c) + "</span>" +
        '<span class="nk-n">' + sk[c] + '</span><b class="nk-p">' + (Math.round(100 * sk[c] / z.length) || "<1") + " %</b></div>";
    }).join("") + "</div>";

    // 2) primerjava s prejšnjim obdobjem (30 dni prej oz. lani do istega dne)
    if (obdobje !== "vse") {
      var pOd, pDo;
      if (obdobje === "30") { pOd = Date.now() - 60 * DAN; pDo = Date.now() - 30 * DAN; }
      else { pOd = new Date(zdaj.getFullYear() - 1, 0, 1).getTime(); pDo = new Date(zdaj.getFullYear() - 1, zdaj.getMonth(), zdaj.getDate() + 1).getTime(); }
      var prej = vsi().filter(function (x) { return x && x.ts >= pOd && x.ts < pDo; });
      if (prej.length) {
        var ps = {};
        prej.forEach(function (x) { var c = catOf(x.name); ps[c] = (ps[c] || 0) + 1; });
        var raz = Object.keys(sk).concat(Object.keys(ps).filter(function (c) { return !sk[c]; })).map(function (c) { return [c, (sk[c] || 0) - (ps[c] || 0)]; })
          .filter(function (x) { return Math.abs(x[1]) >= 2; }).sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); }).slice(0, 4);
        h += '<div class="nk-card"><p class="nk-pod">' + (obdobje === "30" ? "V primerjavi s prejšnjimi 30 dnevi" : "V primerjavi z lanskim letom do danes") + "</p>" +
          '<div class="nk-chips nk-raz">' + (raz.length ? raz.map(function (x) {
            return '<span><span>' + esc(x[0]) + '</span> <b class="' + (x[1] > 0 ? "gor" : "dol") + '">' + (x[1] > 0 ? "+" : "−") + Math.abs(x[1]) + "</b></span>";
          }).join("") : "<span>Približno enako kot prej</span>") + "</div></div>";
      }
    }

    // 3) kdaj nakupuješ: nakupi po dnevih v tednu (pon–ned)
    var dnevi = [0, 0, 0, 0, 0, 0, 0];
    po.forEach(function (g) { dnevi[(new Date(g.ts).getDay() + 6) % 7]++; });
    h += '<h2 class="nk-h">Kdaj nakupuješ</h2><div class="nk-card"><p class="nk-pod">Nakupi po dnevih v tednu</p>' +
      stolpci(dnevi.map(function (n, i) { return [kratko(new Date(2024, 0, 1 + i), { weekday: "short" }), n]; }), "nk-dnevi") + "</div>";

    // največkrat kupljeno
    var iz = {};
    z.forEach(function (x) { iz[x.name] = (iz[x.name] || 0) + 1; });
    var top = Object.keys(iz).sort(function (a, b) { return iz[b] - iz[a] || a.localeCompare(b); }).slice(0, 8);
    h += '<h2 class="nk-h">Največkrat kupiš</h2><div class="nk-card">' + top.map(function (n) {
      return '<div class="nk-row"><span class="nk-ime">' + esc(n) + '</span><b class="nk-x">' + iz[n] + "×</b></div>";
    }).join("") + "</div>";

    h += '<h2 class="nk-h">Zgodovina</h2>' + po.slice(0, dni).map(function (g) {
      return '<div class="nk-card nk-dan"><div class="nk-dan-g"><b>' + esc(datum(g.ts)) + "</b>" + (g.s ? "<span>" + esc(g.s) + "</span>" : "") + "</div>" +
        '<div class="nk-chips">' + g.l.map(function (x) { return "<span>" + esc(x.name) + "</span>"; }).join("") + "</div></div>";
    }).join("") + (po.length > dni ? '<button type="button" class="mini nk-vec">Pokaži več</button>' : "");
    return h + '<p class="muted small nk-op">Šteje odkljukane izdelke s seznama, brez cen. Podatki ostanejo v telefonu.</p>';
  }

  function odpri() {
    var old = $("nakupiWrap"); if (old) old.remove();
    var w = document.createElement("div");
    w.className = "sheet-wrap"; w.id = "nakupiWrap";
    w.innerHTML = '<div class="sheet nakupi-sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>' +
      '<button type="button" class="sheet-x" aria-label="Zapri"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<h1>Moji nakupi</h1><div id="nakupiBox">' + vsebina() + "</div></div>";
    document.body.appendChild(w);
    w.addEventListener("click", function (e) {
      if (e.target === w || (e.target.closest && e.target.closest(".sheet-x"))) { w.remove(); return; }
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      if (b.dataset.ob) { obdobje = b.dataset.ob; dni = 14; $("nakupiBox").innerHTML = vsebina(); }
      else if (b.classList.contains("nk-vec")) { dni += 30; $("nakupiBox").innerHTML = vsebina(); }
    });
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#btnNakupi")) odpri();
  });
  window.NK_NAKUPI = { open: odpri };
})();
