import type { Candidate } from './types';
import { localStatus, localVisionJob, base64Blob } from './local-vision';
export type LocalCandidate = Omit<Candidate,'id'|'mask'|'selected'|'source'> & {mask:Blob};
export async function recognizeFurniture(image:Blob,onProgress:(message:string,percent?:number)=>void,signal:AbortSignal) {
  const local=await localStatus();
  if(local?.local){
    if(!local.recognition)throw Error('本地模型未安装，请重新启动工作台完成模型检查。');
    const result=await localVisionJob('recognize',image,undefined,onProgress,signal);
    return result.candidates.map((c:any)=>({...c,mask:base64Blob(c.mask)})) as LocalCandidate[];
  }
  return new Promise<LocalCandidate[]>((resolve,reject)=>{
    const worker=new Worker('/vision/worker.js',{type:'module'});
    const id=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();};
    const fail=(message:string)=>{cleanup();reject(Error(message));};
    const abort=()=>fail('识别已取消。');
    const timer=setTimeout(()=>fail('识别用时较长，已停止。可以重试或手动圈选家具。'),180000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>fail('识别模型加载失败。请检查网络后重试，或手动圈选家具。');
    worker.onmessage=({data})=>{
      if(data.id!==id)return;
      if(data.type==='progress')onProgress(data.message,data.percent);
      else if(data.type==='error')fail(data.message);
      else if(data.type==='complete'){cleanup();resolve(data.candidates);}
    };
    if(signal.aborted){abort();return;}
    worker.postMessage({id,image});
  });
}
