# Pripravi novo verzijo v App Store Connect: ustvari verzijo, doda zadnji build te verzije
# in vpiše »Kaj je novega« v vseh jezikih. V pregled je NE odda (to naredi človek).
# Okolje: KEY_ID, ISSUER_ID, KEY_P8, VERZIJA, BUNDLE_ID; besedila v .github/scripts/kaj-je-novega.json.
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

b = None
for _ in range(40):  # build se po nalaganju še obdeluje
    bs = klic("GET", f"/builds?filter[app]={app['id']}&filter[preReleaseVersion.version]={verzija}&sort=-uploadedDate&limit=1")["data"]
    if bs and bs[0]["attributes"]["processingState"] == "VALID":
        b = bs[0]; break
    print("Čakam na build …", bs[0]["attributes"]["processingState"] if bs else "ga še ni")
    time.sleep(30)
if not b:
    sys.exit("::error::Build za verzijo " + verzija + " ni pripravljen.")
if b["attributes"].get("usesNonExemptEncryption") is None:
    klic("PATCH", f"/builds/{b['id']}", {"data": {"type": "builds", "id": b["id"], "attributes": {"usesNonExemptEncryption": False}}})
klic("PATCH", f"/appStoreVersions/{v['id']}/relationships/build", {"data": {"type": "builds", "id": b["id"]}})
print("Dodan build", b["attributes"]["version"])

for lok in klic("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")["data"]:
    jezik = lok["attributes"]["locale"]
    txt = besedila.get(jezik) or besedila.get(jezik.split("-")[0]) or besedila["en"]
    klic("PATCH", f"/appStoreVersionLocalizations/{lok['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": lok["id"], "attributes": {"whatsNew": txt}}})
    print("Kaj je novega:", jezik)
print("Pripravljeno. V App Store Connect klikni »Add for Review« in »Submit for Review«.")
