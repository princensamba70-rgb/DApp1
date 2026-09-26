import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { pool } from './db.js';

export async function audit(req: Request, action: string, target?: string) {
  try {
    const actor = req.actor;
    await pool.query('INSERT INTO activity_logs(id,user_id,username,action,target,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actor?.id || null, actor?.username || 'système', action, target || null, req.ip || null]);
  } catch { console.error('[audit] Journalisation impossible.'); }
}
export async function auditSystem(action: string, target?: string) {
  try {
    await pool.query('INSERT INTO activity_logs(id,username,action,target) VALUES($1,$2,$3,$4)', [randomUUID(), 'système', action, target || null]);
  } catch { console.error('[audit] Journalisation système impossible.'); }
}
