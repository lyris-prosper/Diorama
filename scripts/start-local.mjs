// Starts 方寸 Diorama on this Mac: checks the local models, applies the database migrations, runs
// the dev server on http://localhost:5173, readies the sample bedroom and opens the page in Chrome
// (Safari's WebAssembly engine crashes on the 3D room). NO_OPEN=1 leaves the browser alone.
import { spawn } from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
process.chdir(root);
// Local tools only: no Cloudflare fetches, usage metrics or log files.
process.env.CLOUDFLARE_CF_FETCH_ENABLED||='false';
process.env.WRANGLER_SEND_METRICS||='false';
process.env.WRANGLER_WRITE_LOGS||='false';
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,ROOM_LOCAL:'1'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('启动检查失败，请查看上方提示。 Start-up check failed; see above.')));});}
const ready=async url=>{for(let i=0;i<120;i++){try{if((await fetch(url)).ok)return true;}catch{}await new Promise(r=>setTimeout(r,500));}return false;};
// The sample bedroom's room files are copied (or downloaded once, free) before the first demo upload.
async function prepareDemo(){
  if(!(await ready('http://127.0.0.1:5173/api/workbench?capabilities=1')))return;
  try{
    const r=await fetch('http://127.0.0.1:5173/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare-demo'})});
    const j=await r.json();
    console.log(r.ok?`演示卧室已就绪 · Sample bedroom ready${j.copied?`（${j.copied} 个文件）`:''}`:`演示卧室暂未就绪 · Sample bedroom not ready: ${j.error}`);
  }catch(e){console.log('演示卧室暂未就绪 · Sample bedroom not ready:',e.message);}
}
async function openWhenReady(url){
  await ready(url);
  if(process.platform!=='darwin')return;
  const open=args=>new Promise(r=>spawn('open',args,{stdio:'ignore'}).on('exit',code=>r(code===0)).on('error',()=>r(false)));
  if(!(await open(['-a','Google Chrome',url]))&&!(await open(['-a','Microsoft Edge',url])))await open([url]);
}
// Already running (another window, or started in the background): just open the page.
const running=await fetch('http://127.0.0.1:5173/api/local/status').then(r=>r.ok&&r.json()).catch(()=>null);
if(running?.local){
  console.log('\n方寸 Diorama 已经在运行 · already running: http://localhost:5173\n');
  await prepareDemo();
  if(!process.env.NO_OPEN)await openWhenReady('http://localhost:5173');
  process.exit(0);
}
await run(['scripts/setup-local-models.mjs']);
await run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state']);
console.log('\n方寸 Diorama：http://localhost:5173\n照片、识别、抠图与背景修复均保存在本机。关闭此窗口将停止服务。\nEverything stays on this Mac. Closing this window stops the app.\n');
if(!process.env.NO_OPEN)void openWhenReady('http://localhost:5173');
void prepareDemo();
await run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']);
