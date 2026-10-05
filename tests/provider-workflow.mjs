// Offline integration tests: real SQLite + production TS, all network calls mocked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const root=process.cwd();
let sql,handler,calls=[],objects=new Map();
const env={WORLDLABS_API_KEY:'test-world-secret',TRIPO_API_KEY:'test-tripo-secret'};
function statement(query,args=[]){return {
  bind(...values){return statement(query,values)},
  async first(){return sql.prepare(query).get(...args)??null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},
};}
env.DB={prepare:statement,async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
env.BUCKET={async get(key){const o=objects.get(key);return o?{arrayBuffer:async()=>o.bytes.buffer.slice(o.bytes.byteOffset,o.bytes.byteOffset+o.bytes.byteLength),httpMetadata:{contentType:o.type}}:null},async put(key,bytes,options){objects.set(key,{bytes:Buffer.from(bytes),type:options.httpMetadata.contentType})}};
const cache=new Map();
function load(path){
  path=resolve(path);if(cache.has(path))return cache.get(path).exports;
  const mod={exports:{}};cache.set(path,mod);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const sandbox={Buffer,Blob,FormData,Headers,Response,Request,AbortSignal,URL,crypto,console,process:{env:{NODE_ENV:'development'}},setTimeout:(f)=>queueMicrotask(f),fetch:async(url,init={})=>{calls.push({url,init});if(!handler)throw Error('Network disabled');return handler(url,init)}};
  const fn=vm.runInNewContext(`(function(require,module,exports){${code}\n})`,sandbox,{filename:path});
  fn(name=>name==='cloudflare:workers'?{env}:name==='@fal-ai/client'?{createFalClient:()=>{throw Error('FAL disabled in offline tests')}}:name.startsWith('.')?load(resolve(dirname(path),name+'.ts')):(()=>{throw Error('Unexpected import '+name)})(),mod,mod.exports);
  return mod.exports;
}
const http=load(root+'/lib/server/provider-http.ts');
const providers=load(root+'/lib/server/providers.ts');
const jobs=load(root+'/lib/server/jobs.ts');
const budget=load(root+'/lib/server/job-budget.ts');
const storage=load(root+'/lib/server/storage.ts');
const json=(data,status=200)=>Response.json(data,{status});
const project={id:'p',name:'test',mode:'real',stage:'generating',branch:'edit',items:[{id:'chair',name:'椅子',status:'queued'}],candidates:[],tasks:[],floor:{confirmed:false},revision:0};
function reset(){sql?.close();sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0000_magical_white_queen.sql','utf8'));sql.exec(readFileSync('drizzle/0001_provider_accounting.sql','utf8'));sql.prepare('INSERT INTO projects(id,owner,data,updated,revision) VALUES(?,?,?,?,0)').run('p','u',JSON.stringify(project),Date.now());calls=[];objects=new Map([['image',{bytes:Buffer.from([137,80,78,71]),type:'image/png'}]]);delete env.TRIPO_CREDIT_LIMIT;delete env.WORLDLABS_CREDIT_LIMIT;delete env.LOCAL_OPTIMIZER;}
const job=()=>sql.prepare('SELECT * FROM jobs ORDER BY updated DESC LIMIT 1').get();
const tick=()=>jobs.tick('p','u');
const enqueue=(kind='furniture')=>jobs.enqueue(project,'u',kind,kind==='world'?'room':'chair',{image:'image'});
let tests=0;
async function test(name,fn){reset();await fn();tests++;console.log('PASS '+name)}
await test('specific errors retain request ID and redact the key',async()=>{
 for(const [status,code,category] of [[401,1000,'auth'],[403,2010,'balance'],[422,2002,'parameters'],[500,0,'provider']]){
  handler=()=>json({code,message:'test-tripo-secret rejected',request_id:'req-test'},status);
  await assert.rejects(http.providerJSON('https://openapi.tripo3d.ai/v3/tasks/test',{headers:{Authorization:'Bearer test-tripo-secret'}}),e=>e.category===category&&e.requestId==='req-test'&&!e.message.includes('test-tripo-secret'));
 }
});
await test('GET retries at most three times; POST is never retried',async()=>{
 handler=()=>json({message:'busy'},503);await assert.rejects(http.providerJSON('https://openapi.tripo3d.ai/v3/tasks/test'));assert.equal(calls.length,3);
 calls=[];handler=()=>{throw new DOMException('timeout','TimeoutError')};await assert.rejects(http.providerJSON('https://openapi.tripo3d.ai/v3/generation/image-to-model',{method:'POST'},true),e=>e.uncertain&&e.category==='timeout');assert.equal(calls.length,1);
 calls=[];let count=0;handler=()=>++count<3?json({},503):json({code:0,data:{status:'running'}});assert.equal((await http.providerJSON('https://openapi.tripo3d.ai/v3/tasks/test')).data.status,'running');assert.equal(calls.length,3);
});
await test('explicit rejection releases reserve and needs paid confirmation to resubmit',async()=>{
 handler=url=>url.endsWith('/files')?json({code:0,data:{file_token:'file-test'}}):json({code:2010,message:'Insufficient credits',request_id:'req-balance'},403);
 await enqueue();await tick();assert.equal(job().status,'failed');assert.equal(job().reserved,0);assert.match(job().error,/余额不足/);
 await assert.rejects(jobs.retryJob(job().id,'p','u'),/明确确认/);await tick();assert.equal(calls.filter(c=>c.init.method==='POST'&&!c.url.endsWith('/files')).length,1);
 await jobs.retryJob(job().id,'p','u',true);assert.equal(job().status,'queued');assert.equal(job().reserved,30);
});
await test('uncertain submission stays blocked even with confirmPaid',async()=>{
 handler=url=>{if(url.endsWith('/files'))return json({code:0,data:{file_token:'f'}});throw Error('lost connection')};await enqueue();await tick();assert.equal(job().status,'uncertain');assert.equal(job().reserved,30);
 await assert.rejects(jobs.retryJob(job().id,'p','u',true),/禁止再次提交/);await tick();assert.equal(calls.length,2);
});
await test('missing task ID is uncertain; upload failure creates no paid task',async()=>{
 handler=url=>url.endsWith('/files')?json({code:0,data:{file_token:'f'}}):json({code:0,data:{}});await enqueue();await tick();assert.equal(job().status,'uncertain');
 reset();handler=()=>{throw Error('upload disconnected')};await enqueue();await tick();assert.equal(job().status,'failed');assert.equal(job().reserved,0);assert.equal(calls.length,1);
});
function normalHandler(status='success',cost=30){return (url,init)=>{
 if(url.endsWith('/files'))return json({code:0,data:{file_token:'f'}});
 if(url.includes('/generation/')){const body=JSON.parse(init.body);assert.equal(body.pbr,false);assert.equal(body.texture,true);assert.equal(body.texture_quality,'standard');return json({code:0,data:{task_id:'task-fixed'}})}
 if(url.includes('/tasks/'))return json({code:0,data:{status,credits_consumed:cost,error_message:'mock terminal detail',output:{model_url:'https://assets.example/model.glb'}}});
 const b=Buffer.alloc(12);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(12,8);return new Response(b);
}}
await test('poll timeout preserves ID and continues without another generation POST',async()=>{
 handler=normalHandler();await enqueue();await tick();sql.prepare('UPDATE jobs SET poll_started=?').run(Date.now()-6*60000);await tick();assert.equal(job().status,'paused');assert.equal(job().provider,'task-fixed');assert.equal(job().reserved,30);
 await jobs.retryJob(job().id,'p','u');await tick();assert.equal(job().status,'done');assert.equal(job().actual_credits,30);assert.equal(job().reserved,0);assert.equal(calls.filter(c=>c.url.includes('/generation/')).length,1);assert(objects.has('p/models/chair.glb'));
});
const OPTIMIZER='http://127.0.0.1:5173/api/local/optimize-glb';
const glb=n=>{const b=Buffer.alloc(n);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(n,8);return b};
await test('a generated model is slimmed locally; the room loads the copy, the download is kept',async()=>{
 env.LOCAL_OPTIMIZER=OPTIMIZER;const base=normalHandler();
 handler=(url,init)=>url.startsWith(OPTIMIZER)?new Response(glb(16)):base(url,init);
 await enqueue();await tick();await tick();assert.equal(job().status,'done');
 assert(objects.has('p/models/chair.glb'),'original kept');assert.equal(objects.get('p/models/chair.lite.glb').bytes.length,16);
 assert.equal((await storage.getProject('p','u')).items[0].model,'p/models/chair.lite.glb');
 const sent=calls.find(c=>c.url.startsWith(OPTIMIZER));assert.equal(sent.init.method,'POST');
});
await test('when slimming fails the original model is used and the paid job still completes',async()=>{
 env.LOCAL_OPTIMIZER=OPTIMIZER;const base=normalHandler();
 handler=(url,init)=>url.startsWith(OPTIMIZER)?json({error:'busy'},503):base(url,init);
 await enqueue();await tick();await tick();assert.equal(job().status,'done');assert.equal(job().actual_credits,30);
 assert.equal((await storage.getProject('p','u')).items[0].model,'p/models/chair.glb');assert(!objects.has('p/models/chair.lite.glb'));
});
await test('download retry preserves charge and never double charges; overlapping ticks are locked',async()=>{
 const base=normalHandler();let first=true;handler=(url,init)=>{if(url.startsWith('https://assets.')&&first){first=false;return new Response('bad',{status:503})}return base(url,init)};
 await enqueue();await tick();await Promise.all([tick(),tick()]);assert.equal(job().status,'paused');assert.equal(job().actual_credits,30);assert.equal(job().reserved,0);
 await jobs.retryJob(job().id,'p','u');await tick();assert.equal(job().status,'done');assert.equal(sql.prepare('SELECT count(*) AS n FROM job_charges').get().n,1);assert.equal(calls.filter(c=>c.url.includes('/generation/')).length,1);
});
await test('failed/cancelled/banned/expired stop polling and release reserve',async()=>{
 for(const status of ['failed','cancelled','banned','expired']){reset();handler=normalHandler(status,0);await enqueue();await tick();await tick();assert.equal(job().status,'failed');assert.equal(job().reserved,0);assert.equal(job().actual_credits,0);assert.equal(JSON.parse(job().result).providerStatus,status);const n=calls.length;await tick();assert.equal(calls.length,n)}
});
await test('budget cap includes settled spending, and retries preserve earlier charges',async()=>{
 env.TRIPO_CREDIT_LIMIT=50;handler=normalHandler('expired',30);await enqueue();await tick();await tick();await assert.rejects(jobs.retryJob(job().id,'p','u',true),/预算/);
 env.TRIPO_CREDIT_LIMIT=100;await jobs.retryJob(job().id,'p','u',true);handler=normalHandler('success',0);await tick();await tick();const b=await budget.budgetSummary('furniture');assert.equal(b.actual,30);assert.equal(b.reserved,0);assert.equal(job().actual_credits,0);assert.equal(sql.prepare('SELECT count(*) n FROM job_charges').get().n,2);
});
await test('unknown successful charge remains explicitly unconfirmed, never recorded as zero',async()=>{
 handler=normalHandler('success',null);await enqueue();await tick();await tick();assert.equal(job().actual_credits,null);assert.equal(job().reserved,0);assert.equal((await budget.budgetSummary('furniture')).unconfirmed,30);
});
await test('World Labs numeric actual cost retains billing line items',async()=>{
 handler=(url,init)=>{
  if(url.endsWith('worlds:generate')){const b=JSON.parse(init.body);assert.equal(b.model,'marble-1.0-draft');assert.equal(b.world_prompt.is_pano,false);return json({operation_id:'op-fixed'})}
  if(url.includes('/operations/'))return json({done:true,cost:{total_credits:230,line_items:[{name:'pano',credits:80},{name:'draft',credits:150}]},response:{world_id:'w',assets:{splats:{spz_urls:{'100k':'https://assets.example/room.spz'}}}}});
  return new Response(new Uint8Array([0x1f,0x8b,1,2]));
 };await enqueue('world');await tick();await tick();assert.equal(job().status,'done');assert.equal(job().actual_credits,230);assert.equal(JSON.parse(job().billing_details).length,2);assert(objects.has('p/room/scene.spz'));
});
await test('invalid GLB is not marked ready',async()=>{
 const base=normalHandler();handler=(url,init)=>url.startsWith('https://assets.')?new Response('not a model'):base(url,init);await enqueue();await tick();await tick();assert.equal(job().status,'paused');assert.match(job().error,/GLB/);assert(!objects.has('p/models/chair.glb'));
});
await test('legacy migration retains completed charges and pauses incomplete failures',async()=>{
 sql.close();sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0000_magical_white_queen.sql','utf8'));
 const insert=sql.prepare('INSERT INTO jobs(id,project,owner,kind,target,status,provider,payload,result,updated,reserved) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 insert.run('old','p','u','world','room','done','op','{}',JSON.stringify({cost:{total_credits:230}}),Date.now(),250);
 insert.run('interrupted','p','u','furniture','chair','failed','task','{}',JSON.stringify({terminal:false}),Date.now(),100);
 sql.exec(readFileSync('drizzle/0001_provider_accounting.sql','utf8'));
 assert.equal(sql.prepare("SELECT reserved FROM jobs WHERE id='old'").get().reserved,0);assert.equal(sql.prepare('SELECT actual FROM job_charges').get().actual,230);assert.equal(sql.prepare("SELECT status FROM jobs WHERE id='interrupted'").get().status,'paused');
});
sql.close();console.log(`${tests} offline tests passed; paid API calls: 0`);
