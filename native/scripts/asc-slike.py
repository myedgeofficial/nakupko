# Na stran v izbranem jeziku (LOCALE) naloži slike iz asc-slike/<mapa> namesto obstoječih.
import glob, hashlib, os, sys, urllib.request

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.1")
LOCALE = os.environ.get("LOCALE", "sl")
FILES = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "asc-slike", os.environ.get("FOLDER", "sl"), "*.jpg")))

app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
ver = call("GET", f"/apps/{app}/appStoreVersions?filter[versionString]={VERSION}&filter[platform]=IOS")["data"][0]
locs = call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations?limit=50")["data"]
loc = next(l for l in locs if l["attributes"]["locale"].startswith(LOCALE))
sets = call("GET", f"/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets?limit=50")["data"]
target = None
for s in sets:
    shots = call("GET", f"/appScreenshotSets/{s['id']}/appScreenshots?limit=50")["data"]
    print(f"::notice::{loc['attributes']['locale']} {s['attributes']['screenshotDisplayType']}: {len(shots)} slik")
    if shots and target is None:
        target = (s, shots)
if not target:
    sys.exit("::warning::Ni nabora slik za zamenjavo")
s, shots = target
for sh in shots:
    call("DELETE", f"/appScreenshots/{sh['id']}", ok_errors=(404, 409))

ids = []
for f in FILES:
    data = open(f, "rb").read()
    r = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots", "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
             "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": s["id"]}}}}})["data"]
    for op in r["attributes"]["uploadOperations"]:
        part = data[op["offset"]:op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], data=part, method=op["method"], headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])})
        urllib.request.urlopen(req, timeout=120).read()
    call("PATCH", f"/appScreenshots/{r['id']}", {"data": {"type": "appScreenshots", "id": r["id"], "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    ids.append(r["id"])
    print(f"::notice::Naložena {os.path.basename(f)}")
call("PATCH", f"/appScreenshotSets/{s['id']}/relationships/appScreenshots", {"data": [{"type": "appScreenshots", "id": i} for i in ids]}, ok_errors=(409, 422))
print(f"::notice::{loc['attributes']['locale']} {s['attributes']['screenshotDisplayType']}: {len(ids)} novih slik")
