export async function localStatus():Promise<{local:boolean;recognition:boolean;inpainting:boolean}|null>{
  try {const r=await fetch('/api/local/status');return r.ok?await r.json() as {local:boolean;recognition:boolean;inpainting:boolean}:null;}catch{return null;}
}
export function base64Blob(value:string){
  return new Blob([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],{type:'image/png'});
}
async function encode(blob:Blob){
  return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
}
export async function localVisionJob(kind:'recognize'|'inpaint',image:Blob,mask:Blob|undefined,onProgress:(s:string)=>void,signal:AbortSignal){
  let id:string|undefined;
  const abort=()=>{if(id)void fetch('/api/local/jobs/'+id,{method:'DELETE',keepalive:true});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    if(signal.aborted)throw Error('处理已取消。');
    const response=await fetch('/api/local/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,image:await encode(image),mask:mask?await encode(mask):undefined}),signal});
    const job=await response.json() as {id?:string;error?:string};if(!response.ok)throw Error(job.error||'本地服务暂时不可用。');id=job.id;
    while(!signal.aborted){
      const r=await fetch('/api/local/jobs/'+id,{signal});const j:any=await r.json();
      if(!r.ok||j.status==='failed')throw Error(j.error||'处理失败，请重试。');
      if(j.status==='done')return j.result;
      onProgress(j.message);
      await new Promise<void>(resolve=>setTimeout(resolve,750));
    }
    throw Error('处理已取消。');
  }catch(e){if(signal.aborted)throw Error('已取消处理，照片和选择已保留。');throw e;}
  finally{signal.removeEventListener('abort',abort);if(id)void fetch('/api/local/jobs/'+id,{method:'DELETE',keepalive:true});}
}
