"""Izpiše buile zunanje skupine Nakupka (verzija, stanje beta pregleda) in zadnje buile aplikacije."""
import os, re, textwrap, time
import jwt, requests

API = "https://api.appstoreconnect.apple.com/v1"
raw = os.environ["KEY_P8"].replace("\\n", "\n")
body = re.sub(r"[^A-Za-z0-9+/=]", "", re.sub(r"-----(BEGIN|END)[A-Z ]*-----", "", raw))
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
tok = jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                 pem, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})
H = {"Authorization": f"Bearer {tok}"}
get = lambda p, **q: requests.get(API + p, headers=H, params=q, timeout=60).json()

app = get("/apps", **{"filter[bundleId]": "si.nakupko.app"})["data"][0]
def opis(b):
    a = b["attributes"]
    pv = get(f"/builds/{b['id']}/preReleaseVersion")["data"]["attributes"]["version"]
    br = get(f"/builds/{b['id']}/betaBuildLocalizations")
    rev = get(f"/builds/{b['id']}/betaAppReviewSubmission").get("data")
    det = get(f"/builds/{b['id']}/buildBetaDetail")["data"]["attributes"]
    return f"{pv} ({a['version']}) uploaded={a['uploadedDate'][:16]} expired={a.get('expired')} review={rev['attributes']['betaReviewState'] if rev else None} external={det.get('externalBuildState')}"
for g in get(f"/apps/{app['id']}/betaGroups")["data"]:
    print("SKUPINA", g["attributes"]["name"], "interna" if g["attributes"]["isInternalGroup"] else "zunanja")
    for b in get(f"/betaGroups/{g['id']}/builds", limit=10)["data"]:
        print("   ", opis(b))
print("ZADNJI BUILDI")
for b in get("/builds", **{"filter[app]": app["id"], "sort": "-uploadedDate", "limit": 6})["data"]:
    print("   ", opis(b))
