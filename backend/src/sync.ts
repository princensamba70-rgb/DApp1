import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { pool } from './db.js';
import { decrypt } from './crypto.js';
import { AppError } from './errors.js';
import { SurveySolutionsService, extractStructure, type RemoteQuestionnaire } from './survey-solutions.service.js';
import { reanalyzeVersion } from './quality.js';
import { auditSystem } from './audit.js';

export type SurveyConfig = { server_url: string; workspace: string; allow_insecure_http: boolean; username_encrypted: string; password_encrypted: string; connection_status: string; server_version: string | null; last_tested_at: string | null; last_synced_at: string | null };
export async function storedConfig(): Promise<SurveyConfig | null> {
  return (await pool.query('SELECT server_url,workspace,allow_insecure_http,username_encrypted,password_encrypted,connection_status,server_version,last_tested_at,last_synced_at FROM survey_solutions_config WHERE id=1')).rows[0] || null;
}
export function serviceFromConfig(record: SurveyConfig): SurveySolutionsService {
  return new SurveySolutionsService(record.server_url, decrypt(record.username_encrypted), decrypt(record.password_encrypted), record.workspace, record.allow_insecure_http);
}
export function publicConfig(record: SurveyConfig | null) {
  return record ? { url: record.server_url, workspace: record.workspace, allowInsecureHttp: record.allow_insecure_http, hasCredentials: true,
    status: record.connection_status, serverVersion: record.server_version, lastTestedAt: record.last_tested_at, lastSyncedAt: record.last_synced_at }
    : { url: '', workspace: 'primary', allowInsecureHttp: false, hasCredentials: false, status: 'NON CONNECTÉ', serverVersion: null, lastTestedAt: null, lastSyncedAt: null };
}

async function storeVersion(client: pg.PoolClient, q: RemoteQuestionnaire, workspace: string, service: SurveySolutionsService) {
  console.info('[sync] Questionnaire sélectionné', { id: q.externalId, version: q.version, title: q.title });
  console.info('[sync] Récupération du document et des questions...');
  const doc = await service.document(q.externalId, q.version);
  const structure = extractStructure(doc);
  console.info('[sync] Questions détectées', { count: structure.questions.length, sections: structure.sections.length });
  const interviews = await service.enrichInterviews(await service.listInterviews(q.externalId, q.version), q.externalId, q.version);
  // Fetch en dehors de la transaction, dans des paquets modestes pour ne pas saturer le serveur HQ.
  const answerSets: { item: typeof interviews[number]; answers: Awaited<ReturnType<typeof service.interviewAnswers>> }[] = [];
  for (let i = 0; i < interviews.length; i += 4) {
    const batch = await Promise.all(interviews.slice(i, i + 4).map(async item => ({ item, answers: await service.interviewAnswers(item.externalId) })));
    answerSets.push(...batch);
  }
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(73451757)');
    const questionnaire = (await client.query(`INSERT INTO questionnaires(id,external_id,workspace,title,variable)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace,external_id) DO UPDATE SET title=EXCLUDED.title,variable=EXCLUDED.variable,status='SYNCHRONISÉ',last_synced_at=now() RETURNING id`,
      [randomUUID(), q.externalId, workspace, q.title, q.variable])).rows[0];
    const version = (await client.query(`INSERT INTO questionnaire_versions(id,questionnaire_id,version,identity,metadata)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(questionnaire_id,version) DO UPDATE SET identity=EXCLUDED.identity,metadata=EXCLUDED.metadata,last_synced_at=now() RETURNING id`,
      [randomUUID(), questionnaire.id, q.version, q.identity, JSON.stringify(q.metadata)])).rows[0];
    const sectionIds = new Map<string,string>();
    for (const sec of structure.sections) {
      const parentId = sec.parentExternalId ? sectionIds.get(sec.parentExternalId) || null : null;
      const row = (await client.query(`INSERT INTO sections(id,version_id,external_id,parent_id,title,variable_name,enabling_condition,is_roster,position)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(version_id,external_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,title=EXCLUDED.title,variable_name=EXCLUDED.variable_name,enabling_condition=EXCLUDED.enabling_condition,is_roster=EXCLUDED.is_roster,position=EXCLUDED.position RETURNING id`,
        [randomUUID(),version.id,sec.externalId,parentId,sec.title,sec.variableName,sec.enablingCondition,sec.isRoster,sec.position])).rows[0];
      sectionIds.set(sec.externalId, row.id);
    }
    for (const question of structure.questions) {
      await client.query(`INSERT INTO questions(id,version_id,section_id,external_id,variable_name,label,type,options,constraints,min_value,max_value,enabling_condition,is_roster,position,is_required)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(version_id,external_id) DO UPDATE SET section_id=EXCLUDED.section_id,variable_name=EXCLUDED.variable_name,label=EXCLUDED.label,type=EXCLUDED.type,options=EXCLUDED.options,constraints=EXCLUDED.constraints,min_value=EXCLUDED.min_value,max_value=EXCLUDED.max_value,enabling_condition=EXCLUDED.enabling_condition,is_roster=EXCLUDED.is_roster,position=EXCLUDED.position,is_required=EXCLUDED.is_required`,
        [randomUUID(), version.id, question.sectionExternalId ? sectionIds.get(question.sectionExternalId) || null : null,
          question.externalId,question.variableName,question.label,question.type,JSON.stringify(question.options),JSON.stringify(question.constraints),question.minValue,question.maxValue,question.enablingCondition,question.isRoster,question.position,question.required]);
    }
    for (const { item, answers } of answerSets) {
      const date = item.lastModifiedAt && !Number.isNaN(Date.parse(item.lastModifiedAt)) ? item.lastModifiedAt : null;
      await client.query(`INSERT INTO survey_responses(id,external_id,questionnaire_id,version_id,interviewer,supervisor,source_status,answers,last_modified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(version_id,external_id) DO UPDATE SET interviewer=EXCLUDED.interviewer,supervisor=EXCLUDED.supervisor,source_status=EXCLUDED.source_status,answers=EXCLUDED.answers,last_modified_at=EXCLUDED.last_modified_at,updated_at=now()`,
        [randomUUID(),item.externalId,questionnaire.id,version.id,item.interviewer,item.supervisor,item.status,JSON.stringify(answers),date]);
    }
    await reanalyzeVersion(version.id, client);
    await client.query('COMMIT');
    return { questionCount: structure.questions.length, responseCount: answerSets.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

let running = false;
export async function syncSurvey(questionnaireId?: string) {
  if (running) throw new AppError(409, 'SYNC_EN_COURS', 'Une synchronisation est déjà en cours.');
  running = true;
  let lockClient: pg.PoolClient | undefined;
  let locked = false, logId: string | null = null;
  try {
    lockClient = await pool.connect();
    const lock = await lockClient.query('SELECT pg_try_advisory_lock(73451755) AS locked');
    if (!lock.rows[0]?.locked) throw new AppError(409, 'SYNC_EN_COURS', 'Une synchronisation est déjà en cours.');
    locked = true;
    const saved = await storedConfig();
    if (!saved) throw new AppError(400, 'NON_CONFIGURÉ', 'Configurez la connexion Survey Solutions avant la synchronisation.');
    logId = randomUUID();
    await pool.query("INSERT INTO sync_logs(id,status) VALUES($1,'EN COURS')", [logId]);
    const service = serviceFromConfig(saved);
    const parsedUrl = new URL(saved.server_url);
    const serverUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, '')}`;
    console.info('[sync] Début synchronisation', { serverUrl, workspace: saved.workspace });
    console.info('[sync] Authentification Survey Solutions...');
    const compatibility = await service.testConnection();
    console.info('[sync] Connexion Survey Solutions réussie', { version: compatibility.version || 'non détectée', api: compatibility.api || 'non détectée' });
    if (compatibility.compatible === false) throw new AppError(502, 'VERSION_INCOMPATIBLE',
      'La documentation de ce serveur ne publie pas toutes les routes nécessaires. Vérifiez sa version dans /apidocs/index.html avant la synchronisation.');
    console.info('[sync] Récupération des questionnaires...');
    const list = await service.listQuestionnaires();
    console.info('[sync] Questionnaires récupérés', { count: list.length });
    const selected = questionnaireId ? list.filter(q => q.externalId === questionnaireId) : list;
    if (questionnaireId && !selected.length) throw new AppError(404, 'QUESTIONNAIRE_ABSENT', 'Questionnaire absent du serveur Survey Solutions.');
    console.info('[sync] Questionnaires sélectionnés', { count: selected.length });
    const summary = { questionnaires: selected.length, questions: 0, responses: 0, serverVersion: compatibility.version };
    for (const q of selected) {
      const db = await pool.connect();
      try {
        const count = await storeVersion(db, q, saved.workspace, service);
        summary.questions += count.questionCount;
        summary.responses += count.responseCount;
      } finally { db.release(); }
    }
    await pool.query(`UPDATE sync_logs SET status='TERMINÉ',questionnaires_count=$2,questions_count=$3,responses_count=$4,finished_at=now() WHERE id=$1`,
      [logId,summary.questionnaires,summary.questions,summary.responses]);
    await pool.query("UPDATE survey_solutions_config SET connection_status='CONNECTÉ',server_version=$1,last_tested_at=now(),last_synced_at=now() WHERE id=1", [compatibility.version]);
    await auditSystem('Synchronisation Survey Solutions', `${summary.questionnaires} questionnaires, ${summary.responses} entretiens`);
    console.info('[sync] Synchronisation réussie', summary);
    return summary;
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'INTERNE';
    if (code !== 'NON_CONFIGURÉ') console.error('[sync] Échec', { code, status: error instanceof AppError ? error.status : 500 });
    if (logId) {
      await pool.query("UPDATE sync_logs SET status='ÉCHEC',error_code=$2,finished_at=now() WHERE id=$1", [logId, code]).catch(() => {});
      if (error instanceof AppError && error.status === 502) await pool.query("UPDATE survey_solutions_config SET connection_status='ERREUR DE CONNEXION' WHERE id=1").catch(() => {});
    }
    throw error;
  } finally {
    if (locked && lockClient) await lockClient.query('SELECT pg_advisory_unlock(73451755)').catch(() => {});
    lockClient?.release(); running = false;
  }
}

let pending: NodeJS.Timeout | undefined;
export function scheduleSync(delayMs = 10000) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => { pending = undefined; syncSurvey().catch(() => {}); }, delayMs);
  pending.unref();
}
export function startPeriodicSync(minutes: number) {
  const timer = setInterval(() => { if (!running) syncSurvey().catch(() => {}); }, minutes * 60_000);
  timer.unref();
}
