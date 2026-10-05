// Runs as a separate child process (see build/local-vision-plugin.mjs) so model memory never
// stacks onto the dev server and is fully returned to the OS when the job ends.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const send = message => new Promise(resolve => process.send ? process.send(message, resolve) : resolve());
const progress = message => send({type:'progress',message});
// Recognition peaks around 3.5–4.5 GB on an 8 GB Mac. Stop ourselves before the system starts thrashing.
let stopping = false;
const limitMB = Number(process.env.LOCAL_VISION_MAX_MB) || 4600;
setInterval(() => {
  const mb = process.memoryUsage.rss() / 1048576;
  if (mb > limitMB && !stopping) {
    stopping = true;
    const stop = () => process.kill(process.pid,'SIGKILL');
    setTimeout(stop, 300);
    void send({type:'error',message:`本地模型内存占用超过 ${Math.round(limitMB/1024*10)/10} GB，已自动停止以保护电脑。请关闭其他软件后重试。`}).then(stop);
  }
}, 100).unref();
const decode = value => Buffer.from(value,'base64');
async function recognize(image) {
  const {pipeline,env,RawImage,SamModel,AutoProcessor,Tensor}=await import('@huggingface/transformers');
  const {segmentFurniture}=await import('../public/vision/inference.mjs');
  env.allowRemoteModels=false; env.useFSCache=false; env.useCustomCache=true;
  env.localModelPath=new URL('../public/vision/models/',import.meta.url).pathname;
  const dir=new URL('../public/vision/models/detr/',import.meta.url);
  env.customCache={async match(key){
    if(!String(key).includes('/detr/onnx/model_quantized.onnx'))return;
    const manifest=JSON.parse(await readFile(new URL('weights.json',dir)));
    const data=Buffer.concat(await Promise.all(manifest.parts.map(p=>readFile(new URL(p.file,dir)))));
    if(createHash('sha256').update(data).digest('hex')!==manifest.sha256)throw Error('本地识别模型不完整，请重新安装模型。');
    return new Response(data,{headers:{'Content-Length':String(data.length)}});
  },async put(){}};
  progress('正在加载本地家具识别模型');
  const detector=await pipeline('image-segmentation','detr',{dtype:'q8',local_files_only:true,device:'cpu'});
  // The DETR preset otherwise scales a 4:3 photo up to 999×1333; its unused panoptic mask head then needs ~4 GB.
  detector.processor.image_processor.size={shortest_edge:800,longest_edge:1066};
  const sam=await SamModel.from_pretrained('slimsam',{dtype:{vision_encoder:'fp32',prompt_encoder_mask_decoder:'fp32'},device:'cpu',local_files_only:true});
  const processor=await AutoProcessor.from_pretrained('slimsam',{local_files_only:true});
  const {data,info}=await sharp(image,{limitInputPixels:24e6}).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const raw=new RawImage(new Uint8ClampedArray(data),info.width,info.height,info.channels);
  const results=await segmentFurniture(detector,raw,RawImage,sam,processor,Tensor,progress);
  const candidates=[];
  for(const {mask,...item} of results){
    const rgba=Buffer.alloc(mask.width*mask.height*4);
    for(let i=0;i<mask.width*mask.height;i++)if(mask.data[i*mask.channels]>127)rgba.fill(255,i*4,i*4+4);
    const png=await sharp(rgba,{raw:{width:mask.width,height:mask.height,channels:4}}).png().toBuffer();
    candidates.push({...item,mask:png.toString('base64')});
  }
  await detector.dispose();await sam.dispose();
  return {candidates};
}
// Square dilation as two separable max passes: O(pixels × radius), no extra dependencies.
function dilate(mask,width,height,r){
  const tmp=Buffer.alloc(width*height),out=Buffer.alloc(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(mask[y*width+x]<=127)continue;
    for(let k=Math.max(0,x-r),e=Math.min(width-1,x+r);k<=e;k++)tmp[y*width+k]=255;
  }
  for(let x=0;x<width;x++)for(let y=0;y<height;y++){
    if(!tmp[y*width+x])continue;
    for(let k=Math.max(0,y-r),e=Math.min(height-1,y+r);k<=e;k++)out[k*width+x]=255;
  }
  return out;
}
async function inpaint(image,mask) {
  const ort=await import('onnxruntime-node');
  progress('正在加载本地背景修复模型');
  const session=await ort.InferenceSession.create(new URL('../.local/models/lama_fp32.onnx',import.meta.url).pathname,{intraOpNumThreads:4,interOpNumThreads:1});
  try {
    const {data:original,info}=await sharp(image,{limitInputPixels:24e6}).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    const {width,height}=info;
    const maskMeta=await sharp(mask,{limitInputPixels:24e6}).metadata();
    if(maskMeta.width!==width||maskMeta.height!==height)throw Error('轮廓和照片尺寸不一致，请重新圈选。');
    const originalMask=await sharp(mask).flatten({background:'#000'}).greyscale().threshold(127).raw().toBuffer();
    const area=originalMask.reduce((n,v)=>n+(v>127),0);
    if(area<16)throw Error('没有有效圈选区域。');
    if(area>width*height*.9)throw Error('圈选范围超过照片的九成，请只圈选要移除的家具。');
    // Furniture edges and contact shadows sit just outside a tight outline and leave a ghost.
    // Grow the removal area, then blend it in with a soft edge.
    const grow=Math.max(6,Math.round(Math.max(width,height)*0.012)),soft=Math.max(2,Math.round(grow/4));
    const grown=dilate(originalMask,width,height,grow);
    // sharp may return 3 bands for single-band raw input; .greyscale() keeps one byte per pixel.
    const alpha=await sharp(grown,{raw:{width,height,channels:1}}).blur(soft).greyscale().raw().toBuffer();
    for(let i=0;i<width*height;i++)if(originalMask[i]>127||grown[i]>127)alpha[i]=Math.max(alpha[i],grown[i]>127?255:0);
    // Repair only a crop around the furniture so LaMa's fixed 512px input keeps close to the photo's
    // own resolution, instead of shrinking the whole room to 512px and scaling it back up.
    let x0=width,y0=height,x1=-1,y1=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(grown[y*width+x]>127){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
    const pad=Math.max(48,Math.round(Math.max(x1-x0,y1-y0)*0.35));
    const left=Math.max(0,x0-pad),top=Math.max(0,y0-pad),cw=Math.min(width,x1+pad+1)-left,ch=Math.min(height,y1+pad+1)-top;
    const ratio=512/Math.max(cw,ch),w=Math.max(1,Math.min(512,Math.round(cw*ratio))),h=Math.max(1,Math.min(512,Math.round(ch*ratio)));
    const rgb=await sharp(original,{raw:{width,height,channels:3}}).extract({left,top,width:cw,height:ch}).resize(w,h).extend({right:512-w,bottom:512-h,left:0,top:0,extendWith:'mirror'}).raw().toBuffer();
    const m=await sharp(grown,{raw:{width,height,channels:1}}).extract({left,top,width:cw,height:ch}).resize(w,h,{kernel:'nearest'}).extend({right:512-w,bottom:512-h,left:0,top:0,background:'#000'}).greyscale().raw().toBuffer();
    const imageTensor=new Float32Array(3*512*512),maskTensor=new Float32Array(512*512);
    for(let i=0;i<512*512;i++){for(let c=0;c<3;c++)imageTensor[c*512*512+i]=rgb[i*3+c]/255;maskTensor[i]=m[i]>127?1:0;}
    progress('正在移除家具并补全墙面与地板');
    const result=await session.run({image:new ort.Tensor('float32',imageTensor,[1,3,512,512]),mask:new ort.Tensor('float32',maskTensor,[1,1,512,512])});
    const output=result[session.outputNames[0]].data,generated=Buffer.alloc(512*512*3);
    for(let i=0;i<512*512;i++)for(let c=0;c<3;c++)generated[i*3+c]=Math.max(0,Math.min(255,Math.round(output[c*512*512+i])));
    const repaired=await sharp(generated,{raw:{width:512,height:512,channels:3}}).extract({left:0,top:0,width:w,height:h}).resize(cw,ch).raw().toBuffer();
    // Pixels beyond the grown, softened edge are never changed.
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      const i=(top+y)*width+left+x,a=alpha[i]/255;if(!a)continue;
      for(let c=0;c<3;c++)original[i*3+c]=Math.round(original[i*3+c]*(1-a)+repaired[(y*cw+x)*3+c]*a);
    }
    const png=await sharp(original,{raw:{width,height,channels:3}}).png().toBuffer();
    return {image:png.toString('base64'),engine:'LaMa',width,height,editRadius:grow+3*soft};
  } finally {await session.release();}
}
process.once('message', async job => {
  try {
    const image=decode(job.image);
    const result=job.kind==='recognize'?await recognize(image):await inpaint(image,decode(job.mask));
    await send({type:'complete',result});
  } catch(e){await send({type:'error',message:e.message});}
  // Disconnect only after the (possibly multi-MB) result has been flushed to the parent.
  process.disconnect?.();
});
