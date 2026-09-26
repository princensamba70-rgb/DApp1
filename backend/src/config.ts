import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // DATABASE_URL reste possible en développement ; Docker passe des champs séparés
  // pour que les caractères spéciaux du mot de passe ne cassent pas l'URI PostgreSQL.
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).optional(),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().min(1).optional(),
  POSTGRES_USER: z.string().min(1).optional(),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  ADMIN_USERNAME: z.string().min(2).default('admin'),
  ADMIN_PASSWORD: z.string().min(8),
  USER1_USERNAME: z.string().min(2).default('user1'),
  USER1_PASSWORD: z.string().min(8),
  SURVEY_ENCRYPTION_KEY: z.string().min(1),
  SURVEY_ALLOW_HTTP: z.enum(['true', 'false']).default('false'),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Ne jamais afficher les valeurs d'entrée ni l'objet process.env.
  const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ');
  throw new Error(`CONFIG_INVALIDE : vérifiez dans .env les variables suivantes : ${fields}. Aucune valeur n'a été journalisée.`);
}
const env = parsed.data;
if (!env.DATABASE_URL && !(env.POSTGRES_HOST && env.POSTGRES_DB && env.POSTGRES_USER && env.POSTGRES_PASSWORD)) {
  throw new Error('CONFIG_BASE : renseignez DATABASE_URL ou POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER et POSTGRES_PASSWORD.');
}
if ([env.ADMIN_PASSWORD, env.USER1_PASSWORD].some(secret => secret.startsWith('change_me'))) {
  throw new Error('CONFIG_COMPTES : remplacez les mots de passe fictifs de .env.example avant le démarrage.');
}
const encryptionKey = Buffer.from(env.SURVEY_ENCRYPTION_KEY, 'base64');
if (encryptionKey.length !== 32 || env.SURVEY_ENCRYPTION_KEY.startsWith('change_me')) {
  throw new Error('CONFIG_CLE : SURVEY_ENCRYPTION_KEY doit être une clé base64 de 32 octets, différente de .env.example.');
}
export const config = {
  ...env,
  encryptionKey,
  allowHttp: env.SURVEY_ALLOW_HTTP === 'true',
  secureCookie: env.SESSION_COOKIE_SECURE === 'true',
};
