// Nadzorna plošča: vsak dan (in ob kliku »Osveži«) zbere prenose, naročnine in prihodke iz
// App Store Connect, prenose Android APK z GitHuba in anonimne aktivne uporabnike iz /akt.
// Rezultat zapiše v /nadzor, ki ga lahko bereta samo lastnika (glej database.rules.json).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueWritten } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
const crypto = require("crypto");
const zlib = require("zlib");

const START = "2026-10-01";          // pred tem ni bilo prodaje
const KEEP_AKT_DAYS = 60;
const REPO = "myedgeofficial/nakupko";

const db = () => admin.database();
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const ljToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });

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

// Vrne vrstice poročila kot objekte, [] če tisti dan ni bilo prodaje, null če poročila še ni.
async function ascReport(jwt, params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch("https://api.appstoreconnect.apple.com/v1/salesReports?" + q, {
    headers: { authorization: "Bearer " + jwt, accept: "application/a-gzip" }
  });
  if (r.status === 404) {
    const t = await r.text();
    if (/not available yet/i.test(t)) return null;
    if (/no sales|no data/i.test(t)) return [];
    throw new Error("Apple 404: " + t.slice(0, 200));
  }
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 300);
    try { msg = JSON.parse(t).errors.map((e) => e.detail || e.title).join("; "); } catch (e) { /* surovo */ }
    throw new Error("Apple " + r.status + ": " + msg);
  }
  const txt = zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => { const v = l.split("\t"), o = {}; head.forEach((k, i) => { o[k.trim()] = (v[i] || "").trim(); }); return o; });
}

const num = (s) => { const n = parseFloat(String(s || "0").replace(",", ".")); return isFinite(n) ? n : 0; };
const addTo = (obj, k, v) => { if (!k || !v) return; obj[k] = Math.round(((obj[k] || 0) + v) * 100) / 100; };

function summarizeSales(rows) {
  const d = { prenosi: 0, ponovni: 0, posodobitve: 0, narocnine: 0, izplacilo: {}, kupci: {}, drzave: {}, naprave: {} };
  for (const r of rows) {
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
  return d;
}

async function apple(vendor, out, errors) {
  if (!vendor) { errors.apple = "Vpiši Apple »Vendor number« v Nastavitvah spodaj."; return; }
  let jwt;
  try { jwt = ascJwt(); } catch (e) { errors.apple = e.message; return; }
  const ref = db().ref("nadzor/apple/dnevi");
  const have = (await ref.once("value")).val() || {};
  const today = ljToday();
  let fetched = 0;
  for (let day = START; day < today && fetched < 40; day = addDays(day, 1)) {
    if (have[day] && have[day].koncno) continue;
    fetched++;
    try {
      const rows = await ascReport(jwt, {
        "filter[frequency]": "DAILY", "filter[reportType]": "SALES", "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]": vendor, "filter[reportDate]": day, "filter[version]": "1_1"
      });
      if (rows === null) continue;  // poročilo še ni pripravljeno
      const s = summarizeSales(rows);
      s.koncno = true;
      await ref.child(day).set(s);
    } catch (e) { errors.apple = e.message; break; }
  }
  // Aktivne naročnine: zadnje razpoložljivo dnevno poročilo o naročninah.
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
      } catch (e) { if (!/version/i.test(e.message)) { errors.narocnine = e.message; break; } }
    }
    if (rows === null) continue;
    const n = { datum: day, placljive: 0, brezplacne: 0, drzave: {} };
    for (const r of rows) {
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

async function refresh() {
  const rocno = (await db().ref("nadzor/rocno").once("value")).val() || {};
  const out = {}, errors = {};
  await Promise.all([
    apple(String(rocno.vendor || "").trim(), out, errors),
    android(out, errors),
    active(out).catch((e) => { errors.aktivni = e.message; }),
    rates(out, errors)
  ]);
  const upd = { "povzetek/osvezeno": Date.now(), "povzetek/napake": Object.keys(errors).length ? errors : null };
  if (out.narocnine) upd["apple/narocnine"] = out.narocnine;
  if (out.android) upd["android/prenosi"] = out.android.prenosi;
  if (out.aktivni) upd.aktivni = out.aktivni;
  if (out.tecaji) upd.tecaji = out.tecaji;
  await db().ref("nadzor").update(upd);
  console.log("nadzor osvežen", JSON.stringify(errors));
}

exports.nadzorDnevno = onSchedule({ schedule: "15 9 * * *", timeZone: "Europe/Ljubljana", region: "europe-west1", timeoutSeconds: 300 }, refresh);

exports.nadzorOsvezi = onValueWritten({
  ref: "/nadzor/osvezi",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 300
}, async (event) => {
  if (!event.data.after.exists()) return;
  await refresh();
});
