# Nakupko za iOS

iOS aplikacija je ovoj (Capacitor) okoli spletne aplikacije v korenu repozitorija.
Spletne datoteke ostanejo, kot so: `scripts/build-www.js` jih ob gradnji skopira v `www/`
in doda `web/native.js` (lokacija prek iPhona + sinhronizacija s spremljanjem v ozadju).

## Kaj dela, ko je aplikacija zaprta

- iOS spremlja 19 najbližjih trgovin (geofence) in večje območje okoli tebe.
- Ko prideš v trgovino in imaš kaj na seznamu, dobiš obvestilo z izdelki.
- Ko se premakneš (npr. v drug kraj), iPhone sam izbere nove trgovine in jih po potrebi naloži iz OpenStreetMap.
- Potrebno dovoljenje: Lokacija **Vedno** in Obvestila.

## Gradnja brez Maca

GitHub Actions (`.github/workflows/ios.yml`) na vsak push na `main` zgradi aplikacijo in jo naloži na TestFlight.
Na PR-jih samo preveri, da se zgradi.

Enkratna nastavitev (Apple Developer račun):

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → + → App IDs → App → Bundle ID `si.nakupko.app`.
2. appstoreconnect.apple.com → Apps → + → New App → iOS, ime Nakupko, Bundle ID `si.nakupko.app`, SKU `nakupko`.
3. App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → + → dostop **Admin**. Prenesi `.p8` in si zapiši Key ID in Issuer ID.
4. GitHub → Settings → Secrets and variables → Actions → New repository secret:
   - `APPSTORE_KEY_ID` – Key ID
   - `APPSTORE_ISSUER_ID` – Issuer ID
   - `APPSTORE_KEY_P8` – celotna vsebina datoteke `.p8`
   - `APPLE_TEAM_ID` – Team ID (developer.apple.com → Membership)
5. Actions → iOS aplikacija → Run workflow.

Drug Bundle ID: nastavi repozitorijsko spremenljivko `IOS_BUNDLE_ID`.

## Lokalno (z Macom)

```
cd native
npm ci
npm run sync
open ios/App/App.xcodeproj
```
