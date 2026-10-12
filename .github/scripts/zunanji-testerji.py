"""Doda e-pošte kot zunanje TestFlight testerje (skupina z javno povezavo) za vsako aplikacijo iz BUNDLES.
Če skupina še nima builda, doda zadnji veljavni build in ga odda v Applov pregled beta verzije."""
import os, re, sys, textwrap, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def call(method, path, **kw):
    r = requests.request(method, API + path, headers=H, timeout=60, **kw)
    if r.status_code >= 400:
        print(f"::warning::{method} {path} -> {r.status_code} {' '.join(r.text.split())[:900]}")
    return r


emails = [e.strip() for e in os.environ["EMAILS"].split(",") if e.strip()]
napaka = False
for bundle in os.environ["BUNDLES"].split(","):
    apps = call("GET", "/apps", params={"filter[bundleId]": bundle}).json().get("data", [])
    if not apps:
        print(f"::warning::{bundle}: aplikacije ni v tej ekipi")
        continue
    app = apps[0]
    ime = app["attributes"]["name"]
    grupe = call("GET", f"/apps/{app['id']}/betaGroups").json()["data"]
    for g in grupe:
        print(f"::notice::{ime}: skupina {g['attributes']['name']} interna={g['attributes'].get('isInternalGroup')} povezava={g['attributes'].get('publicLink')}")
    grupa = next((g for g in grupe if not g["attributes"].get("isInternalGroup")), None)
    if not grupa:
        grupa = call("POST", "/betaGroups", json={"data": {"type": "betaGroups",
            "attributes": {"name": "Testerji", "publicLinkEnabled": True, "publicLinkLimitEnabled": True, "publicLinkLimit": 100, "feedbackEnabled": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}}).json()["data"]
    v_skupini = call("GET", f"/betaGroups/{grupa['id']}/builds", params={"limit": 1}).json().get("data", [])
    if not v_skupini:
        b = call("GET", "/builds", params={"filter[app]": app["id"], "filter[processingState]": "VALID", "limit": 1, "sort": "-uploadedDate"}).json()["data"]
        if b:
            call("POST", f"/betaGroups/{grupa['id']}/relationships/builds", json={"data": [{"type": "builds", "id": b[0]["id"]}]})
            r = call("POST", "/betaAppReviewSubmissions", json={"data": {"type": "betaAppReviewSubmissions",
                     "relationships": {"build": {"data": {"type": "builds", "id": b[0]["id"]}}}}})
            print(f"::notice::{ime}: build {b[0]['attributes']['version']} dodan v skupino, pregled: {r.status_code}")
    else:
        print(f"::notice::{ime}: skupina že ima build {v_skupini[0]['attributes']['version']}")
    for email in emails:
        r = call("POST", "/betaTesters", json={"data": {"type": "betaTesters", "attributes": {"email": email},
                 "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": grupa["id"]}]}}}})
        if r.status_code >= 300:
            obst = call("GET", "/betaTesters", params={"filter[email]": email}).json()["data"]
            if obst:
                r = call("POST", f"/betaGroups/{grupa['id']}/relationships/betaTesters", json={"data": [{"type": "betaTesters", "id": obst[0]["id"]}]})
        print((f"::notice::{ime}: dodan(a) " if r.status_code < 300 else f"::error::{ime}: ni dodan(a) ") + email)
        napaka |= r.status_code >= 300
    g = call("GET", f"/betaGroups/{grupa['id']}").json()["data"]["attributes"]
    print(f"::notice::{ime}: javna povezava {g.get('publicLink')}")
sys.exit(1 if napaka else 0)
