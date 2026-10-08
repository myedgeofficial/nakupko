# Slike verzije: slovenska stran dobi slovenske, ostale angleške, v velikosti, ki jo zahteva vrsta zaslona.
import glob, hashlib, os, sys, urllib.request

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.1")
ROOT = os.path.join(os.path.dirname(__file__), "..", "asc-slike")
# Velikost slik po vrsti zaslona: 6.1/6.3 = 1206x2622, 6.5/6.7 = 1284x2778.
SIZE = {"APP_IPHONE_61": "63", "APP_IPHONE_63": "63", "APP_IPHONE_65": "65", "APP_IPHONE_67": "65"}

app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
ver = call("GET", f"/apps/{app}/appStoreVersions?filter[versionString]={VERSION}&filter[platform]=IOS")["data"][0]
for loc in call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations?limit=50")["data"]:
    lang = "sl" if loc["attributes"]["locale"].startswith("sl") else "en"
    for s in call("GET", f"/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets?limit=50")["data"]:
        kind = s["attributes"]["screenshotDisplayType"]
        name = f"{loc['attributes']['locale']} {kind}"
        if kind not in SIZE:
            print(f"::notice::{name}: ne spreminjam")
            continue
        files = sorted(glob.glob(os.path.join(ROOT, f"{lang}-{SIZE[kind]}", "*.jpg")))
        for sh in call("GET", f"/appScreenshotSets/{s['id']}/appScreenshots?limit=50")["data"]:
            call("DELETE", f"/appScreenshots/{sh['id']}", ok_errors=(404, 409))
        ids = []
        for f in files:
            data = open(f, "rb").read()
            r = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots", "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                     "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": s["id"]}}}}})["data"]
            for op in r["attributes"]["uploadOperations"]:
                part = data[op["offset"]:op["offset"] + op["length"]]
                req = urllib.request.Request(op["url"], data=part, method=op["method"], headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])})
                urllib.request.urlopen(req, timeout=120).read()
            call("PATCH", f"/appScreenshots/{r['id']}", {"data": {"type": "appScreenshots", "id": r["id"], "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
            ids.append(r["id"])
        call("PATCH", f"/appScreenshotSets/{s['id']}/relationships/appScreenshots", {"data": [{"type": "appScreenshots", "id": i} for i in ids]}, ok_errors=(409, 422))
        print(f"::notice::{name}: {len(ids)} slik {lang}-{SIZE[kind]}")
