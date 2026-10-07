// Nakupko deluje tudi brez povezave. Ob novi verziji povečaj številko.
var CACHE = "nakupko-v5-30";
var FILES = ["./", "index.html", "style.css", "app.js", "household.js", "aktivni.js", "products.js", "products-extra.js", "icon-rules.js", "prices.js", "products-i18n.js", "i18n.js", "store-detect.js", "drzave.js", "i18n/en.js", "i18n/de.js", "i18n/hr.js", "i18n/it.js", "i18n/hu.js", "i18n/fr.js", "i18n/es.js", "i18n/products-de.js", "i18n/products-hr.js", "i18n/products-it.js", "i18n/products-hu.js", "i18n/products-fr.js", "i18n/products-es.js", "manifest.webmanifest", "icon.svg", "icon-full.svg", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Najprej splet (da je vedno najnovejša verzija), brez povezave iz predpomnilnika.
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
