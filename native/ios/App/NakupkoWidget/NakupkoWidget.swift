import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// Seznam na zaklenjenem zaslonu med nakupovanjem, urejen po oddelkih trgovine.
// Tudi v majhni obliki (.small): Apple Watch in, od iOS 26, zaslon avta v CarPlay.
// Razširitev zato zahteva iOS 18 (aplikacija sama deluje od iOS 17).
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
            LiveRoot(store: context.attributes.store, state: context.state)
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
                    ItemGrid(items: context.state.items, page: 0, shown: 4, dark: true, big: false, lang: context.state.lang)
                }
            } compactLeading: {
                Image(systemName: "cart.fill").foregroundColor(orange)
            } compactTrailing: {
                Text("\(left)").foregroundColor(orange)
            } minimal: {
                Text("\(left)").foregroundColor(orange)
            }
        }
        .supplementalActivityFamilies([.small])
    }
}

// Zaklenjen zaslon ali majhna oblika (CarPlay, Apple Watch).
struct LiveRoot: View {
    let store: String
    let state: ShoppingAttributes.ContentState

    var body: some View {
        if #available(iOS 18.0, *) {
            FamilyAwareList(store: store, state: state)
        } else {
            LockScreenList(store: store, state: state)
        }
    }
}

@available(iOS 18.0, *)
struct FamilyAwareList: View {
    @Environment(\.activityFamily) private var family
    let store: String
    let state: ShoppingAttributes.ContentState

    var body: some View {
        if family == .small {
            SmallList(store: store, state: state)
        } else {
            LockScreenList(store: store, state: state)
        }
    }
}

// Majhna oblika za zaslon avta (CarPlay) in uro: trgovina, napredek in prvi izdelki, brez gumbov.
struct SmallList: View {
    let store: String
    let state: ShoppingAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "cart.fill").foregroundColor(orange)
                Text(store).font(.headline).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(state.done)/\(state.total)").font(.headline).foregroundColor(orange)
            }
            if state.items.isEmpty {
                Text(L10n.t("allDone", lang: state.lang)).font(.subheadline)
            } else {
                ForEach(state.items.prefix(3), id: \.self) { item in
                    Text(item.icon + " " + item.label).font(.subheadline).lineLimit(1)
                }
                if state.items.count > 3 {
                    Text(L10n.t("more", ["\(state.items.count - 3)"], lang: state.lang)).font(.caption).foregroundColor(.secondary)
                }
            }
        }
        .padding(10)
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
                Text(state.items.isEmpty ? L10n.t("allDone", lang: state.lang) : "\(state.done)/\(state.total)")
                    .font(.headline).foregroundColor(orange)
            }
            ItemGrid(items: state.items, page: state.page ?? 0, shown: maxShown, dark: false, big: true, lang: state.lang)
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
    var lang: String? = nil

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
                        Label(L10n.t("openList", lang: lang), systemImage: "list.bullet")
                            .font(.footnote.weight(.semibold))
                            .foregroundColor(orange)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(orange.opacity(0.12)))
                    }
                    Spacer()
                    if hidden > 0 {
                        Text(L10n.t("range", ["\(start + 1)", "\(start + list.count)", "\(items.count)"], lang: lang)).font(.caption).foregroundColor(.gray)
                        Button(intent: NextPageIntent()) {
                            Text(start + list.count >= items.count ? L10n.t("restart", lang: lang) : L10n.t("next", lang: lang))
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
                Text(L10n.t("more", ["\(hidden)"], lang: lang)).font(.caption).foregroundColor(.gray)
            }
        }
    }
}
