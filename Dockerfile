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

COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall lance prisma generate
RUN npm ci

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
