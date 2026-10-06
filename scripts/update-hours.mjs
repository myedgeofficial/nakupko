// Nočna osvežitev odpiralnih časov (GitHub Actions).
// Uradni podatki trgovin (Spar, Lidl, Hofer, Mercator, Tuš, Eurospin, Jager) namesto OpenStreetMap,
// kjer so časi pogosto zastareli. Rezultat: hours.json = { datum, trgovine: [{ v, lat, lon, h, n }] },
// h je v obliki OSM opening_hours (»Mo-Sa 07:00-21:00; Su off«), ki ga aplikacija že zna brati.
// Trgovine brez koordinat poiščemo po naslovu (Nominatim, 1 poizvedba/s) in koordinate ohranimo za naslednjič.
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const UA = "Nakupko/1.0 (+https://github.com/myedgeofficial/nakupko)";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

let old = {};
try { old = JSON.parse(fs.readFileSync(ROOT + "hours.json", "utf8")); } catch { /* prvič */ }
const oldGeo = new Map((old.trgovine || []).filter((t) => t.g).map((t) => [t.v + "|" + t.a, [t.lat, t.lon]]));

async function get(url, opt = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { "user-agent": BROWSER, "accept-language": "sl-SI,sl;q=0.9", ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return r;
      if (r.status === 404) return null;
      console.log("  HTTP", r.status, url);
    } catch (e) { console.log("  napaka", url, String(e).slice(0, 120)); }
    await sleep(1500 * (i + 1));
  }
  return null;
}
const getText = async (u, o) => { const r = await get(u, o); return r ? r.text() : null; };
const getJson = async (u, o) => { const r = await get(u, o); try { return r ? await r.json() : null; } catch { return null; } };

// --- pretvorba v OSM obliko ---
const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const toMin = (s) => { const m = String(s).match(/(\d{1,2})[:.](\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
// week: 7 seznamov [[od, do], ...] v minutah (Mo..Su); null = ni podatka za dan
function toOsm(week) {
  if (week.every((d) => d == null)) return null;
  // posamezen »zaprt« delavnik med enakimi odprtimi dnevi je skoraj vedno napaka vira (posebni datum)
  const key = (d) => JSON.stringify(d || []);
  for (let i = 0; i < 5; i++) {
    if (week[i] && week[i].length) continue;
    const others = [0, 1, 2, 3, 4].filter((j) => j !== i).map((j) => key(week[j]));
    if (others.every((k) => k === others[0] && k !== "[]")) week[i] = JSON.parse(others[0]);
  }
  const txt = week.map((d) => (!d || !d.length) ? "off" : d.map(([a, b]) => hm(a) + "-" + hm(b === 1440 ? 1440 : b).replace("24:00", "24:00")).join(","));
  if (txt.every((t) => t === "off")) return null;
  const parts = [];
  for (let i = 0; i < 7;) {
    let j = i;
    while (j + 1 < 7 && txt[j + 1] === txt[i]) j++;
    parts.push((i === j ? DAYS[i] : DAYS[i] + "-" + DAYS[j]) + " " + txt[i]);
    i = j + 1;
  }
  return parts.join("; ");
}
// slovenski dnevi v besedilu: »pon-pet«, »ponedeljek – petek«, »sobota«, »ned«, »sob., ned. in prazniki«
const DAY_RE = [/^pon/, /^tor/, /^sre/, /^(cet|čet)/, /^pet/, /^sob/, /^ned/];
const dayIdx = (w) => DAY_RE.findIndex((re) => re.test(norm(w)));
// Iz besedila (vrstice »Ponedeljek: 08:00-20:00«, »PON-PET: 06:00 - 18:00«, »Nedelja: Zaprto«) sestavi teden.
function parseDayText(text) {
  const week = Array(7).fill(null);
  const t = String(text).replace(/–|—/g, "-").replace(/\s+/g, " ");
  const re = /((?:pon|tor|sre|čet|cet|pet|sob|ned)[a-zčšž]*\.?)(?:\s*(?:-|do)\s*((?:pon|tor|sre|čet|cet|pet|sob|ned)[a-zčšž]*\.?))?\s*:?\s*((?:\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}(?:\s*(?:,|in|\/)\s*)?)+|zaprto|-(?!\s*\d))/gi;
  let m, hit = 0;
  while ((m = re.exec(t))) {
    const a = dayIdx(m[1]), b = m[2] ? dayIdx(m[2]) : a;
    if (a < 0 || b < 0) continue;
    const spans = /zaprto|^-$/i.test(m[3].trim()) ? [] : [...m[3].matchAll(/(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/g)].map((x) => [toMin(x[1]), toMin(x[2])]);
    for (let d = a; ; d = (d + 1) % 7) { if (week[d] == null) week[d] = spans; if (d === b) break; }
    hit++;
  }
  return hit ? week : null;
}
// schema.org openingHoursSpecification / openingHours
const SCHEMA_DAYS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6, mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
function fromSchema(ld) {
  const week = Array(7).fill(null);
  let hit = 0;
  for (const s of [].concat(ld.openingHoursSpecification || [])) {
    const ds = [].concat(s.dayOfWeek || []).map((d) => SCHEMA_DAYS[String(d).split("/").pop().toLowerCase()]).filter((d) => d != null);
    if (s.validFrom || s.validThrough) continue;
    const a = toMin(s.opens), b = toMin(s.closes);
    for (const d of ds) { week[d] = week[d] || []; if (a != null && b != null && b > a) week[d].push([a, b]); hit++; }
  }
  for (const o of [].concat(ld.openingHours || [])) {
    const m = String(o).match(/^([A-Za-z]{2})(?:-([A-Za-z]{2}))?\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
    if (!m) continue;
    const a = SCHEMA_DAYS[m[1].toLowerCase()], b = SCHEMA_DAYS[(m[2] || m[1]).toLowerCase()];
    for (let d = a; ; d++) { week[d] = (week[d] || []).concat([[toMin(m[3]), toMin(m[4])]]); hit++; if (d === b) break; }
  }
  if (!hit) return null;
  return week.map((d) => d || []);
}
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); for (const x of [].concat(j["@graph"] || j)) out.push(x); } catch { /* slab JSON */ }
  }
  return out;
}
const strip = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "-").replace(/[ \t]+/g, " ");
async function sitemap(url) {
  const x = await getText(url);
  return x ? [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&")) : [];
}
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { const r = await fn(it); if (r) out.push(r); } catch (e) { console.log("  napaka", String(e).slice(0, 120)); } await sleep(250); }
  }));
  return out;
}

const all = [];
const stat = {};
const dbg = [];  // povzetek za stran workflowa (dnevnik se iz aplikacije ne da brati)
function add(v, s) {
  stat[v] = stat[v] || { vse: 0, ure: 0, xy: 0 };
  stat[v].vse++;
  if (!s.h) return;
  stat[v].ure++;
  all.push({ v, ...s });
}

// --- Spar ---
async function spar() {
  const list = await getJson("https://www.spar.si/trgovine/_jcr_content.stores.v2.html");
  if (!Array.isArray(list)) return console.log("Spar: ni podatkov");
  const DN = ["ponedeljek", "torek", "sreda", "cetrtek", "petek", "sobota", "nedelja"];
  for (const s of list) {
    if (s.temporarilyClosed) continue;
    const week = Array(7).fill(null);
    for (const x of s.shopHours || []) {
      const o = x.openingHours || {};
      if (x.timeperiod && x.timeperiod.timeperiodType && x.timeperiod.timeperiodType !== "standard") continue;
      const d = DN.indexOf(norm(o.dayType));
      if (d < 0) continue;
      const span = (f, t) => f && t && f.hourOfDay != null && t.hourOfDay != null ? [f.hourOfDay * 60 + (f.minute || 0), t.hourOfDay * 60 + (t.minute || 0)] : null;
      week[d] = [span(o.from1, o.to1), span(o.from2, o.to2)].filter((x) => x && x[1] > x[0]);
    }
    for (let d = 0; d < 7; d++) if (week[d] == null && week.some((x) => x != null)) week[d] = [];
    add("spar", { lat: +s.latitude, lon: +s.longitude, h: toOsm(week), n: [s.name, s.address, s.city].filter(Boolean).join(", ") });
  }
}

// --- Lidl (isti vir kot iskalnik trgovin na lidl.si) ---
async function lidl() {
  const H = { "x-apikey": "16QaHsGX3Uc3JLhNlS2ZG1CmosbzVPs2", accept: "application/json" };
  let offset = 0, total = 1, n = 0;
  while (offset < total && n++ < 30) {
    const j = await getJson(`https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores?country_code=SI&offset=${offset}`, { headers: H });
    if (!j) return console.log("Lidl: ni podatkov");
    const items = j.items || j.stores || j.data || [];
    if (n === 1) console.log("Lidl ključi:", Object.keys(j).join(","), "| trgovina:", Object.keys(items[0] || {}).join(","));
    if (n === 1) dbg.push("lidl trgovina " + JSON.stringify(Object.fromEntries(Object.entries(items[0] || {}).filter(([k]) => k !== "openingHours"))).slice(0, 300));
    for (const s of items) {
      const week = Array(7).fill(null);
      for (const it of (s.openingHours && s.openingHours.items) || []) {
        const d = (new Date(it.date).getUTCDay() + 6) % 7;
        if (it.reason === "REGULAR" || it.reason === "SUNDAY_REPEAT") {
          week[d] = (week[d] || []).concat((it.timeRanges || []).map((r) => [toMin(String(r.from).slice(11)), toMin(String(r.to).slice(11))]).filter((x) => x[0] != null && x[1] > x[0]));
        } else if (it.reason === "CLOSED" && week[d] == null) week[d] = [];
      }
      // Lidl v Sloveniji ob nedeljah zaprt; dnevi brez podatka = zaprto, če so drugi znani
      for (let d = 0; d < 7; d++) if (week[d] == null && week.some((x) => x && x.length)) week[d] = [];
      for (let d = 0; d < 7; d++) if (week[d]) week[d] = [...new Map(week[d].map((x) => [x.join("-"), x])).values()];
      const a = s.address || {};
      add("lidl", { lat: +(a.latitude ?? s.latitude), lon: +(a.longitude ?? s.longitude), h: toOsm(week), n: ["Lidl " + (s.storeName || s.name || ""), [a.streetName || s.street, a.streetNumber || s.housenumber].filter(Boolean).join(" ")].join(", ") });
    }
    const meta = j.meta || {};
    total = meta.total ?? items.length;
    offset += meta.limit || items.length || 1000;
    if (!items.length) break;
  }
}

// --- Hofer: lokacije iz API; urnik poiščemo v odgovoru, če obstaja ---
function findHours(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/open|hour|urnik/i.test(k) && v && typeof v === "object") return { k, v };
    const r = findHours(v, depth + 1);
    if (r) return r;
  }
  return null;
}
async function hofer() {
  const j = await getJson("https://api.hofer.si/v2/service-points?limit=1000", { headers: { accept: "application/json" } });
  const list = (j && (j.data || j.items)) || [];
  if (!list.length) return console.log("Hofer: ni podatkov");
  console.log("Hofer ključi:", Object.keys(list[0]).join(","));
  const probe = await getJson(`https://api.hofer.si/v2/service-points/${encodeURIComponent(list[0].id)}`, { headers: { accept: "application/json" } });
  const ph = findHours(probe) || findHours(list[0]);
  console.log("Hofer urnik:", ph ? ph.k + " " + JSON.stringify(ph.v).slice(0, 400) : "ni v odgovoru");
  dbg.push("hofer ključi " + Object.keys(list[0]).join(",") + " | urnik " + (ph ? ph.k + " " + JSON.stringify(ph.v).slice(0, 300) : "ni") + " | detajl " + JSON.stringify(probe || {}).slice(0, 300));
  const DN = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  for (const s of list) {
    const a = s.address || {};
    let h = null;
    const f = findHours(s);
    if (f && Array.isArray(f.v)) {
      const week = Array(7).fill(null);
      for (const x of f.v) {
        const d = DN[norm(x.day || x.dayOfWeek || x.weekday)];
        if (d == null) continue;
        const a1 = toMin(x.openFrom || x.from || x.open || x.opens), b1 = toMin(x.openUntil || x.to || x.close || x.closes);
        week[d] = x.closed || a1 == null ? [] : [[a1, b1]];
      }
      h = toOsm(week);
    }
    add("hofer", { lat: +a.latitude, lon: +a.longitude, h, n: [a.address1, a.city].filter(Boolean).join(", ") });
  }
}

// --- strani s seznamom trgovin (Mercator, Tuš, Eurospin): JSON-LD ali besedilo ---
async function pages(v, urls, filter) {
  const n0 = urls.length;
  urls = urls.filter((u) => filter(u));
  console.log(v + ": strani", urls.length);
  dbg.push(v + " strani " + urls.length + "/" + n0);
  let shown = 0;
  await pool(urls, 4, async (u) => {
    const html = await getText(u);
    if (!html) return;
    const lds = jsonLd(html).filter((x) => x.openingHoursSpecification || x.openingHours || x.geo || x.address);
    let week = null, lat = null, lon = null, addr = "";
    for (const ld of lds) {
      week = week || fromSchema(ld);
      if (ld.geo && ld.geo.latitude) { lat = +ld.geo.latitude; lon = +ld.geo.longitude; }
      const ad = ld.address || {};
      if (!addr && (ad.streetAddress || typeof ad === "string")) addr = strip(typeof ad === "string" ? ad : [ad.streetAddress, ad.postalCode, ad.addressLocality].filter(Boolean).join(", ")).replace(/\s+/g, " ").trim();
    }
    const text = strip(html);
    if (!week) {
      // le del strani okoli »odpiralni čas« (da ne poberemo ur iz noge strani)
      const i = text.search(/odpiraln|delovni [čc]as/i);
      week = parseDayText(i >= 0 ? text.slice(i, i + 1500) : text);
      // ure so lahko tudi v skripti / atributih (stran sestavljena z JavaScriptom)
      if (!week) { const j = html.search(/\bPON\b\s*(?::|-|–|&#8211;)|ponedeljek|Pon-Pet/i); if (j >= 0) week = parseDayText(strip(html.slice(Math.max(0, j - 50), j + 1500)).replace(/\\n|\\u002F|\\\//g, " ")); }
    }
    if (lat == null) {
      const m = html.match(/data-lat(?:itude)?=["']([\d.]+)["'][^>]*data-(?:lng|lon|longitude)=["']([\d.]+)/i) || html.match(/["']lat["']\s*:\s*["']?(4[56]\.\d+)["']?\s*,\s*["'](?:lng|lon)["']\s*:\s*["']?(1[3-6]\.\d+)/i) || html.match(/[?&](?:q|query|ll|destination)=(4[56]\.\d{3,})\s*,\s*(1[3-6]\.\d{3,})/);
      if (m) { lat = +m[1]; lon = +m[2]; }
    }
    if (!addr) { const g = html.match(/maps\.google\.[a-z]+\/(?:maps)?\?q=([^"'&<]+)/i); if (g) addr = decodeURIComponent(g[1].replace(/\+/g, " ")).replace(/&amp;/g, "&").trim(); }
    if (!addr) { const m = text.match(/([A-ZČŠŽ][^\n,]{2,60}?\s\d+[a-z]?)\s*,?\s*(\d{4})\s+([A-ZČŠŽ][^\n,]{1,40})/); if (m) addr = m[1].trim() + ", " + m[2] + " " + m[3].trim(); }
    const h = week ? toOsm(week.map((d) => d || [])) : null;
    if (shown < 2 && !h) { const j = html.search(/PON\s*-\s*PET|ponedeljek|odpiraln/i); dbg.push(v + " surovo(" + html.length + "): " + (j >= 0 ? html.slice(Math.max(0, j - 150), j + 300) : html.slice(0, 300)).replace(/\s+/g, " ")); }
    if (shown++ < 2) { console.log("  vzorec", v, u, "|", addr, "|", lat, lon, "|", h); dbg.push(`${v} vzorec ${u.split("/").filter(Boolean).pop()} | ${addr} | ${lat},${lon} | ${h} | ld ${lds.length}` + (h ? "" : " | besedilo: " + text.slice(Math.max(0, text.search(/odpiraln/i)), Math.max(0, text.search(/odpiraln/i)) + 250).replace(/\s+/g, " "))); }
    add(v, { lat, lon, a: addr, h, n: addr || u });
  });
}

async function mercator() {
  const urls = [...await sitemap("https://www.mercator.si/sitemap.xml/sitemap/Store/1"), ...await sitemap("https://www.mercator.si/sitemap.xml/sitemap/Store/2")];
  await pages("mercator", urls, (u) => /prodajna-mesta\//.test(u) && !/trafik|cash|tehnik|center-tehnike|gradbeni|kmetijsk|intersport|modiana|optika|lekarn|bencin/i.test(u));
}
async function tus() {
  const urls = await sitemap("https://www.tus.si/tus_shops_offices-sitemap.xml");
  await pages("tus", urls, (u) => /poslovalnica\//.test(u) && !/cashcarry|cash-carry|drogerij|tehnik|gradben|fitnes|kino|planet/i.test(u));
}
async function eurospin() {
  let urls = await sitemap("https://www.eurospin.si/store-sitemap.xml");
  if (!urls.length) { const x = await getText("https://www.eurospin.si/store-sitemap.xml"); dbg.push("eurospin sitemap: " + String(x).slice(0, 200).replace(/\s+/g, " ")); }
  if (!urls.length) { const idx = await sitemap("https://www.eurospin.si/sitemap_index.xml"); dbg.push("eurospin index: " + idx.join(" ").slice(0, 300)); for (const sm of idx.filter((u) => /store|prodaj|trgov/i.test(u))) urls.push(...await sitemap(sm)); }
  await pages("eurospin", urls, (u) => /prodajna-mesta\/.+/.test(u));
}

// --- Jager: ena stran z vsemi poslovalnicami ---
async function jager() {
  const html = await getText("https://www.trgovinejager.com/Poslovalnice/");
  if (!html) return console.log("Jager: ni podatkov");
  const text = strip(html);
  // bloki se začnejo z »JAGER ...« in vsebujejo naslov s poštno številko
  const blocks = text.split(/(?=JAGER\s)/).slice(1);
  dbg.push("jager blokov " + blocks.length);
  let shown = 0;
  for (const b of blocks) {
    const one = b.replace(/\s+/g, " ");
    const m = one.match(/^JAGER\s.*?[-–]\s*[A-ZČŠŽ .]+?\s+([A-ZČŠŽ](?:[a-zčšž]|\s[a-zčšž])[^0-9]*?\s\d+[a-zA-Z]?)\s+(\d{4})\s+([A-ZČŠŽ][a-zčšž]+(?:\s(?:ob|na|pri|v|(?!Pon|Tor|Sre|Čet|Pet|Sob|Ned|Odpiral|Delovn)[A-ZČŠŽ][a-zčšž]+))*)/);
    const week = parseDayText(b.slice(0, 600));
    const addr = m ? (m[1].trim() + ", " + m[2] + " " + m[3].trim()) : "";
    const h = week ? toOsm(week.map((d) => d || [])) : null;
    if (shown++ < 2 || (!h && shown < 6)) { console.log("  vzorec jager |", addr, "|", h); dbg.push("jager vzorec | " + addr + " | " + h + " | " + b.slice(0, 450).replace(/\s+/g, " ")); }
    if (addr) add("jager", { lat: null, lon: null, a: addr, h, n: addr });
  }
}

// --- naslov → koordinate (Nominatim; shranimo za naslednjič) ---
const geoHits = { photon: 0, nominatim: 0 };
async function geocode() {
  let asked = 0;
  for (const t of all) {
    if (t.lat && t.lon) continue;
    if (!t.a) continue;
    const key = t.v + "|" + t.a;
    if (oldGeo.has(key)) { [t.lat, t.lon] = oldGeo.get(key); t.g = 1; continue; }
    if (asked >= 1200) continue;
    asked++;
    const q = t.a.replace(/\s+/g, " ").replace(/,\s*(\d{4}),/, ", $1 ");
    const p = await getJson("https://photon.komoot.io/api/?limit=1&bbox=13.3,45.4,16.7,46.9&q=" + encodeURIComponent(q), { headers: { "user-agent": UA } }, 1);
    const f = p && p.features && p.features[0];
    if (f && f.geometry) { [t.lon, t.lat] = f.geometry.coordinates; t.g = 1; geoHits.photon++; }
    else {
      const j = await getJson("https://nominatim.openstreetmap.org/search?format=json&countrycodes=si&limit=1&q=" + encodeURIComponent(q), { headers: { "user-agent": UA } }, 1);
      if (j && j[0]) { t.lat = +j[0].lat; t.lon = +j[0].lon; t.g = 1; geoHits.nominatim++; }
    }
    await sleep(1100);
  }
  console.log("Nominatim poizvedb:", asked);
  dbg.push("geokodiranje " + asked + ", najdeno " + JSON.stringify(geoHits));
}

for (const [name, fn] of [["spar", spar], ["lidl", lidl], ["hofer", hofer], ["mercator", mercator], ["tus", tus], ["eurospin", eurospin], ["jager", jager]]) {
  const t0 = Date.now();
  try { await fn(); } catch (e) { console.log(name, "napaka:", String(e).slice(0, 200)); }
  console.log(name, "končano v", Math.round((Date.now() - t0) / 1000), "s");
}
await geocode();

const ok = all.filter((t) => t.lat > 45 && t.lat < 47.1 && t.lon > 13 && t.lon < 16.7 && t.h);
for (const t of ok) { stat[t.v].xy++; t.lat = Math.round(t.lat * 1e5) / 1e5; t.lon = Math.round(t.lon * 1e5) / 1e5; }
for (const v of Object.keys(stat)) { const a = all.filter((t) => t.v === v); dbg.push(`${v}: z urnikom ${a.length}, z naslovom ${a.filter((t) => t.a).length}, s koord. ${a.filter((t) => t.lat).length}`); }
console.log("::notice title=Odpiralni časi (podrobno)::" + dbg.join(" ¦ ").slice(0, 3800));
const summary = Object.entries(stat).map(([v, s]) => `${v}: ${s.xy}/${s.vse}`).join(", ");
console.log(`::notice title=Odpiralni časi::${ok.length} trgovin z urnikom in lokacijo. ${summary}`);
const samples = ["spar", "lidl", "hofer", "mercator", "tus", "eurospin", "jager"].map((v) => ok.find((t) => t.v === v)).filter(Boolean);
console.log(`::notice title=Vzorci urnikov::` + samples.map((t) => `${t.v} ${t.n.slice(0, 40)}: ${t.h}`).join(" | "));
// varovalka: če vir skoraj nič ne vrne, obdržimo prejšnje podatke te verige
const prevBy = {};
for (const t of old.trgovine || []) (prevBy[t.v] = prevBy[t.v] || []).push(t);
const out = [];
for (const v of new Set([...Object.keys(prevBy), ...ok.map((t) => t.v)])) {
  const now = ok.filter((t) => t.v === v), prev = prevBy[v] || [];
  out.push(...(now.length >= prev.length * 0.5 ? now : prev));
}
out.sort((a, b) => a.v.localeCompare(b.v) || a.lat - b.lat);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
fs.writeFileSync(ROOT + "hours.json", JSON.stringify({ datum: today, trgovine: out.map(({ v, lat, lon, h, n, a, g }) => ({ v, lat, lon, h, n: (n || "").slice(0, 80), ...(g ? { a, g } : {}) })) }));
console.log("Zapisano:", out.length);
