# Stran v App Store povsod v angleščini: slovenska besedila verzije 1.1 in imena zamenja z angleškimi.
import os, sys

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.1")
NAME = "Nakupko – Shopping List"
SUBTITLE = "The list that opens in store"
FIELDS = ["description", "keywords", "promotionalText", "whatsNew"]

app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]
print(f"::notice::Aplikacija {app['id']}, glavni jezik {app['attributes'].get('primaryLocale')}")

ver = call("GET", f"/apps/{app['id']}/appStoreVersions?filter[versionString]={VERSION}&filter[platform]=IOS")["data"][0]
print(f"::notice::Verzija {VERSION}: {ver['attributes'].get('appStoreState')}")
locs = call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations?limit=50")["data"]
en = next(l for l in locs if l["attributes"]["locale"] == "en-US")
for l in locs:
    loc = l["attributes"]["locale"]
    print(f"::notice::Jezik verzije: {loc}")
    if loc == "en-US":
        continue
    attrs = {f: en["attributes"].get(f) for f in FIELDS if en["attributes"].get(f)}
    call("PATCH", f"/appStoreVersionLocalizations/{l['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": l["id"], "attributes": attrs}}, ok_errors=(409, 422))
    print(f"::notice::{loc}: zamenjal {', '.join(attrs)} z angleščino")

infos = call("GET", f"/apps/{app['id']}/appInfos")["data"]
for info in infos:
    state = info["attributes"].get("appStoreState") or info["attributes"].get("state")
    print(f"::notice::App Information {info['id']}: {state}")
    if state in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION"):
        continue
    for l in call("GET", f"/appInfos/{info['id']}/appInfoLocalizations?limit=50")["data"]:
        loc = l["attributes"]["locale"]
        call("PATCH", f"/appInfoLocalizations/{l['id']}", {"data": {"type": "appInfoLocalizations", "id": l["id"], "attributes": {"name": NAME, "subtitle": SUBTITLE}}}, ok_errors=(409, 422))
        print(f"::notice::{loc}: ime in podnaslov angleško")

r = call("PATCH", f"/apps/{app['id']}", {"data": {"type": "apps", "id": app["id"], "attributes": {"primaryLocale": "en-US"}}}, ok_errors=(409, 422))
print(f"::notice::Glavni jezik angleščina: {'da' if r else 'Apple zavrnil (glej opozorilo)'}")
