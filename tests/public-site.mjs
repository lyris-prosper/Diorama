// The public website (DIORAMA_PUBLIC=1, lib/server/site.ts): anonymous visitors kept apart by
// their cookie, the daily allowance per visitor and network address, the site's credit caps,
// private balances, the web Tripo settings, and room/model downloads streamed into storage.
// The real route handler on real SQLite; storage and network are mocked, nothing is fetched.
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const h=harness();
const route=h.load('app/api/workbench/route.ts');
const assets=h.load('app/api/assets/route.ts');
const jobs=h.load('lib/server/jobs.ts');
const site=h.load('lib/server/site.ts');
const http=h.load('lib/server/provider-http.ts');
const storage=h.load('lib/server/storage.ts');
const URL_='https://diorama.example.workers.dev/api/workbench';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const headers=(visitor,ip='203.0.113.1',more={})=>({...(visitor?{cookie:`${site.VISITOR_COOKIE}=${visitor}`}:{}),'cf-connecting-ip':ip,...more});
const post=async(body,visitor,ip)=>{const r=await route.POST(new Request(URL_,{method:'POST',headers:headers(visitor,ip,{'Content-Type':'application/json'}),body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const get=async(query,visitor,ip)=>{const r=await route.GET(new Request(URL_+'?'+query,{headers:headers(visitor,ip)}));return {status:r.status,data:await r.json()}};
const asset=async(key,visitor)=>(await assets.GET(new Request('https://diorama.example.workers.dev/api/assets?key='+encodeURIComponent(key),{headers:headers(visitor)}))).status;
const space=(id)=>({id,name:'我的空间',mode:'real',stage:'ready',branch:'direct',intent:'',candidates:[],items:[],tasks:[],floor:{height:-1.2,size:8,confirmed:true},updatedAt:0,revision:0});
const who=async(visitor,ip='203.0.113.1')=>({user:'visitor-'+visitor,client:await site.clientOf(new Request(URL_,{headers:headers(visitor,ip)}))});
const glb=(n=64)=>{const b=Buffer.alloc(n);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(n,8);return b};
let tests=0;
async function test(name,fn){h.reset();h.env.DIORAMA_PUBLIC='1';await fn();tests++;console.log('PASS '+name)}

await test('visitors only see their own spaces and files; a request without the cookie is asked to refresh',async()=>{
  const mine=(await post({action:'create',mode:'real'},A)).data;
  assert.match(mine.id,/^[0-9a-f-]{36}$/);
  assert.equal(h.sql.prepare('SELECT owner FROM projects WHERE id=?').get(mine.id).owner,'visitor-'+A);
  h.file(mine.id+'/uploads/original-x.png');
  assert.equal((await get('list=1',A)).data.length,1);
  assert.equal((await get('list=1',B)).data.length,0);
  assert.match((await get('id='+mine.id,B)).data.error,/不存在或无权访问/);
  assert.equal(await asset(mine.id+'/uploads/original-x.png',A),200);
  assert.equal(await asset(mine.id+'/uploads/original-x.png',B),404);
  const bare=await post({action:'create',mode:'real'},null);
  assert.equal(bare.status,400);assert.match(bare.data.error,/刷新页面/);
  // The id in the cookie is checked: anything else is no visitor at all.
  assert.equal(site.visitorOf(new Request(URL_,{headers:{cookie:`${site.VISITOR_COOKIE}=local-preview`}})),null);
  assert.match(site.visitorCookie(A),/HttpOnly; Secure; SameSite=Lax/);
});
await test('one free room a day per visitor, counted by cookie or network address; the Mac version has no daily limit',async()=>{
  for(const id of ['p1','p2','p3','p4'])h.insert(space(id),'x');
  await jobs.enqueue(space('p1'),await who(A),'world','room',{image:'i'});
  await assert.rejects(jobs.enqueue(space('p2'),await who(A),'world','room',{image:'i'}),/今天的免费额度用完了/);
  // A new cookie from the same network is the same visitor for the allowance.
  await assert.rejects(jobs.enqueue(space('p3'),await who(B),'world','room',{image:'i'}),/今天的免费额度用完了/);
  await jobs.enqueue(space('p3'),await who(C,'198.51.100.7'),'world','room',{image:'i'});
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM submissions WHERE kind='world'").get().n,2);
  // Four pieces, then no more today.
  for(const t of ['a','b','c','d'])await jobs.enqueue(space('p1'),await who(A),'furniture',t,{image:'i'});
  await assert.rejects(jobs.enqueue(space('p1'),await who(A),'furniture','e',{image:'i'}),/今天的免费额度用完了/);
  // The same job enqueued twice is one submission.
  await jobs.enqueue(space('p1'),await who(A),'furniture','a',{image:'i'});
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM submissions WHERE kind='furniture'").get().n,4);
  delete h.env.DIORAMA_PUBLIC;
  await jobs.enqueue(space('p4'),{user:'local-preview',client:'local'},'world','room',{image:'i'});
  await jobs.enqueue(space('p2'),{user:'local-preview',client:'local'},'world','room',{image:'i'});
  assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM submissions WHERE kind='world'").get().n,2,'nothing counted locally');
});
await test('a paid retry counts against the day as well',async()=>{
  h.env.DAILY_ROOMS='2';
  h.insert(space('p1'),'x');
  await jobs.enqueue(space('p1'),await who(A),'world','room',{image:'i'});
  h.sql.prepare("UPDATE jobs SET status='failed',provider='t1',reserved=0,result=?").run(JSON.stringify({terminal:true}));
  await jobs.retryJob('p1-world-room','p1',await who(A),true);
  assert.equal(h.sql.prepare('SELECT attempt FROM jobs').get().attempt,2);
  h.sql.prepare("UPDATE jobs SET status='failed',provider='t1',reserved=0,result=?").run(JSON.stringify({terminal:true}));
  await assert.rejects(jobs.retryJob('p1-world-room','p1',await who(A),true),/今天的免费额度用完了/);
});
await test('when the site\'s cap is reached, generation stops for everyone and says so',async()=>{
  h.env.WORLDLABS_CREDIT_LIMIT='230';
  for(const id of ['p1','p2'])h.insert(space(id),'x');
  await jobs.enqueue(space('p1'),await who(A),'world','room',{image:'i'});
  await assert.rejects(jobs.enqueue(space('p2'),await who(C,'198.51.100.7'),'world','room',{image:'i'}),/免费生成额度已经全部用完/);
  const caps=(await get('capabilities=1',C,'198.51.100.7')).data;
  assert.equal(caps.public,true);assert.equal(caps.open.world,false);assert.equal(caps.open.furniture,true);
  assert.deepEqual({...caps.left},{rooms:1,pieces:4,uploads:60});
});
await test('online, the service check says what works without showing the account balances',async()=>{
  h.handler=url=>String(url).includes('/credits')?h.json({remaining_credits:9876}):h.json({code:0,data:{balance:5432}});
  const s=(await get('services=1',A)).data;
  assert.equal(s.world.available,true);assert.equal(s.tripo.available,true);assert.equal(s.public,true);
  assert(!JSON.stringify(s).includes('9876')&&!JSON.stringify(s).includes('5432'));
  const b=(await get('budgets=1',A)).data;
  assert.deepEqual({...b},{world:true,furniture:true});
  delete h.env.DIORAMA_PUBLIC;
  assert.equal((await get('services=1',A)).data.world.remaining_credits,9876,'the Mac version still shows them');
});
await test('online, pieces are made at the web settings and high-detail regeneration is off',async()=>{
  const s=http.tripoSettings();
  assert.equal(s.face_limit,150000);assert.equal(s.compress,'geometry');assert.equal(s.texture_quality,'detailed');assert.equal(s.pbr,true);
  h.insert(space('p1'),'visitor-'+A);
  await jobs.enqueue(space('p1'),await who(A),'furniture','chair',{image:'i'});
  assert.equal(JSON.parse(h.sql.prepare('SELECT payload FROM jobs').get().payload).quality,'web');
  const r=await post({action:'regenerate',id:'p1',item:'chair',confirmPaid:true},A);
  assert.equal(r.status,400);assert.match(r.data.error,/不提供高精度重新生成/);
  delete h.env.DIORAMA_PUBLIC;
  assert.equal(http.tripoSettings().texture_quality,'extreme','the Mac version keeps 8K');
});
await test('uploads and spaces per visitor are limited',async()=>{
  h.env.DAILY_UPLOADS='1';
  const p=(await post({action:'create',mode:'real'},A)).data;
  const upload=async()=>{const f=new FormData();f.append('id',p.id);f.append('role','original');f.append('file',new File([Buffer.from([137,80,78,71])],'room.png',{type:'image/png'}));const r=await route.POST(new Request(URL_,{method:'POST',headers:headers(A),body:f}));return {status:r.status,data:await r.json()}};
  assert.equal((await upload()).status,200);
  const second=await upload();assert.equal(second.status,400);assert.match(second.data.error,/上传的照片太多/);
  for(let i=1;i<site.MAX_SPACES;i++)h.insert(space('s'+i),'visitor-'+A);
  const r=await post({action:'create',mode:'real'},A);
  assert.equal(r.status,400);assert.match(r.data.error,/最多 10 个空间/);
});
await test('room and model downloads stream into storage; a damaged file is removed again',async()=>{
  h.handler=url=>{const b=String(url).includes('good')?glb():Buffer.from('not a model at all, sorry');return new Response(b,{headers:{'content-length':String(b.length)}})};
  assert.equal(await storage.cacheRemote('https://assets.example/good.glb','p/models/good.glb','glb'),'p/models/good.glb');
  assert.equal(h.streamed,1,'written as a stream');assert.equal(h.objects.get('p/models/good.glb').bytes.length,64);
  await assert.rejects(storage.cacheRemote('https://assets.example/bad.glb','p/models/bad.glb','glb'),/不是完整有效的 GLB/);
  assert(!h.objects.has('p/models/bad.glb'),'removed');
});
console.log(`${tests} public website tests passed; network calls: ${h.calls.filter(c=>!/credits|balance|assets\.example/.test(String(c.url))).length}`);
