import urllib.request,json,pathlib,concurrent.futures
root=pathlib.Path('public/vision/models/slimsam');(root/'onnx').mkdir(parents=True,exist_ok=True)
revision='5850ab45f587c112167512ffef949107115e26a0';base=f'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/{revision}/'
def get(name):
 p=root/name
 if not p.exists():
  with urllib.request.urlopen(base+name,timeout=120) as r:p.write_bytes(r.read())
 return (name,p.stat().st_size)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 print(list(pool.map(get,['config.json','preprocessor_config.json','onnx/vision_encoder.onnx','onnx/prompt_encoder_mask_decoder.onnx'])))
(root/'revision.json').write_text(json.dumps({'model':'Xenova/slimsam-77-uniform','revision':revision,'license':'Apache-2.0'}))
