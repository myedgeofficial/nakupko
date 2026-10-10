// Nakupko strežnik: ko je član skupnega seznama vsaj minuto v trgovini, ostale člane obvestimo.
// Telefon ob prihodu v trgovino zapiše /h/{koda}/visits/{id}; ob odhodu doda left: true.
const { onValueCreated, onValueWritten } = require("firebase-functions/v2/database");
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
  sl: { need: (w, s) => w + " je v trgovini" + (s ? " " + s : "") + ": rabiš kaj?", needMore: "Odpri Nakupko in dodaj izdelke ali odgovori, da ne rabiš nič.", added: (w, l) => w + " rabi še: " + l, addedMore: "Izdelki so že na skupnem seznamu.", none: (w) => w + " ne rabi nič", noneMore: "Odgovor na tvoje vprašanje iz trgovine.",
    visit: (w, s) => w + " je v trgovini " + s, more: "Rabiš še kaj? Dodaj na skupen seznam.", live: "na seznamu. Kljukaj kar na zaklenjenem zaslonu.",
    ask: (w) => w + " se želi pridružiti tvojemu seznamu", askMore: "Odpri Nakupko in sprejmi ali zavrni.",
    loc: (w) => w + " ti bo sporočil(a), ko bo v trgovini", locMore: "Vidiš samo ime trgovine. Izklopi lahko kadarkoli." },
  en: { need: (w, s) => w + " is at " + (s || "the store") + ": need anything?", needMore: "Open Nakupko to add items or say you need nothing.", added: (w, l) => w + " also needs: " + l, addedMore: "The items are already on the shared list.", none: (w) => w + " doesn't need anything", noneMore: "Reply to your question from the store.",
    visit: (w, s) => w + " is at " + s, more: "Need anything else? Add it to the shared list.", live: "on your list. Tick them off right on the lock screen.",
    ask: (w) => w + " wants to join your list", askMore: "Open Nakupko to accept or decline.",
    loc: (w) => w + " will let you know when they're at a store", locMore: "You only see the store name. They can turn it off anytime." },
  de: { need: (w, s) => w + (s ? " ist bei " + s : " ist im Geschäft") + ": brauchst du was?", needMore: "Öffne Nakupko und füge Artikel hinzu oder antworte, dass du nichts brauchst.", added: (w, l) => w + " braucht noch: " + l, addedMore: "Die Artikel sind schon auf der gemeinsamen Liste.", none: (w) => w + " braucht nichts", noneMore: "Antwort auf deine Frage aus dem Geschäft.",
    visit: (w, s) => w + " ist bei " + s, more: "Brauchst du noch etwas? Füg es zur gemeinsamen Liste hinzu.", live: "auf der Liste. Hake sie direkt auf dem Sperrbildschirm ab.",
    ask: (w) => w + " möchte deiner Liste beitreten", askMore: "Öffne Nakupko, um anzunehmen oder abzulehnen.",
    loc: (w) => w + " sagt dir Bescheid, wenn er/sie im Geschäft ist", locMore: "Du siehst nur den Namen des Geschäfts. Jederzeit abschaltbar." },
  hr: { need: (w, s) => w + " je u trgovini" + (s ? " " + s : "") + ": trebaš li nešto?", needMore: "Otvori Nakupko i dodaj proizvode ili odgovori da ne trebaš ništa.", added: (w, l) => w + " treba još: " + l, addedMore: "Proizvodi su već na zajedničkom popisu.", none: (w) => w + " ne treba ništa", noneMore: "Odgovor na tvoje pitanje iz trgovine.",
    visit: (w, s) => w + " je u trgovini " + s, more: "Trebaš još nešto? Dodaj na zajednički popis.", live: "na popisu. Označavaj ih na zaključanom zaslonu.",
    ask: (w) => w + " se želi pridružiti tvom popisu", askMore: "Otvori Nakupko i prihvati ili odbij.",
    loc: (w) => w + " će ti javiti kad je u trgovini", locMore: "Vidiš samo ime trgovine. Može se isključiti u bilo kojem trenutku." },
  it: { need: (w, s) => w + (s ? " è da " + s : " è al negozio") + ": ti serve qualcosa?", needMore: "Apri Nakupko e aggiungi prodotti o rispondi che non ti serve niente.", added: (w, l) => "A " + w + " serve anche: " + l, addedMore: "I prodotti sono già nella lista condivisa.", none: (w) => "A " + w + " non serve niente", noneMore: "Risposta alla tua domanda dal negozio.",
    visit: (w, s) => w + " è da " + s, more: "Ti serve altro? Aggiungilo alla lista condivisa.", live: "nella lista. Spuntali dalla schermata di blocco.",
    ask: (w) => w + " vuole unirsi alla tua lista", askMore: "Apri Nakupko per accettare o rifiutare.",
    loc: (w) => w + " ti avviserà quando è in un negozio", locMore: "Vedi solo il nome del negozio. Si può disattivare in qualsiasi momento." },
  hu: { need: (w, s) => w + (s ? " most itt van: " + s : " most boltban van") + ". Kell valami?", needMore: "Nyisd meg a Nakupkót, és adj hozzá termékeket, vagy válaszold, hogy nem kell semmi.", added: (w, l) => w + " még kér: " + l, addedMore: "A termékek már a közös listán vannak.", none: (w) => w + " nem kér semmit", noneMore: "Válasz a boltból feltett kérdésedre.",
    visit: (w, s) => w + " most itt van: " + s, more: "Kell még valami? Add hozzá a közös listához.", live: "a listán. Pipáld ki a zárolási képernyőn.",
    ask: (w) => w + " csatlakozni szeretne a listádhoz", askMore: "Nyisd meg a Nakupkót, és fogadd el vagy utasítsd el.",
    loc: (w) => w + " szól, amikor boltban van", locMore: "Csak a bolt nevét látod. Bármikor kikapcsolható." },
  fr: { need: (w, s) => w + (s ? " est chez " + s : " est au magasin") + " : besoin de quelque chose ?", needMore: "Ouvre Nakupko pour ajouter des articles ou répondre que tu n'as besoin de rien.", added: (w, l) => w + " a aussi besoin de : " + l, addedMore: "Les articles sont déjà sur la liste partagée.", none: (w) => w + " n'a besoin de rien", noneMore: "Réponse à ta question depuis le magasin.",
    visit: (w, s) => w + " est chez " + s, more: "Besoin d'autre chose ? Ajoute-le à la liste partagée.", live: "sur ta liste. Coche-les sur l'écran verrouillé.",
    ask: (w) => w + " veut rejoindre ta liste", askMore: "Ouvre Nakupko pour accepter ou refuser.",
    loc: (w) => w + " te préviendra quand il/elle est au magasin", locMore: "Tu ne vois que le nom du magasin. Désactivable à tout moment." },
  es: { need: (w, s) => w + (s ? " está en " + s : " está en la tienda") + ": ¿necesitas algo?", needMore: "Abre Nakupko para añadir productos o responder que no necesitas nada.", added: (w, l) => w + " también necesita: " + l, addedMore: "Los productos ya están en la lista compartida.", none: (w) => w + " no necesita nada", noneMore: "Respuesta a tu pregunta desde la tienda.",
    visit: (w, s) => w + " está en " + s, more: "¿Necesitas algo más? Añádelo a la lista compartida.", live: "en tu lista. Márcalos en la pantalla bloqueada.",
    ask: (w) => w + " quiere unirse a tu lista", askMore: "Abre Nakupko para aceptar o rechazar.",
    loc: (w) => w + " te avisará cuando esté en una tienda", locMore: "Solo ves el nombre de la tienda. Se puede desactivar en cualquier momento." }
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

  // Privolitev: obisk sporočimo le, če ga je član sam dovolil in je sprejet na seznam; sicer ga zbrišemo.
  const sender = (await admin.database().ref("/h/" + code + "/members/" + visit.member).get()).val();
  if (!sender || sender.loc !== true || sender.status === "pending") { await event.data.ref.remove(); return; }

  // Minuta v trgovini: če se je medtem odpeljal naprej (left), ne obveščamo.
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const now = (await event.data.ref.get()).val();
  if (!now || now.left || now.notified) return;

  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  if (!members[visit.member] || members[visit.member].loc !== true) { await event.data.ref.remove(); return; }  // medtem izklopil
  const others = accepted(members, visit.member);
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
  await event.data.ref.update({ notified: true, sent: others.filter((m) => m.ios || m.fcm).length });
  console.log("obisk", code, visit.store, "apns", JSON.stringify(apns), "fcm", JSON.stringify(fcm));
});

// Člani seznama, ki so sprejeti (brez statusa = starejša različica, sprejet), razen enega.
function accepted(members, except) {
  return Object.keys(members || {}).filter((id) => id !== except && members[id] && members[id].status !== "pending").map((id) => members[id]);
}
// Isto obvestilo vsem v njihovem jeziku.
function notifyAll(list, make) {
  const byLang = {};
  list.forEach((m) => { const l = String(m.lang || "sl").slice(0, 3); (byLang[l] = byLang[l] || []).push(m); });
  return Promise.all(Object.keys(byLang).map((l) => {
    const [title, body] = make(textOf(l));
    return Promise.all([sendApns(byLang[l].map((m) => m.ios).filter(Boolean), title, body), sendFcm(byLang[l].map((m) => m.fcm).filter(Boolean), title, body)]);
  }));
}

// Prošnja za pridružitev (household.js zapiše člana s status: "pending"): obvestimo sprejete člane.
exports.memberJoin = onValueCreated({
  ref: "/h/{code}/members/{member}",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 30,
  memory: "128MiB"
}, async (event) => {
  const m = event.data.val() || {};
  if (m.status !== "pending") return;
  const { code, member } = event.params;
  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  const who = String(m.name || "Član").slice(0, 30);
  const res = await notifyAll(accepted(members, member), (t) => ["👋 " + t.ask(who), t.askMore]);
  console.log("prošnja", code, member, JSON.stringify(res));
});

// Član je vklopil »Sporoči, ko sem v trgovini«: ostali dobijo obvestilo, da bodo to izvedeli.
exports.locShared = onValueWritten({
  ref: "/h/{code}/members/{member}/loc",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 30,
  memory: "128MiB"
}, async (event) => {
  if (event.data.before.val() === true || event.data.after.val() !== true) return;
  const { code, member } = event.params;
  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  const me = members[member];
  if (!me || me.status === "pending") return;
  const who = String(me.name || "Član").slice(0, 30);
  const res = await notifyAll(accepted(members, member), (t) => ["📍 " + t.loc(who), t.locMore]);
  console.log("deljenje", code, member, JSON.stringify(res));
});

// »Rabiš kaj?«: član v trgovini vpraša ostale (household.js zapiše /h/{koda}/asks/{id}).
exports.askNeed = onValueCreated({
  ref: "/h/{code}/asks/{ask}",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 30,
  memory: "128MiB"
}, async (event) => {
  const a = event.data.val() || {};
  const { code } = event.params;
  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  const me = members[a.from];
  if (!me || me.status === "pending") { await event.data.ref.remove(); return; }
  const who = String(a.name || me.name || "Član").slice(0, 30), store = String(a.store || "").slice(0, 40);
  const res = await notifyAll(accepted(members, a.from), (t) => ["🙋 " + t.need(who, store), t.needMore]);
  console.log("vprašanje", code, store, JSON.stringify(res));
});

// Odgovor na »Rabiš kaj?« (dodal izdelke ali »ne rabim nič«): obvestimo tistega, ki je v trgovini.
exports.askAnswer = onValueWritten({
  ref: "/h/{code}/asks/{ask}/answers/{member}/ans",
  instance: "nakupko-8ad19-default-rtdb",
  region: "europe-west1",
  timeoutSeconds: 30,
  memory: "128MiB"
}, async (event) => {
  const ans = event.data.after.val();
  if (!ans || event.data.before.val() === ans) return;
  const { code, ask, member } = event.params;
  const a = (await admin.database().ref("/h/" + code + "/asks/" + ask).get()).val() || {};
  const members = (await admin.database().ref("/h/" + code + "/members").get()).val() || {};
  const to = members[a.from];
  if (!to) return;
  const r = (a.answers || {})[member] || {};
  const who = String(r.name || (members[member] || {}).name || "Član").slice(0, 30);
  const items = (Array.isArray(r.items) ? r.items : []).map((x) => String(x).slice(0, 30)).slice(0, 10).join(", ");
  const res = await notifyAll([to], (t) => ans === "added" ? ["✓ " + t.added(who, items), t.addedMore] : ["✗ " + t.none(who), t.noneMore]);
  console.log("odgovor", code, ans, JSON.stringify(res));
});

Object.assign(exports, require("./nadzor"));
