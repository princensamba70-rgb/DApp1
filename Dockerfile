# ── CORTEXP — image de production ────────────────────────────
# Étape 1 : dépendances + build
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 est compilé depuis les sources (python3 + make + g++)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# engineType=client : aucun binaire Prisma requis (les overrides coupent tout téléchargement)
ENV PRISMA_SCHEMA_ENGINE_BINARY=/bin/true \
    PRISMA_QUERY_ENGINE_LIBRARY=/bin/true

# ── Compilation native 100 % HORS-LIGNE (correctif better-sqlite3 / node-gyp) ──
# Sans ces variables, `npm ci` dépend du réseau pendant le build :
#   1. prebuild-install télécharge un binaire précompilé (GitHub) ;
#   2. en cas d'échec, node-gyp télécharge les headers Node depuis nodejs.org
#      → ECONNRESET / erreur TLS derrière un proxy ⇒ « gyp ERR! not ok ».
# L'image officielle node embarque déjà les headers dans /usr/local/include/node :
# on pointe node-gyp dessus et on force une compilation locale déterministe.
# build_from_source est LIMITÉ à better-sqlite3 (prebuild-install/rc.js accepte le nom
# du paquet : `buildFromSource === pkg.name`) : les autres paquets à script d'install
# (@prisma/*, unrs-resolver) ne déclenchent aucune compilation inutile.
ENV npm_config_nodedir=/usr/local \
    npm_config_build_from_source=better-sqlite3
# Garde-fou : échec immédiat et explicite si l'image de base ne fournit plus les headers.
RUN test -f /usr/local/include/node/node_api.h \
    || (echo "ERREUR : headers Node absents de l'image de base (npm_config_nodedir)" && exit 1)

# ── Durcissement contre l'« exit code: 146 » (npm ci tué par un signal externe) ──
# JOBS=2 : node-gyp (lib/build.js : `gyp.opts.jobs || process.env.JOBS`) limite make à
#   2 g++ parallèles → pic mémoire réduit sur les VM Docker Desktop/WSL2 étroites.
# fetch_* : réseau lent/instable → plus de tentatives au lieu d'un blocage prolongé.
ENV JOBS=2 \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=600000

COPY package.json package-lock.json ./
COPY prisma ./prisma
# CORRECTIF « exit code: 1 » : le postinstall exécute `node scripts/prisma-generate.mjs`
# → scripts/ DOIT être présent AVANT npm ci (sinon MODULE_NOT_FOUND en fin d'install).
COPY scripts ./scripts
# postinstall lance prisma generate.
# --mount=type=cache : le cache npm survit d'un build à l'autre → après une interruption,
#   la reprise ne retélécharge pas les ~550 paquets (fenêtre de risque réduite à ~2 min).
# --foreground-scripts + loglevel notice : journaux en direct au lieu de 26 min de silence.
# En cas d'échec, les 120 dernières lignes du journal npm (inaccessible depuis l'hôte,
# car dans le cache mount) sont affichées, puis l'échec est PROPAGÉ (exit 1 conservé).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --foreground-scripts --loglevel=notice \
    || { echo '────── Journal npm (dernier échec) ──────'; \
         tail -n 120 "$(ls -t /root/.npm/_logs/*.log | head -1)"; exit 1; }

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Étape 2 : runtime minimal
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r cortexp && useradd -r -g cortexp cortexp

# Serveur standalone Next + assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Scripts d'init DB + seed admin (exécutés au démarrage)
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma
# Modules natifs / client Prisma nécessaires aux scripts d'init (fusionnés avec
# les node_modules déjà tracés par le build standalone)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/@prisma/adapter-better-sqlite3 ./node_modules/@prisma/adapter-better-sqlite3
COPY --from=builder /app/node_modules/@prisma/driver-adapter-utils ./node_modules/@prisma/driver-adapter-utils
COPY --from=builder /app/node_modules/@prisma/debug ./node_modules/@prisma/debug
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p /app/data && chown -R cortexp:cortexp /app

USER cortexp
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
