// Nočna osvežitev cen (GitHub Actions, vsak dan ob ~3h).
// Za vsak izdelek iz kataloga poišče ponudbo v slovenskih trgovinah (vir: polnakosarica.si,
// ki zbira cene Spar, Mercator, Lidl, Hofer, Eurospin, Tuš) in zapiše prices.js + prices.json.
// Cena za trgovino = cena na kg/l (najugodnejša četrtina zadetkov) × velikost pakiranja iz kataloga,
// zato so cene med trgovinami primerljive ne glede na različna pakiranja. Upošteva akcije.
// Če vir ne deluje, ostanejo stare cene (nič se ne pokvari).
import fs from "node:fs";
import vm from "node:vm";

const ROOT = new URL("..", import.meta.url).pathname;
const API = process.env.PRICES_API || "https://www.polnakosarica.si/api/products";
const STORES = { spar: "spar", mercator: "mercator", lidl: "lidl", hofer: "hofer", eurospin: "eurospin", tus: "tus" };
const SKIP_CATS = new Set(["Tobak", "Dom in vrt"]);
const UA = "Nakupko/1.0 (+https://github.com/myedgeofficial/nakupko)";

// --- katalog ---
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["products.js", "products-extra.js"]) vm.runInContext(fs.readFileSync(ROOT + f, "utf8"), ctx);
const catalog = ctx.window.NAKUPKO_PRODUCTS.filter((p) => !SKIP_CATS.has(p[1]) && !p[5]);

// --- prejšnje cene ---
function loadOld() {
  try { return JSON.parse(fs.readFileSync(ROOT + "prices.json", "utf8")); } catch { /* prvič */ }
  const c = { window: {} };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(ROOT + "prices.js", "utf8"), c);
  return c.window.NAKUPKO_PRICES;
}
const old = loadOld();

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
const stem = (w) => w.slice(0, Math.max(3, Math.min(w.length, w.length > 5 ? w.length - 2 : w.length)));
const BAD = ["okus", "okusom", "rastlinsk", "vegan", "napolnjen", "polnjen", "omak", "preliv", "kroket", "pripravek", "nadomest"];

// velikost pakiranja iz kataloga: {kind:"kg"|"l"|"kos", amount}
function pack(unit) {
  const m = String(unit || "").replace(",", ".").match(/^\s*([\d.]+)?\s*(g|kg|ml|l)\s*$/i);
  if (!m) return { kind: "kos", amount: 1 };
  const n = m[1] ? parseFloat(m[1]) : 1, u = m[2].toLowerCase();
  if (u === "g") return { kind: "kg", amount: n / 1000 };
  if (u === "kg") return { kind: "kg", amount: n };
  if (u === "ml") return { kind: "l", amount: n / 1000 };
  return { kind: "l", amount: n };
}
// cena na kg/l za ponudbo trgovine
function perUnit(prod, sp, kind) {
  const eff = sp.actionPrice ?? sp.regularPrice;
  if (!(eff > 0)) return null;
  const u = String(prod.unit || "").toLowerCase(), q = Number(prod.quantity);
  const k = u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "l" : null;
  if (k === kind && q > 0) {
    const amt = u === "g" || u === "ml" ? q / 1000 : q;
    return eff / amt;
  }
  const lab = String(sp.unitLabel || "").toLowerCase();
  if (sp.pricePerUnit > 0 && lab === "eur/" + kind) return sp.pricePerUnit;
  return null;
}
function quantile(arr, q) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))];
}

// Če vir zapre dostop (403, prazni odgovori, izpad), skripta konča z napako in workflow odpre
// GitHub issue (= e-mail lastniku).
const stat = { ok: 0, fail: 0, codes: {} };
function blocked(why) {
  console.log(`::error::VIR NE DELUJE: ${why}. Statusi: ${JSON.stringify(stat.codes)}`);
  fs.writeFileSync(ROOT + ".price-error", `${why}\nStatusi odgovorov: ${JSON.stringify(stat.codes)}\n`);
  process.exit(2);
}
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let code = "napaka";
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      code = r.status;
      if (r.ok) {
        const d = await r.json().catch(() => null);
        if (d && Array.isArray(d.products)) { stat.ok++; stat.codes[200] = (stat.codes[200] || 0) + 1; return d; }
        code = "ni-JSON";
      }
    } catch { /* ponovi */ }
    stat.codes[code] = (stat.codes[code] || 0) + 1;
    if (typeof code === "number" && code < 500 && code !== 429) break;
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  stat.fail++;
  // hiter izhod: prvih 30 poizvedb skoraj vse neuspešne
  if (stat.ok + stat.fail >= 30 && stat.fail > (stat.ok + stat.fail) * 0.8) blocked("polnakosarica.si ne vrača cen (večina poizvedb neuspešnih)");
  return null;
}
async function search(q) {
  const d = await get(`${API}?q=${encodeURIComponent(q)}&limit=60`);
  return (d && d.products) || [];
}

let apiOk = 0;
const CATS = {};
const CAT_RE = {
  "Sadje in zelenjava": /sadje|zelenjav/,
  "Meso in ribe": /meso|mesn|rib|perutnin|morsk/,
  "Mlečni izdelki": /mle|sir|jajc|jogurt/,
  "Kruh in pecivo": /kruh|pecivo|pekov/,
  "Pijače": /pijac|sok|voda|pivo|vino|kava|caj/,
  "Zamrznjeno": /zamrz|smrz/,
};
async function pricesFor(p) {
  const [name, , , , unit] = p;
  const words = norm(name).split(" ").filter((w) => w.length >= 3);
  if (!words.length) return null;
  const want = words.map(stem);
  const nq = norm(name);
  const fits = (prod) => {
    const n = norm(prod.name);
    const toks = n.split(" ");
    if (!want.every((w) => toks.some((t) => t.startsWith(w)))) return false;
    return !BAD.some((b) => n.includes(b) && !nq.includes(b));
  };
  let found = (await search(name)).filter(fits);
  found.forEach((x) => { CATS[x.category_name] = (CATS[x.category_name] || 0) + 1; });
  if (found.length < 2 && words.length > 1) {
    const longest = words.slice().sort((a, b) => b.length - a.length)[0];
    const more = (await search(longest)).filter(fits);
    const seen = new Set(found.map((x) => x.id));
    found = found.concat(more.filter((x) => !seen.has(x.id)));
  }
  apiOk++;
  if (!found.length) return null;
  // raje pravi oddelek (sveže sadje, ne čips; meso, ne začimba) in izdelki, ki se začnejo z imenom
  const catRe = CAT_RE[p[1]];
  if (catRe) { const f = found.filter((x) => catRe.test(norm(x.category_name))); if (f.length) found = f; }
  const first = want[0];
  const pk = pack(unit);
  const byStore = {};
  const sale = {};
  for (const prod of found) {
    for (const sp of prod.storePrices || []) {
      const st = STORES[sp.storeSlug];
      if (!st) continue;
      let v;
      if (pk.kind === "kos") v = sp.actionPrice ?? sp.regularPrice;
      else { const u = perUnit(prod, sp, pk.kind); v = u == null ? null : u * pk.amount; }
      if (!(v > 0)) continue;
      (byStore[st] = byStore[st] || []).push({ v, sale: sp.actionPrice != null && sp.actionPrice < sp.regularPrice, starts: norm(prod.name).startsWith(first) });
    }
  }
  const cene = {};
  for (let [st, list] of Object.entries(byStore)) {
    // v vsaki trgovini raje izdelki, katerih ime se začne z iskanim (»Banane«, ne »Čips banana«)
    if (list.some((x) => x.starts)) list = list.filter((x) => x.starts);
    const vals = list.map((x) => x.v);
    const v = quantile(vals, pk.kind === "kos" ? 0.5 : 0.25);
    cene[st] = Math.round(v * 100) / 100;
    if (list.some((x) => x.sale && Math.abs(x.v - v) < 0.01)) sale[st] = 1;
  }
  if (!Object.keys(cene).length) return null;
  // nesmiselne odstopanje (napačen zadetek): zavrži cene, ki so >4× od mediane trgovin
  const med = quantile(Object.values(cene), 0.5);
  for (const st of Object.keys(cene)) if (cene[st] > med * 2.5 || cene[st] < med / 2.5) { delete cene[st]; delete sale[st]; }
  return { ime: name, cene, akcija: Object.keys(sale) };
}

// --- zagon (3 hkrati, vljudno do strežnika) ---
const results = [];
let idx = 0;
async function worker() {
  while (idx < catalog.length) {
    const p = catalog[idx++];
    const r = await pricesFor(p);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 300));
  }
}
await Promise.all([worker(), worker(), worker()]);

console.log("Oddelki vira:", JSON.stringify(Object.entries(CATS).sort((a, b) => b[1] - a[1]).slice(0, 60)));
console.log(`Katalog: ${catalog.length}, z novimi cenami: ${results.length}`);
console.log(`Poizvedbe: uspešne ${stat.ok}, neuspešne ${stat.fail}`, JSON.stringify(stat.codes));
if (stat.fail > (stat.ok + stat.fail) * 0.3) blocked(`polnakosarica.si: ${stat.fail} od ${stat.ok + stat.fail} poizvedb neuspešnih`);
if (results.length < 150) blocked(`polnakosarica.si vrača premalo zadetkov (${results.length} izdelkov, običajno ~540) – morda so spremenili ali zaprli dostop`);

// --- združi s starimi (trgovina brez nove cene obdrži staro) ---
const seenStores = new Set(results.flatMap((r) => Object.keys(r.cene)));
const map = new Map();
for (const e of old.izdelki || []) map.set(norm(e.ime), { ime: e.ime, cene: { ...e.cene } });
let changed = 0;
for (const r of results) {
  const k = norm(r.ime);
  const prev = map.get(k) || { ime: r.ime, cene: {} };
  // stare cene ostanejo le za trgovine, ki jih vir nocoj sploh ni vrnil (izpad); sicer veljajo samo sveže
  const keep = Object.fromEntries(Object.entries(prev.cene).filter(([st]) => !seenStores.has(st)));
  const next = { ime: r.ime, cene: { ...keep, ...r.cene } };
  if (r.akcija.length) next.akcija = r.akcija;
  if (JSON.stringify(prev.cene) !== JSON.stringify(next.cene) || JSON.stringify(prev.akcija || []) !== JSON.stringify(next.akcija || [])) changed++;
  map.set(k, next);
}
// ohrani akcije samo za osvežene izdelke
const fresh = new Set(results.map((r) => norm(r.ime)));
for (const [k, e] of map) if (!fresh.has(k)) delete e.akcija;

const izdelki = [...map.values()].sort((a, b) => a.ime.localeCompare(b.ime, "sl"));
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
const same = JSON.stringify(izdelki) === JSON.stringify((old.izdelki || []).slice().sort((a, b) => a.ime.localeCompare(b.ime, "sl")));
if (same) console.log("Cene so enake kot včeraj.");
// datum = zadnja sprememba cen (po njem aplikacija ve, da so novejše), preverjeno = zadnji uspešen pregled
const out = { datum: same && old.datum ? old.datum : today, preverjeno: today, vir: "polnakosarica.si", izdelki };
fs.writeFileSync(ROOT + "prices.json", JSON.stringify(out));
fs.writeFileSync(ROOT + "prices.js",
  `// Cene se osvežijo vsako noč ob ~3h (scripts/update-prices.mjs). Vir: polnakosarica.si (Spar, Mercator, Lidl, Hofer, Eurospin, Tuš).\nwindow.NAKUPKO_PRICES = ${JSON.stringify(out)};\n`);
console.log(`Spremenjenih izdelkov: ${changed}, skupaj s cenami: ${izdelki.length}`);
const SHOW = /^(Banane|Lubenica|Paprika|Por|Sir |Mozzarella|Parmezan|Feta|Mleto|Pi..an|Hrenovke|Pr.ut|.unka|Jajca|Kruh|Kava|Pivo|Maslo|Jogurt)/;
for (const r of results.filter((r) => SHOW.test(r.ime))) console.log(" ", r.ime, JSON.stringify(r.cene), r.akcija.length ? "akcija:" + r.akcija.join(",") : "");
