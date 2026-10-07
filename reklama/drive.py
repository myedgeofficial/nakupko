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
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if not quiet:
        log("$", cmd if isinstance(cmd, str) else " ".join(cmd), "->", r.returncode, (r.stdout + r.stderr).strip()[:400])
    if check and r.returncode != 0:
        raise RuntimeError(f"ukaz ni uspel: {cmd}")
    return r.stdout


def wait(s):
    time.sleep(s)


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
        ui = sh(["axe", "describe-ui", "--udid", self.udid], check=False, quiet=True)
        open(base + ".json", "w", encoding="utf-8").write(ui)
        log("posnetek zaslona", base)
        return ui

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
        sh(["axe", "tap", "-x", str(int(x)), "-y", str(int(y)), "--udid", self.udid])

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


def main():
    mac_clock()
    bid = bundle_id()
    log("bundle", bid)
    a = Phone("A")
    a.setup_locale()
    a.status_bar()
    a.install()
    a.grant(bid)
    a.location(46.0569, 14.5058)
    a.shot("domaci-zaslon")
    a.record_start("raziskava-A")
    a.launch(bid)
    wait(6)
    a.shot("zagon")
    for i in range(4):
        if a.tap(r"^(Dovoli|Allow|Dovoli med uporabo aplikacije|Vedno dovoli|Allow While Using App|Change to Always Allow|Spremeni v Vedno dovoli)", timeout=3, required=False):
            wait(2)
            a.shot(f"dovoljenje-{i}")
    a.shot("po-dovoljenjih")
    a.tap(r"Spar", timeout=5, required=False)
    wait(2)
    a.shot("po-izbiri-1")
    a.tap(r"Mercator", timeout=5, required=False)
    wait(2)
    a.shot("po-izbiri-2")
    a.tap(r"Kaj moraš kupiti", timeout=5, required=False)
    wait(2)
    a.shot("tipkovnica")
    a.type_keys("mle")
    wait(2)
    a.shot("predlogi")
    a.button("lock")
    wait(3)
    a.shot("zaklenjen")
    a.push(bid, {"aps": {"alert": {"title": "🛒 Maja je v trgovini Spar", "body": "Rabiš še kaj? Dodaj na skupen seznam."}, "sound": "default"}})
    wait(3)
    a.shot("obvestilo")
    a.record_stop()
    sh("ffprobe -v error -show_entries stream=width,height,codec_name,avg_frame_rate,bit_rate -of compact out/raziskava-A.mov", check=False)


if __name__ == "__main__":
    try:
        main()
    finally:
        LOG.close()
