import type { Candidate } from './types';
import { localStatus, localVisionJob, base64Blob } from './local-vision';
import { currentLang, pick } from './i18n';
export type LocalCandidate = Omit<Candidate,'id'|'mask'|'selected'|'source'> & {mask:Blob};
export async function recognizeFurniture(image:Blob,onProgress:(message:string,percent?:number)=>void,signal:AbortSignal) {
  // DETR + SlimSAM in a child process on this machine (build/local-vision-plugin.mjs).
  const t=pick(currentLang());
  const local=await localStatus();
  if(!local?.local)throw Error(t('本机模型服务没有响应，请重新启动工作台。','The local model helper is not answering. Restart the app.'));
  if(!local.recognition)throw Error(t('本地模型未安装，请重新启动工作台完成模型检查。','The local models are not installed. Restart the app to finish the model check.'));
  const result=await localVisionJob('recognize',image,undefined,onProgress,signal);
  return result.candidates.map((c:any)=>({...c,mask:base64Blob(c.mask)})) as LocalCandidate[];
}
