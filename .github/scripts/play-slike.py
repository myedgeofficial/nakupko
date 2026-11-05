"""Zamenja posnetke zaslona telefona v Google Play predstavitvi za vse jezike predstavitve.
Slike: MAPA/<jezik>/1.jpg … (sl, en, de, hr, it, hu, fr, es; drugi jeziki dobijo angleške). Okolje: PLAY_JSON, PAKET, MAPA."""
import glob, json, os, sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

paket, mapa = os.environ["PAKET"], os.environ["MAPA"]
kred = service_account.Credentials.from_service_account_info(json.loads(os.environ["PLAY_JSON"]), scopes=["https://www.googleapis.com/auth/androidpublisher"])
api = build("androidpublisher", "v3", credentials=kred, cache_discovery=False)
edit = api.edits().insert(packageName=paket, body={}).execute()["id"]
try:
    for lst in api.edits().listings().list(packageName=paket, editId=edit).execute().get("listings", []):
        jezik = lst["language"]
        kratko = jezik.split("-")[0]
        datoteke = sorted(glob.glob(os.path.join(mapa, kratko, "*.jpg"))) or sorted(glob.glob(os.path.join(mapa, "en", "*.jpg")))
        api.edits().images().deleteall(packageName=paket, editId=edit, language=jezik, imageType="phoneScreenshots").execute()
        for f in datoteke:
            api.edits().images().upload(packageName=paket, editId=edit, language=jezik, imageType="phoneScreenshots",
                                        media_body=MediaFileUpload(f, mimetype="image/jpeg")).execute()
        print(jezik, "←", kratko, len(datoteke), "slik")
    api.edits().commit(packageName=paket, editId=edit).execute()
    print("::notice::Google Play posnetki zamenjani")
except Exception as e:
    api.edits().delete(packageName=paket, editId=edit).execute()
    print(f"::error::{str(e)[:800]}")
    sys.exit(1)
