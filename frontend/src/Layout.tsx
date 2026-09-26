import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, ChartNoAxesCombined, ClipboardList, FileChartColumn, LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, SlidersHorizontal, UserRound, UsersRound, X, type LucideIcon } from 'lucide-react';
import { useAuth } from './App';
import type { User } from './types';

type Nav = { label:string;to:string;icon:LucideIcon };
export function navigationFor(user:Pick<User,'role'>):{main:Nav[];admin:Nav[];bottom:Nav[]} {
  return {
    main:[{label:'Tableau de bord',to:'/',icon:LayoutDashboard},{label:'Questionnaires',to:'/questionnaires',icon:ClipboardList},
      {label:'Contrôle qualité',to:'/quality',icon:ShieldCheck},{label:'Rapports & analyses',to:'/reports',icon:FileChartColumn}],
    admin:user.role==='admin'?[{label:'Utilisateurs',to:'/users',icon:UsersRound},{label:'Connexion Survey Solutions',to:'/settings/connection',icon:Settings2},{label:'Moteur automatique',to:'/settings/intelligence',icon:SlidersHorizontal},{label:'Règles de contrôle',to:'/settings/rules',icon:SlidersHorizontal}]:[],
    bottom:[{label:'Journal d’activités',to:'/activity',icon:Activity}],
  };
}
export function Sidebar({user,onLogout,onNavigate}:{user:User;onLogout:()=>void;onNavigate?:()=>void}) {
  const nav=navigationFor(user);
  function links(items:Nav[]) {return items.map(({label,to,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} onClick={onNavigate} className={({isActive})=>`nav-item ${isActive?'active':''}`}><Icon size={19} strokeWidth={1.9}/><span>{label}</span></NavLink>);}
  return <><div className="brand"><div className="brand-mark"><span/><span/><span/></div><div className="brand-name">survey<span>quality</span><small>DATA INTELLIGENCE</small></div></div>
    <div className="sidebar-scroll"><div className="nav-caption">ESPACE DE TRAVAIL</div><nav aria-label="Navigation principale">{links(nav.main)}</nav>
    {user.role==='admin'&&<><div className="nav-caption nav-separator">ADMINISTRATION</div><nav aria-label="Administration">{links(nav.admin.slice(0,1))}</nav><div className="nav-caption nav-separator">PARAMÈTRES</div><nav aria-label="Paramètres">{links(nav.admin.slice(1))}</nav></>}
    <div className="nav-caption nav-separator">SUIVI</div><nav aria-label="Suivi">{links(nav.bottom)}</nav>
    <div className="sidebar-help"><ChartNoAxesCombined size={22}/><div><b>Des données fiables.</b><p>Des décisions plus éclairées, à chaque étape.</p></div><ArrowUpRight size={17}/></div>
    </div>
    <div className="sidebar-bottom"><NavLink to="/profile" className="nav-item" onClick={onNavigate}><UserRound size={19}/><span>Mon compte</span></NavLink><button className="nav-item logout" onClick={onLogout} type="button"><LogOut size={19}/><span>Déconnexion</span></button></div>
  </>;
}
const titles:Record<string,string>={'/':'Vue d’ensemble','/questionnaires':'Questionnaires','/quality':'Contrôle qualité','/reports':'Rapports & analyses','/users':'Administration / Utilisateurs','/settings/connection':'Paramètres / Connexion API','/settings/rules':'Paramètres / Règles qualité','/activity':'Journal d’activités','/profile':'Mon compte'};
export function Layout() {
  const {user,logout}=useAuth(),location=useLocation(),navigate=useNavigate();
  const [open,setOpen]=useState(false);
  if(!user)return null;
  async function signOut(){await logout();navigate('/login',{replace:true});}
  const title=titles[location.pathname]||'Détail du questionnaire';
  return <div className="app-shell"><aside className={`sidebar ${open?'sidebar-open':''}`}><div className="mobile-aside-head"><button className="icon-button" type="button" onClick={()=>setOpen(false)} aria-label="Fermer le menu"><X size={22}/></button></div><Sidebar user={user} onLogout={signOut} onNavigate={()=>setOpen(false)}/></aside>
    {open&&<div className="sidebar-scrim" onClick={()=>setOpen(false)}/>}
    <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" aria-label="Ouvrir le menu" type="button" onClick={()=>setOpen(true)}><Menu size={22}/></button><span className="top-breadcrumb">Espace de travail <span>/</span> <strong>{title}</strong></span></div>
      <div className="topbar-right"><span className="topbar-secure"><ShieldCheck size={15}/> Session sécurisée</span><div className="topbar-divider"/><NavLink to="/profile" className="account-link"><span className="avatar">{user.username.slice(0,2).toUpperCase()}</span><span className="account-name"><b>{user.username}</b><small>{user.role==='admin'?'Administrateur':'Utilisateur'}</small></span></NavLink></div></header>
      <main className="content"><Outlet/></main><footer className="app-footer"><span>© 2026 SurveyQuality</span><span>Conçu pour la fiabilité des données</span></footer>
    </div>
  </div>;
}
