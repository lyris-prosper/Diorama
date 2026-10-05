// Offline tests for the furniture inputs, uploads and library: the real route handler on real
// SQLite, with storage and every network call mocked. No paid request can leave this process.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
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
env.BUCKET={
  async get(key){const o=objects.get(key);return o?{arrayBuffer:async()=>o.bytes.buffer.slice(o.bytes.byteOffset,o.bytes.byteOffset+o.bytes.byteLength),httpMetadata:{contentType:o.type}}:null},
  async head(key){const o=objects.get(key);return o?{httpMetadata:{contentType:o.type}}:null},
  async put(key,bytes,options){objects.set(key,{bytes:Buffer.from(bytes),type:options.httpMetadata.contentType})},
};
const cache=new Map();
function locate(from,name){
  const base=name.startsWith('@/')?resolve(root,name.slice(2)):resolve(dirname(from),name);
  for(const ext of ['','.ts','.tsx'])if(existsSync(base+ext)&&statSync(base+ext).isFile())return base+ext;
  throw Error('Unexpected import '+name);
}
function load(path){
  path=resolve(path);if(cache.has(path))return cache.get(path).exports;
  const mod={exports:{}};cache.set(path,mod);
  if(path.endsWith('.json')){mod.exports=JSON.parse(readFileSync(path,'utf8'));return mod.exports;}
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText;
  const sandbox={Buffer,Blob,FormData,Headers,Response,Request,AbortSignal,URL,crypto,console,process:{env:{NODE_ENV:'development'}},setTimeout:(f)=>queueMicrotask(f),fetch:async(url,init={})=>{calls.push({url,init});if(!handler)throw Error('Network disabled');return handler(url,init)}};
  const fn=vm.runInNewContext(`(function(require,module,exports){${code}\n})`,sandbox,{filename:path});
  fn(name=>name==='cloudflare:workers'?{env}:name==='@fal-ai/client'?{createFalClient:()=>{throw Error('FAL disabled in offline tests')}}:load(locate(path,name)),mod,mod.exports);
  return mod.exports;
}
const route=load(root+'/app/api/workbench/route.ts');
const catalog=JSON.parse(readFileSync('lib/catalog.json','utf8')).items;
const json=(data,status=200)=>Response.json(data,{status});
const USER='local-preview';
const post=async body=>{const r=await route.POST(new Request('http://127.0.0.1:5173/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
const rejects=async(body,pattern)=>{const r=await post(body);assert.equal(r.status,400,JSON.stringify(r.data));assert.match(r.data.error,pattern);return r;};
const png=(key)=>objects.set(key,{bytes:Buffer.from([137,80,78,71]),type:'image/png'});
const C1='11111111-1111-4111-8111-111111111111',C2='22222222-2222-4222-8222-222222222222';
function fixture(over={}){return {id:'p',name:'test',mode:'real',stage:'review',branch:'edit',intent:'',
  original:'p/uploads/original-a.png',
  candidates:[{id:C1,name:'书桌',kind:'desk',mask:'p/uploads/m1.png',box:[0,0,1,1],score:.9,selected:true,source:'local-detr'},
              {id:C2,name:'椅子',kind:'chair',mask:'p/uploads/m2.png',box:[0,0,1,1],score:.9,selected:true,source:'local-detr'}],
  cutouts:{[C1]:'p/uploads/cutout-'+C1+'-a.png',[C2]:'p/uploads/cutout-'+C2+'-a.png'},
  items:[],tasks:[],floor:{height:0,size:6,confirmed:true},updatedAt:0,revision:0,...over};}
function reset(project=fixture()){
  sql?.close();sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync('drizzle/0000_magical_white_queen.sql','utf8'));sql.exec(readFileSync('drizzle/0001_provider_accounting.sql','utf8'));
  sql.prepare('INSERT INTO projects(id,owner,data,updated,revision) VALUES(?,?,?,?,0)').run(project.id,USER,JSON.stringify(project),Date.now());
  calls=[];handler=null;objects=new Map();delete env.TRIPO_CREDIT_LIMIT;
  for(const k of [project.original,...Object.values(project.cutouts??{})])if(k)png(k);
}
const jobs=()=>sql.prepare('SELECT * FROM jobs ORDER BY id').all();
const paidPosts=()=>calls.filter(c=>(c.init.method||'GET')==='POST').length;
const balanceHandler=(tripo=1000,world=5000)=>url=>url.endsWith('/credits')?json({remaining_credits:world}):url.endsWith('/account/balance')?json({code:0,data:{balance:tripo}}):json({},404);
let tests=0;
async function test(name,fn){reset();await fn();tests++;console.log('PASS '+name)}

await test('set-furniture-input validates ownership, format, size and stage',async()=>{
  png('other/uploads/product-photo-'+C1+'-x.png');
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,photo:'other/uploads/product-photo-'+C1+'-x.png'},/不属于/);
  // A photo uploaded for one piece cannot be attached to another.
  png('p/uploads/product-photo-'+C2+'-x.png');
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,photo:'p/uploads/product-photo-'+C2+'-x.png'},/不属于/);
  objects.set('p/uploads/product-photo-'+C1+'-w.png',{bytes:Buffer.from([1]),type:'image/webp'});
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,photo:'p/uploads/product-photo-'+C1+'-w.png'},/PNG 或 JPEG/);
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,dims:{w:120,d:3,h:74}},/5–400/);
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,dims:{w:120,d:'abc',h:74}},/5–400/);
  await rejects({action:'set-furniture-input',id:'p',candidate:'unknown',dims:{w:120,d:45,h:74}},/先完成预览/);
  png('p/uploads/product-photo-'+C1+'-ok.png');
  const ok=await post({action:'set-furniture-input',id:'p',candidate:C1,photo:'p/uploads/product-photo-'+C1+'-ok.png',dims:{w:'118',d:45,h:74}});
  assert.equal(ok.status,200);assert.equal(ok.data.productPhotos[C1],'p/uploads/product-photo-'+C1+'-ok.png');assert.deepEqual(ok.data.furnitureDims[C1],{w:118,d:45,h:74});
  const cleared=await post({action:'set-furniture-input',id:'p',candidate:C1,dims:null});
  assert.equal(cleared.data.furnitureDims[C1],undefined);assert.equal(cleared.data.productPhotos[C1],'p/uploads/product-photo-'+C1+'-ok.png');
  reset(fixture({stage:'generating'}));
  await rejects({action:'set-furniture-input',id:'p',candidate:C1,dims:{w:118,d:45,h:74}},/先完成预览/);
  assert.equal(paidPosts(),0);
});

await test('generate sends the product photo instead of the cut-out and sizes the piece',async()=>{
  png('p/uploads/background-a.png');png('p/uploads/product-photo-'+C1+'-ok.png');
  await post({action:'set-furniture-input',id:'p',candidate:C1,photo:'p/uploads/product-photo-'+C1+'-ok.png',dims:{w:118,d:45,h:74}});
  handler=balanceHandler();
  const r=await post({action:'generate',id:'p',approved:true,background:'p/uploads/background-a.png'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  const furniture=Object.fromEntries(jobs().filter(j=>j.kind==='furniture').map(j=>[j.target,JSON.parse(j.payload).image]));
  assert.equal(furniture[C1],'p/uploads/product-photo-'+C1+'-ok.png');
  assert.equal(furniture[C2],'p/uploads/cutout-'+C2+'-a.png');
  const desk=r.data.items.find(i=>i.id===C1),chair=r.data.items.find(i=>i.id===C2);
  assert.deepEqual(desk.dims,{w:118,d:45,h:74});assert.equal(desk.height,.74);assert.equal(desk.source,'photo');
  assert.equal(chair.dims,undefined);
  // Generation is only queued here; nothing is submitted until a tick.
  assert.equal(paidPosts(),0);
});

const piece=(n=1,over={})=>Array.from({length:n},(_,i)=>{const key=`p/uploads/add-furniture-${i}.png`;png(key);return {name:'落地灯 '+i,kind:'other',dims:{w:30,d:30,h:150},image:key,...over};});
await test('add-furniture validates the batch before reserving anything',async()=>{
  reset(fixture({stage:'ready',room:{splat:'p/room/s.spz',scale:1,offset:0}}));
  handler=balanceHandler();
  await rejects({action:'add-furniture',id:'p',furniture:piece(9),approved:true},/最多添加 8/);
  await rejects({action:'add-furniture',id:'p',furniture:[],approved:true},/至少添加一件/);
  await rejects({action:'add-furniture',id:'p',furniture:piece(1)},/确认预计消耗/);
  png('q/uploads/add-furniture-x.png');
  await rejects({action:'add-furniture',id:'p',furniture:piece(1,{image:'q/uploads/add-furniture-x.png'}),approved:true},/不属于/);
  await rejects({action:'add-furniture',id:'p',furniture:piece(1,{image:'p/uploads/background-a.png'}),approved:true},/不属于/);
  await rejects({action:'add-furniture',id:'p',furniture:piece(1,{dims:{w:30,d:30,h:401}}),approved:true},/5–400/);
  await rejects({action:'add-furniture',id:'p',furniture:piece(1,{name:'  '}),approved:true},/名称/);
  assert.equal(jobs().length,0);
});

await test('add-furniture refuses a batch beyond the budget or the balance, and reserves per piece',async()=>{
  reset(fixture({stage:'ready',room:{splat:'p/room/s.spz',scale:1,offset:0}}));
  env.TRIPO_CREDIT_LIMIT=50;handler=balanceHandler();
  await rejects({action:'add-furniture',id:'p',furniture:piece(2),approved:true},/预算上限/);
  assert.equal(jobs().length,0);
  delete env.TRIPO_CREDIT_LIMIT;handler=balanceHandler(40);
  await rejects({action:'add-furniture',id:'p',furniture:piece(2),approved:true},/积分不足/);
  assert.equal(jobs().length,0);
  handler=balanceHandler(1000);
  const r=await post({action:'add-furniture',id:'p',furniture:piece(2),approved:true});
  assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.note,'');
  const added=r.data.items.filter(i=>i.source==='upload');
  assert.deepEqual([...r.data.added].sort(),added.map(i=>i.id).sort());
  assert.equal(added.length,2);assert.equal(added[0].status,'queued');assert.deepEqual(added[0].dims,{w:30,d:30,h:150});assert.equal(added[0].height,1.5);
  const js=jobs();assert.equal(js.length,2);assert(js.every(j=>j.kind==='furniture'&&j.reserved===30&&j.status==='queued'));
  assert.deepEqual(js.map(j=>j.target).sort(),added.map(i=>i.id).sort());
  assert.equal(paidPosts(),0);
});

await test('add-furniture is unavailable in the demo room',async()=>{
  reset(fixture({mode:'demo',stage:'ready'}));
  await rejects({action:'add-furniture',id:'p',furniture:piece(1),approved:true},/示例房间/);
});

await test('add-catalog-item adds a ready library piece without any service call',async()=>{
  const entry=catalog.find(i=>i.id==='flowerpot-vp9');
  await rejects({action:'add-catalog-item',id:'p',catalogId:'flowerpot-vp9'},/先生成或导入 3D 房间/);
  await rejects({action:'add-catalog-item',id:'p',catalogId:'no-such-thing'},/没有这件家具/);
  reset(fixture({mode:'demo',stage:'ready'}));
  const r=await post({action:'add-catalog-item',id:'p',catalogId:'flowerpot-vp9'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  const item=r.data.items.find(i=>i.id===r.data.added);
  assert.equal(item.status,'ready');assert.equal(item.model,entry.model);assert.equal(item.height,entry.modelHeight);
  assert.equal(item.source,'catalog');assert.equal(item.catalogId,'flowerpot-vp9');assert.deepEqual(item.dims,entry.dims);
  const placed=await post({action:'add-catalog-item',id:'p',catalogId:'lisabo-desk',position:[1,0,-.5]});
  const desk=placed.data.items.find(i=>i.id===placed.data.added);
  assert.equal(desk.status,'placed');assert.deepEqual(desk.position,[1,0,-.5]);
  await rejects({action:'add-catalog-item',id:'p',catalogId:'lisabo-desk',position:[1,0,'x']},/位置无效/);
  await rejects({action:'add-catalog-item',id:'p',catalogId:'lisabo-desk',position:[1,0,99]},/位置无效/);
  assert.equal(jobs().length,0);assert.equal(calls.length,0);
});

await test('library pieces survive saving; small heights are kept; the item cap holds',async()=>{
  reset(fixture({mode:'demo',stage:'ready'}));
  const r=await post({action:'add-catalog-item',id:'p',catalogId:'kivi-votive',position:[0,0.762,0]});
  const kivi=r.data.items.find(i=>i.id===r.data.added);
  const saved=await post({action:'save',id:'p',items:[{...kivi,position:[0.2,0.762,0.1],height:kivi.height,scale:1.2}]});
  assert.equal(saved.status,200);
  const back=saved.data.items[0];
  assert.equal(back.model,kivi.model);assert.equal(back.catalogId,'kivi-votive');assert.equal(back.height,kivi.height);assert(back.height<0.1);
  assert.deepEqual(back.position,[0.2,0.762,0.1]);
  // Items the server never created are dropped.
  const forged=await post({action:'save',id:'p',items:[{...kivi,id:'forged',position:[0,0,0]}]});
  assert.equal(forged.data.items.length,0);
  reset(fixture({mode:'demo',stage:'ready',items:Array.from({length:60},(_,i)=>({id:'i'+i,name:'x',kind:'desk',status:'ready',position:[0,0,0],rotation:0,scale:1,height:1}))}));
  await rejects({action:'add-catalog-item',id:'p',catalogId:'kivi-votive'},/最多放 60/);
});

sql.close();console.log(`${tests} offline furniture tests passed; paid API calls: 0`);
