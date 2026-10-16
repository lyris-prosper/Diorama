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
assert.equal(catalog.length,30,'all 30 library pieces have a prepared model');
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
assert.equal(Math.round(catalog.reduce((a,i)=>a+i.price,0)*100)/100,2212.9,'reference total');
assert.equal(pricing.total,2212.9);
// The ten large pieces added for the sample bedroom (IKEA Sweden): the two pictures hang on a wall.
const added=catalog.slice(20);
assert.equal(Math.round(added.reduce((a,i)=>a+i.price,0)*100)/100,862.82,'added pieces total');
assert(added.every(i=>i.market==='SE'&&i.originalCurrency==='SEK'),'added pieces are priced on IKEA Sweden');
assert.deepEqual(catalog.filter(i=>i.wall).map(i=>i.id),['oak-wall-shelf','oak-hooks','giverny-picture','orange-flower-picture']);
console.log('PASS 30 pieces: official https links, USD prices match the ECB conversion, total $2,212.90 (10 added: $862.82)');
let n=0;
function check(sentence,expect,lang='zh'){
  const raw=parse(sentence),a=JSON.parse(JSON.stringify(find(catalog,raw,lang))),c=JSON.parse(JSON.stringify(raw)),ids=a.items.map(i=>i.id);
  try{
    if(expect.kinds)assert.deepEqual(c.kinds,expect.kinds);
    if(expect.sizes)assert.deepEqual(c.sizes,expect.sizes);
    if(expect.price!==undefined)assert.deepEqual(c.price,expect.price??undefined);
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
check('50 美元以内的灯',{kinds:['lamp'],price:{max:50},ids:['flowerpot-vp9','blidvader-lamp'],relaxed:['price'],reply:/^没有完全符合的 \$50 以内的台灯。放宽价格后，找到 2 件：Flowerpot \$251\.15，BLIDVÄDER \$69\.50。$/});
check('500 元以内的灯',{kinds:['lamp'],price:{max:74.58,asked:{currency:'CNY',max:500}},ids:['blidvader-lamp'],relaxed:[],reply:/^找到 1 件 500 元（约 \$75）以内的台灯。$/});
check('两百块以内的灯',{price:{max:29.83,asked:{currency:'CNY',max:200}},ids:['flowerpot-vp9','blidvader-lamp'],relaxed:['price']});
check('30刀以内的木质收纳',{price:{max:30},tags:['wood'],reply:/^找到 4 件 \$30 以内的原木收纳。$/,ids:['oak-wall-shelf','tissue-box','wood-tray','oak-hooks']});
check('预算200美元以内，客厅用的',{price:{max:200},tags:['living'],ids:['rudsta-cabinet','dytag-cushion','telegraflinje-rug','fejka-plant','lauters-floor-lamp','poang-armchair','tolkning-bench','giverny-picture','billy-bookcase']});
check('60美元左右的',{price:{min:48,max:72},has:['cuckoo-clock','lisabo-chair'],not:['lisabo-desk','aroma-diffuser']});
check('$10到$30的原木小东西',{price:{min:10,max:30},tags:['wood'],has:['tissue-box','oak-hooks','wood-tray'],not:['lisabo-desk','nesna-bedside']});
check('100 usd 以内的音箱',{kinds:['speaker'],price:{max:100},ids:['emberton-iii'],relaxed:['price'],reply:/Emberton \$200\.93/});
check('宜家的椅子',{kinds:['chair'],ids:['lisabo-chair','poang-armchair']});
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
check('挂墙上的',{tags:['wall'],ids:['oak-wall-shelf','cuckoo-clock','oak-hooks','giverny-picture','orange-flower-picture']});
check('便宜一点的装饰',{has:['loiseau-bird','ikornnes-mirror','cuckoo-clock','fejka-plant'],first:'orange-flower-picture'});
check('我想要一个沙发',{kinds:['sofa'],reply:/^家具库里暂时没有沙发。先看看全部 30 件？$/});
check('500元以内的沙发',{kinds:['sofa'],reply:/^家具库里暂时没有沙发。这里有 18 件 500 元（约 \$75）以内的家具。$/,not:['lisabo-desk','aroma-diffuser']});
check('随便看看',{reply:/共有 30 件/});
check('助眠',{tags:['sleep'],ids:['aroma-diffuser']});
check('宽至少80、不超过120厘米的桌子',{sizes:[{axis:'w',min:80,max:120}],ids:['lisabo-desk']});
// The large pieces for the sample bedroom, by their own names.
check('一块大地毯',{kinds:['rug'],price:null,ids:['sortso-rug','telegraflinje-rug'],relaxed:[],reply:/^找到 2 件地毯。$/});
check('两块地毯',{kinds:['rug'],price:null,ids:['sortso-rug','telegraflinje-rug']});
check('五块以内的小东西',{price:{max:0.75,asked:{currency:'CNY',max:5}}});
check('2米以上的地毯',{kinds:['rug'],sizes:[{axis:'long',min:200}],ids:['telegraflinje-rug'],reply:/^找到 1 件宽度至少 200 厘米的地毯。$/});
check('落地灯',{kinds:['floor-lamp'],ids:['lauters-floor-lamp'],reply:/^找到 1 件落地灯。$/});
check('床边放的落地灯',{kinds:['floor-lamp'],tags:['bedroom'],ids:['lauters-floor-lamp']});
check('灯',{kinds:['lamp'],ids:['flowerpot-vp9','blidvader-lamp']});
check('想要点绿植',{kinds:['plant'],ids:['fejka-plant'],reply:/^找到 1 件绿植。$/});
check('植物',{kinds:['plant'],ids:['fejka-plant']});
check('挂画',{kinds:['picture'],ids:['giverny-picture','orange-flower-picture'],reply:/^找到 2 件挂画。$/});
check('床尾凳',{kinds:['bench'],ids:['tolkning-bench'],reply:/^找到 1 件长凳。$/});
check('100美元以内的扶手椅',{kinds:['chair'],price:{max:100},ids:['poang-armchair']});
check('书架',{kinds:['bookcase'],ids:['billy-bookcase']});
check('落地镜',{kinds:['mirror'],ids:['ikornnes-standing-mirror']});
check('镜子',{kinds:['mirror'],ids:['ikornnes-mirror','ikornnes-standing-mirror']});
check('藤编的',{tags:['rattan'],ids:['rattan-box','tolkning-bench']});
// English questions, answered in English.
const en=(sentence,expect)=>check(sentence,expect,'en');
en('a desk under 1 m wide',{kinds:['desk'],sizes:[{axis:'w',max:100}],ids:['lisabo-desk'],relaxed:['size'],reply:/^No exact match for desks up to 100 cm wide\. With the size relaxed, 1 fits: LISABO 118 cm wide\.$/});
en('a lamp under $50',{kinds:['lamp'],price:{max:50},ids:['flowerpot-vp9','blidvader-lamp'],relaxed:['price'],reply:/^No exact match for lamps under \$50\. With the price relaxed, 2 fit: Flowerpot VP9 portable lamp \$251\.15; BLIDVÄDER \$69\.50\.$/});
en('something small for my desk under 20 dollars',{price:{max:20},ids:['cast-amber-mug','tissue-box','wood-tray'],reply:/^Found \d+ small things under \$20, for a desk or bedside\.$/});
en('lamp under 500 yuan',{price:{max:74.58,asked:{currency:'CNY',max:500}},ids:['blidvader-lamp'],reply:/under ¥500 \(about \$75\)/});
en('wooden storage under $30',{price:{max:30},tags:['wood'],ids:['oak-wall-shelf','tissue-box','wood-tray','oak-hooks'],reply:/^Found 4 wooden storage pieces under \$30\.$/});
en('a bedside table at most 50 cm wide',{kinds:['side-table'],sizes:[{axis:'w',max:50}],ids:['nesna-bedside'],reply:/^Found 1 bedside table up to 50 cm wide\.$/});
en('a chair around 80 cm tall',{kinds:['chair'],sizes:[{axis:'h',min:68,max:92,around:true}],ids:['lisabo-chair']});
en('a desk at least 80 cm and no more than 120 cm wide',{sizes:[{axis:'w',min:80,max:120}],ids:['lisabo-desk']});
en('anything from MUJI under $20',{price:{max:20},has:['tissue-box','wood-tray'],not:['ikornnes-mirror'],reply:/from MUJI under \$20/});
en('a Marshall speaker',{kinds:['speaker'],ids:['emberton-iii']});
en('cheap decor',{first:'orange-flower-picture',reply:/^Found 7 affordable decor pieces\.$/});
en('a sofa',{kinds:['sofa'],reply:/^The library has no sofas yet\. Show all 30\?$/});
en('wall shelf',{kinds:['shelf'],ids:['oak-wall-shelf']});
en('something for better sleep',{tags:['sleep'],ids:['aroma-diffuser']});
en('show me everything',{reply:/^The library has 30 pieces\./});
en('LISABO',{ids:['lisabo-desk','lisabo-chair'],reply:/matching “LISABO”/});
en('a green candle holder between $10 to $30',{kinds:['candle'],price:{min:10,max:30},ids:['kivi-votive']});
en('a floor lamp',{kinds:['floor-lamp'],ids:['lauters-floor-lamp'],reply:/^Found 1 floor lamp\.$/});
en('a plant',{kinds:['plant'],ids:['fejka-plant']});
en('wall art',{kinds:['picture'],ids:['giverny-picture','orange-flower-picture'],reply:/^Found 2 pictures\.$/});
en('an armchair under $100',{kinds:['chair'],price:{max:100},has:['poang-armchair']});
en('a bench',{kinds:['bench'],ids:['tolkning-bench']});
en('a bookcase',{kinds:['bookcase'],ids:['billy-bookcase']});
en('a standing mirror',{kinds:['mirror'],ids:['ikornnes-standing-mirror']});
console.log(`${n} search sentences passed`);
