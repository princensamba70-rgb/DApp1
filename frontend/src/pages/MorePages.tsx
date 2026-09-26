import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, KeyRound, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { put } from '../api';
import { useAuth } from '../App';
import { Badge, Empty, Loading, Notice, PageHeader, SectionTitle, useLoad } from '../components';
import { fmtDate } from '../utils';
import type { Activity as ActivityType } from '../types';

export function ActivityPage() {
  const {data,loading,error}=useLoad<ActivityType[]>('/activity',[]);
  return <><PageHeader eyebrow="SUIVI  /  TRAÇABILITÉ" title="Journal d’activités" description="Retrouvez les actions effectuées sur la plateforme, par compte et par date."/>
    {error&&<Notice type="error">{error}</Notice>}
    <section className="card table-card"><SectionTitle title="Historique récent" subtitle="50 dernières actions enregistrées" action={<span className="audit-chip"><ShieldCheck size={15}/> Traçabilité active</span>}/>
      {loading?<Loading/>:data.length?<div className="table-scroll"><table><thead><tr><th>UTILISATEUR</th><th>ACTION</th><th>OBJET CONCERNÉ</th><th>DATE & HEURE</th><th>ADRESSE IP</th></tr></thead><tbody>{data.map(item=><tr key={item.id}><td><div className="user-cell"><span className="table-avatar">{item.username.slice(0,2).toUpperCase()}</span><b>{item.username}</b></div></td><td><span className="action-name"><Activity size={14}/>{item.action}</span></td><td>{item.target||'—'}</td><td>{fmtDate(item.created_at)}</td><td className="mono">{item.ip_address||'—'}</td></tr>)}</tbody></table></div>:<Empty title="Aucune activité enregistrée" description="Les connexions, modifications, synchronisations et exports apparaîtront ici."/>}
    </section></>;
}
export function ProfilePage() {
  const {user,setUser}=useAuth(),navigate=useNavigate();
  const [oldPassword,setOldPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await put('/auth/password',{oldPassword,newPassword,confirmPassword});setOldPassword('');setNewPassword('');setConfirmPassword('');setUser(null);navigate('/login',{replace:true});}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  return <><PageHeader eyebrow="COMPTE  /  SÉCURITÉ" title="Mon compte" description="Consultez vos informations et renforcez la sécurité de votre accès."/>
    <div className="profile-grid"><section className="card profile-card"><span className="profile-avatar">{user?.username.slice(0,2).toUpperCase()}</span><h2>{user?.username}</h2><Badge tone="success">Compte actif</Badge><div className="profile-line"><UserRound size={17}/><span>Rôle</span><b>{user?.role==='admin'?'Administrateur':'Utilisateur'}</b></div><div className="profile-line"><ShieldCheck size={17}/><span>Protection</span><b>Session sécurisée</b></div></section>
    <section className="card profile-password"><div className="connection-head"><div className="settings-head-icon"><KeyRound size={21}/></div><div><h2>Modifier mon mot de passe</h2><p>Après modification, vous serez invité à vous reconnecter.</p></div></div>
      {message&&<Notice type="error">{message}</Notice>}
      <form className="settings-form" onSubmit={submit}><label>Mot de passe actuel<input type="password" autoComplete="current-password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} required/></label><div className="form-two"><label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><label>Confirmation<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label></div><div className="secret-note"><LockKeyhole size={16}/> Au moins 8 caractères. Les sessions existantes seront révoquées.</div><button className="button button-primary" type="submit" disabled={busy}>{busy?'Modification…':'Modifier le mot de passe'} <ArrowRight size={17}/></button></form>
    </section></div>
  </>;
}
