// Tests de bout en bout RÉELS contre un serveur CORTEXP en marche.
// Usage : BASE_URL=http://localhost:3000 node scripts/test-e2e.mjs
// Prérequis : base seedée (admin) ; le script crée lui-même un second
// utilisateur de test pour vérifier l'isolation entre comptes.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "cortexp.db");
const ADMIN_USER = process.env.ADMIN_USERNAME ?? "adminnp";
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? "2026@admin@prince";

let passed = 0;
let failed = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

/** Client HTTP minimal avec pot à cookies. */
function client() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(url, opts = {}) {
    const r = await fetch(BASE + url, {
      ...opts,
      redirect: "manual",
      headers: { ...(opts.headers ?? {}), cookie: cookieHeader() },
    });
    for (const sc of r.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return r;
  }
  async function login(identifier, password) {
    const csrfRes = await req("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const r = await req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, identifier, password }).toString(),
    });
    return r.status === 302 && !(r.headers.get("location") ?? "").includes("error");
  }
  return { req, login };
}

// ─────────────────────────────────────────────────────────────────
console.log(`\nCORTEXP — tests e2e sur ${BASE}\n`);

// 0) Second utilisateur de test (créé directement en base, mot de passe haché)
const db = new Database(DB_PATH);
const U2 = "testeur_e2e";
const U2PASS = "e2e-Pass-" + Math.random().toString(36).slice(2, 8);
db.prepare("DELETE FROM User WHERE username = ?").run(U2);
db.prepare(
  `INSERT INTO User (id, username, name, passwordHash, role, isActive, dailyMessageLimit, createdAt)
   VALUES (?, ?, ?, ?, 'USER', 1, 50, datetime('now'))`
).run("e2e" + Date.now().toString(36), U2, "Testeur E2E", bcrypt.hashSync(U2PASS, 10));
db.close();

// 1) Design — page de connexion
console.log("— Design (page de connexion & accueil)");
{
  const anon = client();
  const r = await anon.req("/login");
  const html = await r.text();
  ok("/login répond 200", r.status === 200, `(${r.status})`);
  ok("fond blanc garanti (règle ciblée html,body)", html.includes("background: #ffffff !important"));
  ok("surcharge .theme-light appliquée", html.includes("theme-light"));
  ok("texte noir #111111 présent", html.includes("#111111"));
  ok("bouton Google présent", /Google/.test(html));
  ok("bouton GitHub présent", /GitHub/.test(html));
  const home = await (await anon.req("/")).text();
  ok("accueil : fond blanc garanti", home.includes("background: #ffffff !important"));
}

// 2) Authentification & autorisations
console.log("— Authentification");
const admin = client();
{
  ok("mauvais mot de passe refusé", !(await admin.login(ADMIN_USER, "mauvais-mdp")));
  ok("connexion admin réussie", await admin.login(ADMIN_USER, ADMIN_PASS));
  const s = await (await admin.req("/api/auth/session")).json();
  ok("rôle ADMIN vérifié côté serveur", s?.user?.role === "ADMIN", JSON.stringify(s?.user ?? {}));
  const anon = client();
  const r = await anon.req("/api/projects");
  ok("route protégée sans session → 401", r.status === 401, `(${r.status})`);
}

// 2-bis) Correctif anti-boucle de redirection — utilisateur supprimé en base
// alors que son cookie de session reste valide : / ne doit plus boucler
// entre /login et /c.
console.log("— Anti-boucle de redirection (session orpheline)");
{
  const U3 = "testeur_boucle";
  const U3PASS = "boucle-Pass-" + Math.random().toString(36).slice(2, 8);
  const db3 = new Database(DB_PATH);
  db3.prepare("DELETE FROM User WHERE username = ?").run(U3);
  db3.prepare(
    `INSERT INTO User (id, username, name, passwordHash, role, isActive, dailyMessageLimit, createdAt)
     VALUES (?, ?, ?, ?, 'USER', 1, 50, datetime('now'))`
  ).run("boucle" + Date.now().toString(36), U3, "Testeur Boucle", bcrypt.hashSync(U3PASS, 10));
  db3.close();

  const orphelin = client();
  ok("connexion de l'utilisateur éphémère", await orphelin.login(U3, U3PASS));

  // Le compte disparaît : le jeton JWT devient orphelin.
  const db4 = new Database(DB_PATH);
  db4.prepare("DELETE FROM User WHERE username = ?").run(U3);
  db4.close();

  const home = await orphelin.req("/");
  ok("/ ne redirige plus vers /c (200)", home.status === 200,
    `(status=${home.status} loc=${home.headers.get("location")})`);
  const loginPage = await orphelin.req("/login");
  ok("/login ne redirige plus vers /c (200)", loginPage.status === 200,
    `(status=${loginPage.status} loc=${loginPage.headers.get("location")})`);
  const consolePage = await orphelin.req("/c");
  ok("/c renvoie vers /login (307)", consolePage.status === 307 &&
    (consolePage.headers.get("location") ?? "").includes("/login"),
    `(status=${consolePage.status} loc=${consolePage.headers.get("location")})`);
  const back = await orphelin.req("/login");
  ok("/login après /c reste en 200 (fin de boucle)", back.status === 200, `(status=${back.status})`);
  const sess = await (await orphelin.req("/api/auth/session")).json();
  ok("session invalidée (user.id vide)", !sess?.user?.id, JSON.stringify(sess?.user ?? {}));
  const proj = await orphelin.req("/api/projects");
  ok("API protégée → 401", proj.status === 401, `(${proj.status})`);
}

// 3) Workspace — génération d'un projet réel
console.log("— Workspace (génération, fichiers, aperçu)");
let sid = "";
{
  const r = await admin.req("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Projet e2e" }),
  });
  sid = (await r.json()).session?.id ?? "";
  ok("création de session/projet", Boolean(sid));

  const gen = await admin.req("/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid, content: "génère un site web vitrine pour un studio photo", mode: "agent" }),
  });
  await gen.text(); // attendre la fin du flux
  const files = (await (await admin.req(`/api/sessions/${sid}/artifacts`)).json()).files ?? [];
  ok("fichiers générés listés (≥ 3)", files.length >= 3, `(${files.length})`);
  ok("index.html présent", files.some((f) => f.name === "index.html"));

  const prev = await admin.req(`/api/sessions/${sid}/artifacts/index.html?inline=1`);
  ok("aperçu inline 200 + content-disposition inline",
    prev.status === 200 && (prev.headers.get("content-disposition") ?? "").startsWith("inline"));
  const rawRes = await admin.req(`/api/sessions/${sid}/artifacts/styles.css?raw=1`);
  ok("vue code (?raw=1) en texte brut", (rawRes.headers.get("content-type") ?? "").startsWith("text/plain"));

  // Renommage (Zone C)
  const ren = await admin.req(`/api/sessions/${sid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Projet e2e renommé" }),
  });
  ok("renommage du projet", ren.status === 200);
  const projects = (await (await admin.req("/api/projects")).json()).projects ?? [];
  const p = projects.find((x) => x.id === sid);
  ok("projet listé avec dates + volumétrie", Boolean(p?.createdAt && p?.updatedAt && p?.fileCount >= 3));
  ok("titre renommé visible", p?.title === "Projet e2e renommé");
}

// 4) Terminal — exécution réelle, limites, sécurité
console.log("— Terminal sandbox");
async function exec(cli, command) {
  const r = await cli.req(`/api/sessions/${sid}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
{
  const ls = await exec(admin, "ls");
  ok("ls : exécution réelle (index.html listé)", ls.exitCode === 0 && ls.stdout.includes("index.html"));
  ok("durée d'exécution renvoyée", typeof ls.durationMs === "number");
  const g = await exec(admin, "grep -c html index.html");
  ok("grep exécuté", g.exitCode === 0 && Number(g.stdout.trim()) > 0, JSON.stringify(g));
  const mk = await exec(admin, "mkdir sousdossier");
  const cp = await exec(admin, "cp index.html sousdossier/copie.html");
  ok("mkdir + cp réels", mk.exitCode === 0 && cp.exitCode === 0);
  const fd = await exec(admin, "find . -name copie.html");
  ok("find retrouve le fichier copié", fd.stdout.includes("sousdossier/copie.html"));
  const bad = await exec(admin, "cat fichier-inexistant.txt");
  ok("commande échouée : code ≠ 0 + stderr", bad.exitCode !== 0 && bad.stderr.length > 0);
  ok("commande hors liste refusée", (await exec(admin, "curl example.com")).exitCode === 127);
  ok("évasion ../ bloquée", (await exec(admin, "cat ../../etc/passwd")).exitCode === 126);
  ok("chemin absolu bloqué", (await exec(admin, "ls /etc")).exitCode === 126);
  ok("find -exec bloqué", (await exec(admin, "find . -exec rm {} ;")).exitCode === 126);
  ok("npm run refusé (isolation requise, message explicite)", (await exec(admin, "npm run build")).exitCode === 126);
  ok("opérateurs shell refusés", (await exec(admin, "ls ; rm -rf .")).exitCode === 126);
  // Git réel
  await exec(admin, "git init");
  await exec(admin, "git add .");
  const ci = await exec(admin, 'git commit -m "commit e2e"');
  ok("git init/add/commit réels", ci.exitCode === 0 && ci.stdout.includes("commit e2e"));
  const lg = await exec(admin, "git log --oneline");
  ok("git log montre le commit", lg.stdout.includes("commit e2e"));
}

// 5) ZIP — intégrité, arborescence, exclusion des secrets
console.log("— Archive ZIP");
{
  // dépôt de fichiers sensibles directement dans le workspace (simulation)
  const wsDirs = [
    path.join(process.cwd(), ".next", "standalone", "data", "workspaces", sid),
    path.join(process.cwd(), "data", "workspaces", sid),
  ];
  const ws = wsDirs.find((d) => fs.existsSync(d));
  if (ws) {
    fs.writeFileSync(path.join(ws, ".env"), "SECRET_KEY=ne-doit-jamais-sortir\n");
    fs.writeFileSync(path.join(ws, ".env.example"), "SECRET_KEY=\n");
    fs.mkdirSync(path.join(ws, "node_modules", "fauxpkg"), { recursive: true });
    fs.writeFileSync(path.join(ws, "node_modules", "fauxpkg", "index.js"), "module.exports=1\n");
  }
  const r = await admin.req(`/api/sessions/${sid}/archive`);
  ok("ZIP téléchargeable (200, application/zip)", r.status === 200 && r.headers.get("content-type") === "application/zip");
  const buf = Buffer.from(await r.arrayBuffer());
  ok("signature ZIP valide (PK\\x03\\x04)", buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  // noms contenus dans le répertoire central
  const names = [];
  let off = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (off !== -1) {
    const nameLen = buf.readUInt16LE(off + 28);
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString("utf8"));
    off = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), off + 46 + nameLen);
  }
  ok("arborescence préservée (sousdossier/copie.html)", names.includes("sousdossier/copie.html"), JSON.stringify(names));
  ok("index.html dans le ZIP", names.includes("index.html"));
  ok("SECRET exclu : aucun .env dans le ZIP", !names.includes(".env"));
  ok(".env.example (sans secret) conservé", names.includes(".env.example"));
  ok("node_modules exclu", !names.some((n) => n.startsWith("node_modules/")));
  ok(".git exclu", !names.some((n) => n.startsWith(".git/")));
  const zipTxt = buf.toString("latin1");
  ok("aucun secret dans le contenu de l'archive", !zipTxt.includes("ne-doit-jamais-sortir"));
}

// 6) Isolation entre utilisateurs
console.log("— Isolation entre comptes");
{
  const user2 = client();
  ok("connexion du 2e utilisateur", await user2.login(U2, U2PASS));
  const a = await user2.req(`/api/sessions/${sid}/artifacts`);
  const z = await user2.req(`/api/sessions/${sid}/archive`);
  const e = await user2.req(`/api/sessions/${sid}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "ls" }),
  });
  const ren = await user2.req(`/api/sessions/${sid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "piraté" }),
  });
  ok("fichiers d'autrui → 404", a.status === 404, `(${a.status})`);
  ok("ZIP d'autrui → 404", z.status === 404, `(${z.status})`);
  ok("terminal d'autrui → 404", e.status === 404, `(${e.status})`);
  ok("renommage d'autrui → 404", ren.status === 404, `(${ren.status})`);
  const admin2 = await user2.req("/api/admin/users");
  ok("route admin pour simple utilisateur → 403", admin2.status === 403, `(${admin2.status})`);
}

console.log(`\nRésultat : ${passed} réussis, ${failed} échoués\n`);
process.exit(failed === 0 ? 0 : 1);
