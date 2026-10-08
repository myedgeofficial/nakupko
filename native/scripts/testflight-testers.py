# Testerji na TestFlightu: izpiše vse (MODE=list) ali odstrani vse razen KEEP (MODE=remove).
import os, sys

sys.argv = [sys.argv[0]]
os.environ.setdefault("BUILD_NUMBER", "0")
import importlib.util

spec = importlib.util.spec_from_file_location("tf", os.path.join(os.path.dirname(__file__), "testflight-external.py"))
src = open(spec.origin, encoding="utf-8").read()
# Uporabimo le prijavo in call() iz skripte za zunanje testerje (brez njenega glavnega dela).
exec(src.split("app = call(")[0])

MODE = os.environ.get("MODE", "list")
KEEP = [k.strip().lower() for k in os.environ.get("KEEP", "").split(",") if k.strip()]

apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
app = apps[0]["id"]
print(f"::notice::App Store ID aplikacije: {app}")

testers, url = [], f"/betaTesters?filter[apps]={app}&limit=200&fields[betaTesters]=firstName,lastName,email,inviteType,state"
while url:
    r = call("GET", url)
    testers += r["data"]
    nxt = r.get("links", {}).get("next")
    url = nxt.split("/v1", 1)[1] if nxt else None


def keep(t):
    a = t["attributes"]
    return (a.get("email") or "").lower() in KEEP or (a.get("firstName") or "").strip().lower() in KEEP


for t in testers:
    a = t["attributes"]
    who = f"{a.get('firstName') or ''} {a.get('lastName') or ''} <{a.get('email')}> ({a.get('inviteType')}, {a.get('state')})"
    if keep(t):
        print(f"::notice::Ostane: {who}")
    elif MODE == "remove":
        call("DELETE", f"/apps/{app}/relationships/betaTesters", {"data": [{"type": "betaTesters", "id": t["id"]}]}, ok_errors=(404, 409, 422))
        print(f"::notice::Odstranjen: {who}")
    else:
        print(f"::notice::Bi odstranil: {who}")
print(f"::notice::Skupaj testerjev: {len(testers)}")
