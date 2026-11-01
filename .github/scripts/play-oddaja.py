"""Oddaja AAB v Google Play prek Play API. Okolje: PAKET, AAB, TIR (internal|alpha|beta|production), STATUS (completed|draft),
OPOMBE (neobvezno: JSON {"sl": "...", "en": "..."} s »kaj je novega«). Brez OK uporabnika se v production ne oddaja."""
import json, os, sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

JEZIKI = {"sl": "sl", "en": "en-US", "de": "de-DE", "hr": "hr", "it": "it-IT", "hu": "hu-HU", "fr": "fr-FR", "es": "es-ES",
          "ru": "ru-RU", "zh": "zh-CN", "ro": "ro", "pl": "pl-PL", "cs": "cs-CZ", "sk": "sk", "sr": "sr", "nl": "nl-NL", "pt": "pt-PT"}
paket, aab, tir, status = os.environ["PAKET"], os.environ["AAB"], os.environ.get("TIR", "internal"), os.environ.get("STATUS", "completed")
kred = service_account.Credentials.from_service_account_info(json.loads(os.environ["PLAY_JSON"]), scopes=["https://www.googleapis.com/auth/androidpublisher"])
api = build("androidpublisher", "v3", credentials=kred, cache_discovery=False)

opombe = []
if os.environ.get("OPOMBE") and os.path.exists(os.environ["OPOMBE"]):
    for k, t in json.load(open(os.environ["OPOMBE"], encoding="utf-8")).items():
        jezik = JEZIKI.get(k, k)
        t = t.strip()
        opombe.append({"language": jezik, "text": t if len(t) <= 500 else t[:497].rsplit(" ", 1)[0] + "…"})

edit = api.edits().insert(packageName=paket, body={}).execute()["id"]
try:
    vc = api.edits().bundles().upload(packageName=paket, editId=edit, media_body=MediaFileUpload(aab, mimetype="application/octet-stream", resumable=True)).execute()["versionCode"]
    print(f"Naloženo: {paket} versionCode {vc}")
    izdaja = {"versionCodes": [str(vc)], "status": status}
    if opombe: izdaja["releaseNotes"] = opombe
    api.edits().tracks().update(packageName=paket, editId=edit, track=tir, body={"track": tir, "releases": [izdaja]}).execute()
    api.edits().commit(packageName=paket, editId=edit).execute()
    print(f"::notice::{paket} {vc} oddan na tir {tir} ({status}), opombe v {len(opombe)} jezikih")
except Exception as e:
    api.edits().delete(packageName=paket, editId=edit).execute()
    print(f"::error::{paket}: {str(e)[:800]}")
    sys.exit(1)
