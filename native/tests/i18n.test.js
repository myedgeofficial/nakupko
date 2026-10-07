// Preverba prevodov (i18n/xx.js): vsak jezik ima vsa besedila in vsa pravila kot angleščina.
// node native/tests/i18n.test.js
"use strict";
var fs = require("fs"), path = require("path");
var dir = path.join(__dirname, "..", "..", "i18n");
var packs = {};
global.NK_PACK = function (lang, make) { packs[lang] = make({ tr: function (s) { return s; }, word: function (s) { return s; } }); };
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) { require(path.join(dir, f)); });
var failed = 0;
function bad(m) { failed++; console.log("NAPAKA " + m); }
var en = packs.en;
if (!en) { console.log("NAPAKA ni i18n/en.js"); process.exit(1); }
var keys = Object.keys(en.exact);
// i18n.js: vsak jezik v PACKS (razen sl) mora imeti datoteko.
var engine = fs.readFileSync(path.join(dir, "..", "i18n.js"), "utf8");
var listed = JSON.parse(engine.match(/var PACKS = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":'));
Object.keys(listed).forEach(function (l) { if (l !== "sl" && !packs[l]) bad("jezik " + l + " je v PACKS, a ni i18n/" + l + ".js"); });
Object.keys(packs).forEach(function (l) {
  var p = packs[l];
  if (!listed[l]) bad(l + ": ni v PACKS v i18n.js");
  keys.forEach(function (k) { if (!p.exact[k]) bad(l + ": manjka »" + k + "«"); });
  Object.keys(p.exact).forEach(function (k) { if (!(k in en.exact)) bad(l + ": odvečen ključ »" + k + "« (ni v en.js)"); });
  if (p.rules.length !== en.rules.length) bad(l + ": pravil " + p.rules.length + ", v en.js " + en.rules.length);
  p.rules.forEach(function (r, i) { if (en.rules[i] && String(r[0]) !== String(en.rules[i][0])) bad(l + ": pravilo " + i + " ima drug vzorec kot en.js: " + r[0]); });
});
if (failed) { console.log(failed + " napak"); process.exit(1); }
console.log("prevodi ok: " + Object.keys(packs).sort().join(", ") + " (" + keys.length + " besedil, " + en.rules.length + " pravil)");
