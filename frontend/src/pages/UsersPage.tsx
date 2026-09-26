import { useState, type FormEvent } from 'react';
import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserRoundCheck, UserRoundX, UsersRound } from 'lucide-react';
import { post, put, remove } from '../api';
import { useAuth } from '../App';
import { Badge, Empty, Loading, Modal, Notice, PageHeader, useLoad } from '../components';
import { fmtDate } from '../utils';
import type { User } from '../types';

type Mode='create'|'edit'|'reset'|null;
export function UsersPage() {
  const {user:current}=useAuth();
  const {data,loading,error,reload}=useLoad<User[]>('/users',[]);
  const [search,setSearch]=useState(''),[mode,setMode]=useState<Mode>(null),[selected,setSelected]=useState<User|null>(null);
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[role,setRole]=useState<'admin'|'user'>('user'),[active,setActive]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[formError,setFormError]=useState('');
  function open(next:Mode,person:User|null=null) {setMode(next);setSelected(person);setUsername(person?.username||'');setRole(person?.role||'user');setActive(person?.active??true);setPassword('');setConfirmPassword('');setFormError('');}
  async function submit(e:FormEvent) {e.preventDefault();setBusy(true);setFormError('');try {
      if(mode==='create')await post('/users',{username,password,confirmPassword,role,active});
      if(mode==='edit'&&selected)await put(`/users/${selected.id}`,{username,role,active,confirm:true});
      if(mode==='reset'&&selected)await put(`/users/${selected.id}/password`,{newPassword:password,confirmPassword,confirm:true});
      setNotice(mode==='create'?'Utilisateur créé.':mode==='reset'?'Mot de passe réinitialisé.':'Compte mis à jour.');setMode(null);reload();
    }catch(err){setFormError((err as Error).message);}finally{setBusy(false);}}
  async function toggle(person:User) {if(!window.confirm(`${person.active?'Désactiver':'Activer'} le compte ${person.username} ?`))return;try{await put(`/users/${person.id}`,{username:person.username,role:person.role,active:!person.active,confirm:true});reload();setNotice('Statut mis à jour.');}catch(err){setNotice((err as Error).message);}}
  async function drop(person:User) {if(!window.confirm(`Supprimer définitivement le compte ${person.username} ? Cette action est irréversible.`))return;try{await remove(`/users/${person.id}`);reload();setNotice('Utilisateur supprimé.');}catch(err){setNotice((err as Error).message);}}
  const items=data.filter(x=>x.username.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="ADMINISTRATION  /  COMPTES" title="Utilisateurs" description="Gérez les comptes, les rôles et les accès de votre équipe." actions={<button className="button button-primary" type="button" onClick={()=>open('create')}><Plus size={18}/> Nouvel utilisateur</button>}/>
    {error&&<Notice type="error">{error}</Notice>}{notice&&<Notice type={notice.includes('mis à jour')||notice.includes('créé')||notice.includes('réinitialisé')||notice.includes('supprimé')?'success':'error'}>{notice}</Notice>}
    <div className="account-summary"><span className="account-summary-icon"><UsersRound size={22}/></span><div><strong>{data.length} membres</strong><span>{data.filter(u=>u.active).length} actifs dans l’espace de travail</span></div><span className="account-summary-tag"><ShieldCheck size={15}/> Accès par rôles</span></div>
    <section className="card table-card"><div className="users-toolbar"><div><h2>Membres de l’équipe</h2><p>Les comptes créés ont accès à leur espace selon leur rôle.</p></div><div className="search-field"><Search size={17}/><input aria-label="Chercher un utilisateur" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…"/></div></div>
      {loading?<Loading/>:items.length?<div className="table-scroll"><table><thead><tr><th>NOM D’UTILISATEUR</th><th>RÔLE</th><th>STATUT</th><th>DATE DE CRÉATION</th><th className="action-col">ACTIONS</th></tr></thead><tbody>{items.map(person=><tr key={person.id}><td><div className="user-cell"><span className="table-avatar">{person.username.slice(0,2).toUpperCase()}</span><b>{person.username}</b>{person.id===current?.id&&<small>(vous)</small>}</div></td><td><span className={`role-pill ${person.role==='admin'?'role-admin':'role-user'}`}>{person.role==='admin'?'Administrateur':'Utilisateur'}</span></td><td><Badge tone={person.active?'success':'neutral'}>{person.active?'Actif':'Inactif'}</Badge></td><td>{fmtDate(person.created_at)}</td><td><div className="row-actions"><button type="button" className="icon-button" title={`Modifier ${person.username}`} aria-label={`Modifier ${person.username}`} onClick={()=>open('edit',person)}><Pencil size={16}/></button><button type="button" className="icon-button" title={`Réinitialiser le mot de passe de ${person.username}`} aria-label={`Réinitialiser le mot de passe de ${person.username}`} onClick={()=>open('reset',person)}><KeyRound size={16}/></button><button type="button" className="icon-button" title={person.active?'Désactiver':'Activer'} aria-label={`${person.active?'Désactiver':'Activer'} ${person.username}`} onClick={()=>toggle(person)} disabled={person.id===current?.id}>{person.active?<UserRoundX size={16}/>:<UserRoundCheck size={16}/>}</button><button type="button" className="icon-button danger-action" title={`Supprimer ${person.username}`} aria-label={`Supprimer ${person.username}`} onClick={()=>drop(person)} disabled={person.id===current?.id}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>:<Empty title="Aucun utilisateur" description="Ajoutez des membres à votre espace pour partager le suivi qualité."/>}
    </section>
    {mode&&<Modal title={mode==='create'?'Créer un utilisateur':mode==='reset'?'Réinitialiser le mot de passe':'Modifier l’utilisateur'} description={mode==='reset'?`Définissez un nouveau mot de passe pour ${selected?.username}.`:undefined} onClose={()=>setMode(null)}>
      {formError&&<Notice type="error">{formError}</Notice>}
      <form className="modal-form" onSubmit={submit}>{mode!=='reset'&&<><label>Nom d’utilisateur<input value={username} onChange={e=>setUsername(e.target.value)} required minLength={2} maxLength={50} autoFocus/></label><div className="form-two"><label>Rôle<select value={role} onChange={e=>setRole(e.target.value as 'admin'|'user')}><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></label><label>Statut<select value={active?'active':'inactive'} onChange={e=>setActive(e.target.value==='active')}><option value="active">Actif</option><option value="inactive">Inactif</option></select></label></div></>}
        {(mode==='create'||mode==='reset')&&<div className="form-two"><label>Nouveau mot de passe<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="8 caractères minimum" required/></label><label>Confirmation<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Confirmer" required/></label></div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={()=>setMode(null)}>Annuler</button><button type="submit" className="button button-primary" disabled={busy}>{busy?'Enregistrement…':mode==='reset'?'Réinitialiser':'Enregistrer'}</button></div>
      </form></Modal>}
  </>;
}
