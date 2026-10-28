// Recepti v aplikaciji: vodeno izbiranje (čas → denar → težavnost → mapa) ali iskanje,
// recept z izbiro števila oseb in količinami, ki gredo na seznam.
// »Moja kuhinja«: aparati, ki jih imaš, alergije in prehrana; recepti, ki jih ne moreš skuhati ali jesti, so skriti.
// Podatki so isti kot na nakupko.com (recepti.json, količine za 4 osebe; polja 8–10: aparati, alergeni, prehrana).
(function () {
  "use strict";
  var REC = null, rt = null, rb = null, rd = null, rm = null, cur = null, off = {}, sug = 0;
  var SL = (window.NK_LANG || "sl") === "sl";
  var T = function (s) { return window.NK_T ? window.NK_T(s) : s; };
  var KEY = "nakupko-osebe", KKEY = "nakupko-kuhinja";
  var servings = 4;
  try { servings = Math.min(20, Math.max(1, +localStorage.getItem(KEY) || 4)); } catch (e) { /* nič */ }
  var CASI = [["t20", 0, 20, "Do 20 minut", "Ko se mudi"], ["t45", 21, 45, "Do 45 minut", "Za vsak dan"],
    ["t90", 46, 90, "Do ure in pol", "Ko imaš malo več časa"], ["tvec", 91, 9999, "Več kot ura in pol", "Za vikend in praznike"]];
  // denar na osebo (€): do 1, do 2, do 3,50, več
  var DENAR = [["b1", 0, 1, "Res poceni"], ["b2", 1, 2, "Varčno"], ["b3", 2, 3.5, "Običajno"], ["b4", 3.5, 1e9, "Za poseben dan"]];
  var TEZ = [[1, "Enostavno", "Zmore vsak"], [2, "Srednje", "Nekaj izkušenj"], [3, "Zahtevno", "Za prave kuharje"]];
  var APAR = [["stedilnik", "Štedilnik"], ["pecica", "Pečica"], ["mikrovalovka", "Mikrovalovna pečica"], ["cvrtnik", "Cvrtnik na vroč zrak"],
    ["blender", "Blender"], ["mikser", "Mikser"], ["zar", "Žar"], ["pocasni", "Počasni kuhalnik"], ["toaster", "Opekač kruha"], ["sopar", "Soparnik"]];
  var ALER = [["gluten", "Gluten"], ["mleko", "Mleko in laktoza"], ["jajca", "Jajca"], ["orescki", "Oreščki"], ["arasidi", "Arašidi"], ["ribe", "Ribe"],
    ["raki", "Raki in školjke"], ["soja", "Soja"], ["sezam", "Sezam"], ["zelena", "Zelena"], ["gorcica", "Gorčica"]];
  var DIETE = ["Jem vse", "Vegetarijansko", "Vegansko"];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  function ico(k) { return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ((window.IKONE_JEDI || {})[k] || "") + "</svg>"; }
  function mins(m) { if (m < 60) return m + " min"; var h = Math.floor(m / 60), r = m % 60; return h + " h" + (r ? " " + r + " min" : ""); }
  function dots(n) { return '<span class="rdots">' + [1, 2, 3].map(function (i) { return '<i class="' + (i <= n ? "on" : "") + '"></i>'; }).join("") + "</span>"; }
  function nm(r) { return SL ? r[1] : r[2]; }
  function mapName(m) { return SL ? m[1] : m[2]; }
  function casOf(r) { return CASI.filter(function (c) { return r[3] >= c[1] && r[3] <= c[2]; })[0][0]; }

  // ---------- Moja kuhinja (zapomnjeno v napravi) ----------
  var kit = { ap: APAR.map(function (a) { return a[0]; }), al: [], diet: 0, set: false };
  try { var ks = JSON.parse(localStorage.getItem(KKEY) || "null"); if (ks && ks.ap) kit = { ap: ks.ap, al: ks.al || [], diet: ks.diet || 0, set: true }; } catch (e) { /* nič */ }
  function saveKit() { kit.set = true; try { localStorage.setItem(KKEY, JSON.stringify(kit)); } catch (e) { /* nič */ } }
  function has(a) { return kit.ap.indexOf(a) >= 0; }
  function ok(r) {
    var ap = r[8] || [], al = r[9] || [];
    if (!ap.every(function (x) { return x === "!" || x.split("|").some(has); })) return false;
    if (al.some(function (x) { return kit.al.indexOf(x) >= 0; })) return false;
    return (r[10] || 0) >= kit.diet;
  }

  // ---------- okvirna cena jedi na osebo (katalog izdelkov + nočne cene iz trgovin) ----------
  var CAT = null, LIVE = null;
  var KOS = [[/čebul|šalotk/, 120], [/krompir/, 150], [/korenj|pastinak|peteršiljeva/, 80], [/paprik/, 150], [/paradižnik$|paradižnik na/, 120], [/jabolk|hrušk|bresk|nektarin|pomaranč/, 150],
    [/banan/, 120], [/limon|limet/, 90], [/kumar/, 300], [/bučke|jajčevc/, 250], [/avokad|mango/, 220], [/zelje|ohrovt/, 1000], [/cvetač/, 800], [/brokol/, 400], [/pesa/, 150],
    [/melon|ananas|buč/, 1300], [/lubenic/, 4000], [/sir|šunk|salam/, 20], [/jajc/, 60], [/žemlj|kajzer|lepinj|hamburger|pita|tortilj/, 70], [/ingver|hren/, 60], [/zelena/, 400],
    [/^por$/, 250], [/radič|solata|kitajsko/, 400]];
  var GR = { "žlica": 15, "žlička": 5, "strok": 5, "rezina": 25, "list": 0.5, "pločevinka": 400, "kozarec": 350 };
  function kosG(n) { n = n.toLowerCase(); for (var i = 0; i < KOS.length; i++) if (KOS[i][0].test(n)) return KOS[i][1]; return 150; }
  function pkg(u) {
    u = String(u || "kos").replace(",", ".");
    var m = u.match(/^(?:(\d+) x )?([\d.]+)\s*(g|kg|ml|l|kos|vreč\w*|rol\w*)$/);
    if (m) { var q = (+m[1] || 1) * +m[2], e = m[3]; return e === "kg" || e === "l" ? [q * 1000, "g"] : e === "g" || e === "ml" ? [q, "g"] : [q, "kos"]; }
    return u === "kg" || u === "l" ? [1000, "g"] : [1, "kos"];
  }
  // delež pakiranja, ki ga porabi sestavina
  function share(g, unit) {
    var q = g[1], u = g[2], p = pkg(unit);
    if (!q) return 0.04;
    if (u === "kg" || u === "l") { q *= 1000; u = "g"; }
    if (u === "ml") u = "g";
    if (GR[u] && !(p[1] === "kos" && (u === "strok" || u === "pločevinka" || u === "kozarec"))) { q *= GR[u]; u = "g"; }
    if (u === "strok") return q / 10;
    if (u === "pločevinka" || u === "kozarec") return q;
    if (u === "vrečka" || u === "zavitek" || u === "šopek") return p[1] === "kos" && p[0] > 1 ? q / p[0] : q;
    if (p[1] === "g") return (u === "g" ? q : q * kosG(g[0])) / p[0];
    return (u === "g" ? q / (p[0] === 1 ? Math.max(kosG(g[0]), 200) : kosG(g[0])) : q) / p[0];
  }
  function priceOf(n) {
    if (!CAT) {
      CAT = {}; LIVE = {};
      (window.NAKUPKO_PRODUCTS || []).forEach(function (p) { if (!CAT[p[0]]) CAT[p[0]] = p; });
      ((window.NAKUPKO_PRICES || {}).izdelki || []).forEach(function (e) {
        if (e.znamka || !e.cene) return;
        var v = [], k; for (k in e.cene) v.push(e.cene[k]); for (k in e.akcija || {}) v.push(e.akcija[k]);
        if (v.length) LIVE[e.ime] = Math.min.apply(null, v);
      });
    }
    var c = CAT[n]; if (!c || c[1] === "Gospodinjstvo") return null;
    var l = LIVE[n], p = c[3];
    if (l && l > p * 0.4 && l < p * 2.5) p = l;
    return [p, c[4]];
  }
  function cost(r) {
    if (r.cost == null) {
      var t = 0;
      r[6].forEach(function (g) { var p = priceOf(g[0]); if (p) t += Math.min(share(g, p[1]), 3) * p[0]; });
      r.cost = t / 4;
    }
    return r.cost;
  }
  function money(v) {
    var api = window.__nakupko, s = api && api.moneyScale ? api.moneyScale() : 1;
    return api && api.eur ? api.eur(v * s) : v.toFixed(2).replace(".", ",") + " €";
  }
  function costTxt(r) { return "≈ " + money(cost(r)); }
  function denOf(r) { var c = cost(r); return DENAR.filter(function (b) { return c > b[1] && c <= b[2] || (b[1] === 0 && c <= b[2]); })[0][0]; }

  function pool(t, b, d, m) {
    return REC.jedi.map(function (r, i) { return i; }).filter(function (i) {
      var r = REC.jedi[i];
      return ok(r) && (!t || t === "vse" || casOf(r) === t) && (!b || b === "vse" || denOf(r) === b) && (!d || d === "vse" || r[4] === d) && (!m || r[5] === m);
    });
  }
  function jedi(n) { return n + " " + T(n === 1 ? "jed" : "jedi"); }
  function items() { var a = window.__nakupko; return a && a.state ? (a.state().items || []) : []; }
  function openSet() { var o = {}; items().forEach(function (y) { if (!y.done) o[norm(y.name)] = 1; }); return o; }
  function card(i, open, cls) {
    var r = REC.jedi[i], hasAll = r[6].every(function (x) { return open[norm(x[0])]; });
    return '<button type="button" class="rc' + (cls || "") + (hasAll ? " added" : "") + '" data-i="' + i + '"><span class="ric">' + ico(r[0]) + '</span><span class="rtx"><b>' + esc(nm(r)) + '</b><span class="rmeta">' + mins(r[3]) + dots(r[4]) + '<span class="rcost">' + esc(costTxt(r)) + "</span></span></span></button>";
  }
  function cards(ids) { var open = openSet(); return '<div class="rgrid">' + ids.map(function (i) { return card(i, open); }).join("") + "</div>"; }
  // »Predlagam ti«: najprej jedi, za katere imaš sestavine že na seznamu, potem pestro naključno; ↻ da naslednjo
  function suggest(ids) {
    if (!ids.length) return "";
    var open = openSet();
    var sc = ids.map(function (i) {
      var r = REC.jedi[i]; if (r.rnd == null) r.rnd = Math.random();
      var n = r[6].filter(function (x) { return open[norm(x[0])]; }).length;
      return [n * 2 + r.rnd * 3, i, n];
    }).sort(function (a, b) { return b[0] - a[0]; });
    var top = sc.slice(0, Math.min(sc.length, 12)), s = top[sug % top.length], r = REC.jedi[s[1]];
    var why = s[2] ? T("Imaš že na seznamu") + ": " + s[2] : "";
    return '<div class="rsug"><div class="rsug-h"><span class="rk">' + esc(T("Predlagam ti")) + "</span>" +
      (top.length > 1 ? '<button type="button" class="rsug-n" data-sug="1">↻ ' + esc(T("Drug predlog")) + "</button>" : "") + "</div>" +
      card(s[1], open, " rc-sug") + (why ? '<p class="rsug-w">' + esc(why) + "</p>" : "") + "</div>";
  }
  function step(k, h, body, skip, sub) {
    return '<div class="rstep"><span class="rk">' + esc(T(k)) + "</span><h2>" + esc(h) + "</h2>" + (sub ? '<p class="rsub">' + esc(T(sub)) + "</p>" : "") + body + (skip ? '<button type="button" class="rskip" data-skip="1">' + esc(T(skip)) + "</button>" : "") + "</div>";
  }
  function kitBar() {
    var n = kit.ap.length, bits = [T("Aparati") + ": " + n + "/" + APAR.length];
    if (kit.diet) bits.push(T(DIETE[kit.diet]).toLowerCase());
    if (kit.al.length) bits.push(T("Brez") + ": " + kit.al.map(function (a) { return T(ALER.filter(function (x) { return x[0] === a; })[0][1]).toLowerCase(); }).join(", "));
    return '<button type="button" class="rkit' + (kit.set ? "" : " new") + '" data-kit="1"><span class="rkit-ic">' + KIT_ICON + '</span><span class="rkit-tx"><b>' + esc(T("Moja kuhinja")) + "</b><span>" +
      esc(kit.set ? bits.join(" · ") : T("Povej, kaj imaš v kuhinji in česa ne ješ. Predlagal ti bom prave recepte.")) + '</span></span><span class="rkit-go">' + esc(T("Uredi")) + " ›</span></button>";
  }
  function draw() {
    var box = $("rflow"); if (!box) return;
    if (!REC) { box.innerHTML = '<p class="empty">' + esc(T("Nalagam recepte …")) + "</p>"; return; }
    var q = norm($("rq").value), words = q.split(" ").filter(Boolean), h = kitBar();
    if (words.length) {
      var mapa = {}; REC.mape.forEach(function (m) { mapa[m[0]] = m; });
      var all = REC.jedi.map(function (r, i) { return i; }).filter(function (i) {
        var r = REC.jedi[i];
        var hay = r.hay || (r.hay = norm([r[1], r[2], mapa[r[5]][1], mapa[r[5]][2]].concat(r[6].map(function (x) { return x[0] + " " + T(x[0]); })).join(" ")));
        return words.every(function (w) { return hay.indexOf(w.length >= 6 ? w.slice(0, -2) : w) >= 0; });
      });
      var res = all.filter(function (i) { return ok(REC.jedi[i]); });
      box.innerHTML = h + step("Iskanje", jedi(res.length), (res.length ? cards(res) : '<p class="empty">' + esc(T("Ni zadetkov. Poskusi z drugo besedo.")) + "</p>") +
        (all.length > res.length ? '<p class="rhid">' + esc(T("Nekatere jedi so skrite zaradi nastavitev v Moji kuhinji.")) + "</p>" : ""));
      return;
    }
    var cr = [];
    if (rt) cr.push(["t", rt === "vse" ? T("Ves čas") : T(CASI.filter(function (c) { return c[0] === rt; })[0][3])]);
    if (rb) cr.push(["b", rb === "vse" ? T("Vsaka cena") : budLabel(DENAR.filter(function (b) { return b[0] === rb; })[0])]);
    if (rd) cr.push(["d", rd === "vse" ? T("Vsa zahtevnost") : T(TEZ[rd - 1][1])]);
    if (rm) cr.push(["m", mapName(REC.mape.filter(function (m) { return m[0] === rm; })[0])]);
    if (cr.length) h += '<div class="rcrumbs">' + cr.map(function (c) { return '<button type="button" data-back="' + c[0] + '">' + esc(c[1]) + " ×</button>"; }).join("") + "</div>";
    var now = pool(rt, rb, rd, rm);
    if (!now.length) { box.innerHTML = h + '<p class="empty">' + esc(T("Za te nastavitve ni receptov. Spremeni Mojo kuhinjo.")) + "</p>"; return; }
    if (!rm) h += suggest(now);
    if (!rt) {
      h += step("Korak 1 od 4", T("Koliko časa imaš?"), '<div class="ropts">' + CASI.map(function (c) {
        var n = pool(c[0]).length; if (!n) return "";
        return '<button type="button" class="ropt" data-t="' + c[0] + '"><b>' + esc(T(c[3])) + "</b><span>" + esc(T(c[4])) + "</span><small>" + jedi(n) + "</small></button>";
      }).join("") + "</div>", "Vseeno mi je, pokaži vse");
    } else if (!rb) {
      h += step("Korak 2 od 4", T("Koliko želiš porabiti?"), '<div class="ropts">' + DENAR.map(function (b) {
        var n = pool(rt, b[0]).length; if (!n) return "";
        return '<button type="button" class="ropt" data-b="' + b[0] + '"><b>' + esc(budLabel(b)) + "</b><span>" + esc(T(b[3])) + "</span><small>" + jedi(n) + "</small></button>";
      }).join("") + "</div>", "Vseeno, pokaži vse", "Okvirno na osebo, po cenah v trgovinah.");
    } else if (!rd) {
      h += step("Korak 3 od 4", T("Kako zahtevno naj bo?"), '<div class="ropts">' + TEZ.map(function (t) {
        var n = pool(rt, rb, t[0]).length; if (!n) return "";
        return '<button type="button" class="ropt" data-d="' + t[0] + '">' + dots(t[0]) + "<b>" + esc(T(t[1])) + "</b><span>" + esc(T(t[2])) + "</span><small>" + jedi(n) + "</small></button>";
      }).join("") + "</div>", "Vseeno, pokaži vse");
    } else if (!rm) {
      h += step("Korak 4 od 4", T("Na kaj imaš danes apetit?"), '<div class="rfold">' + REC.mape.map(function (m) {
        var ids = pool(rt, rb, rd, m[0]); if (!ids.length) return "";
        var seen = {}, ics = ids.map(function (i) { return REC.jedi[i][0]; }).filter(function (x) { return seen[x] ? false : (seen[x] = 1); }).slice(0, 3);
        return '<button type="button" class="rf" data-m="' + m[0] + '"><span class="rfi">' + ics.map(ico).join("") + "</span><b>" + esc(mapName(m)) + "</b><span>" + jedi(ids.length) + "</span></button>";
      }).join("") + "</div>");
    } else {
      // izbran proračun: najcenejše najprej
      if (rb !== "vse") now.sort(function (a, b) { return cost(REC.jedi[a]) - cost(REC.jedi[b]); });
      h += suggest(now) + step("Izberi jed", mapName(REC.mape.filter(function (m) { return m[0] === rm; })[0]), cards(now));
    }
    box.innerHTML = h;
  }
  function budLabel(b) { return b[2] > 1e8 ? T("Več kot") + " " + money(b[1]) : T("Do") + " " + money(b[2]); }

  // ---------- Moja kuhinja: slika kuhinje s tapljivimi aparati, alergije in prehrana ----------
  var KIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M4 9h16M8 6h.01M12 6h.01"/><rect x="7.5" y="12" width="9" height="6" rx="1.2"/></svg>';
  // [koda, x in y kljukice, risba]; razred b = ohišje (obarva se, ko aparat imaš), d = podrobnosti
  var KUH = [
    ["mikrovalovka", 116, 44, '<rect class="b" x="16" y="46" width="104" height="46" rx="7"/><rect class="d" x="25" y="54" width="62" height="30" rx="4"/><circle class="d" cx="104" cy="62" r="4"/><circle class="d" cx="104" cy="76" r="4"/>'],
    ["sopar", 344, 30, '<path class="d" d="M321 36c-3-4 3-6 0-10M334 36c-3-4 3-6 0-10"/><path class="b" d="M310 48a17 7 0 0 1 34 0z"/><rect class="b" x="310" y="48" width="34" height="14" rx="3"/><rect class="b" x="310" y="62" width="34" height="14" rx="3"/><rect class="b" x="307" y="76" width="40" height="16" rx="4"/><path class="d" d="M316 84h22"/>'],
    ["pocasni", 296, 50, '<path class="b" d="M246 66a24 9 0 0 1 48 0z"/><path class="b" d="M244 66h52v17a9 9 0 0 1-9 9h-34a9 9 0 0 1-9-9z"/><circle class="d" cx="270" cy="56" r="2.6"/><path class="d" d="M239 73h5M296 73h5"/><circle class="d" cx="270" cy="80" r="3.4"/>'],
    ["toaster", 70, 104, '<path class="d" d="M29 118v-9a5 5 0 0 1 10 0v9M47 118v-9a5 5 0 0 1 10 0v9"/><rect class="b" x="18" y="116" width="54" height="34" rx="10"/><path class="d" d="M72 128h5M30 140h30"/>'],
    ["blender", 114, 64, '<rect class="b" x="80" y="64" width="32" height="8" rx="2.5"/><path class="b" d="M82 72h28l-4 50H86z"/><path class="d" d="M90 112h12M96 112v-6"/><rect class="b" x="79" y="122" width="34" height="28" rx="6"/><circle class="d" cx="96" cy="136" r="4"/>'],
    ["stedilnik", 222, 104, '<rect x="134" y="100" width="92" height="52" fill="transparent" stroke="none"/><path class="d" d="M146 120h-6M200 120h6"/><path class="b" d="M146 112h54v25a6 6 0 0 1-6 6h-42a6 6 0 0 1-6-6z"/><path class="d" d="M160 106c-2-3 2-5 0-8M173 106c-2-3 2-5 0-8M186 106c-2-3 2-5 0-8"/><rect class="b" x="134" y="143" width="92" height="7" rx="2"/>'],
    ["mikser", 288, 96, '<path class="b" d="M244 114a14 13 0 0 1 14-13h20a8 8 0 0 1 8 8v8h-42z"/><rect class="b" x="276" y="117" width="10" height="27" rx="2"/><path class="d" d="M258 117v7"/><path class="b" d="M244 124h30l-3 15a5 5 0 0 1-5 4h-14a5 5 0 0 1-5-4z"/><rect class="b" x="240" y="144" width="50" height="6" rx="3"/>'],
    ["cvrtnik", 346, 102, '<rect class="b" x="298" y="104" width="48" height="46" rx="14"/><circle class="d" cx="322" cy="117" r="5"/><path class="d" d="M302 128h40"/><rect class="d" x="314" y="134" width="16" height="5" rx="2.5"/>'],
    ["pecica", 222, 166, '<rect class="b" x="136" y="164" width="88" height="94" rx="7"/><circle class="d" cx="150" cy="172" r="3"/><circle class="d" cx="162" cy="172" r="3"/><circle class="d" cx="198" cy="172" r="3"/><circle class="d" cx="210" cy="172" r="3"/><path class="d" d="M150 186h60"/><rect class="d" x="148" y="194" width="64" height="50" rx="5"/>'],
    ["zar", 104, 170, '<path class="d" d="M58 170h12M64 170v6"/><path class="b" d="M34 196a30 22 0 0 1 60 0z"/><path class="b" d="M30 198h68a34 26 0 0 1-68 0z"/><path class="d" d="M46 220l-10 38M82 220l10 38M64 224v34"/><circle class="b" cx="36" cy="258" r="4.5"/>']
  ];
  function kitSvg() {
    return '<svg class="kit" viewBox="0 0 360 290" role="group" aria-label="' + esc(T("Moja kuhinja")) + '">' +
      '<rect class="kw" x="0" y="0" width="360" height="290" rx="20"/><path class="kf" d="M0 262h360v8a20 20 0 0 1-20 20H20A20 20 0 0 1 0 270z"/>' +
      '<path class="kh" d="M152 16h56v24l16 22h-88l16-22z"/><rect class="kc" x="8" y="92" width="120" height="5" rx="2"/><rect class="kc" x="236" y="92" width="116" height="5" rx="2"/>' +
      '<rect class="kc" x="6" y="150" width="348" height="10" rx="3"/><rect class="kd" x="232" y="160" width="120" height="102"/><path class="kl" d="M232 194h120M232 228h120M282 177h20M282 211h20M282 245h20"/>' +
      KUH.map(function (k) {
        var on = has(k[0]), nm_ = T(APAR.filter(function (a) { return a[0] === k[0]; })[0][1]);
        return '<g class="ka' + (on ? " on" : "") + '" data-ap="' + k[0] + '" role="button" tabindex="0" aria-pressed="' + on + '" aria-label="' + esc(nm_) + '"><title>' + esc(nm_) + "</title>" + k[3] +
          '<g class="kb" transform="translate(' + k[1] + " " + k[2] + ')"><circle r="9"/><path d="' + (on ? "M-4 0l3 3 5-6" : "M-4 0h8M0-4v8") + '"/></g></g>';
      }).join("") + "</svg>";
  }
  function drawKit() {
    var w = $("rkitSheet"); if (!w) return;
    var n = REC ? REC.jedi.filter(ok).length : 0;
    w.querySelector(".kit-pic").innerHTML = kitSvg();
    w.querySelector(".kit-ap").innerHTML = APAR.map(function (a) {
      return '<button type="button" class="kchip' + (has(a[0]) ? " on" : "") + '" data-ap="' + a[0] + '" aria-pressed="' + has(a[0]) + '">' + esc(T(a[1])) + "</button>";
    }).join("");
    w.querySelector(".kit-diet").innerHTML = DIETE.map(function (d, i) {
      return '<button type="button" class="kseg' + (kit.diet === i ? " on" : "") + '" data-diet="' + i + '" aria-pressed="' + (kit.diet === i) + '">' + esc(T(d)) + "</button>";
    }).join("");
    w.querySelector(".kit-al").innerHTML = ALER.map(function (a) {
      var on = kit.al.indexOf(a[0]) >= 0;
      return '<button type="button" class="kchip al' + (on ? " on" : "") + '" data-al="' + a[0] + '" aria-pressed="' + on + '">' + esc(T(a[1])) + "</button>";
    }).join("");
    w.querySelector(".kit-n").textContent = T("Primernih receptov") + ": " + n + " / " + (REC ? REC.jedi.length : 0);
  }
  function openKit() {
    var w = document.createElement("div");
    w.className = "sheet-wrap"; w.id = "rkitWrap";
    w.innerHTML = '<div class="sheet rkit-sheet" id="rkitSheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>' +
      "<h1>" + esc(T("Moja kuhinja")) + '</h1><p class="muted">' + esc(T("Tapni aparate, ki jih imaš. Obarvani so tvoji.")) + "</p>" +
      '<div class="kit-pic"></div><div class="kit-ap kchips"></div>' +
      '<h3 class="kit-h">' + esc(T("Alergije in prehrana")) + '</h3><div class="kit-diet ksegs"></div>' +
      '<p class="muted small">' + esc(T("Česa ne smeš ali ne želiš jesti?")) + '</p><div class="kit-al kchips"></div>' +
      '<p class="kit-n"></p><button type="button" class="btn primary full kit-ok">' + esc(T("Shrani")) + "</button></div>";
    document.body.appendChild(w);
    function tog(b) {
      if (b.dataset.ap) { var a = b.dataset.ap; kit.ap = has(a) ? kit.ap.filter(function (x) { return x !== a; }) : kit.ap.concat([a]); }
      else if (b.dataset.al) { var l = b.dataset.al; kit.al = kit.al.indexOf(l) >= 0 ? kit.al.filter(function (x) { return x !== l; }) : kit.al.concat([l]); }
      else if (b.dataset.diet) kit.diet = +b.dataset.diet;
      else return;
      saveKit(); sug = 0; drawKit(); draw();
    }
    w.addEventListener("click", function (e) {
      if (e.target === w) { closeKit(); return; }
      var b = e.target.closest && e.target.closest("button, .ka"); if (!b) return;
      if (b.classList.contains("kit-ok")) { saveKit(); closeKit(); draw(); return; }
      tog(b);
    });
    w.addEventListener("keydown", function (e) {
      var g = e.target.closest && e.target.closest(".ka");
      if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tog(g); var x = w.querySelector('.ka[data-ap="' + g.dataset.ap + '"]'); if (x) x.focus(); }
    });
    drawKit();
  }
  function closeKit() { var w = $("rkitWrap"); if (w) w.remove(); }

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
    sh.querySelector(".rsh-m").textContent = mins(r[3]) + " · " + T(TEZ[r[4] - 1][1]) + " · " + costTxt(r) + " " + T("na osebo");
    var al = (r[9] || []).map(function (a) { return T(ALER.filter(function (x) { return x[0] === a; })[0][1]).toLowerCase(); });
    sh.querySelector(".rsh-al").textContent = al.length ? T("Vsebuje") + ": " + al.join(", ") : "";
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
      '<div class="rsh-head"><span class="rsh-ic"></span><div><b class="rsh-t"></b><span class="rsh-m"></span><span class="rsh-al"></span></div></div>' +
      '<div class="rsh-serv"><span>' + esc(T("Za koliko oseb?")) + '</span><span class="rsh-step"><button type="button" class="rsh-minus" aria-label="−">−</button><b class="rsh-n"></b><button type="button" class="rsh-plus" aria-label="+">+</button></span></div>' +
      '<div class="rsh-list"></div><p class="muted small">' + esc(T("Odkljukaj, kar že imaš doma.")) + '</p>' +
      '<button type="button" class="btn primary full rsh-add"></button>' +
      '<button type="button" class="btn full rsh-cook">' + esc(T("Kuhaj po korakih ›")) + "</button></div>";
    document.body.appendChild(w);
    w.addEventListener("click", function (e) {
      if (e.target === w) { close(); return; }
      var b = e.target.closest && e.target.closest("button"); if (!b) return;
      if (b.classList.contains("rsh-minus")) servings = Math.max(1, servings - 1);
      else if (b.classList.contains("rsh-plus")) servings = Math.min(20, servings + 1);
      else if (b.dataset.i) off[+b.dataset.i] = !off[+b.dataset.i];
      else if (b.classList.contains("rsh-add")) { addAll(); return; }
      else if (b.classList.contains("rsh-cook")) { close(); cook(REC.jedi.indexOf(cur), servings); return; }
      try { localStorage.setItem(KEY, servings); } catch (err) { /* nič */ }
      drawSheet();
    });
    drawSheet();
  }
  function close() { var w = $("rsheetWrap"); if (w) w.remove(); }
  function addAll() {
    var api = window.__nakupko, n = 0; if (!api) return;
    cur[6].forEach(function (g, i) { if (off[i]) return; api.add(g[0], amtOf(g)); n++; });
    saveMoj(cur[1], servings);
    close(); draw();
    if (api.toast) api.toast(SL ? "Na seznam dodano: " + n + " sestavin za " + osebe(servings) : T("Dodano na seznam") + ": " + n + " · " + osebe(servings));
  }


  // ---------- kuhanje po korakih ----------
  // »Tvoji recepti«: jedi, ki si jih dal na seznam. Po nakupu so nad seznamom: »Kuhaj ›«.
  // Med kuhanjem je korak tudi na zaklenjenem zaslonu (iPhone: Live Activity, Android: obvestilo) z Nazaj/Naprej.
  var MOJI = "nakupko-moji-recepti", ck = null, ckStep = 0, ckOs = 4, wake = null;
  function getMoji() { try { return JSON.parse(localStorage.getItem(MOJI) || "[]") || []; } catch (e) { return []; } }
  function setMoji(m) { try { localStorage.setItem(MOJI, JSON.stringify(m.slice(0, 6))); } catch (e) { /* nič */ } moji(); }
  function saveMoj(name, os) { setMoji([{ n: name, o: os, t: Date.now() }].concat(getMoji().filter(function (x) { return x.n !== name; }))); }
  function byName(n) { if (!REC) return -1; for (var i = 0; i < REC.jedi.length; i++) if (REC.jedi[i][1] === n) return i; return -1; }
  function steps(r) { return r[7] ? r[7][SL ? 0 : 1] : []; }
  function moji() {
    var m = getMoji(), boxes = document.querySelectorAll(".nk-moji");
    if (m.length && !REC) { load(); return; }
    m = m.filter(function (x) { return byName(x.n) >= 0; });
    boxes.forEach(function (box) {
      box.classList.toggle("hidden", !m.length);
      box.innerHTML = m.length ? '<span class="mk">' + esc(T("Tvoji recepti")) + "</span>" + m.map(function (x) {
        return '<span class="mj"><button type="button" class="mj-go" data-cook="' + esc(x.n) + '">' + esc(nm(REC.jedi[byName(x.n)])) + "<b>" + esc(T("Kuhaj ›")) + '</b></button><button type="button" class="mj-x" data-unmoj="' + esc(x.n) + '" aria-label="' + esc(T("Odstrani")) + '">×</button></span>';
      }).join("") : "";
    });
  }
  function native(o) { if (window.__nakupkoCook) try { window.__nakupkoCook(o); } catch (e) { /* nič */ } }
  function cook(i, os) {
    if (!REC || !REC.jedi[i]) return;
    ck = REC.jedi[i]; ckStep = 0; ckOs = os || servings;
    var w = document.createElement("div");
    w.className = "kuhaj"; w.id = "kuhaj";
    w.innerHTML = '<div class="kh-top"><button type="button" class="kh-x" aria-label="' + esc(T("Zapri")) + '">×</button><b class="kh-name"></b><span class="kh-cnt"></span></div>' +
      '<div class="kh-bar"><i></i></div><div class="kh-body"><div class="kh-k"></div><p class="kh-step"></p>' +
      '<details class="kh-ing"><summary>' + esc(T("Sestavine")) + ' <span class="kh-os"></span></summary><div class="kh-list"></div></details></div>' +
      '<div class="kh-nav"><button type="button" class="kh-prev">' + esc(T("‹ Nazaj")) + '</button><button type="button" class="kh-next"></button></div>';
    document.body.appendChild(w);
    w.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button"); if (!b) return;
      if (b.classList.contains("kh-x")) closeCook();
      else if (b.classList.contains("kh-prev")) move(-1);
      else if (b.classList.contains("kh-next")) move(1);
    });
    var sx = null;
    w.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    w.addEventListener("touchend", function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1); });
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (x) { wake = x; }).catch(function () {}); } catch (e) { /* nič */ }
    drawCook(); sendNative();
  }
  function drawCook() {
    var w = $("kuhaj"); if (!w || !ck) return;
    var st = steps(ck), n = st.length, fin = ckStep >= n, api = window.__nakupko;
    w.querySelector(".kh-name").textContent = nm(ck);
    w.querySelector(".kh-cnt").textContent = fin ? "✓" : (ckStep + 1) + " / " + n;
    w.querySelector(".kh-bar i").style.width = (fin ? 100 : (ckStep + 1) / n * 100) + "%";
    w.querySelector(".kh-k").textContent = fin ? "" : T("Korak") + " " + (ckStep + 1) + " / " + n;
    var p = w.querySelector(".kh-step"); p.textContent = fin ? T("Dober tek!") : st[ckStep]; p.classList.toggle("fin", fin);
    w.querySelector(".kh-os").textContent = "(" + (SL ? ckOs + (ckOs === 1 ? " oseba" : ckOs === 2 ? " osebi" : ckOs < 5 ? " osebe" : " oseb") : osebe(ckOs)) + ")";
    w.querySelector(".kh-list").innerHTML = ck[6].map(function (g) {
      var a = scaleAmt(g[1], g[2], ckOs / 4), m = null; if (a) { m = {}; m[a[1]] = a[0]; }
      return "<p>" + esc(T(g[0])) + "<span>" + esc(m && api && api.amtText ? api.amtText(m) : T("po okusu")) + "</span></p>";
    }).join("");
    w.querySelector(".kh-prev").disabled = ckStep === 0;
    w.querySelector(".kh-next").textContent = fin ? T("Končano ✓") : ckStep === n - 1 ? T("Zadnji korak ✓") : T("Naprej ›");
  }
  function sendNative() {
    if (!ck) { native({ active: false }); return; }
    native({ active: true, title: nm(ck), steps: steps(ck), step: ckStep, done: T("Dober tek!"), lang: window.NK_LANG || "sl" });
  }
  function move(d) {
    var n = steps(ck).length;
    if (d > 0 && ckStep >= n) { setMoji(getMoji().filter(function (x) { return x.n !== ck[1]; })); closeCook(); return; }
    ckStep = Math.max(0, Math.min(n, ckStep + d)); drawCook(); sendNative();
  }
  function closeCook() { var w = $("kuhaj"); if (w) w.remove(); ck = null; sendNative(); if (wake) { wake.release().catch(function () {}); wake = null; } }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".nk-moji button"); if (!b) return;
    if (b.dataset.unmoj) { setMoji(getMoji().filter(function (x) { return x.n !== b.dataset.unmoj; })); return; }
    var x = getMoji().filter(function (y) { return y.n === b.dataset.cook; })[0];
    cook(byName(b.dataset.cook), x && x.o);
  });
  var loading = false;
  function load() {
    if (REC || loading) return; loading = true;
    fetch("recepti.json").then(function (r) { return r.json(); }).then(function (d) { REC = d; draw(); moji(); }).catch(function () { loading = false; });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#rflow button"); if (!b) return;
    if (b.dataset.i) { openRecipe(+b.dataset.i); return; }
    if (b.dataset.kit) { openKit(); return; }
    if (b.dataset.sug) { sug++; draw(); return; }
    if (b.dataset.t) rt = b.dataset.t; else if (b.dataset.b) rb = b.dataset.b; else if (b.dataset.d) rd = +b.dataset.d; else if (b.dataset.m) rm = b.dataset.m;
    else if (b.dataset.skip) { if (!rt) rt = "vse"; else if (!rb) rb = "vse"; else rd = "vse"; }
    else if (b.dataset.back) { var k = b.dataset.back; if (k === "t") { rt = rb = rd = rm = null; } else if (k === "b") { rb = rd = rm = null; } else if (k === "d") { rd = rm = null; } else rm = null; }
    sug = 0;
    draw();
    var p = $("paneRecipes"); if (p && p.getBoundingClientRect().top < 0) p.scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "rq") draw(); });

  window.NK_RECEPTI = {
    show: function () { draw(); load(); },
    // korak, spremenjen na zaklenjenem zaslonu (native.js ob vrnitvi v aplikacijo)
    step: function (n) { if (!ck || typeof n !== "number") return; ckStep = Math.max(0, Math.min(steps(ck).length, n)); drawCook(); }
  };
  if (getMoji().length) setTimeout(load, 800);
})();
