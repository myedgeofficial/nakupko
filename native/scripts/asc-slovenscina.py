# Vrne slovenska besedila na slovensko stran verzije (iz objavljene verzije), angleška stran ostane angleška.
import os, sys

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.1")
WHATS_NEW = """Popolnoma nov izgled: večje in barvne slike izdelkov ter nov zavihek Trgovine, kjer vidiš, kje je tvoja košarica najcenejša.
Nov seznam na zaklenjenem zaslonu, ki se pokaže tudi v avtu (CarPlay).
Nakupko zdaj govori angleško, nemško, hrvaško, italijansko, madžarsko, francosko in špansko.
Popravki cen in delovnega časa trgovin."""

app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
versions = call("GET", f"/apps/{app}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
new = next(v for v in versions if v["attributes"]["versionString"] == VERSION)
live = next(v for v in versions if v["attributes"]["appStoreState"] in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION"))
print(f"::notice::Slovenska besedila iz verzije {live['attributes']['versionString']}")


def sl(locs):
    return next(l for l in locs if l["attributes"]["locale"].startswith("sl"))


old = sl(call("GET", f"/appStoreVersions/{live['id']}/appStoreVersionLocalizations?limit=50")["data"])["attributes"]
tgt = sl(call("GET", f"/appStoreVersions/{new['id']}/appStoreVersionLocalizations?limit=50")["data"])
attrs = {f: old.get(f) for f in ("description", "keywords", "promotionalText") if old.get(f)}
attrs["whatsNew"] = WHATS_NEW
call("PATCH", f"/appStoreVersionLocalizations/{tgt['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": tgt["id"], "attributes": attrs}})
print(f"::notice::Verzija {VERSION} slovensko: {', '.join(attrs)}")

infos = call("GET", f"/apps/{app}/appInfos")["data"]
live_info = next(i for i in infos if i["attributes"].get("appStoreState") in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION"))
new_info = next(i for i in infos if i is not live_info)
o = sl(call("GET", f"/appInfos/{live_info['id']}/appInfoLocalizations?limit=50")["data"])["attributes"]
t = sl(call("GET", f"/appInfos/{new_info['id']}/appInfoLocalizations?limit=50")["data"])
call("PATCH", f"/appInfoLocalizations/{t['id']}", {"data": {"type": "appInfoLocalizations", "id": t["id"], "attributes": {"name": o["name"], "subtitle": o.get("subtitle")}}})
print(f"::notice::Slovensko ime: {o['name']} / {o.get('subtitle')}")
