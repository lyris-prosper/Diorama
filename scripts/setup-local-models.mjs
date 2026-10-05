import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const target=new URL('../.local/models/lama_fp32.onnx',import.meta.url);
const checksum='1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6';
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
await mkdir(new URL('../.local/models/',import.meta.url),{recursive:true});
if(!existsSync(target)||await digest(target)!==checksum){
  console.log('首次安装免费背景修复模型（约 208 MB），下载后可离线使用。');
  const response=await fetch('https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx',{signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('模型下载失败，请检查网络后重新启动。');
  const partial=new URL(target.href+'.part');
  await pipeline(Readable.fromWeb(response.body),createWriteStream(partial));
  if(await digest(partial)!==checksum){await unlink(partial);throw Error('模型文件校验失败，请重试。');}
  await rename(partial,target);
}
for(const file of ['detr/weights.json','slimsam/onnx/vision_encoder.onnx','slimsam/onnx/prompt_encoder_mask_decoder.onnx']){
  if(!existsSync(new URL('../public/vision/models/'+file,import.meta.url)))throw Error('识别模型缺失：'+file+'。请恢复项目内的 public/vision/models 文件夹。');
}
await writeFile(new URL('../.local/models/README.txt',import.meta.url),'LaMa (Carve ONNX port), Apache-2.0. https://github.com/advimman/lama\nhttps://huggingface.co/Carve/LaMa-ONNX\nPinned revision: c3c0c9e468934d62e79c329e35d82dd09ff8c444\nSHA256: '+checksum+'\n');
console.log('本地识别与免费背景修复模型已就绪。');
