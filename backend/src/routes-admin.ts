import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';
import { AppError, asyncRoute } from './errors.js';
import { requireAdmin } from './auth.js';
import { audit } from './audit.js';
import { encrypt, decrypt } from './crypto.js';
import { publicConfig, scheduleSync, serviceFromConfig, storedConfig, syncSurvey, type SurveyConfig } from './sync.js';
import { SurveySolutionsService } from './survey-solutions.service.js';
import { parseRule, reanalyzeVersion, validateReferences } from './quality.js';

export const admin = Router();
const uuid = z.string().uuid();
const username = z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9._-]{1,49}$/, 'Identifiant : 2 à 50 caractères, lettres, chiffres, point, tiret ou souligné.');
const password = z.string().min(8, 'Au moins 8 caractères.').max(128);
const createUser = z.object({ username, password, confirmPassword: z.string(), role: z.enum(['admin','user']), active: z.boolean().default(true) }).strict()
  .refine(u => u.password === u.confirmPassword, { path: ['confirmPassword'], message: 'Confirmation différente.' });
const updateUser = z.object({ username, role: z.enum(['admin','user']), active: z.boolean(), confirm: z.boolean().optional() }).strict();
const resetPassword = z.object({ newPassword: password, confirmPassword: z.string(), confirm: z.literal(true) }).strict()
  .refine(u => u.newPassword === u.confirmPassword, { path: ['confirmPassword'], message: 'Confirmation différente.' });
const selectUsers = `SELECT u.id,u.username,r.name AS role,u.active,u.created_at,u.updated_at FROM users u JOIN roles r ON r.id=u.role_id`;

admin.get('/users', requireAdmin, asyncRoute(async (_req,res) => {
  const data = await pool.query(`${selectUsers} ORDER BY u.created_at,u.username`);
  res.json(data.rows);
}));
admin.post('/users', requireAdmin, asyncRoute(async (req,res) => {
  const input = createUser.parse(req.body);
  const hash = await bcrypt.hash(input.password, 12);
  try {
    const created = await pool.query(`INSERT INTO users(id,username,password_hash,role_id,active)
      VALUES($1,$2,$3,(SELECT id FROM roles WHERE name=$4),$5) RETURNING id`,
      [randomUUID(), input.username, hash, input.role, input.active]);
    await audit(req,'Création utilisateur',input.username);
    const publicUser = await pool.query(`${selectUsers} WHERE u.id=$1`, [created.rows[0].id]);
    res.status(201).json(publicUser.rows[0]);
  } catch (err) {
    if ((err as {code?: string}).code === '23505') throw new AppError(409,'IDENTIFIANT_EXISTANT','Ce nom d’utilisateur est déjà utilisé.');
    throw err;
  }
}));
admin.put('/users/:id', requireAdmin, asyncRoute(async (req,res) => {
  const id = uuid.parse(req.params.id), input = updateUser.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451756)');
    const previous = await client.query(`${selectUsers} WHERE u.id=$1 FOR UPDATE OF u`,[id]);
    if (!previous.rowCount) throw new AppError(404,'UTILISATEUR_ABSENT','Utilisateur introuvable.');
    const prior = previous.rows[0];
    if ((!input.active || input.role !== prior.role) && !input.confirm) throw new AppError(400,'CONFIRMATION_REQUISE','Confirmez cette modification sensible.');
    if (req.actor!.id === id && (!input.active || input.role !== 'admin')) throw new AppError(400,'COMPTE_PROTÉGÉ','Vous ne pouvez pas désactiver ou rétrograder votre propre compte.');
    if (prior.role === 'admin' && prior.active && (input.role !== 'admin' || !input.active)) {
      const count = await client.query("SELECT count(*)::int AS count FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' AND u.active=true");
      if (count.rows[0].count <= 1) throw new AppError(400,'DERNIER_ADMIN','Le dernier administrateur actif ne peut pas être désactivé.');
    }
    await client.query(`UPDATE users SET username=$1,role_id=(SELECT id FROM roles WHERE name=$2),active=$3,updated_at=now() WHERE id=$4`,[input.username,input.role,input.active,id]);
    if (!input.active || input.role !== prior.role) await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
    await client.query('COMMIT');
    await audit(req,'Modification utilisateur',input.username);
    res.json((await pool.query(`${selectUsers} WHERE u.id=$1`,[id])).rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as {code?:string}).code === '23505') throw new AppError(409,'IDENTIFIANT_EXISTANT','Ce nom d’utilisateur est déjà utilisé.');
    throw err;
  } finally { client.release(); }
}));
admin.put('/users/:id/password', requireAdmin, asyncRoute(async (req,res) => {
  const id = uuid.parse(req.params.id), input = resetPassword.parse(req.body);
  const account = await pool.query('SELECT username FROM users WHERE id=$1',[id]);
  if (!account.rowCount) throw new AppError(404,'UTILISATEUR_ABSENT','Utilisateur introuvable.');
  const hash = await bcrypt.hash(input.newPassword,12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[hash,id]);
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
    await client.query('COMMIT');
  } catch(err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  await audit(req,'Réinitialisation du mot de passe',account.rows[0].username);
  res.status(204).end();
}));
admin.delete('/users/:id', requireAdmin, asyncRoute(async(req,res) => {
  const id = uuid.parse(req.params.id);
  if (req.actor!.id === id) throw new AppError(400,'COMPTE_PROTÉGÉ','Vous ne pouvez pas supprimer votre propre compte.');
  if (req.body?.confirm !== true) throw new AppError(400,'CONFIRMATION_REQUISE','Confirmez la suppression.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451756)');
    const user = await client.query(`${selectUsers} WHERE u.id=$1 FOR UPDATE OF u`,[id]);
    if (!user.rowCount) throw new AppError(404,'UTILISATEUR_ABSENT','Utilisateur introuvable.');
    if (user.rows[0].role === 'admin' && user.rows[0].active) {
      const count = await client.query("SELECT count(*)::int AS count FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' AND u.active=true");
      if (count.rows[0].count <= 1) throw new AppError(400,'DERNIER_ADMIN','Le dernier administrateur actif ne peut pas être supprimé.');
    }
    await client.query('DELETE FROM users WHERE id=$1',[id]);
    await client.query('COMMIT');
    await audit(req,'Suppression utilisateur',user.rows[0].username);
    res.status(204).end();
  } catch(err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}));

const connectionInput = z.object({
  url: z.string().url().max(500), workspace: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/).default('primary'),
  username: z.string().max(150).optional(), password: z.string().max(500).optional(),
  allowInsecureHttp: z.boolean().default(false),
}).strict();
function credentialsFor(input: z.infer<typeof connectionInput>, saved: SurveyConfig | null) {
  // Ne jamais réutiliser automatiquement un secret d'un ancien serveur sur un autre hôte.
  const root = (url: string) => url.trim().replace(/\/+$/, '');
  const sameServer = !!saved && root(input.url) === root(saved.server_url);
  const username = input.username || (sameServer ? decrypt(saved.username_encrypted) : '');
  const password = input.password || (sameServer ? decrypt(saved.password_encrypted) : '');
  if (!username || !password) throw new AppError(400, 'IDENTIFIANTS_MANQUANTS',
    'Renseignez le compte API et son mot de passe pour ce serveur. Les identifiants de l’ancien serveur ne sont pas réutilisés.');
  return { username, password };
}
admin.get('/settings/survey-solutions', requireAdmin, asyncRoute(async (_req,res) => { res.json(publicConfig(await storedConfig())); }));
admin.put('/settings/survey-solutions', requireAdmin, asyncRoute(async (req,res) => {
  const input = connectionInput.parse(req.body), old = await storedConfig();
  const { username, password } = credentialsFor(input, old);
  // Vérifier URL, protocole et espace avant stockage ; HTTP exige une autorisation explicite.
  new SurveySolutionsService(input.url, username, password, input.workspace, input.allowInsecureHttp);
  await pool.query(`INSERT INTO survey_solutions_config(id,server_url,workspace,allow_insecure_http,username_encrypted,password_encrypted,connection_status)
    VALUES(1,$1,$2,$3,$4,$5,'NON CONNECTÉ') ON CONFLICT(id) DO UPDATE SET server_url=EXCLUDED.server_url,workspace=EXCLUDED.workspace,
    allow_insecure_http=EXCLUDED.allow_insecure_http,username_encrypted=EXCLUDED.username_encrypted,password_encrypted=EXCLUDED.password_encrypted,
    connection_status='NON CONNECTÉ',server_version=NULL,updated_at=now()`,
    [input.url.replace(/\/+$/,''), input.workspace, input.allowInsecureHttp, encrypt(username), encrypt(password)]);
  await audit(req,'Configuration Survey Solutions','Connexion API');
  scheduleSync(15000);
  res.json(publicConfig(await storedConfig()));
}));
admin.post('/settings/survey-solutions/test', requireAdmin, asyncRoute(async (req,res) => {
  const saved = await storedConfig();
  const body = req.body || {};
  const override = Object.keys(body).length > 0;
  let service: SurveySolutionsService;
  if (override) {
    const input = connectionInput.parse(body);
    const {username, password} = credentialsFor(input, saved);
    service = new SurveySolutionsService(input.url, username, password, input.workspace, input.allowInsecureHttp);
  } else {
    if (!saved) throw new AppError(400,'NON_CONFIGURÉ','Enregistrez une configuration avant de la tester.');
    service = serviceFromConfig(saved);
  }
  try {
    const result = await service.testConnection();
    if (!override) await pool.query("UPDATE survey_solutions_config SET connection_status='CONNECTÉ',server_version=$1,last_tested_at=now() WHERE id=1", [result.version]);
    await audit(req,'Test de connexion Survey Solutions','Connexion réussie');
    res.json({ success:true, status:'CONNECTÉ', serverVersion: result.version, apiVersion: result.api,
      compatible: result.compatible, warnings: result.warnings, message:'Accès API confirmé dans l’espace de travail demandé.' });
  } catch (error) {
    if (!override && saved) await pool.query("UPDATE survey_solutions_config SET connection_status='ERREUR DE CONNEXION',last_tested_at=now() WHERE id=1");
    await audit(req,'Test de connexion Survey Solutions','Échec');
    throw error;
  }
}));
admin.post('/sync', requireAdmin, asyncRoute(async (req,res) => {
  const data = z.object({ questionnaireId: uuid.optional() }).strict().parse(req.body || {});
  const result = await syncSurvey(data.questionnaireId);
  await audit(req,'Synchronisation Survey Solutions',data.questionnaireId || 'Tous les questionnaires');
  res.json({ ...result, message: 'Synchronisation terminée.' });
}));
admin.get('/sync/logs', requireAdmin, asyncRoute(async (_req,res) => {
  res.json((await pool.query('SELECT id,status,questionnaires_count,questions_count,responses_count,error_code,started_at,finished_at FROM sync_logs ORDER BY started_at DESC LIMIT 50')).rows);
}));

admin.post('/quality-rules', requireAdmin, asyncRoute(async (req,res) => {
  const input = parseRule(req.body), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    const versionId = await validateReferences(client,input);
    const id = randomUUID();
    const created = await client.query(`INSERT INTO quality_rules(id,question_id,type,params,active,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,question_id,type,params,active,created_at,updated_at`,
      [id,input.questionId,input.type,JSON.stringify(input.params),input.active,req.actor!.id]);
    await reanalyzeVersion(versionId,client);
    await client.query('COMMIT');
    await audit(req,'Création de règle qualité',input.questionId);
    res.status(201).json(created.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
admin.put('/quality-rules/:id', requireAdmin, asyncRoute(async (req,res) => {
  const id = uuid.parse(req.params.id), input = parseRule(req.body), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    const old = await client.query('SELECT r.id,q.version_id FROM quality_rules r JOIN questions q ON q.id=r.question_id WHERE r.id=$1 FOR UPDATE OF r',[id]);
    if (!old.rowCount) throw new AppError(404,'RÈGLE_ABSENTE','Règle introuvable.');
    const versionId = await validateReferences(client,input);
    if (versionId !== old.rows[0].version_id) throw new AppError(400,'VERSION_INVALIDE','Une règle ne peut pas changer de version de questionnaire.');
    const updated = await client.query(`UPDATE quality_rules SET question_id=$1,type=$2,params=$3,active=$4,updated_at=now() WHERE id=$5
      RETURNING id,question_id,type,params,active,created_at,updated_at`,
      [input.questionId,input.type,JSON.stringify(input.params),input.active,id]);
    await reanalyzeVersion(versionId,client);
    await client.query('COMMIT');
    await audit(req,'Modification de règle qualité',input.questionId);
    res.json(updated.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
admin.delete('/quality-rules/:id', requireAdmin, asyncRoute(async (req,res) => {
  const id = uuid.parse(req.params.id);
  if (req.body?.confirm !== true) throw new AppError(400,'CONFIRMATION_REQUISE','Confirmez la suppression.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    const old = await client.query('SELECT r.question_id,q.version_id FROM quality_rules r JOIN questions q ON q.id=r.question_id WHERE r.id=$1 FOR UPDATE OF r',[id]);
    if (!old.rowCount) throw new AppError(404,'RÈGLE_ABSENTE','Règle introuvable.');
    await client.query('DELETE FROM quality_rules WHERE id=$1',[id]);
    await reanalyzeVersion(old.rows[0].version_id,client);
    await client.query('COMMIT');
    await audit(req,'Suppression de règle qualité',old.rows[0].question_id);
    res.status(204).end();
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
