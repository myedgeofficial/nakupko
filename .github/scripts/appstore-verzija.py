# Pripravi novo verzijo v App Store Connect: ustvari verzijo, doda zadnji build te verzije
# in vpiše »Kaj je novega« v vseh jezikih. V pregled je NE odda (to naredi človek).
# Nastavi tudi samodejno objavo po odobritvi, prenese manjkajoča polja s prejšnje verzije in preveri, kaj bi še oviralo oddajo.
# Okolje: KEY_ID, ISSUER_ID, KEY_P8, VERZIJA, BUNDLE_ID, NAJMANJ_BUILD (build mora biti vsaj tako nov, npr. 202610281200);
# besedila v .github/scripts/kaj-je-novega.json.
import json, os, re, sys, textwrap, time, urllib.request, urllib.error
import jwt

API = "https://api.appstoreconnect.apple.com/v1"
# Ključ je lahko shranjen v eni vrstici ali brez vrstic BEGIN/END (kot v ios.yml).
raw = os.environ["KEY_P8"].replace("﻿", "").replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1100, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})

def klic(metoda, pot, telo=None):
    req = urllib.request.Request(pot if pot.startswith("http") else API + pot, method=metoda,
                                 data=json.dumps(telo).encode() if telo else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            b = r.read()
            return json.loads(b) if b else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"::error::{metoda} {pot}: {e.code} {e.read().decode()[:600]}")

verzija, bundle = os.environ["VERZIJA"], os.environ["BUNDLE_ID"]
besedila = json.load(open(os.path.join(os.path.dirname(__file__), "kaj-je-novega.json"), encoding="utf8"))
app = klic("GET", f"/apps?filter[bundleId]={bundle}")["data"][0]
print("Aplikacija:", app["attributes"]["name"])

vs = klic("GET", f"/apps/{app['id']}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
v = next((x for x in vs if x["attributes"]["versionString"] == verzija), None)
if not v:
    v = klic("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions", "attributes": {"platform": "IOS", "versionString": verzija},
             "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}})["data"]
    print("Ustvarjena verzija", verzija)
else:
    print("Verzija že obstaja:", verzija, v["attributes"]["appStoreState"])

# samodejna objava po odobritvi; avtorske pravice s prejšnje verzije, če manjkajo
prej = next((x for x in vs if x["id"] != v["id"] and x["attributes"]["appStoreState"] in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION")), None)
attrs = {"releaseType": "AFTER_APPROVAL"}
if not v["attributes"].get("copyright"):
    attrs["copyright"] = (prej and prej["attributes"].get("copyright")) or time.strftime("%Y") + " Nakupko"
klic("PATCH", f"/appStoreVersions/{v['id']}", {"data": {"type": "appStoreVersions", "id": v["id"], "attributes": attrs}})
print("Objava po odobritvi: samodejno; copyright:", attrs.get("copyright") or v["attributes"]["copyright"])

najmanj = os.environ.get("NAJMANJ_BUILD", "").strip()
b = None
for _ in range(80):  # build se po nalaganju še obdeluje
    bs = klic("GET", f"/builds?filter[app]={app['id']}&filter[preReleaseVersion.version]={verzija}&sort=-uploadedDate&limit=1")["data"]
    nov = bs and (not najmanj or bs[0]["attributes"]["version"] >= najmanj)
    if nov and bs[0]["attributes"]["processingState"] == "VALID":
        b = bs[0]; break
    print("Čakam na build …", (bs[0]["attributes"]["version"] + " " + bs[0]["attributes"]["processingState"]) if bs else "ga še ni", "(najmanj " + (najmanj or "-") + ")")
    time.sleep(30)
if not b:
    sys.exit("::error::Novega builda za verzijo " + verzija + " še ni. Najprej zaženi gradnjo iOS za App Store.")
if b["attributes"].get("usesNonExemptEncryption") is None:
    klic("PATCH", f"/builds/{b['id']}", {"data": {"type": "builds", "id": b["id"], "attributes": {"usesNonExemptEncryption": False}}})
klic("PATCH", f"/appStoreVersions/{v['id']}/relationships/build", {"data": {"type": "builds", "id": b["id"]}})
print("Dodan build", b["attributes"]["version"])

# prejšnja besedila (promocijsko besedilo, opis …) za jezike, kjer manjkajo
stari = {}
if prej:
    for l in klic("GET", f"/appStoreVersions/{prej['id']}/appStoreVersionLocalizations?limit=50")["data"]:
        stari[l["attributes"]["locale"]] = l["attributes"]
tezave = []
for lok in klic("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")["data"]:
    jezik, a = lok["attributes"]["locale"], lok["attributes"]
    txt = besedila.get(jezik) or besedila.get(jezik.split("-")[0]) or besedila["en"]
    nova = {"whatsNew": txt}
    for k in ("promotionalText", "description", "keywords", "supportUrl", "marketingUrl"):
        if not a.get(k) and stari.get(jezik, {}).get(k):
            nova[k] = stari[jezik][k]
    klic("PATCH", f"/appStoreVersionLocalizations/{lok['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": lok["id"], "attributes": nova}})
    print("Kaj je novega:", jezik, "(preneseno: " + ", ".join(k for k in nova if k != "whatsNew") + ")" if len(nova) > 1 else "")
    sets = klic("GET", f"/appStoreVersionLocalizations/{lok['id']}/appScreenshotSets?limit=50")["data"]
    if not sets:
        tezave.append(jezik + ": ni posnetkov zaslona")
    if not (a.get("description") or nova.get("description")):
        tezave.append(jezik + ": ni opisa")

# starostna ocena: vsa vprašanja morajo biti odgovorjena
for info in klic("GET", f"/apps/{app['id']}/appInfos")["data"]:
    if info["attributes"].get("appStoreState") in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION"):
        continue
    ar = klic("GET", f"/appInfos/{info['id']}/ageRatingDeclaration").get("data") or {}
    prazna = [k for k, x in (ar.get("attributes") or {}).items() if x is None]
    if prazna:
        tezave.append("starostna ocena: neodgovorjeno " + ", ".join(prazna))
if tezave:
    print("::warning::Preveri v App Store Connect: " + "; ".join(tezave))
print("Pripravljeno. V App Store Connect klikni »Add for Review« in »Submit for Review«.")
