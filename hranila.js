// Okvirne prehranske vrednosti recepta na porcijo: iz sestavin in količin (za 4 osebe) ter tabele hranila.json
// (USDA FoodData Central, nastane s scripts/hranila.py). Vse se izračuna v napravi, brez klicev na splet.
// Vrne [kcal, beljakovine, ogljikovi hidrati, maščobe, vlaknine, sol] na porcijo; sestavine »po okusu« ne štejejo.
(function (root) {
  "use strict";
  // teža sestavine v gramih; null = sestavine ni v tabeli
  function grams(H, name, q, u) {
    var z = H.z[name]; if (!z) return null;
    if (!q) return 0;
    var en = z[6] || {}, g = en[u] != null ? en[u] : H.enote[u];
    return q * (g == null ? H.enote.kos : g);
  }
  // ings: [ime, količina za 4, enota, prvotno ime ali null] (kot recepti.js po prilagoditvi)
  function perPortion(H, ings, persons) {
    var t = [0, 0, 0, 0, 0, 0], miss = 0;
    (ings || []).forEach(function (g) {
      var name = H.z[g[0]] ? g[0] : g[3] && H.z[g[3]] ? g[3] : null; // nadomestek brez lastnih podatkov: kot izvirnik
      var w = name ? grams(H, name, g[1], g[2]) : null;
      if (w == null) { miss++; return; }
      var z = H.z[name];
      for (var i = 0; i < 6; i++) t[i] += z[i] * w / 100;
    });
    var n = persons || 4;
    return { v: t.map(function (x) { return x / n; }), miss: miss };
  }
  // recept: količine so za 4 osebe; cela pečena jed (potica, torta …) ima svoje število porcij, če bi bila četrtina prevelika
  function forRecipe(H, name, ings) {
    var all = perPortion(H, ings, 1), p = H.porcije && H.porcije[name], n = p && all.v[0] / 4 > 600 ? p : 4;
    return { v: all.v.map(function (x) { return x / n; }), n: n, miss: all.miss };
  }
  var api = { perPortion: perPortion, forRecipe: forRecipe, grams: grams };
  root.NK_HRANILA = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
