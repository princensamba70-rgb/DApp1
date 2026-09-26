// Tests de bout en bout contre Docker Compose et un faux HQ Survey Solutions.
// Utilisation: node tests/integration.mjs before | after
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const env=Object.fromEntries(readFileSync(process.env.ENV_FILE||'.env','utf8').split('\n').filter(l=>l && !l.startsWith('#')).map(l=>l.split(/=(.*)/s).slice(0,2)));
const base=process.env.BASE_URL||`http://127.0.0.1:${env.APP_PORT||8080}`;
env.ADMIN_USERNAME ||= 'admin';env.USER1_USERNAME ||= 'user1';
const mockBase=process.env.MOCK_BASE||'http://mock-survey:8099';
const stateFile='tests/integration-state.json';
// Fonctionne avec un accès Docker direct ou un socket exigeant sudo sans invite interactive.
const docker=(()=>{try {execFileSync('docker',['info'],{stdio:'ignore',timeout:5000});return {bin:'docker',prefix:[]};}
  catch{return {bin:'sudo',prefix:['-n','docker']};}})();
let count=0;
function ok(condition,message){assert.ok(condition,message);count++;console.log(`✓ ${message}`);}
async function request(path,method='GET',body, cookie) {
  const opts={method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})};
  const res=await fetch(base+path,opts);
  const raw=Buffer.from(await res.arrayBuffer());
  const contentType=res.headers.get('content-type')||'';
  let json=null;
  if(contentType.includes('json'))try{json=JSON.parse(raw.toString('utf8'));}catch{}
  return {status:res.status,data:json,raw,cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
}
async function login(username,password) {
  const result=await request('/api/auth/login','POST',{username,password});
  ok(result.status===200&&result.cookie.startsWith('sq_session='),`Connexion ${username}`);
  ok(!JSON.stringify(result.data).includes(password),`Aucun mot de passe dans la réponse ${username}`);
  return result.cookie;
}
async function db(sql) {
  if(process.env.LOCAL_DB){const {default:pg}=await import('../backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:env.DATABASE_URL});try {const result=await pool.query({text:sql,rowMode:'array'});return result.rows.map(r=>Object.values(r).join('|')).join('\n');} finally{await pool.end();}}
  if(process.env.PSQL){const url=new URL(env.DATABASE_URL);return execFileSync(process.env.PSQL,['-h',url.hostname,'-p',url.port||'5432','-U',url.username,'-d',url.pathname.slice(1),'-At','-c',sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)}}).trim();}
  return execFileSync(docker.bin,[...docker.prefix,'compose','exec','-T','postgres','psql','-U',env.POSTGRES_USER,'-d',env.POSTGRES_DB,'-At','-c',sql],{encoding:'utf8'}).trim();
}
async function before() {
  let response=await request('/health');ok(response.status===200&&response.data?.status==='ok','GET /health, PostgreSQL disponible');
  response=await request('/api/dashboard');ok(response.status===401,'Route opérationnelle protégée sans session');
  const admin=await login(env.ADMIN_USERNAME,env.ADMIN_PASSWORD);
  const user=await login(env.USER1_USERNAME,env.USER1_PASSWORD);
  response=await request('/api/settings/survey-solutions','GET',null,admin);
  ok(response.status===200&&!JSON.stringify(response.data).includes('password'),'Admin accède aux paramètres sans fuite de secrets');
  response=await request('/api/settings/survey-solutions','GET',null,user);ok(response.status===403,'Utilisateur bloqué sur les paramètres (backend)');
  response=await request('/api/users','GET',null,user);ok(response.status===403,'Utilisateur bloqué sur la gestion des comptes');
  response=await request('/api/sync','POST',{},user);ok(response.status===403,'Utilisateur bloqué sur la synchronisation');
  response=await request('/api/dashboard','GET',null,user);ok(response.status===200,'Utilisateur peut consulter le tableau de bord');
  response=await request('/api/questionnaires','GET',null,user);ok(response.status===200,'Utilisateur peut consulter les questionnaires');
  response=await request('/api/reports','GET',null,user);ok(response.status===200,'Utilisateur peut consulter les rapports');
  const testName='auditeur_'+Date.now().toString().slice(-8), testPass='TestUserSecret2026!';
  response=await request('/api/users','POST',{username:testName,password:testPass,confirmPassword:testPass,role:'user',active:true},admin);
  ok(response.status===201&&response.data.username===testName&&!JSON.stringify(response.data).includes(testPass),'Création utilisateur sans fuite du secret');
  const newId=response.data.id;
  await login(testName,testPass);
  response=await request(`/api/users/${newId}`,'PUT',{username:testName,role:'user',active:false,confirm:true},admin);ok(response.status===200&&!response.data.active,'Désactivation utilisateur');
  response=await request('/api/auth/login','POST',{username:testName,password:testPass});ok(response.status===401,'Compte désactivé refusé à la connexion');
  response=await request(`/api/users/${newId}`,'PUT',{username:testName,role:'user',active:true,confirm:true},admin);ok(response.status===200&&response.data.active,'Réactivation utilisateur');
  response=await request(`/api/users/${newId}/password`,'PUT',{newPassword:'NewTestUser2026!',confirmPassword:'NewTestUser2026!',confirm:true},admin);ok(response.status===204,'Réinitialisation du mot de passe');
  await login(testName,'NewTestUser2026!');
  response=await request('/api/users','GET',null,admin);ok(response.status===200&&!JSON.stringify(response.data).includes('password_hash')&&!JSON.stringify(response.data).includes(env.ADMIN_PASSWORD),'La liste des utilisateurs ne divulgue aucun hash ni mot de passe');
  const connection={url:mockBase,workspace:'sankurusaco',username:'api_user',password:'mock_password',allowInsecureHttp:true};
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,allowInsecureHttp:false},admin);
  ok(response.status===400&&response.data.error==='HTTP_NON_AUTORISÉ','HTTP refusé sans accord explicite');
  response=await request('/api/settings/survey-solutions/test','POST',connection,admin);
  ok(response.status===200&&response.data.success&&response.data.serverVersion.startsWith('26.09')&&response.data.compatible===true,
    'HTTP autorisé : authentification sur le workspace sankurusaco et Swagger vérifiés');
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,workspace:'interdit'},admin);
  ok(response.status===502&&response.data.error==='ACCÈS_WORKSPACE'&&response.data.message.includes('interdit')&&response.data.message.includes('droits'),
    'HTTP 403 : accès workspace refusé, pas mot de passe déclaré faux');
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,url:`${mockBase}/no-metadata`},admin);
  ok(response.status===200&&response.data.success&&response.data.serverVersion===null&&response.data.compatible===null&&response.data.warnings.length>0,
    'Accès API validé même si page de connexion et Swagger sont fermés');
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,url:`${mockBase}/sankurusaco`},admin);
  ok(response.status===502&&response.data.error==='ROUTE_API_ABSENTE','URL HQ avec workspace ajouté deux fois : diagnostic 404 explicite');
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,password:'bad_password'},admin);
  ok(response.status===502&&response.data.error==='AUTH_API'&&!JSON.stringify(response.data).includes('bad_password'),'HTTP 401 : rejet authentification sans fuite du secret');
  response=await request('/api/settings/survey-solutions','PUT',connection,admin);
  ok(response.status===200&&response.data.hasCredentials&&response.data.allowInsecureHttp&&response.data.workspace==='sankurusaco'&&
    !JSON.stringify(response.data).includes('mock_password')&&!JSON.stringify(response.data).includes('api_user'),
    'Secrets chiffrés, HTTP autorisé et workspace mémorisés sans divulguer les identifiants');
  response=await request('/api/settings/survey-solutions/test','POST',{...connection,url:'http://autre-serveur:8099',username:'',password:''},admin);
  ok(response.status===400&&response.data.error==='IDENTIFIANTS_MANQUANTS','Secret enregistré non transmis automatiquement à un autre serveur');
  response=await request('/api/settings/survey-solutions/test','POST',{},admin);ok(response.status===200&&response.data.status==='CONNECTÉ','Connexion via les identifiants chiffrés enregistrés');
  response=await request('/api/sync','POST',{},admin);
  if(response.status!==200)console.error('SYNC_ERROR',response.data);
  ok(response.status===200&&response.data.questionnaires===1&&response.data.questions===5&&response.data.responses===3,'Synchronisation : 1 questionnaire, 5 questions, 3 entretiens');
  response=await request('/api/questionnaires','GET',null,user);const questionnaire=response.data?.[0];
  ok(response.status===200&&questionnaire.questions_count===5&&questionnaire.responses_count===3,'Détection automatique structure et réponses');
  response=await request(`/api/questionnaires/${questionnaire.id}`,'GET',null,user);
  ok(response.status===200&&response.data.versions.length===1&&response.data.sections.length===3,'Sections, sous-sections et version conservées');
  response=await request(`/api/questions?questionnaireId=${questionnaire.id}`,'GET',null,user);const questions=response.data;
  const age=questions.find(q=>q.variable_name==='age'),email=questions.find(q=>q.variable_name==='email'),consent=questions.find(q=>q.variable_name==='consent');
  ok(response.status===200&&questions.length===5&&age.min_value==='0'&&age.max_value==='120'&&email.enabling_condition==='consent == 1'&&consent.options.length===2,'Question auto : libellé, options, bornes et condition détectés');
  response=await request('/api/quality-rules','POST',{questionId:age.id,type:'range',params:{min:18,max:65},active:true},user);ok(response.status===403,'Utilisateur bloqué sur la modification des règles');
  response=await request('/api/quality-rules','POST',{questionId:age.id,type:'range',params:{min:18,max:65},active:true},admin);ok(response.status===201,'Création de règle de seuil âge');
  const rangeId=response.data.id;
  response=await request('/api/quality-rules','POST',{questionId:email.id,type:'duplicate',params:{questionIds:[consent.id]},active:true},admin);ok(response.status===201,'Création de règle de doublons');
  response=await request('/api/quality-rules','POST',{questionId:email.id,type:'consistency',params:{whenQuestionId:consent.id,operator:'==',value:1},active:true},admin);ok(response.status===201,'Création de règle de cohérence conditionnelle');
  response=await request('/api/quality-rules','POST',{questionId:age.id,type:'min',params:{value:0},active:false},admin);
  ok(response.status===201&&!response.data.active,'Création de règle inactive');
  const temporaryRuleId=response.data.id;
  response=await request(`/api/quality-rules/${temporaryRuleId}`,'PUT',{questionId:age.id,type:'min',params:{value:0},active:true},admin);
  ok(response.status===200&&response.data.active,'Activation de règle et réanalyse transactionnelle');
  response=await request('/api/dashboard','GET',null,user);
  ok(response.status===200&&response.data.metrics.controls===12,'Activation appliquée aux trois entretiens');
  response=await request(`/api/quality-rules/${temporaryRuleId}`,'DELETE',{confirm:true},admin);
  ok(response.status===204,'Suppression de règle et réanalyse transactionnelle');
  response=await request('/api/dashboard','GET',null,user);
  ok(response.status===200&&response.data.metrics.controls===9,'Suppression sans résultats orphelins');
  response=await request('/api/reports?status=NON%20CONFORME','GET',null,user);
  ok(response.status===200&&response.data.total===2&&response.data.items.some(x=>x.variable_name==='age'&&x.value==='72')&&response.data.items.some(x=>x.error_type==='Doublon potentiel'),'Moteur : seuil échoué et doublon détecté, rapport affiché');
  response=await request(`/api/reports?questionnaireId=${questionnaire.id}&questionId=${age.id}&status=NON%20CONFORME`,'GET',null,user);ok(response.status===200&&response.data.total===1,'Filtres rapport questionnaire + question + statut');
  response=await request('/api/reports?supervisor=Superviseur%20Est&status=NON%20CONFORME','GET',null,user);
  ok(response.status===200&&response.data.total===2,'Filtre par superviseur enrichi depuis l’API GraphQL disponible');
  response=await request('/api/reports?interviewer=Agent%20A&status=NON%20CONFORME','GET',null,user);
  ok(response.status===200&&response.data.total===1,'Filtre par enquêteur');
  response=await request('/api/reports?from=2026-09-24&to=2026-09-24','GET',null,user);
  ok(response.status===200&&response.data.total===9,'Filtre par intervalle de dates');
  response=await request('/api/reports?errorType=Doublon%20potentiel','GET',null,user);
  ok(response.status===200&&response.data.total===1,'Filtre par type d’erreur');
  response=await request('/api/activity','GET',null,user);
  ok(response.status===200&&response.data.some(x=>x.action==='Création de règle qualité'),'Journal d’activités consultable');
  response=await request('/api/sync/logs','GET',null,admin);
  ok(response.status===200&&response.data.some(x=>x.status==='TERMINÉ'),'Historique de synchronisation enregistré');
  response=await request('/api/dashboard','GET',null,user);ok(response.status===200&&response.data.metrics.analyzed===3&&response.data.metrics.with_errors===2&&response.data.metrics.failed===2,'Statistiques et tableau de bord cohérents');
  response=await request('/api/exports/errors?format=csv','GET',null,user);ok(response.status===200&&response.raw.toString('utf8').includes('Doublon potentiel'),'Export CSV des erreurs');
  response=await request('/api/exports/results?format=xlsx','GET',null,user);ok(response.status===200&&response.raw.subarray(0,2).toString()==='PK','Export Excel des résultats');
  response=await request('/api/exports/statistics?format=pdf','GET',null,user);ok(response.status===200&&response.raw.subarray(0,4).toString()==='%PDF','Export PDF des statistiques');
  for(const resource of ['questionnaires','questions','rules']){response=await request(`/api/exports/${resource}?format=csv`,'GET',null,resource==='rules'?admin:user);ok(response.status===200&&response.raw.length>30,`Export CSV : ${resource}`);}
  response=await request('/api/sync','POST',{},admin);ok(response.status===200,'Synchronisation répétée (idempotente)');
  response=await request('/api/dashboard','GET',null,user);ok(response.data.metrics.questions===5&&response.data.metrics.analyzed===3&&response.data.metrics.controls===9,'Aucun doublon dans questions, entretiens et résultats');
  const hash=await db(`SELECT password_hash FROM users WHERE username='${env.ADMIN_USERNAME}'`);
  ok(hash.startsWith('$2')&&hash!==env.ADMIN_PASSWORD,'Hash bcrypt du mot de passe initial dans PostgreSQL');
  const encrypted=await db('SELECT password_encrypted FROM survey_solutions_config WHERE id=1');ok(encrypted.includes('.')&&encrypted!=='mock_password','Identifiants API chiffrés AES-GCM dans PostgreSQL');
  const counts=await db('SELECT (SELECT count(*) FROM questionnaires),(SELECT count(*) FROM questions),(SELECT count(*) FROM quality_rules),(SELECT count(*) FROM survey_responses),(SELECT count(*) FROM quality_results)');
  ok(counts==='1|5|3|3|9',`Relations PostgreSQL, données enregistrées : ${counts}`);
  writeFileSync(stateFile,JSON.stringify({questionnaireId:questionnaire.id,ageId:age.id,rangeId,count:counts}));
  console.log(`\nPHASE AVANT REDÉMARRAGE : ${count} vérifications réussies.`);
}
async function after() {
  const state=JSON.parse(readFileSync(stateFile,'utf8'));
  const admin=await login(env.ADMIN_USERNAME,env.ADMIN_PASSWORD);
  const user=await login(env.USER1_USERNAME,env.USER1_PASSWORD);
  let response=await request('/health');ok(response.status===200&&response.data.status==='ok','Healthcheck après redémarrage du backend');
  response=await request('/api/settings/survey-solutions','GET',null,admin);ok(response.status===200&&response.data.hasCredentials&&response.data.serverVersion?.startsWith('26.09')&&response.data.workspace==='sankurusaco'&&response.data.allowInsecureHttp,'Configuration chiffrée et autorisation HTTP conservées après redémarrage');
  response=await request('/api/settings/survey-solutions','GET',null,user);ok(response.status===403,'Permissions toujours appliquées après redémarrage');
  response=await request('/api/quality-rules','GET',null,admin);ok(response.status===200&&response.data.some(x=>x.id===state.rangeId)&&response.data.length===3,'Règles qualité persistées');
  response=await request('/api/reports?status=NON%20CONFORME','GET',null,user);ok(response.status===200&&response.data.total===2,'Résultats qualité persistés');
  response=await request('/api/dashboard','GET',null,user);ok(response.data.metrics.questions===5&&response.data.metrics.analyzed===3&&response.data.metrics.controls===9,'Questionnaires et entretiens persistés');
  const counts=await db('SELECT (SELECT count(*) FROM questionnaires),(SELECT count(*) FROM questions),(SELECT count(*) FROM quality_rules),(SELECT count(*) FROM survey_responses),(SELECT count(*) FROM quality_results)');
  ok(counts===state.count,`Base PostgreSQL intacte : ${counts}`);
  console.log(`\nPHASE APRÈS REDÉMARRAGE : ${count} vérifications réussies.`);
}
if(process.argv[2]==='before')await before();else if(process.argv[2]==='after')await after();else throw new Error('Utilisation: before | after');
