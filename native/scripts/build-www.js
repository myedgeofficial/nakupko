// Pripravi native/www iz spletne aplikacije v korenu repozitorija.
// Spletnih datotek ne spreminjamo: v index.html le dodamo native.css in native.js.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const out = path.resolve(__dirname, "..", "www");
const skip = new Set(["native", "node_modules", "sw.js", "remote.json", "README.md", "firebase"]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(root)) {
  if (name.startsWith(".") || skip.has(name)) continue;
  fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
}
for (const f of ["native.js", "native.css", "pay.js", "zasebnost.html"]) fs.copyFileSync(path.join(__dirname, "..", "web", f), path.join(out, f));

const indexPath = path.join(out, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const firstScript = html.indexOf("<script");
if (firstScript < 0) throw new Error("index.html nima <script> oznake");
html = html.replace("</head>", '  <link rel="stylesheet" href="native.css">\n</head>');
html = html.slice(0, html.indexOf("<script")) + '<script src="native.js"></script>\n  <script src="pay.js"></script>\n  ' + html.slice(html.indexOf("<script"));
fs.writeFileSync(indexPath, html);
console.log("www pripravljen:", fs.readdirSync(out).join(", "));
