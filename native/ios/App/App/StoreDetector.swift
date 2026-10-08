import Foundation

// Zaznavanje prihoda v trgovino in odhoda iz nje. Enaka pravila kot store-detect.js v aplikaciji.
//
// Prihod: si do ~30 m od trgovine, GPS je dovolj natančen in ne voziš; tam ostaneš ~15 s.
//         Ena sama meritev ne zadošča (mimovožnja, semafor ob trgovini).
// Odhod:  vsaj 2–3 zanesljive zaporedne meritve dlje od ~45 m (histereza: nihanje GPS z 29 na 32 m
//         seje ne konča). Če si že daleč (npr. odpeljal si se), takoj.
// Nenatančne meritve (GPS v stavbi) ne štejejo ne za prihod ne za odhod: počakamo na boljšo.
// Brez CoreLocation, da ga lahko preizkusimo na GitHubu (native/tests/main.swift).
struct DetectFix {
    var lat: Double
    var lon: Double
    var acc: Double      // m, < 0 = neznano
    var speed: Double    // m/s, < 0 = neznano
    var time: Double     // s
}

struct DetectStore {
    var id: String
    var lat: Double
    var lon: Double
    var hasItems: Bool
}

enum DetectEvent: Equatable {
    case arrived(String)
    case left(String)
}

struct StoreDetector {
    var entry: Double = 30        // m: polmer prihoda
    var exitExtra: Double = 15    // m: odhod šele dlje od entry + exitExtra (≈ 45 m)
    var dwell: Double = 15        // s: toliko časa moraš biti pri trgovini
    var entryAcc: Double = 35     // m: slabša natančnost ne šteje za prihod
    var exitAcc: Double = 50      // m: slabša natančnost ne šteje za odhod
    var maxSpeed: Double = 2.5    // m/s (~9 km/h): hitreje = voziš
    var drove: Double = 60        // s: če si v zadnji minuti vozil (npr. semafor ob trgovini) …
    var droveDwell: Double = 40   // s: … moraš pri trgovini ostati dlje
    var exitReadings = 3          // zaporednih meritev zunaj
    var exitSpan: Double = 5      // s: med prvo in zadnjo meritvijo zunaj
    var exitSlow: Double = 15     // s: po toliko času zadoščata 2 meritvi
    var far: Double = 250         // m: tako daleč = takoj odšel
    var farAcc: Double = 100
    var again: Double = 60        // s: po odhodu iste trgovine ne zaznamo znova tako hitro
    var itemsBonus: Double = 15   // m: trgovina z izdelki ima prednost pred sosednjo

    struct Pending: Codable { var id: String; var since: Double; var hits: Int }
    struct Active: Codable { var id: String; var lat: Double; var lon: Double; var since: Double; var outSince: Double = 0; var outCount = 0 }
    private(set) var pending: Pending?
    private(set) var active: Active?
    private var leftAt: [String: Double] = [:]
    private var fastAt: Double = -1e9

    var exitRadius: Double { entry + exitExtra }

    static func distance(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        let r = 6_371_000.0, toR = Double.pi / 180
        let dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR
        let x = sin(dLat / 2) * sin(dLat / 2) + cos(aLat * toR) * cos(bLat * toR) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1, sqrt(x)))
    }

    private func insideEntry(_ d: Double, _ acc: Double) -> Bool { d <= entry + min(acc, 20) * 0.5 }

    // Seja se začne od zunaj (ročno »V trgovini« v aplikaciji ali obnovljena seja).
    mutating func start(id: String, lat: Double, lon: Double, now: Double) {
        active = Active(id: id, lat: lat, lon: lon, since: now)
        pending = nil
    }

    mutating func stop(now: Double) {
        if let a = active { leftAt[a.id] = now }
        active = nil
        pending = nil
    }

    mutating func restore(_ a: Active?) { active = a; pending = nil }

    mutating func update(_ fix: DetectFix, stores: [DetectStore]) -> DetectEvent? {
        let now = fix.time
        let acc = fix.acc < 0 ? 999 : fix.acc
        if fix.speed > maxSpeed && acc <= exitAcc { fastAt = now }

        // ---- Odhod (med sejo ne iščemo druge trgovine) ----
        if var a = active {
            let d = Self.distance(fix.lat, fix.lon, a.lat, a.lon)
            if d > far && acc <= farAcc { stop(now: now); return .left(a.id) }
            if acc > exitAcc { return nil }   // nenatančno: ne štejemo, ne ponastavimo
            if d > exitRadius + min(acc, 30) * 0.3 {
                if a.outCount == 0 { a.outSince = now }
                a.outCount += 1
                let span = now - a.outSince
                if (a.outCount >= exitReadings && span >= exitSpan) || (a.outCount >= 2 && span >= exitSlow) {
                    stop(now: now)
                    return .left(a.id)
                }
            } else if d <= exitRadius {
                a.outCount = 0; a.outSince = 0   // še vedno v trgovini (GPS je le zanihal)
            }
            active = a
            return nil
        }

        // ---- Prihod ----
        if acc > entryAcc { return nil }       // nenatančno: počakamo na boljšo meritev
        var best: (s: DetectStore, score: Double)?
        for s in stores {
            if let l = leftAt[s.id], now - l < again { continue }
            let d = Self.distance(fix.lat, fix.lon, s.lat, s.lon)
            guard insideEntry(d, acc) else { continue }
            let score = d - (s.hasItems ? itemsBonus : 0) - (pending?.id == s.id ? 5 : 0)
            if best == nil || score < best!.score { best = (s, score) }
        }
        guard let b = best, !(fix.speed >= 0 && fix.speed > maxSpeed) else { pending = nil; return nil }
        guard var p = pending, p.id == b.s.id else {
            pending = Pending(id: b.s.id, since: now, hits: 1)
            return nil
        }
        p.hits += 1
        pending = p
        let need = now - fastAt < drove ? droveDwell : dwell
        if now - p.since >= need && p.hits >= 2 {
            start(id: b.s.id, lat: b.s.lat, lon: b.s.lon, now: now)
            return .arrived(b.s.id)
        }
        return nil
    }
}
