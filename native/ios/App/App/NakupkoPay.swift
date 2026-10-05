import Foundation
import Capacitor
import StoreKit

// Naročnina Nakupko Plus (1 €/mesec) prek App Store (StoreKit 2), brez strežnika:
// iPhone sam preveri podpisane nakupe (Transaction.currentEntitlements).
enum PayConfig {
    // Enak ID mora imeti naročnina v App Store Connect (Naročnine → Nakupko Plus).
    static var productId: String {
        (Bundle.main.object(forInfoDictionaryKey: "NakupkoPlusProductId") as? String) ?? "si.nakupko.app.plus.mesecno"
    }
}

@objc(NakupkoPayPlugin)
public class NakupkoPayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NakupkoPayPlugin"
    public let jsName = "NakupkoPay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise)
    ]
    private var updates: Task<Void, Never>?

    override public func load() {
        // Obnovitve, nakupi iz drugih naprav, »Vprašaj starše«, vračila: sporočimo spletnemu delu.
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                guard let self = self else { return }
                let s = await self.currentStatus()
                self.notifyListeners("change", data: s)
            }
        }
    }

    deinit { updates?.cancel() }

    private func product() async -> Product? {
        try? await Product.products(for: [PayConfig.productId]).first
    }

    // active: naročnina velja; product: ali izdelek v App Store sploh obstaja (sicer nikogar ne zaklenemo).
    private func currentStatus() async -> [String: Any] {
        var out: [String: Any] = ["active": false, "productId": PayConfig.productId]
        if let p = await product() {
            out["product"] = true
            out["price"] = p.displayPrice
            if let sub = p.subscription {
                out["trialEligible"] = await sub.isEligibleForIntroOffer
                if let intro = sub.introductoryOffer, intro.paymentMode == .freeTrial {
                    out["trialDays"] = Self.days(intro.period)
                }
            }
        } else {
            out["product"] = false
        }
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result, t.productID == PayConfig.productId, t.revocationDate == nil else { continue }
            if let exp = t.expirationDate, exp < Date() { continue }
            out["active"] = true
            if let exp = t.expirationDate { out["expires"] = exp.timeIntervalSince1970 * 1000 }
            out["trial"] = t.offerType == .introductory
        }
        return out
    }

    private static func days(_ p: Product.SubscriptionPeriod) -> Int {
        switch p.unit {
        case .day: return p.value
        case .week: return p.value * 7
        case .month: return p.value * 30
        case .year: return p.value * 365
        @unknown default: return p.value
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        Task { call.resolve(await currentStatus()) }
    }

    @objc func buy(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let p = await product() else {
                call.reject("Naročnina v App Store še ni na voljo.")
                return
            }
            do {
                let result: Product.PurchaseResult
                if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    result = try await p.purchase(confirmIn: scene)
                } else {
                    result = try await p.purchase()
                }
                var s: [String: Any]
                switch result {
                case .success(let v):
                    if case .verified(let t) = v { await t.finish() }
                    s = await currentStatus()
                    s["result"] = "ok"
                case .pending:
                    s = await currentStatus()
                    s["result"] = "pending"
                case .userCancelled:
                    s = await currentStatus()
                    s["result"] = "cancelled"
                @unknown default:
                    s = await currentStatus()
                    s["result"] = "unknown"
                }
                call.resolve(s)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            call.resolve(await currentStatus())
        }
    }

    // Upravljanje naročnine (preklic) v sistemskem oknu App Store.
    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                try? await AppStore.showManageSubscriptions(in: scene)
            } else if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                await UIApplication.shared.open(url)
            }
            call.resolve(await currentStatus())
        }
    }
}
