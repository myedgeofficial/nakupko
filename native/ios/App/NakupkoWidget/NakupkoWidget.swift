import ActivityKit
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
private let maxRows = 6

struct ShoppingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShoppingAttributes.self) { context in
            LockScreenList(store: context.attributes.store, state: context.state)
                .activityBackgroundTint(Color.white)
                .activitySystemActionForegroundColor(orange)
        } dynamicIsland: { context in
            let left = max(context.state.total - context.state.done, 0)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.store, systemImage: "cart.fill").font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.done)/\(context.state.total)").font(.headline).foregroundColor(orange)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    GroupRows(groups: context.state.groups, rows: 3, dark: true)
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
                Text(state.total - state.done <= 0 ? "Vse v košarici ✓" : "\(state.done)/\(state.total)")
                    .font(.subheadline.weight(.semibold)).foregroundColor(orange)
            }
            if state.total > 0 {
                ProgressView(value: Double(state.done), total: Double(max(state.total, 1))).tint(orange)
            }
            GroupRows(groups: state.groups, rows: maxRows, dark: false)
        }
        .padding(14)
    }
}

struct GroupRows: View {
    let groups: [ItemGroup]
    let rows: Int
    let dark: Bool

    var body: some View {
        let shown = Array(groups.prefix(rows))
        let hidden = groups.dropFirst(rows).reduce(0) { $0 + $1.items.count }
        VStack(alignment: .leading, spacing: 3) {
            ForEach(shown, id: \.self) { g in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(g.icon).font(.footnote)
                    Text(g.items.joined(separator: " · "))
                        .font(.footnote)
                        .foregroundColor(dark ? .white : .black)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            if hidden > 0 {
                Text("in še \(hidden) …").font(.caption).foregroundColor(.gray)
            }
        }
    }
}
