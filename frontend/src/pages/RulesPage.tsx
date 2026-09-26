import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, BookOpen, CircleHelp, Pencil, Save, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, download, post, put, remove } from '../api';
import { Badge, Empty, Loading, Notice, PageHeader, SectionTitle, useLoad } from '../components';
import { fmtDate, paramsText, ruleNames } from '../utils';
import type { Question, Questionnaire, QuestionnaireDetails, Rule, RuleType } from '../types';

const types:RuleType[]=['range','min','max','equals','not_equals','allowed','required','format','min_length','max_length','compare','consistency','duplicate'];
const numericTypes:RuleType[]=['min','max','min_length','max_length'];
export function RulesPage() {
  const [urlParams]=useSearchParams();
  const list=useLoad<Questionnaire[]>('/questionnaires',[]);
  const [questionnaireId,setQuestionnaireId]=useState(urlParams.get('questionnaireId')||''),[details,setDetails]=useState<QuestionnaireDetails|null>(null),[versionId,setVersionId]=useState(''),[sectionId,setSectionId]=useState(''),[questionId,setQuestionId]=useState(urlParams.get('questionId')||'');
  const questions=useLoad<Question[]>(questionnaireId?`/questions?questionnaireId=${questionnaireId}`:'/questions',[]);
  const rules=useLoad<Rule[]>(questionnaireId?`/quality-rules?questionnaireId=${questionnaireId}`:'/quality-rules',[]);
  const [type,setType]=useState<RuleType>('range'),[min,setMin]=useState(''),[max,setMax]=useState(''),[ruleValue,setRuleValue]=useState(''),[allowed,setAllowed]=useState(''),[format,setFormat]=useState('integer'),[other,setOther]=useState(''),[operator,setOperator]=useState('<=');
  const [whenQuestion,setWhenQuestion]=useState(''),[whenOperator,setWhenOperator]=useState('=='),[whenValue,setWhenValue]=useState(''),[duplicateIds,setDuplicateIds]=useState<string[]>([]),[active,setActive]=useState(true),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<{text:string;type:'success'|'error'}|null>(null);
  useEffect(()=>{if(!questionnaireId&&list.data.length)setQuestionnaireId(list.data[0]!.id);},[list.data,questionnaireId]);
  useEffect(()=>{let mounted=true;if(questionnaireId)api<QuestionnaireDetails>(`/questionnaires/${questionnaireId}`).then(result=>{if(mounted)setDetails(result);}).catch(()=>{if(mounted)setDetails(null);});else setDetails(null);return ()=>{mounted=false;};},[questionnaireId]);
  useEffect(()=>{if(details?.versions.length&&!details.versions.some(v=>v.id===versionId))setVersionId(details.versions[0]!.id);},[details,versionId]);
  const available=useMemo(()=>questions.data.filter(q=>!versionId||q.version_id===versionId),[questions.data,versionId]);
  const selectedSection=available.filter(q=>!sectionId||q.section_id===sectionId);
  useEffect(()=>{if(available.length&&!available.some(q=>q.id===questionId))setQuestionId(available[0]!.id);},[available,questionId]);
  const current=available.find(q=>q.id===questionId);
  const filteredRules=rules.data.filter(r=>!versionId||r.version_id===versionId);
  function changeQuestionnaire(id:string){setQuestionnaireId(id);setDetails(null);setVersionId('');setSectionId('');setQuestionId('');setEditing(null);}
  function toggleDuplicate(id:string){setDuplicateIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
  function resetForm(){setEditing(null);setType('range');setMin('');setMax('');setRuleValue('');setAllowed('');setFormat('integer');setOther('');setWhenQuestion('');setWhenValue('');setDuplicateIds([]);setActive(true);}
  function edit(r:Rule){setEditing(r.id);setQuestionId(r.question_id);setVersionId(r.version_id);setSectionId(r.section_id||'');setType(r.type);setActive(r.active);
    setRuleValue(String(r.params.value??''));setMin(String(r.params.min??''));setMax(String(r.params.max??''));setAllowed(Array.isArray(r.params.values)?r.params.values.join(', '):'');setFormat(String(r.params.kind||'integer'));setOther(String(r.params.otherQuestionId||''));setOperator(String(r.params.operator||'<='));setWhenQuestion(String(r.params.whenQuestionId||''));setWhenOperator(String(r.params.operator||'=='));setWhenValue(String(r.params.value??''));setDuplicateIds(Array.isArray(r.params.questionIds)?r.params.questionIds as string[]:[]);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function buildParams():Record<string,unknown> {
    if(type==='range')return {min:Number(min),max:Number(max)};
    if(numericTypes.includes(type))return {value:Number(ruleValue)};
    if(type==='equals'||type==='not_equals')return {value:ruleValue};
    if(type==='allowed')return {values:allowed.split(/[,\n;]/).map(x=>x.trim()).filter(Boolean)};
    if(type==='format')return {kind:format};
    if(type==='required')return {};
    if(type==='compare')return {otherQuestionId:other,operator};
    if(type==='consistency')return {whenQuestionId:whenQuestion,operator:whenOperator,value:whenValue};
    return {questionIds:duplicateIds};
  }
  async function save(e:FormEvent){e.preventDefault();if(!questionId)return;setBusy(true);setMessage(null);try {
      const payload={questionId,type,params:buildParams(),active};
      if(editing)await put(`/quality-rules/${editing}`,payload);else await post('/quality-rules',payload);
      setMessage({type:'success',text:editing?'Règle mise à jour et résultats recalculés.':'Règle créée et résultats recalculés.'});rules.reload();resetForm();
    }catch(err){setMessage({type:'error',text:(err as Error).message});}finally{setBusy(false);}}
  async function changeStatus(r:Rule){if(!window.confirm(`${r.active?'Désactiver':'Activer'} la règle ${r.variable_name} ?`))return;try{await put(`/quality-rules/${r.id}`,{questionId:r.question_id,type:r.type,params:r.params,active:!r.active});rules.reload();setMessage({type:'success',text:'Statut de la règle mis à jour.'});}catch(err){setMessage({type:'error',text:(err as Error).message});}}
  async function drop(r:Rule){if(!window.confirm(`Supprimer la règle ${ruleNames[r.type]} de ${r.variable_name} ?`))return;try{await remove(`/quality-rules/${r.id}`);rules.reload();setMessage({type:'success',text:'Règle supprimée.'});if(editing===r.id)resetForm();}catch(err){setMessage({type:'error',text:(err as Error).message});}}
  async function exportRules(){try{await download('rules','xlsx',questionnaireId?`questionnaireId=${questionnaireId}`:'');}catch(err){setMessage({type:'error',text:(err as Error).message});}}
  const otherQuestions=available.filter(q=>q.id!==questionId);
  const sectionList=details?.sections.filter(s=>s.version_id===versionId)||[];
  return <><PageHeader eyebrow="PARAMÈTRES  /  CONTRÔLE QUALITÉ" title="Règles de contrôle" description="Définissez une ou plusieurs vérifications par question, sans saisir manuellement la structure du questionnaire." actions={<button type="button" className="button button-secondary" onClick={exportRules}><ArrowDownToLine size={17}/> Exporter les règles</button>}/>
    {message&&<Notice type={message.type}>{message.text}</Notice>}{(questions.error||rules.error)&&<Notice type="error">{questions.error||rules.error}</Notice>}
    {!list.loading&&!list.data.length?<Empty title="Aucun questionnaire disponible" description="Connectez Survey Solutions et synchronisez les questionnaires avant de créer vos règles." action={<Link to="/settings/connection" className="button button-primary">Configurer la connexion</Link>}/>:<>
    <div className="rules-layout"><section className="card rule-editor"><div className="rule-editor-head"><span className="settings-head-icon"><SlidersHorizontal size={21}/></span><div><h2>{editing?'Modifier la règle':'Nouvelle règle qualité'}</h2><p>Sélectionnez votre question et paramétrez le contrôle.</p></div></div>
      <form onSubmit={save} className="rule-form"><div className="form-two"><label>Questionnaire<select value={questionnaireId} onChange={e=>changeQuestionnaire(e.target.value)} required>{list.data.map(q=><option key={q.id} value={q.id}>{q.title}</option>)}</select></label><label>Version<select value={versionId} onChange={e=>{setVersionId(e.target.value);setSectionId('');setQuestionId('');}} required>{details?.versions.map(v=><option key={v.id} value={v.id}>Version {v.version}</option>)}</select></label></div>
      <div className="form-two"><label>Section<select value={sectionId} onChange={e=>{setSectionId(e.target.value);setQuestionId('');}}><option value="">Toutes les sections</option>{sectionList.map(s=><option key={s.id} value={s.id}>{s.parent_id?'  ↳ ':''}{s.title}</option>)}</select></label><label>Question<select value={questionId} onChange={e=>setQuestionId(e.target.value)} required><option value="">Sélectionner une question</option>{selectedSection.map(q=><option key={q.id} value={q.id}>{q.variable_name} · {q.label}</option>)}</select></label></div>
      {current&&<div className="selected-question"><BookOpen size={18}/><div><small>QUESTION SÉLECTIONNÉE  ·  {current.type}</small><strong>{current.variable_name} — {current.label}</strong><span>{current.section_title||'Sans section'} · {current.rules_count} règle(s) existante(s)</span></div></div>}
      <div className="form-divider"/><label>Type de contrôle<select value={type} onChange={e=>setType(e.target.value as RuleType)}>{types.map(t=><option value={t} key={t}>{ruleNames[t]}</option>)}</select></label>
      {type==='range'&&<div className="form-two"><label>Minimum<input type="number" step="any" value={min} onChange={e=>setMin(e.target.value)} placeholder="Ex. 18" required/></label><label>Maximum<input type="number" step="any" value={max} onChange={e=>setMax(e.target.value)} placeholder="Ex. 65" required/></label></div>}
      {numericTypes.includes(type)&&<label>{type==='min'||type==='min_length'?'Valeur minimale':'Valeur maximale'}<input type="number" step={type.includes('length')?'1':'any'} value={ruleValue} onChange={e=>setRuleValue(e.target.value)} required placeholder="Saisir une valeur"/></label>}
      {(type==='equals'||type==='not_equals')&&<label>Valeur à comparer<input value={ruleValue} onChange={e=>setRuleValue(e.target.value)} placeholder="Ex. 1 ou Oui" required/></label>}
      {type==='allowed'&&<label>Valeurs autorisées<textarea value={allowed} onChange={e=>setAllowed(e.target.value)} placeholder="1, 2, 3 ou Oui, Non" required rows={3}/><small>Séparez chaque valeur par une virgule ou une ligne.</small></label>}
      {type==='format'&&<label>Format attendu<select value={format} onChange={e=>setFormat(e.target.value)}><option value="integer">Nombre entier</option><option value="decimal">Nombre décimal</option><option value="date">Date (AAAA-MM-JJ)</option><option value="phone">Téléphone</option><option value="email">Email</option><option value="text">Texte</option></select></label>}
      {type==='required'&&<div className="rule-help"><CircleHelp size={16}/> L’absence d’une réponse conditionnelle ou dans un roster est classée « non contrôlée » pour éviter les faux positifs.</div>}
      {type==='compare'&&<div className="form-two"><label>Question à comparer<select value={other} onChange={e=>setOther(e.target.value)} required><option value="">Choisir une question</option>{otherQuestions.map(q=><option key={q.id} value={q.id}>{q.variable_name} · {q.label}</option>)}</select></label><label>Opérateur<select value={operator} onChange={e=>setOperator(e.target.value)}>{['<','<=','>','>=','==','!='].map(op=><option key={op}>{op}</option>)}</select></label></div>}
      {type==='consistency'&&<><div className="form-two"><label>Si la question<select value={whenQuestion} onChange={e=>setWhenQuestion(e.target.value)} required><option value="">Choisir une question</option>{otherQuestions.map(q=><option key={q.id} value={q.id}>{q.variable_name} · {q.label}</option>)}</select></label><label>Comparaison<select value={whenOperator} onChange={e=>setWhenOperator(e.target.value)}><option value="==">Est égale à</option><option value="!=">Est différente de</option></select></label></div><label>Cette valeur<input value={whenValue} onChange={e=>setWhenValue(e.target.value)} required placeholder="Ex. 1"/></label><div className="rule-help">Alors la question sélectionnée doit être renseignée.</div></>}
      {type==='duplicate'&&<div className="duplicate-picker"><b>Questions complémentaires pour identifier un doublon</b><small>La question sélectionnée sera toujours incluse dans le rapprochement.</small><div className="checkbox-list">{otherQuestions.map(q=><label key={q.id}><input type="checkbox" checked={duplicateIds.includes(q.id)} onChange={()=>toggleDuplicate(q.id)}/><span>{q.variable_name} · {q.label}</span></label>)}</div>{!otherQuestions.length&&<small>Il faut au moins une autre question dans la même version.</small>}</div>}
      <label className="switch-line"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/><span className="switch-ui"/><span>Règle active <small>Elle sera appliquée aux entretiens synchronisés.</small></span></label>
      <div className="rule-form-actions">{editing&&<button type="button" className="button button-secondary" onClick={resetForm}>Annuler</button>}<button className="button button-primary" type="submit" disabled={busy||!questionId}><Save size={17}/>{busy?'Enregistrement…':editing?'Mettre à jour la règle':'Enregistrer la règle'}</button></div></form></section>
    <aside className="card rules-side"><span className="status-orb"><ShieldCheck size={24}/></span><h3>Un contrôle sur mesure</h3><p>Combinez plusieurs règles pour chaque question. Les contrôles sont recalculés automatiquement après chaque synchronisation et modification.</p><div className="rules-guide"><div><b>01</b><span>Choisissez un questionnaire</span></div><div><b>02</b><span>Sélectionnez une question</span></div><div><b>03</b><span>Définissez un contrôle</span></div><div><b>04</b><span>Analysez les résultats</span></div></div></aside></div>
    <section className="card table-card lower-card"><SectionTitle title="Règles configurées" subtitle={`${filteredRules.length} règle(s) pour ce questionnaire`} action={<Link to="/quality" className="subtle-link">Voir les résultats →</Link>}/>
      {rules.loading?<Loading/>:filteredRules.length?<div className="table-scroll"><table><thead><tr><th>QUESTION</th><th>CONTRÔLE</th><th>PARAMÈTRES</th><th>VERSION</th><th>STATUT</th><th>MODIFIÉ LE</th><th className="action-col">ACTIONS</th></tr></thead><tbody>{filteredRules.map(r=><tr key={r.id}><td><b>{r.variable_name}</b><small>{r.question_label}</small></td><td>{ruleNames[r.type]}</td><td className="mono">{paramsText(r.type,r.params)}</td><td>V{r.version}</td><td><button type="button" className="plain-button" onClick={()=>changeStatus(r)} title={r.active?'Désactiver':'Activer'}><Badge tone={r.active?'success':'neutral'}>{r.active?'Actif':'Inactif'}</Badge></button></td><td>{fmtDate(r.updated_at)}</td><td><div className="row-actions"><button className="icon-button" type="button" title="Modifier" aria-label={`Modifier ${r.variable_name}`} onClick={()=>edit(r)}><Pencil size={16}/></button><button className="icon-button danger-action" type="button" title="Supprimer" aria-label={`Supprimer ${r.variable_name}`} onClick={()=>drop(r)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>:<Empty title="Aucune règle enregistrée" description="Sélectionnez une question ci-dessus pour créer votre première vérification."/>}
    </section></>}
  </>;
}
