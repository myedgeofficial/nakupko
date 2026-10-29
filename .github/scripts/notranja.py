"""EMAIL (član ekipe App Store Connect) postane notranji tester v BUNDLES. Prej odstrani stare beta zapise
(EMAIL in STARO), ker je njen Apple ID v TestFlightu vezan na staro povabilo in novega ne more sprejeti."""
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
    for _ in range(4):
        try:
            r = requests.request(method, API + path, headers=H, timeout=90, **kw)
        except requests.RequestException as e:
            print(f"::warning::{method} {path}: {e}"); time.sleep(5); continue
        if r.status_code < 500:
            break
        time.sleep(5)
    if r.status_code >= 400:
        print(f"::warning::{method} {path} -> {r.status_code} {' '.join(r.text.split())[:500]}")
    return r


email = os.environ["EMAIL"].lower()
u = [x for x in call("GET", "/users", params={"limit": 200}).json().get("data", []) if x["attributes"]["username"].lower() == email]
if not u:
    sys.exit(f"::error::{email} še ni član ekipe (povabilo ni sprejeto).")
print(f"::notice::{email} je član ekipe {u[0]['attributes'].get('roles')}")
for e in [email] + [s.strip().lower() for s in os.environ.get("STARO", "").split(",") if s.strip()]:
    for t in call("GET", "/betaTesters", params={"filter[email]": e, "limit": 50}).json().get("data", []):
        print(f"{e}: star beta zapis izbrisan {call('DELETE', '/betaTesters/' + t['id']).status_code}")
time.sleep(5)
tester = None
for b in os.environ["BUNDLES"].split(","):
    app = call("GET", "/apps", params={"filter[bundleId]": b}).json()["data"][0]
    ime = app["attributes"]["name"]
    for g in call("GET", f"/apps/{app['id']}/betaGroups").json().get("data", []):
        if not g["attributes"].get("isInternalGroup"):
            continue
        if not tester:
            r = call("POST", "/betaTesters", json={"data": {"type": "betaTesters", "attributes": {"email": email, "firstName": "Nika", "lastName": "Rihtaric"},
                     "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": g["id"]}]}}}})
            tester = r.json()["data"] if r.status_code < 300 else None
        else:
            r = call("POST", f"/betaGroups/{g['id']}/relationships/betaTesters", json={"data": [{"type": "betaTesters", "id": tester["id"]}]})
        print(f"::notice::{ime}: notranja skupina {g['attributes']['name']} -> {r.status_code}")
    if tester:
        r = call("POST", "/betaTesterInvitations", json={"data": {"type": "betaTesterInvitations", "relationships": {
            "app": {"data": {"type": "apps", "id": app["id"]}}, "betaTester": {"data": {"type": "betaTesters", "id": tester["id"]}}}}})
        print(f"::notice::{ime}: povabilo {r.status_code}")
