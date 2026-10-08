import Foundation

// Katere trgovine spremljamo in ali so odprte. Enaka pravila kot v app.js
// (storeKind, parseHours, isHoliday), da iPhone v ozadju ravna enako kot aplikacija.
enum StoreRules {
    private static let chains: [(String, String)] = [
        ("spar", "spar|interspar"),
        ("mercator", "mercator|hipermarket m|mere"),
        ("tus", "tu[sš]\\b|tus |tuš"),
        ("lidl", "lidl"),
        ("hofer", "hofer|aldi"),
        ("eurospin", "eurospin"),
        ("jager", "jager"),
        ("leclerc", "leclerc"),
        // Drogerije: v obvestilu samo izdelki zanje (kot only v app.js).
        ("dm", "^dm\\b|dm[ -]drogerie|dm drogerija"),
        ("muller", "m[uü]ller")
    ]
    // Specializirane trgovine prodajo samo te izdelke (enak regex kot only v app.js).
    static let only: [String: String] = [
        "dm": "^(higiena|gospodinjstvo|otroci|zdravje|brez glutena|ljubljenčki) |protein|pralni|detergent|mehčal",
        "muller": "^(higiena|gospodinjstvo|otroci|zdravje) |pralni|detergent|mehčal"
    ]
    private static let dutyPattern = "koren[cč]ek|betka|ekspres|de[zž]urn|non ?-?stop"
    private static let chainDefaultHours = "Mo-Sa 07:00-21:00; Su off; PH off"
    // Drogerije (dm, Müller) imajo krajši delovni čas kot živilske trgovine.
    private static let drugstoreDefaultHours = "Mo-Sa 08:00-20:00; Su off; PH off"
    static func defaultHours(_ chain: String?) -> String {
        guard let c = chain else { return "" }
        return (c == "dm" || c == "muller") ? drugstoreDefaultHours : chainDefaultHours
    }
    private static let dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    // Vrne (chain, duty) ali nil, če trgovine ne spremljamo.
    static func kind(text: String, hours: String) -> (chain: String?, duty: Bool)? {
        for (key, pattern) in chains where matches(text, pattern) { return (key, false) }
        if matches(text, dutyPattern) || hours.contains("24/7") { return (nil, true) }
        return nil
    }

    // MARK: Prazniki (trgovine so po zakonu zaprte)
    private static func easter(_ y: Int) -> DateComponents {
        let a = y % 19, b = y / 100, c = y % 100, d = b / 4, e = b % 4, f = (b + 8) / 25
        let g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451
        return DateComponents(year: y, month: (h + l - 7 * m + 114) / 31, day: ((h + l - 7 * m + 114) % 31) + 1)
    }

    static func isHoliday(_ date: Date, calendar cal: Calendar = .current) -> Bool {
        let c = cal.dateComponents([.year, .month, .day], from: date)
        let md = "\(c.month!)-\(c.day!)"
        if ["1-1", "1-2", "2-8", "4-27", "5-1", "5-2", "6-25", "8-15", "10-31", "11-1", "12-25", "12-26"].contains(md) { return true }
        guard let e = cal.date(from: easter(c.year!)), let monday = cal.date(byAdding: .day, value: 1, to: e) else { return false }
        return cal.isDate(monday, inSameDayAs: date)
    }

    // MARK: OSM opening_hours, npr. "Mo-Sa 07:00-21:00; Su off; PH off"
    struct Hours {
        var always = false
        var days: [Int: [(Int, Int)]] = [:]
        var ph: [(Int, Int)]?
    }

    static func parse(_ input: String) -> Hours? {
        let str = input.trimmingCharacters(in: .whitespaces)
        if str.isEmpty { return nil }
        if str == "24/7" { return Hours(always: true) }
        let day = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?"
        // Vejica pred novim naborom dni loči pravila ("Mo-Fr 07:00-20:00, Sa 07:00-13:00").
        let normalized = str.replacingOccurrences(of: "\\s*,\\s*(?=\(day)\\s+(?:\\d|off|closed))", with: ";", options: .regularExpression)
        let raw = normalized.components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        var rules: [String] = []
        var carry: String?
        for (q, part) in raw.enumerated() {
            let piece = carry.map { $0 + "," + part } ?? part
            carry = nil
            if q + 1 < raw.count && piece.range(of: "^(?:\(day)\\s*,?\\s*)+$", options: .regularExpression) != nil { carry = piece }
            else { rules.append(piece) }
        }
        var h = Hours()
        var ok = false
        let ruleRe = try! NSRegularExpression(pattern: "^((?:\(day)\\s*,?\\s*)+)\\s*(.*)$")
        for rule in rules {
            let ns = rule as NSString
            var sel: String, times: String
            if let m = ruleRe.firstMatch(in: rule, range: NSRange(location: 0, length: ns.length)) {
                sel = ns.substring(with: m.range(at: 1))
                times = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespaces)
            } else if rule.first?.isNumber == true {
                sel = "Mo-Su"; times = rule
            } else { continue }
            var spans: [(Int, Int)] = []
            if !["off", "closed"].contains(times.lowercased()) {
                var valid = true
                for p in times.components(separatedBy: ",") {
                    let t = p.trimmingCharacters(in: .whitespaces)
                    let nums = t.components(separatedBy: CharacterSet(charactersIn: ":- ")).filter { !$0.isEmpty }.compactMap { Int($0) }
                    guard nums.count == 4, t.range(of: "^\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}$", options: .regularExpression) != nil else { valid = false; break }
                    spans.append((nums[0] * 60 + nums[1], nums[2] * 60 + nums[3]))
                }
                if !valid { continue }
            }
            ok = true
            for tokRaw in sel.components(separatedBy: ",") {
                let tok = tokRaw.trimmingCharacters(in: .whitespaces)
                if tok.isEmpty { continue }
                if tok == "PH" { h.ph = spans; continue }
                let ab = tok.components(separatedBy: "-")
                guard let a = dayNames.firstIndex(of: ab[0]) else { continue }
                let b = ab.count > 1 ? (dayNames.firstIndex(of: ab[1]) ?? -1) : a
                if b < 0 { continue }
                var d = a
                for _ in 0..<7 { h.days[d] = spans; if d == b { break }; d = (d + 1) % 7 }
            }
        }
        return ok ? h : nil
    }

    // true = odprto, false = zaprto, nil = urnik ni znan (takrat raje obvestimo).
    static func isOpen(hours: String?, chain: String?, at now: Date = Date(), calendar cal: Calendar = .current) -> Bool? {
        let src = (hours ?? "").isEmpty ? defaultHours(chain) : hours!
        guard let h = parse(src) else { return nil }
        if h.always { return true }
        let holiday = isHoliday(now, calendar: cal)
        let dow = cal.component(.weekday, from: now) - 1
        let spans: [(Int, Int)]
        if holiday, let ph = h.ph { spans = ph }
        else if holiday && chain != nil { spans = [] }
        else { spans = h.days[dow] ?? [] }
        let c = cal.dateComponents([.hour, .minute], from: now)
        let mins = c.hour! * 60 + c.minute!
        return spans.contains { a, b in mins >= a && mins < (b <= a ? b + 1440 : b) }
    }
}
