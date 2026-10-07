import Foundation

// Preizkus pravil trgovin (StoreRules.swift). Teče na GitHubu: swiftc ... && ./storerules
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "Europe/Ljubljana")!
func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int) -> Date {
    cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
}
var failed = 0
func check<T: Equatable>(_ name: String, _ got: T, _ want: T) {
    if got != want { failed += 1; print("NAPAKA \(name): dobil \(got), pričakoval \(want)") } else { print("ok  \(name)") }
}
func open(_ hours: String?, _ chain: String?, _ d: Date) -> String {
    switch StoreRules.isOpen(hours: hours, chain: chain, at: d, calendar: cal) {
    case .some(true): return "odprto"
    case .some(false): return "zaprto"
    case .none: return "neznano"
    }
}

check("Spar je veriga", StoreRules.kind(text: "Spar Spar", hours: "")?.chain, "spar")
check("Tuš je veriga", StoreRules.kind(text: "Tuš market", hours: "")?.chain, "tus")
check("Korenček je dežurna", StoreRules.kind(text: "Korenček", hours: "")?.duty, true)
check("24/7 je dežurna", StoreRules.kind(text: "Market", hours: "24/7")?.duty, true)
check("dm je drogerija", StoreRules.kind(text: "dm dm drogerie markt", hours: "")?.chain, "dm")
check("Admiral ni dm", StoreRules.kind(text: "Admiral", hours: "") == nil, true)
check("Druga trgovina se ne spremlja", StoreRules.kind(text: "Indijska trgovina", hours: "") == nil, true)

// 5. 10. 2026 je ponedeljek, 4. 10. nedelja, 10. 10. sobota.
check("Spar brez urnika ob 6:00", open(nil, "spar", at(2026, 10, 5, 6, 0)), "zaprto")
check("Spar brez urnika ob 8:00", open("", "spar", at(2026, 10, 5, 8, 0)), "odprto")
check("Odpre ob 7:30, ura 7:00", open("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 7, 0)), "zaprto")
check("Odpre ob 7:30, ura 7:30", open("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 7, 30)), "odprto")
check("Veriga v nedeljo", open(nil, "hofer", at(2026, 10, 4, 10, 0)), "zaprto")
check("Božič", open("Mo-Sa 07:00-21:00", "lidl", at(2026, 12, 25, 10, 0)), "zaprto")
check("Velikonočni ponedeljek 2026", open("Mo-Sa 07:00-21:00", "lidl", at(2026, 4, 6, 10, 0)), "zaprto")
check("Dežurna 24/7 ponoči", open("24/7", nil, at(2026, 10, 5, 3, 0)), "odprto")
check("Neznan urnik", open("", nil, at(2026, 10, 5, 3, 0)), "neznano")
check("Sobota po 13h", open("Mo-Fr 07:00-20:00, Sa 07:00-13:00", "tus", at(2026, 10, 10, 14, 0)), "zaprto")
check("Sobota ob 12h", open("Mo-Fr 07:00-20:00, Sa 07:00-13:00", "tus", at(2026, 10, 10, 12, 0)), "odprto")
check("Nedelja dopoldne", open("Mo-Fr 07:00-20:00; Sa,Su 08:00-12:00", nil, at(2026, 10, 4, 9, 0)), "odprto")
check("Praznik z urnikom PH", open("Mo-Su 06:00-22:00; PH 08:00-12:00", nil, at(2026, 11, 1, 13, 0)), "zaprto")

// ---------- Zaznavanje trgovine (StoreDetector.swift); isti primeri kot store-detect.test.js ----------
let LAT0 = 46.05, LON0 = 14.5
func pt(_ x: Double, _ y: Double) -> (Double, Double) { (LAT0 + y / 111320, LON0 + x / (111320 * cos(LAT0 * .pi / 180))) }
func store(_ id: String, _ x: Double, _ y: Double, items: Bool = true) -> DetectStore { let p = pt(x, y); return DetectStore(id: id, lat: p.0, lon: p.1, hasItems: items) }
// Meritev vsako sekundo: (x, y, natančnost, hitrost, sekund) ali hoja od x0 do x1.
enum Seg { case stay(Double, Double, Double, Double, Int); case walk(Double, Double, Double, Double, Double) }
func run(_ d: inout StoreDetector, _ segs: [Seg], _ stores: [DetectStore], t0: Double = 0) -> (ev: [String], t: Double) {
    var t = t0, ev: [String] = []
    func feed(_ x: Double, _ y: Double, _ acc: Double, _ sp: Double) {
        let p = pt(x, y)
        if let e = d.update(DetectFix(lat: p.0, lon: p.1, acc: acc, speed: sp, time: t), stores: stores) {
            switch e { case .arrived(let id): ev.append("arrived:\(id)@\(Int(t))"); case .left(let id): ev.append("left:\(id)@\(Int(t))") }
        }
        t += 1
    }
    for s in segs {
        switch s {
        case let .stay(x, y, acc, sp, n): for _ in 0..<n { feed(x, y, acc, sp) }
        case let .walk(x0, x1, y, acc, sp):
            let n = max(1, Int((abs(x1 - x0) / sp).rounded()))
            for i in 0..<n { feed(x0 + (x1 - x0) * Double(i) / Double(n), y, acc, sp) }
        }
    }
    return (ev, t)
}
func names(_ ev: [String]) -> String { ev.map { String($0.split(separator: "@")[0]) }.joined(separator: ",") }
func when(_ ev: [String], _ prefix: String) -> Int { ev.first { $0.hasPrefix(prefix) }.map { Int($0.split(separator: "@")[1])! } ?? -1 }
let spar = store("spar", 0, 0), dmS = store("dm", 200, 0)

var det = StoreDetector()
var r = run(&det, [.walk(-120, -10, 0, 8, 1.3), .stay(-10, 0, 10, 0.3, 30)], [spar])
check("peš: prihod v Spar", names(r.ev), "arrived:spar")
check("peš: po 15–25 s znotraj", (14...25).contains(when(r.ev, "arrived") - 66), true)
det = StoreDetector(); r = run(&det, [.walk(-500, 500, 5, 6, 14)], [spar])
check("mimovožnja: brez prihoda", r.ev.count, 0)
det = StoreDetector(); r = run(&det, [.walk(-400, 0, 25, 6, 14), .stay(0, 25, 6, 0, 35), .walk(0, 400, 25, 6, 14)], [spar])
check("semafor 35 s: brez prihoda", r.ev.count, 0)
det = StoreDetector(); r = run(&det, [.walk(-400, -40, 0, 6, 14), .stay(-40, 0, 8, 0, 20), .walk(-40, -5, 0, 10, 1.2), .stay(-5, 0, 12, 0, 60)], [spar])
check("parkiraš in vstopiš: prihod", names(r.ev), "arrived:spar")
det = StoreDetector(); r = run(&det, [.stay(5, 0, 60, -1, 40)], [spar])
check("slab GPS: brez prihoda", r.ev.count, 0)
r = run(&det, [.stay(5, 0, 15, -1, 20)], [spar], t0: r.t)
check("boljši GPS: prihod po 15 s", when(r.ev, "arrived") - 40 >= 15, true)
det = StoreDetector(); det.start(id: "spar", lat: spar.lat, lon: spar.lon, now: 0)
r = run(&det, [.stay(29, 0, 12, 0, 5), .stay(32, 0, 12, 0, 5), .stay(55, 0, 25, 0, 1), .stay(20, 0, 12, 0, 5), .stay(33, 0, 15, 0, 10), .stay(60, 0, 80, 0, 10)], [spar], t0: 1)
check("nihanje GPS: brez odhoda", r.ev.count, 0)
det = StoreDetector(); det.start(id: "spar", lat: spar.lat, lon: spar.lon, now: 0)
r = run(&det, [.stay(10, 0, 10, 0, 10), .walk(10, 150, 0, 10, 1.4)], [spar], t0: 1)
check("odhod peš: v 20 s po 45 m", (0...20).contains(when(r.ev, "left") - (11 + 27)), true)
det = StoreDetector(); det.start(id: "spar", lat: spar.lat, lon: spar.lon, now: 0)
r = run(&det, [.stay(10, 0, 10, 0, 3), .stay(300, 0, 40, 15, 1)], [spar], t0: 1)
check("daleč: takoj odhod", when(r.ev, "left"), 4)
det = StoreDetector(); r = run(&det, [.stay(0, 0, 10, 0, 20), .walk(0, 195, 0, 10, 1.4), .stay(195, 0, 10, 0, 25)], [spar, dmS])
check("Spar → dm", names(r.ev), "arrived:spar,left:spar,arrived:dm")
let sa = store("a", 0, 0, items: false), sb = store("b", 35, 0)
det = StoreDetector(); r = run(&det, [.stay(15, 0, 8, 0, 25)], [sa, sb])
check("sosednji trgovini: tista z izdelki", names(r.ev), "arrived:b")
det = StoreDetector(); det.start(id: "spar", lat: spar.lat, lon: spar.lon, now: 0); det.stop(now: 10)
r = run(&det, [.stay(5, 0, 10, 0, 30)], [spar], t0: 11)
check("takoj nazaj: brez ponovnega prihoda", r.ev.count, 0)

if failed > 0 { print("\(failed) napak"); exit(1) }
print("Vsa pravila trgovin delujejo.")
