// Nakupko strežnik: ko je član skupnega seznama vsaj minuto v trgovini, ostale člane obvestimo.
// Telefon ob prihodu v trgovino zapiše /h/{koda}/visits/{id}; ob odhodu doda left: true.
const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
const http2 = require("http2");
const crypto = require("crypto");

admin.initializeApp();

const WAIT_MS = 60 * 1000;
const BUNDLE_ID = process.env.APNS_TOPIC || "si.nakupko.app";

// JWT za Apple Push Notification service (velja eno uro, zato ga ustvarimo ob vsakem pošiljanju).
function apnsJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
  const key = (process.env.APNS_KEY_P8 || "").replace(/\\n/g, "\n");
  const sig = crypto.sign("sha256", Buffer.from(header + "." + claims), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return header + "." + claims + "." + sig;
}

function sendApns(tokens, title, body) {
  if (!tokens.length || !process.env.APNS_KEY_P8) return Promise.resolve([]);
  const jwt = apnsJwt();
  const client = http2.connect("https://api.push.apple.com");
  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: "default" } });
  const one = (token) => new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": "/3/device/" + token,
      authorization: "bearer " + jwt,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10"
    });
    let status = 0, data = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve({ token, status, data }));
    req.on("error", (e) => resolve({ token, status: 0, data: String(e) }));
    req.end(payload);
  });
  return Promise.all(tokens.map(one)).finally(() => client.close());
}

// Besedila obvestil v jeziku prejemnika (jezik aplikacije: lang pri članu ali v zahtevi).
const TEXT = {
  sl: { visit: (w, s) => w + " je v trgovini " + s, more: "Rabiš še kaj? Dodaj na skupen seznam.", live: "na seznamu. Kljukaj kar na zaklenjenem zaslonu." },
  en: { visit: (w, s) => w + " is at " + s, more: "Need anything else? Add it to the shared list.", live: "on your list. Tick them off right on the lock screen." },
  de: { visit: (w, s) => w + " ist bei " + s, more: "Brauchst du noch etwas? Füg es zur gemeinsamen Liste hinzu.", live: "auf der Liste. Hake sie direkt auf dem Sperrbildschirm ab." },
  hr: { visit: (w, s) => w + " je u trgovini " + s, more: "Trebaš još nešto? Dodaj na zajednički popis.", live: "na popisu. Označavaj ih na zaključanom zaslonu." },
  it: { visit: (w, s) => w + " è da " + s, more: "Ti serve altro? Aggiungilo alla lista condivisa.", live: "nella lista. Spuntali dalla schermata di blocco." },
  hu: { visit: (w, s) => w + " most itt van: " + s, more: "Kell még valami? Add hozzá a közös listához.", live: "a listán. Pipáld ki a zárolási képernyőn." },
  fr: { visit: (w, s) => w + " est chez " + s, more: "Besoin d'autre chose ? Ajoute-le à la liste partagée.", live: "sur ta liste. Coche-les sur l'écran verrouillé." },
  es: { visit: (w, s) => w + " está en " + s, more: "¿Necesitas algo más? Añádelo a la lista compartida.", live: "en tu lista. Márcalos en la pantalla bloqueada." }
};
function textOf(lang) { return TEXT[String(lang || "sl").slice(0, 2)] || TEXT[{ bs: 1, sr: 1 }[String(lang || "").slice(0, 2)] ? "hr" : "en"]; }
function itemsOf(n, lang) {
  const l = String(lang || "sl").slice(0, 2);
  if (l === "sl") return n + (n === 1 ? " izdelek" : n === 2 ? " izdelka" : n < 5 ? " izdelki" : " izdelkov");
  if (l === "hr" || l === "bs" || l === "sr") return n + (n % 10 === 1 && n % 100 !== 11 ? " proizvod" : " proizvoda");
  if (l === "de") return n + " Artikel";
  if (l === "it") return n + (n === 1 ? " prodotto" : " prodotti");
  if (l === "hu") return n + " termék";
  if (l === "fr") return n + (n === 1 ? " article" : " articles");
  if (l === "es") return n + (n === 1 ? " producto" : " productos");
  return n + (n === 1 ? " item" : " items");
}

// Zažene seznam na zaklenjenem zaslonu (Live Activity, iOS 17.2+) s pushom »push-to-start«.
function sendLiveStart(token, store, state) {
  if (!token || !process.env.APNS_KEY_P8) return Promise.resolve({ status: 0, data: "brez ključa" });
  const jwt = apnsJwt();
  const client = http2.connect("https://api.push.apple.com");
  const left = (state.items || []).length;
  const payload = JSON.stringify({
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "start",
      "content-state": state,
      "attributes-type": "ShoppingAttributes",
      attributes: { store },
      "stale-date": Math.floor(Date.now() / 1000) + 4 * 3600,
      alert: {
        title: "🛒 " + store,
        body: itemsOf(left, state.lang) + " " + textOf(state.lang).live
      }
    }
  });
  return new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": "/3/device/" + token,
      authorization: "bearer " + jwt,
      "apns-topic": BUNDLE_ID + ".push-type.liveactivity",
      "apns-push-type": "liveactivity",
      "apns-priority": "10"
    });
    let status = 0, data = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve({ status, data }));
    req.on("error", (e) => resolve({ status: 0, data: String(e) }));
    req.end(payload);
  }).finally(() => client.close());
}

exports.liveStart = onValueCreated({
  ref: "/la/{dev}/starts/{start}",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 30,
  memory: "128MiB"
}, async (event) => {
  const v = event.data.val() || {};
  const state = v.state || {};
  const items = Array.isArray(state.items) ? state.items.slice(0, 30).map((i) => ({
    id: String(i.id || ""), label: String(i.label || "").slice(0, 40), icon: String(i.icon || "🛒").slice(0, 4)
  })).filter((i) => i.id && i.label) : [];
  const lang = String(v.lang || state.lang || "sl").slice(0, 3);
  const clean = { items, done: 0, total: items.length, lang };
  const res = items.length ? await sendLiveStart(String(v.token || ""), String(v.store || "Trgovina").slice(0, 40), clean) : { status: 0, data: "prazen seznam" };
  console.log("liveStart", event.params.dev, v.store, res.status, res.data);
  // Seznam in žeton ne ostaneta na strežniku; ostane le odgovor Appla (za dnevnik v aplikaciji).
  await event.data.ref.remove();
  await admin.database().ref("/la/" + event.params.dev + "/result").set({ status: res.status || 0, data: String(res.data || "").slice(0, 200), store: String(v.store || ""), at: Date.now() });
});

function sendFcm(tokens, title, body) {
  if (!tokens.length) return Promise.resolve(null);
  return admin.messaging().sendEachForMulticast({ tokens, notification: { title, body } }).catch((e) => ({ error: String(e) }));
}

exports.storeVisit = onValueCreated({
  ref: "/h/{code}/visits/{visit}",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 120,
  memory: "128MiB"
}, async (event) => {
  const visit = event.data.val() || {};
  const { code } = event.params;
  if (!visit.member || !visit.store) return;

  // Minuta v trgovini: če se je medtem odpeljal naprej (left), ne obveščamo.
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const now = (await event.data.ref.get()).val();
  if (!now || now.left || now.notified) return;

  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  const others = Object.keys(members).filter((id) => id !== visit.member).map((id) => members[id]);
  const who = (visit.name || "Član").slice(0, 30);
  // Vsak prejemnik dobi obvestilo v jeziku svoje aplikacije.
  const byLang = {};
  others.forEach((m) => { const l = String(m.lang || "sl").slice(0, 3); (byLang[l] = byLang[l] || []).push(m); });
  const sent = await Promise.all(Object.keys(byLang).map((l) => {
    const t = textOf(l), title = "🛒 " + t.visit(who, String(visit.store).slice(0, 40));
    return Promise.all([sendApns(byLang[l].map((m) => m.ios).filter(Boolean), title, t.more), sendFcm(byLang[l].map((m) => m.fcm).filter(Boolean), title, t.more)]);
  }));
  const apns = [].concat(...sent.map((x) => x[0] || []));
  const fcm = sent.map((x) => x[1]).filter(Boolean)[0] || null;

  // Neveljavne žetone (aplikacija izbrisana) odstranimo.
  const cleanup = {};
  (apns || []).forEach((r) => {
    if (r.status === 410 || /BadDeviceToken|Unregistered/.test(r.data)) {
      Object.keys(members).forEach((id) => { if (members[id].ios === r.token) cleanup[id + "/ios"] = null; });
    }
  });
  if (Object.keys(cleanup).length) await admin.database().ref("/h/" + code + "/members").update(cleanup);
  await event.data.ref.update({ notified: true, sent: ios.length + android.length });
  console.log("obisk", code, visit.store, "apns", JSON.stringify(apns), "fcm", JSON.stringify(fcm));
});

Object.assign(exports, require("./nadzor"));
