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


# Odstrani napačen e-naslov (ODSTRANI) iz TestFlighta in čakajočih povabil v App Store Connect.
izpis = []
for staro in [e.strip().lower() for e in os.environ.get("ODSTRANI", "").split(",") if e.strip()]:
    for i in call("GET", "/userInvitations", params={"limit": 200}).json().get("data", []):
        if i["attributes"]["email"].lower() == staro:
            r = call("DELETE", "/userInvitations/" + i["id"])
            izpis.append(f"{staro}: ASC povabilo izbrisano {r.status_code}")
    for t in call("GET", "/betaTesters", params={"filter[email]": staro, "limit": 50}).json().get("data", []):
        r = call("DELETE", "/betaTesters/" + t["id"])
        izpis.append(f"{staro}: tester izbrisan {r.status_code}")
    for u in call("GET", "/users", params={"limit": 200}).json().get("data", []):
        if u["attributes"]["username"].lower() == staro:
            izpis.append(f"{staro}: je ASC uporabnik {u['attributes'].get('roles')}")
    vsa = [i["attributes"]["email"] for i in call("GET", "/userInvitations", params={"limit": 200}).json().get("data", [])]
    izpis.append(f"čakajoča ASC povabila: {vsa}")
print("::notice::" + (" | ".join(izpis) or "nič za odstraniti"))
