import { z } from 'zod';
import type { QualityQuestion, QualityResponse } from './quality.js';

export const checks = ['format','range','required','allowed','repetition','duplicates','geography','ageBirth','temporal','duration','outlier','activity','household'] as const;
export const semantics = ['text','integer','decimal','date','time','datetime','boolean','single','multiple','identifier','village','healthArea','healthZone','age','sex','phone','code','amount','quantity','gps','birthDate','start','end','name','householdSize'] as const;
export const settingsSchema = z.object({
  maximumOccurrences: z.number().int().min(1).max(1000000).default(5),
  minimumDuration: z.number().min(0).max(100000).default(3),
  maximumDuration: z.number().positive().max(100000).default(240),
  maximumPerDay: z.number().int().positive().default(30),
  outlierFactor: z.number().min(1.5).max(10).default(3),
  minimumSample: z.number().int().min(10).max(10000).default(20),
  duplicateMinimumFields: z.number().int().min(2).max(8).default(3),
  disabled: z.array(z.enum(checks)).default([]),
  severity: z.record(z.enum(checks), z.enum(['CRITIQUE','MAJEURE','MODÉRÉE','MINEURE'])).default({}),
  bindings: z.record(z.string(), z.enum(semantics)).default({}),
  requiredVariables: z.array(z.string().max(100)).max(1000).default([]),
  householdMemberVariable: z.string().max(100).default(''),
  geography: z.array(z.object({village:z.string().trim().min(1).max(200),healthArea:z.string().trim().min(1).max(200),healthZone:z.string().trim().min(1).max(200)}).strict()).max(10000).default([]),
}).strict().refine(s => s.minimumDuration < s.maximumDuration, 'La durée minimale doit être inférieure à la durée maximale.');
export type Settings = z.infer<typeof settingsSchema>;
export type Semantic = typeof semantics[number];
export type Question = QualityQuestion & {label?:string;is_required?:boolean;options?:{value:string;text:string}[];min_value?:number|string|null;max_value?:number|string|null};
export type Response = QualityResponse & {interviewer?:string|null;supervisor?:string|null;last_modified_at?:string|null};
export type Finding = {responseId:string;questionId:string;instance:string;check:typeof checks[number];occurrence:number;status:string;details:string;severity:string;value:unknown;context:Record<string,string>;related:string[]};
export const normalize = (v:unknown):string => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
export const missing = (v:unknown) => v == null || typeof v === 'string' && !v.trim() || Array.isArray(v) && !v.length;
const numeric = (v:unknown):number|null => !missing(v) && /^(?:-?\d+)(?:[.,]\d+)?$/.test(String(v).trim()) ? Number(String(v).replace(',','.')) : null;
export function inferType(q:Question, samples:unknown[] = [], bindings:Settings['bindings'] = {}):Semantic {
  if (bindings[q.variable_name]) return bindings[q.variable_name]!;
  const text = normalize(`${q.variable_name.replace(/_/g,' ')} ${q.label || ''}`);
  const hints:[RegExp,Semantic][] = [
    [/\b(naissance|birth|dob)\b/,'birthDate'],[/\b(debut|start)\b/,'start'],[/\b(fin|end)\b/,'end'],
    [/\b(village)\b/,'village'],[/\b(aire de sante|health area|aire sante)\b/,'healthArea'],[/\b(zone de sante|health zone|zone sante)\b/,'healthZone'],
    [/\b(age)\b/,'age'],[/\b(telephone|phone|tel|mobile)\b/,'phone'],[/\b(sexe|sex|gender)\b/,'sex'],
    [/\b(nombre de membres|taille du menage|household size)\b/,'householdSize'],
    [/\b(identifiant|household id|id menage|identifiant menage)\b/,'identifier'],[/\b(gps|coordonnees|latitude|longitude)\b/,'gps'],
    [/\b(montant|prix|revenu|amount|income)\b/,'amount'],[/\b(quantite|quantity|nombre)\b/,'quantity'],[/\b(code)\b/,'code'],[/\b(nom|name)\b/,'name'],
  ];
  for (const [re,kind] of hints) if(re.test(text)) return kind;
  const t = normalize(q.type);
  if(t.includes('multiple')) return 'multiple';
  if(t.includes('simple') || t.includes('categor')) return q.options?.length === 2 && q.options.every(o=>/^(oui|non|yes|no)$/.test(normalize(o.text))) ? 'boolean' : 'single';
  if(t.includes('gps')) return 'gps';
  if(t.includes('date')) return 'datetime';
  if(t.includes('entier')) return 'integer';
  if(t === 'texte') return 'text';
  if(t.includes('numer') || t.includes('decimal')) return 'decimal';
  // Conservative inference: sparse values never redefine an unknown question.
  const values = samples.filter(v=>!missing(v)).slice(0,100);
  if(values.length >= 3) {
    if(values.every(v=>typeof v==='boolean')) return 'boolean';
    if(values.every(v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v)))) return 'date';
    if(values.every(v=>/^\d{2}:\d{2}(?::\d{2})?$/.test(String(v)))) return 'time';
    if(values.every(v=>numeric(v)!==null)) return values.every(v=>Number.isInteger(numeric(v))) ? 'integer':'decimal';
  }
  return 'text';
}
function validDate(v:unknown):number|null {
  const s=String(v);
  if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)) return null;
  const day=new Date(s.slice(0,10)+'T00:00:00Z'), n=Date.parse(s);
  return Number.isFinite(n) && !Number.isNaN(day.getTime()) && day.toISOString().slice(0,10)===s.slice(0,10) ? n:null;
}
export function classification(score:number):string { return score>=95?'Excellent':score>=90?'Bon':score>=75?'À surveiller':score>=50?'Qualité faible':'Qualité critique'; }
export function qualityScore(severities:string[]):number {
  const weights:Record<string,number>={CRITIQUE:35,MAJEURE:15,'MODÉRÉE':5,MINEURE:2};
  return Math.max(0,100-severities.reduce((n,s)=>n+(weights[s]||5),0));
}

/** Pure, deterministic analysis. No expression execution; no inferred conditional obligation. */
export function analyze(questions:Question[], responses:Response[], config:Settings) {
  const types = new Map(questions.map(q=>[q.id,inferType(q,responses.slice(0,100).flatMap(r=>(r.answers[q.variable_name]||[]).map(a=>a.value)),config.bindings)]));
  const unique = (kind:Semantic) => {const qs=questions.filter(q=>types.get(q.id)===kind && !q.is_roster);return qs.length===1?qs[0]:undefined;};
  const val = (r:Response,q:Question|undefined):unknown => {const a=q?r.answers[q.variable_name]:undefined;return a?.length===1&&!a[0]!.rosterVector.length?a[0]!.value:undefined;};
  const label = (q:Question) => q.label || q.variable_name;
  const village=unique('village'),area=unique('healthArea'),zone=unique('healthZone');
  const display = (r:Response,q:Question|undefined) => {const v=val(r,q);return q?.options?.find(o=>String(o.value)===String(v))?.text || String(v??'');};
  const context = (r:Response) => ({village:display(r,village),healthArea:display(r,area),healthZone:display(r,zone),interviewer:r.interviewer||'',supervisor:r.supervisor||''});
  const findings:Finding[]=[];
  let checked=0, missingCount=0, eligible=0;
  const checkedIds = new Set<string>();
  function touch(r:Response) {checked++;checkedIds.add(r.id);}
  const enabled=(check:typeof checks[number])=>!config.disabled.includes(check);
  function emit(r:Response,q:Question,check:Finding['check'],status:string,details:string,severity='MODÉRÉE',occurrence=1,value:unknown=val(r,q),instance='',related:string[]=[]) {
    if(!enabled(check)) return;
    findings.push({responseId:r.id,questionId:q.id,instance,check,occurrence,status,details,severity:config.severity[check]||severity,value:value??null,context:context(r),related});
  }
  for(const r of responses) {
    for(const q of questions) {
      const kind=types.get(q.id)!;
      const instances=r.answers[q.variable_name]||[];
      const required=q.is_required || config.requiredVariables.includes(q.variable_name);
      // Applicability of C# and uninstantiated rosters is not guessed.
      if(!q.enabling_condition && !q.is_roster) {
        eligible++;
        if(!instances.length||instances.every(a=>missing(a.value))) missingCount++;
        if(required && enabled('required')) {touch(r);if(!instances.length||instances.every(a=>missing(a.value)))emit(r,q,'required','Information manquante',`« ${label(q)} » est obligatoire mais aucune réponse n’a été renseignée.`);}
      }
      for(const a of instances) {
        if(missing(a.value)) continue;
        const v=a.value, str=String(v).trim(), n=numeric(v), instance=a.rosterVector.join('/');
        const fail=(check:Finding['check'],status:string,details:string,severity='MODÉRÉE')=>emit(r,q,check,status,details,severity,1,v,instance);
        let valid=true, formatChecked=true;
        if(['age','integer','quantity','householdSize'].includes(kind))valid=n!==null&&Number.isInteger(n);
        else if(['decimal','amount'].includes(kind))valid=n!==null;
        else if(kind==='phone')valid=/^\+?[\d ()\-.]+$/.test(str)&&str.replace(/\D/g,'').length>=7&&str.replace(/\D/g,'').length<=15;
        else if(['date','datetime','birthDate','start','end'].includes(kind))valid=validDate(v)!==null;
        else if(kind==='time')valid=/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(str);
        else if(kind==='gps' && n!==null && /latitude|longitude/.test(normalize(`${q.variable_name} ${q.label}`)))valid=Math.abs(n)<= (normalize(`${q.variable_name} ${q.label}`).includes('latitude')?90:180);
        else if(kind==='gps') {const g=typeof v==='object'&&v!==null?v as Record<string,unknown>:null;const coords=Array.isArray(v)?v:g?[g.Latitude??g.latitude,g.Longitude??g.longitude]:str.split(',');const lat=numeric(coords[0]),lon=numeric(coords[1]);valid=lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
        else formatChecked=false;
        if(formatChecked&&enabled('format')) {touch(r);if(!valid)fail('format','Format incorrect',`La réponse « ${str} » à « ${label(q)} » ${kind==='phone'?'ne correspond pas à un numéro de téléphone valide':'ne respecte pas le type attendu'}.`,'MAJEURE');}
        if(!valid)continue;
        let lo=q.min_value==null?null:Number(q.min_value),hi=q.max_value==null?null:Number(q.max_value);
        if(kind==='age'){lo??=0;hi??=120;}
        if(['quantity','householdSize'].includes(kind))lo??=0;
        if(n!==null&&(lo!==null||hi!==null)&&enabled('range')) {touch(r);if(lo!==null&&n<lo||hi!==null&&n>hi)fail('range','Valeur hors plage',`« ${label(q)} » contient ${str}${kind==='age'?' ans':''}. Cette valeur est en dehors de la plage attendue${lo!==null&&hi!==null?` (${lo} à ${hi})`:''}.`,kind==='age'?'CRITIQUE':'MAJEURE');}
        if(q.options?.length&&enabled('allowed')) {touch(r);const parts=Array.isArray(v)?v:kind==='multiple'?str.split(',').map(x=>x.trim()):[v];if(parts.some(p=>!q.options!.some(o=>String(o.value)===String(p))))fail('allowed','Valeur non autorisée',`La réponse « ${str} » n’est pas une valeur reconnue pour « ${label(q)} ».`,'MAJEURE');}
      }
    }
    const sizeQuestion=unique('householdSize');
    const membersQuestion=questions.find(q=>q.variable_name===config.householdMemberVariable&&q.is_roster);
    const declared=numeric(val(r,sizeQuestion));
    const members=membersQuestion?r.answers[membersQuestion.variable_name]:undefined;
    // Explicit mapping avoids counting nested roster instances as household members.
    if(enabled('household')&&sizeQuestion&&declared!==null&&members?.length&&members.every(a=>a.rosterVector.length===1)) {
      touch(r);
      const actual=new Set(members.map(a=>a.rosterVector.join('/'))).size;
      if(declared!==actual)emit(r,sizeQuestion,'household','Composition du ménage incohérente',`Le ménage déclare ${declared} membres, mais ${actual} membres sont effectivement enregistrés. Vérifier la liste des membres.`,'MAJEURE',actual,declared);
    }
    const age=unique('age'), birth=unique('birthDate'), start=unique('start'), end=unique('end');
    const a=numeric(val(r,age)),b=validDate(val(r,birth)),s=validDate(val(r,start)),e=validDate(val(r,end));
    // A modification timestamp is not a collection date. Only explicit start/end values are used.
    const reference=s??e;
    if(age&&birth&&a!==null&&b!==null&&reference!==null&&enabled('ageBirth')) {touch(r);const bd=new Date(b),rd=new Date(reference);let years=rd.getUTCFullYear()-bd.getUTCFullYear();if(rd.getUTCMonth()<bd.getUTCMonth()||rd.getUTCMonth()===bd.getUTCMonth()&&rd.getUTCDate()<bd.getUTCDate())years--;if(Math.abs(years-a)>1)emit(r,age,'ageBirth','Incohérence dans les réponses',`L’âge déclaré (${a} ans) ne correspond pas à la date de naissance (${String(val(r,birth)).slice(0,10)}) : environ ${years} ans à la collecte.`,'MAJEURE');}
    if(start&&end&&s!==null&&e!==null) {
      if(enabled('temporal')){touch(r);if(e<s)emit(r,end,'temporal','Dates incohérentes',`La fin de collecte (${val(r,end)}) précède son début (${val(r,start)}).`,'CRITIQUE');}
      if(e>=s&&enabled('duration')) {touch(r);const minutes=(e-s)/60000;if(minutes<config.minimumDuration||minutes>config.maximumDuration)emit(r,end,'duration','Durée de collecte inhabituelle',`Ce questionnaire a été complété en ${Number(minutes.toFixed(2))} minutes, une durée ${minutes<config.minimumDuration?'inférieure':'supérieure'} à la durée attendue. Vérifier les heures de collecte.`,'MAJEURE',1,minutes);}
    }
  }
  function groups(q:Question,key:(r:Response)=>string|null) {const m=new Map<string,Response[]>();for(const r of responses){const k=key(r);if(k!==null){const rows=m.get(k)||[];rows.push(r);m.set(k,rows);}}return m;}
  if(village&&enabled('repetition')) {
    const grouped=groups(village,r=>missing(val(r,village))?null:JSON.stringify([normalize(val(r,village)),normalize(val(r,area)),normalize(val(r,zone))]));
    for(const rs of grouped.values()) {for(const r of rs)touch(r);if(rs.length<=config.maximumOccurrences)continue;for(const r of rs){const c=context(r);emit(r,village,'repetition','Village répété',`Le village « ${c.village} » apparaît ${rs.length} fois${c.healthArea?` dans l’aire de santé « ${c.healthArea} »`:''}${c.healthZone?`, zone de santé « ${c.healthZone} »`:''}, alors que le maximum autorisé est de ${config.maximumOccurrences} occurrences. Vérifier les questionnaires concernés.`,'MAJEURE',rs.length);}}
  }
  // Administrative names may be homonyms. Never declare an unknown village inconsistent.
  const geo=new Map<string,Settings['geography']>();for(const row of config.geography){const k=normalize(row.village);const rows=geo.get(k)||[];rows.push(row);geo.set(k,rows);}
  if(village&&area&&zone&&geo.size&&enabled('geography'))for(const r of responses){const c=context(r),refs=geo.get(normalize(c.village));if(!refs||!c.healthArea||!c.healthZone)continue;touch(r);if(!refs.some(g=>normalize(g.healthArea)===normalize(c.healthArea)&&normalize(g.healthZone)===normalize(c.healthZone)))emit(r,village,'geography','Localisation administrative incohérente',`Le village « ${c.village} » est enregistré dans l’aire de santé « ${c.healthArea} », zone « ${c.healthZone} », une association absente du référentiel administratif.`,'CRITIQUE');}
  if(enabled('duplicates')) {
    const id=unique('identifier'),phone=unique('phone'),name=unique('name');
    const candidates=[name,phone,village,area,zone,id].filter((q):q is Question=>!!q);
    const exact=new Map<string,Response[]>(), probable=new Map<string,Response[]>();
    for(const r of responses){const identity=val(r,id);if(id&&!missing(identity)){const key=JSON.stringify([normalize(identity),normalize(val(r,village)),normalize(val(r,area)),normalize(val(r,zone))]);const rs=exact.get(key)||[];rs.push(r);exact.set(key,rs);}
      // Block by phone or household ID. Location alone is never a duplicate signal.
      const p=val(r,phone);if(!missing(p)&&/^\+?[\d ()\-.]+$/.test(String(p).trim())){const key=String(p).replace(/\D/g,'');if(key.length>=7&&key.length<=15){const rs=probable.get(key)||[];rs.push(r);probable.set(key,rs);}}
    }
    const confirmed=new Set<string>();
    if(id)for(const rs of exact.values())if(rs.length>1)for(const r of rs){confirmed.add(r.id);emit(r,id,'duplicates','Doublon exact',`L’identifiant ménage « ${val(r,id)} » est partagé par ${rs.length} questionnaires dans la même localisation. Entretiens concernés : ${rs.slice(0,50).map(x=>x.external_id).join(', ')+(rs.length>50?' (50 premiers affichés)':'')}. Vérifier l’unicité attendue de cet identifiant.`,'CRITIQUE',rs.length,undefined,'',rs.slice(0,50).map(x=>x.external_id));}
    // No quadratic pairwise expansion: groups are compared to a representative.
    if(phone)for(const rs of probable.values())if(rs.length>1){const first=rs[0]!;for(const r of rs){if(confirmed.has(r.id))continue;const other=r===first?rs[1]!:first;const matched=candidates.filter(q=>!missing(val(r,q))&&normalize(val(r,q))===normalize(val(other,q)));const probable=matched.length>=config.duplicateMinimumFields;
      emit(r,phone,'duplicates',probable?'Doublon probable':'Doublon potentiel',`Les entretiens ${r.external_id} et ${other.external_id} partagent ${matched.length} informations (${matched.map(label).join(', ')}), dont le téléphone. Il peut s’agir d’un numéro partagé : vérification recommandée avant de conclure à un doublon.`,'MODÉRÉE',rs.length,undefined,'',[other.external_id]);}}
  }
  if(enabled('outlier'))for(const q of questions.filter(q=>['age','integer','decimal','amount','quantity'].includes(types.get(q.id)!))) {
    const values=responses.map(r=>numeric(val(r,q))).filter((n):n is number=>n!==null).sort((a,b)=>a-b);if(values.length<config.minimumSample)continue;
    const q1=values[Math.floor((values.length-1)*.25)]!,q3=values[Math.floor((values.length-1)*.75)]!,iqr=q3-q1;if(!iqr)continue;
    for(const r of responses){const n=numeric(val(r,q));if(n===null)continue;touch(r);if(n<q1-config.outlierFactor*iqr||n>q3+config.outlierFactor*iqr)emit(r,q,'outlier','Valeur inhabituelle',`« ${label(q)} » contient ${n}, une valeur éloignée de celles habituellement observées dans ce questionnaire. Vérification recommandée.`);}
  }
  const start=unique('start');
  if(start&&enabled('activity')) {const buckets=groups(start,r=>r.interviewer&&validDate(val(r,start))!==null?JSON.stringify([r.interviewer,String(val(r,start)).slice(0,10)]):null);for(const rs of buckets.values()){for(const r of rs)touch(r);if(rs.length>config.maximumPerDay)for(const r of rs)emit(r,start,'activity','Activité inhabituelle détectée',`L’enquêteur « ${r.interviewer} » a enregistré ${rs.length} questionnaires le ${String(val(r,start)).slice(0,10)}. Vérifier la charge et les horaires de collecte.`,'MAJEURE',rs.length);}}
  return {findings,types,checked,checkedIds,missingCount,eligible,contexts:new Map(responses.map(r=>[r.id,context(r)]))};
}
