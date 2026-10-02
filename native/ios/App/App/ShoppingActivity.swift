import Foundation
import ActivityKit

// Skupno za aplikacijo in pripomoček na zaklenjenem zaslonu (Live Activity).
struct ItemGroup: Codable, Hashable {
    var icon: String
    var name: String
    var items: [String]
}

struct ShoppingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var groups: [ItemGroup]
        var done: Int
        var total: Int
    }
    var store: String
}
