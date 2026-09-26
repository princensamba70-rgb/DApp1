import { QualityStatistics } from '../QualityStatistics';
import { AnomalyTable } from '../AnomalyTable';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, ClipboardList, FileChartColumn, ListChecks, RotateCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { post } from '../api';
import { Empty, Loading, Notice, PageHeader, SectionTitle, useLoad } from '../components';
import { useAuth } from '../App';
import { fmtDate, fmtNum, fmtShort } from '../utils';
import type { Dashboard, Questionnaire } from '../types';

const empty:Dashboard={metrics:{questionnaires:0,questions:0,analyzed:0,compliant:0,with_errors:0,controls:0,passed:0,failed:0,unchecked:0},trend:[],byType:[],recent:[]};
export function DashboardPage() {
  const {user}=useAuth();
  const {data,loading,error,reload}=useLoad('/dashboard',empty);
  const questionnaires=useLoad<Questionnaire[]>('/questionnaires',[]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const m=data.metrics;
  async function synchronize(){setBusy(true);setMessage('');try{await post('/sync',{});setMessage('Synchronisation terminée. Les contrôles ont été recalculés.');reload();questionnaires.reload();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  const metrics=[
    {label:'Questionnaires',value:m.questionnaires,icon:ClipboardList,tone:'blue',caption:'formulaires synchronisés'},
    {label:'Questions détectées',value:m.questions,icon:ListChecks,tone:'purple',caption:'identifiées automatiquement'},
    {label:'Entretiens analysés',value:m.analyzed,icon:Activity,tone:'teal',caption:'réponses disponibles'},
    {label:'Contrôles effectués',value:m.controls,icon:ShieldCheck,tone:'amber',caption:'règles appliquées'},
  ];
  const rate=m.analyzed?Math.round(m.compliant/m.analyzed*100):0;
  return <><PageHeader eyebrow="VUE D’ENSEMBLE  /  PILOTAGE" title={`Bonjour, ${user?.username || 'bienvenue'} 👋`} description="Suivez la qualité de vos données collectées, au même endroit."
    actions={user?.role==='admin'?<button className="button button-primary" onClick={synchronize} disabled={busy}><RotateCw size={17} className={busy?'spin':''}/>{busy?'Synchronisation…':'Synchroniser les données'}</button>:undefined}/>
    {error&&<Notice type="error">{error}</Notice>}{message&&<Notice type={message.startsWith('Synchronisation')?'success':'error'}>{message}</Notice>}
    <div className="welcome-strip"><div className="welcome-icon"><Sparkles size={19}/></div><div><strong>La qualité, en un coup d’œil.</strong><span>Visualisez les tendances, identifiez les anomalies et prenez les bonnes décisions.</span></div><span className="welcome-date">{fmtShort(new Date().toISOString())}</span></div>
    {loading?<Loading/>:<>
      <div className="metric-grid">{metrics.map(({label,value,icon:Icon,tone,caption})=><div className="metric-card" key={label}><div className={`metric-icon metric-${tone}`}><Icon size={22}/></div><div className="metric-label">{label}</div><div className="metric-value">{fmtNum(value)}</div><div className="metric-caption">{caption}</div></div>)}</div>
      <div className="summary-grid"><div className="summary-panel success-panel"><div className="summary-symbol"><CircleCheck size={21}/></div><div><span>Entretiens conformes</span><strong>{fmtNum(m.compliant)}</strong><small>Données vérifiées sans erreur</small></div></div>
      <div className="summary-panel danger-panel"><div className="summary-symbol"><CircleAlert size={21}/></div><div><span>Entretiens avec erreurs</span><strong>{fmtNum(m.with_errors)}</strong><small>Demandent votre attention</small></div></div>
      <div className="summary-panel neutral-panel"><div className="summary-symbol"><ListChecks size={21}/></div><div><span>Contrôles réussis</span><strong>{fmtNum(m.passed)}</strong><small>Sur {fmtNum(m.controls)} contrôles</small></div></div>
      <div className="summary-panel amber-panel"><div className="summary-symbol"><Activity size={21}/></div><div><span>Contrôles échoués</span><strong>{fmtNum(m.failed)}</strong><small>{fmtNum(m.unchecked)} non contrôlés</small></div></div></div>
      <div className="chart-grid"><section className="card chart-card"><SectionTitle title="Évolution des contrôles" subtitle="Réussites et anomalies · 14 derniers jours" action={<Link className="subtle-link" to="/reports">Voir le rapport <ArrowUpRight size={15}/></Link>}/>
        {data.trend.length?<div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{top:8,right:10,left:-23,bottom:4}}><defs><linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#13a998" stopOpacity={.26}/><stop offset="95%" stopColor="#13a998" stopOpacity={0}/></linearGradient><linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ed7764" stopOpacity={.17}/><stop offset="95%" stopColor="#ed7764" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf1f6"/><XAxis dataKey="date" tickFormatter={v=>String(v).slice(5)} tickLine={false} axisLine={false} tick={{fill:'#8998aa',fontSize:11}}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{fill:'#8998aa',fontSize:11}}/><Tooltip labelFormatter={v=>fmtShort(String(v))}/><Area type="monotone" dataKey="passed" name="Conformes" stroke="#13a998" fill="url(#passedGradient)" strokeWidth={2.5}/><Area type="monotone" dataKey="errors" name="Erreurs" stroke="#ed7764" fill="url(#errorGradient)" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div>:<div className="chart-empty">Les tendances apparaîtront après la première analyse.</div>}
        <div className="chart-legend"><span><i className="dot-teal"/> Contrôles conformes</span><span><i className="dot-red"/> Anomalies</span></div></section>
        <section className="card quality-card"><SectionTitle title="Taux de conformité" subtitle="Entretiens sans anomalie détectée / entretiens collectés"/><div className="donut-wrap"><div className="donut" style={{background:`conic-gradient(#16b8a5 ${rate}%, #e8edf3 ${rate}% 100%)`}}><div><strong>{rate}%</strong><small>entretiens conformes</small></div></div></div><div className="quality-details"><div><span><i className="dot-teal"/> Contrôles réussis</span><b>{fmtNum(m.passed)}</b></div><div><span><i className="dot-red"/> Contrôles échoués</span><b>{fmtNum(m.failed)}</b></div><div><span><i className="dot-gray"/> Non contrôlés</span><b>{fmtNum(m.unchecked)}</b></div></div></section></div>
      <div className="bottom-grid"><section className="card table-card"><SectionTitle title="Anomalies récentes" subtitle="Derniers contrôles nécessitant une attention" action={<Link className="subtle-link" to="/reports?status=NON%20CONFORME">Tout voir <ArrowRight size={15}/></Link>}/>
        {data.recent.length?<AnomalyTable items={data.recent}/>:<Empty title="Aucune anomalie" description="Les erreurs détectées s’afficheront ici après synchronisation et configuration des règles."/>}</section>
      <section className="card recent-card"><SectionTitle title="Questionnaires suivis" subtitle="Dernières mises à jour" action={<Link className="subtle-link" to="/questionnaires">Explorer <ArrowRight size={15}/></Link>}/>
        {questionnaires.data.length?<div className="recent-list">{questionnaires.data.slice(0,4).map(q=><Link to={`/questionnaires/${q.id}`} className="recent-item" key={q.id}><div className="recent-item-icon"><ClipboardList size={18}/></div><div><b>{q.title}</b><small>Version {q.version} · {fmtDate(q.last_synced_at)}</small></div><ArrowRight size={16}/></Link>)}</div>:<Empty title="Aucun questionnaire" description="Connectez votre serveur Survey Solutions pour détecter automatiquement vos formulaires." action={user?.role==='admin'?<Link to="/settings/connection" className="button button-secondary">Configurer la connexion</Link>:undefined}/>}
      </section></div>
    </>}
    <QualityStatistics revision={m.failed+m.analyzed}/><div className="dashboard-footer"><FileChartColumn size={17}/><span>Besoin d’une vue détaillée ? Consultez les rapports ou exportez vos données.</span><Link to="/reports">Accéder aux rapports <ArrowRight size={15}/></Link></div>
  </>;
}
