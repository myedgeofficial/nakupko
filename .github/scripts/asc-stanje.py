"""Samo izpis: ali je EMAIL uporabnik ekipe App Store Connect, čakajoče povabilo in beta tester."""
import os, re, textwrap, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
H = {"Authorization": f"Bearer {tok}"}
get = lambda p, **q: requests.get(API + p, headers=H, params=q, timeout=90).json()
email = os.environ["EMAIL"].lower()
for u in get("/users", limit=200).get("data", []):
    a = u["attributes"]
    print("UPORABNIK", a["username"], a.get("roles"), "vse app" if a.get("allAppsVisible") else "")
for i in get("/userInvitations", limit=200).get("data", []):
    a = i["attributes"]
    print("POVABILO", a["email"], a.get("roles"), "poteče", a.get("expirationDate"))
for t in get("/betaTesters", **{"filter[email]": email}).get("data", []):
    print("TESTER", t["attributes"])
