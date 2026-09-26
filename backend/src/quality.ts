import { analyze, settingsSchema, qualityScore, classification, type Question, type Response } from './intelligence.js';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { pool } from './db.js';
import { AppError } from './errors.js';
import type { AnswerInstance, AnswerMap } from './survey-solutions.service.js';

export const ruleTypes = ['min','max','range','equals','not_equals','allowed','required','format','min_length','max_length','compare','consistency','duplicate'] as const;
export type RuleType = typeof ruleTypes[number];
const value = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const uuid = z.string().uuid();
const numeric = z.number().finite();
const schemas: Record<RuleType, z.ZodTypeAny> = {
  min: z.object({ value: numeric }), max: z.object({ value: numeric }),
  range: z.object({ min: numeric, max: numeric }).refine(x => x.min <= x.max, 'Le minimum doit etre <= au maximum.'),
  equals: z.object({ value }), not_equals: z.object({ value }),
  allowed: z.object({ values: z.array(value).min(1).max(100) }),
  required: z.object({}),
  format: z.object({ kind: z.enum(['integer','decimal','date','phone','email','text']) }),
  min_length: z.object({ value: z.number().int().min(0).max(10000) }),
  max_length: z.object({ value: z.number().int().min(0).max(10000) }),
  compare: z.object({ otherQuestionId: uuid, operator: z.enum(['<','<=','>','>=','==','!=']) }),
  consistency: z.object({ whenQuestionId: uuid, operator: z.enum(['==','!=']), value }),
  duplicate: z.object({ questionIds: z.array(uuid).min(1).max(10) }),
};
export const rulePayload = z.object({ questionId: uuid, type: z.enum(ruleTypes), params: z.unknown(), active: z.boolean().default(true) }).strict();
export function parseRule(payload: unknown) {
  const data = rulePayload.parse(payload);
  return { ...data, params: schemas[data.type].parse(data.params) as Record<string, unknown> };
}
export async function validateReferences(client: pg.PoolClient, rule: ReturnType<typeof parseRule>, excludeId?: string) {
  const target = await client.query('SELECT version_id FROM questions WHERE id=$1', [rule.questionId]);
  if (!target.rowCount) throw new AppError(404, 'QUESTION_ABSENTE', 'Question introuvable.');
  const params = rule.params;
  const refs = rule.type === 'compare' ? [params.otherQuestionId] :
    rule.type === 'consistency' ? [params.whenQuestionId] : rule.type === 'duplicate' ? params.questionIds : [];
  for (const id of refs as string[]) {
    if (id === rule.questionId || id === excludeId) throw new AppError(400, 'QUESTION_INVALIDE', 'Sélectionnez une autre question.');
    const other = await client.query('SELECT version_id FROM questions WHERE id=$1', [id]);
    if (!other.rowCount || other.rows[0].version_id !== target.rows[0].version_id) throw new AppError(400, 'QUESTION_INVALIDE', 'Les questions liées doivent appartenir à la même version du questionnaire.');
  }
  return target.rows[0].version_id as string;
}

export type QualityQuestion = { id: string; variable_name: string; type: string; enabling_condition: string | null; is_roster: boolean; label?: string };
export type QualityRule = { id: string; question_id: string; type: RuleType; params: Record<string, any> };
export type QualityResponse = { id: string; external_id: string; answers: AnswerMap };
export type RuleResult = { status: 'CONFORME' | 'NON CONFORME' | 'NON CONTRÔLÉ'; errorType: string | null; details: string };
const passed = (message = 'Contrôle réussi.') : RuleResult => ({ status: 'CONFORME', errorType: null, details: message });
const failed = (type: string, message: string): RuleResult => ({ status: 'NON CONFORME', errorType: type, details: message });
const unchecked = (message = 'Réponse absente ou question non applicable.') : RuleResult => ({ status: 'NON CONTRÔLÉ', errorType: null, details: message });
const empty = (v: unknown) => v == null || typeof v === 'string' && !v.trim() || Array.isArray(v) && !v.length;
const same = (a: unknown, b: unknown) => String(a).trim() === String(b).trim();
const number = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !/^-?(?:\d+)(?:[.,]\d+)?$/.test(v.trim())) return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
function evaluateFormat(kind: string, input: unknown): boolean {
  const str = String(input).trim();
  switch (kind) {
    case 'integer': return /^-?\d+$/.test(str);
    case 'decimal': return number(input) !== null;
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(str)) return false;
      const date = new Date(str);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === str.slice(0, 10);
    }
    case 'phone': return /^\+?[0-9][0-9 .()\-]{6,18}$/.test(str);
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    case 'text': return typeof input === 'string';
    default: return false;
  }
}
function getAnswers(response: QualityResponse, question: QualityQuestion): AnswerInstance[] {
  const entries = response.answers[question.variable_name];
  return Array.isArray(entries) ? entries : [];
}
function findRelated(response: QualityResponse, target: QualityQuestion | undefined, vector: number[]): AnswerInstance | undefined {
  if (!target) return undefined;
  const entries = getAnswers(response, target);
  return entries.find(e => JSON.stringify(e.rosterVector) === JSON.stringify(vector)) || (vector.length ? entries.find(e => !e.rosterVector.length) : undefined);
}
function compareValues(a: unknown, b: unknown, op: string): boolean | null {
  if (op === '==') return same(a,b);
  if (op === '!=') return !same(a,b);
  const left = number(a), right = number(b);
  if (left === null || right === null) return null;
  return op === '<' ? left < right : op === '<=' ? left <= right : op === '>' ? left > right : left >= right;
}

/** Evaluation deterministic, without executing Survey Solutions C# expressions. */
export function evaluateRule(rule: QualityRule, question: QualityQuestion, response: QualityResponse,
  byId: Map<string, QualityQuestion>, current: AnswerInstance | undefined, duplicateOf?: string): RuleResult {
  const p = rule.params, v = current?.value;
  const title = question.label || question.variable_name;
  if (rule.type === 'consistency') {
    const trigger = findRelated(response, byId.get(p.whenQuestionId), current?.rosterVector || []);
    if (!trigger || empty(trigger.value)) return unchecked('Condition non vérifiable : question déclenchante absente.');
    if (!compareValues(trigger.value, p.value, p.operator)) return unchecked('Condition non déclenchée.');
    return empty(v) ? failed('Incohérence dans les réponses', `« ${title} » est vide alors que « ${byId.get(p.whenQuestionId)?.label || byId.get(p.whenQuestionId)?.variable_name} » contient « ${trigger.value} » et nécessite une réponse.`) : passed('Cohérence vérifiée.');
  }
  if (rule.type === 'required') {
    if (!empty(v)) return passed('Valeur renseignée.');
    // Skip logic et taille des rosters sont des expressions C# non evaluees ici.
    if (question.enabling_condition || question.is_roster) return unchecked('Question conditionnelle ou dans un roster : applicabilité inconnue.');
    return failed('Information manquante', `« ${title} » est obligatoire mais aucune réponse n’a été renseignée.`);
  }
  if (empty(v)) return unchecked();
  if (rule.type === 'duplicate') return duplicateOf ? failed('Doublon potentiel', `Valeurs identiques à l’entretien ${duplicateOf}.`) : passed('Aucun doublon détecté.');
  if (rule.type === 'compare') {
    const other = findRelated(response, byId.get(p.otherQuestionId), current?.rosterVector || []);
    if (!other || empty(other.value)) return unchecked('Question comparée absente.');
    const ok = compareValues(v, other.value, p.operator);
    if (ok === null) return failed('Format incorrect', `La réponse « ${v} » à « ${title} » ne peut pas être comparée numériquement à « ${other.value} ».`);
    return ok ? passed('Comparaison respectée.') : failed('Valeurs incohérentes', `« ${title} » contient « ${v} » et « ${byId.get(p.otherQuestionId)?.label || byId.get(p.otherQuestionId)?.variable_name} » contient « ${other.value} ». La première valeur devrait être ${{'<':'inférieure à','<=':'inférieure ou égale à','>':'supérieure à','>=':'supérieure ou égale à','==':'égale à','!=':'différente de'}[p.operator as string]} la seconde.`);
  }
  if (rule.type === 'format') return evaluateFormat(p.kind, v) ? passed('Format valide.') : failed('Format incorrect', `La réponse « ${v} » à « ${title} » ${p.kind === 'phone' ? 'ne correspond pas à un numéro de téléphone valide' : 'ne respecte pas le format attendu'}.`);
  if (rule.type === 'min_length' || rule.type === 'max_length') {
    const size = String(v).length, ok = rule.type === 'min_length' ? size >= p.value : size <= p.value;
    return ok ? passed('Longueur conforme.') : failed('Longueur incorrecte', `« ${title} » contient ${size} caractères, alors que ${rule.type === 'min_length' ? 'au moins' : 'au plus'} ${p.value} sont attendus.`);
  }
  if (rule.type === 'equals') return same(v,p.value) ? passed() : failed('Valeur inattendue', `« ${title} » contient « ${v} », alors que la réponse attendue est « ${p.value} ».`);
  if (rule.type === 'not_equals') return !same(v,p.value) ? passed() : failed('Valeurs identiques inattendues', `« ${title} » contient « ${v} », alors qu’une valeur différente est attendue.`);
  if (rule.type === 'allowed') {
    const parts = Array.isArray(v) ? v : question.type === 'SÉLECTION MULTIPLE' && typeof v === 'string' ? v.split(',').map(s => s.trim()) : [v];
    return parts.every(item => p.values.some((allow: unknown) => same(allow,item))) ? passed() : failed('Valeur non autorisée', `La réponse « ${v} » n’est pas une valeur reconnue pour « ${title} ».`);
  }
  const n = number(v);
  if (n === null) return failed('Format incorrect', `La réponse « ${v} » à « ${title} » doit être numérique.`);
  const ok = rule.type === 'min' ? n >= p.value : rule.type === 'max' ? n <= p.value : n >= p.min && n <= p.max;
  const detail = rule.type === 'min' ? `Minimum ${p.value}` : rule.type === 'max' ? `Maximum ${p.value}` : `Entre ${p.min} et ${p.max}`;
  return ok ? passed(detail) : failed('Valeur hors plage', `« ${title} » contient ${v}. Cette valeur est en dehors de la plage attendue (${detail.toLowerCase()}).`);
}

function duplicateKey(rule: QualityRule, anchor: QualityQuestion, response: QualityResponse, byId: Map<string, QualityQuestion>): string | null {
  const keys = [anchor.id, ...(rule.params.questionIds as string[])].map(id => byId.get(id));
  if (keys.some(k => !k)) return null;
  const values = keys.map(q => getAnswers(response, q!));
  if (values.some(a => a.length !== 1 || empty(a[0]?.value) || a[0]?.rosterVector.length)) return null;
  const canonical = (v:unknown):unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])) : String(v).trim().toLowerCase();
  return JSON.stringify(values.map(a => canonical(a[0]!.value)));
}

export async function reanalyzeVersion(versionId: string, transaction?: pg.PoolClient) {
  const own = !transaction;
  const client = transaction || await pool.connect();
  try {
    if (own) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    const questions = (await client.query('SELECT id, variable_name, label, type, options, min_value, max_value, is_required, enabling_condition, is_roster FROM questions WHERE version_id=$1 ORDER BY id', [versionId])).rows as Question[];
    const byId = new Map(questions.map(q => [q.id,q]));
    const rules = (await client.query(`SELECT r.id, r.question_id, r.type, r.params FROM quality_rules r JOIN questions q ON q.id=r.question_id
       WHERE q.version_id=$1 AND r.active=true ORDER BY r.created_at,r.id`, [versionId])).rows as QualityRule[];
    const responses = (await client.query('SELECT id, external_id, answers, interviewer, supervisor, last_modified_at FROM survey_responses WHERE version_id=$1 ORDER BY last_modified_at NULLS LAST, external_id', [versionId])).rows as Response[];
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [versionId]);
    const settings = settingsSchema.parse((await client.query('SELECT settings FROM quality_settings WHERE id=1')).rows[0]?.settings || {});
    const fingerprint = createHash('sha256').update(JSON.stringify({engine:3, questions,rules,responses,settings})).digest('hex');
    const previous = (await client.query('SELECT fingerprint FROM quality_analysis WHERE version_id=$1',[versionId])).rows[0];
    if(previous?.fingerprint === fingerprint) {
      if(own) await client.query('COMMIT');
      return {interviews:responses.length,controls:rules.length,cached:true};
    }
    await client.query('DELETE FROM quality_results WHERE response_id IN (SELECT id FROM survey_responses WHERE version_id=$1)', [versionId]);
    const duplicateFirst = new Map<string, string>();
    const manualChecked = new Set<string>();
    for (const response of responses) {
      let hasPass = false, hasFail = false;
      for (const rule of rules) {
        const question = byId.get(rule.question_id);
        if (!question) continue;
        const instances = getAnswers(response, question);
        let firstId: string | undefined;
        if (rule.type === 'duplicate') {
          const key = duplicateKey(rule, question, response, byId);
          if (key !== null) {
            const index = `${rule.id}:${key}`;
            firstId = duplicateFirst.get(index);
            if (!firstId) duplicateFirst.set(index, response.external_id);
          }
        }
        for (const instance of instances.length ? instances : [undefined]) {
          const checked = rule.type === 'duplicate' && !duplicateKey(rule, question, response, byId)
            ? unchecked('Critères de doublon absents ou multiples.')
            : evaluateRule(rule, question, response, byId, instance, firstId);
          if (checked.status !== 'NON CONTRÔLÉ') manualChecked.add(response.id);
          if (checked.status === 'CONFORME') hasPass = true;
          if (checked.status === 'NON CONFORME') hasFail = true;
          const instanceKey = instance?.rosterVector?.length ? instance.rosterVector.join('/') : '';
          await client.query(`INSERT INTO quality_results(id,response_id,question_id,rule_id,instance_key,value,status,error_type,details)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [randomUUID(), response.id, question.id, rule.id, instanceKey, instance ? JSON.stringify(instance.value ?? null) : null, checked.status, checked.errorType, checked.details]);
        }
      }
      await client.query('UPDATE survey_responses SET status=$1,analyzed_at=now() WHERE id=$2', [hasFail ? 'NON CONFORME' : hasPass ? 'CONFORME' : 'NON CONTRÔLÉ', response.id]);
    }
    const automatic = analyze(questions,responses,settings);
    // An explicit manual control takes precedence over an automatic control of the same family.
    const family:Record<string,string[]>={format:['format'],range:['min','max','range'],required:['required'],allowed:['allowed']};
    automatic.findings=automatic.findings.filter(f=>!rules.some(r=>r.question_id===f.questionId&&family[f.check]?.includes(r.type)));
    for(const r of responses)await client.query(`UPDATE quality_results SET context=$2 WHERE response_id=$1 AND rule_id IS NOT NULL`,[r.id,JSON.stringify(automatic.contexts.get(r.id))]);
    for(let i=0;i<automatic.findings.length;i+=500) {
      const batch=automatic.findings.slice(i,i+500).map(f=>({...f,id:randomUUID()}));
      await client.query(`INSERT INTO quality_results(id,response_id,question_id,instance_key,value,status,error_type,details,occurrence,severity,context,related,automatic_check)
        SELECT (x->>'id')::uuid,(x->>'responseId')::uuid,(x->>'questionId')::uuid,x->>'instance',x->'value','NON CONFORME',x->>'status',x->>'details',
        (x->>'occurrence')::int,x->>'severity',x->'context',x->'related',x->>'check' FROM jsonb_array_elements($1::jsonb) x`,[JSON.stringify(batch)]);
    }
    const errors=(await client.query(`SELECT response_id,array_agg(severity) AS severities FROM quality_results
      WHERE status='NON CONFORME' AND response_id IN (SELECT id FROM survey_responses WHERE version_id=$1) GROUP BY response_id`,[versionId])).rows;
    const severityById=new Map(errors.map(r=>[r.response_id,r.severities as string[]]));
    for(const r of responses) {
      const severities=severityById.get(r.id)||[],score=qualityScore(severities);
      const applicable=automatic.checkedIds.has(r.id) || manualChecked.has(r.id);
      await client.query('UPDATE survey_responses SET quality_score=$2,quality_class=$3,status=$4,analyzed_at=now() WHERE id=$1',
        [r.id,applicable?score:null,applicable?classification(score):'Non évalué',severities.length?'NON CONFORME':applicable?'CONFORME':'NON CONTRÔLÉ']);
    }
    await client.query(`INSERT INTO quality_analysis(version_id,fingerprint,checked,missing_count,eligible,detected_types)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(version_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,checked=EXCLUDED.checked,
      missing_count=EXCLUDED.missing_count,eligible=EXCLUDED.eligible,detected_types=EXCLUDED.detected_types,analyzed_at=now()`,
      [versionId,fingerprint,automatic.checked,automatic.missingCount,automatic.eligible,JSON.stringify(Object.fromEntries(automatic.types))]);
    if (own) await client.query('COMMIT');
    return { interviews: responses.length, controls: rules.length, anomalies:automatic.findings.length };
  } catch (error) { if (own) await client.query('ROLLBACK'); throw error; }
  finally { if (own) client.release(); }
}
