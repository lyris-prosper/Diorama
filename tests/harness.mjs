// Shared by the offline route tests: the real route handler and server modules on real SQLite
// (in memory), with file storage and every network call mocked. No paid request can leave this
// process; tests answer the requests they expect through `h.handler`.
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

export function harness(){
  const root=process.cwd();
  const h={sql:null,handler:null,calls:[],objects:new Map(),env:{WORLDLABS_API_KEY:'test-world-secret',TRIPO_API_KEY:'test-tripo-secret'}};
  const statement=(query,args=[])=>({
    bind:(...values)=>statement(query,values),
    first:async()=>h.sql.prepare(query).get(...args)??null,
    all:async()=>({results:h.sql.prepare(query).all(...args)}),
    run:async()=>{const r=h.sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},
  });
  h.env.DB={prepare:statement,async batch(list){h.sql.exec('BEGIN');try{const r=[];for(const s of list)r.push(await s.run());h.sql.exec('COMMIT');return r}catch(e){h.sql.exec('ROLLBACK');throw e}}};
  h.env.BUCKET={
    async get(key){const o=h.objects.get(key);return o?{arrayBuffer:async()=>o.bytes.buffer.slice(o.bytes.byteOffset,o.bytes.byteOffset+o.bytes.byteLength),httpMetadata:{contentType:o.type}}:null},
    async head(key){const o=h.objects.get(key);return o?{httpMetadata:{contentType:o.type}}:null},
    async put(key,bytes,options){h.objects.set(key,{bytes:Buffer.from(bytes),type:options.httpMetadata.contentType})},
    // Pages of two, so callers have to follow the cursor.
    async list({prefix='',cursor}={}){const keys=[...h.objects.keys()].filter(k=>k.startsWith(prefix)).sort(),start=Number(cursor??0),page=keys.slice(start,start+2);return {objects:page.map(key=>({key})),truncated:start+page.length<keys.length,cursor:String(start+page.length)}},
    async delete(keys){for(const k of [keys].flat())h.objects.delete(k)},
  };
  const cache=new Map();
  const locate=(from,name)=>{
    const base=name.startsWith('@/')?resolve(root,name.slice(2)):resolve(dirname(from),name);
    for(const ext of ['','.ts','.tsx'])if(existsSync(base+ext)&&statSync(base+ext).isFile())return base+ext;
    throw Error('Unexpected import '+name);
  };
  h.load=function load(path){
    path=resolve(path);if(cache.has(path))return cache.get(path).exports;
    const mod={exports:{}};cache.set(path,mod);
    if(path.endsWith('.json')){mod.exports=JSON.parse(readFileSync(path,'utf8'));return mod.exports;}
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText;
    const sandbox={Buffer,Blob,FormData,Headers,Response,Request,AbortSignal,URL,DOMException,crypto,console,structuredClone,process:{env:{NODE_ENV:'development'}},setTimeout:(f)=>queueMicrotask(f),
      fetch:async(url,init={})=>{h.calls.push({url,init});if(!h.handler)throw Error('Network disabled');return h.handler(url,init)}};
    const fn=vm.runInNewContext(`(function(require,module,exports){${code}\n})`,sandbox,{filename:path});
    fn(name=>name==='cloudflare:workers'?{env:h.env}:name==='@fal-ai/client'?{createFalClient:()=>{throw Error('fal.ai is not used')}}:load(locate(path,name)),mod,mod.exports);
    return mod.exports;
  };
  /** Empty database with the app's migrations, no files, no network. */
  h.reset=()=>{
    h.sql?.close();h.sql=new DatabaseSync(':memory:');
    for(const f of ['0000_magical_white_queen.sql','0001_provider_accounting.sql'])h.sql.exec(readFileSync('drizzle/'+f,'utf8'));
    h.calls=[];h.handler=null;h.objects=new Map();
    for(const k of ['TRIPO_CREDIT_LIMIT','WORLDLABS_CREDIT_LIMIT','LOCAL_OPTIMIZER'])delete h.env[k];
  };
  h.insert=(project,owner='local-preview',updated=Date.now())=>h.sql.prepare('INSERT INTO projects(id,owner,data,updated,revision) VALUES(?,?,?,?,0)').run(project.id,owner,JSON.stringify(project),updated);
  h.file=(key,type='image/png',bytes=Buffer.from([137,80,78,71]))=>h.objects.set(key,{bytes,type});
  h.json=(data,status=200)=>Response.json(data,{status});
  return h;
}
