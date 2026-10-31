// Nadzorna plošča: dvakrat na dan (in ob kliku »Osveži«) zbere prenose, naročnine in prihodke iz
// App Store Connect (ločeno za Nakupko in Popravko), namestitve iz Google Play, prenose Android APK z GitHuba,
// zaslužek AdMob in anonimne aktivne uporabnike iz /akt.
// Rezultat zapiše v /nadzor, ki ga lahko bereta samo lastnika (glej database.rules.json).
// Trajni dostop do AdMob (osvežilni žeton) je v /skrito/admob, ki ga noben odjemalec ne more brati.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const zlib = require("zlib");

const START = "2026-10-01";          // pred tem ni bilo prodaje
const KEEP_AKT_DAYS = 60;
const REPO = "myedgeofficial/nakupko";
const PROJECT = "nakupko-8ad19";
const OWNERS = ["teo.simonic7@gmail.com", "urska.repusic@gmail.com"];
// Aplikacije na plošči: ključ → paket v App Store in Google Play.
const APPS = { nakupko: "si.nakupko.app", popravko: "si.fixko.app" };
const PLAY_DEV = "5460513341646771645";
const ADMOB_PUB = "pub-2170388618811750";   // REMAKO d.o.o.

const db = () => admin.database();
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const ljToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
const gToken = async () => (await admin.credential.applicationDefault().getAccessToken()).access_token;

function ascJwt() {
  const kid = process.env.ASC_KEY_ID, iss = process.env.ASC_ISSUER_ID;
  const key = (process.env.ASC_KEY_P8 || "").replace(/\\n/g, "\n");
  if (!kid || !iss || !key) throw new Error("manjka App Store Connect API ključ");
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })).toString("base64url");
  const c = Buffer.from(JSON.stringify({ iss, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" })).toString("base64url");
  const sig = crypto.sign("sha256", Buffer.from(h + "." + c), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return h + "." + c + "." + sig;
}

async function ascError(r) {
  const t = await r.text();
  let msg = t.slice(0, 300);
  try { msg = JSON.parse(t).errors.map((e) => e.detail || e.title).join("; "); } catch (e) { /* surovo */ }
  if (r.status === 401) msg = "ključ App Store Connect ni veljaven (" + msg + ")";
  if (r.status === 403) msg = "ključ App Store Connect nima pravic za poročila o prodaji; rabi vlogo Finance, Sales ali Admin (" + msg + ")";
  return new Error("Apple " + r.status + ": " + msg);
}

// Vrne vrstice poročila kot objekte, [] če tisti dan ni bilo prodaje, null če poročila še ni.
async function ascReport(jwt, params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch("https://api.appstoreconnect.apple.com/v1/salesReports?" + q, {
    headers: { authorization: "Bearer " + jwt, accept: "application/a-gzip" }
  });
  if (r.status === 404) {
    const t = await r.text();
    if (/not available yet|not yet available/i.test(t)) return null;
    if (/no sales|no data|no reports/i.test(t)) return [];
    if (/vendor/i.test(t)) throw new Error("Apple ne pozna tega Vendor numberja. Preveri številko v Nastavitvah.");
    throw new Error("Apple 404: " + t.slice(0, 200));
  }
  if (!r.ok) throw await ascError(r);
  const txt = zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => { const v = l.split("\t"), o = {}; head.forEach((k, i) => { o[k.trim()] = (v[i] || "").trim(); }); return o; });
}

// SKU in Apple ID aplikacij v računu → ključ na plošči (nakupko / popravko).
async function ascApps(jwt) {
  const r = await fetch("https://api.appstoreconnect.apple.com/v1/apps?limit=200&fields[apps]=bundleId,sku,name", { headers: { authorization: "Bearer " + jwt } });
  if (!r.ok) throw await ascError(r);
  const map = { sku: {}, id: {}, najdene: {} };
  for (const a of (await r.json()).data || []) {
    const key = Object.keys(APPS).find((k) => APPS[k] === a.attributes.bundleId);
    if (!key) continue;
    map.sku[a.attributes.sku] = key;
    map.id[a.id] = key;
    map.najdene[key] = a.attributes.name;
  }
  return map;
}

const num = (s) => { const n = parseFloat(String(s || "0").replace(",", ".")); return isFinite(n) ? n : 0; };
const addTo = (obj, k, v) => { if (!k || !v) return; obj[k] = Math.round(((obj[k] || 0) + v) * 100) / 100; };

// Nakupi v aplikaciji imajo SKU izdelka, aplikacijo pove »Parent Identifier« (SKU aplikacije).
function appOf(r, apps) {
  const inApp = /^IA/.test(r["Product Type Identifier"] || "") || !!r.Subscription;
  const sku = inApp && r["Parent Identifier"] ? r["Parent Identifier"] : r.SKU;
  if (apps.sku[sku]) return apps.sku[sku];
  if (apps.id[r["Apple Identifier"]]) return apps.id[r["Apple Identifier"]];
  const t = (r.Title || "") + " " + sku;
  if (/popravko|fixko/i.test(t)) return "popravko";
  if (/nakupko/i.test(t)) return "nakupko";
  return "ostalo";
}

function summarizeSales(rows, apps) {
  const out = {};
  for (const r of rows) {
    const d = out[appOf(r, apps)] = out[appOf(r, apps)] || { prenosi: 0, ponovni: 0, posodobitve: 0, narocnine: 0, izplacilo: {}, kupci: {}, drzave: {}, naprave: {} };
    const type = r["Product Type Identifier"] || "", units = num(r.Units);
    if (/^(1|1F|1T|F1|1E|1EP|1EU)$/.test(type)) {
      d.prenosi += units;
      addTo(d.drzave, r["Country Code"], units);
      addTo(d.naprave, r.Device, units);
    } else if (/^(3|3F|3T|F3)$/.test(type)) d.ponovni += units;
    else if (/^(7|7F|7T|F7)$/.test(type)) d.posodobitve += units;
    else if (/^IA/.test(type) || r.Subscription) {
      d.narocnine += units;
      addTo(d.izplacilo, r["Currency of Proceeds"], units * num(r["Developer Proceeds"]));
      addTo(d.kupci, r["Customer Currency"], units * num(r["Customer Price"]));
    }
  }
  return out;
}

async function apple(vendor, out, errors) {
  if (!vendor) { errors.apple = "Vpiši Apple »Vendor number« v Nastavitvah spodaj (brez njega ni iPhone prenosov)."; return; }
  let jwt, apps;
  try { jwt = ascJwt(); apps = await ascApps(jwt); } catch (e) { errors.apple = e.message; return; }
  out.appleApps = apps.najdene;
  // Dnevi po aplikacijah (stara pot /nadzor/apple/dnevi je seštevala vse aplikacije računa skupaj).
  const ref = db().ref("nadzor/apple/poAplikacijah");
  const have = (await ref.once("value")).val() || {};
  const today = ljToday();
  let fetched = 0;
  for (let day = START; day < today && fetched < 60; day = addDays(day, 1)) {
    // Zadnjih 7 dni beremo vedno znova: Apple poročilo včasih izide pozneje ali se dopolni
    // (npr. 27. 10. je bil shranjen brez Popravkovih prenosov).
    if (have[day] && have[day].koncno && day < addDays(today, -7)) continue;
    fetched++;
    try {
      const rows = await ascReport(jwt, {
        "filter[frequency]": "DAILY", "filter[reportType]": "SALES", "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]": vendor, "filter[reportDate]": day, "filter[version]": "1_1"
      });
      if (rows === null) continue;  // poročilo še ni pripravljeno
      const s = summarizeSales(rows, apps);
      s.koncno = true;
      await ref.child(day).set(s);
    } catch (e) { errors.apple = e.message; break; }
  }
  // Aktivne naročnine Nakupko Plus: zadnje razpoložljivo dnevno poročilo o naročninah.
  const nakupkoIds = Object.keys(apps.id).filter((id) => apps.id[id] === "nakupko");
  for (let back = 1; back <= 5 && !errors.apple; back++) {
    const day = addDays(today, -back);
    let rows = null;
    for (const version of ["1_4", "1_3"]) {
      try {
        rows = await ascReport(jwt, {
          "filter[frequency]": "DAILY", "filter[reportType]": "SUBSCRIPTION", "filter[reportSubType]": "SUMMARY",
          "filter[vendorNumber]": vendor, "filter[reportDate]": day, "filter[version]": version
        });
        break;
      } catch (e) {
        // Apple za račun brez prodanih naročnin vrne »Invalid vendor number«, čeprav prodajna poročila delajo.
        if (/invalid vendor/i.test(e.message)) { rows = []; break; }
        if (!/version/i.test(e.message)) { errors.narocnine = e.message; break; }
      }
    }
    if (rows === null) continue;
    const n = { datum: day, placljive: 0, brezplacne: 0, drzave: {} };
    for (const r of rows) {
      if (nakupkoIds.length && r["App Apple ID"] && !nakupkoIds.includes(r["App Apple ID"])) continue;
      for (const k of Object.keys(r)) {
        if (!/^Active /.test(k)) continue;
        const v = num(r[k]);
        if (/Free Trial/i.test(k)) n.brezplacne += v; else n.placljive += v;
        addTo(n.drzave, r.Country, v);
      }
    }
    out.narocnine = n;
    break;
  }
}

async function android(out, errors) {
  try {
    const r = await fetch("https://api.github.com/repos/" + REPO + "/releases/tags/android", { headers: { "user-agent": "nakupko-nadzor" } });
    if (!r.ok) throw new Error("GitHub " + r.status);
    const rel = await r.json();
    const ref = db().ref("nadzor/android/sredstva");
    const seen = (await ref.once("value")).val() || {};
    for (const a of rel.assets || []) {
      if (!/\.apk$/i.test(a.name)) continue;
      seen[a.id] = Math.max(seen[a.id] || 0, a.download_count || 0);  // izdaja se ob vsaki gradnji zamenja
    }
    await ref.set(seen);
    out.android = { prenosi: Object.values(seen).reduce((a, b) => a + b, 0) };
  } catch (e) { errors.android = e.message; }
}

// Google Play: mesečna poročila o namestitvah v vedru Cloud Storage razvijalskega računa.
// Deluje, ko je račun strežnika (prikazan na plošči) dodan v Play Console z dovoljenjem za poročila.
async function play(bucketSetting, out, errors) {
  const token = await gToken();
  const h = { authorization: "Bearer " + token };
  const buckets = bucketSetting ? [bucketSetting.replace(/^gs:\/\//, "").split("/")[0]] : ["pubsite_prod_" + PLAY_DEV, "pubsite_prod_rev_" + PLAY_DEV];
  let lastErr = "";
  for (const b of buckets) {
    const res = {};
    let ok = false;
    for (const [key, pkg] of Object.entries(APPS)) {
      const q = new URLSearchParams({ prefix: "stats/installs/installs_" + pkg + "_", fields: "items(name)" });
      const r = await fetch("https://storage.googleapis.com/storage/v1/b/" + b + "/o?" + q, { headers: h });
      if (!r.ok) { lastErr = r.status === 403 || r.status === 401 ? "403" : r.status === 404 ? "404" : "Google Play " + r.status; break; }
      ok = true;
      const files = ((await r.json()).items || []).map((i) => i.name).filter((n) => /_overview\.csv$/.test(n)).sort();
      const p = { skupaj: 0, aktivne: 0, naDan: {}, datum: "" };
      for (const f of files) {
        const fr = await fetch("https://storage.googleapis.com/storage/v1/b/" + b + "/o/" + encodeURIComponent(f) + "?alt=media", { headers: h });
        if (!fr.ok) continue;
        const buf = Buffer.from(await fr.arrayBuffer());
        const txt = buf[0] === 0xff && buf[1] === 0xfe ? buf.slice(2).toString("utf16le") : buf.toString("utf8").replace(/^﻿/, "");
        const lines = txt.split(/\r?\n/).filter((l) => l.trim());
        const head = lines[0].split(",").map((x) => x.trim());
        const col = (name) => head.indexOf(name);
        const iDay = col("Date"), iNew = col("Daily User Installs"), iTot = col("Total User Installs"), iAct = col("Active Device Installs");
        for (const l of lines.slice(1)) {
          const v = l.split(",");
          const day = v[iDay];
          if (iNew >= 0) p.naDan[day] = num(v[iNew]);
          if (day >= p.datum) { p.datum = day; if (iTot >= 0) p.skupaj = num(v[iTot]); if (iAct >= 0) p.aktivne = num(v[iAct]); }
        }
      }
      if (!p.skupaj) p.skupaj = Object.values(p.naDan).reduce((a, c) => a + c, 0);
      res[key] = p;
    }
    if (ok) { out.play = Object.assign(res, { vedro: b }); return; }
  }
  errors.play = lastErr === "403" ? "Google Play še ni dovolil branja poročil. Dodaj račun strežnika v Play Console (glej Nastavitve)." :
    lastErr === "404" ? "Google Play še ni pripravil poročil o prenosih (aplikacije so nove). Pokažejo se sami, ko jih Google ustvari." : lastErr;
}

// AdMob: z osvežilnim žetonom (enkrat poveže lastnik AdMob računa) prenese zaslužek po mesecih in aplikacijah.
async function googleClient() {
  const r = await fetch("https://identitytoolkit.googleapis.com/admin/v2/projects/" + PROJECT + "/defaultSupportedIdpConfigs/google.com", { headers: { authorization: "Bearer " + await gToken() } });
  const j = await r.json();
  if (!r.ok || !j.clientId) throw new Error("nastavitev Google prijave ni dosegljiva (" + ((j.error || {}).message || r.status) + ")");
  return { id: j.clientId, secret: j.clientSecret };
}

function admobApp(label) {
  return /popravko|fixko/i.test(label || "") ? "popravko" : "nakupko";
}

async function admob(out, errors) {
  const saved = (await db().ref("skrito/admob").once("value")).val();
  if (!saved || !saved.rt) { errors.admob = "AdMob še ni povezan: v Nastavitvah klikni »Poveži AdMob« in se prijavi z urska.repusic@gmail.com."; return; }
  try {
    const c = await googleClient();
    const t = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: saved.rt, grant_type: "refresh_token" })
    }).then((r) => r.json());
    if (!t.access_token) throw new Error(t.error === "invalid_grant" ? "povezava z AdMob je potekla; v Nastavitvah znova klikni »Poveži AdMob«" : "AdMob prijava: " + (t.error_description || t.error));
    const h = { authorization: "Bearer " + t.access_token, "content-type": "application/json" };
    const acc = await fetch("https://admob.googleapis.com/v1/accounts", { headers: h }).then((r) => r.json());
    if (acc.error) throw new Error("AdMob: " + acc.error.message);
    const list = acc.account || [];
    const a = list.find((x) => x.publisherId === ADMOB_PUB) || list[0];
    if (!a) throw new Error("ta Google račun nima AdMob računa");
    const today = ljToday();
    const ymdObj = (s) => ({ year: +s.slice(0, 4), month: +s.slice(5, 7), day: +s.slice(8, 10) });
    const body = { reportSpec: {
      dateRange: { startDate: ymdObj(START), endDate: ymdObj(today) },
      dimensions: ["MONTH", "APP", "PLATFORM"], metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS"],
      localizationSettings: { currencyCode: "EUR" } } };
    const rows = await fetch("https://admob.googleapis.com/v1/" + a.name + "/networkReport:generate", { method: "POST", headers: h, body: JSON.stringify(body) }).then((r) => r.json());
    if (rows && rows.error) throw new Error("AdMob: " + rows.error.message);
    const meseci = {};
    for (const x of rows || []) {
      if (!x.row) continue;
      const dv = x.row.dimensionValues, mv = x.row.metricValues;
      const m = dv.MONTH.value.slice(0, 4) + "-" + dv.MONTH.value.slice(4, 6);
      const app = admobApp(dv.APP.displayLabel), plat = /ios/i.test((dv.PLATFORM || {}).value || "") ? "ios" : "android";
      const o = ((meseci[m] = meseci[m] || {})[app] = meseci[m][app] || { zasluzek: 0, prikazi: 0, ios: 0, android: 0 });
      const e = Math.round(+((mv.ESTIMATED_EARNINGS || {}).microsValue || 0) / 10000) / 100;
      o.zasluzek = Math.round((o.zasluzek + e) * 100) / 100;
      o[plat] = Math.round((o[plat] + e) * 100) / 100;
      o.prikazi += +((mv.IMPRESSIONS || {}).integerValue || 0);
    }
    out.admob = { meseci, racun: a.publisherId, kdo: saved.kdo || "", osvezeno: Date.now() };
  } catch (e) { errors.admob = e.message; }
}

async function active(out) {
  const today = ljToday();
  const from = addDays(today, -30);
  const snap = await db().ref("akt").orderByKey().startAt(from).once("value");
  const days = snap.val() || {};
  const perDay = {}, w = {}, m = {}, plus7 = {};
  const week = addDays(today, -6);
  for (const [day, devs] of Object.entries(days)) {
    const c = { skupaj: 0, ios: 0, android: 0, web: 0, plus: 0, test: 0 };
    for (const [id, v] of Object.entries(devs || {})) {
      c.skupaj++;
      const p = v && v.p === "ios" ? "ios" : v && v.p === "android" ? "android" : "web";
      c[p]++;
      if (v && v.plus) c.plus++;
      if (v && v.p === "ios" && !v.r) c.test++;
      m[id] = p;
      if (day >= week) { w[id] = p; if (v && v.plus) plus7[id] = 1; }
    }
    perDay[day] = c;
  }
  const split = (o) => { const s = { skupaj: 0, ios: 0, android: 0, web: 0 }; for (const p of Object.values(o)) { s.skupaj++; s[p]++; } return s; };
  out.aktivni = { dnevi: perDay, danes: perDay[today] || { skupaj: 0 }, teden: split(w), mesec: split(m), plusTeden: Object.keys(plus7).length };
  // Stari zapisi stran.
  const old = await db().ref("akt").orderByKey().endAt(addDays(today, -KEEP_AKT_DAYS)).once("value");
  const del = {};
  old.forEach((c) => { del[c.key] = null; });
  if (Object.keys(del).length) await db().ref("akt").update(del);
}

async function rates(out, errors) {
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!r.ok) throw new Error("tečaji " + r.status);
    const j = await r.json();
    out.tecaji = Object.assign({ EUR: 1 }, j.rates, { datum: j.date });
  } catch (e) { errors.tecaji = e.message; }
}

// Račun, s katerim strežnik bere Google Play poročila (lastnik ga doda v Play Console).
async function serviceAccount() {
  try {
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", { headers: { "Metadata-Flavor": "Google" } });
    return r.ok ? (await r.text()).trim() : null;
  } catch (e) { return null; }
}

async function refresh() {
  const rocno = (await db().ref("nadzor/rocno").once("value")).val() || {};
  const out = {}, errors = {};
  await Promise.all([
    apple(String(rocno.vendor || "").trim(), out, errors),
    android(out, errors),
    play(String(rocno.playVedro || "").trim(), out, errors).catch((e) => { errors.play = e.message; }),
    admob(out, errors),
    active(out).catch((e) => { errors.aktivni = e.message; }),
    rates(out, errors)
  ]);
  const upd = { "povzetek/osvezeno": Date.now(), "povzetek/napake": Object.keys(errors).length ? errors : null, "povzetek/racun": await serviceAccount() };
  if (out.narocnine) upd["apple/narocnine"] = out.narocnine;
  if (out.appleApps) upd["apple/najdene"] = out.appleApps;
  upd["apple/dnevi"] = null;
  if (out.android) upd["android/prenosi"] = out.android.prenosi;
  if (out.play) upd.play = out.play;
  if (out.admob) upd.admob = out.admob;
  if (out.aktivni) upd.aktivni = out.aktivni;
  if (out.tecaji) upd.tecaji = out.tecaji;
  await db().ref("nadzor").update(upd);
  console.log("nadzor osvežen", JSON.stringify(errors));
}

exports.nadzorDnevno = onSchedule({ schedule: "15 9,18 * * *", timeZone: "Europe/Ljubljana", region: "europe-west1", timeoutSeconds: 300 }, refresh);

exports.nadzorOsvezi = onValueWritten({
  ref: "/nadzor/osvezi",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 300
}, async (event) => {
  if (!event.data.after.exists()) return;
  await refresh();
});

// Povezava z AdMob: »id« vrne ID odjemalca za Googlovo okno, »koda« zamenja enkratno kodo za trajni dostop.
exports.nadzorAdmob = onCall({ region: "europe-west1", timeoutSeconds: 120 }, async (req) => {
  const t = req.auth && req.auth.token;
  if (!t || !t.email_verified || !OWNERS.includes(String(t.email || "").toLowerCase())) throw new HttpsError("permission-denied", "Ni dostopa.");
  const c = await googleClient().catch((e) => { throw new HttpsError("unavailable", e.message); });
  if (req.data && req.data.akcija === "id") return { clientId: c.id };
  const code = String((req.data || {}).koda || "");
  if (!code) throw new HttpsError("invalid-argument", "Manjka koda.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: "postmessage", grant_type: "authorization_code" })
  }).then((x) => x.json());
  if (!r.refresh_token) {
    throw new HttpsError("failed-precondition", r.error ? "Google: " + (r.error_description || r.error) :
      "Google ni dal trajnega dostopa. Odpri myaccount.google.com/permissions, odstrani dostop za Nakupko in klikni »Poveži AdMob« znova.");
  }
  await db().ref("skrito/admob").set({ rt: r.refresh_token, kdo: t.email, ob: Date.now() });
  const out = {}, errors = {};
  await admob(out, errors);
  if (out.admob) await db().ref("nadzor/admob").set(out.admob);
  await db().ref("nadzor/povzetek/napake/admob").set(errors.admob || null);
  if (errors.admob) throw new HttpsError("failed-precondition", errors.admob);
  return { ok: true };
});
