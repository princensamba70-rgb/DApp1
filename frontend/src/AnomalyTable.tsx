import type {Result} from './types';
import {Badge} from './components';
export function AnomalyTable({items}:{items:Result[]}) {
  return <div className="table-scroll"><table><thead><tr><th>Occurrence</th><th>Statut et détails</th><th>Gravité</th><th>Enquêteur / Superviseur</th><th>Village / Aire de santé</th><th>Questionnaire</th><th>Score qualité</th></tr></thead><tbody>{items.map(r=><tr key={r.id}>
    <td className="mono">{r.occurrence??1}</td><td style={{minWidth:320,maxWidth:580,whiteSpace:'normal'}}><b>{r.error_type||r.status}</b><p style={{lineHeight:1.6}}>{r.details}</p><small>{r.question_label}{r.instance_key?` · Membre ${r.instance_key}`:''}</small></td>
    <td><Badge tone={r.severity==='CRITIQUE'?'danger':r.severity==='MAJEURE'?'warning':'neutral'}>{r.status==='NON CONFORME'?r.severity:'—'}</Badge></td>
    <td>{r.interviewer||'—'}<small>{r.supervisor||'—'}</small></td><td>{r.context?.village||'—'}<small>{r.context?.healthArea||'—'} · {r.context?.healthZone||''}</small></td>
    <td>{r.questionnaire_title}<small className="mono">{r.interview_id}</small></td><td>{r.quality_score==null?'Non évalué':`${r.quality_score} %`}<small>{r.quality_class}</small></td>
  </tr>)}</tbody></table></div>;
}
