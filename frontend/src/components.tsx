import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Database, LoaderCircle, X } from 'lucide-react';
import { api } from './api';
import { statusClass } from './utils';

export function Badge({children,tone}:{children:ReactNode;tone?:string}) {
  const label=String(children??'');
  return <span className={`badge badge-${tone||statusClass(label)}`}><span className="badge-dot"/>{children}</span>;
}
export function PageHeader({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow||'SURVEYQUALITY  /  ESPACE DE TRAVAIL'}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>;
}
export function Loading({label='Chargement des données…'}:{label?:string}) {return <div className="loading"><LoaderCircle size={24} className="spin"/><span>{label}</span></div>;}
export function Notice({type='info',children}:{type?:'info'|'success'|'error';children:ReactNode}) {
  return <div role="status" className={`notice notice-${type}`}><AlertCircle size={18}/><span>{children}</span></div>;
}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {
  return <div className="empty"><div className="empty-icon"><Database size={27}/></div><h3>{title}</h3><p>{description}</p>{action&&<div className="empty-action">{action}</div>}</div>;
}
export function Modal({title,description,children,onClose}:{title:string;description?:string;children:ReactNode;onClose:()=>void}) {
  useEffect(()=>{ const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',handler);return ()=>window.removeEventListener('keydown',handler);},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button type="button" aria-label="Fermer" className="icon-button" onClick={onClose}><X size={19}/></button></div>{children}</div>
  </div>;
}
export function SectionTitle({title,subtitle,action}:{title:string;subtitle?:string;action?:ReactNode}) {
  return <div className="section-title"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>;
}
export function TextLink({children,to}:{children:ReactNode;to:string}) {return <a href={to} className="text-link">{children}<ArrowRight size={15}/></a>;}
export function useLoad<T>(path:string,initial:T) {
  const [data,setData]=useState<T>(initial),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    api<T>(path).then(result=>{if(active)setData(result);}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[path,tick]);
  return {data,setData,loading,error,reload:()=>setTick(v=>v+1)};
}
