"""Stanje v Google Play za vse REMAKO aplikacije: tiri (production, beta, alpha, internal), verzije, stanje izdaje in opombe."""
import json, os
from google.oauth2 import service_account
from googleapiclient.discovery import build

kred = service_account.Credentials.from_service_account_info(json.loads(os.environ["PLAY_JSON"]), scopes=["https://www.googleapis.com/auth/androidpublisher"])
api = build("androidpublisher", "v3", credentials=kred, cache_discovery=False)
for paket in os.environ.get("PAKETI", "si.nakupko.app si.fixko.app com.remako.fixko").split():
    try:
        edit = api.edits().insert(packageName=paket, body={}).execute()["id"]
        for t in api.edits().tracks().list(packageName=paket, editId=edit).execute().get("tracks", []):
            for r in t.get("releases", []):
                opombe = "; ".join(f"{n['language']}: {n['text'][:160]}" for n in r.get("releaseNotes", [])[:2]).replace("\n", " ")
                print(f"{paket} | {t['track']} | {r.get('name')} | {r.get('status')} | verzije {r.get('versionCodes')} | {opombe}")
        api.edits().delete(packageName=paket, editId=edit).execute()
    except Exception as e:
        print(f"::warning::{paket}: {str(e)[:300]}")
