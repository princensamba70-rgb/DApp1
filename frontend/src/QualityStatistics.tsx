import {Link} from 'react-router-dom';
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {useLoad,Loading,Notice,SectionTitle} from './components';
type Series={name:string;count:number}[];
type Statistics={summary:Record<string,number|string|null>;severity:{severity:string;count:number}[];missing:{missing:number;eligible:number};types:Series;interviewers:Series;villages:Series;areas:Series;zones:Series;questions:Series;trend:Series;scores:Series};
export function QualityStatistics({revision=0}:{revision?:number}) {
  const {data,loading,error}=useLoad<Statistics|null>(`/intelligence/statistics?revision=${revision}`,null);
  if(error)return <Notice type="error">{error}</Notice>;
  if(loading||!data)return <Loading/>;
  const s=data.summary,ratio=(a:number,b:number)=>b?`${(100*a/b).toFixed(1)} %`:'Non évalué';
  const metrics:[string,string|number|null][]=[['Questionnaires collectés',s.total],['Sans anomalie détectée',s.compliant],['Avec anomalies',s.with_errors],['Non évalués',s.unchecked],['Anomalies',data.severity.reduce((n,x)=>n+x.count,0)],...data.severity.map(x=>[x.severity,x.count] as [string,number]),['Doublons exacts (entretiens)',s.exact_duplicates],['Doublons à vérifier (entretiens)',s.possible_duplicates],['Villages dépassant le seuil',s.repeated_villages],['Enquêteurs avec anomalies',s.interviewers],['Score moyen',s.quality==null?'Non évalué':`${s.quality} %`],['Données manquantes',ratio(data.missing.missing,data.missing.eligible)],['Questionnaires conformes',ratio(Number(s.compliant),Number(s.total))]].map(([k,v])=>[String(k),v??null]);
  const charts:[string,Series][]=[['Anomalies par type',data.types],['Anomalies par enquêteur',data.interviewers],['Anomalies par village',data.villages],['Anomalies par aire de santé',data.areas],['Anomalies par zone de santé',data.zones],['Questions les plus concernées',data.questions],['Anomalies par date de modification',data.trend],['Score moyen par date de modification',data.scores]];
  return <section className="quality-statistics"><SectionTitle title="STATISTIQUES DE QUALITÉ DES DONNÉES" subtitle="Résultats persistés après synchronisation — aucune réanalyse à l’affichage" action={<Link to="/reports?status=NON%20CONFORME">Voir les anomalies →</Link>}/>
    <div className="intelligence-metrics">{metrics.map(([k,v])=><div className="card" key={k}><small>{k}</small><strong>{v??'—'}</strong></div>)}</div>
    <p className="quality-note">Une anomalie de groupe apparaît sur chaque entretien concerné. Les doublons restent à vérifier. Le score est un indicateur pondéré, pas une certification. Les données manquantes excluent les questions conditionnelles et les rosters dont l’applicabilité est inconnue.</p>
    <div className="chart-grid">{charts.map(([title,rows])=><section className="card chart-card" key={title}><SectionTitle title={title} subtitle="Les 10 premiers résultats"/>{rows.length?<div style={{height:230}}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.slice(0,10)} margin={{bottom:30,left:0,right:20}}><CartesianGrid vertical={false}/><XAxis dataKey="name" tick={{fontSize:10}} interval={0} angle={-15} textAnchor="end"/><YAxis/><Tooltip/><Bar dataKey="count" name={title.startsWith('Score')?'Score (%)':'Anomalies'} fill="#13a998" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>:<p className="quality-note">Aucune donnée disponible.</p>}</section>)}</div>
  </section>;
}
