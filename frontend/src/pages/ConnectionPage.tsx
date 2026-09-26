import { useEffect, useState, type FormEvent } from 'react';
import { Check, CircleHelp, Database, Globe2, LockKeyhole, PlugZap, RotateCw, Save, Server, ShieldCheck } from 'lucide-react';
import { post, put } from '../api';
import { Badge, Loading, Notice, PageHeader, useLoad } from '../components';
import { fmtDate } from '../utils';
import type { Connection } from '../types';

const initial:Connection={url:'',workspace:'primary',allowInsecureHttp:false,hasCredentials:false,status:'NON CONNECTÉ',serverVersion:null,lastTestedAt:null,lastSyncedAt:null};
export function ConnectionPage() {
  const {data,loading,error,reload}=useLoad<Connection>('/settings/survey-solutions',initial);
  const [url,setUrl]=useState(''),[workspace,setWorkspace]=useState('primary'),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[allowInsecureHttp,setAllowInsecureHttp]=useState(false),[busy,setBusy]=useState(''),[message,setMessage]=useState<{text:string;type:'success'|'error'|'info'}|null>(null);
  useEffect(()=>{setUrl(data.url);setWorkspace(data.workspace);setAllowInsecureHttp(data.allowInsecureHttp);},[data.url,data.workspace,data.allowInsecureHttp]);
  const usesHttp=url.trim().toLowerCase().startsWith('http://');
  const httpApproved=!usesHttp||allowInsecureHttp;
  const newServer=data.url.trim().replace(/\/+$/,'')!==url.trim().replace(/\/+$/,'');
  const credentialsRequired=!data.hasCredentials||newServer;
  const payload={url,workspace,username,password,allowInsecureHttp:usesHttp&&allowInsecureHttp};
  async function save(e:FormEvent){e.preventDefault();setBusy('save');setMessage(null);try{await put('/settings/survey-solutions',payload);setUsername('');setPassword('');setMessage({type:'success',text:'Configuration enregistrée. Une synchronisation automatique va démarrer.'});reload();}catch(err){setMessage({type:'error',text:(err as Error).message});}finally{setBusy('');}}
  async function test(){setBusy('test');setMessage(null);try{
    const untouched=!newServer&&data.workspace===workspace&&data.allowInsecureHttp===payload.allowInsecureHttp&&!username&&!password&&data.hasCredentials;
    const result=await post<{serverVersion:string|null;message:string;warnings:string[]}>('/settings/survey-solutions/test',untouched?{}:payload);
    const version=result.serverVersion?` · version ${result.serverVersion}`:'';
    const warnings=result.warnings?.length?` ${result.warnings.join(' ')}`:'';
    setMessage({type:warnings?'info':'success',text:`${result.message}${version}.${untouched?'':' Enregistrez ces paramètres pour synchroniser.'}${warnings}`});
    reload();
  }catch(err){setMessage({type:'error',text:(err as Error).message});}finally{setBusy('');}}
  async function sync(){setBusy('sync');setMessage(null);try{const result=await post<{questionnaires:number;questions:number;responses:number}>('/sync',{});setMessage({type:'success',text:`Synchronisation terminée : ${result.questionnaires} questionnaire(s), ${result.questions} question(s), ${result.responses} entretien(s).`});reload();}catch(err){setMessage({type:'error',text:(err as Error).message});}finally{setBusy('');}}
  return <><PageHeader eyebrow="PARAMÈTRES  /  INTÉGRATIONS" title="Connexion Survey Solutions" description="Connectez votre serveur pour synchroniser automatiquement questionnaires, questions et entretiens."/>
    {error&&<Notice type="error">{error}</Notice>}{message&&<Notice type={message.type}>{message.text}</Notice>}
    <div className="settings-layout"><div><section className="card connection-card"><div className="connection-head"><div className="settings-head-icon"><Server size={22}/></div><div><h2>Configuration du serveur</h2><p>Les requêtes API sont exécutées exclusivement par le backend.</p></div></div>
      {loading?<Loading/>:<form onSubmit={save} className="settings-form"><label>URL du serveur Survey Solutions <span>*</span><div className="field-with-icon"><Globe2 size={17}/><input type="url" placeholder="https://mon-serveur.example.org" autoComplete="url" value={url} onChange={e=>setUrl(e.target.value)} required/></div><small>Adresse racine du HQ, sans /api ni /{workspace||'nom-de-lespace'} à la fin.</small></label>
        <label>Espace de travail <span>*</span><div className="field-with-icon"><Database size={17}/><input value={workspace} onChange={e=>setWorkspace(e.target.value)} required pattern="[a-zA-Z0-9_-]+"/></div><small>Saisissez le nom exact de votre espace (par exemple « sankurusaco »).</small></label>
        {usesHttp&&<div className="http-warning" role="note"><strong>Serveur HTTP sans chiffrement</strong><p>L’authentification API circulera sur le réseau sans TLS. Préférez HTTPS pour le HQ et pour cette application ; n’utilisez HTTP que sur un réseau privé de confiance.</p>
          <label className="http-opt-in"><input type="checkbox" checked={allowInsecureHttp} onChange={e=>setAllowInsecureHttp(e.target.checked)}/><span>J’autorise explicitement la connexion à ce serveur HTTP.</span></label></div>}
        <div className="form-two"><label>Nom d’utilisateur API <span>{credentialsRequired?'*':''}</span><input value={username} onChange={e=>setUsername(e.target.value)} placeholder={credentialsRequired?'Compte utilisateur API':'Laisser vide pour conserver l’identifiant'} autoComplete="off" required={credentialsRequired}/></label><label>Mot de passe API <span>{credentialsRequired?'*':''}</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={credentialsRequired?'Mot de passe du compte API':'Laisser vide pour conserver le secret'} autoComplete="new-password" required={credentialsRequired}/></label></div>
        <div className="secret-note"><LockKeyhole size={16}/> Les identifiants sont chiffrés sur le serveur et ne sont jamais renvoyés dans l’interface.</div>
        <div className="connection-actions"><button type="button" className="button button-secondary" onClick={test} disabled={!!busy||!url||!httpApproved}><PlugZap size={17}/>{busy==='test'?'Test en cours…':'Tester la connexion Survey Solutions'}</button><button className="button button-primary" type="submit" disabled={!!busy||!httpApproved}><Save size={17}/>{busy==='save'?'Enregistrement…':'Enregistrer'}</button></div></form>}
      </section><section className="card sync-card"><div className="sync-icon"><RotateCw size={22}/></div><div><h3>Synchronisation manuelle</h3><p>Mettez à jour les versions, la structure des questions et les réponses. Les règles sont réévaluées à chaque synchronisation.</p></div><button className="button button-secondary" type="button" onClick={sync} disabled={!!busy||!data.hasCredentials}><RotateCw size={16} className={busy==='sync'?'spin':''}/>{busy==='sync'?'Synchronisation…':'Synchroniser maintenant'}</button></section></div>
      <aside className="settings-side"><section className="card status-card"><div className="status-orb"><ShieldCheck size={24}/></div><h2>État de la connexion</h2><Badge>{data.status}</Badge><div className="status-rows"><div><span>Version du serveur</span><strong>{data.serverVersion||'Non détectée'}</strong></div><div><span>Dernier test</span><strong>{fmtDate(data.lastTestedAt)}</strong></div><div><span>Dernière synchro.</span><strong>{fmtDate(data.lastSyncedAt)}</strong></div><div><span>Identifiants</span><strong>{data.hasCredentials?'Enregistrés':'À configurer'}</strong></div></div></section>
      <section className="card tips-card"><CircleHelp size={22}/><h3>Avant de commencer</h3><ol><li>Créez un compte de rôle <b>API User</b> sur Survey Solutions.</li><li>Autorisez ce compte dans l’espace de travail indiqué ; un HTTP 403 signale souvent un accès refusé à cet espace.</li><li>Utilisez l’adresse racine du HQ, testez la connexion puis lancez la synchronisation.</li></ol><div><Check size={16}/> La connexion API est testée sur l’espace indiqué ; la version et le Swagger sont vérifiés lorsqu’ils sont disponibles.</div></section></aside></div>
  </>;
}
