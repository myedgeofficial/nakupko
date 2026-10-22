import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        if let id = SceneDelegate.pending(connectionOptions.urlContexts) { GeoManager.shared.pendingStoreId = id }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // »Odpri seznam« na zaklenjenem zaslonu (nakupko://seznam): native.js odpre nakupovanje.
        // Seznam s spletne strani nakupko.com (nakupko://dodaj?i=Mleko|Kruh): native.js doda izdelke.
        if let id = SceneDelegate.pending(URLContexts) { GeoManager.shared.pendingStoreId = id }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    static func pending(_ contexts: Set<UIOpenURLContext>) -> String? {
        guard let url = contexts.first(where: { $0.url.scheme == "nakupko" })?.url else { return nil }
        if url.host == "dodaj" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "i" })?.value ?? ""
            return items.isEmpty ? nil : "import:" + items
        }
        // QR »Poveži s telefonom« na nakupko.com (nakupko://povezi?k=PARKODA)
        if url.host == "povezi" {
            let k = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "k" })?.value ?? ""
            return k.isEmpty ? nil : "povezi:" + k
        }
        return "live"
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
