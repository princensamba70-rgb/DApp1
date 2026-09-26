import {describe,it,expect} from 'vitest';
import {analyze,inferType,settingsSchema,classification,qualityScore,type Question,type Response} from './intelligence.js';
const q=(variable_name:string,extra:Partial<Question>={}):Question=>({id:variable_name,variable_name,label:variable_name,type:'TEXTE',enabling_condition:null,is_roster:false,...extra});
const r=(id:string,answers:Record<string,unknown>):Response=>({id,external_id:id,interviewer:'ENQ024',supervisor:'SUP01',answers:Object.fromEntries(Object.entries(answers).map(([k,value])=>[k,[{value,questionId:null,rosterVector:[]}]]))});
const config=settingsSchema.parse({});
const geo=[q('village'),q('aire_de_sante'),q('zone_de_sante')];
describe('moteur automatique — cas métier',()=>{
  it('seuil strict 5 : A=5 normal, B=6 C=9 D=14 ; occurrence réelle et message contextualisé',()=>{
    const rows=[5,6,9,14].flatMap((n,i)=>Array.from({length:n},(_,j)=>r(`${i}-${j}`,{village:'ABCD'[i],aire_de_sante:'Kimputu',zone_de_sante:'Z1'})));
    const {findings}=analyze(geo,rows,config);
    expect(findings).toHaveLength(29);
    expect(findings.some(f=>f.context.village==='A')).toBe(false);
    for(const [v,n] of [['B',6],['C',9],['D',14]] as const){const f=findings.filter(x=>x.context.village===v);expect(f).toHaveLength(n);expect(f.every(x=>x.occurrence===n&&x.details.includes(`${n} fois`)&&x.details.includes('Kimputu'))).toBe(true);}
  });
  it('sépare les villages homonymes par aire et zone',()=>{
    const rows=Array.from({length:10},(_,i)=>r(String(i),{village:'A',aire_de_sante:i<5?'X':'Y',zone_de_sante:'Z'}));
    expect(analyze(geo,rows,config).findings).toHaveLength(0);
  });
  it('applique le seuil configuré et la désactivation',()=>{
    const rows=Array.from({length:6},(_,i)=>r(String(i),{village:'X'}));
    expect(analyze(geo,rows,settingsSchema.parse({maximumOccurrences:6})).findings).toHaveLength(0);
    expect(analyze(geo,rows,settingsSchema.parse({disabled:['repetition']})).findings).toHaveLength(0);
  });
  it('détecte toutes les lignes du doublon exact avec identifiants concernés',()=>{
    const {findings}=analyze([q('identifiant_menage'),...geo],[r('A',{identifiant_menage:'001',village:'X'}),r('B',{identifiant_menage:'001',village:'X'})],config);
    expect(findings).toHaveLength(2);expect(findings[0]).toMatchObject({status:'Doublon exact',occurrence:2,related:['A','B'],severity:'CRITIQUE'});
  });
  it('ne confond pas village identique et doublon',()=>{
    expect(analyze(geo,[r('A',{village:'X'}),r('B',{village:'X'})],config).findings).toHaveLength(0);
  });
  it('ne confirme pas un téléphone partagé',()=>{
    const fs=analyze([q('telephone')],[r('A',{telephone:'+243812345678'}),r('B',{telephone:'+243812345678'})],config).findings;
    expect(fs).toHaveLength(2);expect(fs[0]?.status).toBe('Doublon potentiel');
  });
  it('signale une question obligatoire vide, mais pas une condition non interprétable',()=>{
    const qs=[q('nom',{is_required:true}),q('email',{is_required:true,enabling_condition:'consent == 1'}),q('membre',{is_required:true,is_roster:true})];
    const fs=analyze(qs,[r('A',{})],config).findings;
    expect(fs).toHaveLength(1);expect(fs[0]?.status).toBe('Information manquante');
  });
  it('vérifie téléphone et âge impossible sans convertir une chaîne vide en zéro',()=>{
    const fs=analyze([q('telephone'),q('age')],[r('A',{telephone:'abc',age:157}),r('B',{age:''})],config).findings;
    expect(fs.map(f=>f.status)).toEqual(['Format incorrect','Valeur hors plage']);expect(fs[1]?.details).toContain('157 ans');
  });
  it('détecte la contradiction âge / naissance à la date de collecte',()=>{
    const fs=analyze([q('age'),q('date_naissance'),q('debut')],[r('A',{age:50,date_naissance:'2010-01-01',debut:'2026-09-26T10:00:00Z'})],config).findings;
    expect(fs).toHaveLength(1);expect(fs[0]?.details).toContain('environ 16 ans');
  });
  it('ne substitue pas la date de modification à la date de collecte',()=>{
    expect(analyze([q('age'),q('date_naissance')],[{...r('A',{age:50,date_naissance:'2010-01-01'}),last_modified_at:'2026-09-26'}],config).findings).toHaveLength(0);
  });
  it('dates invalides, fin avant début, durée rapide',()=>{
    const fs=analyze([q('debut'),q('fin')],[r('A',{debut:'2026-09-26T10:00:00Z',fin:'2026-09-26T10:02:00Z'}),r('B',{debut:'2026-09-26T10:00:00Z',fin:'2026-09-26T09:00:00Z'}),r('C',{debut:'2026-02-30'})],config).findings;
    expect(fs.map(f=>f.status)).toEqual(['Durée de collecte inhabituelle','Dates incohérentes','Format incorrect']);
  });
  it('référentiel : homonymes acceptés, associations invalides signalées, inconnus ignorés',()=>{
    const c=settingsSchema.parse({geography:[{village:'A',healthArea:'X',healthZone:'Z'},{village:'A',healthArea:'Y',healthZone:'Z'}]});
    const fs=analyze(geo,[r('1',{village:'A',aire_de_sante:'Y',zone_de_sante:'Z'}),r('2',{village:'A',aire_de_sante:'W',zone_de_sante:'Z'}),r('3',{village:'B',aire_de_sante:'W',zone_de_sante:'Z'})],c).findings;
    expect(fs).toHaveLength(1);expect(fs[0]?.responseId).toBe('2');
  });
  it('respecte les choix multiples sous forme tableau et les limites du GPS',()=>{
    const fs=analyze([q('choix',{type:'SÉLECTION MULTIPLE',options:[{value:'1',text:'Oui'},{value:'2',text:'Non'}]}),q('gps')],[r('A',{choix:[1,2],gps:{Latitude:91,Longitude:20}})],config).findings;
    expect(fs).toHaveLength(1);expect(fs[0]?.questionId).toBe('gps');
  });
  it('inférence par libellé, valeurs et corrections administrateur',()=>{
    expect(inferType(q('S00Q05',{label:'Village du ménage'}))).toBe('village');
    expect(inferType(q('unknown',{type:'AUTRE'}),[1,2,3])).toBe('integer');
    expect(inferType(q('unknown'),[1,2])).toBe('text');
    expect(inferType(q('S00Q05'),[],{S00Q05:'phone'})).toBe('phone');
  });
  it('outliers : échantillon minimum, absence de division par zéro',()=>{
    expect(analyze([q('montant')],Array.from({length:25},(_,i)=>r(String(i),{montant:10})),config).findings).toHaveLength(0);
    const fs=analyze([q('montant')],Array.from({length:25},(_,i)=>r(String(i),{montant:i===24?9999:i})),config).findings;
    expect(fs.filter(f=>f.check==='outlier')).toHaveLength(1);
  });
  it('pondère les critiques et respecte les frontières de classification',()=>{
    expect(qualityScore(['CRITIQUE'])).toBe(65);expect(qualityScore(Array(5).fill('CRITIQUE'))).toBe(0);
    expect([100,95,94,90,89,75,74,50,49].map(classification)).toEqual(['Excellent','Excellent','Bon','Bon','À surveiller','À surveiller','Qualité faible','Qualité faible','Qualité critique']);
  });
  it('n’évalue pas un entretien sans contrôle applicable',()=>{
    expect(analyze([q('texte')],[r('1',{texte:'abc'})],config).checkedIds.size).toBe(0);
  });
  it('compare la taille déclarée aux membres du roster explicitement identifié',()=>{
    const questions=[q('taille_du_menage'),q('nom_membre',{is_roster:true})];
    const response=r('A',{taille_du_menage:1});
    response.answers.nom_membre=[{value:'Alice',questionId:null,rosterVector:[0]},{value:'Bob',questionId:null,rosterVector:[1]}];
    const findings=analyze(questions,[response],settingsSchema.parse({householdMemberVariable:'nom_membre'})).findings;
    expect(findings).toHaveLength(1);expect(findings[0]).toMatchObject({status:'Composition du ménage incohérente',occurrence:2});
    expect(analyze(questions,[response],config).findings).toHaveLength(0);
  });
  it('utilise les libellés géographiques plutôt que les codes des choix',()=>{
    const qs=[q('village',{options:[{value:'1',text:'Kimbangu'}]}),q('aire_de_sante',{options:[{value:'2',text:'Kimputu'}]}),q('zone_de_sante',{options:[{value:'3',text:'Zone 1'}]})];
    const rows=Array.from({length:6},(_,i)=>r(String(i),{village:1,aire_de_sante:2,zone_de_sante:3}));
    const fs=analyze(qs,rows,settingsSchema.parse({geography:[{village:'Kimbangu',healthArea:'Kimputu',healthZone:'Zone 1'}]})).findings;
    expect(fs).toHaveLength(6);expect(fs[0]?.details).toContain('Kimbangu');expect(fs[0]?.details).toContain('Kimputu');
  });
  it('échelle : 10 000 entretiens, sans comparaison exhaustive par paires',()=>{
    const rows=Array.from({length:10000},(_,i)=>r(String(i),{village:`V${Math.floor(i/5)}`,age:20+i%60}));
    expect(analyze([q('village'),q('age')],rows,config).findings).toHaveLength(0);
  });
});
