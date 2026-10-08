// Zaznavanje prihoda v trgovino in odhoda iz nje. Enaka pravila kot StoreDetector.swift (iPhone v ozadju).
//
// Prihod: si do ~30 m od trgovine, GPS je dovolj natančen in ne voziš; tam ostaneš ~15 s.
//         Ena sama meritev ne zadošča (mimovožnja, semafor ob trgovini).
// Odhod:  vsaj 2–3 zanesljive zaporedne meritve dlje od ~45 m (histereza: nihanje GPS z 29 na 32 m
//         seje ne konča). Če si že daleč (npr. odpeljal si se), takoj.
// Nenatančne meritve (GPS v stavbi) ne štejejo ne za prihod ne za odhod: počakamo na boljšo.
(function (root) {
  "use strict";
  var DEFAULTS = {
    entry: 30,          // m: polmer prihoda
    exitExtra: 15,      // m: odhod šele dlje od entry + exitExtra (≈ 45 m)
    dwell: 15,          // s: toliko časa moraš biti pri trgovini
    entryAcc: 35,       // m: slabša natančnost ne šteje za prihod
    exitAcc: 50,        // m: slabša natančnost ne šteje za odhod
    maxSpeed: 2.5,      // m/s (~9 km/h): hitreje = voziš
    drove: 60,          // s: če si v zadnji minuti vozil (npr. stojiš na semaforu ob trgovini) …
    droveDwell: 40,     // s: … moraš pri trgovini ostati dlje
    exitReadings: 3,    // zaporednih meritev zunaj
    exitSpan: 5,        // s: med prvo in zadnjo meritvijo zunaj
    exitSlow: 15,       // s: po toliko času zadoščata 2 meritvi (stojiš zunaj, GPS se redko oglasi)
    far: 250,           // m: tako daleč = takoj odšel
    farAcc: 100,
    again: 60,          // s: po odhodu iste trgovine ne zaznamo znova tako hitro (nihanje na robu)
    itemsBonus: 15      // m: trgovina, za katero imaš izdelke, ima prednost pred sosednjo
  };

  function distM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function Detector(opts) {
    var p = {};
    Object.keys(DEFAULTS).forEach(function (k) { p[k] = opts && opts[k] != null ? opts[k] : DEFAULTS[k]; });
    this.p = p;
    this.pending = null;  // { id, since, hits }
    this.active = null;   // { id, lat, lon, since, outSince, outCount }
    this.leftAt = {};     // id -> čas odhoda
    this.fastAt = -1e9;   // zadnja meritev v vožnji
  }

  Detector.prototype.config = function (opts) {
    var p = this.p;
    Object.keys(opts || {}).forEach(function (k) { if (opts[k] != null && k in p) p[k] = opts[k]; });
  };

  Detector.prototype.exitRadius = function () { return this.p.entry + this.p.exitExtra; };

  // Ali je ta meritev zanesljivo pri trgovini s (razdalja d)?
  Detector.prototype.insideEntry = function (d, acc) {
    return d <= this.p.entry + Math.min(acc, 20) * 0.5;
  };

  // Seja se začne od zunaj (npr. ročno »V trgovini« ali prihod, ki ga je zaznal iPhone).
  Detector.prototype.start = function (store, now) {
    this.active = { id: store.id, lat: store.lat, lon: store.lon, since: now, outSince: 0, outCount: 0 };
    this.pending = null;
  };
  Detector.prototype.stop = function (now) {
    if (this.active) this.leftAt[this.active.id] = now;
    this.active = null;
    this.pending = null;
  };

  // fix: { lat, lon, acc (m, <0 = neznano), speed (m/s, <0 = neznano), time (s) }
  // stores: [{ id, lat, lon, hasItems }]
  // Vrne null ali { type: "arrived" | "left", id }.
  Detector.prototype.update = function (fix, stores) {
    var p = this.p, now = fix.time, acc = fix.acc == null || fix.acc < 0 ? 999 : fix.acc;
    var speed = fix.speed == null ? -1 : fix.speed;
    if (speed > p.maxSpeed && acc <= p.exitAcc) this.fastAt = now;

    // ---- Odhod (med sejo ne iščemo druge trgovine) ----
    var a = this.active;
    if (a) {
      // Ponovljena stara meritev (GPS se ne oglasi) za odhod ne šteje.
      if (a.lat == null || fix.repeat) return null;
      var d = distM(fix, a);
      if (d > p.far && acc <= p.farAcc) { this.stop(now); return { type: "left", id: a.id, distance: d }; }
      if (acc > p.exitAcc) return null;   // nenatančno: ne štejemo, ne ponastavimo
      if (d > this.exitRadius() + Math.min(acc, 30) * 0.3) {
        if (!a.outCount) a.outSince = now;
        a.outCount++;
        var span = now - a.outSince;
        if ((a.outCount >= p.exitReadings && span >= p.exitSpan) || (a.outCount >= 2 && span >= p.exitSlow)) {
          this.stop(now);
          return { type: "left", id: a.id, distance: d };
        }
      } else if (d <= this.exitRadius()) {
        a.outCount = 0; a.outSince = 0;   // še vedno v trgovini (GPS je le zanihal)
      }
      return null;
    }

    // ---- Prihod ----
    if (acc > p.entryAcc) return null;    // nenatančno: počakamo na boljšo meritev
    var self = this, best = null;
    (stores || []).forEach(function (s) {
      if (s.lat == null) return;
      var left = self.leftAt[s.id];
      if (left && now - left < p.again) return;
      var dd = distM(fix, s);
      if (!self.insideEntry(dd, acc)) return;
      var score = dd - (s.hasItems ? p.itemsBonus : 0) - (self.pending && self.pending.id === s.id ? 5 : 0);
      if (!best || score < best.score) best = { s: s, score: score, d: dd };
    });
    if (!best || (speed >= 0 && speed > p.maxSpeed)) { this.pending = null; return null; }
    if (!this.pending || this.pending.id !== best.s.id) {
      this.pending = { id: best.s.id, since: now, hits: 1 };
      return null;
    }
    this.pending.hits++;
    var need = now - this.fastAt < p.drove ? p.droveDwell : p.dwell;
    if (now - this.pending.since >= need && this.pending.hits >= 2) {
      var id = best.s.id;
      this.start(best.s, now);
      return { type: "arrived", id: id, distance: best.d };
    }
    return null;
  };

  // Koliko sekund še do prihoda (za odštevanje v aplikaciji), ali -1.
  Detector.prototype.remaining = function (now) {
    if (!this.pending) return -1;
    var need = now - this.fastAt < this.p.drove ? this.p.droveDwell : this.p.dwell;
    return Math.max(0, Math.ceil(need - (now - this.pending.since)));
  };

  var api = { Detector: Detector, DEFAULTS: DEFAULTS, distM: distM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NakupkoDetect = api;
})(typeof window !== "undefined" ? window : this);
