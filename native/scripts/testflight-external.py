# Novo gradnjo na TestFlightu samodejno dodamo v vse zunanje skupine testerjev
# in jo pošljemo v Applov pregled, da je ni treba vsakič izbirati ročno.
import json, os, re, sys, textwrap, time, urllib.error, urllib.request

import jwt  # pip install pyjwt cryptography

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = os.environ["BUNDLE_ID"]
BUILD = os.environ["BUILD_NUMBER"]
WHAT_TO_TEST = os.environ.get("WHAT_TO_TEST") or "Dodaj izdelke na seznam in pojdi mimo trgovine. Lokacijo nastavi na »Vedno«."


def key():
    raw = os.environ["KEY_P8"].replace("﻿", "").replace("\\n", "\n")
    body = re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw)
    body = re.sub(r"[^A-Za-z0-9+/=]", "", body)
    return "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"


PEM = key()


def call(method, path, body=None, ok_errors=()):
    token = jwt.encode(
        {"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
        PEM, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        try:  # ena vrstica, da je napaka vidna v povzetku na GitHubu
            text = "; ".join(f"{x.get('code')}: {x.get('detail')}" for x in json.loads(text).get("errors", [])) or text
        except ValueError:
            text = " ".join(text.split())
        if e.code in ok_errors:
            print(f"::warning::{method} {path}: {e.code} {text[:400]}")
            return None
        sys.exit(f"::warning::App Store Connect {method} {path}: {e.code} {text[:500]}")


app = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"][0]["id"]

# Počakamo, da Apple gradnjo obdela (običajno 5–15 minut).
build = None
for _ in range(90):
    found = call("GET", f"/builds?filter[app]={app}&filter[version]={BUILD}&limit=1")["data"]
    if found:
        state = found[0]["attributes"]["processingState"]
        print("Gradnja", BUILD, state)
        if state == "VALID":
            build = found[0]
            break
        if state in ("FAILED", "INVALID"):
            sys.exit(f"::warning::Apple gradnje {BUILD} ni sprejel ({state}).")
    else:
        print("Gradnja", BUILD, "še ni vidna")
    time.sleep(30)
if not build:
    sys.exit(f"::warning::Gradnja {BUILD} po 45 minutah še ni obdelana. Dodaj jo v skupino ročno.")
bid = build["id"]

# »Kaj testirati« za to gradnjo.
locs = call("GET", f"/builds/{bid}/betaBuildLocalizations")["data"]
if locs:
    for loc in locs:
        call("PATCH", f"/betaBuildLocalizations/{loc['id']}",
             {"data": {"type": "betaBuildLocalizations", "id": loc["id"], "attributes": {"whatsNew": WHAT_TO_TEST}}}, ok_errors=(409,))
else:
    call("POST", "/betaBuildLocalizations",
         {"data": {"type": "betaBuildLocalizations", "attributes": {"locale": "en-US", "whatsNew": WHAT_TO_TEST},
                   "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}}, ok_errors=(409,))

groups = call("GET", f"/betaGroups?filter[app]={app}&filter[isInternalGroup]=false&limit=50")["data"]
if not groups:
    sys.exit("::warning::Ni zunanje skupine testerjev. Ustvari jo v App Store Connect → TestFlight → External Testing.")
for g in groups:
    call("POST", f"/betaGroups/{g['id']}/relationships/builds", {"data": [{"type": "builds", "id": bid}]}, ok_errors=(409,))
    print("Dodano v skupino:", g["attributes"]["name"])

# Apple hkrati pregleduje le eno gradnjo; če kakšna že čaka, se ta pošlje, ko jo ročno potrdiš ali ob naslednji.
r = call("POST", "/betaAppReviewSubmissions",
         {"data": {"type": "betaAppReviewSubmissions", "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}}, ok_errors=(409, 422))
if r is None:
    print(f"::notice::Gradnja {BUILD} je dodana zunanjim testerjem; v pregled ni šla (glej zgoraj, verjetno že čaka druga).")
else:
    print(f"::notice::Gradnja {BUILD} je dodana zunanjim testerjem in poslana v pregled.")
