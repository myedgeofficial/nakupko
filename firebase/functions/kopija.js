// Varnostna kopija: vsako noč celotna baza (RTDB) kot stisnjen JSON v zaseben bucket <projekt>-kopije.
// Bucket, pravice in brisanje kopij, starejših od 35 dni, nastavi workflow firebase.yml.
// Obnova: prenesi rtdb/LLLL-MM-DD.json.gz, razširi in uvozi v konzoli (Realtime Database › Import JSON).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const zlib = require("zlib");

exports.varnostnaKopija = onSchedule({ schedule: "30 3 * * *", timeZone: "Europe/Ljubljana", region: "europe-west1", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const projekt = JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || process.env.GCLOUD_PROJECT;
  const vse = (await admin.database().ref("/").get()).val() ?? {};
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(vse)));
  const dan = new Date().toISOString().slice(0, 10);
  await admin.storage().bucket(`${projekt}-kopije`).file(`rtdb/${dan}.json.gz`).save(gz, { contentType: "application/gzip", resumable: false });
  console.log("Varnostna kopija", dan, (gz.length / 1024).toFixed(0) + " KB");
});
