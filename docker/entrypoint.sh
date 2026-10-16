#!/bin/sh
set -e

echo "[cortexp] validation des variables d'environnement…"
node scripts/check-env.mjs

echo "[cortexp] initialisation du schéma SQLite…"
node scripts/init-db.mjs

echo "[cortexp] synchronisation du compte administrateur…"
node scripts/seed.mjs

echo "[cortexp] démarrage du serveur Next.js…"
exec node server.js
