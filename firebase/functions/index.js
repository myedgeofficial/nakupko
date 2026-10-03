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
        body: left + (left === 1 ? " izdelek" : left === 2 ? " izdelka" : left < 5 ? " izdelki" : " izdelkov") + " na seznamu. Kljukaj kar na zaklenjenem zaslonu."
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
  const clean = { items, done: 0, total: items.length };
  const res = items.length ? await sendLiveStart(String(v.token || ""), String(v.store || "Trgovina").slice(0, 40), clean) : { status: 0, data: "prazen seznam" };
  console.log("liveStart", event.params.dev, v.store, res.status, res.data);
  // Seznam in žeton ne ostaneta na strežniku.
  await event.data.ref.remove();
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
  const ios = others.map((m) => m.ios).filter(Boolean);
  const android = others.map((m) => m.fcm).filter(Boolean);

  const who = (visit.name || "Član").slice(0, 30);
  const title = "🛒 " + who + " je v trgovini " + String(visit.store).slice(0, 40);
  const body = "Rabiš še kaj? Dodaj na skupen seznam.";
  const [apns, fcm] = await Promise.all([sendApns(ios, title, body), sendFcm(android, title, body)]);

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
