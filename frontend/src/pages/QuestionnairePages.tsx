import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, ClipboardList, Filter, Hash, Layers3, RotateCw, Search, Settings2 } from 'lucide-react';
import { post } from '../api';
import { useAuth } from '../App';
import { Badge, Empty, Loading, Notice, PageHeader, SectionTitle, useLoad } from '../components';
import { fmtDate, fmtNum } from '../utils';
import type { Question, Questionnaire, QuestionnaireDetails, Section } from '../types';

export function QuestionnaireListPage() {
  const {user}=useAuth(), {data,loading,error,reload}=useLoad<Questionnaire[]>('/questionnaires',[]);
  const [search,setSearch]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
  const items=data.filter(q=>`${q.title} ${q.variable} ${q.external_id}`.toLowerCase().includes(search.toLowerCase()));
  async function sync(id:string,external:string) {setBusy(id);setMessage('');try {await post('/sync',{questionnaireId:external});setMessage('Questionnaire synchronisé avec succès.');reload();}catch(err){setMessage((err as Error).message);}finally{setBusy('');}}
  return <><PageHeader eyebrow="COLLECTE  /  STRUCTURE" title="Questionnaires" description="Vos formulaires et leurs versions, directement synchronisés depuis Survey Solutions." actions={user?.role==='admin'?<Link className="button button-secondary" to="/settings/connection"><Settings2 size={17}/> Connexion API</Link>:undefined}/>
    {error&&<Notice type="error">{error}</Notice>}{message&&<Notice type={message.includes('succès')?'success':'error'}>{message}</Notice>}
    <div className="toolbar"><div className="search-field"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un questionnaire…" aria-label="Rechercher un questionnaire"/></div><span className="toolbar-count">{fmtNum(items.length)} questionnaire{items.length>1?'s':''}</span></div>
    {loading?<Loading/>:items.length?<div className="questionnaire-grid">{items.map(q=><div className="questionnaire-card" key={q.id}><div className="questionnaire-card-top"><div className="doc-icon"><ClipboardList size={22}/></div><Badge tone="success">{q.status}</Badge></div><div className="questionnaire-overline">{q.variable || 'QUESTIONNAIRE'}  ·  V{q.version}</div><h2>{q.title}</h2><div className="questionnaire-id" title={q.external_id}>ID : {q.external_id}</div><div className="questionnaire-stats"><div><strong>{fmtNum(q.questions_count)}</strong><span>questions</span></div><div><strong>{fmtNum(q.responses_count)}</strong><span>entretiens</span></div><div><strong>{fmtNum(q.versions_count)}</strong><span>versions</span></div></div><div className="questionnaire-card-footer"><span>Mis à jour {fmtDate(q.last_synced_at)}</span><div>{user?.role==='admin'&&<button type="button" className="icon-button" title="Synchroniser" disabled={busy===q.id} onClick={()=>sync(q.id,q.external_id)}><RotateCw size={17} className={busy===q.id?'spin':''}/></button>}<Link to={`/questionnaires/${q.id}`} className="round-link" aria-label={`Consulter ${q.title}`}><ArrowRight size={17}/></Link></div></div></div>)}</div>:<Empty title={search?'Aucun résultat':'Aucun questionnaire synchronisé'} description={search?'Essayez une autre recherche.':'Configurez la connexion Survey Solutions, puis lancez une synchronisation. Les questions seront découvertes automatiquement.'} action={!search&&user?.role==='admin'?<Link to="/settings/connection" className="button button-primary">Configurer Survey Solutions <ArrowRight size={17}/></Link>:undefined}/>}
  </>;
}

export function QuestionnaireDetailPage() {
  const {id}=useParams(),{user}=useAuth();
  const {data,loading,error,reload}=useLoad<QuestionnaireDetails|null>(`/questionnaires/${id}`,null);
  const [versionId,setVersionId]=useState(''),[sectionId,setSectionId]=useState(''),[search,setSearch]=useState(''),[expanded,setExpanded]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(data?.versions.length&&!data.versions.some(v=>v.id===versionId))setVersionId(data.versions[0]!.id);},[data,versionId]);
  const {data:questions,loading:questionsLoading}=useLoad<Question[]>(versionId?`/questions?questionnaireId=${id}&versionId=${versionId}`:`/questions?questionnaireId=${id}`,[]);
  const sections=useMemo(()=>data?.sections.filter(s=>s.version_id===versionId)||[],[data,versionId]);
  function isSection(q:Question,selected:string,tree:Section[]):boolean {
    if(!selected)return true;
    if(q.section_id===selected)return true;
    let parent=tree.find(s=>s.id===q.section_id)?.parent_id;
    while(parent){if(parent===selected)return true;parent=tree.find(s=>s.id===parent)?.parent_id || null;}
    return false;
  }
  const shown=questions.filter(q=>isSection(q,sectionId,sections)&&`${q.variable_name} ${q.label}`.toLowerCase().includes(search.toLowerCase()));
  async function sync(){if(!data)return;setBusy(true);setMessage('');try{await post('/sync',{questionnaireId:data.external_id});setMessage('Structure et réponses mises à jour.');reload();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  if(loading)return <Loading/>;
  if(error||!data)return <Notice type="error">{error||'Questionnaire introuvable.'}</Notice>;
  const current=data.versions.find(v=>v.id===versionId);
  return <><Link to="/questionnaires" className="back-link"><ArrowLeft size={16}/> Tous les questionnaires</Link>
    <PageHeader eyebrow={`QUESTIONNAIRE  /  ${data.variable || 'DÉTAIL'}`} title={data.title} description={`Identifiant Survey Solutions : ${data.external_id}`} actions={<>{user?.role==='admin'&&<button className="button button-secondary" type="button" disabled={busy} onClick={sync}><RotateCw size={17} className={busy?'spin':''}/> Synchroniser</button>}<Badge tone="success">{data.status}</Badge></>}/>
    {message&&<Notice type={message.startsWith('Structure')?'success':'error'}>{message}</Notice>}
    <div className="detail-stats"><div><Layers3 size={20}/><div><b>{fmtNum(data.versions.length)}</b><span>versions conservées</span></div></div><div><BookOpen size={20}/><div><b>{fmtNum(current?.questions_count)}</b><span>questions détectées</span></div></div><div><Hash size={20}/><div><b>{fmtNum(current?.responses_count)}</b><span>entretiens reçus</span></div></div><div><RotateCw size={20}/><div><b className="date-value">{fmtDate(data.last_synced_at)}</b><span>dernière synchronisation</span></div></div></div>
    <div className="detail-layout"><aside className="card sections-card"><SectionTitle title="Structure" subtitle="Sections & sous-sections"/><div className="section-list"><button type="button" className={`section-list-item ${!sectionId?'selected':''}`} onClick={()=>setSectionId('')}><Layers3 size={16}/> Toutes les sections <span>{questions.length}</span></button>{sections.map(s=><button type="button" key={s.id} style={{paddingLeft:s.parent_id?30:13}} className={`section-list-item ${sectionId===s.id?'selected':''}`} onClick={()=>setSectionId(s.id)}><ChevronRight size={15}/><span title={s.title}>{s.title}</span><span>{questions.filter(q=>q.section_id===s.id).length}</span></button>)}</div></aside>
    <section className="card questions-card"><div className="questions-head"><SectionTitle title="Questions" subtitle="Détectées depuis la structure Survey Solutions"/><select aria-label="Version du questionnaire" value={versionId} onChange={e=>{setVersionId(e.target.value);setSectionId('');}}>{data.versions.map(v=><option key={v.id} value={v.id}>Version {v.version}</option>)}</select></div>
      <div className="questions-toolbar"><div className="search-field"><Search size={17}/><input placeholder="Chercher une question, une variable…" aria-label="Chercher une question" value={search} onChange={e=>setSearch(e.target.value)}/></div><span><Filter size={15}/> {shown.length} question{shown.length>1?'s':''}</span></div>
      {questionsLoading?<Loading/>:shown.length?<div className="question-list">{shown.map((q,i)=><div className={`question-item ${expanded===q.id?'question-expanded':''}`} key={q.id}><button className="question-row" type="button" onClick={()=>setExpanded(expanded===q.id?'':q.id)} aria-expanded={expanded===q.id}><span className="question-index">{String(i+1).padStart(2,'0')}</span><div className="question-main"><b>{q.label}</b><small><code>{q.variable_name}</code> · {q.section_title||'Sans section'}</small></div><span className="type-pill">{q.type}</span><span className="rule-count">{q.rules_count} règle{q.rules_count>1?'s':''}</span><ChevronDown size={17} className="question-chevron"/></button>{expanded===q.id&&<div className="question-meta"><div><span>Identifiant</span><code>{q.external_id}</code></div><div><span>Options</span><strong>{q.options.length?q.options.map(o=>`${o.value} = ${o.text}`).join(' · '):'Non applicable'}</strong></div><div><span>Contraintes Survey Solutions</span><strong>{q.constraints.length?q.constraints.map(c=>c.Expression||'Contrainte').join(' · '):'Aucune'}</strong></div><div><span>Condition d’activation</span><strong>{q.enabling_condition||'Toujours applicable'}</strong></div><div><span>Bornes détectées</span><strong>{q.min_value??'—'} / {q.max_value??'—'}</strong></div>{user?.role==='admin'&&<Link to={`/settings/rules?questionnaireId=${data.id}&questionId=${q.id}`} className="text-link"><Settings2 size={15}/> Configurer un contrôle</Link>}</div>}</div>)}</div>:<Empty title="Aucune question" description="Aucune question ne correspond aux filtres ou la structure n’est pas encore synchronisée."/>}
    </section></div>
  </>;
}
