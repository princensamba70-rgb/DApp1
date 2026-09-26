import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, RequestHandler } from 'express';
import { pool } from './db.js';
import { config } from './config.js';
import { AppError, asyncRoute } from './errors.js';

export type Actor = { id: string; username: string; role: 'admin' | 'user' };
declare global { namespace Express { interface Request { actor?: Actor; sessionHash?: string; } } }
const COOKIE = 'sq_session';
const MAX_AGE = 12 * 60 * 60 * 1000;
const options: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.secureCookie, path: '/' };
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES($1,$2,now()+interval \'12 hours\')', [hashToken(token), userId]);
  return token;
}
export function setSessionCookie(res: import('express').Response, token: string) {
  res.cookie(COOKIE, token, { ...options, maxAge: MAX_AGE });
}
export function clearSessionCookie(res: import('express').Response) { res.clearCookie(COOKIE, options); }

export const requireAuth: RequestHandler = asyncRoute(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE] as string | undefined;
  if (!token || token.length > 200) throw new AppError(401, 'NON_AUTHENTIFIÉ', 'Authentification requise.');
  const tokenHash = hashToken(token);
  const result = await pool.query(`SELECT u.id, u.username, r.name AS role
    FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [tokenHash]);
  if (!result.rows[0]) throw new AppError(401, 'SESSION_EXPIRÉE', 'Session expirée. Veuillez vous reconnecter.');
  req.actor = result.rows[0] as Actor;
  req.sessionHash = tokenHash;
  next();
});
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.actor?.role !== 'admin') return next(new AppError(403, 'ACCÈS_REFUSÉ', 'Accès réservé aux administrateurs.'));
  next();
};
export const csrfOrigin: RequestHandler = (req, _res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) throw new Error('origin');
    } catch { next(new AppError(403, 'ORIGINE_REFUSÉE', 'Origine de la requête non autorisée.')); return; }
  }
  next();
};
