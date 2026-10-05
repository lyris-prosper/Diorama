import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pipeline, env, RawImage, SamModel, AutoProcessor, Tensor } from '@huggingface/transformers';
import { segmentFurniture } from '../public/vision/inference.mjs';

import { createHash } from 'node:crypto';
env.allowRemoteModels=false; env.useFSCache=false;
env.localModelPath='./public/vision/models/';
env.useCustomCache=true;
const dir='./public/vision/models/detr/';
const manifest=JSON.parse(await readFile(dir+'weights.json'));
let model;
env.customCache={async match(key){
 if(!String(key).includes('/detr/onnx/model_quantized.onnx'))return;
 model ||= Buffer.concat(await Promise.all(manifest.parts.map(async p=>{
  const data=await readFile(dir+p.file);
  assert.equal(createHash('sha256').update(data).digest('hex'),p.sha256);
  return data;
 })));
 assert.equal(createHash('sha256').update(model).digest('hex'),manifest.sha256);
 return new Response(model,{headers:{'Content-Length':String(model.length)}});
},async put(){}};
await mkdir('work/recognition',{recursive:true});
const start=performance.now();
const segmenter=await pipeline('image-segmentation','detr',{dtype:'q8',local_files_only:true,device:'cpu'});

const sam=await SamModel.from_pretrained('slimsam',{dtype:{vision_encoder:'fp32',prompt_encoder_mask_decoder:'fp32'},device:'cpu',local_files_only:true});
const processor=await AutoProcessor.from_pretrained('slimsam',{local_files_only:true});
const reports=[];
for(const image of ['resources/validation/thumbnail.webp','resources/validation/living-room.webp']){
 const began=performance.now();
 let raw=await RawImage.read(image);
 if(Math.max(raw.width,raw.height)>1024) {const k=1024/Math.max(raw.width,raw.height);raw=await raw.resize(Math.round(raw.width*k),Math.round(raw.height*k));}
 const items=await segmentFurniture(segmenter,raw,RawImage,sam,processor,Tensor);
 const summary=items.map(({mask,...item})=>item);
 if(image.includes('thumbnail')) {
  assert(items.some(i=>i.kind==='bed'),'bed must be detected');
  assert(items.some(i=>i.kind==='cabinet'),'cabinet must be detected');
 } else {
  assert(items.some(i=>i.kind==='sofa'),'sofa must be detected');
  assert(items.some(i=>i.kind==='desk'),'table must be detected');
  assert(items.some(i=>i.kind==='chair'),'chair must be detected');
 }
 assert(items.every(i=>(i.box[2]-i.box[0])*(i.box[3]-i.box[1])<0.9),'no full-frame furniture masks');

 assert(items.every(i=>!/(wall|window|floor|door)/.test(i.label)),'fixed structures excluded');
 for(let i=0;i<items.length;i++) {
  const {mask}=items[i];
  assert(mask.data.some(v=>v===0)&&mask.data.some(v=>v===255),'mask must contain real foreground and background pixels');
  await mask.save(`work/recognition/${reports.length}-${i}.png`);
 }
 reports.push({image,elapsedMs:Math.round(performance.now()-began),objects:summary});
}
await writeFile('work/recognition/results.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify({elapsedMs:Math.round(performance.now()-start),reports},null,2));
await segmenter.dispose();await sam.dispose();
