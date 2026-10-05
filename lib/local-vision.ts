import { currentLang, pick } from './i18n';
export type LocalStatus = {local:boolean;recognition:boolean;inpainting:boolean;memoryMB?:number;neededMB?:{recognize:number;inpaint:number}};
export async function localStatus():Promise<LocalStatus|null>{
  try {const r=await fetch('/api/local/status');return r.ok?await r.json() as LocalStatus:null;}catch{return null;}
}
/** The local helper answers in both languages ({zh,en}); older answers are plain text. */
export const said=(v:unknown,fallback='')=>v&&typeof v==='object'&&'zh' in (v as object)?(v as {zh:string;en:string})[currentLang()]:typeof v==='string'&&v?v:fallback;
export function base64Blob(value:string){
  return new Blob([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],{type:'image/png'});
}
async function encode(blob:Blob){
  return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
}
export async function localVisionJob(kind:'recognize'|'inpaint',image:Blob,mask:Blob|undefined,onProgress:(s:string)=>void,signal:AbortSignal){
  const t=pick(currentLang());
  let id:string|undefined;
  const abort=()=>{if(id)void fetch('/api/local/jobs/'+id,{method:'DELETE',keepalive:true});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    if(signal.aborted)throw Error(t('处理已取消。','Cancelled.'));
    const response=await fetch('/api/local/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,image:await encode(image),mask:mask?await encode(mask):undefined}),signal});
    const job=await response.json() as {id?:string;error?:unknown};if(!response.ok)throw Error(said(job.error,t('本地服务暂时不可用。','The local helper is unavailable for a moment.')));id=job.id;
    while(!signal.aborted){
      const r=await fetch('/api/local/jobs/'+id,{signal});const j:any=await r.json();
      if(!r.ok||j.status==='failed')throw Error(said(j.error,t('处理失败，请重试。','Processing failed. Please try again.')));
      if(j.status==='done')return j.result;
      onProgress(said(j.message));
      await new Promise<void>(resolve=>setTimeout(resolve,750));
    }
    throw Error(t('处理已取消。','Cancelled.'));
  }catch(e){if(signal.aborted)throw Error(t('已取消处理，照片和选择已保留。','Cancelled. Your photo and choices are kept.'));throw e;}
  finally{signal.removeEventListener('abort',abort);if(id)void fetch('/api/local/jobs/'+id,{method:'DELETE',keepalive:true});}
}
