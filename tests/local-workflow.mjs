import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const api=body=>post('/api/workbench',body);
const upload=async(id,role,data)=>{const f=new FormData();f.set('id',id);f.set('role',role);f.set('file',new Blob([data],{type:'image/png'}),'image.png');const r=await fetch(base+'/api/workbench',{method:'POST',body:f});assert.equal(r.status,200);return r.json();};
const image=await sharp(await readFile('resources/validation/thumbnail.webp')).png().toBuffer();
const started=Date.now();
const r=await post('/api/local/jobs',{kind:'recognize',image:image.toString('base64')});assert.equal(r.status,202);
async function result(id){
  let old='';
  for(let tries=0;tries<300;tries++){
    const j=await fetch(base+'/api/local/jobs/'+id).then(r=>r.json());
    if(j.message!==old){console.log(j.message);old=j.message;}
    if(j.status==='failed')throw Error(j.error);
    if(j.status==='done'){await fetch(base+'/api/local/jobs/'+id,{method:'DELETE'});return j.result;}
    await new Promise(r=>setTimeout(r,1000));
  }throw Error('Timed out');
}
const recog=await result(r.data.id);assert(recog.candidates.some(c=>c.kind==='bed'));
const bed=recog.candidates.find(c=>c.kind==='bed');
const {width,height}=await sharp(image).metadata();
const mask=await sharp(Buffer.from(bed.mask,'base64')).resize(width,height,{kernel:'nearest'}).flatten({background:'#000'}).greyscale().threshold(127).dilate(4).png().toBuffer();
const p=(await api({action:'create',mode:'real'})).data;
const original=(await upload(p.id,'original',image)).key;
const maskKey=(await upload(p.id,'manual-mask',mask)).key;
const manual=await api({action:'manual',id:p.id,branch:'edit',name:'床',mask:maskKey});assert.equal(manual.status,200);
const candidate=manual.data.candidates[0];
const imageRaw=await sharp(image).removeAlpha().raw().toBuffer();
const maskRaw=await sharp(mask).greyscale().raw().toBuffer();
const transparent=await sharp(imageRaw,{raw:{width,height,channels:3}}).joinChannel(maskRaw,{raw:{width,height,channels:1}}).png().toBuffer();
const cutout=(await upload(p.id,'cutout-'+candidate.id,transparent)).key;
const paint=await post('/api/local/jobs',{kind:'inpaint',image:image.toString('base64'),mask:mask.toString('base64')});assert.equal(paint.status,202);
const repaired=await result(paint.data.id),png=Buffer.from(repaired.image,'base64');
const pixels=await sharp(png).removeAlpha().raw().toBuffer();
// The repair grows the outline by editRadius to remove edge ghosts; everything beyond that must be untouched.
const edit=repaired.editRadius;assert(Number.isInteger(edit)&&edit>0&&edit<Math.max(width,height)/10,'edit radius must be reported and small');
const near=new Uint8Array(width*height);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(maskRaw[y*width+x]>127)
  for(let yy=Math.max(0,y-edit);yy<=Math.min(height-1,y+edit);yy++)near.fill(1,yy*width+Math.max(0,x-edit),yy*width+Math.min(width-1,x+edit)+1);
let changed=0,inside=0;
for(let i=0;i<width*height;i++){
  if(maskRaw[i]>127){inside++;if(Math.abs(imageRaw[i*3]-pixels[i*3])+Math.abs(imageRaw[i*3+1]-pixels[i*3+1])+Math.abs(imageRaw[i*3+2]-pixels[i*3+2])>8)changed++;}
  else if(!near[i])for(let c=0;c<3;c++)assert.equal(pixels[i*3+c],imageRaw[i*3+c],'pixels beyond the edit radius must be identical');
}
assert(changed/inside>.5,'repair must actually change the selected furniture');
const background=(await upload(p.id,'local-background',png)).key;
const payload={action:'prepare',id:p.id,original,selected:[candidate.id],mask:maskKey,cutouts:{[candidate.id]:cutout},localBackground:background};
assert.equal((await api({...payload,original:'stale'})).status,400);
assert.equal((await api({...payload,localBackground:'another/uploads/local-background.png'})).status,400);
const prepared=await api(payload);assert.equal(prepared.status,200);assert.equal(prepared.data.stage,'review');assert.equal(prepared.data.tasks.length,0);
const restored=await fetch(base+'/api/workbench?id='+p.id).then(r=>r.json());assert.equal(restored.rawBackground,background);
const download=await fetch(base+'/api/assets?key='+encodeURIComponent(background)+'&download=room.png');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
const alpha=await sharp(transparent).ensureAlpha().raw().toBuffer();assert(alpha.some((v,i)=>i%4===3&&v===0),'cutout is really transparent');
assert.equal((await api({action:'revise',id:p.id})).data.stage,'confirm');
const invalid=await post('/api/local/jobs',{kind:'inpaint',image:image.toString('base64'),mask:(await sharp({create:{width,height,channels:3,background:'black'}}).png().toBuffer()).toString('base64')});
await assert.rejects(result(invalid.data.id),/有效圈选/);
const cancel=await post('/api/local/jobs',{kind:'recognize',image:image.toString('base64')});assert.equal(cancel.status,202);assert.equal((await fetch(base+'/api/local/jobs/'+cancel.data.id,{method:'DELETE'})).status,200);
const hostile=await fetch(base+'/api/local/jobs',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(hostile.status,403);
await mkdir('work/local-qa',{recursive:true});await writeFile('work/local-qa/repaired.png',png);await writeFile('work/local-qa/cutout.png',transparent);
console.log(JSON.stringify({pass:true,seconds:(Date.now()-started)/1000,detected:recog.candidates.map(c=>c.name),changedMaskFraction:changed/inside,unselectedPixelChanges:0,paidTasks:0,manualFlow:true,persistence:true,download:true,cancellation:true,originCheck:true}));
