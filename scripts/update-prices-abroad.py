#!/usr/bin/env python3
"""Nočna osvežitev cen v sosednjih državah (GitHub Actions, po slovenskih cenah).

Brezplačni dnevni viri:
  AT  heisse-preise.io (Billa, Spar, Hofer, MPreis, dm, Unimarkt, BIPA, Müller; MIT)
  HR  api.cijene.dev dnevni ZIP (zakonsko javni cjeniki vseh verig, NN 75/2025)
  HU  GVH Árfigyelő dnevna Excel datoteka (državni primerjalnik cen)
Italija nima brezplačnega vira, zato tam cen ni.

Za vsak izdelek iz kataloga, ki ima v products-i18n.js iskalne izraze za državo, poišče ponudbe
po verigah. Cena za verigo = redna cena na kg/l (spodnja tretjina zadetkov) × pakiranje iz kataloga,
kot pri slovenskih cenah. Zapiše prices-at.json, prices-hr.json, prices-hu.json.
Če vir ne deluje, ostane stara datoteka (nič se ne pokvari).
"""
import csv, io, json, os, re, statistics, sys, unicodedata, urllib.request, zipfile, datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
UA = "Nakupko/1.0 (+https://github.com/myedgeofficial/nakupko)"
TODAY = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=2))).date().isoformat()
COUNTRIES = (os.environ.get("DRZAVE") or "AT,HR,HU").split(",")

# Verige: ključ v aplikaciji, ime, vzorec za ime trgovine v OpenStreetMap, barva.
CHAINS = {
    "AT": {
        "billa": ("at_billa", "Billa", "billa", "#E3051B"),
        "spar": ("at_spar", "Spar", "spar", "#2E9D4A"),
        "hofer": ("at_hofer", "Hofer", "hofer|aldi", "#2B3A78"),
        "mpreis": ("at_mpreis", "MPreis", "mpreis|m preis", "#C8102E"),
        "unimarkt": ("at_unimarkt", "Unimarkt", "unimarkt", "#E2001A"),
        "dm": ("at_dm", "dm", "^dm\\b|dm[ -]drogerie", "#2A4B9B"),
        "bipa": ("at_bipa", "BIPA", "bipa", "#E5007E"),
        "mueller": ("at_mueller", "Müller", "m[uü]ller", "#F39200"),
    },
    "HR": {
        "konzum": ("hr_konzum", "Konzum", "konzum", "#E2001A"),
        "lidl": ("hr_lidl", "Lidl", "lidl", "#1F5FBF"),
        "spar": ("hr_spar", "Spar", "spar", "#2E9D4A"),
        "kaufland": ("hr_kaufland", "Kaufland", "kaufland", "#D7000F"),
        "plodine": ("hr_plodine", "Plodine", "plodine", "#E30613"),
        "tommy": ("hr_tommy", "Tommy", "tommy", "#00843D"),
        "studenac": ("hr_studenac", "Studenac", "studenac", "#E30613"),
        "eurospin": ("hr_eurospin", "Eurospin", "eurospin", "#2B8FD6"),
        "ktc": ("hr_ktc", "KTC", "\\bktc\\b", "#0B4EA2"),
        "dm": ("hr_dm", "dm", "^dm\\b|dm[ -]drogerie", "#2A4B9B"),
        "ribola": ("hr_ribola", "Ribola", "ribola", "#0072BC"),
        "ntl": ("hr_ntl", "NTL", "\\bntl\\b", "#E30613"),
        "zabac": ("hr_zabac", "Žabac", "[zž]abac", "#2E9D4A"),
        "vrutak": ("hr_vrutak", "Vrutak", "vrutak", "#2B8FD6"),
        "boso": ("hr_boso", "Boso", "\\bboso\\b", "#E30613"),
        "trgocentar": ("hr_trgocentar", "Trgocentar", "trgocentar", "#0B4EA2"),
        "lorenco": ("hr_lorenco", "Lorenco", "lorenco", "#8A5A2B"),
        "roto": ("hr_roto", "Roto", "\\broto\\b", "#E30613"),
    },
    "HU": {
        "tesco": ("hu_tesco", "Tesco", "tesco", "#00539F"),
        "aldi": ("hu_aldi", "Aldi", "aldi", "#2B3A78"),
        "lidl": ("hu_lidl", "Lidl", "lidl", "#1F5FBF"),
        "spar": ("hu_spar", "Spar", "spar", "#2E9D4A"),
        "auchan": ("hu_auchan", "Auchan", "auchan", "#E2001A"),
        "penny": ("hu_penny", "Penny", "penny", "#CD1719"),
        "cba": ("hu_cba", "CBA", "\\bcba\\b", "#E30613"),
        "coop": ("hu_coop", "Coop", "\\bcoop\\b", "#E2001A"),
        "metro": None,
        "rossmann": ("hu_rossmann", "Rossmann", "rossmann", "#C8102E"),
        "muller": ("hu_muller", "Müller", "m[uü]ller", "#F39200"),
        "dm": ("hu_dm", "dm", "^dm\\b", "#2A4B9B"),
    },
}
DRUGSTORES = {"dm", "bipa", "mueller", "muller", "rossmann"}
DRUG_CATS = re.compile(r"^(Higiena|Gospodinjstvo|Otroci|Zdravje|Ljubljenčki)$")
CURRENCY = {"AT": "EUR", "HR": "EUR", "HU": "HUF"}
LANG_IDX = {"AT": 1, "HR": 2, "HU": 3}


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("ß", "ss")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9% ]+", " ", s)).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "", norm(s))


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip().replace("\xa0", "").replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def get(url, timeout=300):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# --- katalog in prevodi (products.js, products-extra.js, products-i18n.js) ---
def catalog():
    import subprocess
    code = ("global.window={};for(const f of ['products.js','products-extra.js','products-i18n.js'])require('./'+f);"
            "process.stdout.write(JSON.stringify({p:window.NAKUPKO_PRODUCTS,t:window.NAKUPKO_I18N}))")
    out = subprocess.run(["node", "-e", code], cwd=ROOT, capture_output=True, check=True).stdout
    d = json.loads(out)
    return d["p"], d["t"]


def pack(unit):
    """Pakiranje iz kataloga: (vrsta, količina) – kg, l ali kos."""
    u = str(unit or "").replace(",", ".").strip().lower()
    m = re.match(r"^([\d.]+)?\s*(g|kg|ml|l)$", u)
    if m:
        n = float(m.group(1)) if m.group(1) else 1.0
        return {"g": ("kg", n / 1000), "kg": ("kg", n), "ml": ("l", n / 1000), "l": ("l", n)}[m.group(2)]
    m = re.match(r"^(\d+)\s*x\s*([\d.]+)\s*l$", u)
    if m:
        return ("l", int(m.group(1)) * float(m.group(2)))
    m = re.match(r"^(\d+)\s*(kos|vreč|rol|kom|stk|db)", u)
    if m:
        return ("kos", float(m.group(1)))
    return ("kos", 1.0)


def offer_qty(unit, qty):
    """Ponudba trgovine: (vrsta, količina) iz enote in količine."""
    u = norm(unit)
    q = num(qty)
    if q is None or q <= 0:
        q = 1.0
    if u in ("g", "gr"):
        return ("kg", q / 1000)
    if u in ("kg",):
        return ("kg", q)
    if u in ("ml",):
        return ("l", q / 1000)
    if u in ("cl",):
        return ("l", q / 100)
    if u in ("l", "lit", "liter"):
        return ("l", q)
    return ("kos", q)


def quantile(vals, q):
    v = sorted(vals)
    if not v:
        return None
    i = (len(v) - 1) * q
    lo = int(i)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


# --- viri ---
def offers_at():
    data = json.loads(get("https://heisse-preise.io/data/latest-canonical.json", 600))
    out = []
    for x in data:
        st = x.get("store")
        if st not in CHAINS["AT"]:
            continue
        price = x.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        kind, amt = offer_qty(x.get("unit"), x.get("quantity"))
        out.append((st, norm(x.get("name")), "", float(price), kind, amt))
    return out


def offers_hr():
    lst = json.loads(get("https://api.cijene.dev/v0/list", 60))
    arch = sorted(lst.get("archives", []), key=lambda a: a.get("date", ""))
    if not arch:
        raise RuntimeError("cijene.dev: ni arhivov")
    z = zipfile.ZipFile(io.BytesIO(get(arch[-1]["url"], 900)))
    names = set(z.namelist())
    out = []
    for folder in CHAINS["HR"]:
        pf, rf = folder + "/products.csv", folder + "/prices.csv"
        if pf not in names or rf not in names:
            continue
        prods = {}
        with z.open(pf) as f:
            for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
                q = (r.get("quantity") or "").strip().lower()
                m = re.match(r"^([\d.,]+)\s*([a-z]+)", q)
                kind, amt = offer_qty(m.group(2), m.group(1)) if m else offer_qty(r.get("unit"), 1)
                prods[r["product_id"]] = (norm(r.get("name")), kind, amt)
        per = {}
        with z.open(rf) as f:
            for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
                # redna cena: vrstice z akcijsko ceno izpustimo
                if (r.get("special_price") or "").strip():
                    continue
                p = num(r.get("price"))
                if p and p > 0:
                    per.setdefault(r["product_id"], []).append(p)
        for pid, ps in per.items():
            if pid in prods:
                nm, kind, amt = prods[pid]
                out.append((folder, nm, "", statistics.median(ps), kind, amt))
    return out


def offers_hu():
    import openpyxl
    raw = get("https://cdnarfigyeloprodweu.azureedge.net/excel/arfigyelo_napi_termekadatok.xlsx", 300)
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = [norm(h) for h in next(rows)]
    ix = {h: i for i, h in enumerate(head)}
    def col(r, name):
        i = ix.get(norm(name))
        return r[i] if i is not None and i < len(r) else None
    out = []
    for r in rows:
        chain = slug(col(r, "Üzletlánc név"))
        if not chain:
            continue
        # redna cena: najvišja med trgovinami verige (akcije znižajo najnižjo)
        p = num(col(r, "Maximum ár")) or num(col(r, "Minimum ár"))
        if not p or p <= 0:
            continue
        kind, amt = offer_qty(col(r, "Egység"), col(r, "Kiszerelés"))
        out.append((chain, norm(col(r, "Termék név")), norm(col(r, "Kategória név")), p, kind, amt))
    return out


SOURCES = {"AT": (offers_at, "heisse-preise.io"), "HR": (offers_hr, "cijene.dev (javni cjenici)"), "HU": (offers_hu, "GVH Árfigyelő")}


def build(country, products, tr):
    fetch, src = SOURCES[country]
    offers = fetch()
    from collections import Counter
    print(f"{country}: {len(offers)} ponudb", dict(Counter(o[0] for o in offers).most_common(40)), flush=True)
    if len(offers) < 1000:
        raise RuntimeError(f"{country}: premalo ponudb ({len(offers)})")
    chains = {k: v for k, v in CHAINS[country].items() if v}
    by_chain = {}
    for o in offers:
        if o[0] in chains:
            by_chain.setdefault(o[0], []).append(o)
    li = LANG_IDX[country]
    items = []
    for p in products:
        name, cat, unit = p[0], p[1], p[4] if len(p) > 4 else ""
        t = tr.get(name) or []
        if len(t) <= li or not t[li]:
            continue
        kws = [norm(k) for k in t[li].split("|") if norm(k)]
        if not kws:
            continue
        # beseda ali beseda z do dvema črkama končnice (Banane/Bananen), ne sestavljenke (Bananenchips)
        pats = [re.compile(r"(?:^| )" + re.escape(k) + r"[a-z]{0,2}(?![a-z])") for k in kws]
        drug_ok = bool(DRUG_CATS.match(cat or ""))
        kind, amount = pack(unit)
        cene = {}
        for ch, lst in by_chain.items():
            if ch in DRUGSTORES and not drug_ok:
                continue  # drogerije: samo higiena, gospodinjstvo ... (ne »mleko« v kremi za telo)
            vals = []
            for (_, nm, catn, price, ok, oa) in lst:
                if not any(pt.search(nm) or (catn and pt.search(catn)) for pt in pats):
                    continue
                if kind in ("kg", "l"):
                    if ok != kind or oa <= 0:
                        continue
                    ratio = oa / amount
                    if ratio < 0.25 or ratio > 4:
                        continue
                    vals.append(price / oa * amount)
                else:
                    if ok in ("kg", "l"):
                        # izdelek na kos, ponudba na težo (npr. avokado na kg) – ne primerjamo
                        continue
                    per = price / oa if (amount > 1 and oa > 1) else price
                    vals.append(per * (amount if (amount > 1 and oa > 1) else 1))
            if vals:
                v = quantile(vals, 0.3)
                if v and v > 0:
                    cene[chains[ch][0]] = round(v) if CURRENCY[country] == "HUF" else round(v, 2)
        # izločimo cene, ki močno odstopajo od drugih verig (napačno prepoznan izdelek, cena na kos ...)
        if len(cene) >= 3:
            med = quantile(list(cene.values()), 0.5)
            cene = {k: v for k, v in cene.items() if 0.45 * med <= v <= 2.2 * med}
        if cene:
            items.append({"ime": name, "cene": cene})
    if len(items) < 50:
        raise RuntimeError(f"{country}: premalo izdelkov s ceno ({len(items)})")
    verige = {v[0]: {"ime": v[1], "vzorec": v[2], "barva": v[3]} for k, v in chains.items() if k in by_chain}
    return {"drzava": country, "datum": TODAY, "valuta": CURRENCY[country], "vir": src, "verige": verige, "izdelki": items}


def main():
    products, tr = catalog()
    failed = []
    for c in COUNTRIES:
        try:
            d = build(c, products, tr)
            path = os.path.join(ROOT, f"prices-{c.lower()}.json")
            json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print(f"{c}: {len(d['izdelki'])} izdelkov, verige {sorted(d['verige'])}", flush=True)
        except Exception as e:  # noqa: BLE001 – en vir ne sme podreti ostalih
            print(f"{c}: NAPAKA {e}", file=sys.stderr, flush=True)
            failed.append(c)
    if failed:
        open(os.path.join(ROOT, ".price-error-abroad"), "w").write("Tuje cene niso uspele: " + ", ".join(failed))
    if len(failed) == len(COUNTRIES):
        sys.exit(2)


if __name__ == "__main__":
    main()
