"""Zamenja posnetke zaslona (iPhone) za verzijo VERZIJA v vseh jezikih App Store Connect.
Slike: MAPA/<jezik>/1.jpg … (jezik = sl, en, de, hr, it, hu, fr, es; drugi jeziki dobijo angleške).
Stare iPhone posnetke (vse velikosti) zbriše, nove naloži kot APP_IPHONE_67 (1290x2796). V pregled ne odda.
Okolje: KEY_ID, ISSUER_ID, KEY_P8, BUNDLE_ID, VERZIJA, MAPA."""
import os, re, json, textwrap, time, sys, hashlib, glob
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("﻿", "").replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1150, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
napaka = False


def get(pot, **params):
    r = requests.get(pot if pot.startswith("http") else API + pot, headers=H, params=params, timeout=60)
    if r.status_code >= 400:
        sys.exit(f"::error::GET {pot}: {r.status_code} {r.text[:400]}")
    return r.json()


def poslji(metoda, pot, data):
    global napaka
    r = requests.request(metoda, API + pot, headers=H, json={"data": data}, timeout=120)
    if r.status_code >= 400:
        napaka = True
        print(f"::error::{metoda} {pot}: {r.status_code} {' '.join(r.text.split())[:600]}")
        return {}
    return r.json() if r.text else {}


mapa, verzija = os.environ["MAPA"], os.environ["VERZIJA"]
app = get("/apps", **{"filter[bundleId]": os.environ["BUNDLE_ID"]})["data"][0]
v = next((x for x in get(f"/apps/{app['id']}/appStoreVersions", **{"filter[platform]": "IOS", "limit": 20})["data"]
          if x["attributes"]["versionString"] == verzija), None)
if not v:
    sys.exit(f"::error::Verzije {verzija} v App Store Connect še ni (najprej appstore-verzija).")
print("Verzija", verzija, v["attributes"]["appStoreState"])

for l in get(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations", limit=50)["data"]:
    loc = l["attributes"]["locale"]
    jezik = loc.split("-")[0]
    datoteke = sorted(glob.glob(os.path.join(mapa, jezik, "*.jpg"))) or sorted(glob.glob(os.path.join(mapa, "en", "*.jpg")))
    if not datoteke:
        print("::warning::ni slik za", loc); continue
    sets = get(f"/appStoreVersionLocalizations/{l['id']}/appScreenshotSets", limit=50)["data"]
    for s in sets:
        if s["attributes"]["screenshotDisplayType"].startswith("APP_IPHONE") and s["attributes"]["screenshotDisplayType"] != "APP_IPHONE_67":
            requests.delete(f"{API}/appScreenshotSets/{s['id']}", headers=H, timeout=60)
    s = next((x for x in sets if x["attributes"]["screenshotDisplayType"] == "APP_IPHONE_67"), None)
    if not s:
        s = poslji("POST", "/appScreenshotSets", {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": "APP_IPHONE_67"},
                   "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": l["id"]}}}}).get("data")
        if not s: continue
    for star in get(f"/appScreenshotSets/{s['id']}/appScreenshots", limit=50)["data"]:
        requests.delete(f"{API}/appScreenshots/{star['id']}", headers=H, timeout=60)
    for f in datoteke:
        podatki = open(f, "rb").read()
        sc = poslji("POST", "/appScreenshots", {"type": "appScreenshots", "attributes": {"fileName": os.path.basename(f), "fileSize": len(podatki)},
                    "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": s["id"]}}}}).get("data")
        if not sc: continue
        for op in sc["attributes"]["uploadOperations"]:
            kos = podatki[op["offset"]:op["offset"] + op["length"]]
            requests.request(op["method"], op["url"], data=kos, headers={h["name"]: h["value"] for h in op["requestHeaders"]}, timeout=180).raise_for_status()
        poslji("PATCH", f"/appScreenshots/{sc['id']}", {"type": "appScreenshots", "id": sc["id"],
               "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(podatki).hexdigest()}})
    time.sleep(5)
    zdaj = sorted(get(f"/appScreenshotSets/{s['id']}/appScreenshots", limit=50)["data"], key=lambda x: x["attributes"]["fileName"])
    r = requests.patch(f"{API}/appScreenshotSets/{s['id']}/relationships/appScreenshots", headers=H,
                       json={"data": [{"type": "appScreenshots", "id": x["id"]} for x in zdaj]}, timeout=60)
    print(loc, "←", jezik, len(zdaj), "slik", "vrstni red", r.status_code)

# počakaj, da Apple slike obdela
for _ in range(20):
    time.sleep(15)
    slabe = 0
    for l in get(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations", limit=50)["data"]:
        for s in get(f"/appStoreVersionLocalizations/{l['id']}/appScreenshotSets", limit=50)["data"]:
            for x in get(f"/appScreenshotSets/{s['id']}/appScreenshots", limit=50)["data"]:
                st = (x["attributes"].get("assetDeliveryState") or {}).get("state")
                if st != "COMPLETE": slabe += 1
                if st == "FAILED": print("::error::", l["attributes"]["locale"], x["attributes"]["fileName"], json.dumps(x["attributes"].get("assetDeliveryState")))
    print("še v obdelavi:", slabe)
    if not slabe: break
sys.exit(1 if napaka else 0)
