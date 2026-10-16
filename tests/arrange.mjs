// “帮我布置” (lib/arrange.ts, lib/server/arrange.ts): a sentence becomes library pieces with places.
// The real route handler on real SQLite; DeepSeek is mocked, so its answers can be good, bad or
// missing, and every one of them still ends in an arrangement. No request leaves the process.
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const h=harness();
const route=h.load('app/api/workbench/route.ts');
const {DEMO_ROOM}=h.load('lib/demo-room.ts');
const {catalog}=h.load('lib/catalog.ts');
const {zoneOf}=h.load('lib/arrange.ts');
const URL_='http://127.0.0.1:5173/api/workbench';
const post=async(body,headers={})=>{const r=await route.POST(new Request(URL_,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
const space=(id,over={})=>({id,name:'卧室',mode:'real',stage:'ready',branch:'edit',intent:'',candidates:[],items:[],tasks:[],floor:{height:-1.23,size:9.5,confirmed:true},updatedAt:0,revision:0,...over});
const bedroom=(id)=>space(id,{room:{...DEMO_ROOM.room,source:'imported',preset:DEMO_ROOM.id,erasures:[]}});
const plain=(id)=>space(id,{room:{splat:id+'/room/a.spz',scale:0.7,offset:0,source:'imported',erasures:[]}});
const byId=(id)=>catalog.find((c)=>c.id===id);
const spotOf=(id)=>DEMO_ROOM.spots.find((s)=>s.id===id);
/** Every piece is in the library, every place is the sample room's, of the piece's zone, used once. */
function sound(plan){
  assert(plan.items.length>=2,'some pieces');
  const used=new Set();
  for(const it of plan.items){
    const c=byId(it.catalogId);assert(c,'from the library: '+it.catalogId);
    assert.equal(it.zone,zoneOf(c));
    const s=spotOf(it.spot);assert(s,'a sample-room place: '+it.spot);
    assert.equal(s.zone,it.zone,`${c.id} (${it.zone}) at ${s.id} (${s.zone})`);
    assert(!used.has(s.id),'each place once');used.add(s.id);
  }
  const sum=plan.items.reduce((n,it)=>n+byId(it.catalogId).price,0);
  assert(Math.abs(plan.total-sum)<0.01,'the total adds up');
}
// DeepSeek's chat completions endpoint, answering `content` (or failing).
const deepseek=(content,status=200)=>(url)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  return h.json(status===200?{choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}:{error:{message:'busy'}},status);
};
let tests=0;
async function test(name,fn){h.reset();await fn();tests++;console.log('PASS '+name)}

await test('without a key, the rules furnish the sample bedroom within the budget, each piece in its own place',async()=>{
  h.insert(bedroom('b'));
  const r=await post({action:'plan-layout',id:'b',text:'温馨一点的卧室，预算 600 美元'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.source,'rules');
  sound(r.data);
  assert(r.data.total<=600);
  assert.match(r.data.reason,/温馨卧室/);
  assert.equal(h.calls.length,0,'nothing asked over the network');
});
await test('DeepSeek\'s answer is used once checked: unknown pieces, over-budget pieces and wrong places are dropped or moved',async()=>{
  h.insert(bedroom('b'));h.env.DEEPSEEK_API_KEY='test-deepseek-secret';
  const lamp=catalog.find((c)=>c.kind==='lamp'&&zoneOf(c)==='top');
  const rug=catalog.find((c)=>c.kind==='rug');
  const side=catalog.find((c)=>c.kind==='side-table');
  h.handler=deepseek({reason:'暖一点的光，脚下软一点。',items:[
    {id:rug.id,place:'rug'},
    {id:lamp.id,place:'rug'},          // a top piece sent to a floor place: it goes to a top place
    {id:'no-such-piece',place:'bedside'},
    {id:side.id,place:'bedside'},
  ]});
  const r=await post({action:'plan-layout',id:'b',text:'预算 300 美元，温馨一点'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.source,'ai');
  assert.equal(r.data.reason,'暖一点的光，脚下软一点。');
  sound(r.data);
  assert.deepEqual(r.data.items.map((i)=>i.catalogId),[rug.id,lamp.id,side.id].filter((id,k,all)=>all.slice(0,k+1).reduce((n,x)=>n+byId(x).price,0)<=300));
  assert.equal(r.data.items.find((i)=>i.catalogId===rug.id).spot,'rug');
  assert.equal(spotOf(r.data.items.find((i)=>i.catalogId===lamp.id)?.spot??'desk-left').zone,'top');
  // The request: the model, JSON output, the key in the header only.
  const body=JSON.parse(h.calls[0].init.body);
  assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(body.thinking,{type:'disabled'});
  assert.match(body.messages[0].content,/json/);assert.match(body.messages[0].content,new RegExp(rug.id));
  assert.equal(new Headers(h.calls[0].init.headers).get('authorization'),'Bearer test-deepseek-secret');
  assert(!JSON.stringify(r.data).includes('test-deepseek-secret'));
});
await test('a model answer that is not JSON, too thin, or an error falls back to the rules',async()=>{
  h.insert(bedroom('b'));h.env.DEEPSEEK_API_KEY='test-deepseek-secret';
  for(const handler of [deepseek('Sure! Here is a cozy room…'),deepseek({items:[{id:catalog[0].id,place:'rug'}],reason:'一件'}),deepseek({},500),()=>{throw new TypeError('fetch failed')}]){
    h.handler=handler;
    const r=await post({action:'plan-layout',id:'b',text:'a reading corner by the window'},{'x-lang':'en'});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.source,'rules');sound(r.data);
    assert.match(r.data.reason,/reading corner/);
  }
});
await test('places where a piece already stands are not given again',async()=>{
  const rug=spotOf('rug'),desk=spotOf('desk-left');
  h.insert(bedroom('b'),'local-preview');
  const b=bedroom('b2');b.items=[{id:'x',name:'毯',kind:'rug',status:'placed',position:rug.position,rotation:0,scale:1,height:.01},{id:'y',name:'灯',kind:'lamp',status:'placed',position:desk.position,rotation:0,scale:1,height:.3}];
  h.insert(b);
  const r=await post({action:'plan-layout',id:'b2',text:'温馨一点'});
  assert(!r.data.items.some((i)=>i.spot==='rug'||i.spot==='desk-left'),JSON.stringify(r.data.items));
});
await test('in another room the plan gives zones, and the page finds the places',async()=>{
  h.insert(plain('p'));
  const r=await post({action:'plan-layout',id:'p',text:'给书桌布置一个学习角'});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert(r.data.items.length>=2);
  for(const it of r.data.items){assert.equal(it.spot,undefined);assert.equal(it.zone,zoneOf(byId(it.catalogId)));}
});
await test('several library pieces go in with one request, each where the page put it',async()=>{
  h.insert(bedroom('b'));
  const a=spotOf('rug'),c=spotOf('desk-left');
  const items=[{catalogId:catalog.find((x)=>x.kind==='rug').id,position:a.position,rotation:a.rotation},{catalogId:catalog.find((x)=>x.kind==='lamp').id,position:c.position,rotation:c.rotation}];
  const r=await post({action:'add-catalog-item',id:'b',items});
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.added.length,2);
  // (JSON both sides: the sample room's arrays come from the module sandbox.)
  assert.deepEqual(r.data.items.map((i)=>[i.status,i.position,i.rotation]),JSON.parse(JSON.stringify(items.map((i)=>['placed',i.position,i.rotation]))));
  assert.equal(r.data.revision,1,'saved once');
  const bad=await post({action:'add-catalog-item',id:'b',items:[{catalogId:items[0].catalogId,position:[0,'x',0]}]});
  assert.equal(bad.status,400);
});
await test('online, each visitor has a daily number of arrangements; an empty sentence is refused',async()=>{
  h.env.DIORAMA_PUBLIC='1';h.env.DAILY_PLANS='2';
  const site=h.load('lib/server/site.ts');
  const visitor='11111111-2222-4333-8444-555555555555';
  h.insert(bedroom('b'),'visitor-'+visitor);
  const headers={cookie:`${site.VISITOR_COOKIE}=${visitor}`,'cf-connecting-ip':'203.0.113.9'};
  assert.equal((await post({action:'plan-layout',id:'b',text:'  '},headers)).status,400);
  for(let k=0;k<2;k++)assert.equal((await post({action:'plan-layout',id:'b',text:'温馨一点'},headers)).status,200);
  const r=await post({action:'plan-layout',id:'b',text:'温馨一点'},headers);
  assert.equal(r.status,400);assert.match(r.data.error,/帮我布置/);
});
console.log(`PASS ${tests} arrange checks`);
