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
private let maxShown = 6

struct ShoppingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShoppingAttributes.self) { context in
            LockScreenList(store: context.attributes.store, state: context.state)
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
                    ItemGrid(items: context.state.items, shown: 4, dark: true)
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
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(store, systemImage: "cart.fill").font(.headline).foregroundColor(.black).lineLimit(1)
                Spacer()
                Text(state.items.isEmpty ? "Vse v košarici ✓" : "\(state.done)/\(state.total)")
                    .font(.subheadline.weight(.semibold)).foregroundColor(orange)
            }
            if state.total > 0 {
                ProgressView(value: Double(state.done), total: Double(max(state.total, 1))).tint(orange)
            }
            ItemGrid(items: state.items, shown: maxShown, dark: false)
        }
        .padding(14)
    }
}

// Izdelki v dveh stolpcih; tap odkljuka izdelek, naslednji se pomaknejo gor.
struct ItemGrid: View {
    let items: [LiveItem]
    let shown: Int
    let dark: Bool

    var body: some View {
        let list = Array(items.prefix(shown))
        let rows = stride(from: 0, to: list.count, by: 2).map { Array(list[$0..<min($0 + 2, list.count)]) }
        let hidden = items.count - list.count
        VStack(alignment: .leading, spacing: 5) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 6) {
                    ForEach(row, id: \.self) { item in
                        Button(intent: CheckItemIntent(itemId: item.id)) {
                            HStack(spacing: 5) {
                                Image(systemName: "circle").font(.footnote).foregroundColor(orange)
                                Text(item.icon + " " + item.label)
                                    .font(.footnote)
                                    .foregroundColor(dark ? .white : .black)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 5)
                            .padding(.horizontal, 7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 9).fill(dark ? Color.white.opacity(0.12) : orange.opacity(0.08)))
                        }
                        .buttonStyle(.plain)
                    }
                    if row.count == 1 { Spacer().frame(maxWidth: .infinity) }
                }
            }
            if hidden > 0 {
                Text("in še \(hidden) …").font(.caption).foregroundColor(.gray)
            }
        }
    }
}
