// Preizkus zaznavanja trgovine (store-detect.js): node native/tests/store-detect.test.js
// Isti primeri so v main.swift za StoreDetector.swift.
"use strict";
var D = require("../../store-detect.js");

var failed = 0;
function check(name, got, want) {
  if (got !== want) { failed++; console.log("NAPAKA " + name + ": dobil " + got + ", pričakoval " + want); }
  else console.log("ok  " + name);
}

var LAT = 46.05, LON = 14.5;
// Točka x m vzhodno in y m severno od izhodišča.
function at(x, y) { return { lat: LAT + y / 111320, lon: LON + x / (111320 * Math.cos(LAT * Math.PI / 180)) }; }
var SPAR = Object.assign({ id: "spar", hasItems: true }, at(0, 0));
var DM = Object.assign({ id: "dm", hasItems: true }, at(200, 0));

// Pot: [[x, y, acc, speed, sekund], ...] → meritev vsako sekundo; vrne dogodke s časom.
function run(det, path, stores, t0) {
  var t = t0 || 0, ev = [];
  path.forEach(function (seg) {
    for (var i = 0; i < seg[4]; i++) {
      var pt = typeof seg[0] === "function" ? seg[0](i) : at(seg[0], seg[1]);
      var r = det.update({ lat: pt.lat, lon: pt.lon, acc: seg[2], speed: seg[3], time: t }, stores);
      if (r) ev.push(r.type + ":" + r.id + "@" + t);
      t++;
    }
  });
  return { ev: ev, t: t };
}
function walk(x0, x1, y, acc, speed) {
  var n = Math.max(1, Math.round(Math.abs(x1 - x0) / speed));
  return [function (i) { return at(x0 + (x1 - x0) * (i / n), y); }, 0, acc, speed, n];
}
function first(r, type) { var e = r.ev.filter(function (x) { return x.indexOf(type) === 0; })[0]; return e ? +e.split("@")[1] : -1; }

// 1. Prideš peš in obstaneš: prihod po ~15 s pri trgovini.
var d = new D.Detector();
var r = run(d, [walk(-120, -10, 0, 8, 1.3), [-10, 0, 10, 0.3, 30]], [SPAR]);
var tin = Math.round((120 - 34) / 1.3);   // ko si znotraj 30 m + polovica natančnosti
check("peš: prihod v Spar", r.ev.length > 0 && r.ev[0].indexOf("arrived:spar") === 0, true);
check("peš: ne prej kot 15 s znotraj", first(r, "arrived") - tin >= 14, true);
check("peš: ne pozneje kot 25 s", first(r, "arrived") - tin <= 25, true);

// 2. Mimovožnja s 50 km/h 5 m od trgovine: nič.
d = new D.Detector();
r = run(d, [walk(-500, 500, 5, 6, 14)], [SPAR]);
check("mimovožnja: brez prihoda", r.ev.length, 0);

// 3. Semafor 25 m od trgovine, 35 s stojiš, nato odpelješ: nič.
d = new D.Detector();
r = run(d, [walk(-400, 0, 25, 6, 14), [0, 25, 6, 0, 35], walk(0, 400, 25, 6, 14)], [SPAR]);
check("semafor 35 s: brez prihoda", r.ev.length, 0);

// 4. Parkiraš in greš v trgovino: po vožnji prihod (dlje časa), a zagotovo.
d = new D.Detector();
r = run(d, [walk(-400, -40, 0, 6, 14), [-40, 0, 8, 0, 20], walk(-40, -5, 0, 10, 1.2), [-5, 0, 12, 0, 60]], [SPAR]);
check("parkiraš in vstopiš: prihod", r.ev.some(function (e) { return e.indexOf("arrived:spar") === 0; }), true);

// 5. Slab GPS (±60 m) v trgovini: počakamo; ob ±15 m prihod po 15 s.
d = new D.Detector();
r = run(d, [[5, 0, 60, -1, 40]], [SPAR]);
check("slab GPS: brez prihoda", r.ev.length, 0);
r = run(d, [[5, 0, 15, -1, 20]], [SPAR], r.t);
check("boljši GPS: prihod", r.ev.length === 1 && r.ev[0].indexOf("arrived:spar") === 0, true);
check("boljši GPS: po 15 s", first(r, "arrived") - 40 >= 15, true);

// 6. V trgovini GPS niha (29 ↔ 32 m, enkrat 55 m): seja ostane.
d = new D.Detector(); d.start(SPAR, 0);
r = run(d, [[29, 0, 12, 0, 5], [32, 0, 12, 0, 5], [55, 0, 25, 0, 1], [20, 0, 12, 0, 5], [33, 0, 15, 0, 10], [60, 0, 80, 0, 10]], [SPAR], 1);
check("nihanje GPS: brez odhoda", r.ev.length, 0);

// 7. Odideš peš: odhod v ~10–20 s po prečkanju 45 m.
d = new D.Detector(); d.start(SPAR, 0);
r = run(d, [[10, 0, 10, 0, 10], walk(10, 150, 0, 10, 1.4)], [SPAR], 1);
var cross = 1 + 10 + Math.round((48 - 10) / 1.4);
check("odhod peš: zaznan", first(r, "left") > 0, true);
check("odhod peš: v 20 s", first(r, "left") - cross <= 20, true);

// 8. Odpelješ se: ena meritev 300 m daleč zadošča.
d = new D.Detector(); d.start(SPAR, 0);
r = run(d, [[10, 0, 10, 0, 3], [300, 0, 40, 15, 1]], [SPAR], 1);
check("daleč: takoj odhod", first(r, "left"), 4);

// 9. Stojiš zunaj (GPS se oglasi redko): dve meritvi 16 s narazen zadoščata.
d = new D.Detector(); d.start(SPAR, 0);
var e1 = d.update(Object.assign(at(70, 0), { acc: 10, speed: 0, time: 10 }), [SPAR]);
var e2 = d.update(Object.assign(at(72, 0), { acc: 10, speed: 0, time: 26 }), [SPAR]);
check("redke meritve zunaj: odhod", !e1 && e2 && e2.type, "left");

// 10. Spar → dm: odhod iz Spara, prihod v dm.
d = new D.Detector();
r = run(d, [[0, 0, 10, 0, 20], walk(0, 195, 0, 10, 1.4), [195, 0, 10, 0, 25]], [SPAR, DM]);
check("Spar → dm: dogodki", r.ev.map(function (e) { return e.split("@")[0]; }).join(","), "arrived:spar,left:spar,arrived:dm");

// 11. Dve trgovini 35 m narazen, izdelke imaš le za drugo: stojiš vmes → tista z izdelki.
var A = Object.assign({ id: "a", hasItems: false }, at(0, 0)), B = Object.assign({ id: "b", hasItems: true }, at(35, 0));
d = new D.Detector();
r = run(d, [[15, 0, 8, 0, 25]], [A, B]);
check("sosednji trgovini: izbere tisto z izdelki", r.ev[0] && r.ev[0].split("@")[0], "arrived:b");
d = new D.Detector();
r = run(d, [[2, 0, 8, 0, 25]], [A, B]);
check("sosednji trgovini: pri vratih prve izbere prvo", r.ev[0] && r.ev[0].split("@")[0], "arrived:a");

// 12. Po odhodu se ista trgovina ne sproži takoj znova (nihanje na robu).
d = new D.Detector(); d.start(SPAR, 0); d.stop(10);
r = run(d, [[5, 0, 10, 0, 30]], [SPAR], 11);
check("takoj nazaj: brez ponovnega prihoda v 60 s", r.ev.length, 0);
r = run(d, [[5, 0, 10, 0, 40]], [SPAR], 80);
check("pozneje nazaj: prihod", r.ev.length, 1);

// 13. Med sejo se ne sproži nič drugega (ena seja naenkrat).
d = new D.Detector();
r = run(d, [[0, 0, 10, 0, 60]], [SPAR]);
check("ostaneš v trgovini: le en prihod", r.ev.length, 1);

if (failed) { console.log(failed + " napak"); process.exit(1); }
console.log("vse ok");
