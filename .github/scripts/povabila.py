"""Preveri, v katerih TestFlight skupinah je EMAIL, in ji/mu ponovno pošlje povabila.
Za aplikacije z interno potjo (Remako Studio) ponovno pošlje povabilo v App Store Connect."""
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
        print(f"::warning::{method} {path} -> {r.status_code} {' '.join(r.text.split())[:500]}")
    return r


email = os.environ["EMAIL"].strip().lower()
izpis = []
uporabniki = [u for u in call("GET", "/users", params={"limit": 200}).json().get("data", []) if u["attributes"]["username"].lower() == email]
for u in uporabniki:
    vidne = call("GET", f"/users/{u['id']}/visibleApps").json().get("data", [])
    izpis.append(f"ASC uporabnik: {u['attributes'].get('roles')} {[v['attributes']['name'] for v in vidne]}")
inv = [i for i in call("GET", "/userInvitations", params={"limit": 200}).json().get("data", []) if i["attributes"]["email"].lower() == email]
izpis.append(f"ASC povabila čakajo: {len(inv)}")
if not uporabniki and not inv:
    a = call("GET", "/apps", params={"filter[bundleId]": "com.byurska.studio"}).json()["data"][0]
    r = call("POST", "/userInvitations", json={"data": {"type": "userInvitations", "attributes": {
        "email": email, "firstName": "Andjela", "lastName": "Tester", "roles": ["CUSTOMER_SUPPORT"],
        "allAppsVisible": False, "provisioningAllowed": False},
        "relationships": {"visibleApps": {"data": [{"type": "apps", "id": a["id"]}]}}}})
    izpis.append(f"novo ASC povabilo: {r.status_code}")
for t in call("GET", "/betaTesters", params={"filter[email]": email, "limit": 50}).json().get("data", []):
    tapps = [a["attributes"]["name"] for a in call("GET", f"/betaTesters/{t['id']}/apps").json().get("data", [])]
    grupe = [g["attributes"]["name"] for g in call("GET", f"/betaTesters/{t['id']}/betaGroups").json().get("data", [])]
    izpis.append(f"TestFlight {tapps} skupine {grupe}")
print("::notice::" + " | ".join(izpis))
