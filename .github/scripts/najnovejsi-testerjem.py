"""Za vsako aplikacijo v ekipi: najnovejšo veljavno gradnjo doda v vse skupine TestFlight (notranje in zunanje),
ji nastavi »Kaj testirati« in jo pošlje v Applov beta pregled, da jo dobijo vsi testerji."""
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
    r = requests.request(method, API + path, headers=H, timeout=60, **kw)
    if r.status_code >= 400:
        print(f"::warning::{method} {path} -> {r.status_code} {' '.join(r.text.split())[:600]}")
    return r


for app in call("GET", "/apps", params={"limit": 50}).json()["data"]:
    ime = app["attributes"]["name"]
    b = call("GET", "/builds", params={"filter[app]": app["id"], "filter[processingState]": "VALID", "filter[expired]": "false",
                                       "sort": "-uploadedDate", "limit": 1, "include": "preReleaseVersion,buildBetaDetail"}).json()
    if not b.get("data"):
        print(f"::notice::{ime}: ni veljavne gradnje"); continue
    build = b["data"][0]
    inc = {(x["type"], x["id"]): x["attributes"] for x in b.get("included", [])}
    ver = next((a["version"] for (t, _), a in inc.items() if t == "preReleaseVersions"), "?")
    det = next((a for (t, _), a in inc.items() if t == "buildBetaDetails"), {})
    print(f"::notice::{ime}: najnovejša gradnja {ver} ({build['attributes']['version']}), zunanje stanje {det.get('externalBuildState')}")
    bid = build["id"]
    if not call("GET", f"/builds/{bid}/betaBuildLocalizations").json().get("data"):
        call("POST", "/betaBuildLocalizations", json={"data": {"type": "betaBuildLocalizations",
             "attributes": {"locale": "en-US", "whatsNew": "Najnovejša verzija. Preizkusi vse novosti."},
             "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
    zunanje = False
    for g in call("GET", f"/apps/{app['id']}/betaGroups").json().get("data", []):
        a = g["attributes"]
        if a.get("isInternalGroup") and a.get("hasAccessToAllBuilds"):
            continue
        r = call("POST", f"/betaGroups/{g['id']}/relationships/builds", json={"data": [{"type": "builds", "id": bid}]})
        zunanje |= not a.get("isInternalGroup")
        print(f"{ime}: skupina {a['name']} -> {'OK' if r.status_code < 300 else r.status_code}")
    if zunanje and det.get("externalBuildState") in ("READY_FOR_BETA_SUBMISSION", "MISSING_EXPORT_COMPLIANCE", None):
        r = call("POST", "/betaAppReviewSubmissions", json={"data": {"type": "betaAppReviewSubmissions",
                 "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
        print(f"::notice::{ime}: beta pregled {'ODDAN' if r.status_code < 300 else 'NI oddan (' + str(r.status_code) + ')'}")
