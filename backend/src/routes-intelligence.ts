import { Router } from 'express';
import { pool } from './db.js';
import { asyncRoute } from './errors.js';
import { requireAdmin } from './auth.js';
import { settingsSchema } from './intelligence.js';
import { reanalyzeVersion } from './quality.js';
import { audit } from './audit.js';

export const intelligenceRoutes=Router();
intelligenceRoutes.get('/intelligence/settings',requireAdmin,asyncRoute(async(_req,res)=>{
  res.json(settingsSchema.parse((await pool.query('SELECT settings FROM quality_settings WHERE id=1')).rows[0]?.settings||{}));
}));
intelligenceRoutes.put('/intelligence/settings',requireAdmin,asyncRoute(async(req,res)=>{
  const settings=settingsSchema.parse(req.body),client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Same transaction lock as sync/manual edits: settings and results commit together.
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    await client.query('UPDATE quality_settings SET settings=$1,updated_at=now() WHERE id=1',[JSON.stringify(settings)]);
    const versions=await client.query('SELECT id FROM questionnaire_versions ORDER BY id');
    for(const v of versions.rows)await reanalyzeVersion(v.id,client);
    await client.query('COMMIT');
  } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
  await audit(req,'Paramètres qualité','Paramètres modifiés et données réanalysées');
  res.json(settings);
}));
intelligenceRoutes.get('/intelligence/statistics',asyncRoute(async(_req,res)=>{
  const [summary,severity,missing,types,interviewers,villages,areas,zones,questions,trend,scores]=await Promise.all([
    pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='CONFORME')::int AS compliant,
      count(*) FILTER(WHERE status='NON CONFORME')::int AS with_errors,count(*) FILTER(WHERE status='NON CONTRÔLÉ')::int AS unchecked,
      round(avg(quality_score),1) AS quality FROM survey_responses`),
    pool.query(`SELECT severity,count(*)::int AS count FROM quality_results WHERE status='NON CONFORME' GROUP BY severity`),
    pool.query(`SELECT sum(missing_count)::int AS missing,sum(eligible)::int AS eligible FROM quality_analysis`),
    pool.query(`SELECT error_type AS name,count(*)::int AS count FROM quality_results WHERE status='NON CONFORME' GROUP BY error_type ORDER BY count DESC`),
    pool.query(`SELECT coalesce(s.interviewer,'Non renseigné') AS name,count(*)::int AS count FROM quality_results r JOIN survey_responses s ON s.id=r.response_id WHERE r.status='NON CONFORME' GROUP BY s.interviewer ORDER BY count DESC LIMIT 30`),
    ...['village','healthArea','healthZone'].map(key=>pool.query(`SELECT coalesce(nullif(context->>$1,''),'Non renseigné') AS name,count(*)::int AS count FROM quality_results WHERE status='NON CONFORME' GROUP BY context->>$1 ORDER BY count DESC LIMIT 30`,[key])),
    pool.query(`SELECT q.label AS name,count(*)::int AS count FROM quality_results r JOIN questions q ON q.id=r.question_id WHERE r.status='NON CONFORME' GROUP BY q.id,q.label ORDER BY count DESC LIMIT 20`),
    pool.query(`SELECT to_char(s.last_modified_at::date,'YYYY-MM-DD') AS name,count(*)::int AS count FROM quality_results r JOIN survey_responses s ON s.id=r.response_id WHERE r.status='NON CONFORME' AND s.last_modified_at IS NOT NULL GROUP BY s.last_modified_at::date ORDER BY s.last_modified_at::date DESC LIMIT 60`),
    pool.query(`SELECT to_char(last_modified_at::date,'YYYY-MM-DD') AS name,round(avg(quality_score),1)::float AS count FROM survey_responses WHERE last_modified_at IS NOT NULL AND quality_score IS NOT NULL GROUP BY last_modified_at::date ORDER BY last_modified_at::date DESC LIMIT 60`),
  ]);
  const extras=(await pool.query(`SELECT
    count(DISTINCT s.interviewer)::int AS interviewers,
    count(DISTINCT (s.version_id,r.context->>'village',r.context->>'healthArea',r.context->>'healthZone')) FILTER(WHERE error_type='Village répété')::int AS repeated_villages,
    count(*) FILTER(WHERE error_type='Doublon exact')::int AS exact_duplicates,
    count(*) FILTER(WHERE error_type IN ('Doublon probable','Doublon potentiel'))::int AS possible_duplicates
    FROM quality_results r JOIN survey_responses s ON s.id=r.response_id WHERE r.status='NON CONFORME'`)).rows[0];
  res.json({summary:{...summary.rows[0],...extras},severity:severity.rows,missing:missing.rows[0],types:types.rows,interviewers:interviewers.rows,villages:villages.rows,areas:areas.rows,zones:zones.rows,questions:questions!.rows,trend:trend!.rows.reverse(),scores:scores!.rows.reverse()});
}));
intelligenceRoutes.get('/intelligence/types',asyncRoute(async(_req,res)=>{
  res.json((await pool.query(`SELECT q.id,q.variable_name,q.label,q.type,a.detected_types->>q.id::text AS detected_type
    FROM questions q LEFT JOIN quality_analysis a ON a.version_id=q.version_id ORDER BY q.variable_name LIMIT 5000`)).rows);
}));
