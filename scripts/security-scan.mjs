import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
const keys=readFileSync('.dev.vars','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{try{return JSON.parse(l.slice(l.indexOf('=')+1));}catch{return '';}}).filter(v=>typeof v==='string'&&v.length>12);
let scanned=0;const leaks=[];
const skip=new Set(['node_modules','.git','.sites-runtime','.wrangler','work','outputs','.dev.vars']);
function walk(dir){for(const name of readdirSync(dir)){if(skip.has(name)||name.startsWith('.dev.vars'))continue;const path=join(dir,name);if(statSync(path).isDirectory())walk(path);else{const data=readFileSync(path);scanned++;if(keys.some(k=>data.includes(Buffer.from(k))))leaks.push(path);}}}
walk('.');console.log(JSON.stringify({scanned,credentialLeaks:leaks.length,files:leaks}));if(leaks.length)process.exit(1);
