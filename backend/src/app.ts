import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';
import { AppError, asyncRoute, errorHandler } from './errors.js';
import { clearSessionCookie, createSession, csrfOrigin, hashToken, requireAuth, setSessionCookie } from './auth.js';
import { audit } from './audit.js';
import { intelligenceRoutes } from './routes-intelligence.js';
import { admin } from './routes-admin.js';
import { dataRoutes } from './routes-data.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cookieParser());
app.use(express.json({limit:'128kb'}));
app.use(csrfOrigin);

app.get('/health', asyncRoute(async (_req,res) => {
  try { await pool.query('SELECT 1'); res.json({status:'ok'}); }
  catch { res.status(503).json({status:'unavailable'}); }
}));
const loginLimit = rateLimit({ windowMs:15*60*1000, limit:8, skipSuccessfulRequests:true, standardHeaders:'draft-7', legacyHeaders:false,
  message:{error:'TROP_DE_TENTATIVES',message:'Trop de tentatives. Réessayez dans 15 minutes.'} });
app.post('/api/auth/login',loginLimit,asyncRoute(async (req,res) => {
  const {username,password} = z.object({username:z.string().min(1).max(100),password:z.string().min(1).max(500)}).strict().parse(req.body);
  const row = (await pool.query(`SELECT u.id,u.username,u.password_hash,u.active,r.name AS role
    FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=lower($1)`,[username])).rows[0];
  // Calcule de comparaison meme pour un identifiant inconnu pour attenuer l'enumeration.
  const passwordHash = row?.password_hash || '$2a$12$RKOS33NBjd35PaBr6EoIBuiCAuKXXiL1hzo9x26PmbbAv5h7FJ6iy';
  const valid = await bcrypt.compare(password,passwordHash);
  if (!row || !row.active || !valid) throw new AppError(401,'IDENTIFIANTS_INVALIDES','Identifiants invalides.');
  const token = await createSession(row.id);
  setSessionCookie(res,token);
  req.actor = {id:row.id,username:row.username,role:row.role};
  await audit(req,'Connexion','Session ouverte');
  res.json({user:req.actor});
}));
app.post('/api/auth/logout',asyncRoute(async(req,res) => {
  const token = req.cookies?.sq_session as string | undefined;
  if (token && token.length < 200) {
    const hash = hashToken(token);
    const actor = await pool.query(`SELECT u.id,u.username,r.name AS role FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.token_hash=$1`,[hash]);
    req.actor = actor.rows[0];
    await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[hash]);
  }
  clearSessionCookie(res);
  if (req.actor) await audit(req,'Déconnexion','Session fermée');
  res.status(204).end();
}));
app.use('/api',requireAuth);
app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/api/auth/me',(req,res) => { res.json({user:req.actor}); });
app.put('/api/auth/password',asyncRoute(async(req,res) => {
  const body = z.object({oldPassword:z.string(),newPassword:z.string().min(8).max(128),confirmPassword:z.string()}).strict().refine(v=>v.newPassword===v.confirmPassword,{path:['confirmPassword'],message:'Confirmation différente.'}).parse(req.body);
  const row = (await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.actor!.id])).rows[0];
  if (!row || !(await bcrypt.compare(body.oldPassword,row.password_hash))) throw new AppError(400,'MOT_DE_PASSE_INVALIDE','Mot de passe actuel incorrect.');
  const hash = await bcrypt.hash(body.newPassword,12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[hash,req.actor!.id]);
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[req.actor!.id]);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  clearSessionCookie(res);
  await audit(req,'Modification du mot de passe','Compte personnel');
  res.status(204).end();
}));
app.use('/api',admin);
app.use('/api',intelligenceRoutes);
app.use('/api',dataRoutes);
app.use((_req,_res,next) => next(new AppError(404,'ROUTE_ABSENTE','Route introuvable.')));
app.use(errorHandler);
