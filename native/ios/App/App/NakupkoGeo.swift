import Foundation
import UIKit
import CoreLocation
import UserNotifications
import Capacitor
import ActivityKit

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
    private var radius: Double {
        get { max(defaults.double(forKey: "geo.radius"), 75) }
        set { defaults.set(newValue, forKey: "geo.radius") }
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
    // Druga stopnja: po obvestilu »blizu si« spremljamo natančno lokacijo, dokler ne obstaneš pri trgovini.
    private struct Arrival { let store: GeoStore; let open: [ItemGroup]; let items: [LiveItem]; let count: Int; let started: Date; var stillSince: Date?; var wantNear = false }
    private var arrival: Arrival?
    private let arrivalRadius: CLLocationDistance = 60
    // Obvestilo »blizu« šele, ko si res pri trgovini (ne že na robu 250-metrskega območja ali v mimovožnji).
    private let nearRadius: CLLocationDistance = 120
    private let nearMaxSpeed: CLLocationSpeed = 7   // ~25 km/h
    private let arrivalDwell: TimeInterval = 12
    private let arrivalTimeout: TimeInterval = 8 * 60
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
            return LiveItem(id: id, label: label, icon: iconById[id] ?? categories[catIndex(i)].1, cat: categories[catIndex(i)].0)
        }
    }

    // Trgovina iz obvestila, ki ga je uporabnik tapnil (native.js takoj odpre nakupovanje).
    var pendingStoreId: String?
    private var shoppingFrom: CLLocation?
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

    func configure(enabled on: Bool, radius r: Double, stores list: [GeoStore], groups open: [ItemGroup], items: [LiveItem], household hh: Household?) {
        radius = r
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
            onError?(["code": 1, "message": "Dostop do lokacije je zavrnjen."])
        }
        manager.startUpdatingLocation()
    }

    func stopWatch() {
        watching = false
        manager.stopUpdatingLocation()
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
        let q = "[out:json][timeout:20];(nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store|chemist)$\"](around:5000,\(loc.coordinate.latitude),\(loc.coordinate.longitude)););out center tags 150;"
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
                let list: [GeoStore] = elements.compactMap { e in
                    let tags = e["tags"] as? [String: Any] ?? [:]
                    let center = e["center"] as? [String: Any]
                    guard let lat = (e["lat"] as? Double) ?? (center?["lat"] as? Double),
                          let lon = (e["lon"] as? Double) ?? (center?["lon"] as? Double) else { return nil }
                    let name = (tags["name"] as? String) ?? (tags["brand"] as? String) ?? (tags["operator"] as? String) ?? "Trgovina"
                    let hours = (tags["opening_hours"] as? String) ?? ""
                    let text = [tags["brand"], tags["name"], tags["operator"]].compactMap { $0 as? String }.joined(separator: " ")
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
        let key = "\(hh.code)/\(hh.member)/\(token)/\(hh.name)"
        if pushTokenSentFor == key { return }
        guard let url = URL(string: "\(hh.url)/h/\(hh.code)/members/\(hh.member).json") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["ios": token, "name": hh.name, "platform": "ios"])
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
        guard let hh = household, let url = URL(string: "\(hh.url)/h/\(hh.code)/items.json") else { return showStoreNotification(regionId: regionId, open: groups, items: liveItems) }
        // Partner je morda kaj dodal, medtem ko je bila aplikacija zaprta: preberemo skupen seznam.
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                var open = self.groups
                var live = self.liveItems
                if let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let all = obj.values.compactMap { $0 as? [String: Any] }
                    open = Self.groupsOf(items: all)
                    live = Self.liveItemsOf(items: all, known: self.liveItems)
                    self.groups = open
                    self.liveItems = live
                } else if let data = data, String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "null" {
                    open = []
                    live = []
                }
                self.showStoreNotification(regionId: regionId, open: open, items: live)
                app.endBackgroundTask(task)
            }
        }.resume()
    }

    private func showStoreNotification(regionId: String, open: [ItemGroup], items: [LiveItem]) {
        let id = String(regionId.dropFirst(storePrefix.count))
        guard enabled, let store = stores.first(where: { $0.id == id }) else { return log("  preskok: trgovine ni na seznamu") }
        // Samo izdelki, ki jih ta trgovina prodaja (npr. v Proteini.si samo športna prehrana).
        let open = open.compactMap { g -> ItemGroup? in
            let its = g.items.filter { store.sells("\(g.name) \($0)") }
            return its.isEmpty ? nil : ItemGroup(icon: g.icon, name: g.name, items: its)
        }
        let items = items.filter { store.sells("\($0.cat ?? "Drugo") \($0.label)") }
        let count = open.reduce(0) { $0 + $1.items.count }
        // Tudi brez obvestila zase spremljamo prihod, da partner izve, ko si res v trgovini.
        let visitOnly = { [weak self] in
            guard let self = self, let hh = self.household, !hh.member.isEmpty else { return }
            self.startArrivalWatch(Arrival(store: store, open: [], items: [], count: 0, started: Date(), stillSince: nil))
        }
        guard count > 0 else { visitOnly(); return log("  preskok: seznam je prazen") }
        if UIApplication.shared.applicationState == .active { visitOnly(); return log("  preskok: aplikacija je odprta") }
        // Zaprta trgovina (npr. ob 6h pred Sparom, ki odpre ob 7:30): brez obvestila.
        if !mayBeOpen(store) { return log("  preskok: trgovina je zaprta (\(store.hours ?? "?"))") }
        let now = Date().timeIntervalSince1970
        var sent = notified
        if let last = sent[id], now - last < renotifyAfter { visitOnly(); return log("  preskok: obvestilo pred \(Int(now - last)) s") }
        sent = sent.filter { now - $0.value < 24 * 3600 }
        sent[id] = now
        notified = sent

        // 1. stopnja: »blizu si« (+ namig, če je bližnja trgovina občutno cenejša) – pošlje checkArrival,
        // ko si do ~120 m od trgovine in ne voziš hitro.
        let lastNear = defaults.double(forKey: "geo.lastNear")
        var wantNear = false
        if defaults.object(forKey: "geo.nearNotify") as? Bool == false { log("  brez obvestila »blizu« (izklopljeno)") }
        else if now - lastNear < nearEvery { log("  brez obvestila »blizu« (zadnje pred \(Int((now - lastNear) / 60)) min)") }
        else { wantNear = true }
        // 2. stopnja: ko obstaneš pri trgovini, se seznam odpre na zaklenjenem zaslonu.
        startArrivalWatch(Arrival(store: store, open: open, items: items, count: count, started: Date(), stillSince: nil, wantNear: wantNear))
    }

    // Delovni čas v OpenStreetMap je pogosto zastarel (npr. Spar do 20h, v resnici do 21h):
    // trgovino štejemo za zaprto šele uro po zapiranju in pol ure pred odprtjem.
    private func mayBeOpen(_ store: GeoStore) -> Bool {
        let now = Date()
        return StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now) != false
            || StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now.addingTimeInterval(-60 * 60)) == true
            || StoreRules.isOpen(hours: store.hours, chain: store.chain, at: now.addingTimeInterval(30 * 60)) == true
    }

    private func postNearNotification(id: String, store: GeoStore, count: Int) {
        let here = CLLocation(latitude: store.lat, longitude: store.lon)
        let dist = manager.location.map { Int(($0.distance(from: here) / 10).rounded() * 10) }
        let content = UNMutableNotificationContent()
        content.title = "🛒 \(store.name) je blizu" + (dist.map { " (\($0) m)" } ?? "")
        var body = "Na seznamu imaš \(count) \(count == 1 ? "izdelek" : count == 2 ? "izdelka" : count < 5 ? "izdelke" : "izdelkov"). Se ustaviš?"
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
        return "\(b.0.name) (\(km) od tu) je za tvoj seznam ≈ \(eur) € cenejši."
    }

    private func startArrivalWatch(_ a: Arrival) {
        arrival = a
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = false
        manager.startUpdatingLocation()
        log("  čakam, da obstaneš pri trgovini")
    }

    private func stopArrivalWatch(_ why: String) {
        guard arrival != nil else { return }
        arrival = nil
        log("  " + why)
        if !watching {
            manager.stopUpdatingLocation()
            manager.allowsBackgroundLocationUpdates = false
        }
    }

    // Klic ob vsaki natančni lokaciji: si že nekaj sekund pri vhodu (počasi ali stojiš)?
    private func checkArrival(_ loc: CLLocation) {
        guard var a = arrival else { return }
        if Date().timeIntervalSince(a.started) > arrivalTimeout { return stopArrivalWatch("nisi se ustavil – konec spremljanja") }
        let d = loc.distance(from: CLLocation(latitude: a.store.lat, longitude: a.store.lon))
        let near = d <= arrivalRadius + min(max(loc.horizontalAccuracy, 0), 40)
        let slow = loc.speed < 0 || loc.speed < 2.0
        if a.wantNear && d <= nearRadius + min(max(loc.horizontalAccuracy, 0), 30) && (loc.speed < 0 || loc.speed < nearMaxSpeed) {
            a.wantNear = false
            arrival = a
            let now = Date().timeIntervalSince1970
            if now - defaults.double(forKey: "geo.lastNear") >= nearEvery {
                defaults.set(now, forKey: "geo.lastNear")
                postNearNotification(id: a.store.id, store: a.store, count: a.count)
            }
        }
        if near && slow {
            if a.stillSince == nil { a.stillSince = Date() }
            arrival = a
            if Date().timeIntervalSince(a.stillSince!) >= arrivalDwell {
                stopArrivalWatch("prišel si v trgovino (\(Int(d)) m)")
                arrived(a)
            }
        } else if a.stillSince != nil {
            a.stillSince = nil
            arrival = a
        }
    }

    private func arrived(_ a: Arrival) {
        let id = a.store.id, store = a.store, open = a.open, count = a.count, items = a.items
        // Partner izve šele, ko si res v trgovini (ne ko se pelješ mimo).
        reportVisit(storeId: id)
        if count == 0 || UIApplication.shared.applicationState == .active { return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["store-\(id)"])
        // iOS 17.2+: strežnik na zaklenjenem zaslonu odpre seznam, ki ga lahko kljukaš. Sicer navadno obvestilo.
        if !items.isEmpty, startLive(store: store.name, items: items, completion: { [weak self] ok in
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
                } else {
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
        content.title = "🛒 \(store.name) · \(count) \(count == 1 ? "izdelek" : count == 2 ? "izdelka" : count < 5 ? "izdelki" : "izdelkov")"
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
            "done": 0, "total": list.count
        ]
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 6
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token, "store": store, "state": state, "at": [".sv": "timestamp"]])
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask { app.endBackgroundTask(task) }
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { completion(ok); app.endBackgroundTask(task) }
        }.resume()
        return true
    }

    // Ko zapustiš trgovino, seznam z zaklenjenega zaslona umaknemo.
    private func endLive(store: String) {
        for a in Activity<ShoppingAttributes>.activities where a.attributes.store == store {
            Task { await a.end(nil, dismissalPolicy: .default) }
        }
    }

    // ---------- Seznam na zaklenjenem zaslonu (Live Activity) ----------
    func shopping(active: Bool, store: String, items list: [LiveItem], done: Int, total: Int) {
        guard #available(iOS 16.2, *) else { return }
        let current = Activity<ShoppingAttributes>.activities
        guard active else {
            shoppingFrom = nil
            for a in current { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        if shoppingFrom == nil { shoppingFrom = manager.location }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let fitted = LiveList.fit(list)
        let keepPage = current.first(where: { $0.attributes.store == store })?.content.state.page
        let state = ShoppingAttributes.ContentState(items: fitted, done: done, total: total, page: LiveList.clampPage(keepPage, count: fitted.count))
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 3600))
        if let a = current.first(where: { $0.attributes.store == store }) {
            Task { await a.update(content) }
            for other in current where other.id != a.id { Task { await other.end(nil, dismissalPolicy: .immediate) } }
        } else {
            for a in current { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            do {
                _ = try Activity.request(attributes: ShoppingAttributes(store: store), content: content, pushType: nil)
            } catch {
                // Aplikacija je že v ozadju (npr. zaklenil si telefon med odštevanjem): seznam zažene strežnik.
                _ = startLive(store: store, items: list, completion: { _ in })
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
        if (s == .denied || s == .restricted) && watching { onError?(["code": 1, "message": "Dostop do lokacije je zavrnjen."]) }
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
        checkArrival(loc)
        // Ko odideš iz trgovine, seznam z zaklenjenega zaslona umaknemo.
        if let from = shoppingFrom, loc.distance(from: from) > 800 { shopping(active: false, store: "", items: [], done: 0, total: 0) }
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
            if let store = stores.first(where: { $0.id == id }) { log("izhod: " + store.name); endLive(store: store.name) }
            if arrival?.store.id == id { stopArrivalWatch("odpeljal si se mimo") }
            reportLeft(storeId: id)
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
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let geo = GeoManager.shared
        geo.onPosition = { [weak self] data in self?.notifyListeners("position", data: data) }
        geo.onError = { [weak self] data in self?.notifyListeners("locationError", data: data) }
    }

    @objc func startWatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GeoManager.shared.startWatch(); call.resolve() }
    }

    @objc func stopWatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GeoManager.shared.stopWatch(); call.resolve() }
    }

    @objc func setConfig(_ call: CAPPluginCall) {
        let on = call.getBool("enabled") ?? false
        let radius = call.getDouble("radius") ?? 75
        let groups = Self.parseGroups(call)
        let items = Self.parseItems(call)
        let dbUrl = call.getString("dbUrl")
        let nearNotify = call.getBool("nearNotify") ?? true
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
            GeoManager.shared.configure(enabled: on, radius: radius, stores: stores, groups: groups, items: items, household: hh)
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
            return LiveItem(id: id, label: label, icon: (i["icon"] as? String) ?? "🛒", cat: i["cat"] as? String)
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
        DispatchQueue.main.async {
            GeoManager.shared.shopping(active: active, store: store, items: items, done: done, total: total)
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
            let id = GeoManager.shared.pendingStoreId
            GeoManager.shared.pendingStoreId = nil
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

    // Odpre Nastavitve → Nakupko (lokacija »Vedno«, obvestila).
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NakupkoGeoPlugin())
        bridge?.registerPluginInstance(NakupkoPayPlugin())
    }
}
