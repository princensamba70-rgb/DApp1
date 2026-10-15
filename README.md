# CORTEXP

> **Donne un objectif. Récupère un livrable.**

Environnement de travail IA agentique accessible dans le navigateur, à
l'expérience « terminal d'agent de codage » : streaming temps réel, plan vivant,
appels d'outils visibles (avec auto-correction `exit 1 → edit → exit 0`),
deux modes de puissance et une administration complète.

![Stack](https://img.shields.io/badge/Next.js%2016-black) ![Prisma](https://img.shields.io/badge/Prisma%206-SQLite-blue) ![Auth](https://img.shields.io/badge/Auth.js%20v5-3%20modes-green)

---

## ⚡ Démarrage en 2 commandes (Docker)

```bash
docker compose up --build
# → http://localhost:3000
```

Le conteneur initialise la base, crée le compte administrateur et démarre le serveur.

### Démarrage local (sans Docker)

```bash
cp .env.example .env # variables locales (AUTH_SECRET, admin, OAuth…)
npm install          # installe + prisma generate (postinstall)
npm run setup        # client Prisma + schéma SQLite + seed admin
npm run dev          # http://localhost:3000
```

> Production locale : `npm run build && npm start`

---

## 🔐 Connexion — 3 modes

| Mode | Description | Activation |
|---|---|---|
| **1. Identifiants** | Comptes admin ou utilisateurs simples (username/email + mot de passe, bcrypt) | Toujours actif |
| **2. Google** | OAuth automatique avec un compte Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| **3. GitHub** | OAuth avec un compte GitHub | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` |

Compte administrateur par défaut (modifiable via variables d'environnement) :

- **Utilisateur** : `adminnp`
- **Mot de passe** : `2026@admin@prince`

> 🔒 Le mot de passe est **haché avec bcrypt (12 rounds) côté serveur au
> démarrage** : il n'est jamais stocké en clair en base, jamais renvoyé par
> l'API (`passwordHash` exclu de toutes les sélections) et donc **jamais
> visible dans le navigateur**. Les sessions sont des JWT httpOnly (30 jours).

### Configurer Google / GitHub OAuth

1. Créez une app OAuth ([Google Cloud Console](https://console.cloud.google.com/apis/credentials) / [GitHub Developer Settings](https://github.com/settings/developers)).
2. URL de callback : `http://localhost:3000/api/auth/callback/google` (ou `/github`).
3. Renseignez les clés dans `.env` ou `docker-compose.yml`. Les boutons de la
   page de connexion s'activent automatiquement.

---

## 🛠 Partie administration (`/admin`)

Réservée au rôle `ADMIN` (contrôle **côté serveur** sur la page et chaque route API) :

- **Statistiques** : utilisateurs, messages du jour, runs, tokens.
- **Gestion des utilisateurs** : création, rôle (USER/ADMIN), plan, activation /
  désactivation (bloque la connexion immédiatement), suppression en cascade,
  réinitialisation de mot de passe.
- **Limites d'utilisation** : quota de messages/jour par utilisateur
  (modifiable en un clic, `∞` = illimité). Le quota est appliqué côté serveur
  à chaque message ; l'utilisateur voit sa consommation dans `/settings`.
- **Journal d'audit** : connexions, créations, modifications, runs — horodatés.

---

## ◇ Mode AGENT / ♛ Mode KINGLY 1

Sélecteur segmenté au-dessus de la zone de saisie. Le prompt système envoyé au
modèle diffère réellement selon le mode (`lib/agent/prompts.ts`).

| | AGENT | KINGLY 1 |
|---|---|---|
| Nature | Agent autonome polyvalent | Sur-ensemble strict : multi-agents |
| Plan vivant + todo | ✅ | ✅ (phases + sous-agents) |
| Outils + auto-correction | ✅ visible (`exit 1 → edit → exit 0`) | ✅ + vérificateur indépendant |
| Sous-agents / citations | ➖ | ✅ (researcher, architect, verifier…) |

**Mode démo** (par défaut, `DEMO_MODE=true`) : l'app est entièrement navigable
sans clé API — le moteur simule un run crédible avec le même contrat de
streaming SSE. Branchez `ANTHROPIC_API_KEY` + `DEMO_MODE=false` pour la
génération réelle (la couche provider est dans `lib/agent/anthropic.ts`).

---

## 🏗 Architecture

```
app/
├─ page.tsx                  # landing
├─ login/                    # connexion 3 modes
├─ (app)/                    # shell authentifié (layout + sidebar)
│  ├─ c/                     # nouvelle session
│  ├─ c/[sessionId]/         # console de chat agentique
│  ├─ settings/              # profil, quota, mot de passe
│  └─ admin/                 # tableau de bord administrateur
└─ api/
   ├─ auth/[...nextauth]/    # Auth.js v5 (credentials + Google + GitHub)
   ├─ register/              # inscription (rate-limitée 5/10min/IP)
   ├─ sessions/              # CRUD sessions de chat
   ├─ chat/stream/           # SSE : événements typés du moteur d'agent
   ├─ usage/                 # quota du jour
   ├─ account/               # profil + changement de mot de passe
   └─ admin/                 # users / stats / audit (rôle ADMIN requis)
lib/
├─ auth.ts                   # NextAuth v5, JWT httpOnly, rôles
├─ db.ts                     # Prisma + adapter better-sqlite3 (sans binaire)
├─ usage.ts / audit.ts / ratelimit.ts
└─ agent/                    # moteur : types, prompts, engine (démo), anthropic
prisma/schema.prisma         # User, Account, ChatSession, Message, Run, Usage, AuditLog
scripts/init-db.mjs          # création du schéma (idempotent)
scripts/seed.mjs             # seed admin (hash bcrypt)
docker-compose.yml, Dockerfile, docker/entrypoint.sh
```

### Variables d'environnement

Voir **`.env.example`** (documenté). Essentielles : `AUTH_SECRET` (à changer en
prod), `ADMIN_USERNAME` / `ADMIN_PASSWORD`, clés OAuth, `DEMO_MODE`,
`DEFAULT_DAILY_MESSAGE_LIMIT`.

### Sécurité

- Mots de passe bcrypt (12 rounds), hash jamais sélectionné dans les réponses API.
- Sessions JWT httpOnly `sameSite=lax`, 30 jours ; comptes désactivés rejetés à
  la connexion **et** révoqués à la prochaine requête (rôle relu en base).
- Isolation multi-tenant : chaque requête filtre par `userId`.
- Rate limiting inscription (5 / 10 min / IP) ; garde-fous admin (impossible de
  se rétrograder / supprimer soi-même) ; journal d'audit sans secrets.

### Basculer sur PostgreSQL

Changez `provider = "postgresql"` dans `prisma/schema.prisma`, remplacez
l'adapter par `@prisma/adapter-pg`, mettez `DATABASE_URL` en `postgresql://…`
et ajoutez un service `postgres` au compose.
