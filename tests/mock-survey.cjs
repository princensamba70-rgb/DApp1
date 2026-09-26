// Serveur de test UNIQUEMENT. Les chemins et formes JSON suivent le Swagger officiel 26.09.
const http = require('node:http');
const BASE = '11111111-1111-4111-8111-111111111111';
const Q = Object.fromEntries(['yes','age','email','date','score'].map((name,i) => [name,`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`]));
const I = [1,2,3].map(i => `33333333-3333-4333-8333-${String(i).padStart(12,'0')}`);
const document = {
  Title: 'Enquête ménages · Kinshasa', PublicKey: BASE, VariableName: 'household',
  Children: [
    {$type:'Group', PublicKey:'44444444-4444-4444-8444-444444444441',Title:'Profil du ménage',VariableName:'profile',Children:[
      {$type:'SingleQuestion',QuestionType:0,PublicKey:Q.yes,VariableName:'consent',QuestionText:'Consentement à participer',Answers:[{AnswerValue:1,AnswerText:'Oui'},{AnswerValue:2,AnswerText:'Non'}]},
      {$type:'NumericQuestion',QuestionType:4,PublicKey:Q.age,VariableName:'age',QuestionText:'Âge du répondant',IsInteger:true,ValidationConditions:[{Expression:'age >= 0',Message:'Age >= 0'},{Expression:'age <= 120',Message:'Age <= 120'}]},
      {$type:'TextQuestion',QuestionType:7,PublicKey:Q.email,VariableName:'email',QuestionText:'Adresse email',ConditionExpression:'consent == 1'},
    ]},
    {$type:'Group',PublicKey:'44444444-4444-4444-8444-444444444442',Title:'Données de visite',VariableName:'visit',Children:[
      {$type:'DateTimeQuestion',QuestionType:5,PublicKey:Q.date,VariableName:'visit_date',QuestionText:'Date de visite'},
      {$type:'Group',PublicKey:'44444444-4444-4444-8444-444444444443',Title:'Membres du foyer',VariableName:'members',IsRoster:true,Children:[
        {$type:'NumericQuestion',QuestionType:4,PublicKey:Q.score,VariableName:'score',QuestionText:'Score observé',IsInteger:true},
      ]},
    ]},
  ],
};
const source = [
  { id:I[0], interviewer:'Agent A', date:'2026-09-24T06:00:00Z', answers:{consent:'1',age:'72',email:'alice@example.org',visit_date:'2026-09-24',score:['8','12']} },
  { id:I[1], interviewer:'Agent B', date:'2026-09-24T06:01:00Z', answers:{consent:'2',age:'25',visit_date:'2026-09-24',score:['9']} },
  { id:I[2], interviewer:'Agent C', date:'2026-09-24T06:02:00Z', answers:{consent:'1',age:'19',email:'alice@example.org',visit_date:'2026-09-24',score:['4']} },
];
// Opt-in synthetic acceptance fixture; never enabled against production HQ.
if(process.env.QUALITY_FIXTURES==='1') {
  document.Children=[];
  const names=['village','aire_de_sante','zone_de_sante','telephone','age','date_naissance','debut','fin','identifiant_menage','nom'];
  names.forEach((name,i)=>{
    Q[name]=`22222222-2222-4222-8222-${String(100+i).padStart(12,'0')}`;
    document.Children.push({$type:name==='age'?'NumericQuestion':'TextQuestion',QuestionType:name==='age'?4:7,PublicKey:Q[name],VariableName:name,QuestionText:name,IsRequired:name==='nom'});
  });
  source.splice(0);
  [5,6,9,14].forEach((count,group)=>{
    for(let j=0;j<count;j++) {
      const i=source.length+1;
      source.push({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,interviewer:'ENQ024',date:'2026-09-26T10:00:00Z',answers:{
        village:['A','B','C','D'][group],aire_de_sante:'Kimputu',zone_de_sante:'Zone 1',telephone:`+24381${String(i).padStart(7,'0')}`,age:26,date_naissance:'2000-01-01',debut:'2026-09-26T10:00:00Z',fin:'2026-09-26T10:30:00Z',identifiant_menage:`M${i}`,nom:`Ménage ${i}`
      }});
    }
  });
  source[0].answers.telephone='abc';
  delete source[1].answers.nom;
  source[2].answers.age=70;
  source[3].answers.identifiant_menage=source[4].answers.identifiant_menage;
}
const swagger = { info:{version:'v1'},paths: {
  '/api/v1/questionnaires':{get:{}},
  '/api/v1/questionnaires/{id}/{version}/document':{get:{}},
  '/api/v1/interviews':{get:{}},
  '/api/v1/interviews/{id}':{get:{}},
}};
function json(res,data,status=200) { res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data)); }
http.createServer((req,res) => {
  const url = new URL(req.url,'http://mock-survey');
  const path = url.pathname.replace(/^\/no-metadata(?=\/)/,'');
  // Ces pages publiques ne prouvent PAS que le compte API a accès au workspace.
  // Sur certains HQ, envoyer Basic à la page de connexion peut même retourner 401.
  if (path==='/Account/LogOn') {
    if (url.pathname.startsWith('/no-metadata/')) return json(res,{error:'Page non accessible'},403);
    if (req.headers.authorization) return json(res,{error:'Connexion interactive refusée au compte API'},401);
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<html><script>window.CONFIG={"appVersion":\'26.09 (build 41860)\'}</script></html>');return;
  }
  if (path==='/swagger/v1/swagger.json') return url.pathname.startsWith('/no-metadata/')
    ? json(res,{error:'Swagger privé'},403) : json(res,swagger);
  const auth = 'Basic '+Buffer.from('api_user:mock_password').toString('base64');
  if (req.headers.authorization !== auth) return json(res,{error:'Unauthorized'},401);
  if (path==='/graphql' && req.method==='POST') {
    const chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload.query?.includes('supervisorName')) return json(res,{errors:[{message:'Champ inconnu'}]});
      return json(res,{data:{interviews:{nodes:source.map((x,i)=>({id:x.id,responsibleName:x.interviewer,responsibleRole:'Interviewer',supervisorName:i===1?'Superviseur Ouest':'Superviseur Est'}))}}});
    });
    return;
  }
  const workspacePath=path.replace(/^\/(?:primary|sankurusaco)(?=\/api\/v1\/)/,'');
  if (workspacePath==='/api/v1/questionnaires' && path!==workspacePath) return json(res,{Questionnaires:[{QuestionnaireId:BASE,QuestionnaireIdentity:`${BASE}$1`,Title:'Enquête ménages · Kinshasa',Variable:'household',Version:1,LastEntryDate:'2026-09-24T06:00:00Z'}],TotalCount:1,Limit:40,Offset:1});
  if (workspacePath===`/api/v1/questionnaires/${BASE}/1/document` && path!==workspacePath) return json(res,document);
  if (workspacePath==='/api/v1/interviews' && path!==workspacePath) return json(res,{Interviews:source.map(x=>({InterviewId:x.id,QuestionnaireId:BASE,QuestionnaireVersion:1,ResponsibleName:x.interviewer,Status:'Completed',LastEntryDate:x.date,ErrorsCount:0})),TotalCount:source.length,Limit:100,Offset:1});
  if (/^\/[^/]+\/api\/v1\/questionnaires$/.test(path)) return json(res,{error:'Workspace interdit au compte API'},403);
  const interview = source.find(x => workspacePath===`/api/v1/interviews/${x.id}` && path!==workspacePath);
  if (interview) {
    const Answers = [];
    for (const [variable,val] of Object.entries(interview.answers)) {
      for (const [i,answer] of (Array.isArray(val)?val:[val]).entries()) Answers.push({VariableName:variable,QuestionId:{Id:Q[({consent:'yes',visit_date:'date'})[variable]||variable],RosterVector:Array.isArray(val)?[i]:[]},Answer:answer});
    }
    return json(res,{Answers});
  }
  return json(res,{error:'Not found'},404);
}).listen(Number(process.env.MOCK_PORT)||8099,'0.0.0.0',()=>console.log('Mock Survey Solutions prêt : 8099 (jeu de données synthétique)'));
