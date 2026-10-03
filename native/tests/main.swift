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

if failed > 0 { print("\(failed) napak"); exit(1) }
print("Vsa pravila trgovin delujejo.")
