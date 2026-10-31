# Testerja doda v vse notranje skupine TestFlight vseh aplikacij v ekipi in mu za vsako znova pošlje povabilo.
# Okolje: KEY_ID, ISSUER_ID, KEY_P8, EMAIL, IME, PRIIMEK.
import json, os, re, sys, textwrap, time, urllib.request, urllib.error
import jwt

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("﻿", "").replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1100, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})

def klic(metoda, pot, telo=None):
    req = urllib.request.Request(API + pot, method=metoda, data=json.dumps(telo).encode() if telo else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            b = r.read()
            return json.loads(b) if b else {}
    except urllib.error.HTTPError as e:
        print(f"::warning::{metoda} {pot}: {e.code} {e.read().decode()[:400]}")
        return None

email = os.environ["EMAIL"].strip().lower()
t = klic("GET", f"/betaTesters?filter[email]={email}&limit=1")
tester = t["data"][0] if t and t["data"] else None
print("Tester:", tester["id"] if tester else "še ne obstaja")

for app in klic("GET", "/apps?limit=50")["data"]:
    ime = app["attributes"]["name"]
    skupine = (klic("GET", f"/betaGroups?filter[app]={app['id']}&filter[isInternalGroup]=true&limit=50") or {}).get("data", [])
    if not skupine:
        print(ime, ": ni notranje skupine"); continue
    for g in skupine:
        if not tester:
            r = klic("POST", "/betaTesters", {"data": {"type": "betaTesters",
                     "attributes": {"email": email, "firstName": os.environ.get("IME", ""), "lastName": os.environ.get("PRIIMEK", "")},
                     "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": g["id"]}]}}}})
            if r:
                tester = r["data"]
        else:
            klic("POST", f"/betaGroups/{g['id']}/relationships/betaTesters", {"data": [{"type": "betaTesters", "id": tester["id"]}]})
        print(ime, ": dodan v skupino", g["attributes"]["name"])
    if tester:
        r = klic("POST", "/betaTesterInvitations", {"data": {"type": "betaTesterInvitations", "relationships": {
            "app": {"data": {"type": "apps", "id": app["id"]}}, "betaTester": {"data": {"type": "betaTesters", "id": tester["id"]}}}}})
        print(ime, ": povabilo", "poslano" if r is not None else "NI poslano")
if not tester:
    sys.exit("::error::Testerja ni bilo mogoče ustvariti.")
