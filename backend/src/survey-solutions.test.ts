import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from './config.js';
import { extractStructure, SurveySolutionsService } from './survey-solutions.service.js';

const originalAllowHttp = config.allowHttp;
const root = 'http://hq-test.invalid';
const workspace = 'sankurusaco';
const questionnairePath = `/${workspace}/api/v1/questionnaires`;
const service = () => new SurveySolutionsService(root, 'compte-api-test', 'secret-de-test', workspace, true);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});
const list = {Questionnaires:[], TotalCount:0};

beforeAll(() => { config.allowHttp = false; });
afterAll(() => { config.allowHttp = originalAllowHttp; });
afterEach(() => vi.unstubAllGlobals());

describe('connexion Survey Solutions sur un serveur HTTP privé', () => {
  it('refuse HTTP sans autorisation et accepte un consentement explicite', () => {
    expect(() => new SurveySolutionsService(root,'api','mot-de-passe-test',workspace)).toThrowError(/autorisation explicite/i);
    expect(service()).toBeInstanceOf(SurveySolutionsService);
  });

  it('valide les identifiants sur la route API du workspace, et non sur la page de connexion', async () => {
    const calls:{path:string;auth:boolean}[]=[];
    vi.stubGlobal('fetch',vi.fn(async (input:URL, options:RequestInit) => {
      const path=new URL(input).pathname;
      calls.push({path,auth:!!new Headers(options.headers).get('Authorization')});
      if (path===questionnairePath) return json(list);
      if (path==='/Account/LogOn') return new Response('<script>var appVersion: "26.09 (build 41860)";</script>',{status:200});
      if (path==='/swagger/v1/swagger.json') return json({info:{version:'v1'},paths:{
        '/api/v1/questionnaires':{get:{}},'/api/v1/questionnaires/{id}/{version}/document':{get:{}},
        '/api/v1/interviews':{get:{}},'/api/v1/interviews/{id}':{get:{}},
      }});
      return json({},404);
    }));
    const result=await service().testConnection();
    expect(result).toMatchObject({version:'26.09 (build 41860)',api:'v1',compatible:true,warnings:[]});
    expect(calls).toContainEqual({path:questionnairePath,auth:true});
    expect(calls.filter(x=>x.path!==questionnairePath).every(x=>!x.auth)).toBe(true);
  });

  it('confirme une API accessible même si page de connexion et Swagger sont fermés au compte API', async () => {
    vi.stubGlobal('fetch',vi.fn(async (input:URL) => new URL(input).pathname===questionnairePath ? json(list) : json({},403)));
    const result=await service().testConnection();
    expect(result).toMatchObject({version:null,api:null,compatible:null});
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    [401,'AUTH_API'],[403,'ACCÈS_WORKSPACE'],[404,'ROUTE_API_ABSENTE'],[302,'REDIRECTION_API'],
  ] as const)('distingue la réponse HTTP %s des mots de passe et des droits', async (status,code) => {
    vi.stubGlobal('fetch',vi.fn(async () => status===302 ? new Response(null,{status,headers:{Location:'https://autre-serveur.invalid/'}}) : json({},status)));
    await expect(service().testConnection()).rejects.toMatchObject({code});
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // aucune redirection avec Basic Auth
  });

  it('ne renvoie pas de mot de passe dans un message d’erreur 403', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => json({},403)));
    try { await service().testConnection(); throw new Error('Un refus était attendu.'); }
    catch(error) {
      expect(error).toMatchObject({code:'ACCÈS_WORKSPACE'});
      expect(String(error)).toContain(workspace);
      expect(String(error)).not.toContain('secret-de-test');
    }
  });

  it('explique pourquoi localhost ne désigne pas le HQ depuis Docker', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => {throw new Error('Détail réseau sensible');}));
    const local = new SurveySolutionsService('http://localhost:8099','api','secret-de-test',workspace,true);
    await expect(local.testConnection()).rejects.toMatchObject({code:'SERVEUR_INACCESSIBLE',message:expect.stringContaining('conteneur backend')});
  });

  it('signale distinctement une documentation qui ne couvre pas la synchronisation', async () => {
    vi.stubGlobal('fetch',vi.fn(async (input:URL) => {
      const path=new URL(input).pathname;
      if(path===questionnairePath)return json(list);
      if(path==='/swagger/v1/swagger.json')return json({info:{version:'v1'},paths:{'/api/v1/questionnaires':{get:{}}}});
      return new Response('Sans version',{status:200});
    }));
    const result=await service().testConnection();
    expect(result.compatible).toBe(false);
    expect(result.warnings.some(x=>x.includes('synchronisation'))).toBe(true);
  });
});

describe('normalisation du document questionnaire Survey Solutions', () => {
  const id = (suffix: string) => `22222222-2222-4222-8222-${suffix.padStart(12, '0')}`;

  it('détecte les questions officielles imbriquées, sections, rosters, conditions et options', () => {
    const parsed = extractStructure({
      $type: 'QuestionnaireDocument', PublicKey: id('1'), Title: 'Enquête', VariableName: 'survey',
      Children: [
        { $type: 'Group', PublicKey: id('2'), Title: 'Section', VariableName: 'section', Children: [
          { $type: 'SingleQuestion', QuestionType: 0, PublicKey: id('3'), VariableName: 'consent',
            QuestionText: 'Consentement ?', Answers: [{ AnswerValue: 1, AnswerText: 'Oui' }] },
          { $type: 'Group', PublicKey: id('4'), Title: 'Membres', VariableName: 'members', IsRoster: true, Children: [
            { $type: 'NumericQuestion', QuestionType: 4, PublicKey: id('5'), VariableName: 'age',
              QuestionText: 'Âge', ConditionExpression: 'consent == 1',
              ValidationConditions: [{ Expression: 'age >= 0' }, { Expression: 'age <= 120' }] },
          ] },
        ] },
      ],
    });

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[0]).toMatchObject({ variableName: 'consent', type: 'SÉLECTION SIMPLE', label: 'Consentement ?', options: [{ value: '1', text: 'Oui' }] });
    expect(parsed.questions[1]).toMatchObject({ variableName: 'age', type: 'NUMÉRIQUE', minValue: 0, maxValue: 120, isRoster: true, enablingCondition: 'consent == 1' });
  });

  it('gère les wrappers API, les propriétés camelCase et les conteneurs non identifiés', () => {
    const parsed = extractStructure({ Document: { questionnaireDocument: {
      children: [{ children: [{
        $type: 'TextQuestion', publicKey: id('6'), variableName: 'notes', questionText: 'Notes libres', questionType: 7,
      }] }],
    } } });
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]).toMatchObject({ externalId: id('6'), variableName: 'notes', label: 'Notes libres', type: 'TEXTE' });
  });

  it('conserve une erreur explicite lorsque le document ne contient réellement aucune question', () => {
    expect(() => extractStructure({ Children: [{ $type: 'Group', PublicKey: id('7'), Children: [] }] }))
      .toThrowError(expect.objectContaining({ code: 'QUESTIONS_NON_DÉTECTÉES' }));
  });

  it('récupère la liste et le document par les routes HQ et normalise leurs réponses', async () => {
    const questionnaireId = id('8');
    const document = { Title: 'Q réel de test', Children: [{ $type: 'TextQuestion', PublicKey: id('9'), VariableName: 'comment', QuestionText: 'Commentaire' }] };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL, options: RequestInit) => {
      const url = new URL(input);
      calls.push(`${options.method} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/api/v1/questionnaires')) return json({ data: {
        Questionnaires: [{ QuestionnaireId: questionnaireId, Version: 2, Title: 'Q réel de test', Variable: 'survey', QuestionnaireIdentity: `${questionnaireId}$2` }],
        TotalCount: 1,
      } });
      if (url.pathname.endsWith(`/api/v1/questionnaires/${questionnaireId}/2/document`)) return json({ Document: document });
      return json({ error: 'absent' }, 404);
    }));
    const hq = new SurveySolutionsService(`${root}////`, 'api-test', 'secret-test', workspace, true);
    const questionnaires = await hq.listQuestionnaires();
    const rawDocument = await hq.document(questionnaires[0].externalId, questionnaires[0].version);
    const parsed = extractStructure(rawDocument);

    expect(calls).toEqual([
      `GET /${workspace}/api/v1/questionnaires?limit=40&offset=1`,
      `GET /${workspace}/api/v1/questionnaires/${questionnaireId}/2/document`,
    ]);
    expect(questionnaires).toHaveLength(1);
    expect(parsed.questions).toMatchObject([{ variableName: 'comment', label: 'Commentaire', type: 'TEXTE' }]);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(new Headers(options?.headers).get('Authorization')).toBe(`Basic ${Buffer.from('api-test:secret-test').toString('base64')}`);
    }
  });
});
