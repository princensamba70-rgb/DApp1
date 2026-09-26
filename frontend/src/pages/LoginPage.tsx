import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, DatabaseZap, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '../App';
import { Notice } from '../components';

export function LoginPage() {
  const {login}=useAuth(),navigate=useNavigate();
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent) {e.preventDefault();setBusy(true);setError('');try {await login(username,password);navigate('/',{replace:true});}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  return <div className="login-screen"><div className="login-visual"><div className="login-visual-top"><div className="brand-mark"><span/><span/><span/></div><span>surveyquality</span></div>
    <div className="login-hero"><span className="login-kicker"><span/> PLATEFORME DE PILOTAGE DES DONNÉES</span><h1>La qualité des données,<br/><em>en toute clarté.</em></h1><p>Centralisez vos questionnaires, automatisez les contrôles et transformez chaque réponse en une information fiable.</p>
      <div className="login-features"><div><span><DatabaseZap size={18}/></span> Synchronisation Survey Solutions</div><div><span><ShieldCheck size={18}/></span> Contrôles qualité automatisés</div><div><span><Check size={18}/></span> Rapports exploitables en temps réel</div></div>
    </div><div className="login-visual-bottom">SURVEY SOLUTIONS  ×  SURVEYQUALITY <span>2026</span></div><div className="login-orbit orbit-one"/><div className="login-orbit orbit-two"/></div>
    <div className="login-panel"><div className="login-form-wrap"><div className="login-mobile-brand"><div className="brand-mark"><span/><span/><span/></div> surveyquality</div><div className="login-lock"><LockKeyhole size={25}/></div><div className="eyebrow">BIENVENUE SUR VOTRE ESPACE</div><h2>Connexion</h2><p className="login-subtitle">Renseignez vos identifiants pour accéder à votre espace de contrôle qualité.</p>
      {error&&<Notice type="error">{error}</Notice>}
      <form onSubmit={submit} className="login-form"><label htmlFor="login-username">Nom d’utilisateur</label><input id="login-username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Votre identifiant" required maxLength={100}/>
        <label htmlFor="login-password">Mot de passe</label><input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Votre mot de passe" required/>
        <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy?'Connexion en cours…':'Se connecter'}<ArrowRight size={18}/></button></form>
      <div className="login-support"><ShieldCheck size={17}/> Accès protégé · Vos données restent confidentielles</div>
    </div><div className="login-panel-footer">Besoin d’aide ? Contactez votre administrateur.</div></div></div>;
}
