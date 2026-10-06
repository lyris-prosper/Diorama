// The online demo's in-browser API (lib/demo-backend.ts) on a plain in-memory store: the sample
// bedroom flow works, everything else is turned away with a clear message, and nothing is fetched.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './harness.mjs';
const h=harness();
const B=h.load('lib/demo-backend.ts');
const DEMO=JSON.parse(JSON.stringify(h.load('lib/demo-room.ts').DEMO_ROOM));
let tests=0;
async function test(name,fn){await fn();tests++;console.log('PASS '+name)}
function server(){
  const store={projects:new Map(),files:new Map(),
    async save(p){store.projects.set(p.id,structuredClone(p))},async remove(id){store.projects.delete(id)},
    async putFile(k,b){store.files.set(k,b)},async dropFiles(ks){for(const k of ks)store.files.delete(k)}};
  return {store,api:B.createDemoServer(store)};
}
const photo=(file,type)=>new File([readFileSync('resources/demo/'+file)],file,{type});
const form=(id,role,file)=>{const f=new FormData();f.append('id',id);f.append('role',role);f.append('file',file);return f};
const fails=async(promise,pattern,lang='zh')=>{try{await promise}catch(e){assert.match(B.spoken(e,lang),pattern);return}assert.fail('expected an error')};
async function bedroom(api){
  const p=await api.post({action:'create',mode:'real'},'zh');
  await api.upload(form(p.id,'original',photo('bedroom.jpg','image/jpeg')));
  return api.post({action:'set-print',id:p.id,print:DEMO.photo.print},'zh');
}

await test('the sample bedroom photo opens its Marble 1.1 room, from the CDN keys',async()=>{
  const {api}=server();const p=await bedroom(api);
  assert.equal(p.demo,true);assert.equal(p.name,'卧室');assert.equal(p.stage,'ready');
  assert.equal(p.room.preset,'bedroom');assert.equal(p.room.splat,'presets/bedroom/room.spz');assert.equal(p.floor.confirmed,true);
  const list=await api.query(new URLSearchParams('list=1'));assert.equal(list.length,1);assert.equal(list[0].room,true);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.query(new URLSearchParams('capabilities=1')))),{world:false,furniture:false});
  assert.equal(h.calls.length,0,'nothing fetched');
});
await test('the sample bed photo puts the bed model back where it stood, erased from the scan',async()=>{
  const {api}=server();const p=await bedroom(api);
  const {key}=await api.upload(form(p.id,'furniture-photo',photo('bed.png','image/png')));
  const bed=DEMO.furniture[0];
  const r=await api.post({action:'edit-furniture',id:p.id,photo:key,name:'床',kind:'bed',dims:bed.dims,erase:bed.erase},'en');
  const it=r.items[0];
  assert.equal(it.model,'/demo/bed.glb');assert.equal(it.status,'placed');assert.deepEqual([...it.position],bed.placed.position);assert.equal(it.rotation,bed.placed.rotation);
  assert.equal(r.room.erasures.length,1);assert.match(r.note,/No credits spent/);
});
await test('the sample pendant photo lands on the shelf with its model; any other photo is turned away',async()=>{
  const {api}=server();const p=await bedroom(api);
  const {key}=await api.upload(form(p.id,'add-furniture',photo('pendant.png','image/png')));
  const r=await api.post({action:'add-furniture',id:p.id,approved:true,furniture:[{name:'木纹叠层吊灯',kind:'pendant',dims:{w:43,d:43,h:80},image:key}]},'zh');
  const lamp=r.items.find(i=>i.id===r.added[0]);assert.equal(lamp.model,'/demo/pendant.glb');assert.equal(lamp.kind,'pendant');assert.match(r.note,/未消耗积分/);
  const other=await api.upload(form(p.id,'add-furniture',new File([new Uint8Array([1,2,3])],'x.png',{type:'image/png'})));
  await fails(api.post({action:'add-furniture',id:p.id,furniture:[{name:'灯',kind:'other',dims:{w:20,d:20,h:30},image:other.key}]},'en'),/sample bedroom only/,'en');
});
await test('library pieces, saving (hung pieces too), renaming',async()=>{
  const {api}=server();const p=await bedroom(api);
  const r=await api.post({action:'add-catalog-item',id:p.id,catalogId:'flowerpot-vp9',position:[0.4,-0.54,-3.2],rotation:0.35},'zh');
  const lamp=r.items.find(i=>i.id===r.added);assert.equal(lamp.status,'placed');assert.equal(lamp.rotation,0.35);
  const saved=await api.post({action:'save',id:p.id,items:[{...lamp,mount:'ceiling',position:[0,1,0]}]},'zh');
  assert.equal(saved.items[0].mount,'ceiling');assert.deepEqual([...saved.items[0].position],[0,1,0]);
  assert.equal((await api.post({action:'rename',id:p.id,name:'演示'},'zh')).name,'演示');
  await fails(api.post({action:'save',id:p.id,items:[{...lamp,position:[0,'x',0]}]},'zh'),/无效布局/);
});
await test('another room photo, generation and imports are turned away; the photo leaves no space behind',async()=>{
  const {api,store}=server();
  const p=await api.post({action:'create',mode:'real'},'zh');
  await api.upload(form(p.id,'original',new File([new Uint8Array([9,9,9])],'room.png',{type:'image/png'})));
  await fails(api.post({action:'set-print',id:p.id,print:'0000000000000000'},'en'),/only knows the sample bedroom/,'en');
  assert.equal(store.projects.size,0);assert.equal(store.files.size,0);
  const q=await bedroom(api);
  for(const action of ['generate','import-world','regenerate','recognize'])await fails(api.post({action,id:q.id},'zh'),/本地运行完整版/);
});
console.log(`${tests} online demo tests passed; network calls: ${h.calls.length}`);
