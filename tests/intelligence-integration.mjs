// Run against an isolated database and QUALITY_FIXTURES=1 mock-survey.cjs.
// node tests/intelligence-integration.mjs ; reads ignored backend/.env.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from '../backend/node_modules/pg/lib/index.js';
import ExcelJS from '../backend/node_modules/exceljs/excel.js';
const env=Object.fromEntries(readFileSync('backend/.env','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(/=(.*)/s).slice(0,2)));
const base=process.env.BASE_URL||'http://127.0.0.1:5173';
const db=new pg.Pool({connectionString:env.DATABASE_URL});
let assertions=0;
function check(v,msg){assert.ok(v,msg);assertions++;console.log('✓ '+msg);}
async function call(path,method='GET',body,cookie){const res=await fetch(base+'/api'+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const data=await res.json();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};}
try {
  check((await call('/intelligence/statistics')).status===401,'statistiques protégées sans session');
  const admin=await call('/auth/login','POST',{username:env.ADMIN_USERNAME||'admin',password:env.ADMIN_PASSWORD});check(admin.status===200,'connexion administrateur');
  const user=await call('/auth/login','POST',{username:env.USER1_USERNAME||'user1',password:env.USER1_PASSWORD});check(user.status===200,'connexion utilisateur');
  check((await call('/intelligence/settings','GET',null,user.cookie)).status===403,'paramètres réservés aux administrateurs');
  check((await call('/intelligence/settings','PUT',{},user.cookie)).status===403,'modification interdite aux utilisateurs');
  check((await call('/exports/rules?format=csv','GET',null,user.cookie)).status===403,'export de configuration protégé');
  let result=await call('/settings/survey-solutions','PUT',{url:'http://127.0.0.1:8099',workspace:'sankurusaco',username:'api_user',password:'mock_password',allowInsecureHttp:true},admin.cookie);
  check(result.status===200&&!JSON.stringify(result.data).includes('mock_password'),'connexion enregistrée sans divulgation');
  result=await call('/intelligence/settings','GET',null,admin.cookie);const settings={...result.data,maximumPerDay:100};
  check((await call('/intelligence/settings','PUT',settings,admin.cookie)).status===200,'paramétrage des contrôles');
  result=await call('/sync','POST',{},admin.cookie);
  check(result.status===200&&result.data.questions===10&&result.data.responses===34,'synchronisation API : 10 questions et 34 entretiens');
  const errors=await call('/errors?pageSize=100','GET',null,user.cookie);
  check(errors.status===200,'tableau des anomalies accessible');
  const rows=errors.data.items;
  check(rows.length===34,`nombre exact des anomalies attendu : 34 (obtenu ${rows.length})`);
  const village=rows.filter(r=>r.error_type==='Village répété');
  check(village.length===29,'29 entretiens concernés par des répétitions');
  for(const [v,n] of [['A',5],['B',6],['C',9],['D',14]]){
    const matching=village.filter(r=>r.context.village===v);
    check(matching.length===(n===5?0:n),`village ${v} : ${n} occurrences, bon nombre de lignes`);
    check(matching.every(r=>r.occurrence===n&&r.details.includes(`${n} fois`)&&r.details.includes('Kimputu')),`village ${v} : occurrence et message exacts`);
  }
  check(rows.filter(r=>r.error_type==='Doublon exact').length===2,'les deux entretiens doublons sont signalés');
  check(rows.filter(r=>r.error_type==='Information manquante').length===1,'obligation issue des métadonnées Survey Solutions');
  check(rows.filter(r=>r.error_type==='Format incorrect').length===1,'téléphone incorrect');
  check(rows.filter(r=>r.error_type==='Incohérence dans les réponses').length===1,'contradiction âge / naissance');
  check(rows.every(r=>r.quality_score<100&&r.quality_class),'scores persistés sur tous les entretiens concernés');
  check(rows.every(r=>!('rule_params' in r)&&!('rule_type' in r)),'API des anomalies sans règles techniques');
  const stats=await call('/intelligence/statistics','GET',null,user.cookie);
  check(stats.status===200&&stats.data.summary.total===34&&stats.data.summary.with_errors===34,'statistiques cohérentes avec la base');
  check(stats.data.summary.repeated_villages===3,'trois villages au-dessus du seuil');
  const csv=await fetch(base+'/api/exports/errors?format=csv',{headers:{cookie:user.cookie}});const text=await csv.text();
  check(csv.ok&&text.includes('Occurrence')&&!text.includes('Paramètres')&&!text.includes('Règle'),'CSV sans paramètres techniques');
  check(rows.every(r=>text.includes(r.details.replaceAll('"','""'))),'CSV : mêmes messages que le tableau');
  const xlsx=await fetch(base+'/api/exports/errors?format=xlsx',{headers:{cookie:user.cookie}});const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));const sheet=book.worksheets[0];
  check(xlsx.ok&&sheet.rowCount===35,'Excel : 34 anomalies et en-tête');
  check(sheet.getRow(1).values.includes('Détails')&&!sheet.getRow(1).values.includes('Paramètres'),'Excel : colonnes métier');
  const before=(await db.query('SELECT fingerprint,analyzed_at FROM quality_analysis')).rows;
  check((await call('/sync','POST',{},admin.cookie)).status===200,'seconde synchronisation idempotente');
  const after=(await db.query('SELECT fingerprint,analyzed_at FROM quality_analysis')).rows;
  check(JSON.stringify(before)===JSON.stringify(after),'cache : aucune réanalyse si les données sont inchangées');
  check((await call('/errors?pageSize=100','GET',null,user.cookie)).data.total===34,'aucune duplication des résultats');
  const modified=await call('/intelligence/settings','PUT',{...settings,maximumOccurrences:9},admin.cookie);
  check(modified.status===200,'modification du seuil et réanalyse transactionnelle');
  const next=(await call('/errors?pageSize=100','GET',null,user.cookie)).data.items.filter(r=>r.error_type==='Village répété');
  check(next.length===14&&next.every(r=>r.occurrence===14),'seuil 9 : seuls les 14 entretiens du village D restent signalés');
  check((await call('/intelligence/settings','PUT',settings,admin.cookie)).status===200,'restauration du seuil 5');
  console.log(`\n${assertions} vérifications d’intégration réussies.`);
} finally {await db.end();}
