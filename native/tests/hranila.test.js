// Preverba okvirnih prehranskih vrednosti (hranila.json + hranila.js).
// node native/tests/hranila.test.js
"use strict";
var path = require("path"), root = path.join(__dirname, "..", "..");
var H = require(path.join(root, "hranila.json")), N = require(path.join(root, "hranila.js")), R = require(path.join(root, "recepti.json"));
global.window = {};
require(path.join(root, "prilagodi.js"));
var P = global.window.NK_PRILAGODI;
var failed = 0;
function bad(m) { failed++; console.log("NAPAKA " + m); }

// 1. vsaka sestavina iz receptov je v tabeli
var names = {};
R.jedi.forEach(function (r) { r[6].forEach(function (g) { names[g[0]] = 1; }); });
Object.keys(names).forEach(function (n) { if (!H.z[n]) bad("sestavine ni v hranila.json: " + n); });

// 2. nadomestek iz prilagodi.js je v tabeli ali pa »brez laktoze/glutena« (vzame izvirnik)
Object.keys(P.S).forEach(function (o) {
  P.S[o].forEach(function (s) { if (s[0] && !H.z[s[0]] && !/brez (laktoze|glutena)/.test(s[0])) bad("nadomestka ni v hranila.json: " + s[0] + " (za " + o + ")"); });
});

// 3. vsak recept da smiselne vrednosti na porcijo, vse sestavine so znane
function ings(r) { return r[6].map(function (g) { return [g[0], g[1], g[2], null]; }); }
R.jedi.forEach(function (r) {
  var x = N.forRecipe(H, r[1], ings(r)), v = x.v;
  if (x.miss) bad(r[1] + ": neznane sestavine");
  if (!(v[0] >= 40 && v[0] <= 1400)) bad(r[1] + ": " + Math.round(v[0]) + " kcal na porcijo");
  if (v.some(function (y) { return !(y >= 0) || !isFinite(y); })) bad(r[1] + ": neveljavna vrednost");
  // energija se ujema z makrohranili (4/4/9 kcal na g, alkohol in zaokroževanje dovolita odstopanje)
  var est = v[1] * 4 + v[2] * 4 + v[3] * 9;
  if (v[0] > 150 && Math.abs(est - v[0]) / v[0] > 0.2) bad(r[1] + ": kcal " + Math.round(v[0]) + " ≠ makrohranila " + Math.round(est));
  if (v[5] > 11) bad(r[1] + ": " + v[5].toFixed(1) + " g soli na porcijo");
});

// 4. znan recept: špageti aglio olio (400 g testenin, 6 žlic olja, 60 g parmezana za 4) ≈ 620 kcal
var ao = R.jedi.filter(function (r) { return r[1] === "Špageti aglio olio"; })[0];
var v = N.forRecipe(H, ao[1], ings(ao)).v;
if (v[0] < 550 || v[0] > 700) bad("aglio olio: " + Math.round(v[0]) + " kcal (pričakovano ≈ 620)");
if (v[1] < 18 || v[1] > 24) bad("aglio olio: " + v[1].toFixed(1) + " g beljakovin (pričakovano ≈ 21)");

// 5. prilagojen recept: nadomestek brez lastnih podatkov vzame vrednosti izvirnika, »po okusu« ne šteje
var a = N.perPortion(H, [["Moka brez glutena", 400, "g", "Moka bela"], ["Sol", null, "", null]], 4);
var b = N.perPortion(H, [["Moka bela", 400, "g", null]], 4);
if (a.miss || Math.abs(a.v[0] - b.v[0]) > 0.01) bad("nadomestek brez glutena naj vzame izvirnik");

// 6. cela potica ni deljena na 4
var pot = R.jedi.filter(function (r) { return r[1] === "Orehova potica"; })[0];
if (N.forRecipe(H, pot[1], ings(pot)).n !== 16) bad("orehova potica naj bo za 16 porcij");

if (failed) { console.log(failed + " napak"); process.exit(1); }
console.log("hranila ok: " + R.jedi.length + " receptov, " + Object.keys(H.z).length + " sestavin");
