import { pipeline, env, RawImage, SamModel, AutoProcessor, Tensor } from './transformers.web.min.js';
import { segmentFurniture } from './inference.mjs';
// All weights and runtime files are served by this site: no third-party photo upload.
env.allowRemoteModels=false;
env.localModelPath='/vision/models/';
env.useBrowserCache=false;
env.useCustomCache=true;
env.backends.onnx.wasm.wasmPaths='/vision/';
env.backends.onnx.wasm.numThreads=1;
let progress=()=>{};
env.customCache={
  async match(key) {
    if (!String(key).includes('/detr/onnx/model_quantized.onnx')) return undefined;
    const manifestResponse=await fetch('/vision/models/detr/weights.json');
    if (!manifestResponse.ok) throw Error('识别模型暂时无法加载，请稍后重试。');
    const manifest=await manifestResponse.json();
    const cached=typeof caches==='undefined'?null:await caches.open('room-vision-v1').catch(()=>null);
    const fullKey=new URL('/vision/model-'+manifest.sha256, self.location.origin).href;
    const existing=await cached?.match(fullKey);
    if (existing) return existing;
    const data=new Uint8Array(manifest.bytes);
    let loaded=0;
    for (const part of manifest.parts) {
      const response=await fetch('/vision/models/detr/'+part.file);
      if (!response.ok) throw Error('识别模型下载中断，请重试。');
      const bytes=new Uint8Array(await response.arrayBuffer());
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if (digest!==part.sha256) throw Error('识别模型下载不完整，请重新识别。');
      data.set(bytes,loaded); loaded+=bytes.length;
      progress('首次准备识别模型，下次会更快',Math.round(loaded/manifest.bytes*100));
    }
    const result=new Response(data,{headers:{'Content-Length':String(data.length),'Content-Type':'application/octet-stream'}});
    try { await cached?.put(fullKey,result.clone()); } catch { /* Storage quota is optional. */ }
    return result;
  },
  async put() {},
};
let segmenter, sam, processor;
self.onmessage=async ({data:{id,image}})=>{
  progress=(message,percent)=>self.postMessage({id,type:'progress',message,percent});
  try {
    progress('正在准备家具识别');
    segmenter ||= await pipeline('image-segmentation','detr',{dtype:'q8',device:'wasm',local_files_only:true});
    progress('正在准备家具轮廓模型');
    sam ||= await SamModel.from_pretrained('slimsam',{dtype:{vision_encoder:'fp32',prompt_encoder_mask_decoder:'fp32'},device:'wasm',local_files_only:true});
    processor ||= await AutoProcessor.from_pretrained('slimsam',{local_files_only:true});
    // Bounded input dimensions avoid exhausting mobile memory.

    let raw=await RawImage.fromBlob(image);
    if (Math.max(raw.width,raw.height)>1024) {
      const ratio=1024/Math.max(raw.width,raw.height);
      raw=await raw.resize(Math.round(raw.width*ratio),Math.round(raw.height*ratio));
    }
    progress('正在寻找家具并描绘轮廓');
    const items=await segmentFurniture(segmenter,raw,RawImage,sam,processor,Tensor,progress);
    const candidates=[];
    for (const {mask,...item} of items) {
      const canvas=new OffscreenCanvas(mask.width,mask.height);
      const pixels=new Uint8ClampedArray(mask.width*mask.height*4);
      for(let i=0;i<mask.width*mask.height;i++) {
        const on=mask.data[i*mask.channels]>127;
        pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=on?255:0;
        // Transparent background makes CSS masks follow pixels, not the whole rectangle.
        pixels[i*4+3]=on?255:0;
      }
      canvas.getContext('2d').putImageData(new ImageData(pixels,mask.width,mask.height),0,0);
      candidates.push({...item,mask:await canvas.convertToBlob({type:'image/png'})});
    }
    self.postMessage({id,type:'complete',candidates});
  } catch(error) {
    self.postMessage({id,type:'error',message:error instanceof Error?error.message:'识别未完成，请重试。'});
  }
};
