import { fork, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import getRawBody from 'raw-body';
// Runs only on loopback. Models and photos never pass through a hosted inference service.
// macOS memory that can be handed to a new process without swapping: free + inactive + speculative + purgeable.
export function availableMB(){
  try {
    const out=execFileSync('vm_stat',{encoding:'utf8'}),page=Number(/page size of (\d+)/.exec(out)?.[1]||16384);
    const pages=k=>Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(out)?.[1]||0);
    return (pages('free')+pages('inactive')+pages('speculative')+pages('purgeable'))*page/1048576;
  } catch { return Infinity; }
}
export const NEEDED_MB={recognize:3000,inpaint:1500}; // measured peaks: recognition 3–4.8 GB, LaMa ~0.85 GB
// Messages for the page in both languages; it shows the one it is in.
const msg=(zh,en)=>({zh,en});
export function localVision(){
  const jobs=new Map();
  return {name:'room-local-vision',configureServer(server){
    const root=server.config.root;
    const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
    server.middlewares.use(async(req,res,next)=>{
      const pathname=(req.url||'').split('?')[0];
      if(!pathname.startsWith('/api/local/'))return next();
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return send(res,403,{error:msg('仅允许本机访问。','Only this Mac may use this.')});
      if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(res,403,{error:msg('请求来源不被允许。',"Requests from that page aren't allowed.")});
      try {
        if(pathname==='/api/local/status'&&req.method==='GET')return send(res,200,{local:true,recognition:existsSync(path.join(root,'public/vision/models/slimsam/onnx/vision_encoder.onnx')),inpainting:existsSync(path.join(root,'.local/models/lama_fp32.onnx')),engine:'LaMa',cost:0,memoryMB:Math.round(availableMB()),neededMB:NEEDED_MB});
        if(pathname==='/api/local/jobs'&&req.method==='POST'){
          if([...jobs.values()].some(j=>j.status==='running'))return send(res,409,{error:msg('本地模型正在处理另一个任务，请等待完成或先取消。','The local model is busy with another job. Wait, or cancel it first.')});
          const body=JSON.parse(await getRawBody(req,{limit:'30mb',encoding:'utf8'}));
          if(!['recognize','inpaint'].includes(body.kind)||typeof body.image!=='string'||(body.kind==='inpaint'&&typeof body.mask!=='string'))throw Object.assign(Error('图片或轮廓缺失。'),{en:'The image or outline is missing.'});
          for(const value of [body.image,body.mask].filter(Boolean))if(value.length>15e6||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Object.assign(Error('图片格式无效或超过 10 MB。'),{en:'The image is invalid or over 10 MB.'});
          const free=availableMB();
          if(free<NEEDED_MB[body.kind])return send(res,503,{error:msg(`电脑可用内存约 ${(free/1024).toFixed(1)} GB，本地模型需要约 ${NEEDED_MB[body.kind]/1000} GB。请先关闭浏览器标签页或其他软件后重试。`,`About ${(free/1024).toFixed(1)} GB of memory is free; the local model needs about ${NEEDED_MB[body.kind]/1000} GB. Close browser tabs or other apps and try again.`)});
          const id=randomUUID();
          // A child process, not a worker thread: model memory stays out of the dev server and is released on exit.
          const child=fork(path.join(root,'scripts/local-vision-worker.mjs'),[],{execArgv:[],stdio:['ignore','inherit','inherit','ipc']});
          child.send(body);
          const worker={terminate:()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},on:(e,f)=>child.on(e,f)};
          const job={status:'running',message:msg('正在准备本地模型','Preparing the local model'),worker,created:Date.now()};jobs.set(id,job);
          const finish=()=>{clearTimeout(job.timeout);void worker.terminate();job.worker=null;};
          job.timeout=setTimeout(()=>{job.status='failed';job.error=msg('本地处理超过 5 分钟，请缩小图片或减少选择后重试。','Local processing took over 5 minutes. Use a smaller image or fewer pieces and try again.');finish();},300000);
          worker.on('message',msg=>{
            if(msg.type==='progress')job.message=msg.message;
            if(msg.type==='complete'){job.status='done';job.result=msg.result;finish();}
            if(msg.type==='error'){job.status='failed';job.error=msg.message;finish();}
          });
          worker.on('error',e=>{job.status='failed';job.error=msg(e.message,e.message);finish();});
          worker.on('exit',()=>{if(job.status==='running'){job.status='failed';job.error=msg('本地处理已中断，可以重试。','Local processing stopped. You can try again.');clearTimeout(job.timeout);}});
          return send(res,202,{id});
        }
        const id=pathname.split('/').pop(),job=jobs.get(id);
        if(!job)return send(res,404,{error:msg('任务不存在或已结束，请重试。','That job no longer exists. Try again.')});
        if(req.method==='DELETE'){clearTimeout(job.timeout);await job.worker?.terminate();jobs.delete(id);return send(res,200,{cancelled:true});}
        if(req.method==='GET')return send(res,200,{status:job.status,message:job.message,result:job.result,error:job.error});
        return send(res,405,{error:msg('不支持此操作。','Not supported.')});
      }catch(e){return send(res,400,{error:msg(e.message,e.en??e.message)});}
    });
    const cleanup=setInterval(()=>{for(const [id,j]of jobs)if(Date.now()-j.created>15*60e3){clearTimeout(j.timeout);void j.worker?.terminate();jobs.delete(id);}},60000);cleanup.unref();
    server.httpServer?.once('close',()=>{clearInterval(cleanup);for(const j of jobs.values()){clearTimeout(j.timeout);void j.worker?.terminate();}jobs.clear();});
  }};
}
