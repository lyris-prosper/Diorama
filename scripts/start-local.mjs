// Starts the workbench on this Mac: checks the local models, applies the database migrations, runs
// the dev server on http://localhost:5173 and opens it in Chrome (Safari's WebAssembly engine
// crashes on the 3D room). NO_OPEN=1 leaves the browser alone.
import { spawn } from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
process.chdir(root);
// Local tools only: no Cloudflare fetches, usage metrics or log files.
process.env.CLOUDFLARE_CF_FETCH_ENABLED||='false';
process.env.WRANGLER_SEND_METRICS||='false';
process.env.WRANGLER_WRITE_LOGS||='false';
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,ROOM_LOCAL:'1'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('启动检查失败，请查看上方提示。')));});}
async function openWhenReady(url){
  for(let i=0;i<120;i++){
    try{if((await fetch(url)).ok)break;}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  if(process.platform!=='darwin')return;
  const open=args=>new Promise(r=>spawn('open',args,{stdio:'ignore'}).on('exit',code=>r(code===0)).on('error',()=>r(false)));
  if(!(await open(['-a','Google Chrome',url]))&&!(await open(['-a','Microsoft Edge',url])))await open([url]);
}
await run(['scripts/setup-local-models.mjs']);
await run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state']);
console.log('\n房间工作台：http://localhost:5173\n照片、识别、抠图与背景修复均保存在本机。关闭此窗口将停止服务。\n');
if(!process.env.NO_OPEN)void openWhenReady('http://localhost:5173');
await run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']);
