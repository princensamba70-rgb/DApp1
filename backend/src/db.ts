import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { config } from './config.js';

export type PostgresSettings = {
  DATABASE_URL?: string;
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: number;
  POSTGRES_DB?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
};

// Ne pas assembler un URI avec un mot de passe brut : @, #, / et % y ont un sens spécial.
export function postgresOptions(settings: PostgresSettings): pg.PoolConfig {
  return settings.DATABASE_URL ? {connectionString: settings.DATABASE_URL} : {
    host: settings.POSTGRES_HOST,
    port: settings.POSTGRES_PORT ?? 5432,
    database: settings.POSTGRES_DB,
    user: settings.POSTGRES_USER,
    password: settings.POSTGRES_PASSWORD,
  };
}

export class DatabaseStartupError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function classifyPostgresFailure(error: unknown): DatabaseStartupError {
  const code = (error as {code?:unknown})?.code;
  if (code === '28P01') return new DatabaseStartupError('PG_AUTH',
    'PostgreSQL refuse le mot de passe. Si le volume postgres_data existe déjà, changer POSTGRES_PASSWORD dans .env ne modifie pas le mot de passe du rôle en base. Rétablissez la valeur précédente ou changez le mot de passe du rôle sans supprimer le volume.');
  if (code === '28000') return new DatabaseStartupError('PG_UTILISATEUR',
    'Le compte PostgreSQL configuré est absent ou non autorisé. Vérifiez POSTGRES_USER et le volume existant.');
  if (code === '3D000') return new DatabaseStartupError('PG_BASE',
    'La base PostgreSQL configurée est absente. Vérifiez POSTGRES_DB et le volume existant.');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new DatabaseStartupError('PG_RESEAU',
    'Nom du serveur PostgreSQL introuvable depuis le backend. Vérifiez le réseau Compose et POSTGRES_HOST.');
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return new DatabaseStartupError('PG_INDISPONIBLE',
    'PostgreSQL ne répond pas depuis le backend. Vérifiez l’état et les journaux du service postgres.');
  // Ne pas journaliser error.message : les clients et URI peuvent y inclure des secrets.
  return new DatabaseStartupError('PG_CONNEXION',
    'Connexion PostgreSQL impossible. Vérifiez les journaux postgres et la cohérence des paramètres de base, sans partager les mots de passe.');
}

export const pool = new pg.Pool({ ...postgresOptions(config), max:12, idleTimeoutMillis:30000, connectionTimeoutMillis:5000 });
pool.on('error', () => console.error('[database] Connexion inactive perdue.'));

export async function initDatabase() {
  let ready = false, lastError: unknown;
  for (let i=0; i<20; i++) {
    try { await pool.query('SELECT 1'); ready = true; break; }
    catch(error) {
      lastError = error;
      // Ces échecs de configuration ne se résoudront pas en attendant davantage.
      if (['28P01','28000','3D000'].includes(String((error as {code?:unknown})?.code))) break;
      await new Promise(resolve => setTimeout(resolve,1500));
    }
  }
  if (!ready) throw classifyPostgresFailure(lastError);

  const schema = await readFile(resolve(process.cwd(), '../database/schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query("INSERT INTO roles(name) VALUES ('admin'),('user') ON CONFLICT(name) DO NOTHING");
    // Les mots de passe initiaux ne sont définis qu'une fois ; aucun redémarrage ne les écrase.
    for (const account of [
      {username:config.ADMIN_USERNAME,password:config.ADMIN_PASSWORD,role:'admin'},
      {username:config.USER1_USERNAME,password:config.USER1_PASSWORD,role:'user'},
    ]) {
      const existing = await client.query('SELECT id FROM users WHERE lower(username)=lower($1)', [account.username]);
      if (!existing.rowCount) {
        const hash = await bcrypt.hash(account.password,12);
        await client.query('INSERT INTO users(id,username,password_hash,role_id) VALUES($1,$2,$3,(SELECT id FROM roles WHERE name=$4))',
          [randomUUID(),account.username,hash,account.role]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const state = (error as {code?:unknown})?.code;
    const code = typeof state === 'string' && /^[A-Z0-9]{5}$/.test(state) ? state : 'INCONNU';
    throw new DatabaseStartupError('PG_SCHEMA',
      `Initialisation du schéma impossible (code SQL ${code}). Vérifiez le propriétaire de la base et les migrations, sans supprimer postgres_data.`);
  } finally { client.release(); }
}
