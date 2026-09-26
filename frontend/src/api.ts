export class ApiError extends Error { constructor(public status:number,public code:string,message:string) {super(message);} }
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const headers:HeadersInit = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers };
  let response:Response;
  try { response = await fetch(`/api${path}`,{...options,credentials:'same-origin',headers}); }
  catch { throw new ApiError(0,'RÉSEAU','Le serveur ne répond pas. Vérifiez votre connexion.'); }
  if (!response.ok) {
    let error:{error?:string;message?:string}={};
    try {error=await response.json();} catch { /* Pas de corps JSON */ }
    if (response.status===401 && path!=='/auth/login') window.dispatchEvent(new Event('sq-session-expired'));
    throw new ApiError(response.status,error.error || 'ERREUR',error.message || 'Une erreur est survenue.');
  }
  if (response.status===204) return undefined as T;
  return response.json() as Promise<T>;
}
export function post<T>(path:string,payload:unknown={}) {return api<T>(path,{method:'POST',body:JSON.stringify(payload)});}
export function put<T>(path:string,payload:unknown) {return api<T>(path,{method:'PUT',body:JSON.stringify(payload)});}
export function remove(path:string,payload:unknown={confirm:true}) {return api<void>(path,{method:'DELETE',body:JSON.stringify(payload)});}
export async function download(resource:string,format:'csv'|'xlsx'|'pdf',query='') {
  const route=`/api/exports/${resource}?format=${format}${query?'&'+query:''}`;
  const response=await fetch(route,{credentials:'same-origin'});
  if(!response.ok) {
    const data=await response.json().catch(()=>({}));
    throw new ApiError(response.status,data.error || 'EXPORT',data.message || 'Export impossible.');
  }
  const blob=await response.blob();
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`survey-quality-${resource}-${new Date().toISOString().slice(0,10)}.${format}`;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
