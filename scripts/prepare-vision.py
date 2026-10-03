"""Vendor pinned public model assets; no room images leave the browser for recognition."""
import json, urllib.request, pathlib, shutil, hashlib
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'public/vision'; model=out/'models/detr'; model.mkdir(parents=True,exist_ok=True)
revision='ea24b2d4e0bfae31f0a1299ba3fb892a2df064de'; base=f'https://huggingface.co/Xenova/detr-resnet-50-panoptic/resolve/{revision}/'
for name in ['config.json','preprocessor_config.json']:
 if not (model/name).exists():
  data=urllib.request.urlopen(base+name).read(); (model/name).write_bytes(data)
cache=pathlib.Path('/private/tmp/room-detr-q8.onnx')
if not cache.exists():
 with urllib.request.urlopen(base+'onnx/model_quantized.onnx',timeout=120) as response,cache.open('wb') as f:
  shutil.copyfileobj(response,f)
raw=cache.read_bytes(); parts=[]
for i,start in enumerate(range(0,len(raw),12*1024*1024)):
 name=f'weights-{i}.bin'; part=raw[start:start+12*1024*1024]; (model/name).write_bytes(part); parts.append({'file':name,'bytes':len(part),'sha256':hashlib.sha256(part).hexdigest()})
(model/'weights.json').write_text(json.dumps({'revision':revision,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'parts':parts}))
# Correct missing COCO panoptic category names in the upstream config.
categories_path=out/'coco-categories.json'
if not categories_path.exists():
 categories_path.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/cocodataset/panopticapi/master/panoptic_coco_categories.json').read())
cfg=json.loads((model/'config.json').read_text())
for category in json.loads(categories_path.read_text()):
 cfg['id2label'][str(category['id'])]=category['name']
cfg['label2id']={v:int(k) for k,v in cfg['id2label'].items()}
(model/'config.json').write_text(json.dumps(cfg))
for name in ['transformers.web.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']:
 shutil.copyfile(root/'node_modules/@huggingface/transformers/dist'/name,out/name)
shutil.copyfile(root/'node_modules/@huggingface/transformers/LICENSE',out/'TRANSFORMERS-LICENSE.txt')
if not (out/'ONNXRUNTIME-LICENSE.txt').exists(): (out/'ONNXRUNTIME-LICENSE.txt').write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE').read())
if not (out/'DETR-LICENSE.txt').exists():
 (out/'DETR-LICENSE.txt').write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/facebookresearch/detr/main/LICENSE').read())
(out/'NOTICE.txt').write_text(f'DETR ResNet-50 Panoptic by Meta / Facebook Research, Apache-2.0. ONNX q8 export by Xenova, revision {revision}.\nTransformers.js 3.8.1, Apache-2.0. ONNX Runtime Web, MIT.\nhttps://huggingface.co/Xenova/detr-resnet-50-panoptic\nhttps://github.com/facebookresearch/detr\n')
print(json.dumps({'modelBytes':len(raw),'parts':len(parts),'revision':revision}))
