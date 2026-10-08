import Foundation
import UIKit
import CoreLocation
import UserNotifications
import Capacitor
import ActivityKit
import MapKit

// Nakupko: zaznavanje trgovin tudi, ko je aplikacija zaprta.
//
// iOS dovoli spremljanje največ 20 območij (geofence). GeoManager zato spremlja
// 19 najbližjih trgovin in eno večje »domače« območje okoli zadnje lokacije.
// Ko ga zapustiš (ali iOS javi večji premik), izbere novih 19 trgovin in po potrebi
// sam naloži trgovine iz OpenStreetMap. Ob vstopu v trgovino pošlje obvestilo
// z izdelki, ki so še na seznamu. iOS aplikacijo za to zbudi tudi, če je zaprta.

struct GeoStore: Codable {
    let id: String
    let name: String
    let lat: Double
    let lon: Double
    var chain: String? = nil
    var duty: Bool? = nil
    var hours: String? = nil
    var only: String? = nil   // specializirana trgovina: kateri izdelki so zanjo (regex iz app.js)

    // Ali trgovina prodaja izdelek (enako kot sells() v app.js).
    func sells(_ text: String) -> Bool {
        if let o = only, !o.isEmpty { return text.range(of: o, options: [.regularExpression, .caseInsensitive]) != nil }
        return !text.lowercased().hasPrefix("dom in vrt ")
    }

    // Ali izdelek kupiš tukaj (enako kot forStore() v app.js): izdelek, dodeljen trgovini (npr. »dm«),
    // samo tam; nedodeljen v vsaki trgovini, ki ga prodaja.
    func wants(_ item: LiveItem) -> Bool {
        if let shop = item.shop, !shop.isEmpty { return shop == chain || shop == id }
        return sells("\(item.cat ?? "Drugo") \(item.label)")
    }
}

// Seja »v trgovini«: trgovina, v kateri si, dokler je iPhone ne zazna kot zapuščene.
struct ShopSession: Codable {
    var store: GeoStore
    var since: Date
}

struct Household {
    let url: String
    let code: String
    let member: String
    let name: String
}

final class GeoManager: NSObject, CLLocationManagerDelegate, UNUserNotificationCenterDelegate {
    static let shared = GeoManager()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let storePrefix = "store:"
    private let homeId = "home"
    private let maxStoreRegions = 19
    private let homeRadius: CLLocationDistance = 1500
    private let refetchDistance: CLLocationDistance = 2500
    // Isto trgovino znova javimo po 3 minutah (GPS na robu parkirišča niha), partnerja pa po 45.
    private let renotifyAfter: TimeInterval = 3 * 60
    // Obvestilo »trgovina je blizu«: največ enkrat na 15 minut (za vse trgovine skupaj), lahko izklopljeno.
    private let nearEvery: TimeInterval = 15 * 60
    private let visitAgainAfter: TimeInterval = 45 * 60

    var onPosition: (([String: Any]) -> Void)?
    var onError: (([String: Any]) -> Void)?
    private(set) var watching = false
    private var fetching = false

    // ---------- Shranjene nastavitve ----------
    private(set) var enabled: Bool {
        get { defaults.bool(forKey: "geo.enabled") }
        set { defaults.set(newValue, forKey: "geo.enabled") }
    }
    // Polmer prihoda (privzeto 30 m) in čas pri trgovini (privzeto 15 s), iz Nastavitev aplikacije.
    private var radius: Double {
        get { let r = defaults.double(forKey: "geo.radius"); return r > 0 ? min(max(r, 20), 80) : 30 }
        set { defaults.set(newValue, forKey: "geo.radius") }
    }
    private var dwell: Double {
        get { let d = defaults.double(forKey: "geo.dwell"); return d > 0 ? min(max(d, 5), 60) : 15 }
        set { defaults.set(newValue, forKey: "geo.dwell") }
    }
    // Odprti izdelki, razvrščeni po oddelkih trgovine (kot v aplikaciji).
    private var groups: [ItemGroup] {
        get {
            guard let data = defaults.data(forKey: "geo.groups") else { return [] }
            return (try? JSONDecoder().decode([ItemGroup].self, from: data)) ?? []
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "geo.groups") }
    }
    // Odprti izdelki z id-ji (za kljukanje na zaklenjenem zaslonu).
    private var liveItems: [LiveItem] {
        get {
            guard let data = defaults.data(forKey: "geo.items") else { return [] }
            return (try? JSONDecoder().decode([LiveItem].self, from: data)) ?? []
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "geo.items") }
    }
    // Cena seznama po verigah (iz aplikacije): za namig »drugje je ceneje«.
    private var chainCost: [String: Double] {
        get { defaults.dictionary(forKey: "geo.chainCost") as? [String: Double] ?? [:] }
        set { defaults.set(newValue, forKey: "geo.chainCost") }
    }
    // Druga stopnja: ko iOS javi bližino trgovine (območje ~150 m), za kratek čas spremljamo natančno lokacijo;
    // StoreDetector odloči, ali si res prišel (~30 m, ~15 s) in v katero trgovino.
    private struct Arrival { let store: GeoStore; let started: Date; var wantNear = false; var count = 0; var quiet = false }
    private var arrival: Arrival?
    private var detector = StoreDetector()
    // Obvestilo »blizu« šele, ko si res pri trgovini (ne že na robu območja ali v mimovožnji).
    private let nearRadius: CLLocationDistance = 120
    private let nearMaxSpeed: CLLocationSpeed = 7   // ~25 km/h
    private let arrivalTimeout: TimeInterval = 8 * 60
    // Po odhodu iz trgovine še nekaj minut iščemo naslednjo (npr. dm v istem nakupovalnem središču),
    // saj iOS za območje, v katerem si že, vstopa ne javi znova.
    private let nextStoreWatch: TimeInterval = 4 * 60
    // Seja, ki ji iPhone ne zazna odhoda (npr. GPS ne dela), se konča po 3 urah.
    private let sessionMax: TimeInterval = 3 * 3600
    // Seja »v trgovini« (preživi tudi, ko iOS aplikacijo zapre in jo zbudi ob dogodku lokacije).
    private var session: ShopSession? {
        get {
            guard let data = defaults.data(forKey: "geo.session") else { return nil }
            return try? JSONDecoder().decode(ShopSession.self, from: data)
        }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "geo.session") }
    }
    var sessionStoreId: String? { session?.store.id }
    // Aplikaciji (native.js) javimo prihod in odhod, da odpre/zapre »V trgovini«.
    var onLeft: ((String) -> Void)?
    var onArrived: ((String) -> Void)?
    // Žeton, s katerim strežnik zažene seznam na zaklenjenem zaslonu (iOS 17.2+).
    private var startToken: String? {
        get { defaults.string(forKey: "live.startToken") }
        set { defaults.set(newValue, forKey: "live.startToken") }
    }
    private var deviceId: String {
        if let d = defaults.string(forKey: "live.device"), d.count == 16 { return d }
        let alpha = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        let d = String((0..<16).map { _ in alpha.randomElement()! })
        defaults.set(d, forKey: "live.device")
        return d
    }
    // Kratek dnevnik zaznavanja (zadnjih 30 dogodkov), viden v Nastavitvah v razvijalskem načinu.
    func log(_ text: String) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        var l = defaults.stringArray(forKey: "geo.log") ?? []
        l.append(f.string(from: Date()) + " " + text)
        defaults.set(Array(l.suffix(30)), forKey: "geo.log")
    }
    // Skupen seznam (household.js): ob prihodu v trgovino preberemo najnovejši seznam s strežnika.
    private var household: Household? {
        get {
            guard let u = defaults.string(forKey: "geo.hh.url"), let c = defaults.string(forKey: "geo.hh.code"), !u.isEmpty, !c.isEmpty else { return nil }
            return Household(url: u, code: c, member: defaults.string(forKey: "geo.hh.member") ?? "", name: defaults.string(forKey: "geo.hh.name") ?? "")
        }
        set {
            defaults.set(newValue?.url, forKey: "geo.hh.url"); defaults.set(newValue?.code, forKey: "geo.hh.code")
            defaults.set(newValue?.member, forKey: "geo.hh.member"); defaults.set(newValue?.name, forKey: "geo.hh.name")
        }
    }
    // Žeton za obvestila (APNs); strežnik ga uporabi, da partnerju sporoči, da si v trgovini.
    private(set) var pushToken: String? {
        get { defaults.string(forKey: "geo.pushToken") }
        set { defaults.set(newValue, forKey: "geo.pushToken") }
    }
    private var pushTokenSentFor: String? {
        get { defaults.string(forKey: "geo.pushTokenSentFor") }
        set { defaults.set(newValue, forKey: "geo.pushTokenSentFor") }
    }
    // Odprti obiski trgovin: storeId -> id obiska na strežniku.
    private var visits: [String: String] {
        get { defaults.dictionary(forKey: "geo.visits") as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: "geo.visits") }
    }
    private var visitSent: [String: Double] {
        get { defaults.dictionary(forKey: "geo.visitSent") as? [String: Double] ?? [:] }
        set { defaults.set(newValue, forKey: "geo.visitSent") }
    }
    private static let categories: [(String, String)] = [
        ("Sadje in zelenjava", "🥦"), ("Kruh in pecivo", "🥖"), ("Mlečni izdelki", "🥛"), ("Meso in ribe", "🥩"),
        ("Shramba", "🥫"), ("Brez glutena", "🌾"), ("Prigrizki", "🍫"), ("Pijače", "🥤"), ("Zamrznjeno", "🧊"),
        ("Otroci", "🍼"), ("Gospodinjstvo", "🧽"), ("Higiena", "🧴"), ("Zdravje", "💊"), ("Športna prehrana", "💪"), ("Tobak", "🚬"),
        ("Ljubljenčki", "🐾"), ("Dom in vrt", "🔨"), ("Drugo", "🛒")
    ]
    // Enako kot groupsOf() v native.js: odprti izdelki po oddelkih.
    static func groupsOf(items: [[String: Any]]) -> [ItemGroup] {
        var by: [String: [[String: Any]]] = [:]
        for i in items where (i["done"] as? Bool) != true {
            guard let name = i["name"] as? String, !name.isEmpty else { continue }
            var c = (i["cat"] as? String) ?? "Drugo"
            if !categories.contains(where: { $0.0 == c }) { c = "Drugo" }
            by[c, default: []].append(i)
        }
        return categories.compactMap { cat, icon in
            guard let list = by[cat] else { return nil }
            let labels = list.sorted { (($0["name"] as? String) ?? "").localizedCompare(($1["name"] as? String) ?? "") == .orderedAscending }.map { i -> String in
                let qty = (i["qty"] as? NSNumber)?.intValue ?? 1
                let brand = (i["brand"] as? String) ?? ""
                return (qty > 1 ? "\(qty)× " : "") + ((i["name"] as? String) ?? "") + (brand.isEmpty ? "" : " (\(brand))")
            }
            return ItemGroup(icon: icon, name: cat, items: labels)
        }
    }

    // Enako kot liveItemsOf() v native.js: odprti izdelki v vrstnem redu oddelkov.
    static func liveItemsOf(items: [[String: Any]], known: [LiveItem] = []) -> [LiveItem] {
        let iconById = Dictionary(known.map { ($0.id, $0.icon) }, uniquingKeysWith: { a, _ in a })
        // Ime izdelka v jeziku aplikacije (prevedla ga je aplikacija), če ga poznamo.
        let labelById = Dictionary(known.map { ($0.id, $0.label) }, uniquingKeysWith: { a, _ in a })
        let open = items.filter { ($0["done"] as? Bool) != true && !((($0["name"] as? String) ?? "").isEmpty) && $0["id"] is String }
        func catIndex(_ i: [String: Any]) -> Int {
            let c = (i["cat"] as? String) ?? "Drugo"
            return categories.firstIndex(where: { $0.0 == c }) ?? (categories.count - 1)
        }
        return open.sorted {
            let a = catIndex($0), b = catIndex($1)
            if a != b { return a < b }
            return (($0["name"] as? String) ?? "").localizedCompare(($1["name"] as? String) ?? "") == .orderedAscending
        }.map { i in
            let qty = (i["qty"] as? NSNumber)?.intValue ?? 1
            let brand = (i["brand"] as? String) ?? ""
            let label = (qty > 1 ? "\(qty)× " : "") + ((i["name"] as? String) ?? "") + (brand.isEmpty ? "" : " (\(brand))")
            let id = i["id"] as! String
            return LiveItem(id: id, label: labelById[id] ?? label, icon: iconById[id] ?? categories[catIndex(i)].1, cat: categories[catIndex(i)].0, shop: i["store"] as? String)
        }
    }

    // Trgovina iz obvestila, ki ga je uporabnik tapnil (native.js takoj odpre nakupovanje).
    var pendingStoreId: String?
    private var stores: [GeoStore] {
        get {
            guard let data = defaults.data(forKey: "geo.stores") else { return [] }
            return (try? JSONDecoder().decode([GeoStore].self, from: data)) ?? []
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "geo.stores") }
    }
    private var lastFetch: CLLocation? {
        get {
            guard defaults.object(forKey: "geo.fetchLat") != nil else { return nil }
            return CLLocation(latitude: defaults.double(forKey: "geo.fetchLat"), longitude: defaults.double(forKey: "geo.fetchLon"))
        }
        set {
            defaults.set(newValue?.coordinate.latitude, forKey: "geo.fetchLat")
            defaults.set(newValue?.coordinate.longitude, forKey: "geo.fetchLon")
        }
    }
    private var notified: [String: Double] {
        get { defaults.dictionary(forKey: "geo.notified") as? [String: Double] ?? [:] }
        set { defaults.set(newValue, forKey: "geo.notified") }
    }

    // ---------- Zagon ----------
    func start() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        // Brez samodejnega premora: po premoru iOS lokacije ne pošilja več, dokler je ne zaženemo znova.
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .otherNavigation
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.watching else { return }
            self.manager.startUpdatingLocation()
        }
        if enabled { startBackgroundMonitoring() }
        applyDetectorSettings()
        // Seja »v trgovini« od prej (iOS je aplikacijo vmes zaprl): odhod spremljamo naprej.
        if let s = session {
            if Date().timeIntervalSince(s.since) > sessionMax { endSession("seja je predolga") }
            else {
                detector.restore(StoreDetector.Active(id: s.store.id, lat: s.store.lat, lon: s.store.lon, since: s.since.timeIntervalSince1970))
                startPreciseUpdates()
            }
        }
        UIApplication.shared.registerForRemoteNotifications()
        if #available(iOS 17.2, *) {
            Task { [weak self] in
                for await data in Activity<ShoppingAttributes>.pushToStartTokenUpdates {
                    let hex = data.map { String(format: "%02x", $0) }.joined()
                    await MainActor.run { self?.startToken = hex }
                }
            }
        }
    }

    private func applyDetectorSettings() {
        detector.entry = radius
        detector.dwell = dwell
    }

    func configure(enabled on: Bool, radius r: Double, dwell dw: Double, stores list: [GeoStore], groups open: [ItemGroup], items: [LiveItem], household hh: Household?) {
        radius = r
        dwell = dw
        applyDetectorSettings()
        groups = open
        liveItems = items
        household = hh
        registerMember()
        if !list.isEmpty {
            stores = list
            if let loc = manager.location { lastFetch = lastFetch ?? loc }
        }
        let wasOn = enabled
        enabled = on
        if on {
            if !wasOn { requestPermissions() }
            startBackgroundMonitoring()
            if let loc = manager.location { refreshRegions(around: loc) }
        } else {
            stopBackgroundMonitoring()
        }
    }

    func status() -> [String: Any] {
        let auth: String
        switch manager.authorizationStatus {
        case .authorizedAlways: auth = "always"
        case .authorizedWhenInUse: auth = "whenInUse"
        case .denied, .restricted: auth = "denied"
        default: auth = "notDetermined"
        }
        return ["enabled": enabled, "authorization": auth, "regions": manager.monitoredRegions.count, "stores": stores.count, "push": pushToken != nil, "liveToken": startToken != nil, "log": defaults.stringArray(forKey: "geo.log") ?? []]
    }

    func requestAlways() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        else { manager.requestAlwaysAuthorization() }
    }

    private func requestPermissions() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: break
        }
    }

    // ---------- Sledenje, ko je aplikacija odprta ----------
    func startWatch() {
        watching = true
        if manager.authorizationStatus == .notDetermined {
            // Ob prvem zagonu: najprej vprašamo, sledenje začne locationManagerDidChangeAuthorization.
            // Sicer iOS med vprašanjem javi »zavrnjeno« in stikalo v aplikaciji se izklopi.
            manager.requestWhenInUseAuthorization()
            return
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            onError?(["code": 1, "message": L10n.t("denied")])
        }
        manager.startUpdatingLocation()
    }

    func stopWatch() {
        watching = false
        // Med sejo »v trgovini« ali čakanjem na prihod natančno lokacijo še potrebujemo.
        if session == nil && arrival == nil { manager.stopUpdatingLocation() }
    }

    // Natančna lokacija v ozadju: le med čakanjem na prihod in med sejo »v trgovini« (baterija).
    private func startPreciseUpdates() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = false
        manager.desiredAccuracy = kCLLocationAccuracyBest
        // Brez filtra razdalje: tudi ko stojiš pred trgovino, dobimo meritve za potrditev odhoda.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.startUpdatingLocation()
    }

    private func stopPreciseUpdates() {
        guard session == nil && arrival == nil else { return }
        manager.distanceFilter = 5
        if !watching {
            manager.stopUpdatingLocation()
            manager.allowsBackgroundLocationUpdates = false
        }
    }

    // ---------- Spremljanje v ozadju ----------
    private func startBackgroundMonitoring() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { return }
        manager.startMonitoringSignificantLocationChanges()
    }

    private func stopBackgroundMonitoring() {
        manager.stopMonitoringSignificantLocationChanges()
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
    }

    private func refreshRegions(around loc: CLLocation) {
        guard enabled, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        // Natančnost območij v iOS je ~100 m, zato manjši polmer ne pomaga.
        // Vsaj 150 m, da iOS zazna tudi mimovožnjo; obvestilo je tiho in izgine, ko greš naprej.
        let r = min(max(radius * 3, 250), 400)
        let nearest = stores
            .map { ($0, loc.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon))) }
            .filter { $0.1 < 8000 }
            .sorted { $0.1 < $1.1 }
            .prefix(maxStoreRegions)
        let wanted = Set(nearest.map { storePrefix + $0.0.id })
        for region in manager.monitoredRegions where region.identifier.hasPrefix(storePrefix) && !wanted.contains(region.identifier) {
            manager.stopMonitoring(for: region)
        }
        let existing = Set(manager.monitoredRegions.compactMap { ($0 as? CLCircularRegion).map { "\($0.identifier)@\($0.radius)@\($0.notifyOnExit)" } })
        for (store, _) in nearest where !existing.contains("\(storePrefix + store.id)@\(r)@true") {
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: store.lat, longitude: store.lon), radius: r, identifier: storePrefix + store.id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
            // Če si že v trgovini, ko začnemo spremljati, iOS vstopa ne javi; zato vprašamo za stanje.
            manager.requestState(for: region)
        }
        let home = CLCircularRegion(center: loc.coordinate, radius: homeRadius, identifier: homeId)
        home.notifyOnEntry = false
        home.notifyOnExit = true
        manager.startMonitoring(for: home)

        if lastFetch == nil || loc.distance(from: lastFetch!) > refetchDistance { fetchStores(around: loc) }
    }

    // Trgovine iz OpenStreetMap (isto kot spletna aplikacija), da deluje tudi na poti.
    private func fetchStores(around loc: CLLocation) {
        guard !fetching else { return }
        fetching = true
        let task = UIApplication.shared.beginBackgroundTask(withName: "nakupko.stores")
        // Najprej država (is_in): zunaj Slovenije spremljamo vse trgovine z živili, ne le slovenskih verig.
        let q = "[out:json][timeout:20];is_in(\(loc.coordinate.latitude),\(loc.coordinate.longitude))->.a;area.a[\"ISO3166-1\"][\"admin_level\"=\"2\"]->.c;.c out tags;(nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store|chemist)$\"](around:5000,\(loc.coordinate.latitude),\(loc.coordinate.longitude)););out center tags 150;"
        var req = URLRequest(url: URL(string: "https://overpass-api.de/api/interpreter")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = ("data=" + (q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")).data(using: .utf8)
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                defer { UIApplication.shared.endBackgroundTask(task) }
                guard let self = self else { return }
                self.fetching = false
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let elements = json["elements"] as? [[String: Any]] else { return }
                let country = elements.lazy.compactMap { ($0["tags"] as? [String: Any])?["ISO3166-1"] as? String }.first?.uppercased() ?? "SI"
                let list: [GeoStore] = elements.compactMap { e in
                    let tags = e["tags"] as? [String: Any] ?? [:]
                    let center = e["center"] as? [String: Any]
                    guard let lat = (e["lat"] as? Double) ?? (center?["lat"] as? Double),
                          let lon = (e["lon"] as? Double) ?? (center?["lon"] as? Double) else { return nil }
                    let name = (tags["name"] as? String) ?? (tags["brand"] as? String) ?? (tags["operator"] as? String) ?? "Trgovina"
                    let hours = (tags["opening_hours"] as? String) ?? ""
                    let text = [tags["brand"], tags["name"], tags["operator"]].compactMap { $0 as? String }.joined(separator: " ")
                    // V tujini vse trgovine z živili (brez verige, brez slovenskih urnikov).
                    if country != "SI" {
                        let shop = (tags["shop"] as? String) ?? ""
                        guard ["supermarket", "convenience", "grocery", "discount"].contains(shop) else { return nil }
                        return GeoStore(id: "\(e["type"] ?? "n")/\(e["id"] ?? 0)", name: name, lat: lat, lon: lon,
                                        chain: nil, duty: false, hours: hours)
                    }
                    // Samo verige in dežurne trgovine, kot v aplikaciji.
                    guard let kind = StoreRules.kind(text: text, hours: hours) else { return nil }
                    return GeoStore(id: "\(e["type"] ?? "n")/\(e["id"] ?? 0)", name: name, lat: lat, lon: lon,
                                    chain: kind.chain, duty: kind.duty, hours: hours, only: kind.chain.flatMap { StoreRules.only[$0] })
                }
                guard !list.isEmpty else { return }
                self.stores = list
                self.lastFetch = loc
                self.refreshRegions(around: loc)
            }
        }.resume()
    }

    // ---------- Skupen seznam: kdo je v trgovini ----------
    func setPushToken(_ token: String) {
        pushToken = token
        registerMember()
    }

    // Strežniku sporoči žeton tega telefona, da lahko dobi obvestilo »partner je v trgovini«.
    private func registerMember() {
        guard let hh = household, !hh.member.isEmpty, let token = pushToken else { return }
        let key = "\(hh.code)/\(hh.member)/\(token)/\(hh.name)/\(L10n.lang)"
        if pushTokenSentFor == key { return }
        guard let url = URL(string: "\(hh.url)/h/\(hh.code)/members/\(hh.member).json") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["ios": token, "name": hh.name, "platform": "ios", "lang": L10n.lang])
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200 { DispatchQueue.main.async { self?.pushTokenSentFor = key } }
        }.resume()
    }

    // Pravi prihod (obstal pri trgovini) zapišemo kot obisk; strežnik po minuti preveri, ali si še tam, in obvesti ostale.
    private func reportVisit(storeId id: String) {
        guard let hh = household, !hh.member.isEmpty, let store = stores.first(where: { $0.id == id }) else { return }
        if !mayBeOpen(store) { return }
        let now = Date().timeIntervalSince1970
        var sent = visitSent
        if let last = sent[id], now - last < visitAgainAfter { return }
        sent = sent.filter { now - $0.value < 24 * 3600 }
        sent[id] = now
        visitSent = sent
        guard let url = URL(string: "\(hh.url)/h/\(hh.code)/visits.json") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "member": hh.member, "name": hh.name, "store": store.name, "storeId": id, "at": [".sv": "timestamp"]
        ])
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                if let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let key = obj["name"] as? String {
                    self?.visits[id] = key
                }
                app.endBackgroundTask(task)
            }
        }.resume()
    }

    private func reportLeft(storeId id: String) {
        guard let hh = household, let key = visits[id], let url = URL(string: "\(hh.url)/h/\(hh.code)/visits/\(key).json") else { return }
        visits[id] = nil
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["left": true])
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        URLSession.shared.dataTask(with: req) { _, _, _ in DispatchQueue.main.async { app.endBackgroundTask(task) } }.resume()
    }

    private func notifyEntered(regionId: String) {
        let sid = String(regionId.dropFirst(storePrefix.count))
        log("vstop: " + (stores.first(where: { $0.id == sid })?.name ?? sid))
        guard let hh = household, let url = URL(string: "\(hh.url)/h/\(hh.code)/items.json") else { return storeNear(id: sid) }
        // Partner je morda kaj dodal, medtem ko je bila aplikacija zaprta: preberemo skupen seznam.
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let all = obj.values.compactMap { $0 as? [String: Any] }
                    self.groups = Self.groupsOf(items: all)
                    self.liveItems = Self.liveItemsOf(items: all, known: self.liveItems)
                } else if let data = data, String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "null" {
                    self.groups = []
                    self.liveItems = []
                }
                self.storeNear(id: sid)
                app.endBackgroundTask(task)
            }
        }.resume()
    }

    // Izdelki za to trgovino: dodeljeni njej in nedodeljeni, ki jih prodaja (dm: le drogerija).
    private func items(for store: GeoStore) -> [LiveItem] { liveItems.filter { store.wants($0) } }

    // Odprti izdelki trgovine po oddelkih (za navadno obvestilo).
    private func groups(of items: [LiveItem]) -> [ItemGroup] {
        Self.categories.compactMap { cat, icon in
            let its = items.filter { ($0.cat ?? "Drugo") == cat }.map { $0.label }
            return its.isEmpty ? nil : ItemGroup(icon: icon, name: cat, items: its)
        }
    }

    // iOS je javil bližino trgovine (~250 m): za nekaj minut vklopimo natančno lokacijo.
    private func storeNear(id: String) {
        guard enabled, let store = stores.first(where: { $0.id == id }) else { return log("  preskok: trgovine ni na seznamu") }
        if let s = session { return log("  si že v trgovini \(s.store.name)") }
        let count = items(for: store).count
        if count == 0 && household == nil { return log("  preskok: za to trgovino nimaš izdelkov") }
        // 1. stopnja: »blizu si« (+ namig, če je bližnja trgovina občutno cenejša) – pošlje checkArrival,
        // ko si do ~120 m od trgovine in ne voziš hitro.
        let now = Date().timeIntervalSince1970
        var wantNear = false
        if count == 0 || UIApplication.shared.applicationState == .active || !mayBeOpen(store) {}
        else if defaults.object(forKey: "geo.nearNotify") as? Bool == false { log("  brez obvestila »blizu« (izklopljeno)") }
        else if now - defaults.double(forKey: "geo.lastNear") < nearEvery { log("  brez obvestila »blizu« (zadnje pred \(Int((now - defaults.double(forKey: "geo.lastNear")) / 60)) min)") }
        else { wantNear = true }
        // 2. stopnja: StoreDetector potrdi prihod (~30 m, ~15 s).
        startArrivalWatch(Arrival(store: store, started: Date(), wantNear: wantNear, count: count))
    }

    // Delovni čas v OpenStreetMap je pogosto zastarel (npr. Spar do 20h, v resnici do 21h):
    // trgovino z vpisanim urnikom štejemo za zaprto šele uro po zapiranju in pol ure pred odprtjem.
    // Brez vpisanega urnika (privzeti urnik verige) velja urnik točno, brez dodatnega časa.
    private func mayBeOpen(_ store: GeoStore) -> Bool {
        let now = Date()
        let open = StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now)
        // Brez dodatnega časa: privzeti urnik verige in drogerije (dm, Müller), ki se urnika držijo.
        if (store.hours ?? "").isEmpty || store.chain == "dm" || store.chain == "muller" { return open != false }
        return open != false
            || StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now.addingTimeInterval(-60 * 60)) == true
            || StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now.addingTimeInterval(30 * 60)) == true
    }

    private func postNearNotification(id: String, store: GeoStore, count: Int) {
        let here = CLLocation(latitude: store.lat, longitude: store.lon)
        let dist = manager.location.map { Int(($0.distance(from: here) / 10).rounded() * 10) }
        let content = UNMutableNotificationContent()
        content.title = L10n.t("near", [store.name]) + (dist.map { " (\($0) m)" } ?? "")
        var body = L10n.t("nearBody", [L10n.items(count, accusative: true)])
        if let tip = cheaperNearby(than: store) { body += "\n💡 " + tip }
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.relevanceScore = 1
        content.userInfo = ["storeId": id]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "store-\(id)", content: content, trigger: nil))
        log("  obvestilo »blizu« poslano")
    }

    // Bližnja (do 2 km) odprta trgovina druge verige, kjer je seznam občutno cenejši.
    private func cheaperNearby(than store: GeoStore) -> String? {
        let costs = chainCost
        guard let c = store.chain, let mine = costs[c], mine > 0 else { return nil }
        let here = CLLocation(latitude: store.lat, longitude: store.lon)
        var best: (GeoStore, Double, CLLocationDistance)?
        for s in stores {
            guard let k = s.chain, k != c, (s.only ?? "").isEmpty, let cost = costs[k] else { continue }
            let d = here.distance(from: CLLocation(latitude: s.lat, longitude: s.lon))
            guard d <= 2000, StoreRules.isOpen(hours: s.hours, chain: s.chain) != false else { continue }
            let saving = mine - cost
            if saving >= max(1.5, mine * 0.05), best == nil || saving > best!.1 { best = (s, saving, d) }
        }
        guard let b = best else { return nil }
        let km = b.2 < 1000 ? "\(Int((b.2 / 10).rounded() * 10)) m" : String(format: "%.1f km", b.2 / 1000).replacingOccurrences(of: ".", with: ",")
        let eur = String(format: "%.2f", b.1).replacingOccurrences(of: ".", with: ",")
        return L10n.t("cheaper", [b.0.name, km, eur + " €"])
    }

    private func startArrivalWatch(_ a: Arrival) {
        arrival = a
        startPreciseUpdates()
        log("  čakam, da obstaneš pri trgovini")
    }

    private func stopArrivalWatch(_ why: String) {
        guard arrival != nil else { return }
        arrival = nil
        log("  " + why)
        stopPreciseUpdates()
    }

    // Meritev v obliki za StoreDetector.
    private func fix(_ loc: CLLocation) -> DetectFix {
        DetectFix(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude,
                  acc: loc.horizontalAccuracy, speed: loc.speed, time: loc.timestamp.timeIntervalSince1970)
    }

    // Klic ob vsaki natančni lokaciji med čakanjem na prihod.
    private func checkArrival(_ loc: CLLocation) {
        guard var a = arrival, session == nil else { return }
        if Date().timeIntervalSince(a.started) > arrivalTimeout { return stopArrivalWatch("nisi se ustavil – konec spremljanja") }
        let d = loc.distance(from: CLLocation(latitude: a.store.lat, longitude: a.store.lon))
        if a.wantNear && d <= nearRadius + min(max(loc.horizontalAccuracy, 0), 30) && (loc.speed < 0 || loc.speed < nearMaxSpeed) {
            a.wantNear = false
            arrival = a
            let now = Date().timeIntervalSince1970
            if now - defaults.double(forKey: "geo.lastNear") >= nearEvery {
                defaults.set(now, forKey: "geo.lastNear")
                postNearNotification(id: a.store.id, store: a.store, count: a.count)
            }
        }
        // Kandidati: trgovine v bližini; trgovina, za katero imaš izdelke, ima prednost pred sosednjo.
        let near = stores.filter { loc.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon)) < 300 }
        let cands = near.map { DetectStore(id: $0.id, lat: $0.lat, lon: $0.lon, hasItems: !items(for: $0).isEmpty) }
        if case .arrived(let id)? = detector.update(fix(loc), stores: cands), let store = near.first(where: { $0.id == id }) {
            arrival = nil
            log("  prišel si v trgovino \(store.name) (\(Int(loc.distance(from: CLLocation(latitude: store.lat, longitude: store.lon)))) m, ±\(Int(loc.horizontalAccuracy)) m)")
            arrived(store)
        }
    }

    // Prihod potrjen: seja »v trgovini« – seznam te trgovine na zaklenjenem zaslonu, partner izve.
    private func arrived(_ store: GeoStore) {
        session = ShopSession(store: store, since: Date())
        startPreciseUpdates()   // odhod spremljamo sproti, ne šele ob počasnem izhodu iz območja
        let id = store.id, its = items(for: store), count = its.count
        // Partner izve šele, ko si res v trgovini (ne ko se pelješ mimo).
        reportVisit(storeId: id)
        // Odprta aplikacija sama odpre »V trgovini« (native.js) in seznam na zaklenjenem zaslonu.
        if UIApplication.shared.applicationState == .active { onArrived?(id); return }
        if count == 0 { return log("  za to trgovino nimaš izdelkov") }
        if !mayBeOpen(store) { return log("  preskok: trgovina je zaprta (\(store.hours ?? "?"))") }
        let now = Date().timeIntervalSince1970
        var sent = notified
        if let last = sent[id], now - last < renotifyAfter { return log("  preskok: obvestilo pred \(Int(now - last)) s") }
        sent = sent.filter { now - $0.value < 24 * 3600 }
        sent[id] = now
        notified = sent
        let open = groups(of: its)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["store-\(id)"])
        // iOS 17.2+: strežnik na zaklenjenem zaslonu odpre seznam, ki ga lahko kljukaš. Sicer navadno obvestilo.
        if startLive(store: store.name, items: its, completion: { [weak self] ok in
            guard let self = self else { return }
            if !ok { self.log("  strežnik ni dosegljiv → obvestilo"); return self.postStoreNotification(id: id, store: store, open: open, count: count) }
            self.log("  prošnja za seznam poslana")
            // Če seznam na zaklenjenem zaslonu v 12 s ne pride (push ni uspel), pokažemo navadno obvestilo.
            let app = UIApplication.shared
            var task: UIBackgroundTaskIdentifier = .invalid
            task = app.beginBackgroundTask { app.endBackgroundTask(task) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
                if Activity<ShoppingAttributes>.activities.contains(where: { $0.attributes.store == store.name }) {
                    self.log("  seznam na zaklenjenem zaslonu ✓")
                } else if self.session?.store.id == id {
                    self.log("  seznama ni → obvestilo")
                    self.postStoreNotification(id: id, store: store, open: open, count: count)
                }
                self.fetchLiveResult()
                app.endBackgroundTask(task)
            }
        }) { return }
        log("  navadno obvestilo" + (startToken == nil ? " (ni žetona za seznam)" : ""))
        postStoreNotification(id: id, store: store, open: open, count: count)
    }

    // Med sejo: si še v trgovini?
    private func checkSession(_ loc: CLLocation) {
        guard let s = session else { return }
        if Date().timeIntervalSince(s.since) > sessionMax { return endSession("seja je predolga") }
        if case .left? = detector.update(fix(loc), stores: []) {
            let d = Int(loc.distance(from: CLLocation(latitude: s.store.lat, longitude: s.store.lon)))
            endSession("odšel si iz trgovine \(s.store.name) (\(d) m, ±\(Int(loc.horizontalAccuracy)) m)", lookForNext: true)
        }
    }

    // Konec seje: seznam z zaklenjenega zaslona takoj umaknemo, partner izve, aplikacija zapre »V trgovini«.
    private func endSession(_ why: String, lookForNext: Bool = false, notifyApp: Bool = true) {
        guard let s = session else { return }
        session = nil
        detector.stop(now: Date().timeIntervalSince1970)
        log(why)
        if #available(iOS 16.2, *) {
            for a in Activity<ShoppingAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
        }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["store-\(s.store.id)"])
        reportLeft(storeId: s.store.id)
        if notifyApp { onLeft?(s.store.id) }
        // Naslednja trgovina blizu (npr. iz Spara v dm v istem središču): še nekaj minut natančna lokacija.
        if lookForNext && enabled {
            arrival = Arrival(store: s.store, started: Date().addingTimeInterval(nextStoreWatch - arrivalTimeout), wantNear: false, count: 0, quiet: true)
            startPreciseUpdates()
        } else {
            stopPreciseUpdates()
        }
    }

    // Odgovor Applovega strežnika za zadnji zagon seznama (zapiše ga funkcija liveStart).
    private func fetchLiveResult() {
        guard let base = household?.url ?? defaults.string(forKey: "geo.dbUrl"),
              let url = URL(string: "\(base)/la/\(deviceId)/result.json") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            let st = (obj["status"] as? NSNumber)?.intValue ?? 0
            let why = (obj["data"] as? String) ?? ""
            DispatchQueue.main.async { self?.log("  Apple: \(st) \(why.prefix(80))") }
        }.resume()
    }

    private func postStoreNotification(id: String, store: GeoStore, open: [ItemGroup], count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "🛒 \(store.name) · " + L10n.items(count)
        // Ena vrstica na oddelek; ves seznam se vidi, ko obvestilo razpreš.
        content.body = open.map { "\($0.icon) \($0.items.joined(separator: ", "))" }.joined(separator: "\n")
        // Tiho: brez zvoka; ko greš mimo trgovine, obvestilo samo izgine (didExitRegion).
        content.sound = nil
        content.interruptionLevel = .active
        content.relevanceScore = 1
        content.userInfo = ["storeId": id]
        let request = UNNotificationRequest(identifier: "store-\(id)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // Prošnja strežniku (Firebase funkcija liveStart), da pošlje push, ki zažene Live Activity.
    // Vrne false, če to na tem iPhonu ni mogoče (takrat pokažemo navadno obvestilo).
    private func startLive(store: String, items: [LiveItem], completion: @escaping (Bool) -> Void) -> Bool {
        guard #available(iOS 17.2, *), ActivityAuthorizationInfo().areActivitiesEnabled, let token = startToken,
              let base = household?.url ?? defaults.string(forKey: "geo.dbUrl"),
              let url = URL(string: "\(base)/la/\(deviceId)/starts.json") else { return false }
        if Activity<ShoppingAttributes>.activities.contains(where: { $0.attributes.store == store }) { return true }
        let list = LiveList.fit(items)
        let state: [String: Any] = [
            "items": list.map { ["id": $0.id, "label": $0.label, "icon": $0.icon] },
            "done": 0, "total": list.count, "lang": L10n.lang
        ]
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 6
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "store": store, "state": state, "lang": L10n.lang, "at": [".sv": "timestamp"]])
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { completion(ok); app.endBackgroundTask(task) }
        }.resume()
        return true
    }

    // ---------- Seznam na zaklenjenem zaslonu (Live Activity) ----------
    // Aplikacija (native.js) sporoča stanje »V trgovini«:
    // - active + storeId: odprta je trgovina storeId → seja; iPhone sam spremlja odhod (tudi v ozadju).
    // - updateOnly: »V trgovini« ni odprt (zaprl si ga ali seznam je odprl iPhone sam) – obstoječi seznam
    //   na zaklenjenem zaslonu samo osvežimo; zapre se, ko res odideš iz trgovine.
    // - active == false: aplikacija je zaznala odhod → konec seje.
    // Na zaklenjenem zaslonu so vedno le izdelki trenutne trgovine (dodeljeni njej ali nedodeljeni, ki jih prodaja).
    func shopping(active: Bool, store: String, storeId: String?, place: GeoStore?, items all: [LiveItem], done: Int, total: Int, updateOnly: Bool = false) {
        guard active else {
            if session != nil { endSession("aplikacija: odšel si iz trgovine", notifyApp: false) }
            if #available(iOS 16.2, *) { for a in Activity<ShoppingAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } } }
            return
        }
        if !updateOnly, let sid = storeId, !sid.isEmpty, session?.store.id != sid,
           let st = stores.first(where: { $0.id == sid }) ?? place {
            if session != nil { endSession("druga trgovina", notifyApp: false) }
            session = ShopSession(store: st, since: Date())
            detector.start(id: st.id, lat: st.lat, lon: st.lon, now: Date().timeIntervalSince1970)
            arrival = nil
            startPreciseUpdates()
            log("v trgovini (aplikacija): \(st.name)")
        }
        let list = session.map { s in all.filter { s.store.wants($0) } } ?? all
        guard #available(iOS 16.2, *) else { return }
        let current = Activity<ShoppingAttributes>.activities
        if updateOnly {
            let fitted = LiveList.fit(list)
            for a in current where a.activityState == .active {
                let prev = a.content.state
                // Kar je izginilo s seznama, je kupljeno; novi izdelki povečajo skupno število.
                let d = prev.done + max(0, (prev.total - prev.done) - list.count)
                let st = ShoppingAttributes.ContentState(items: fitted, done: d, total: d + list.count, page: LiveList.clampPage(prev.page, count: fitted.count), lang: L10n.lang)
                Task { await a.update(ActivityContent(state: st, staleDate: Date().addingTimeInterval(4 * 3600))) }
            }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let fitted = LiveList.fit(list)
        let title = session?.store.name ?? store
        let doneHere = list.count == all.count ? done : 0
        let keepPage = current.first(where: { $0.attributes.store == title })?.content.state.page
        let state = ShoppingAttributes.ContentState(items: fitted, done: doneHere, total: doneHere + list.count, page: LiveList.clampPage(keepPage, count: fitted.count), lang: L10n.lang)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 3600))
        if let a = current.first(where: { $0.attributes.store == title }) {
            Task { await a.update(content) }
            for other in current where other.id != a.id { Task { await other.end(nil, dismissalPolicy: .immediate) } }
        } else {
            for a in current { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            do {
                _ = try Activity.request(attributes: ShoppingAttributes(store: title), content: content, pushType: nil)
            } catch {
                // Aplikacija je že v ozadju (npr. zaklenil si telefon med odštevanjem): seznam zažene strežnik.
                _ = startLive(store: title, items: list, completion: { _ in })
            }
        }
    }

    // Live Activity sprejme največ 4 KB podatkov: dolge sezname skrajšamo.
    private static func fit(_ list: [ItemGroup]) -> [ItemGroup] {
        var out: [ItemGroup] = []
        var size = 0
        for g in list {
            var items: [String] = []
            for it in g.items {
                let name = it.count > 40 ? String(it.prefix(40)) + "…" : it
                size += name.utf8.count + 4
                if size > 2800 { break }
                items.append(name)
            }
            if !items.isEmpty { out.append(ItemGroup(icon: g.icon, name: g.name, items: items)) }
            if size > 2800 { break }
        }
        return out
    }

    // ---------- CLLocationManagerDelegate ----------
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        if s == .authorizedWhenInUse && enabled { manager.requestAlwaysAuthorization() }
        if (s == .denied || s == .restricted) && watching { onError?(["code": 1, "message": L10n.t("denied")]) }
        if (s == .authorizedWhenInUse || s == .authorizedAlways) && watching { manager.startUpdatingLocation() }
        if s == .authorizedAlways && enabled { startBackgroundMonitoring() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        if watching {
            onPosition?([
                "lat": loc.coordinate.latitude,
                "lon": loc.coordinate.longitude,
                "acc": loc.horizontalAccuracy,
                "time": loc.timestamp.timeIntervalSince1970 * 1000
            ])
        }
        // Med sejo »v trgovini«: si še tam? Sicer: si prišel v trgovino?
        checkSession(loc)
        checkArrival(loc)
        guard enabled else { return }
        let home = manager.monitoredRegions.first { $0.identifier == homeId } as? CLCircularRegion
        if home == nil || loc.distance(from: CLLocation(latitude: home!.center.latitude, longitude: home!.center.longitude)) > homeRadius * 0.6 {
            refreshRegions(around: loc)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard watching, manager.authorizationStatus != .notDetermined else { return }
        let denied = (error as? CLError)?.code == .denied
        onError?(["code": denied ? 1 : 2, "message": error.localizedDescription])
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        if region.identifier.hasPrefix(storePrefix) { notifyEntered(regionId: region.identifier) }
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        if state == .inside && region.identifier.hasPrefix(storePrefix) { notifyEntered(regionId: region.identifier) }
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        if region.identifier.hasPrefix(storePrefix) {
            let id = String(region.identifier.dropFirst(storePrefix.count))
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["store-\(id)"])
            // Rezerva: izhod iz območja (~250 m) pomeni, da si gotovo odšel.
            if session?.store.id == id { endSession("izhod iz območja trgovine", lookForNext: true) }
            else if arrival?.store.id == id, !(arrival?.quiet ?? false) { stopArrivalWatch("odpeljal si se mimo") }
            if session?.store.id != id { reportLeft(storeId: id) }
            return
        }
        guard region.identifier == homeId else { return }
        if let loc = manager.location { refreshRegions(around: loc) } else { manager.requestLocation() }
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {}

    // ---------- Obvestila ----------
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        pendingStoreId = response.notification.request.content.userInfo["storeId"] as? String
        completionHandler()
    }
}

// Most do spletnega dela (native.js).
@objc(NakupkoGeoPlugin)
public class NakupkoGeoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NakupkoGeoPlugin"
    public let jsName = "NakupkoGeo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shopping", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeDone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "routeInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRoute", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let geo = GeoManager.shared
        geo.onPosition = { [weak self] data in self?.notifyListeners("position", data: data) }
        geo.onError = { [weak self] data in self?.notifyListeners("locationError", data: data) }
        geo.onLeft = { [weak self] id in self?.notifyListeners("storeLeft", data: ["storeId": id]) }
        geo.onArrived = { [weak self] id in self?.notifyListeners("storeArrived", data: ["storeId": id]) }
    }

    @objc func startWatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GeoManager.shared.startWatch(); call.resolve() }
    }

    @objc func stopWatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GeoManager.shared.stopWatch(); call.resolve() }
    }

    @objc func setConfig(_ call: CAPPluginCall) {
        let on = call.getBool("enabled") ?? false
        let radius = call.getDouble("radius") ?? 30
        let dwell = call.getDouble("dwell") ?? 15
        let groups = Self.parseGroups(call)
        let items = Self.parseItems(call)
        let dbUrl = call.getString("dbUrl")
        let nearNotify = call.getBool("nearNotify") ?? true
        let lang = call.getString("lang")
        var costs: [String: Double] = [:]
        if let c = call.getObject("chainCost") { for (k, v) in c { if let n = v as? NSNumber { costs[k] = n.doubleValue } } }
        let stores: [GeoStore] = (call.getArray("stores", JSObject.self) ?? []).compactMap { s in
            guard let id = s["id"] as? String,
                  let lat = (s["lat"] as? NSNumber)?.doubleValue,
                  let lon = (s["lon"] as? NSNumber)?.doubleValue else { return nil }
            return GeoStore(id: id, name: (s["name"] as? String) ?? "Trgovina", lat: lat, lon: lon,
                            chain: s["chain"] as? String, duty: s["duty"] as? Bool, hours: s["hours"] as? String, only: s["only"] as? String)
        }
        var hh: Household?
        if let h = call.getObject("household"), let u = h["url"] as? String, let c = h["code"] as? String {
            hh = Household(url: u, code: c, member: (h["member"] as? String) ?? "", name: (h["name"] as? String) ?? "")
        }
        DispatchQueue.main.async {
            if let u = dbUrl, !u.isEmpty { UserDefaults.standard.set(u, forKey: "geo.dbUrl") }
            UserDefaults.standard.set(costs, forKey: "geo.chainCost")
            UserDefaults.standard.set(nearNotify, forKey: "geo.nearNotify")
            if let l = lang, !l.isEmpty { UserDefaults.standard.set(l, forKey: "geo.lang") }
            GeoManager.shared.configure(enabled: on, radius: radius, dwell: dwell, stores: stores, groups: groups, items: items, household: hh)
            call.resolve()
        }
    }

    static func parseGroups(_ call: CAPPluginCall) -> [ItemGroup] {
        (call.getArray("groups", JSObject.self) ?? []).compactMap { g in
            guard let name = g["name"] as? String, let items = (g["items"] as? JSArray)?.compactMap({ $0 as? String }), !items.isEmpty else { return nil }
            return ItemGroup(icon: (g["icon"] as? String) ?? "🛒", name: name, items: items)
        }
    }

    static func parseItems(_ call: CAPPluginCall) -> [LiveItem] {
        (call.getArray("items", JSObject.self) ?? []).compactMap { i in
            guard let id = i["id"] as? String, let label = i["label"] as? String else { return nil }
            return LiveItem(id: id, label: label, icon: (i["icon"] as? String) ?? "🛒", cat: i["cat"] as? String, shop: i["shop"] as? String)
        }
    }

    // Izdelki, odkljukani na zaklenjenem zaslonu, odkar je bila aplikacija nazadnje odprta.
    @objc func takeDone(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let d = UserDefaults.standard.dictionary(forKey: "live.done") as? [String: Double] ?? [:]
            UserDefaults.standard.removeObject(forKey: "live.done")
            call.resolve(["ids": d])
        }
    }

    @objc func shopping(_ call: CAPPluginCall) {
        let active = call.getBool("active") ?? false
        let store = call.getString("store") ?? "Nakupovanje"
        let items = Self.parseItems(call)
        let done = call.getInt("done") ?? 0
        let total = call.getInt("total") ?? 0
        let updateOnly = call.getBool("updateOnly") ?? false
        let storeId = call.getString("storeId")
        // Trgovina, ki je iPhone (še) ne pozna: koordinate in pravila pošlje aplikacija.
        var place: GeoStore?
        if let sid = storeId, let lat = call.getDouble("lat"), let lon = call.getDouble("lon") {
            place = GeoStore(id: sid, name: store, lat: lat, lon: lon, chain: call.getString("chain"), only: call.getString("only"))
        }
        DispatchQueue.main.async {
            GeoManager.shared.shopping(active: active, store: store, storeId: storeId, place: place, items: items, done: done, total: total, updateOnly: updateOnly)
            call.resolve()
        }
    }

    // Velikost prikaza za starejše: iPhone poveča celo stran enakomerno.
    @objc func setZoom(_ call: CAPPluginCall) {
        let zoom = min(max(call.getDouble("zoom") ?? 1, 0.8), 1.6)
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.pageZoom = CGFloat(zoom)
            call.resolve()
        }
    }

    @objc func takePendingStore(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var id = GeoManager.shared.pendingStoreId
            GeoManager.shared.pendingStoreId = nil
            // Tap na seznam na zaklenjenem zaslonu: odpremo trgovino, v kateri si.
            if id == "live", let sid = GeoManager.shared.sessionStoreId { id = sid }
            call.resolve(["storeId": id ?? ""])
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                var st = GeoManager.shared.status()
                st["notifications"] = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                st["precise"] = CLLocationManager().accuracyAuthorization == .fullAccuracy
                call.resolve(st)
            }
        }
    }

    // Sistemsko vprašanje »Spremeni v Vedno dovoli« (iOS ga pokaže samo enkrat).
    @objc func requestAlways(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GeoManager.shared.requestAlways(); call.resolve() }
    }

    // Čas poti do trgovine (Apple Zemljevidi): z avtom in peš, v minutah.
    @objc func routeInfo(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else { return call.reject("ni koordinat") }
        let dest = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon)))
        var out: [String: Any] = [:]
        let group = DispatchGroup()
        for (key, type) in [("drive", MKDirectionsTransportType.automobile), ("walk", MKDirectionsTransportType.walking)] {
            let req = MKDirections.Request()
            req.source = .forCurrentLocation()
            req.destination = dest
            req.transportType = type
            group.enter()
            MKDirections(request: req).calculateETA { res, _ in
                DispatchQueue.main.async {
                    if let r = res {
                        out[key + "Min"] = Int((r.expectedTravelTime / 60).rounded(.up))
                        out[key + "M"] = Int(r.distance)
                    }
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) { call.resolve(out) }
    }

    // Zemljevid s potjo do trgovine in gumbi za navigacijo (Apple Zemljevidi, Google Zemljevidi, Waze).
    @objc func showRoute(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else { return call.reject("ni koordinat") }
        let name = call.getString("name") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else { return call.reject("ni zaslona") }
            let r = RouteViewController(dest: CLLocationCoordinate2D(latitude: lat, longitude: lon), name: name)
            r.modalPresentationStyle = .pageSheet
            if let sheet = r.sheetPresentationController {
                sheet.detents = [.large()]
                sheet.prefersGrabberVisible = true
            }
            vc.present(r, animated: true)
            call.resolve()
        }
    }

    // Odpre Nastavitve → Nakupko (lokacija »Vedno«, obvestila).
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}

// Pot do trgovine na zemljevidu (MapKit): z avtom ali peš, čas in razdalja, en dotik do navigacije.
final class RouteViewController: UIViewController, MKMapViewDelegate {
    private let dest: CLLocationCoordinate2D
    private let name: String
    private let map = MKMapView()
    private let mode = UISegmentedControl(items: [L10n.t("routeCar"), L10n.t("routeWalk")])
    private let eta = UILabel()
    private let purple = UIColor(red: 0.54, green: 0.25, blue: 0.99, alpha: 1)

    init(dest: CLLocationCoordinate2D, name: String) {
        self.dest = dest
        self.name = name
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) ni podprt") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        map.delegate = self
        map.showsUserLocation = true
        map.translatesAutoresizingMaskIntoConstraints = false
        let pin = MKPointAnnotation()
        pin.coordinate = dest
        pin.title = name
        map.addAnnotation(pin)
        view.addSubview(map)

        let title = UILabel()
        title.text = name
        title.font = .systemFont(ofSize: 24, weight: .heavy)
        title.numberOfLines = 2
        eta.font = .systemFont(ofSize: 17, weight: .semibold)
        eta.textColor = .secondaryLabel
        mode.selectedSegmentIndex = 0
        mode.addTarget(self, action: #selector(route), for: .valueChanged)
        let lat = dest.latitude, lon = dest.longitude
        let go = button(L10n.t("routeGo"), filled: true) { [weak self] in self?.openAppleMaps() }
        let google = button("Google Maps", filled: false) { [weak self] in
            let m = self?.mode.selectedSegmentIndex == 1 ? "walking" : "driving"
            self?.open("https://www.google.com/maps/dir/?api=1&destination=\(lat),\(lon)&travelmode=\(m)")
        }
        let waze = button("Waze", filled: false) { [weak self] in self?.open("https://waze.com/ul?ll=\(lat),\(lon)&navigate=yes") }
        let close = button(L10n.t("routeClose"), filled: false) { [weak self] in self?.dismiss(animated: true) }
        let row = UIStackView(arrangedSubviews: [google, waze])
        row.distribution = .fillEqually
        row.spacing = 10
        let stack = UIStackView(arrangedSubviews: [title, eta, mode, go, row, close])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            map.topAnchor.constraint(equalTo: view.topAnchor),
            map.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            map.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            map.bottomAnchor.constraint(equalTo: stack.topAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
        route()
    }

    private func button(_ text: String, filled: Bool, action: @escaping () -> Void) -> UIButton {
        var c: UIButton.Configuration = filled ? .filled() : .tinted()
        c.title = text
        c.cornerStyle = .capsule
        c.baseBackgroundColor = filled ? purple : purple.withAlphaComponent(0.15)
        c.baseForegroundColor = filled ? .white : purple
        c.buttonSize = .large
        return UIButton(configuration: c, primaryAction: UIAction { _ in action() })
    }

    @objc private func route() {
        let req = MKDirections.Request()
        req.source = .forCurrentLocation()
        req.destination = MKMapItem(placemark: MKPlacemark(coordinate: dest))
        req.transportType = mode.selectedSegmentIndex == 1 ? .walking : .automobile
        eta.text = "…"
        MKDirections(request: req).calculate { [weak self] res, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.map.removeOverlays(self.map.overlays)
                guard let r = res?.routes.first else {
                    self.eta.text = L10n.t("routeNone")
                    self.map.setRegion(MKCoordinateRegion(center: self.dest, latitudinalMeters: 1200, longitudinalMeters: 1200), animated: false)
                    return
                }
                let dist = r.distance < 1000 ? "\(Int((r.distance / 10).rounded() * 10)) m" : String(format: "%.1f km", r.distance / 1000)
                self.eta.text = L10n.t("routeEta", ["\(Int((r.expectedTravelTime / 60).rounded(.up)))", dist])
                self.map.addOverlay(r.polyline)
                self.map.setVisibleMapRect(r.polyline.boundingMapRect, edgePadding: UIEdgeInsets(top: 60, left: 40, bottom: 40, right: 40), animated: true)
            }
        }
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        let r = MKPolylineRenderer(overlay: overlay)
        r.strokeColor = purple
        r.lineWidth = 6
        return r
    }

    private func openAppleMaps() {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: dest))
        item.name = name
        let m = mode.selectedSegmentIndex == 1 ? MKLaunchOptionsDirectionsModeWalking : MKLaunchOptionsDirectionsModeDriving
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: m])
    }

    private func open(_ s: String) {
        if let u = URL(string: s) { UIApplication.shared.open(u) }
    }
}

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NakupkoGeoPlugin())
        bridge?.registerPluginInstance(NakupkoPayPlugin())
    }
}
