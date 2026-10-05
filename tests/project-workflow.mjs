// Offline tests for spaces as a whole: the list on the home page, renaming, deleting without
// breaking shared files, the example room, reusing a room through the photo fingerprint, making a
// scanned piece editable, erase boxes, the empty-room layer, importing a Marble room and slimming
// stored models. The real route handler on real SQLite; storage and network are mocked.
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const h=harness();
const route=h.load('app/api/workbench/route.ts');
const assets=h.load('app/api/assets/route.ts');
const asset=async key=>(await assets.GET(new Request('http://127.0.0.1:5173/api/assets?key='+encodeURIComponent(key)))).status;
const URL_='http://127.0.0.1:5173/api/workbench';
const post=async body=>{const r=await route.POST(new Request(URL_,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
const get=async query=>(await route.GET(new Request(URL_+'?'+query))).json();
const rejects=async(body,pattern)=>{const r=await post(body);assert.equal(r.status,400,JSON.stringify(r.data));assert.match(r.data.error,pattern);};
const space=(id,over={})=>({id,name:'我的空间',mode:'real',stage:'ready',branch:'edit',intent:'',candidates:[],items:[],tasks:[],floor:{height:-1.2,size:8,confirmed:true},updatedAt:0,revision:0,...over});
const room=(id)=>({splat:id+'/room/import-a.spz',splatFull:id+'/room/import-a-full.spz',scale:0.7,offset:0,source:'imported',erasures:[]});
let tests=0;
async function test(name,fn){h.reset();await fn();tests++;console.log('PASS '+name)}

await test('the home page lists the person\'s own spaces, newest first, without the example room',async()=>{
  h.insert(space('old',{original:'old/uploads/original-x.png'}),'local-preview',1000);
  h.insert(space('new',{room:room('new'),items:[{id:'a',name:'灯',kind:'lamp',status:'placed',position:[0,0,0],rotation:0,scale:1,height:.3},{id:'b',name:'钟',kind:'clock',status:'ready',position:[0,0,0],rotation:0,scale:1,height:.2}]}),'local-preview',2000);
  h.insert(space('demo',{mode:'demo',name:'示例房间'}),'local-preview',3000);
  h.insert(space('theirs'),'someone-else',4000);
  const list=await get('list=1');
  assert.deepEqual(list.map(p=>p.id),['new','old']);
  assert.deepEqual({...list[0],updated:0},{id:'new',name:'我的空间',stage:'ready',updated:0,original:null,room:true,pieces:2,placed:1});
  assert.equal(list[1].original,'old/uploads/original-x.png');
});
await test('renaming trims to 40 characters and refuses an empty name',async()=>{
  h.insert(space('p'));
  assert.equal((await post({action:'rename',id:'p',name:'  卧室方案 A  '})).data.name,'卧室方案 A');
  assert.equal((await post({action:'rename',id:'p',name:'长'.repeat(60)})).data.name.length,40);
  await rejects({action:'rename',id:'p',name:'   '},/不能为空/);
});
await test('deleting a space keeps files another space still uses; its credit records stay',async()=>{
  // "first" made the room; "copy" reuses it through the photo fingerprint, as the user's own space does.
  h.insert(space('first',{room:room('first'),original:'first/uploads/original-a.png'}));
  h.insert(space('copy',{room:room('first'),original:'copy/uploads/original-b.png'}));
  for(const k of ['first/room/import-a.spz','first/room/import-a-full.spz','first/uploads/original-a.png','first/models/x.glb','copy/uploads/original-b.png'])h.file(k);
  h.sql.prepare("INSERT INTO jobs(id,project,owner,kind,target,status,payload,attempt,updated,reserved,estimated) VALUES('j','first','local-preview','furniture','x','done','{}',1,0,0,30)").run();
  const r=await post({action:'delete-project',id:'first'});
  assert.equal(r.status,200);assert.equal(r.data.files,2);
  assert(h.objects.has('first/room/import-a.spz')&&h.objects.has('first/room/import-a-full.spz'),'the shared room stays');
  assert(!h.objects.has('first/uploads/original-a.png')&&!h.objects.has('first/models/x.glb'),'its own files go');
  assert(h.objects.has('copy/uploads/original-b.png'));
  assert.equal(h.sql.prepare("SELECT count(*) n FROM projects WHERE id='first'").get().n,0);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM jobs").get().n,1,'the record of spent credits stays');
  // The copy still opens its room although the space whose folder holds it is gone.
  assert.equal(await asset('first/room/import-a.spz'),200);
  assert.equal(await asset('first/uploads/original-a.png'),404,'a file no space uses is not served');
  h.insert(space('theirs',{room:room('theirs')}),'someone-else');h.file('theirs/room/import-a.spz');
  assert.equal(await asset('theirs/room/import-a.spz'),404,'nor someone else\'s');
  assert.equal((await post({action:'delete-project',id:'copy'})).status,200);
  assert.deepEqual([...h.objects.keys()],['theirs/room/import-a.spz'],'with nobody using them, the room files go too; others\' stay');
});
await test('a space with generation still running, or someone else\'s, cannot be deleted',async()=>{
  h.insert(space('busy'));h.insert(space('theirs'),'someone-else');
  h.sql.prepare("INSERT INTO jobs(id,project,owner,kind,target,status,payload,attempt,updated,reserved,estimated) VALUES('j','busy','local-preview','furniture','x','running','{}',1,0,30,30)").run();
  await rejects({action:'delete-project',id:'busy'},/生成任务/);
  await rejects({action:'delete-project',id:'theirs'},/不存在或无权/);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM projects').get().n,2);
});
await test('the example room opens again instead of being created twice',async()=>{
  const a=(await post({action:'create',mode:'demo'})).data,b=(await post({action:'create',mode:'demo'})).data;
  assert.equal(a.id,b.id);assert.equal(a.mode,'demo');
  const c=(await post({action:'create',mode:'real'})).data,d=(await post({action:'create',mode:'real'})).data;
  assert.notEqual(c.id,d.id);
});
await test('the same photo reuses the room of an earlier space; another photo does not',async()=>{
  const source=space('source',{room:{...room('source'),erasures:[{id:'e',center:[0,0,0],size:[1,1,1],rotation:0}]},photoPrint:'a3aba3177be6031d',floor:{height:-1.23,size:9.5,confirmed:true}});
  h.insert(source);
  h.insert(space('fresh',{stage:'upload',floor:{height:0,size:6,confirmed:false}}));
  // Re-saved or re-compressed: a few bits differ.
  const r=(await post({action:'set-print',id:'fresh',print:'a3aba3177be6031f'})).data;
  assert.equal(r.room.splat,'source/room/import-a.spz');assert.deepEqual(r.room.erasures,[],'the earlier space\'s erasures stay with it');
  assert.deepEqual(r.floor,{height:-1.23,size:9.5,confirmed:true});assert.equal(r.stage,'ready');
  h.insert(space('other',{stage:'upload'}));
  const o=(await post({action:'set-print',id:'other',print:'5c5445e88f19fce0'})).data;
  assert.equal(o.room,undefined);assert.equal(o.stage,'upload');
  await rejects({action:'set-print',id:'other',print:'not-a-print'},/指纹无效/);
});
const erase={center:[0.5,-0.8,-3],size:[1.4,0.9,0.8],rotation:0.2};
await test('making a scanned piece editable reserves its generation and erases it from the room',async()=>{
  h.insert(space('p',{room:room('p')}));h.file('p/uploads/furniture-photo-1.png');
  await rejects({action:'edit-furniture',id:'p',photo:'q/uploads/furniture-photo-1.png',name:'书桌',kind:'desk',dims:{w:120,d:60,h:75},erase},/上传这件家具的照片/);
  await rejects({action:'edit-furniture',id:'p',photo:'p/uploads/furniture-photo-1.png',name:'书桌',kind:'desk',dims:{w:120,d:2,h:75},erase},/5–400/);
  await rejects({action:'edit-furniture',id:'p',photo:'p/uploads/furniture-photo-1.png',name:'书桌',kind:'desk',dims:{w:120,d:60,h:75},erase:{...erase,size:[0,1,1]}},/擦除范围无效/);
  const r=(await post({action:'edit-furniture',id:'p',photo:'p/uploads/furniture-photo-1.png',name:'书桌',kind:'desk',dims:{w:120,d:60,h:75},erase})).data;
  const item=r.items[0];
  assert.equal(item.status,'queued');assert.equal(item.placeOnReady,true);assert.deepEqual(item.position,[0.5,-1.2,-3]);
  assert.deepEqual(r.room.erasures,[{id:item.id,item:item.id,...erase}]);
  const job=h.sql.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'queued');assert.equal(job.reserved,30);
  assert.equal(h.calls.length,0,'nothing is sent before the job runs');
});
await test('an erase box can be refitted, within sane limits',async()=>{
  h.insert(space('p',{room:{...room('p'),erasures:[{id:'e',item:'x',...erase}]}}));
  const r=(await post({action:'update-erasure',id:'p',erasure:{id:'e',center:[0.4,-0.7,-3.1],size:[1.6,1.3,0.9],rotation:0.25}})).data;
  assert.deepEqual(r.room.erasures[0],{id:'e',item:'x',center:[0.4,-0.7,-3.1],size:[1.6,1.3,0.9],rotation:0.25});
  await rejects({action:'update-erasure',id:'p',erasure:{id:'nope',center:[0,0,0],size:[1,1,1],rotation:0}},/无效/);
  await rejects({action:'update-erasure',id:'p',erasure:{id:'e',center:[0,0,0],size:[20,1,1],rotation:0}},/无效/);
});
await test('the empty-room layer saves its alignment only within range',async()=>{
  h.insert(space('p',{room:{...room('p'),clean:{splat:'p/room/clean.spz',scale:1,shift:[0,0,0],aligned:false}}}));
  const r=(await post({action:'align-clean',id:'p',scale:1.54,yaw:0.0262,shift:[-0.48,0.06,-0.73]})).data;
  assert.deepEqual(r.room.clean,{splat:'p/room/clean.spz',scale:1.54,yaw:0.0262,shift:[-0.48,0.06,-0.73],aligned:true});
  await rejects({action:'align-clean',id:'p',scale:1.5,shift:[0,0,30]},/无效/);
  h.insert(space('q',{room:room('q')}));
  await rejects({action:'align-clean',id:'q',scale:1,shift:[0,0,0]},/还没有空房间底图/);
});
await test('a Marble room is imported from its embed code; the floor is found again',async()=>{
  h.insert(space('p',{stage:'upload'}));
  const spz=Buffer.from([0x1f,0x8b,8,0]);
  h.handler=url=>{assert.match(url,/^https:\/\/cdn\.marble\.worldlabs\.ai\//);return new Response(spz)};
  const embed='<iframe src="https://marble.worldlabs.ai/viewer.html?splatUrl=https%3A%2F%2Fcdn.marble.worldlabs.ai%2Fw%2Ffull_ceramic.spz&amp;mobileUrl=https%3A%2F%2Fcdn.marble.worldlabs.ai%2Fw%2Flight_ceramic_500k.spz"></iframe>';
  const r=(await post({action:'import-world',id:'p',source:embed})).data;
  assert.equal(r.room.source,'imported');assert.match(r.room.splat,/^p\/room\/import-.*\.spz$/);assert.match(r.room.splatFull,/-full\.spz$/);
  assert.deepEqual(r.floor,{height:0,size:6,confirmed:false});assert.equal(r.stage,'ready');
  assert.equal(h.calls.length,2);
  await rejects({action:'import-world',id:'p',source:'随便一段文字'},/没有识别出 Marble 房间/);
});
await test('stored models are slimmed once; library models and slimmed copies are left alone',async()=>{
  h.env.LOCAL_OPTIMIZER='http://127.0.0.1:5173/api/local/optimize-glb';
  const glb=n=>{const b=Buffer.alloc(n);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(n,8);return b};
  h.insert(space('p',{room:room('p'),items:[
    {id:'bed',name:'床',kind:'bed',status:'placed',position:[0,0,0],rotation:0,scale:1,height:.8,dims:{w:150,d:200,h:80},model:'p/models/bed.glb'},
    {id:'lamp',name:'灯',kind:'lamp',status:'placed',position:[0,0,0],rotation:0,scale:1,height:.3,model:'/catalog/models/flowerpot-vp9.glb',source:'catalog'},
  ]}));
  h.file('p/models/bed.glb','model/gltf-binary',glb(64));
  h.handler=(url,init)=>{assert.equal(url,h.env.LOCAL_OPTIMIZER+'?size=200');assert.equal(init.method,'POST');return new Response(glb(16))};
  const r=(await post({action:'optimize-models',id:'p'})).data;
  assert.equal(r.items[0].model,'p/models/bed.lite.glb');assert.equal(r.items[1].model,'/catalog/models/flowerpot-vp9.glb');
  assert(h.objects.has('p/models/bed.glb'),'the original stays');
  await post({action:'optimize-models',id:'p'});assert.equal(h.calls.length,1,'a slimmed copy is not slimmed again');
});
console.log(`${tests} offline project tests passed; paid API calls: 0`);
