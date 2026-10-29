"""EMAIL povabi v ekipo App Store Connect (vloga CUSTOMER_SUPPORT, vidi samo aplikacije iz BUNDLES),
da je lahko notranji tester in takoj dobi vsako novo gradnjo brez Applovega beta pregleda."""
import os, re, textwrap, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def call(method, path, **kw):
    r = requests.request(method, API + path, headers=H, timeout=90, **kw)
    if r.status_code >= 400:
        print(f"::warning::{method} {path} -> {r.status_code} {' '.join(r.text.split())[:500]}")
    return r


email = os.environ["EMAIL"].lower()
for staro in [e.strip().lower() for e in os.environ.get("STARO", "").split(",") if e.strip()]:  # zamenjan naslov
    for i in call("GET", "/userInvitations", params={"limit": 200}).json().get("data", []):
        if i["attributes"]["email"].lower() == staro:
            print(f"{staro}: staro povabilo izbrisano {call('DELETE', '/userInvitations/' + i['id']).status_code}")
uporabnik = [u for u in call("GET", "/users", params={"limit": 200}).json().get("data", []) if u["attributes"]["username"].lower() == email]
povabila = [i for i in call("GET", "/userInvitations", params={"limit": 200}).json().get("data", []) if i["attributes"]["email"].lower() == email]
if uporabnik:
    print(f"::notice::{email} je že v ekipi: {uporabnik[0]['attributes'].get('roles')}")
else:
    for i in povabila:  # staro povabilo zamenjamo z novim, da dobi svež mail
        call("DELETE", "/userInvitations/" + i["id"])
    apps = []
    for b in os.environ["BUNDLES"].split(","):
        d = call("GET", "/apps", params={"filter[bundleId]": b}).json().get("data", [])
        apps += [{"type": "apps", "id": d[0]["id"]}] if d else []
    r = call("POST", "/userInvitations", json={"data": {"type": "userInvitations",
             "attributes": {"email": email, "firstName": os.environ["IME"], "lastName": os.environ["PRIIMEK"],
                            "roles": ["CUSTOMER_SUPPORT"], "allAppsVisible": False, "provisioningAllowed": False},
             "relationships": {"visibleApps": {"data": apps}}}})
    print(f"::notice::{email}: povabilo v App Store Connect {'POSLANO' if r.status_code < 300 else 'NI poslano ' + str(r.status_code)}")
