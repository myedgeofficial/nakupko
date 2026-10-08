# Doda strani v App Store v več jezikih (besedila iz asc-slike/besedila.json, slike iz asc-slike/<jezik>-63|65).
import glob, hashlib, json, os, sys, urllib.request

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.1")
ROOT = os.path.join(os.path.dirname(__file__), "..", "asc-slike")
TEXTS = json.load(open(os.path.join(ROOT, "besedila.json"), encoding="utf-8"))
SETS = {"APP_IPHONE_61": "63", "APP_IPHONE_65": "65"}


def upload(set_id, files):
    for sh in call("GET", f"/appScreenshotSets/{set_id}/appScreenshots?limit=50")["data"]:
        call("DELETE", f"/appScreenshots/{sh['id']}", ok_errors=(404, 409))
    ids = []
    for f in files:
        data = open(f, "rb").read()
        r = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots", "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                 "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
        for op in r["attributes"]["uploadOperations"]:
            part = data[op["offset"]:op["offset"] + op["length"]]
            req = urllib.request.Request(op["url"], data=part, method=op["method"], headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])})
            urllib.request.urlopen(req, timeout=120).read()
        call("PATCH", f"/appScreenshots/{r['id']}", {"data": {"type": "appScreenshots", "id": r["id"], "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        ids.append(r["id"])
    call("PATCH", f"/appScreenshotSets/{set_id}/relationships/appScreenshots", {"data": [{"type": "appScreenshots", "id": i} for i in ids]}, ok_errors=(409, 422))
    return len(ids)


app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
ver = call("GET", f"/apps/{app}/appStoreVersions?filter[versionString]={VERSION}&filter[platform]=IOS")["data"][0]
vlocs = {l["attributes"]["locale"]: l for l in call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations?limit=50")["data"]}
en = vlocs["en-US"]["attributes"]
info = next(i for i in call("GET", f"/apps/{app}/appInfos")["data"] if i["attributes"].get("appStoreState") not in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION"))
ilocs = {l["attributes"]["locale"]: l for l in call("GET", f"/appInfos/{info['id']}/appInfoLocalizations?limit=50")["data"]}
privacy = ilocs["en-US"]["attributes"].get("privacyPolicyUrl")

for locale, t in TEXTS.items():
    va = {k: t[k] for k in ("description", "keywords", "promotionalText", "whatsNew")}
    va.update({k: en.get(k) for k in ("supportUrl", "marketingUrl") if en.get(k)})
    if locale in vlocs:
        vid = vlocs[locale]["id"]
        call("PATCH", f"/appStoreVersionLocalizations/{vid}", {"data": {"type": "appStoreVersionLocalizations", "id": vid, "attributes": va}}, ok_errors=(409, 422))
    else:
        r = call("POST", "/appStoreVersionLocalizations", {"data": {"type": "appStoreVersionLocalizations", "attributes": dict(va, locale=locale),
                 "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": ver["id"]}}}}}, ok_errors=(409, 422))
        if not r:
            continue
        vid = r["data"]["id"]
    ilocs = {l["attributes"]["locale"]: l for l in call("GET", f"/appInfos/{info['id']}/appInfoLocalizations?limit=50")["data"]}
    ia = {"name": t["name"], "subtitle": t["subtitle"]}
    if privacy:
        ia["privacyPolicyUrl"] = privacy
    if locale in ilocs:
        iid = ilocs[locale]["id"]
        r = call("PATCH", f"/appInfoLocalizations/{iid}", {"data": {"type": "appInfoLocalizations", "id": iid, "attributes": ia}}, ok_errors=(409, 422))
        print(f"::notice::{locale}: ime {'nastavljeno' if r else 'NI nastavljeno'}: {t['name']}")
    else:
        call("POST", "/appInfoLocalizations", {"data": {"type": "appInfoLocalizations", "attributes": dict(ia, locale=locale),
             "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info["id"]}}}}}, ok_errors=(409, 422))
    have = {s["attributes"]["screenshotDisplayType"]: s["id"] for s in call("GET", f"/appStoreVersionLocalizations/{vid}/appScreenshotSets?limit=50")["data"]}
    lang = locale.split("-")[0]
    done = []
    for kind, size in SETS.items():
        sid = have.get(kind) or call("POST", "/appScreenshotSets", {"data": {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": kind},
              "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": vid}}}}})["data"]["id"]
        files = sorted(glob.glob(os.path.join(ROOT, f'{lang}-{size}', '*.jpg')))
        if kind in have and len(call("GET", f"/appScreenshotSets/{sid}/appScreenshots?limit=50")["data"]) == len(files):
            done.append(f"{kind} že naložene")
            continue
        done.append(f"{kind} {upload(sid, files)}")
    print(f"::notice::{locale}: besedila, ime, slike ({', '.join(done)})")
