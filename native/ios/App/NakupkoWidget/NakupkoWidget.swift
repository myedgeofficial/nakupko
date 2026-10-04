import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// Seznam na zaklenjenem zaslonu med nakupovanjem, urejen po oddelkih trgovine.
@main
struct NakupkoWidgets: WidgetBundle {
    var body: some Widget {
        ShoppingLiveActivity()
    }
}

private let orange = Color(red: 0.95, green: 0.42, blue: 0.11)
private let maxShown = LiveList.perPage

struct ShoppingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShoppingAttributes.self) { context in
            LockScreenList(store: context.attributes.store, state: context.state)
                .widgetURL(URL(string: "nakupko://seznam"))
                .activityBackgroundTint(Color.white)
                .activitySystemActionForegroundColor(orange)
        } dynamicIsland: { context in
            let left = context.state.items.count
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.store, systemImage: "cart.fill").font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.done)/\(context.state.total)").font(.headline).foregroundColor(orange)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ItemGrid(items: context.state.items, page: 0, shown: 4, dark: true, big: false)
                }
            } compactLeading: {
                Image(systemName: "cart.fill").foregroundColor(orange)
            } compactTrailing: {
                Text("\(left)").foregroundColor(orange)
            } minimal: {
                Text("\(left)").foregroundColor(orange)
            }
        }
    }
}

struct LockScreenList: View {
    let store: String
    let state: ShoppingAttributes.ContentState

    var body: some View {
        // iOS dovoli Live Activity visoko največ ~160 pt: brez vrstice napredka, da izdelki dobijo več prostora.
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(store, systemImage: "cart.fill").font(.headline).foregroundColor(.black).lineLimit(1)
                Spacer()
                Text(state.items.isEmpty ? "Vse v košarici ✓" : "\(state.done)/\(state.total)")
                    .font(.headline).foregroundColor(orange)
            }
            ItemGrid(items: state.items, page: state.page ?? 0, shown: maxShown, dark: false, big: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

// Izdelki v dveh stolpcih; tap odkljuka izdelek, naslednji se pomaknejo gor.
struct ItemGrid: View {
    let items: [LiveItem]
    let page: Int
    let shown: Int
    let dark: Bool
    let big: Bool

    var body: some View {
        let start = page * shown < items.count ? page * shown : 0
        let list = Array(items[start..<min(start + shown, items.count)])
        let rows = stride(from: 0, to: list.count, by: 2).map { Array(list[$0..<min($0 + 2, list.count)]) }
        let hidden = items.count - list.count
        VStack(alignment: .leading, spacing: 5) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 6) {
                    ForEach(row, id: \.self) { item in
                        Button(intent: CheckItemIntent(itemId: item.id)) {
                            HStack(spacing: 5) {
                                Image(systemName: "circle").font(big ? .body : .footnote).foregroundColor(orange)
                                Text(item.icon + " " + item.label)
                                    .font(big ? .callout.weight(.medium) : .footnote)
                                    .foregroundColor(dark ? .white : .black)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, big ? 7 : 5)
                            .padding(.horizontal, big ? 9 : 7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 9).fill(dark ? Color.white.opacity(0.12) : orange.opacity(0.08)))
                        }
                        .buttonStyle(.plain)
                    }
                    if row.count == 1 { Spacer().frame(maxWidth: .infinity) }
                }
            }
            if big {
                HStack(spacing: 8) {
                    Link(destination: URL(string: "nakupko://seznam")!) {
                        Label("Odpri seznam", systemImage: "list.bullet")
                            .font(.footnote.weight(.semibold))
                            .foregroundColor(orange)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(orange.opacity(0.12)))
                    }
                    Spacer()
                    if hidden > 0 {
                        Text("\(start + 1)–\(start + list.count) od \(items.count)").font(.caption).foregroundColor(.gray)
                        Button(intent: NextPageIntent()) {
                            Text(start + list.count >= items.count ? "Na začetek ↺" : "Naprej ›")
                                .font(.footnote.weight(.semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 5)
                                .background(Capsule().fill(orange))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if hidden > 0 {
                Text("in še \(hidden) …").font(.caption).foregroundColor(.gray)
            }
        }
    }
}
