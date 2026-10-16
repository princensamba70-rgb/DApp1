// Validation des variables d'environnement obligatoires AVANT le démarrage.
// - Échec bloquant si une variable indispensable manque en production.
// - Avertissements explicites (sans jamais afficher les valeurs secrètes).
const isProd = process.env.NODE_ENV === "production";
const errors = [];
const warnings = [];

// AUTH_SECRET : obligatoire (sessions JWT signées)
const secret = process.env.AUTH_SECRET || "";
if (!secret) {
  errors.push("AUTH_SECRET est manquant (générer : openssl rand -base64 32).");
} else if (secret.includes("change-me") || secret.length < 16) {
  (isProd ? warnings : warnings).push(
    "AUTH_SECRET utilise une valeur de développement — à changer en production."
  );
}

// Compte admin : des défauts existent (adminnp), on signale seulement l'état.
if (!process.env.ADMIN_USERNAME) {
  warnings.push("ADMIN_USERNAME absent — défaut utilisé : adminnp.");
}
if (!process.env.ADMIN_PASSWORD) {
  warnings.push("ADMIN_PASSWORD absent — défaut de développement utilisé (à changer en production).");
}

// OAuth : paires cohérentes (id sans secret = mauvaise configuration)
for (const p of ["GOOGLE", "GITHUB"]) {
  const id = process.env[`${p}_CLIENT_ID`] || "";
  const sec = process.env[`${p}_CLIENT_SECRET`] || "";
  if ((id && !sec) || (!id && sec)) {
    errors.push(`${p}_CLIENT_ID et ${p}_CLIENT_SECRET doivent être définis ensemble.`);
  }
}

// Mode réel sans clé API
if (process.env.DEMO_MODE === "false" && !process.env.ANTHROPIC_API_KEY) {
  warnings.push("DEMO_MODE=false sans ANTHROPIC_API_KEY — le moteur retombera en mode démo.");
}

for (const w of warnings) console.warn(`[check-env] ⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[check-env] ✗ ${e}`);
  console.error("[check-env] Démarrage interrompu : corrigez le fichier .env (voir .env.example).");
  process.exit(1);
}
console.log("[check-env] ✓ variables d'environnement valides");
