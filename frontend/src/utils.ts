import type { RuleType, Status } from './types';
export const fmtNum = (n:number|undefined|null) => new Intl.NumberFormat('fr-FR').format(Number(n||0));
export const fmtDate = (s:string|null|undefined) => s ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Kinshasa'}).format(new Date(s)) : '—';
export const fmtShort = (s:string|null|undefined) => s ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeZone:'Africa/Kinshasa'}).format(new Date(s)) : '—';
export const valueText = (v:unknown) => v == null ? '—' : typeof v==='string' ? v : JSON.stringify(v);
export const ruleNames:Record<RuleType,string>={min:'Seuil minimum',max:'Seuil maximum',range:'Plage de valeurs',equals:'Égalité',not_equals:'Différence',allowed:'Valeurs autorisées',required:'Valeur obligatoire',format:'Format',min_length:'Longueur minimale',max_length:'Longueur maximale',compare:'Comparaison',consistency:'Cohérence',duplicate:'Doublon potentiel'};
export function paramsText(type:RuleType,params:Record<string,unknown>) {
  if(type==='range')return `${params.min} – ${params.max}`;
  if(type==='min')return `≥ ${params.value}`;
  if(type==='max')return `≤ ${params.value}`;
  if(type==='required')return 'Oui';
  if(type==='allowed')return (params.values as string[] || []).join(', ');
  if(type==='format')return String(params.kind);
  if(type==='compare')return `${params.operator} autre question`;
  if(type==='consistency')return `Si = ${params.value}, alors renseignée`;
  if(type==='duplicate')return `${(params.questionIds as string[] || []).length+1} critères`;
  return String(params.value ?? '—');
}
export const statusClass = (status:Status|string) => status === 'CONFORME' || status === 'CONNECTÉ' || status === 'SYNCHRONISÉ' ? 'success' : status === 'NON CONFORME' || status.includes('ERREUR') ? 'danger' : 'neutral';
