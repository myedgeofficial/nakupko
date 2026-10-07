#!/usr/bin/env python3
# Reklama: v Applovem simulatorju odigra prizore in jih posname (xcrun simctl io recordVideo).
# Dotiki gredo prek AXe (kot prst na zaslonu), nič ni dorisano.
import json, os, re, signal, subprocess, sys, time

OUT = os.path.abspath("out")
os.makedirs(OUT, exist_ok=True)
APP = os.environ.get("APP", "")
LOG = open(os.path.join(OUT, "log.txt"), "a", encoding="utf-8")
step_no = [0]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.write(time.strftime("%H:%M:%S ") + s + "\n")
    LOG.flush()


def sh(cmd, check=True, quiet=False):
    try:
        r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True)
    except FileNotFoundError as e:
        log("ni programa:", e)
        if check:
            raise
        return ""
    if not quiet:
        log("$", cmd if isinstance(cmd, str) else " ".join(cmd), "->", r.returncode, (r.stdout + r.stderr).strip()[:400])
    if check and r.returncode != 0:
        raise RuntimeError(f"ukaz ni uspel: {cmd}")
    return r.stdout


def wait(s):
    time.sleep(s)


SCALE = 3.0
OCR = os.path.join(OUT, "..", "ocr-bin")


def fold(t):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


# ---------- naprave ----------
def device_type(name):
    d = json.loads(sh("xcrun simctl list devicetypes -j", quiet=True))["devicetypes"]
    for t in d:
        if t["name"] == name:
            return t["identifier"]
    raise RuntimeError("ni tipa " + name + ": " + ", ".join(t["name"] for t in d if "iPhone" in t["name"]))


def runtime():
    r = json.loads(sh("xcrun simctl list runtimes -j", quiet=True))["runtimes"]
    ios = [x for x in r if x.get("platform") == "iOS" and x.get("isAvailable")]
    return ios[-1]["identifier"]


class Phone:
    def __init__(self, name, model="iPhone 17 Pro"):
        self.name = name
        self.udid = sh(["xcrun", "simctl", "create", name, device_type(model), runtime()]).strip()
        self.rec = None

    def boot(self):
        sh(["xcrun", "simctl", "boot", self.udid])
        sh(["xcrun", "simctl", "bootstatus", self.udid, "-b"])

    def setup_locale(self):
        self.boot()
        for k, v in (("AppleLanguages", ["-array", "sl-SI"]), ("AppleLocale", ["-string", "sl_SI"])):
            sh(["xcrun", "simctl", "spawn", self.udid, "defaults", "write", "Apple Global Domain", k] + v)
        sh(["xcrun", "simctl", "shutdown", self.udid])
        self.boot()

    def status_bar(self):
        sh(["xcrun", "simctl", "status_bar", self.udid, "override", "--dataNetwork", "5g",
            "--wifiMode", "active", "--wifiBars", "3", "--cellularMode", "active", "--cellularBars", "4",
            "--batteryState", "discharging", "--batteryLevel", "100", "--operatorName", ""], check=False)

    def shot(self, label):
        step_no[0] += 1
        base = os.path.join(OUT, f"{step_no[0]:02d}-{self.name}-{label}")
        sh(["xcrun", "simctl", "io", self.udid, "screenshot", base + ".png"], check=False, quiet=True)
        r = subprocess.run([OCR, base + ".png"], capture_output=True, text=True)
        open(base + ".txt", "w", encoding="utf-8").write(r.stdout + r.stderr)
        log("posnetek zaslona", base)
        return base + ".png"

    # ----- besedilo na zaslonu (Apple Vision OCR) -----
    def ocr(self):
        p = os.path.join(OUT, f"_ocr-{self.name}.png")
        sh(["xcrun", "simctl", "io", self.udid, "screenshot", p], check=False, quiet=True)
        try:
            return json.loads(sh([OCR, p], check=False, quiet=True) or "[]")
        except Exception:
            return []

    def find_text(self, pattern, timeout=10):
        rx = re.compile(pattern, re.I)
        end = time.time() + timeout
        while True:
            for b in self.ocr():
                if rx.search(fold(b["t"])):
                    return b
            if time.time() > end:
                return None
            wait(1)

    def tap_text(self, pattern, timeout=10, required=True, dy=0):
        b = self.find_text(pattern, timeout)
        if not b:
            log("NI BESEDILA:", pattern)
            if required:
                self.shot("manjka")
            return None
        self.tap_xy((b["x"] + b["w"] / 2) / SCALE, (b["y"] + b["h"] / 2) / SCALE + dy)
        log("tapnil", repr(b["t"]))
        return b

    # ----- dostopnostno drevo -----
    def elements(self):
        raw = sh(["axe", "describe-ui", "--udid", self.udid], check=False, quiet=True)
        try:
            data = json.loads(raw)
        except Exception:
            return []
        out = []

        def walk(n):
            if isinstance(n, list):
                for x in n:
                    walk(x)
                return
            if not isinstance(n, dict):
                return
            out.append(n)
            for c in n.get("children") or []:
                walk(c)
        walk(data)
        return out

    def find(self, pattern, role=None):
        rx = re.compile(pattern, re.I)
        for e in self.elements():
            txt = " ".join(str(e.get(k) or "") for k in ("AXLabel", "AXValue", "title", "AXUniqueId"))
            if rx.search(txt) and (role is None or role in str(e.get("type") or e.get("role") or "")):
                return e
        return None

    def tap_xy(self, x, y):
        for i in range(4):
            r = subprocess.run(["axe", "tap", "-x", str(int(x)), "-y", str(int(y)), "--udid", self.udid], capture_output=True, text=True)
            log("tap", int(x), int(y), "->", r.returncode, (r.stdout + r.stderr).strip()[:120])
            if r.returncode == 0:
                return True
            r = subprocess.run(["axe", "touch", "-x", str(int(x)), "-y", str(int(y)), "--down", "--up", "--udid", self.udid], capture_output=True, text=True)
            log("touch", int(x), int(y), "->", r.returncode, (r.stdout + r.stderr).strip()[:120])
            if r.returncode == 0:
                return True
            wait(1.5)
        return False

    def tap(self, pattern, role=None, timeout=10, required=True):
        end = time.time() + timeout
        while time.time() < end:
            e = self.find(pattern, role)
            if e:
                f = e.get("frame") or {}
                self.tap_xy(f["x"] + f["width"] / 2, f["y"] + f["height"] / 2)
                return True
            wait(0.5)
        log("NI NAJDENO:", pattern)
        if required:
            self.shot("manjka")
        return False

    def type_keys(self, text):
        # Tipka po tipkah na zaslonski tipkovnici, kot človek.
        for ch in text:
            label = {" ": "presledek|space"}.get(ch, re.escape(ch))
            if not self.tap(f"^({label})$", timeout=3, required=False):
                sh(["axe", "type", ch, "--udid", self.udid])
            wait(0.12)

    def button(self, b):
        sh(["axe", "button", b, "--udid", self.udid], check=False)

    def install(self):
        sh(["xcrun", "simctl", "install", self.udid, APP])

    def launch(self, bundle):
        sh(["xcrun", "simctl", "launch", self.udid, bundle], check=False)

    def grant(self, bundle):
        sh(["applesimutils", "--byId", self.udid, "--bundle", bundle, "--setPermissions", "notifications=YES,location=always"], check=False)
        for s in ("location-always", "photos"):
            sh(["xcrun", "simctl", "privacy", self.udid, "grant", s, bundle], check=False)

    def location(self, lat, lon):
        sh(["xcrun", "simctl", "location", self.udid, "set", f"{lat},{lon}"], check=False)

    def push(self, bundle, payload):
        p = os.path.join(OUT, f"push-{self.name}.json")
        json.dump(payload, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        sh(["xcrun", "simctl", "push", self.udid, bundle, p], check=False)

    def record_start(self, name):
        path = os.path.join(OUT, name + ".mov")
        self.rec = subprocess.Popen(["xcrun", "simctl", "io", self.udid, "recordVideo", "--codec=h264", "--force", path],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        wait(2)
        log("snemam", path)

    def record_stop(self):
        if self.rec:
            self.rec.send_signal(signal.SIGINT)
            try:
                self.rec.wait(30)
            except Exception:
                self.rec.kill()
            self.rec = None


def mac_clock():
    # Ura simulatorja = ura Maca. Apple v reklamah kaže 9:41.
    sh("sudo systemsetup -settimezone Europe/Ljubljana", check=False)
    sh("sudo systemsetup -setusingnetworktime off", check=False)
    sh("sudo date 100709402026", check=False)
    sh("date", check=False)


def bundle_id():
    return sh(["/usr/libexec/PlistBuddy", "-c", "Print CFBundleIdentifier", os.path.join(APP, "Info.plist")]).strip()


def prepare_locale(udid):
    # Slovenščina pred prvim zagonom (brez ponovnega zagona naprave).
    pref = os.path.expanduser(f"~/Library/Developer/CoreSimulator/Devices/{udid}/data/Library/Preferences/.GlobalPreferences.plist")
    os.makedirs(os.path.dirname(pref), exist_ok=True)
    sh(["defaults", "write", pref, "AppleLanguages", "-array", "sl-SI"])
    sh(["defaults", "write", pref, "AppleLocale", "-string", "sl_SI"])


def tap_until_gone(p, pattern, tries=4, timeout=15):
    for i in range(tries):
        if not p.tap_text(pattern, timeout=timeout if i == 0 else 4, required=False):
            return i > 0
        wait(4)
        if not p.find_text(pattern, timeout=1):
            return True
    return False


HOME = (46.0545, 14.4950)     # park Tivoli: ni trgovine v bližini
SPAR = (46.0569, 14.5058)     # zamenja ga najbližja prava trgovina iz OpenStreetMap (nearest_store)


def nearest_store():
    # Prava trgovina (Spar/Mercator/Tuš) blizu HOME, da jo aplikacija pozna in sama zazna prihod.
    import urllib.request, urllib.parse
    q = '[out:json][timeout:25];nwr["shop"="supermarket"]["name"~"Spar|Mercator|Tuš",i](around:1500,%f,%f);out center 20;' % HOME
    for url in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            data = json.loads(urllib.request.urlopen(url, urllib.parse.urlencode({"data": q}).encode(), timeout=40).read())
            best = None
            for e in data.get("elements", []):
                lat = e.get("lat") or (e.get("center") or {}).get("lat")
                lon = e.get("lon") or (e.get("center") or {}).get("lon")
                if lat is None:
                    continue
                d = (lat - HOME[0]) ** 2 + (lon - HOME[1]) ** 2
                if best is None or d < best[0]:
                    best = (d, lat, lon, (e.get("tags") or {}).get("name"))
            if best:
                log("trgovina za prizor:", best[3], best[1], best[2])
                return (best[1], best[2])
        except Exception as ex:
            log("overpass", url, ex)
    return SPAR


def allow_alerts(p, rounds=4):
    # Sistemsko okno »Dovoli«: najprej prek dostopnosti (AXe), nato prek branja zaslona; preverimo, da je izginilo.
    for i in range(rounds):
        if not p.find_text(r"^(Dovoli|Allow)$", timeout=25 if i == 0 else 4):
            return
        if not p.tap(r"^(Dovoli|Allow)$", timeout=2, required=False):
            p.tap_text(r"^(Dovoli|Allow)$", timeout=2, required=False)
        wait(3)


def first_run(p, bid):
    p.launch(bid)
    wait(8)
    p.shot("zagon")
    allow_alerts(p)
    p.shot("po-dovoljenjih")
    allow_alerts(p, 2)
    tap_until_gone(p, r"Tus, Spar in Mercator", timeout=30)
    p.shot("po-izbiri-1")
    # drugo vprasanje »Pa druga izbira?«
    if p.find_text(r"druga izbira|Ni druge izbire", timeout=20):
        tap_until_gone(p, r"Ni druge izbire")
    p.shot("po-izbiri-2")


def scroll_to(p, pattern, tries=5):
    for i in range(tries):
        b = p.find_text(pattern, timeout=1)
        if b and b["y"] / SCALE < 760:
            return b
        sh(["axe", "swipe", "--start-x", "200", "--start-y", "650", "--end-x", "200", "--end-y", "300", "--udid", p.udid], check=False)
        wait(2)
    return p.find_text(pattern, timeout=1)


def answer_prompt(p, name):
    # JS prompt() = iOS okno z vnosnim poljem
    wait(2)
    p.shot("prompt")
    sh(["axe", "type", name, "--udid", p.udid], check=False)
    wait(1)
    # gumb »Ok« v oknu JS prompt (ne »V redu« iz kartice bližnjic za njim)
    p.tap_text(r"^OK$", timeout=5, required=False) or p.tap_text(r"^V redu$", timeout=2, required=False)
    wait(2)


def add_item(p, typed, pick):
    p.tap_text(r"Kaj moras kupiti", timeout=6, required=False)
    wait(1.5)
    sh(["axe", "type", typed, "--udid", p.udid], check=False)
    wait(2)
    p.shot("predlogi-" + typed)
    p.tap_text(pick, timeout=5, required=False)
    wait(2)
    p.shot("dodano-" + typed)


def clear_old_notifications(p):
    # Sistemsko obvestilo »Ready for Apple Intelligence« pobrišemo (poteg levo → Počisti).
    for i in range(2):
        b = p.find_text(r"Apple Intelligence|Ready for", timeout=3)
        if not b:
            return
        y = (b["y"] + b["h"] / 2) / SCALE
        sh(["axe", "swipe", "--start-x", "330", "--start-y", str(int(y)), "--end-x", "60", "--end-y", str(int(y)), "--udid", p.udid], check=False)
        wait(1.5)
        p.tap_text(r"^(Počisti|Pocisti|Clear)$", timeout=3, required=False)
        wait(1.5)


def main():
    sh(["xcrun", "swiftc", "-O", "reklama/ocr.swift", "-o", OCR])
    bid = bundle_id()
    SPAR_REAL = (46.0562421, 14.5057270)   # Spar, Slovenska cesta 54 (OSM)
    a = Phone("A")
    sh(["xcrun", "simctl", "boot", a.udid])
    sh(["xcrun", "simctl", "bootstatus", a.udid, "-b"], quiet=True)
    L = os.environ.get("JEZIK", "sl")
    loc = {"sl": ("sl-SI", "sl_SI"), "en": ("en-US", "en_US")}[L]
    for k, v in (("AppleLanguages", ["-array", loc[0]]), ("AppleLocale", ["-string", loc[1]])):
        sh(["xcrun", "simctl", "spawn", a.udid, "defaults", "write", "Apple Global Domain", k] + v)
    sh(["xcrun", "simctl", "shutdown", a.udid])
    sh(["xcrun", "simctl", "boot", a.udid])
    sh(["xcrun", "simctl", "bootstatus", a.udid, "-b"], quiet=True)
    a.status_bar()
    a.install()
    a.grant(bid)
    a.location(46.0590, 14.5030)
    wait(5)
    first_run(a, bid)
    allow_alerts(a, 2)
    chips = ("Mleko", "Kruh beli", "Jajca", "Banane", "Jogurt navadni")
    if L == "en":
        # jezik aplikacije: Nastavitve → Jezik → English (stran se naloži znova)
        a.tap_text(r"^Nastavitve$", timeout=5, required=False); wait(2)
        scroll_to(a, r"Jezik / Language")
        a.tap_text(r"Jezik / Language", timeout=3, required=False); wait(1.5)
        scroll_to(a, r"^English$")
        a.tap_text(r"^English$", timeout=4, required=False); wait(5)
        a.tap_text(r"^List$", timeout=5, required=False); wait(2)
        chips = ("Milk", "White bread", "Eggs", "Bananas", "Plain yoghurt")
    a.shot("jezik")
    for n in chips:
        a.tap_text("^" + n + "$", timeout=8, required=False)
        wait(2.5)
    a.shot("seznam")
    # prihod v Spar: aplikacija sama odpre »V trgovini« (in seznam na zaklenjenem zaslonu)
    a.location(*SPAR_REAL)
    if not a.find_text(r"v ko.arici|in basket", timeout=90):
        a.tap_text(r"^(Odpri|Open)$", timeout=3, required=False) or a.tap_text(r"V trgovini|In store", timeout=3, required=False)
    wait(4)
    a.shot("v-trgovini")
    a.tap_text(r"^(Jajca|Eggs)$", timeout=4, required=False, dy=0)
    # zaklenemo in prižgemo zaslon, dovolimo aktivnosti v živo
    a.button("lock")
    wait(4)
    for i in range(3):
        if a.tap_text(r"^(Dovoli|Allow)$", timeout=6, required=False):
            wait(4)
    clear_old_notifications(a)
    a.shot("zaklenjen-1")
    # če seznama še ni: odklenemo, odpremo aplikacijo, znova zaklenemo
    if not a.find_text(r"Spar|Odpri seznam|Open list|Naprej|Next", timeout=3):
        a.launch(bid)
        wait(6)
        a.button("lock")
        wait(5)
        a.tap_text(r"^(Dovoli|Allow)$", timeout=5, required=False)
        wait(3)
        clear_old_notifications(a)
        a.shot("zaklenjen-2")
    # čist posnetek zaklenjenega zaslona: ugasnemo in prižgemo zaslon, nato kljukamo na zaklenjenem zaslonu
    a.record_start("zaklenjen")
    wait(2)
    a.button("lock")
    wait(2)
    a.button("lock")
    wait(4)
    wait(3)
    a.shot("zaklenjen-kljukanje")
    wait(3)
    a.record_stop()


if __name__ == "__main__":
    try:
        main()
    finally:
        LOG.close()
