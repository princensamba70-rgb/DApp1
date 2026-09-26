import { AnomalyTable } from '../AnomalyTable';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowRight, CircleAlert, CircleCheck, Filter, ListChecks, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { download } from '../api';
import { useAuth } from '../App';
import { Badge, Empty, Loading, Notice, PageHeader, SectionTitle, useLoad } from '../components';
import { fmtNum, paramsText, ruleNames, valueText } from '../utils';
import type { Question, Questionnaire, Report, Rule } from '../types';

const blank:Report={items:[],total:0,summary:{total:0,passed:0,failed:0,unchecked:0},page:1,pageSize:20};
export function QualityPage() {
  const {user}=useAuth();
  const results=useLoad<Report>('/quality-results?pageSize=8',blank);

  const latest=results.data.items;
  return <><PageHeader eyebrow="CONTRÔLE QUALITÉ  /  RÉSULTATS" title="Contrôle qualité" description="Identifiez les anomalies et les vérifications nécessaires sur les réponses collectées." actions={user?.role==='admin'?<Link to="/settings/rules" className="button button-primary"><SlidersHorizontal size={17}/> Configurer les règles</Link>:undefined}/>
    {results.error&&<Notice type="error">{results.error}</Notice>}
    <div className="quality-overview"><div className="overview-card"><span className="overview-icon teal"><CircleCheck size={22}/></span><div><small>Contrôles conformes</small><strong>{fmtNum(results.data.summary.passed)}</strong></div></div><div className="overview-card"><span className="overview-icon red"><CircleAlert size={22}/></span><div><small>Échecs détectés</small><strong>{fmtNum(results.data.summary.failed)}</strong></div></div><div className="overview-card"><span className="overview-icon blue"><ListChecks size={22}/></span><div><small>Non contrôlés</small><strong>{fmtNum(results.data.summary.unchecked)}</strong></div></div><div className="overview-card"><span className="overview-icon purple"><ShieldCheck size={22}/></span><div><small>Résultats disponibles</small><strong>{fmtNum(results.data.total)}</strong></div></div></div>
    <section className="card table-card"><SectionTitle title="Derniers résultats" subtitle="Chaque ligne correspond à une règle évaluée sur une réponse" action={<Link to="/reports" className="subtle-link">Rapport complet <ArrowRight size={16}/></Link>}/>
      {results.loading?<Loading/>:latest.length?<div className="table-scroll"><table><thead><tr><th>QUESTIONNAIRE / QUESTION</th><th>VALEUR</th><th>CONTRÔLE</th><th>ENQUÊTEUR</th><th>RÉSULTAT</th></tr></thead><tbody>{latest.map(r=><tr key={r.id}><td><b>{r.questionnaire_title}</b><small>{r.variable_name} · {r.question_label}</small></td><td className="mono">{valueText(r.value)}</td><td>{r.error_type||r.status}</td><td>{r.interviewer||'—'}</td><td><Badge>{r.status}</Badge></td></tr>)}</tbody></table></div>:<Empty title="Aucun contrôle effectué" description="Synchronisez vos entretiens et configurez des règles pour voir les premiers résultats."/>}
    </section>
    {user?.role==='admin'&&<RulesSummary/>}
  </>;
}

function RulesSummary() {
 const {user}=useAuth();
 const rules=useLoad<Rule[]>('/quality-rules',[]);
 return <>    <section className="card table-card lower-card"><SectionTitle title="Règles de contrôle" subtitle="Les vérifications actives sur vos questions" action={user?.role==='admin'?<Link to="/settings/rules" className="subtle-link">Gérer les règles <ArrowRight size={16}/></Link>:undefined}/>
      {rules.loading?<Loading/>:rules.data.length?<div className="table-scroll"><table><thead><tr><th>QUESTION</th><th>TYPE DE CONTRÔLE</th><th>PARAMÈTRES</th><th>STATUT</th></tr></thead><tbody>{rules.data.slice(0,8).map(r=><tr key={r.id}><td><b>{r.variable_name}</b><small>{r.question_label}</small></td><td>{ruleNames[r.type]}</td><td className="mono">{paramsText(r.type,r.params)}</td><td><Badge tone={r.active?'success':'neutral'}>{r.active?'Actif':'Inactif'}</Badge></td></tr>)}</tbody></table></div>:<Empty title="Aucune règle configurée" description="Les règles qualité se créent à partir des questions détectées dans vos questionnaires."/>}
    </section></>;
}

type FormFilters={questionnaireId:string;questionId:string;interviewer:string;supervisor:string;from:string;to:string;status:string;errorType:string};
const filterFields:(keyof FormFilters)[]=['questionnaireId','questionId','interviewer','supervisor','from','to','status','errorType'];
function fieldsFromParams(p:URLSearchParams):FormFilters {return Object.fromEntries(filterFields.map(k=>[k,p.get(k)||''])) as FormFilters;}
export function ReportPage() {
  const [params,setParams]=useSearchParams();
  const [fields,setFields]=useState<FormFilters>(()=>fieldsFromParams(params)),[resource,setResource]=useState('results'),[format,setFormat]=useState<'csv'|'xlsx'|'pdf'>('xlsx'),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const query=useMemo(()=>params.toString(),[params]);
  const results=useLoad<Report>(`/reports${query?'?'+query:''}`,blank);
  const questionnaires=useLoad<Questionnaire[]>('/questionnaires',[]),questions=useLoad<Question[]>('/questions',[]);
  const filteredQuestions=questions.data.filter(q=>!fields.questionnaireId||q.questionnaire_id===fields.questionnaireId);
  function setField(key:keyof FormFilters,val:string){setFields(prev=>({...prev,[key]:val,...(key==='questionnaireId'?{questionId:''}:{})}));}
  function apply(){const p=new URLSearchParams();for(const key of filterFields)if(fields[key])p.set(key,fields[key]);setParams(p);}
  function reset(){setFields(fieldsFromParams(new URLSearchParams()));setParams(new URLSearchParams());}
  function go(page:number){const p=new URLSearchParams(params);p.set('page',String(page));setParams(p);}
  async function exportData(){setExporting(true);setExportError('');try{const p=new URLSearchParams(params);p.delete('page');p.delete('pageSize');await download(resource,format,p.toString());}catch(e){setExportError((e as Error).message);}finally{setExporting(false);}}
  const pages=Math.max(1,Math.ceil(results.data.total/results.data.pageSize));
  return <><PageHeader eyebrow="ANALYSE  /  RAPPORT QUALITÉ" title="Rapports & analyses" description="Explorez vos contrôles, filtrez les anomalies et exportez vos résultats."/>
    {results.error&&<Notice type="error">{results.error}</Notice>}{exportError&&<Notice type="error">{exportError}</Notice>}
    <div className="report-highlights"><div><span className="mini-icon blue"><ListChecks size={17}/></span><small>Résultats filtrés</small><b>{fmtNum(results.data.total)}</b></div><div><span className="mini-icon teal"><CircleCheck size={17}/></span><small>Conformes</small><b>{fmtNum(results.data.summary.passed)}</b></div><div><span className="mini-icon red"><CircleAlert size={17}/></span><small>Échecs</small><b>{fmtNum(results.data.summary.failed)}</b></div><div><span className="mini-icon gray"><Filter size={17}/></span><small>Non contrôlés</small><b>{fmtNum(results.data.summary.unchecked)}</b></div></div>
    <section className="card filter-card"><div className="filter-heading"><div><Filter size={19}/><b>Filtres avancés</b><span>Affinez vos données en quelques clics</span></div><button className="ghost-button" type="button" onClick={reset}>Effacer les filtres</button></div>
      <div className="filter-grid"><label>Questionnaire<select value={fields.questionnaireId} onChange={e=>setField('questionnaireId',e.target.value)}><option value="">Tous les questionnaires</option>{questionnaires.data.map(q=><option key={q.id} value={q.id}>{q.title}</option>)}</select></label><label>Question<select value={fields.questionId} onChange={e=>setField('questionId',e.target.value)}><option value="">Toutes les questions</option>{filteredQuestions.map(q=><option key={q.id} value={q.id}>{q.variable_name} · {q.label}</option>)}</select></label>
      <label>Statut<select value={fields.status} onChange={e=>setField('status',e.target.value)}><option value="">Tous les statuts</option><option>CONFORME</option><option>NON CONFORME</option><option>NON CONTRÔLÉ</option></select></label><label>Type d’erreur<select value={fields.errorType} onChange={e=>setField('errorType',e.target.value)}><option value="">Tous les types</option>{['Village répété','Valeur hors plage','Information manquante','Valeur non autorisée','Format incorrect','Longueur incorrecte','Valeurs incohérentes','Incohérence dans les réponses','Doublon exact','Doublon probable','Doublon potentiel','Localisation administrative incohérente','Durée de collecte inhabituelle','Dates incohérentes','Valeur inhabituelle','Activité inhabituelle détectée'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Enquêteur<input value={fields.interviewer} onChange={e=>setField('interviewer',e.target.value)} placeholder="Nom de l’enquêteur"/></label><label>Superviseur<input value={fields.supervisor} onChange={e=>setField('supervisor',e.target.value)} placeholder="Nom du superviseur"/></label><label>Date de début<input type="date" value={fields.from} onChange={e=>setField('from',e.target.value)}/></label><label>Date de fin<input type="date" value={fields.to} onChange={e=>setField('to',e.target.value)}/></label></div>
      <div className="filter-actions"><button type="button" className="button button-primary" onClick={apply}><Search size={16}/> Appliquer les filtres</button></div></section>
    <section className="card table-card report-table"><div className="report-top"><SectionTitle title="Résultats des contrôles" subtitle={`${fmtNum(results.data.total)} résultat(s) correspondant à votre sélection`}/><div className="export-bar"><select aria-label="Contenu de l’export" value={resource} onChange={e=>setResource(e.target.value)}><option value="results">Résultats</option><option value="errors">Liste des erreurs</option><option value="statistics">Statistiques</option><option value="questionnaires">Questionnaires</option><option value="questions">Questions</option></select><select aria-label="Format d’export" value={format} onChange={e=>setFormat(e.target.value as 'csv'|'xlsx'|'pdf')}><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="pdf">PDF</option></select><button className="button button-secondary" type="button" onClick={exportData} disabled={exporting}><ArrowDownToLine size={17}/>{exporting?'Export…':'Exporter'}</button></div></div>
      {results.loading?<Loading/>:results.data.items.length?<AnomalyTable items={results.data.items}/>:<Empty title="Aucun résultat à afficher" description="Ajustez vos filtres ou lancez une synchronisation après avoir créé des règles qualité."/>}
      {results.data.total>results.data.pageSize&&<div className="pagination"><span>Page {results.data.page} sur {pages}</span><div><button type="button" disabled={results.data.page<=1} onClick={()=>go(results.data.page-1)}>Précédent</button><button type="button" disabled={results.data.page>=pages} onClick={()=>go(results.data.page+1)}>Suivant <ArrowRight size={14}/></button></div></div>}
    </section>
  </>;
}
