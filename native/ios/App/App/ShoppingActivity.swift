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
    var shop: String? = nil  // trgovina, ki ji je izdelek dodeljen (veriga, npr. »dm«); na zaklenjeni zaslon ne gre
}

struct ShoppingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var items: [LiveItem]
        var done: Int
        var total: Int
        var page: Int? = nil   // stran izdelkov (gumb »Naprej ›«)
        var lang: String? = nil  // jezik besedil na zaklenjenem zaslonu (iz aplikacije)
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

// Besedila, ki jih pokaže iPhone sam (obvestila, seznam na zaklenjenem zaslonu), v jeziku aplikacije.
// Jezik pošlje aplikacija (native.js → setConfig, geo.lang); na zaklenjenem zaslonu ga nosi ContentState.lang.
enum L10n {
    static var lang: String { UserDefaults.standard.string(forKey: "geo.lang") ?? "sl" }

    private static let table: [String: [String: String]] = [
        "near": ["sl": "🛒 %@ je blizu", "en": "🛒 %@ is nearby", "de": "🛒 %@ ist in der Nähe", "hr": "🛒 %@ je blizu", "it": "🛒 %@ è vicino", "hu": "🛒 %@ a közelben", "fr": "🛒 %@ est tout près", "es": "🛒 %@ está cerca"],
        "nearBody": ["sl": "Na seznamu imaš %@. Se ustaviš?", "en": "You have %@ on your list. Stopping by?", "de": "Du hast %@ auf der Liste. Kurz vorbeischauen?", "hr": "Na popisu imaš %@. Svratit ćeš?", "it": "Hai %@ nella lista. Ti fermi?", "hu": "%@ van a listádon. Beugrasz?", "fr": "Tu as %@ sur ta liste. Tu t'arrêtes ?", "es": "Tienes %@ en tu lista. ¿Pasas?"],
        "cheaper": ["sl": "%@ (%@ od tu) je za tvoj seznam ≈ %@ cenejši.", "en": "%@ (%@ from here) is ≈ %@ cheaper for your list.", "de": "%@ (%@ entfernt) ist für deine Liste ≈ %@ günstiger.", "hr": "%@ (%@ odavde) je za tvoj popis ≈ %@ jeftiniji.", "it": "%@ (a %@ da qui) costa ≈ %@ in meno per la tua lista.", "hu": "%@ (%@ innen) ≈ %@-val olcsóbb a listádra.", "fr": "%@ (à %@ d'ici) est ≈ %@ moins cher pour ta liste.", "es": "%@ (a %@ de aquí) es ≈ %@ más barato para tu lista."],
        "denied": ["sl": "Dostop do lokacije je zavrnjen.", "en": "Location access denied.", "de": "Standortzugriff verweigert.", "hr": "Pristup lokaciji je odbijen.", "it": "Accesso alla posizione negato.", "hu": "Helyhozzáférés megtagadva.", "fr": "Accès à la position refusé.", "es": "Acceso a la ubicación denegado."],
        "allDone": ["sl": "Vse v košarici ✓", "en": "All in the basket ✓", "de": "Alles im Korb ✓", "hr": "Sve u košarici ✓", "it": "Tutto nel carrello ✓", "hu": "Minden a kosárban ✓", "fr": "Tout est dans le panier ✓", "es": "Todo en la cesta ✓"],
        "openList": ["sl": "Odpri seznam", "en": "Open list", "de": "Liste öffnen", "hr": "Otvori popis", "it": "Apri lista", "hu": "Lista megnyitása", "fr": "Ouvrir la liste", "es": "Abrir lista"],
        "next": ["sl": "Naprej ›", "en": "Next ›", "de": "Weiter ›", "hr": "Dalje ›", "it": "Avanti ›", "hu": "Tovább ›", "fr": "Suite ›", "es": "Siguiente ›"],
        "restart": ["sl": "Na začetek ↺", "en": "Back to start ↺", "de": "Zum Anfang ↺", "hr": "Na početak ↺", "it": "All'inizio ↺", "hu": "Az elejére ↺", "fr": "Au début ↺", "es": "Al inicio ↺"],
        "range": ["sl": "%@–%@ od %@", "en": "%@–%@ of %@", "de": "%@–%@ von %@", "hr": "%@–%@ od %@", "it": "%@–%@ di %@", "hu": "%@–%@ / %@", "fr": "%@–%@ sur %@", "es": "%@–%@ de %@"],
        "more": ["sl": "in še %@ …", "en": "and %@ more …", "de": "und %@ weitere …", "hr": "i još %@ …", "it": "e altri %@ …", "hu": "és még %@ …", "fr": "et %@ de plus …", "es": "y %@ más …"],
        "routeGo": ["sl": "Začni navigacijo", "en": "Start navigation", "de": "Navigation starten", "hr": "Pokreni navigaciju", "it": "Avvia navigazione", "hu": "Navigáció indítása", "fr": "Démarrer la navigation", "es": "Iniciar navegación"],
        "routeCar": ["sl": "Z avtom", "en": "By car", "de": "Mit dem Auto", "hr": "Autom", "it": "In auto", "hu": "Autóval", "fr": "En voiture", "es": "En coche"],
        "routeWalk": ["sl": "Peš", "en": "Walking", "de": "Zu Fuß", "hr": "Pješice", "it": "A piedi", "hu": "Gyalog", "fr": "À pied", "es": "A pie"],
        "routeClose": ["sl": "Zapri", "en": "Close", "de": "Schließen", "hr": "Zatvori", "it": "Chiudi", "hu": "Bezárás", "fr": "Fermer", "es": "Cerrar"],
        "routeEta": ["sl": "%@ min · %@", "en": "%@ min · %@", "de": "%@ Min. · %@", "hr": "%@ min · %@", "it": "%@ min · %@", "hu": "%@ perc · %@", "fr": "%@ min · %@", "es": "%@ min · %@"],
        "routeNone": ["sl": "Poti ni mogoče izračunati.", "en": "Can’t calculate a route.", "de": "Route kann nicht berechnet werden.", "hr": "Rutu nije moguće izračunati.", "it": "Impossibile calcolare il percorso.", "hu": "Az útvonal nem számítható ki.", "fr": "Impossible de calculer l’itinéraire.", "es": "No se puede calcular la ruta."],
        "liveBody": ["sl": "%@ na seznamu. Kljukaj kar na zaklenjenem zaslonu.", "en": "%@ on your list. Tick them off right on the lock screen.", "de": "%@ auf der Liste. Hake sie direkt auf dem Sperrbildschirm ab.", "hr": "%@ na popisu. Označavaj ih na zaključanom zaslonu.", "it": "%@ nella lista. Spuntali dalla schermata di blocco.", "hu": "%@ a listán. Pipáld ki a zárolási képernyőn.", "fr": "%@ sur ta liste. Coche-les sur l'écran verrouillé.", "es": "%@ en tu lista. Márcalos en la pantalla bloqueada."]
    ]

    static func t(_ key: String, _ args: [String] = [], lang l: String? = nil) -> String {
        let row = table[key] ?? [:]
        let fmt = row[l ?? lang] ?? row["en"] ?? key
        var out = fmt
        for a in args {
            guard let r = out.range(of: "%@") else { break }
            out.replaceSubrange(r, with: a)
        }
        return out
    }

    // »3 izdelki«, »3 items« … (sklon za »imaš N izdelkov« v slovenščini).
    static func items(_ n: Int, lang l: String? = nil, accusative: Bool = false) -> String {
        switch l ?? lang {
        case "sl": return "\(n) " + (n % 100 == 1 ? "izdelek" : n % 100 == 2 ? "izdelka" : (n % 100 == 3 || n % 100 == 4) ? (accusative ? "izdelke" : "izdelki") : "izdelkov")
        case "hr": return "\(n) " + (n % 10 == 1 && n % 100 != 11 ? "proizvod" : "proizvoda")
        case "de": return "\(n) Artikel"
        case "it": return "\(n) " + (n == 1 ? "prodotto" : "prodotti")
        case "hu": return "\(n) termék"
        case "fr": return "\(n) " + (n == 1 ? "article" : "articles")
        case "es": return "\(n) " + (n == 1 ? "producto" : "productos")
        default: return "\(n) " + (n == 1 ? "item" : "items")
        }
    }
}
