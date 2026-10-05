import './sites-env.mjs';
import { spawn } from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,ROOM_LOCAL:'1'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('启动检查失败，请查看上方提示。')));});}
await run(['scripts/setup-local-models.mjs']);
await run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state']);
console.log('\n房间工作台：http://localhost:5173\n照片、识别、抠图与背景修复均保存在本机。关闭此窗口将停止服务。\n');
await run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']);
