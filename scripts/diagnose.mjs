// Diagnostic local sans afficher ni enregistrer les valeurs des secrets.
// Lancer à la racine : node scripts/diagnose.mjs
import { readFileSync } from 'node:fs';

let content;
try { content = readFileSync('.env','utf8'); }
catch { console.error('CONFIG_FICHIER : fichier .env absent. Copiez .env.example, puis remplacez ses valeurs fictives.'); process.exit(1); }

const settings = new Map(), unquoted = new Map();
for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  const quoted = (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'));
  unquoted.set(match[1],!quoted);
  if (quoted) value = value.slice(1,-1);
  settings.set(match[1],value);
}
const problems=[];
for (const key of ['POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','ADMIN_PASSWORD','USER1_PASSWORD','SURVEY_ENCRYPTION_KEY']) {
  const value=settings.get(key);
  if (!value) problems.push(`${key} absent ou vide`);
  else if (value.startsWith('change_me')) problems.push(`${key} contient encore la valeur fictive de .env.example`);
}
for (const key of ['ADMIN_PASSWORD','USER1_PASSWORD']) {
  const value=settings.get(key);
  if (value && value.length<8) problems.push(`${key} doit contenir au moins 8 caractères`);
}
const encoded=settings.get('SURVEY_ENCRYPTION_KEY');
if (encoded && Buffer.from(encoded,'base64').length!==32) problems.push('SURVEY_ENCRYPTION_KEY doit contenir 32 octets encodés en base64');
if (unquoted.get('POSTGRES_PASSWORD') && settings.get('POSTGRES_PASSWORD')?.includes('$'))
  problems.push('POSTGRES_PASSWORD contient un signe dollar non protégé ; utilisez des guillemets simples dans .env pour éviter l’interpolation Compose');
for (const key of ['SURVEY_ALLOW_HTTP','SESSION_COOKIE_SECURE']) {
  const value=settings.get(key);
  if (value && !['true','false'].includes(value)) problems.push(`${key} doit valoir true ou false`);
}
if (problems.length) {
  for (const message of problems) console.error(`CONFIG_INVALIDE : ${message}.`);
  console.error('Aucune valeur ni aucun mot de passe n’a été affiché. Corrigez .env, puis relancez docker compose up -d --build.');
  process.exit(1);
}
console.log('Configuration .env : champs essentiels valides (valeurs masquées).');
console.log('Si le backend reste unhealthy, exécutez : docker compose logs --no-color --tail=100 backend postgres');
console.log('Codes fréquents : PG_AUTH = mot de passe du volume PostgreSQL différent de .env ; PG_SCHEMA = migration ou droits SQL ; CONFIG_CLE = clé AES invalide.');
console.log('Ne supprimez pas postgres_data pour résoudre une erreur de démarrage.');
