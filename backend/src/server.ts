import { app } from './app.js';
import { config } from './config.js';
import { DatabaseStartupError, initDatabase, pool } from './db.js';
import { scheduleSync, startPeriodicSync, storedConfig } from './sync.js';

async function main() {
  await initDatabase();
  if (await storedConfig()) scheduleSync(20000);
  startPeriodicSync(config.SYNC_INTERVAL_MINUTES);
  app.listen(config.PORT,'0.0.0.0',() => console.log(`[api] Serveur prêt sur le port ${config.PORT}`));
}
main().catch(async error => {
  if (error instanceof DatabaseStartupError) {
    console.error(`[startup] ${error.code} : ${error.message}`);
  } else if ((error as {code?:unknown})?.code === 'ENOENT') {
    console.error('[startup] SCHEMA_ABSENT : le fichier database/schema.sql manque dans l’image backend.');
  } else {
    // Ne jamais afficher l'exception brute : un pilote peut inclure des secrets.
    console.error('[startup] INITIALISATION : démarrage impossible ; vérifiez la configuration et les journaux PostgreSQL.');
  }
  await pool.end().catch(() => {});
  process.exit(1);
});
