import { AppError } from './errors.js';
import { config } from './config.js';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const text = (v: unknown): string => v == null ? '' : String(v);
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type RemoteQuestionnaire = { externalId: string; version: number; title: string; variable: string; identity: string; metadata: Obj };
export type RemoteSection = { externalId: string; parentExternalId: string | null; title: string; variableName: string; enablingCondition: string | null; isRoster: boolean; position: number };
export type RemoteQuestion = { required: boolean; externalId: string; sectionExternalId: string | null; variableName: string; label: string; type: string; options: { value: string; text: string }[]; constraints: unknown[]; minValue: number | null; maxValue: number | null; enablingCondition: string | null; isRoster: boolean; position: number };
export type RemoteInterview = { externalId: string; interviewer: string | null; supervisor: string | null; status: string; lastModifiedAt: string | null };
export type AnswerInstance = { value: unknown; rosterVector: number[]; questionId: string | null };
export type AnswerMap = Record<string, AnswerInstance[]>;

// SuSo: $type=Group, NumericQuestion, TextQuestion, SingleQuestion, MultyOptionsQuestion...
const questionTypes: Record<number, string> = { 0: 'SÉLECTION SIMPLE', 3: 'SÉLECTION MULTIPLE', 4: 'NUMÉRIQUE', 5: 'DATE', 6: 'GPS', 7: 'TEXTE', 9: 'LISTE', 10: 'CODE-BARRES', 11: 'PHOTO', 12: 'GÉOGRAPHIE', 13: 'AUDIO' };
const questionKindTypes: Record<string, string> = {
  singlequestion: 'SÉLECTION SIMPLE', multioptionsquestion: 'SÉLECTION MULTIPLE', multyoptionsquestion: 'SÉLECTION MULTIPLE',
  numericquestion: 'NUMÉRIQUE', datetimequestion: 'DATE', gpscoordinatequestion: 'GPS', textquestion: 'TEXTE',
  textlistquestion: 'LISTE', qrbarcodequestion: 'CODE-BARRES', multimediaquestion: 'PHOTO', audioquestion: 'AUDIO', areaquestion: 'GÉOGRAPHIE',
};
function simpleBound(expressions: unknown[], variable: string, direction: 'min' | 'max'): number | null {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable)) return null;
  const pattern = new RegExp(`^\\s*${variable}\\s*${direction === 'min' ? '(?:>=|>)' : '(?:<=|<)'}\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`, 'i');
  for (const item of expressions) {
    const match = text(read(obj(item), 'Expression')).match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

// Survey Solutions emits PascalCase JSON with a $type discriminator. Some
// proxies/serializers convert it to camelCase, and some API versions wrap the
// questionnaire document in a `Document` property. Read known properties
// case-insensitively instead of assuming a single JSON spelling.
function read(source: Obj, name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  const key = Object.keys(source).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? source[key] : undefined;
}
function first(source: Obj, ...names: string[]): unknown {
  for (const name of names) {
    const value = read(source, name);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}
function stringValue(source: Obj, ...names: string[]): string { return text(first(source, ...names)); }
function responseField(source: Obj, ...names: string[]): unknown {
  let current: Obj = source;
  for (let depth = 0; depth < 4; depth++) {
    const value = first(current, ...names);
    if (value !== undefined) return value;
    const nested = first(current, 'Data', 'Result', 'Response');
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break;
    current = obj(nested);
  }
  return undefined;
}
function nodesOf(source: Obj): unknown[] | null {
  const children = first(source, 'Children', 'Items', 'Elements');
  return Array.isArray(children) ? children : null;
}

export function extractStructure(document: unknown): { sections: RemoteSection[]; questions: RemoteQuestion[] } {
  const sections: RemoteSection[] = [];
  const questions: RemoteQuestion[] = [];
  let position = 0;
  let visited = 0;
  const seen = new WeakSet<object>();

  function visit(nodeValue: unknown, parent: string | null, roster: boolean, parentCondition: string | null, depth: number) {
    if (depth > 100 || !nodeValue || typeof nodeValue !== 'object') return;
    if (seen.has(nodeValue)) return;
    seen.add(nodeValue);
    if (Array.isArray(nodeValue)) {
      for (const child of nodeValue) visit(child, parent, roster, parentCondition, depth + 1);
      return;
    }
    visited++;
    const node = obj(nodeValue);
    const kind = stringValue(node, '$type', 'obj_type', 'ObjectType');
    const typeValue = first(node, 'QuestionType');
    const typeNumber = typeof typeValue === 'number' ? typeValue : Number(typeValue);
    const variableName = stringValue(node, 'VariableName', 'variable_name', 'Variable', 'Name');
    const externalId = stringValue(node, 'PublicKey', 'public_key', 'Id', 'id');
    const children = nodesOf(node);
    const isGroup = kind.toLowerCase() === 'group' || (children !== null && !kind.toLowerCase().endsWith('question'));
    const ownCondition = stringValue(node, 'ConditionExpression', 'condition_expression') || null;
    const effectiveCondition = [parentCondition, ownCondition].filter(Boolean).join(' && ') || null;

    if (isGroup) {
      const ownRoster = first(node, 'IsRoster', 'is_roster') === true;
      // Wrapper/container objects without a PublicKey must not discard their
      // children; retain the nearest identified section as their parent.
      const sectionId = externalId || parent;
      if (externalId && (kind.toLowerCase() === 'group' || variableName || first(node, 'Title', 'title'))) {
        sections.push({ externalId, parentExternalId: parent,
          title: stringValue(node, 'Title', 'title', 'VariableName', 'variable_name') || 'Section',
          variableName, enablingCondition: effectiveCondition, isRoster: ownRoster, position: position++ });
      }
      const nextRoster = roster || ownRoster;
      if (children) for (const child of children) visit(child, sectionId, nextRoster, effectiveCondition, depth + 1);
      return;
    }

    const isQuestion = kind.toLowerCase().endsWith('question') || Number.isFinite(typeNumber);
    if (isQuestion && variableName) {
      const constraintsValue = first(node, 'ValidationConditions', 'validation_conditions', 'Constraints');
      const constraints = array(constraintsValue);
      const answerValue = first(node, 'Answers', 'answers', 'Options');
      const options = array(answerValue).map(item => obj(item)).map(item => ({
        value: text(first(item, 'AnswerValue', 'answer_value', 'Value', 'value')),
        text: text(first(item, 'AnswerText', 'answer_text', 'Text', 'text')),
      }));
      const mappedType = (Number.isFinite(typeNumber) ? questionTypes[typeNumber] : undefined) || questionKindTypes[kind.toLowerCase()];
      questions.push({
        externalId: externalId || variableName, sectionExternalId: parent, variableName,
        label: stringValue(node, 'QuestionText', 'question_text', 'VariableLabel', 'variable_label', 'Title', 'Label') || variableName,
        type: first(node, 'IsInteger') === true && mappedType === 'NUMÉRIQUE' ? 'ENTIER' : mappedType || kind || 'AUTRE', options, constraints,
        required: first(node, 'IsRequired', 'Required', 'is_required') === true,
        minValue: simpleBound(constraints, variableName, 'min'), maxValue: simpleBound(constraints, variableName, 'max'),
        enablingCondition: effectiveCondition, isRoster: roster, position: position++,
      });
    }

    // Traverse nested extension data even if this particular object is an
    // unrecognized wrapper. Metadata arrays without question/group markers are
    // ignored unless they contain recognizable descendants.
    if (children) for (const child of children) visit(child, parent, roster, effectiveCondition, depth + 1);
    else if (!isQuestion) {
      for (const wrapper of ['Document', 'Questionnaire', 'QuestionnaireDocument', 'Structure', 'Content', 'Root']) {
        const nested = first(node, wrapper);
        if (nested && typeof nested === 'object') visit(nested, parent, roster, effectiveCondition, depth + 1);
      }
    }
  }

  function visitDocumentRoot(value: unknown, depth = 0): boolean {
    if (depth > 10 || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const root = obj(value);
    const children = nodesOf(root);
    if (children) {
      for (const child of children) visit(child, null, false, null, depth + 1);
      return true;
    }
    for (const wrapper of ['Document', 'Questionnaire', 'QuestionnaireDocument', 'Structure', 'Content', 'Root']) {
      const nested = first(root, wrapper);
      if (nested && visitDocumentRoot(nested, depth + 1)) return true;
    }
    return false;
  }
  const hasQuestionnaireTree = visitDocumentRoot(document);
  if (!hasQuestionnaireTree) visit(document, null, false, null, 0);
  if (!questions.length) {
    const root = obj(document);
    const hasChildren = hasQuestionnaireTree || visited > 1 || nodesOf(root) !== null;
    throw new AppError(502, hasChildren ? 'QUESTIONS_NON_DÉTECTÉES' : 'DOCUMENT_INVALIDE',
      `Aucune question reconnue dans le document Survey Solutions (${visited} objets analysés). Vérifiez la version et la structure du document.`);
  }
  return { sections, questions };
}

export function mapInterviewAnswers(details: unknown): AnswerMap {
  const result: AnswerMap = {};
  const entries = first(obj(details), 'Answers', 'answers', 'Items');
  if (!Array.isArray(entries)) throw new AppError(502, 'ENTRETIEN_INVALIDE', 'Réponses Survey Solutions non reconnues.');
  for (const item of entries) {
    const answer = obj(item);
    const variable = stringValue(answer, 'VariableName', 'variable_name', 'Variable');
    if (!variable) continue;
    const identity = obj(first(answer, 'QuestionId', 'question_id'));
    const vector = array(first(identity, 'RosterVector', 'roster_vector')).map(Number).filter(Number.isInteger);
    (result[variable] ||= []).push({ value: first(answer, 'Answer', 'answer') ?? null, rosterVector: vector,
      questionId: first(identity, 'Id', 'id') ? stringValue(identity, 'Id', 'id') : null });
  }
  return result;
}

const REQUIRED_PATHS: Record<string, string> = {
  '/api/v1/questionnaires': 'get',
  '/api/v1/questionnaires/{id}/{version}/document': 'get',
  '/api/v1/interviews': 'get',
  '/api/v1/interviews/{id}': 'get',
};

export type ConnectionCheck = { version: string | null; api: string | null; compatible: boolean | null; warnings: string[] };

export class SurveySolutionsService {
  private readonly base: URL;
  constructor(url: string, private readonly username: string, private readonly password: string,
    private readonly workspace = 'primary', allowInsecureHttp = false) {
    let candidate: URL;
    try { candidate = new URL(url.trim()); } catch { throw new AppError(400, 'URL_INVALIDE', 'URL Survey Solutions invalide.'); }
    if (!['https:', 'http:'].includes(candidate.protocol) || candidate.username || candidate.password || candidate.search || candidate.hash) {
      throw new AppError(400, 'URL_INVALIDE', 'Saisissez l’URL racine HTTP(S) du serveur HQ, sans identifiants, paramètres ni espace de travail dans l’URL.');
    }
    if (candidate.protocol === 'http:' && !allowInsecureHttp && !config.allowHttp) {
      throw new AppError(400, 'HTTP_NON_AUTORISÉ', 'Serveur HTTP non chiffré : cochez l’autorisation explicite dans le formulaire, ou utilisez HTTPS.');
    }
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(workspace)) throw new AppError(400, 'WORKSPACE_INVALIDE', 'Nom de l’espace de travail invalide.');
    if (!username || !password) throw new AppError(400, 'IDENTIFIANTS_MANQUANTS', 'Identifiants API manquants.');
    candidate.pathname = candidate.pathname.replace(/\/+$/, '');
    this.base = candidate;
  }
  private async rawRequest(path: string, authenticated: boolean): Promise<Response> {
    const url = new URL(`${this.base.pathname.replace(/\/+$/, '')}${path}`, this.base.origin);
    // Ne jamais suivre une redirection avec Basic Auth : elle pourrait mener à un autre serveur.
    console.info('[survey-api] Requête', { method: 'GET', url: url.toString(), authentication: authenticated ? 'Basic (secret masqué)' : 'aucune' });
    try {
      const response = await fetch(url, { method:'GET', redirect:'manual', signal:AbortSignal.timeout(15000), headers: {
        Accept: authenticated ? 'application/json' : 'text/html, application/json',
        ...(authenticated ? {Authorization:`Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`} : {}),
      } });
      console.info('[survey-api] Réponse HTTP', { status: response.status, contentType: response.headers.get('content-type') || 'inconnu' });
      return response;
    } catch {
      const local = ['localhost','127.0.0.1','::1'].includes(this.base.hostname);
      throw new AppError(502, 'SERVEUR_INACCESSIBLE', local
        ? 'Adresse localhost inaccessible depuis le conteneur backend : utilisez l’adresse réseau du serveur HQ joignable depuis Docker.'
        : 'Serveur Survey Solutions inaccessible depuis le backend. Vérifiez son adresse, le réseau, le port et, en HTTPS, le certificat.');
    }
  }
  private async request(path: string): Promise<Response> {
    const response = await this.rawRequest(path, true);
    if (response.status === 401) throw new AppError(502, 'AUTH_API',
      'L’API refuse l’authentification (HTTP 401). Vérifiez le compte API et la transmission de l’en-tête Authorization par le serveur intermédiaire.');
    if (response.status === 403) throw new AppError(502, 'ACCÈS_WORKSPACE',
      `Accès refusé (HTTP 403) à l’espace « ${this.workspace} ». Vérifiez les droits du compte API sur cet espace et les éventuelles règles du serveur intermédiaire.`);
    if (response.status >= 300 && response.status < 400) throw new AppError(502, 'REDIRECTION_API',
      'L’API redirige la requête. Saisissez directement l’URL finale du serveur HQ (HTTPS si exigé), sans espace de travail ni /api dans l’URL.');
    if (response.status === 404) throw new AppError(502, 'ROUTE_API_ABSENTE',
      'Route API introuvable (HTTP 404). Vérifiez l’URL racine du HQ, l’espace de travail et la version de son API dans /apidocs/index.html.');
    if (!response.ok) throw new AppError(502, `API_${response.status}`, `Erreur API Survey Solutions (HTTP ${response.status}). Vérifiez le serveur et sa documentation.`);
    const size = Number(response.headers.get('content-length'));
    if (size > 15_000_000) throw new AppError(502, 'RÉPONSE_TROP_GRANDE', 'Réponse Survey Solutions trop volumineuse.');
    return response;
  }
  private async json(path: string): Promise<Obj> {
    const response = await this.request(path);
    try {
      const body = await response.text();
      if (body.length > 15_000_000) throw new Error('large');
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      const result = parsed as Obj;
      const arrays = Object.fromEntries(Object.entries(result).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length]));
      console.info('[survey-api] Structure JSON', { fields: Object.keys(result), arrayCounts: arrays });
      return result;
    } catch { throw new AppError(502, 'RÉPONSE_INVALIDE', 'Réponse JSON Survey Solutions invalide.'); }
  }
  private async optionalText(path: string, limit: number): Promise<string | null> {
    try {
      const response = await this.rawRequest(path, false);
      if (!response.ok || Number(response.headers.get('content-length')) > limit) return null;
      const body = await response.text();
      return body.length <= limit ? body : null;
    } catch { return null; }
  }
  private workspacePath(path: string) { return `/${encodeURIComponent(this.workspace)}${path}`; }
  async testConnection(): Promise<ConnectionCheck> {
    // Tester D'ABORD une route API authentifiée dans le bon workspace. Une page de
    // connexion publique ou Swagger peuvent refuser les comptes API, même valides.
    const list = await this.json(this.workspacePath('/api/v1/questionnaires?limit=1&offset=1'));
    if (!Array.isArray(responseField(list, 'Questionnaires', 'questionnaires', 'items'))) throw new AppError(502, 'API_INCOMPATIBLE', `La réponse de l’API questionnaires n’a pas la structure attendue (champs: ${Object.keys(list).join(', ') || 'aucun'}).`);

    const warnings: string[] = [];
    let version: string | null = null, api: string | null = null, compatible: boolean | null = null;
    // Ces deux sondes sont informatives et sans identifiants. Elles ne doivent
    // jamais annuler une authentification déjà prouvée par l'API du workspace.
    const [html, swaggerText] = await Promise.all([
      this.optionalText('/Account/LogOn', 150_000), this.optionalText('/swagger/v1/swagger.json', 5_000_000),
    ]);
    if (html) version = (html.match(/appVersion["']?\s*:\s*["']([^"']{3,80})["']/i)?.[1]
      || html.match(/id=["']appVersion["'][^>]*>([^<]{3,80})</i)?.[1] || '').trim() || null;
    if (!version) warnings.push('Version du logiciel non détectée : consultez la page et la documentation API de votre serveur.');
    if (swaggerText) {
      try {
        const swagger = obj(JSON.parse(swaggerText) as unknown), paths = obj(swagger.paths);
        if (Object.keys(paths).length) {
          api = text(obj(swagger.info).version) || null;
          const missing = Object.entries(REQUIRED_PATHS).filter(([route,method]) => !obj(paths[route])[method]);
          compatible = missing.length === 0;
          if (missing.length) warnings.push('La documentation du serveur ne contient pas toutes les routes nécessaires à la synchronisation ; vérifiez sa version API.');
        }
      } catch { /* Documentation facultative et potentiellement indisponible. */ }
    }
    if (compatible === null) warnings.push('Swagger indisponible ou non reconnu : la compatibilité des autres routes de synchronisation reste à confirmer.');
    return { version, api, compatible, warnings };
  }
  async listQuestionnaires(): Promise<RemoteQuestionnaire[]> {
    const all: RemoteQuestionnaire[] = [];
    for (let page = 1; page <= 1000; page++) {
      const data = await this.json(this.workspacePath(`/api/v1/questionnaires?limit=40&offset=${page}`));
      const records = responseField(data, 'Questionnaires', 'questionnaires', 'items');
      if (!Array.isArray(records)) throw new AppError(502, 'API_INCOMPATIBLE', `Liste des questionnaires non reconnue (champs: ${Object.keys(data).join(', ') || 'aucun'}).`);
      for (const raw of records) {
        const q = obj(raw), externalId = stringValue(q, 'QuestionnaireId', 'questionnaireId', 'Id', 'id'), version = Number(first(q, 'Version', 'version'));
        if (!UUID.test(externalId) || !Number.isSafeInteger(version) || version < 1) throw new AppError(502, 'API_INCOMPATIBLE', 'Identité de questionnaire Survey Solutions invalide.');
        all.push({ externalId, version, title: stringValue(q, 'Title', 'title') || 'Sans titre', variable: stringValue(q, 'Variable', 'variable'), identity: stringValue(q, 'QuestionnaireIdentity', 'questionnaireIdentity') || `${externalId}$${version}`, metadata: q });
      }
      const total = Number(responseField(data, 'TotalCount', 'totalCount'));
      if (records.length < 40 || (Number.isFinite(total) && all.length >= total)) return all;
    }
    throw new AppError(502, 'PAGINATION', 'Trop de pages de questionnaires.');
  }
  async document(questionnaireId: string, version: number): Promise<Obj> {
    if (!UUID.test(questionnaireId) || !Number.isSafeInteger(version) || version < 1) throw new AppError(400, 'IDENTITÉ_INVALIDE', 'Questionnaire invalide.');
    return this.json(this.workspacePath(`/api/v1/questionnaires/${questionnaireId}/${version}/document`));
  }
  async listInterviews(questionnaireId: string, version: number): Promise<RemoteInterview[]> {
    const found: RemoteInterview[] = [];
    for (let page = 1; page <= 1000; page++) {
      const params = new URLSearchParams({ questionnaireId, questionnaireVersion: String(version), pageSize: '100', page: String(page) });
      const data = await this.json(this.workspacePath(`/api/v1/interviews?${params}`));
      const records = responseField(data, 'Interviews', 'interviews', 'items');
      if (!Array.isArray(records)) throw new AppError(502, 'API_INCOMPATIBLE', `Liste des entretiens non reconnue (champs: ${Object.keys(data).join(', ') || 'aucun'}).`);
      for (const raw of records) {
        const item = obj(raw), externalId = stringValue(item, 'InterviewId', 'interviewId', 'Id', 'id');
        if (!UUID.test(externalId)) throw new AppError(502, 'API_INCOMPATIBLE', 'Identifiant d’entretien invalide.');
        const responsible = first(item, 'ResponsibleName', 'responsibleName');
        const supervisor = first(item, 'SupervisorName', 'supervisorName');
        const modified = first(item, 'LastEntryDate', 'lastEntryDate');
        found.push({ externalId, interviewer: responsible ? text(responsible) : null,
          supervisor: supervisor ? text(supervisor) : null,
          status: stringValue(item, 'Status', 'status'), lastModifiedAt: modified ? text(modified) : null });
      }
      const total = Number(responseField(data, 'TotalCount', 'totalCount'));
      if (records.length < 100 || (Number.isFinite(total) && found.length >= total)) return found;
    }
    throw new AppError(502, 'PAGINATION', 'Trop de pages d’entretiens.');
  }
  /** Optionnel : le schéma GraphQL SuSo expose supervisorName, absent du listing REST v1.
   * Si l'installation ne propose pas ce champ, conserver les entretiens REST sans inventer de superviseur. */
  async enrichInterviews(interviews: RemoteInterview[], questionnaireId: string, version: number): Promise<RemoteInterview[]> {
    if (!interviews.length) return interviews;
    const found = new Map<string, { supervisor: string | null; responsible: string | null; role: string }>();
    try {
      for (let skip = 0; skip < interviews.length && skip < 100000; skip += 100) {
        const query = `query { interviews(workspace: "${this.workspace}", skip: ${skip}, take: 100, where: { questionnaireId: { eq: "${questionnaireId}" }, questionnaireVersion: { eq: ${version} } }) { nodes { id responsibleName responsibleRole supervisorName } } }`;
        const url = new URL(`${this.base.pathname.replace(/\/+$/, '')}/graphql`, this.base.origin);
        const response = await fetch(url, {method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
          'Content-Type':'application/json',Accept:'application/json',
        },body:JSON.stringify({query})});
        if (!response.ok || response.status >= 300) return interviews;
        const payload = obj(await response.json());
        if (Array.isArray(payload.errors)) return interviews;
        const nodes = obj(obj(payload.data).interviews).nodes;
        if (!Array.isArray(nodes)) return interviews;
        for (const raw of nodes) {
          const item = obj(raw), id = text(item.id).replace(/-/g,'').toLowerCase();
          if (id) found.set(id,{supervisor:item.supervisorName ? text(item.supervisorName) : null,
            responsible:item.responsibleName ? text(item.responsibleName) : null,role:text(item.responsibleRole)});
        }
        if (nodes.length < 100) break;
      }
    } catch { return interviews; }
    return interviews.map(item => {
      const extra = found.get(item.externalId.replace(/-/g,'').toLowerCase());
      return extra ? {...item, supervisor:extra.supervisor || item.supervisor,
        interviewer:extra.role ? (extra.role.toLowerCase()==='interviewer' ? extra.responsible || item.interviewer : null) : item.interviewer} : item;
    });
  }
  async interviewAnswers(id: string): Promise<AnswerMap> {
    if (!UUID.test(id)) throw new AppError(400, 'IDENTITÉ_INVALIDE', 'Entretien invalide.');
    return mapInterviewAnswers(await this.json(this.workspacePath(`/api/v1/interviews/${id}`)));
  }
}
