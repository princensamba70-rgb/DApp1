import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateRule, parseRule, type QualityQuestion, type QualityResponse, type QualityRule } from './quality.js';
import { extractStructure, mapInterviewAnswers, SurveySolutionsService } from './survey-solutions.service.js';

const age:QualityQuestion = {id:'11111111-1111-4111-8111-111111111111', variable_name:'age',type:'NUMÉRIQUE',enabling_condition:null,is_roster:false};
const consent:QualityQuestion = {id:'22222222-2222-4222-8222-222222222222',variable_name:'consent',type:'SÉLECTION SIMPLE',enabling_condition:null,is_roster:false};
const email:QualityQuestion = {id:'33333333-3333-4333-8333-333333333333',variable_name:'email',type:'TEXTE',enabling_condition:'consent == 1',is_roster:false};
const byId = new Map([age,consent,email].map(q=>[q.id,q]));
const response:QualityResponse = {id:'a',external_id:'b',answers:{age:[{value:'72',rosterVector:[],questionId:null}],consent:[{value:'1',rosterVector:[],questionId:null}]}};
const rule = (type:QualityRule['type'],params:Record<string,unknown>):QualityRule => ({id:'r',question_id:age.id,type,params});

describe('moteur de qualité', () => {
  it('contrôle les bornes numériques avec les valeurs réelles Survey Solutions', () => {
    expect(evaluateRule(rule('range',{min:18,max:65}),age,response,byId,response.answers.age![0]).status).toBe('NON CONFORME');
    expect(evaluateRule(rule('max',{value:100}),age,response,byId,response.answers.age![0]).status).toBe('CONFORME');
    expect(evaluateRule(rule('format',{kind:'integer'}),age,response,byId,response.answers.age![0]).status).toBe('CONFORME');
  });
  it('signale les données manquantes, mais évite les faux positifs des sauts conditionnels', () => {
    expect(evaluateRule(rule('required',{}),age,{...response,answers:{}},byId,undefined).errorType).toBe('Information manquante');
    expect(evaluateRule({...rule('required',{}),question_id:email.id},email,response,byId,undefined).status).toBe('NON CONTRÔLÉ');
  });
  it('contrôle égalité, choix et cohérence conditionnelle', () => {
    expect(evaluateRule(rule('equals',{value:'72'}),age,response,byId,response.answers.age![0]).status).toBe('CONFORME');
    expect(evaluateRule(rule('allowed',{values:[1,2]}),consent,response,byId,response.answers.consent![0]).status).toBe('CONFORME');
    expect(evaluateRule({...rule('consistency',{whenQuestionId:consent.id,operator:'==',value:1}),question_id:email.id},email,response,byId,undefined).status).toBe('NON CONFORME');
  });
  it('refuse les contrôles incomplets ou incohérents', () => {
    expect(()=>parseRule({questionId:age.id,type:'range',params:{min:65,max:18},active:true})).toThrow();
    expect(()=>parseRule({questionId:age.id,type:'format',params:{kind:'not-a-format'},active:true})).toThrow();
  });
  it('marque les répétitions comme doublons potentiels', () => {
    expect(evaluateRule(rule('duplicate',{questionIds:[consent.id]}),age,response,byId,response.answers.age![0],'premier').errorType).toBe('Doublon potentiel');
  });
  it.each([
    ['date','2026-09-24','CONFORME'],['date','2026-02-30','NON CONFORME'],
    ['phone','+243 812 345 678','CONFORME'],['phone','abc','NON CONFORME'],
    ['email','agent@example.org','CONFORME'],['email','adresse-invalide','NON CONFORME'],
  ] as const)('valide le format %s sur %s', (kind,value,status) => {
    expect(evaluateRule(rule('format',{kind}),age,response,byId,{value,rosterVector:[],questionId:null}).status).toBe(status);
  });
  it('compare des questions liées sans mélanger les occurrences d’un roster', () => {
    expect(evaluateRule(rule('compare',{otherQuestionId:consent.id,operator:'>'}),age,response,byId,response.answers.age![0]).status).toBe('CONFORME');
    const rosterResponse = {...response,answers:{
      age:[{value:'72',rosterVector:[1],questionId:null}],
      consent:[{value:'80',rosterVector:[0],questionId:null},{value:'70',rosterVector:[1],questionId:null}],
    }};
    expect(evaluateRule(rule('compare',{otherQuestionId:consent.id,operator:'>'}),age,rosterResponse,byId,
      rosterResponse.answers.age[0]).status).toBe('CONFORME');
  });
});

describe('adaptateur Survey Solutions', () => {
  it('lit automatiquement sections, options, contraintes et conditions', () => {
    const doc = { Children:[{$type:'Group',PublicKey:'section',Title:'Profil',Children:[
      {$type:'NumericQuestion',PublicKey:age.id,QuestionType:4,VariableName:'age',QuestionText:'Âge',ValidationConditions:[{Expression:'age >= 18'},{Expression:'age <= 65'}]},
      {$type:'SingleQuestion',PublicKey:consent.id,QuestionType:0,VariableName:'consent',QuestionText:'Consentement',Answers:[{AnswerValue:1,AnswerText:'Oui'}]},
    ]}]};
    const {sections,questions} = extractStructure(doc);
    expect(sections).toHaveLength(1); expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({variableName:'age',minValue:18,maxValue:65});
    expect(questions[1]?.options).toEqual([{value:'1',text:'Oui'}]);
  });
  it('préserve les occurrences des rosters', () => {
    const answers = mapInterviewAnswers({Answers:[{VariableName:'age',QuestionId:{Id:age.id,RosterVector:[0,1]},Answer:'72'}]});
    expect(answers.age?.[0]?.rosterVector).toEqual([0,1]);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('utilise le superviseur GraphQL quand ce champ est disponible', async () => {
    const service = new SurveySolutionsService('https://survey.invalid','api','secret');
    const interview = { externalId:'33333333-3333-4333-8333-333333333333',interviewer:'Agent',supervisor:null,status:'Completed',lastModifiedAt:null };
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({data:{interviews:{nodes:[{
      id:interview.externalId,responsibleName:'Agent',responsibleRole:'Interviewer',supervisorName:'Responsable HQ',
    }]}}})}));
    const [enriched] = await service.enrichInterviews([interview],'11111111-1111-4111-8111-111111111111',1);
    expect(enriched).toMatchObject({interviewer:'Agent',supervisor:'Responsable HQ'});
  });
  it('conserve les entretiens REST si le serveur ne supporte pas le schéma GraphQL', async () => {
    const service = new SurveySolutionsService('https://survey.invalid','api','secret');
    const interviews = [{externalId:'33333333-3333-4333-8333-333333333333',interviewer:'Agent',supervisor:'Responsable REST',status:'Completed',lastModifiedAt:null}];
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({errors:[{message:'unsupported'}]})}));
    expect(await service.enrichInterviews(interviews,'11111111-1111-4111-8111-111111111111',1)).toEqual(interviews);
  });
});
