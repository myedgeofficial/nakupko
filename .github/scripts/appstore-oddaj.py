# Oddaja verzije v Applov pregled (samo po uporabnikovem izrecnem OK).
# FAZA=umakni: če je verzija že v pregledu, jo umakne (da lahko zamenjamo build).
# FAZA=oddaj: odda verzijo v pregled (objava po odobritvi je nastavljena v appstore-verzija.py).
# Okolje: KEY_ID, ISSUER_ID, KEY_P8, VERZIJA, BUNDLE_ID, FAZA.
import json, os, re, sys, textwrap, time, urllib.request, urllib.error
import jwt

API = "https://api.appstoreconnect.apple.com/v1"
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
        sys.exit(f"::error::{metoda} {pot}: {e.code} {e.read().decode()[:800]}")

verzija, bundle, faza = os.environ["VERZIJA"], os.environ["BUNDLE_ID"], os.environ["FAZA"]
app = klic("GET", f"/apps?filter[bundleId]={bundle}")["data"][0]
vs = klic("GET", f"/apps/{app['id']}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
for x in vs[:4]:
    print("Verzija", x["attributes"]["versionString"], x["attributes"]["appStoreState"])
v = next((x for x in vs if x["attributes"]["versionString"] == verzija), None)
if not v:
    sys.exit("::error::Verzije " + verzija + " ni v App Store Connect.")
stanje = v["attributes"]["appStoreState"]

def oddaje(stanja):
    return klic("GET", f"/reviewSubmissions?filter[app]={app['id']}&filter[platform]=IOS&filter[state]={stanja}&limit=10")["data"]

if faza == "umakni":
    if stanje in ("READY_FOR_SALE", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_APP_STORE", "READY_FOR_DISTRIBUTION"):
        sys.exit("::error::Verzija " + verzija + " je že odobrena (" + stanje + "). Potrebna je nova verzija.")
    for s in oddaje("WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES"):
        print("Umikam oddajo", s["id"], s["attributes"]["state"])
        klic("PATCH", f"/reviewSubmissions/{s['id']}", {"data": {"type": "reviewSubmissions", "id": s["id"], "attributes": {"canceled": True}}})
    for _ in range(40):
        st = klic("GET", f"/appStoreVersions/{v['id']}")["data"]["attributes"]["appStoreState"]
        print("Stanje verzije:", st)
        if st in ("DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION", "REJECTED", "METADATA_REJECTED"):
            break
        time.sleep(15)
    else:
        sys.exit("::error::Verzija se ni vrnila v urejanje.")
    sys.exit(0)

# oddaj
b = klic("GET", f"/appStoreVersions/{v['id']}/build")["data"]
print("Build v verziji:", b and b["attributes"]["version"])
for lok in klic("GET", f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")["data"]:
    a = lok["attributes"]
    print("Jezik", a["locale"], "| marketing:", a.get("marketingUrl"), "| podpora:", a.get("supportUrl"))
    if not a.get("marketingUrl"):
        print("::warning::" + a["locale"] + ": ni Marketing URL")
s = next(iter(oddaje("READY_FOR_REVIEW")), None)
if not s:
    s = klic("POST", "/reviewSubmissions", {"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
             "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}})["data"]
items = klic("GET", f"/reviewSubmissions/{s['id']}/items")["data"]
if not items:
    klic("POST", "/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
        "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": s["id"]}},
        "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
klic("PATCH", f"/reviewSubmissions/{s['id']}", {"data": {"type": "reviewSubmissions", "id": s["id"], "attributes": {"submitted": True}}})
print("Oddano v pregled:", verzija, "build", b and b["attributes"]["version"])
