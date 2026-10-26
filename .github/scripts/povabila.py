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
apps = {}
for bundle in os.environ["BUNDLES"].split(","):
    a = call("GET", "/apps", params={"filter[bundleId]": bundle}).json().get("data", [])
    if a:
        apps[a[0]["id"]] = a[0]["attributes"]["name"]
    else:
        print(f"::warning::{bundle}: aplikacije ni v tej ekipi")

testerji = call("GET", "/betaTesters", params={"filter[email]": email, "include": "apps,betaGroups", "limit": 50}).json()
for t in testerji.get("data", []):
    print(f"::notice::Tester {t['id']} stanje={t['attributes'].get('state')} tip={t['attributes'].get('inviteType')}")
    grupe = call("GET", f"/betaTesters/{t['id']}/betaGroups", params={"limit": 50}).json().get("data", [])
    for g in grupe:
        print(f"::notice::Skupina {g['attributes']['name']} (interna={g['attributes'].get('isInternalGroup')})")
    tapps = call("GET", f"/betaTesters/{t['id']}/apps", params={"limit": 50}).json().get("data", [])
    for a in tapps:
        print(f"::notice::Je tester za: {a['attributes']['name']}")
        if a["id"] in apps:
            r = call("POST", "/betaTesterInvitations", json={"data": {"type": "betaTesterInvitations", "relationships": {
                "betaTester": {"data": {"type": "betaTesters", "id": t["id"]}}, "app": {"data": {"type": "apps", "id": a["id"]}}}}})
            print(f"::notice::{a['attributes']['name']}: povabilo ponovno poslano ({r.status_code})")
if not testerji.get("data"):
    print(f"::warning::{email} ni tester v nobeni aplikaciji")

# Povabilo v App Store Connect (interna pot): izbriši staro in pošlji novo.
for inv in call("GET", "/userInvitations", params={"limit": 200, "include": "visibleApps"}).json().get("data", []):
    at = inv["attributes"]
    if at["email"].lower() != email:
        continue
    vidne = call("GET", f"/userInvitations/{inv['id']}/visibleApps").json().get("data", [])
    print(f"::notice::ASC povabilo čaka (vloge {at.get('roles')}, aplikacije {[v['attributes']['name'] for v in vidne]}); pošiljam znova")
    call("DELETE", f"/userInvitations/{inv['id']}")
    r = call("POST", "/userInvitations", json={"data": {"type": "userInvitations", "attributes": {
        "email": email, "firstName": at.get("firstName") or "Tester", "lastName": at.get("lastName") or "Tester", "roles": at.get("roles") or ["CUSTOMER_SUPPORT"],
        "allAppsVisible": at.get("allAppsVisible", False), "provisioningAllowed": at.get("provisioningAllowed", False)},
        "relationships": {"visibleApps": {"data": [{"type": "apps", "id": v["id"]} for v in vidne]}}}})
    print(f"::notice::ASC povabilo ponovno poslano: {r.status_code}")
