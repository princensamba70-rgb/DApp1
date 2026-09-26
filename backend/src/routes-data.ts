import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { AppError, asyncRoute } from './errors.js';
import { requireAdmin } from './auth.js';
import { audit } from './audit.js';
import { exportResource } from './export.js';

export const dataRoutes = Router();
const uuid = z.string().uuid();
const filterSchema = z.object({
  questionnaireId: uuid.optional(), questionId: uuid.optional(),
  interviewer: z.string().trim().max(100).optional(), supervisor: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['CONFORME','NON CONFORME','NON CONTRÔLÉ']).optional(),
  errorType: z.string().trim().max(100).optional(),
});
export type Filters = z.infer<typeof filterSchema>;
export const parseFilters = (query: unknown): Filters => filterSchema.parse(query);
export function resultWhere(filters: Filters) {
  const conditions: string[] = [], values: unknown[] = [];
  const add = (sql: string, v: unknown) => { values.push(v); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (filters.questionnaireId) add('s.questionnaire_id=?',filters.questionnaireId);
  if (filters.questionId) add('qr.question_id=?',filters.questionId);
  if (filters.interviewer) add('s.interviewer ILIKE ?',`%${filters.interviewer}%`);
  if (filters.supervisor) add('s.supervisor ILIKE ?',`%${filters.supervisor}%`);
  if (filters.from) add('s.last_modified_at::date >= ?::date',filters.from);
  if (filters.to) add('s.last_modified_at::date <= ?::date',filters.to);
  if (filters.status) add('qr.status=?',filters.status);
  if (filters.errorType) add('qr.error_type=?',filters.errorType);
  return { sql: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '', values };
}
const resultBase = `FROM quality_results qr JOIN survey_responses s ON s.id=qr.response_id
  LEFT JOIN quality_rules r ON r.id=qr.rule_id JOIN questions qu ON qu.id=qr.question_id
  JOIN questionnaires q ON q.id=s.questionnaire_id`;
export const RESULT_BASE = resultBase;
export const RESULT_SELECT = `SELECT qr.id,qr.status,qr.error_type,qr.details,qr.value,qr.instance_key,qr.checked_at,
  qr.occurrence,qr.severity,qr.context,qr.related,s.quality_score,s.quality_class,qu.id AS question_id,qu.variable_name,qu.label AS question_label,
  q.id AS questionnaire_id,q.title AS questionnaire_title,s.external_id AS interview_id,
  s.interviewer,s.supervisor,s.last_modified_at ${resultBase}`;

// L'accès à toutes ces routes nécessite déjà une session active (montage dans app.ts).
dataRoutes.get('/dashboard', asyncRoute(async (_req,res) => {
  const [c,trend,recent,byType] = await Promise.all([
    pool.query(`SELECT
      (SELECT count(*)::int FROM questionnaires) AS questionnaires,
      (SELECT count(*)::int FROM questions) AS questions,
      (SELECT count(*)::int FROM survey_responses) AS analyzed,
      (SELECT count(*)::int FROM survey_responses WHERE status='CONFORME') AS compliant,
      (SELECT count(*)::int FROM survey_responses WHERE status='NON CONFORME') AS with_errors,
      (SELECT count(*)::int FROM quality_results) AS controls,
      (SELECT count(*)::int FROM quality_results WHERE status='CONFORME') AS passed,
      (SELECT count(*)::int FROM quality_results WHERE status='NON CONFORME') AS failed,
      (SELECT count(*)::int FROM quality_results WHERE status='NON CONTRÔLÉ') AS unchecked`),
    pool.query(`SELECT to_char(checked_at::date,'YYYY-MM-DD') AS date, count(*) FILTER (WHERE status='NON CONFORME')::int AS errors,
      count(*) FILTER (WHERE status='CONFORME')::int AS passed FROM quality_results
      WHERE checked_at >= now() - interval '14 days' GROUP BY checked_at::date ORDER BY checked_at::date`),
    pool.query(`${RESULT_SELECT} WHERE qr.status='NON CONFORME' ORDER BY qr.checked_at DESC, qr.id DESC LIMIT 5`),
    pool.query(`SELECT error_type, count(*)::int AS count FROM quality_results WHERE status='NON CONFORME' GROUP BY error_type ORDER BY count DESC`),
  ]);
  res.json({ metrics: c.rows[0], trend: trend.rows, recent: recent.rows, byType:byType.rows });
}));

dataRoutes.get('/questionnaires', asyncRoute(async (_req,res) => {
  const rows = await pool.query(`SELECT q.id,q.external_id,q.title,q.variable,q.workspace,q.status,q.last_synced_at,
    (SELECT max(version)::int FROM questionnaire_versions v WHERE v.questionnaire_id=q.id) AS version,
    (SELECT count(*)::int FROM questions qu JOIN questionnaire_versions v ON v.id=qu.version_id WHERE v.questionnaire_id=q.id) AS questions_count,
    (SELECT count(*)::int FROM survey_responses s WHERE s.questionnaire_id=q.id) AS responses_count,
    (SELECT count(*)::int FROM questionnaire_versions v WHERE v.questionnaire_id=q.id) AS versions_count
    FROM questionnaires q ORDER BY q.title LIMIT 1000`);
  res.json(rows.rows);
}));
dataRoutes.get('/questionnaires/:id', asyncRoute(async (req,res) => {
  const id = uuid.parse(req.params.id);
  const q = (await pool.query('SELECT id,external_id,title,variable,workspace,status,last_synced_at FROM questionnaires WHERE id=$1',[id])).rows[0];
  if (!q) throw new AppError(404,'QUESTIONNAIRE_ABSENT','Questionnaire introuvable.');
  const [versions,sections] = await Promise.all([
    pool.query(`SELECT v.id,v.version,v.identity,v.last_synced_at,(SELECT count(*)::int FROM questions qu WHERE qu.version_id=v.id) AS questions_count,
      (SELECT count(*)::int FROM survey_responses s WHERE s.version_id=v.id) AS responses_count
      FROM questionnaire_versions v WHERE v.questionnaire_id=$1 ORDER BY v.version DESC`,[id]),
    pool.query(`SELECT s.id,s.external_id,s.parent_id,s.title,s.variable_name,s.enabling_condition,s.is_roster,s.position,s.version_id
      FROM sections s JOIN questionnaire_versions v ON v.id=s.version_id WHERE v.questionnaire_id=$1 ORDER BY v.version DESC,s.position`,[id]),
  ]);
  res.json({ ...q, versions:versions.rows, sections:sections.rows });
}));
dataRoutes.get('/questions', asyncRoute(async(req,res) => {
  const query = z.object({ questionnaireId: uuid.optional(),versionId:uuid.optional(),sectionId:uuid.optional(),search:z.string().max(100).optional() }).parse(req.query);
  const values: unknown[] = [], conditions: string[] = [];
  if (query.questionnaireId) { values.push(query.questionnaireId); conditions.push(`v.questionnaire_id=$${values.length}`); }
  if (query.versionId) { values.push(query.versionId); conditions.push(`qu.version_id=$${values.length}`); }
  if (query.sectionId) { values.push(query.sectionId); conditions.push(`qu.section_id=$${values.length}`); }
  if (query.search) { values.push(`%${query.search}%`); conditions.push(`(qu.label ILIKE $${values.length} OR qu.variable_name ILIKE $${values.length})`); }
  const rows = await pool.query(`SELECT qu.id,qu.version_id,qu.section_id,qu.external_id,qu.variable_name,qu.label,qu.type,qu.options,
    qu.constraints,qu.min_value,qu.max_value,qu.enabling_condition,qu.is_roster,qu.position,
    s.title AS section_title,s.parent_id AS parent_section_id,v.version,q.id AS questionnaire_id,q.title AS questionnaire_title,
    (SELECT count(*)::int FROM quality_rules r WHERE r.question_id=qu.id) AS rules_count
    FROM questions qu JOIN questionnaire_versions v ON v.id=qu.version_id JOIN questionnaires q ON q.id=v.questionnaire_id
    LEFT JOIN sections s ON s.id=qu.section_id ${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''}
    ORDER BY q.title,v.version DESC,qu.position LIMIT 5000`,values);
  res.json(rows.rows);
}));
dataRoutes.get('/questions/:id', asyncRoute(async(req,res) => {
  const id = uuid.parse(req.params.id);
  const item = (await pool.query(`SELECT qu.*,s.title AS section_title,v.version,q.title AS questionnaire_title,q.id AS questionnaire_id
    FROM questions qu LEFT JOIN sections s ON s.id=qu.section_id JOIN questionnaire_versions v ON v.id=qu.version_id
    JOIN questionnaires q ON q.id=v.questionnaire_id WHERE qu.id=$1`,[id])).rows[0];
  if (!item) throw new AppError(404,'QUESTION_ABSENTE','Question introuvable.');
  res.json(item);
}));
dataRoutes.get('/quality-rules', requireAdmin, asyncRoute(async(req,res) => {
  const query = z.object({ questionnaireId: uuid.optional(),questionId:uuid.optional(),versionId:uuid.optional() }).parse(req.query);
  const values: unknown[] = [], clauses: string[] = [];
  if (query.questionnaireId) { values.push(query.questionnaireId); clauses.push(`v.questionnaire_id=$${values.length}`); }
  if (query.questionId) { values.push(query.questionId); clauses.push(`r.question_id=$${values.length}`); }
  if (query.versionId) { values.push(query.versionId); clauses.push(`qu.version_id=$${values.length}`); }
  const rows = await pool.query(`SELECT r.id,r.question_id,r.type,r.params,r.active,r.created_at,r.updated_at,
    qu.variable_name,qu.label AS question_label,qu.section_id,qu.version_id,q.id AS questionnaire_id,q.title AS questionnaire_title,v.version
    FROM quality_rules r JOIN questions qu ON qu.id=r.question_id JOIN questionnaire_versions v ON v.id=qu.version_id
    JOIN questionnaires q ON q.id=v.questionnaire_id ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''}
    ORDER BY q.title,v.version DESC,qu.position,r.created_at LIMIT 10000`,values);
  res.json(rows.rows);
}));
const pagination = z.object({ page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20) });
async function sendResults(req: import('express').Request,res: import('express').Response, errorsOnly = false) {
  const {page,pageSize} = pagination.parse(req.query);
  const filters = parseFilters(req.query);
  if (errorsOnly) filters.status = 'NON CONFORME';
  const {sql,values} = resultWhere(filters);
  const count = await pool.query(`SELECT count(*)::int AS total, count(*) FILTER(WHERE qr.status='CONFORME')::int AS passed,
    count(*) FILTER(WHERE qr.status='NON CONFORME')::int AS failed, count(*) FILTER(WHERE qr.status='NON CONTRÔLÉ')::int AS unchecked ${resultBase} ${sql}`,values);
  const items = await pool.query(`${RESULT_SELECT} ${sql} ORDER BY qr.checked_at DESC,qr.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pageSize,(page-1)*pageSize]);
  res.json({items:items.rows,total:count.rows[0].total,summary:count.rows[0],page,pageSize});
}
dataRoutes.get('/quality-results', asyncRoute(async(req,res) => sendResults(req,res)));
dataRoutes.get('/errors', asyncRoute(async(req,res) => sendResults(req,res,true)));
dataRoutes.get('/reports', asyncRoute(async(req,res) => { await audit(req,'Consultation du rapport','Rapport qualité'); await sendResults(req,res); }));
dataRoutes.get('/reports/statistics', asyncRoute(async (_req,res) => {
  const series = await pool.query(`SELECT q.id,q.title,
      count(DISTINCT s.id)::int AS interviews,
      count(DISTINCT s.id) FILTER(WHERE s.status='NON CONFORME')::int AS with_errors,
      count(qr.id)::int AS controls,
      count(qr.id) FILTER(WHERE qr.status='NON CONFORME')::int AS failed
    FROM questionnaires q LEFT JOIN survey_responses s ON s.questionnaire_id=q.id
    LEFT JOIN quality_results qr ON qr.response_id=s.id GROUP BY q.id,q.title ORDER BY q.title`);
  res.json(series.rows);
}));
dataRoutes.get('/activity', asyncRoute(async(req,res) => {
  const page = z.coerce.number().int().min(1).max(10000).parse(req.query.page || 1);
  res.json((await pool.query('SELECT id,username,action,target,ip_address,created_at FROM activity_logs ORDER BY created_at DESC LIMIT 50 OFFSET $1',[(page-1)*50])).rows);
}));
dataRoutes.get('/exports/:resource', asyncRoute(async (req,res) => {
  const resource = z.enum(['errors','results','statistics','questionnaires','questions','rules']).parse(req.params.resource);
  if(resource === 'rules' && req.actor?.role !== 'admin') throw new AppError(403,'ACCÈS_REFUSÉ','Accès réservé aux administrateurs.');
  const format = z.enum(['csv','xlsx','pdf']).parse(req.query.format);
  const filters = parseFilters(req.query);
  const { buffer, mime, filename } = await exportResource(resource,format,filters);
  await audit(req,'Export de données',`${resource} (${format})`);
  res.setHeader('Content-Type',mime);
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.setHeader('Cache-Control','no-store');
  res.send(buffer);
}));
