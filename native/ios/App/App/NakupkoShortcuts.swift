import AppIntents

// »Odpri Nakupko« kot bližnjica: brez nastavljanja se pokaže pri gumbu Akcija
// (Nastavitve → Gumb Akcija → Bližnjica → Nakupko), v Spotlightu in pri Siri.
struct OpenNakupkoIntent: AppIntent {
    static var title: LocalizedStringResource = "Odpri Nakupko"
    static var description = IntentDescription("Odpre nakupovalni seznam.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult { .result() }
}

struct NakupkoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenNakupkoIntent(),
            phrases: ["Odpri \(.applicationName)", "Open \(.applicationName)", "Seznam v \(.applicationName)"],
            shortTitle: "Odpri Nakupko",
            systemImageName: "basket"
        )
    }
}
