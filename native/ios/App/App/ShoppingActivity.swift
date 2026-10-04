import Foundation
import ActivityKit
import AppIntents

// Skupno za aplikacijo in pripomoček na zaklenjenem zaslonu (Live Activity).
struct ItemGroup: Codable, Hashable {
    var icon: String
    var name: String
    var items: [String]
}

// Izdelek na zaklenjenem zaslonu: id je isti kot v aplikaciji (in skupnem seznamu).
struct LiveItem: Codable, Hashable {
    var id: String
    var label: String
    var icon: String
    var cat: String? = nil   // samo za izbiro izdelkov po trgovini; na zaklenjeni zaslon ne gre
}

struct ShoppingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var items: [LiveItem]
        var done: Int
        var total: Int
        var page: Int? = nil   // stran izdelkov (gumb »Naprej ›«)
    }
    var store: String
}

// Odkljukanje z zaklenjenega zaslona. Teče v aplikaciji (tudi ko je zaprta), brez odpiranja.
enum LiveList {
    static let defaults = UserDefaults.standard
    static let maxItems = 30
    static let perPage = 4

    // Isti dnevnik kot GeoManager.log (Nastavitve → razvijalski način).
    static func log(_ text: String) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        var l = defaults.stringArray(forKey: "geo.log") ?? []
        l.append(f.string(from: Date()) + " " + text)
        defaults.set(Array(l.suffix(30)), forKey: "geo.log")
    }

    // Stran, ki še obstaja (po odkljukanju se seznam skrajša).
    static func clampPage(_ page: Int?, count: Int) -> Int {
        let p = page ?? 0
        return p * perPage < count ? p : 0
    }

    // Live Activity sprejme največ 4 KB: omejimo število in dolžino imen.
    static func fit(_ list: [LiveItem]) -> [LiveItem] {
        list.prefix(maxItems).map { i in
            LiveItem(id: i.id, label: i.label.count > 34 ? String(i.label.prefix(33)) + "…" : i.label, icon: i.icon, cat: nil)
        }
    }

    static func markDone(_ id: String) async {
        log("kljukica: \(id) (seznamov: \(Activity<ShoppingAttributes>.activities.count))")
        let now = Date().timeIntervalSince1970 * 1000
        // Aplikacija to prebere ob naslednjem odprtju (native.js → takeDone).
        var pending = defaults.dictionary(forKey: "live.done") as? [String: Double] ?? [:]
        pending[id] = now
        defaults.set(pending, forKey: "live.done")
        // Odprti izdelki za obvestila ob prihodu v trgovino.
        if let data = defaults.data(forKey: "geo.items"), var open = try? JSONDecoder().decode([LiveItem].self, from: data) {
            open.removeAll { $0.id == id }
            defaults.set(try? JSONEncoder().encode(open), forKey: "geo.items")
        }
        for a in Activity<ShoppingAttributes>.activities {
            var s = a.content.state
            guard let idx = s.items.firstIndex(where: { $0.id == id }) else { continue }
            s.items.remove(at: idx)
            s.done += 1
            s.page = clampPage(s.page, count: s.items.count)
            await a.update(ActivityContent(state: s, staleDate: Date().addingTimeInterval(4 * 3600)))
        }
        // Skupen seznam: odkljukano vidijo tudi ostali člani.
        if let u = defaults.string(forKey: "geo.hh.url"), let c = defaults.string(forKey: "geo.hh.code"),
           !u.isEmpty, !c.isEmpty, let url = URL(string: "\(u)/h/\(c)/items/\(id).json") {
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.timeoutInterval = 8
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["done": true, "doneAt": Int(now)])
            _ = try? await URLSession.shared.data(for: req)
        }
    }
}

// »Naprej ›«: naslednji 4 izdelki; po zadnji strani spet na začetek.
struct NextPageIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Naslednji izdelki"
    static var isDiscoverable: Bool = false
    // Brez Face ID: tap deluje tudi na zaklenjenem telefonu.
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    init() {}

    func perform() async throws -> some IntentResult {
        LiveList.log("naprej (seznamov: \(Activity<ShoppingAttributes>.activities.count))")
        for a in Activity<ShoppingAttributes>.activities {
            var s = a.content.state
            let next = (s.page ?? 0) + 1
            s.page = next * LiveList.perPage < s.items.count ? next : 0
            LiveList.log("  stran \(s.page ?? 0), izdelkov \(s.items.count)")
            await a.update(ActivityContent(state: s, staleDate: Date().addingTimeInterval(4 * 3600)))
        }
        return .result()
    }
}

struct CheckItemIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Odkljukaj izdelek"
    static var isDiscoverable: Bool = false
    // Brez Face ID: tap deluje tudi na zaklenjenem telefonu.
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Izdelek")
    var itemId: String

    init() {}
    init(itemId: String) { self.itemId = itemId }

    func perform() async throws -> some IntentResult {
        await LiveList.markDone(itemId)
        return .result()
    }
}
