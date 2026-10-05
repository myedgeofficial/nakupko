# Nakupko za iOS

iOS aplikacija je ovoj (Capacitor) okoli spletne aplikacije v korenu repozitorija.
Spletne datoteke ostanejo, kot so: `scripts/build-www.js` jih ob gradnji skopira v `www/`
in doda `web/native.js` (lokacija prek iPhona + sinhronizacija s spremljanjem v ozadju).

## Kaj dela, ko je aplikacija zaprta

- iOS spremlja 19 najbližjih trgovin (geofence) in večje območje okoli tebe.
- Ko prideš v trgovino in imaš kaj na seznamu, dobiš obvestilo z izdelki.
- Ko se premakneš (npr. v drug kraj), iPhone sam izbere nove trgovine in jih po potrebi naloži iz OpenStreetMap.
- Obvestilo pokaže ves seznam, razvrščen po oddelkih (sadje, mlečni, drogerija …), ko ga razpreš.
- Med nakupovanjem (način »V trgovini«) je seznam po oddelkih na zaklenjenem zaslonu (Live Activity) in se sproti posodablja.
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

## Naročnina Nakupko Plus (1 €/mesec)

- iPhone: `ios/App/App/NakupkoPay.swift` (StoreKit 2, brez strežnika), okno in vrstica v Nastavitvah: `web/pay.js`.
- ID naročnine: `si.nakupko.app.plus.mesecno` (drug ID: ključ `NakupkoPlusProductId` v Info.plist).
- Način v `web/pay.js` (`NAKUPKO_PLUS_MODE`): `full` (privzeto, brez naročnine se pokaže le okno), `background` (plačljivo le zaznavanje trgovine v ozadju), `support` (vse zastonj).
- Dokler naročnine v App Store Connect ni, aplikacija nikogar ne zaklene.
- App Store Connect: Pogodbe → Paid Apps (podpiše lastnik računa) → Aplikacija → Naročnine → skupina »Nakupko Plus« → naročnina z zgornjim ID-jem, 1 mesec, 0,99 €/1 € → Uvodna ponudba: 1 teden brezplačno (odločitev 2026-10-04: naročnina odklene celo aplikacijo, način `full`).
- Android: Google Play Billing, ko bo aplikacija na Google Play (APK s povezave plačil ne podpira).

# Nakupko za Android

Ista spletna aplikacija v ovoju Capacitor (`android/`). Koda za ozadje je v
`android/app/src/main/java/si/nakupko/app/` (GeoManager = Android različica NakupkoGeo.swift):

- Spremlja do 60 najbližjih trgovin (geofence) in večje območje okoli tebe; ob premiku sam naloži nove trgovine.
- Ko prideš v odprto trgovino in imaš kaj na seznamu, dobiš obvestilo z izdelki po oddelkih.
- Med nakupovanjem je seznam v stalnem obvestilu (tudi na zaklenjenem zaslonu).
- Dovoljenja: Lokacija **Vedno dovoli** in Obvestila.

## Gradnja

GitHub Actions (`.github/workflows/android.yml`) ob vsakem pushu na `main` (ali vejo `android`) zgradi
`Nakupko.apk` in `Nakupko.aab` in ju objavi na
https://github.com/myedgeofficial/nakupko/releases/tag/android

Neposredna povezava za prijatelje: https://github.com/myedgeofficial/nakupko/releases/download/android/Nakupko.apk

Podpisni ključ (enkrat, vedno isti, sicer posodobitve ne gredo čez): GitHub → Settings → Secrets and variables → Actions:
- `ANDROID_KEYSTORE_B64` – keystore v base64
- `ANDROID_KEYSTORE_PASSWORD` – geslo (alias `nakupko`)

Ključa nikoli ne daj v repozitorij.

## Lokalno

```
cd native
npm ci
npm run sync:android
cd android && ./gradlew assembleDebug
```
