# Ustvari novo verzijo v App Store (npr. 1.2), vpiše »Kaj je novega« v vseh jezikih
# in pripne najnovejšo obdelano gradnjo te verzije. Oddajo v pregled klikne uporabnik.
import json, os, sys, time

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
src = open(os.path.join(os.path.dirname(__file__), "testflight-external.py"), encoding="utf-8").read()
exec(src.split("app = call(")[0])

VERSION = os.environ.get("VERSION", "1.2")
NEW = json.load(open(os.path.join(os.path.dirname(__file__), "..", "asc-slike", "novo-1.2.json"), encoding="utf-8"))

app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]
vers = call("GET", f"/apps/{app}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
for v in vers:
    print(f"::notice::verzija {v['attributes']['versionString']}: {v['attributes']['appStoreState']}")

live = any(v["attributes"]["appStoreState"] == "READY_FOR_SALE" and v["attributes"]["versionString"] != "1.0" for v in vers)
if live:  # 1.1 je v trgovini: glavni jezik je zdaj lahko angleščina
    r = call("PATCH", f"/apps/{app}", {"data": {"type": "apps", "id": app, "attributes": {"primaryLocale": "en-US"}}}, ok_errors=(409, 422))
    print(f"::notice::glavni jezik en-US: {'nastavljen' if r else 'NI nastavljen'}")

ver = next((v for v in vers if v["attributes"]["versionString"] == VERSION), None)
if not ver:
    ver = call("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
               "attributes": {"platform": "IOS", "versionString": VERSION, "releaseType": "AFTER_APPROVAL"},
               "relationships": {"app": {"data": {"type": "apps", "id": app}}}}})["data"]
    print(f"::notice::ustvarjena verzija {VERSION}")
    time.sleep(10)

locs = call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations?limit=50")["data"]
done = []
for l in locs:
    loc = l["attributes"]["locale"]
    text = NEW.get(loc) or NEW.get(loc.split("-")[0]) or NEW["en-US"]
    r = call("PATCH", f"/appStoreVersionLocalizations/{l['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": l["id"],
             "attributes": {"whatsNew": text}}}, ok_errors=(409, 422))
    done.append(loc + ("" if r else "!"))
print(f"::notice::Kaj je novega: {', '.join(done)}")

# Najnovejša gradnja te verzije, ko jo Apple obdela.
build = None
for _ in range(140):
    pre = call("GET", f"/preReleaseVersions?filter[app]={app}&filter[version]={VERSION}&filter[platform]=IOS")["data"]
    if pre:
        bs = call("GET", f"/builds?filter[preReleaseVersion]={pre[0]['id']}&sort=-uploadedDate&limit=1")["data"]
        if bs and bs[0]["attributes"]["processingState"] == "VALID":
            build = bs[0]
            break
        print("gradnja", bs[0]["attributes"]["version"] if bs else "-", bs[0]["attributes"]["processingState"] if bs else "")
    time.sleep(30)
if not build:
    sys.exit("::warning::gradnja še ni obdelana")
if build["attributes"].get("usesNonExemptEncryption") is None:
    call("PATCH", f"/builds/{build['id']}", {"data": {"type": "builds", "id": build["id"], "attributes": {"usesNonExemptEncryption": False}}}, ok_errors=(409, 422))
r = call("PATCH", f"/appStoreVersions/{ver['id']}/relationships/build", {"data": {"type": "builds", "id": build["id"]}}, ok_errors=(409, 422))
print(f"::notice::gradnja {build['attributes']['version']} {'pripeta' if r is not None else 'NI pripeta'} k {VERSION}")
