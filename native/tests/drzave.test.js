// Preverba baze držav (drzave.js) pred objavo: node native/tests/drzave.test.js
// Aplikacija bazo prebere enako (JSON med prvim »{« po »=« in zadnjim »}«), zato mora biti veljaven JSON.
"use strict";
var fs = require("fs"), path = require("path");
var src = fs.readFileSync(path.join(__dirname, "..", "..", "drzave.js"), "utf8");
var failed = 0;
function bad(msg) { failed++; console.log("NAPAKA " + msg); }
var data;
try { data = JSON.parse(src.slice(src.indexOf("{", src.indexOf("=")), src.lastIndexOf("}") + 1)); }
catch (e) { console.log("NAPAKA drzave.js ni veljaven JSON: " + e.message); process.exit(1); }
var TOBAK = ["trafika", "kiosk", "bencinska", "trgovina"];
var CENE = { si: 1, at: 1, hr: 1, hu: 1 };   // viri, ki jih že bere scripts/update-prices*.{mjs,py}
if (!/^\d{4}-\d\d-\d\d$/.test(data.verzija || "")) bad("verzija mora biti datum");
var p = data.privzeto || {};
if (!/^[a-z]{2}$/.test(p.jezik || "")) bad("privzeto.jezik");
var n = 0;
Object.keys(data.drzave || {}).forEach(function (k) {
  n++;
  var d = Object.assign({}, p, data.drzave[k]);
  if (!/^[A-Z]{2}$/.test(k)) bad(k + ": koda države mora biti ISO 3166-1 alfa-2");
  if (!d.ime) bad(k + ": manjka ime");
  if (!/^[a-z]{2,3}$/.test(d.jezik || "")) bad(k + ": jezik");
  if (d.cene !== null && !CENE[d.cene]) bad(k + ": neznan vir cen " + d.cene);
  if (!Array.isArray(d.tobak) || !d.tobak.length || d.tobak.some(function (t) { return TOBAK.indexOf(t) < 0; })) bad(k + ": tobak");
  if (["zaprto", "odprto"].indexOf(d.nedelja) < 0) bad(k + ": nedelja");
});
if (n < 170) bad("premalo držav (" + n + "), App Store jih ima ~175");
if (!data.drzave.SI || data.drzave.SI.jezik !== "sl") bad("SI mora biti v slovenščini");
if (failed) { console.log(failed + " napak"); process.exit(1); }
console.log("drzave.js ok (" + n + " držav)");
