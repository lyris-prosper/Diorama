// The library search: sentences in, conditions and answers out. Pure, offline.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(path){
  path=resolve(path);if(cache.has(path))return cache.get(path).exports;
  const mod={exports:{}};cache.set(path,mod);
  if(path.endsWith('.json')){mod.exports=JSON.parse(readFileSync(path,'utf8'));return mod.exports;}
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`,{console},{filename:path})(n=>load(resolve(dirname(path),n.endsWith('.json')?n:n+'.ts')),mod,mod.exports);
  return mod.exports;
}
const {parse,find}=load('lib/catalog-search.ts');
const {catalog,pricing}=load('lib/catalog.ts');
assert.equal(catalog.length,20,'all 20 library pieces have a prepared model');
// Prices and links: the official regional product pages only, never a marketplace or a search page.
const OFFICIAL=['www.ikea.com','www.muji.com','www.muji.us','uk.muji.eu','andtradition.jp','www.marshall.com','www.iittala.com','kinto.co.jp','store.vitra.co.jp'];
for(const i of catalog){
  const u=new URL(i.link);
  assert.equal(u.protocol,'https:',i.id+' link is https');
  assert(OFFICIAL.includes(u.host),i.id+' links to an official site: '+u.host);
  assert(!/taobao|tmall|jd\.com|ikea\.cn|search/i.test(i.link),i.id+' is not a marketplace or search link');
  assert(i.price>0&&Number.isFinite(i.originalPrice)&&i.originalCurrency,i.id+' has a USD price and its listed price');
  assert(['in_stock','in_store_only','out_of_stock','not_verified'].includes(i.availability),i.id+' availability');
  // Converted prices follow the stated ECB fixing, rounded to the cent.
  assert.equal(Math.round(i.originalPrice*pricing.fx.usdPer[i.originalCurrency]*100)/100,i.price,i.id+' price matches its conversion');
}
assert.equal(Math.round(catalog.reduce((a,i)=>a+i.price,0)*100)/100,1350.08,'reference total');
assert.equal(pricing.total,1350.08);
console.log('PASS 20 pieces: official https links, USD prices match the ECB conversion, total $1,350.08');
let n=0;
function check(sentence,expect){
  const raw=parse(sentence),a=JSON.parse(JSON.stringify(find(catalog,raw))),c=JSON.parse(JSON.stringify(raw)),ids=a.items.map(i=>i.id);
  try{
    if(expect.kinds)assert.deepEqual(c.kinds,expect.kinds);
    if(expect.sizes)assert.deepEqual(c.sizes,expect.sizes);
    if(expect.price)assert.deepEqual(c.price,expect.price);
    if(expect.tags)for(const t of expect.tags)assert(c.tags.includes(t),'tag '+t);
    if(expect.first)assert.equal(ids[0],expect.first);
    if(expect.ids)assert.deepEqual([...ids].sort(),[...expect.ids].sort());
    if(expect.has)for(const id of expect.has)assert(ids.includes(id),'has '+id);
    if(expect.not)for(const id of expect.not)assert(!ids.includes(id),'not '+id);
    if(expect.relaxed)assert.deepEqual(a.relaxed,expect.relaxed);
    if(expect.reply)assert.match(a.reply,expect.reply);
  }catch(e){console.error(sentence,JSON.stringify(c),a.reply,ids);throw e}
  n++;console.log(`PASS ${sentence}  →  ${a.reply}`);
}
check('我想要一张不超过 1 米的书桌',{kinds:['desk'],sizes:[{axis:'long',max:100}],ids:['lisabo-desk'],relaxed:['size'],reply:/^没有完全符合的宽度在 100 厘米以内的书桌。放宽尺寸后，找到 1 件：LISABO 宽 118 厘米。$/});
check('1米2以内的桌子',{sizes:[{axis:'long',max:120}],ids:['lisabo-desk'],relaxed:[],reply:/^找到 1 件宽度在 120 厘米以内的书桌/});
check('一米二以内的书桌',{sizes:[{axis:'long',max:120}],ids:['lisabo-desk']});
check('宽度不超过50厘米的床边桌',{kinds:['side-table'],sizes:[{axis:'w',max:50}],ids:['nesna-bedside']});
check('50 美元以内的灯',{kinds:['lamp'],price:{max:50},ids:['flowerpot-vp9'],relaxed:['price'],reply:/^没有完全符合的 \$50 以内的台灯。放宽价格后，找到 1 件：Flowerpot \$251\.15。$/});
check('500 元以内的灯',{kinds:['lamp'],price:{max:74.58,asked:{currency:'CNY',max:500}},ids:['flowerpot-vp9'],relaxed:['price'],reply:/^没有完全符合的 500 元（约 \$75）以内的台灯。放宽价格后，找到 1 件：Flowerpot \$251\.15。$/});
check('两百块以内的灯',{price:{max:29.83,asked:{currency:'CNY',max:200}},ids:['flowerpot-vp9'],relaxed:['price']});
check('30刀以内的木质收纳',{price:{max:30},tags:['wood'],reply:/^找到 4 件 \$30 以内的原木收纳。$/,ids:['oak-wall-shelf','tissue-box','wood-tray','oak-hooks']});
check('预算200美元以内，客厅用的',{price:{max:200},tags:['living'],ids:['rudsta-cabinet','dytag-cushion']});
check('60美元左右的',{price:{min:48,max:72},has:['cuckoo-clock','lisabo-chair'],not:['lisabo-desk','aroma-diffuser']});
check('$10到$30的原木小东西',{price:{min:10,max:30},tags:['wood'],has:['tissue-box','oak-hooks','wood-tray'],not:['lisabo-desk','nesna-bedside']});
check('100 usd 以内的音箱',{kinds:['speaker'],price:{max:100},ids:['emberton-iii'],relaxed:['price'],reply:/Emberton \$200\.93/});
check('宜家的椅子',{kinds:['chair'],ids:['lisabo-chair']});
check('放在书桌上的台灯',{kinds:['lamp'],ids:['flowerpot-vp9'],relaxed:[]});
check('床头放的小东西',{tags:['bedroom'],has:['flowerpot-vp9','aroma-diffuser','ikornnes-mirror'],not:['nesna-bedside','sortso-rug']});
check('床边桌',{kinds:['side-table'],ids:['nesna-bedside']});
check('高度至少1米的柜子',{kinds:['cabinet'],sizes:[{axis:'h',min:100}],ids:['rudsta-cabinet']});
check('80到120厘米的书桌',{sizes:[{axis:'long',min:80,max:120}],ids:['lisabo-desk']});
check('红色的灯',{kinds:['lamp'],tags:['red'],ids:['flowerpot-vp9']});
check('绿色的烛台',{kinds:['candle'],ids:['kivi-votive']});
check('琥珀色的杯子',{kinds:['cup'],ids:['cast-amber-mug']});
check('1米以内的地毯',{kinds:['rug'],ids:['sortso-rug']});
check('LISABO',{ids:['lisabo-desk','lisabo-chair'],reply:/^找到 2 件与“LISABO”相关的家具。$/});
check('Marshall 音箱',{ids:['emberton-iii'],reply:/^找到 1 件 Marshall 的音箱。$/});
check('挂墙上的',{tags:['wall'],ids:['oak-wall-shelf','cuckoo-clock','oak-hooks']});
check('便宜一点的装饰',{has:['loiseau-bird','ikornnes-mirror','cuckoo-clock'],first:'ikornnes-mirror'});
check('我想要一个沙发',{kinds:['sofa'],reply:/^家具库里暂时没有沙发。先看看全部 20 件？$/});
check('500元以内的沙发',{kinds:['sofa'],reply:/^家具库里暂时没有沙发。这里有 14 件 500 元（约 \$75）以内的家具。$/,not:['lisabo-desk','aroma-diffuser']});
check('随便看看',{reply:/共有 20 件/});
check('助眠',{tags:['sleep'],ids:['aroma-diffuser']});
check('宽至少80、不超过120厘米的桌子',{sizes:[{axis:'w',min:80,max:120}],ids:['lisabo-desk']});
console.log(`${n} search sentences passed`);
