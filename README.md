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

> Prérequis : **Node.js ≥ 22.9** (le projet utilise `--env-file-if-exists` et `node:sqlite` n'est pas requis).

```bash
npm install          # installe + prisma generate (postinstall, portable Win/Linux/mac)
npm run setup        # valide le .env + schéma SQLite + seed admin
npm run dev          # http://localhost:3000
```

Un **`.env` de développement est fourni** (valeurs non sensibles) et `.env.example`
documente chaque variable. Les vrais secrets vont dans `.env.local` (ignoré par Git).
`npm run check:env` valide les variables obligatoires à tout moment.

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

### 🧠 Moteur IA : indépendant d'Anthropic

CORTEXP fonctionne **sans aucune clé API** grâce à une couche d'abstraction
(`lib/agent/provider.ts`). Le fournisseur se change par configuration, jamais
par le code :

Le moteur local **exécute réellement les travaux** (rien n'est simulé) :
- **Code JavaScript** (bloc ` ```js `) — exécution en VM isolée `node:vm`
  (timeout 2 s, sans accès système) : sortie console, valeurs, erreurs réelles ;
- **CSV** — statistiques par colonne : n, min, max, moyenne, médiane, somme, écart-type ;
- **JSON** — validation + formatage ; **calculs** arithmétiques validés ;
- **Textes longs** — résumé extractif (scoring de fréquence) + mots-clés ;
- **URLs fournies** — lecture, extraction du texte et citations ;
- **KINGLY 1** — chaque résultat déterministe est **ré-exécuté indépendamment**
  et comparé ; les écarts sont signalés (`verifier`).

| `AI_PROVIDER` | Comportement | Données sortantes |
|---|---|---|
| `local` *(défaut)* | Moteur local à **exécution réelle** (ci-dessus) — zéro clé, zéro réseau | Aucune |
| `openai` | Tout endpoint **compatible OpenAI** — **local** : Ollama (`http://localhost:11434/v1`), LM Studio (`…:1234/v1`), vLLM, llama.cpp · ou **EN LIGNE** (pas de matériel requis) : OpenRouter (`https://openrouter.ai/api/v1`), Groq (`https://api.groq.com/openai/v1`), Together, Mistral… avec votre clé | Aucune si local ; oui si service en ligne (votre choix) |
| `anthropic` | Strictement **opt-in** (`AI_PROVIDER=anthropic` + clé) — jamais requis | Oui (choix explicite) |

`DEMO_MODE=true` force le moteur local. Statut public (sans secret) :
`GET /api/engine/status`. En Docker, un modèle Ollama sur l'hôte s'atteint via
`OPENAI_BASE_URL=http://host.docker.internal:11434/v1`.

Exemple 100 % local avec Ollama :
```bash
ollama pull llama3.1        # sur la machine hôte
# .env : DEMO_MODE=false  AI_PROVIDER=openai
#        OPENAI_BASE_URL=http://localhost:11434/v1  OPENAI_MODEL=llama3.1
```

**Pas de machine pour un modèle local ?** Branchez un service **en ligne**
compatible OpenAI (fonctionne tel quel dans Docker, le moteur local reste le
filet de sécurité) :
```bash
# .env : DEMO_MODE=false  AI_PROVIDER=openai
#        OPENAI_BASE_URL=https://openrouter.ai/api/v1   # ou https://api.groq.com/openai/v1
#        OPENAI_API_KEY=<votre clé>   OPENAI_MODEL=<modèle du catalogue>
```
Le moteur local continue d'exécuter réellement code, données, projets et
recherche web ; le modèle en ligne enrichit la rédaction des réponses.

### 🔑 OAuth Google & GitHub : configuration des consoles

Les boutons apparaissent automatiquement dès que les clés sont renseignées
(sinon ils sont masqués — aucun faux bouton). Les secrets restent côté
serveur : jamais dans le frontend, jamais commités.

**Google** — [console.cloud.google.com](https://console.cloud.google.com) →
« APIs & Services → Credentials → Create OAuth client ID » (type *Web application*) :
- Origine autorisée : `http://localhost:3000` (dév) / `https://votre-domaine` (prod)
- URI de redirection : `http://localhost:3000/api/auth/callback/google`
  (prod : `https://votre-domaine/api/auth/callback/google`)
- Copier `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` dans `.env`.

**GitHub** — [github.com/settings/developers](https://github.com/settings/developers) →
« New OAuth App » :
- Homepage URL : `http://localhost:3000` (dév) / `https://votre-domaine` (prod)
- Authorization callback URL : `http://localhost:3000/api/auth/callback/github`
  (prod : `https://votre-domaine/api/auth/callback/github`)
- Copier `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` dans `.env`.

En production, définissez aussi `AUTH_URL=https://votre-domaine` et un
`AUTH_SECRET` fort (`openssl rand -base64 32`). Protections intégrées par
Auth.js : paramètre `state`, cookies HttpOnly/SameSite (Secure en prod),
échange du code côté serveur, CSRF sur les formulaires.

### 🔧 Dépannage : `gyp ERR! not ok` sur better-sqlite3 pendant `docker compose build`

Cause racine (observée dans les journaux `npm ci`) :
1. `prebuild-install` ne peut pas télécharger le binaire précompilé
   (*« unable to verify the first certificate »* — proxy / réseau filtrant) ;
2. repli sur `node-gyp rebuild`, qui tente alors de télécharger les **headers
   Node depuis nodejs.org** → `ECONNRESET` → `gyp ERR! configure error / not ok`.

Correctif intégré au `Dockerfile` (étape builder) :

```dockerfile
ENV npm_config_nodedir=/usr/local \
    npm_config_build_from_source=true
```

L'image officielle `node` embarque déjà les headers dans `/usr/local/include/node` :
node-gyp compile **100 % hors-ligne**, de façon déterministe (aucun téléchargement
nodejs.org/GitHub pendant le build). Un garde-fou `RUN test -f …/node_api.h`
échoue explicitement si l'image de base ne fournissait plus les headers.

> ℹ️ Pendant `npm ci`, le message
> `npm warn deprecated prebuild-install@7.1.3: No longer maintained…`
> est un simple **avertissement de dépréciation, non fatal** (dépendance interne
> de better-sqlite3). Il n'interrompt pas le build : `npm ci` se termine avec
> le code 0 et la compilation continue jusqu'à `npm run build`.

> ⚠️ La documentation ci-dessus mentionne `npm_config_build_from_source=true` ;
> la valeur est désormais **limitée à `better-sqlite3`** (prebuild-install accepte
> le nom du paquet) pour n'imposer la compilation source qu'au seul module natif
> qui en a besoin.

### 🔧 Dépannage : `npm ci … exit code: 146` (processus tué pendant le build)

Un code de sortie **129–255** signifie que `npm ci` a été **interrompu par un
signal externe** (code − 128), pas qu'il a échoué par lui-même : typiquement une
VM Docker Desktop/WSL2 à court de mémoire ou un réseau très lent qui prolonge le
build jusqu'à l'asphyxie (le même `npm ci` prend ~70 s sur une machine saine).

Mesures intégrées au `Dockerfile` :
- `JOBS=2` : limite le nombre de compilations C++ parallèles de node-gyp
  (pic mémoire réduit) ;
- `npm_config_fetch_retries=5` + timeouts étendus : résilience aux réseaux lents ;
- `RUN --mount=type=cache,target=/root/.npm` : le cache npm **survit entre deux
  builds** — après une interruption, relancer `docker compose up -d --build`
  reprend sans retélécharger les ~550 paquets ;
- `--foreground-scripts --loglevel=notice` : la compilation s'affiche en direct
  (plus de longues minutes de silence).

Côté machine, si le code 146 revient :
1. **Relancez simplement le build** (le cache npm accélère la reprise).
2. Vérifiez la mémoire allouée à Docker Desktop (Settings → Resources) ou à WSL2 :
   fichier `%UserProfile%\.wslconfig`, section `[wsl2]`, `memory=4GB` minimum,
   puis `wsl --shutdown` et relancez Docker Desktop.
3. Vérifiez l'espace disque : `docker system df` (sans nettoyage destructif).
4. Journaux détaillés : `docker compose build --progress=plain web`.

### Basculer sur PostgreSQL

Changez `provider = "postgresql"` dans `prisma/schema.prisma`, remplacez
l'adapter par `@prisma/adapter-pg`, mettez `DATABASE_URL` en `postgresql://…`
et ajoutez un service `postgres` au compose.
