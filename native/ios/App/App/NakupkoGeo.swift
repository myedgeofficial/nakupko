import Foundation
import UIKit
import CoreLocation
import UserNotifications
import Capacitor

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
    private let renotifyAfter: TimeInterval = 45 * 60

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
    private var items: [String] {
        get { defaults.stringArray(forKey: "geo.items") ?? [] }
        set { defaults.set(newValue, forKey: "geo.items") }
    }
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
        manager.pausesLocationUpdatesAutomatically = true
        UNUserNotificationCenter.current().delegate = self
        if enabled { startBackgroundMonitoring() }
    }

    func configure(enabled on: Bool, radius r: Double, stores list: [GeoStore], items open: [String]) {
        radius = r
        items = open
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
        return ["enabled": enabled, "authorization": auth, "regions": manager.monitoredRegions.count, "stores": stores.count]
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
            manager.requestWhenInUseAuthorization()
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
        let r = min(max(radius, 100), 300)
        let nearest = stores
            .map { ($0, loc.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lon))) }
            .filter { $0.1 < 8000 }
            .sorted { $0.1 < $1.1 }
            .prefix(maxStoreRegions)
        let wanted = Set(nearest.map { storePrefix + $0.0.id })
        for region in manager.monitoredRegions where region.identifier.hasPrefix(storePrefix) && !wanted.contains(region.identifier) {
            manager.stopMonitoring(for: region)
        }
        let existing = Set(manager.monitoredRegions.map { $0.identifier })
        for (store, _) in nearest where !existing.contains(storePrefix + store.id) {
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: store.lat, longitude: store.lon), radius: r, identifier: storePrefix + store.id)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            manager.startMonitoring(for: region)
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
        let q = "[out:json][timeout:20];(nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store)$\"](around:5000,\(loc.coordinate.latitude),\(loc.coordinate.longitude)););out center tags 150;"
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
                    let name = (tags["name"] as? String) ?? (tags["brand"] as? String) ?? "Trgovina"
                    return GeoStore(id: "\(e["type"] ?? "n")/\(e["id"] ?? 0)", name: name, lat: lat, lon: lon)
                }
                guard !list.isEmpty else { return }
                self.stores = list
                self.lastFetch = loc
                self.refreshRegions(around: loc)
            }
        }.resume()
    }

    private func notifyEntered(regionId: String) {
        let id = String(regionId.dropFirst(storePrefix.count))
        guard enabled, let store = stores.first(where: { $0.id == id }) else { return }
        let open = items
        guard !open.isEmpty else { return }
        if UIApplication.shared.applicationState == .active { return } // odprta aplikacija to pokaže sama
        let now = Date().timeIntervalSince1970
        var sent = notified
        if let last = sent[id], now - last < renotifyAfter { return }
        sent = sent.filter { now - $0.value < 24 * 3600 }
        sent[id] = now
        notified = sent

        let content = UNMutableNotificationContent()
        content.title = "🛒 \(store.name)"
        let shown = open.prefix(4).joined(separator: ", ")
        content.body = open.count > 4 ? "Na seznamu: \(shown) in še \(open.count - 4)." : "Na seznamu: \(shown)."
        content.sound = .default
        content.userInfo = ["storeId": id]
        let request = UNNotificationRequest(identifier: "store-\(id)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
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
        guard enabled else { return }
        let home = manager.monitoredRegions.first { $0.identifier == homeId } as? CLCircularRegion
        if home == nil || loc.distance(from: CLLocation(latitude: home!.center.latitude, longitude: home!.center.longitude)) > homeRadius * 0.6 {
            refreshRegions(around: loc)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard watching else { return }
        let denied = (error as? CLError)?.code == .denied
        onError?(["code": denied ? 1 : 2, "message": error.localizedDescription])
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        if region.identifier.hasPrefix(storePrefix) { notifyEntered(regionId: region.identifier) }
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
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
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
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
        let items = call.getArray("items", String.self) ?? []
        let stores: [GeoStore] = (call.getArray("stores", JSObject.self) ?? []).compactMap { s in
            guard let id = s["id"] as? String,
                  let lat = (s["lat"] as? NSNumber)?.doubleValue,
                  let lon = (s["lon"] as? NSNumber)?.doubleValue else { return nil }
            return GeoStore(id: id, name: (s["name"] as? String) ?? "Trgovina", lat: lat, lon: lon)
        }
        DispatchQueue.main.async {
            GeoManager.shared.configure(enabled: on, radius: radius, stores: stores, items: items)
            call.resolve()
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(GeoManager.shared.status()) }
    }
}

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NakupkoGeoPlugin())
    }
}
