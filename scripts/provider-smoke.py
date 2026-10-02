"""Explicit paid World Labs smoke test. One project / one request, resumable.
Run only with --generate-world; reads ignored .dev.vars, never prints credentials.
The photo remains unedited (acceptance C). Does not claim A/B completion.
"""
import argparse,base64,json,pathlib,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--generate-world',action='store_true');p.add_argument('--poll',action='store_true');p.add_argument('--image');args=p.parse_args()
keys={k:json.loads(v) for k,v in (line.split('=',1) for line in (ROOT/'.dev.vars').read_text().splitlines() if '=' in line)}
state=ROOT/'work/world-smoke.json'
def call(path,payload=None):
 req=urllib.request.Request('https://api.worldlabs.ai/marble/v1/'+path,data=json.dumps(payload).encode() if payload else None,headers={'WLT-Api-Key':keys['WORLDLABS_API_KEY'],'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=50) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()[:500])
if args.generate_world:
 if state.exists():print('Existing smoke task; use --poll.');raise SystemExit(0)
 bal=call('credits');print('balance_before',bal)
 if bal['remaining_credits']<250:raise RuntimeError('Insufficient budget')
 state.write_text(json.dumps({'status':'submitting','balance_before':bal}))
 photo=base64.b64encode(pathlib.Path(args.image).read_bytes()).decode()
 result=call('worlds:generate',{'display_name':'房间工作台 · 原图空间验证','model':'marble-1.0-draft','permission':{'public':False},'world_prompt':{'type':'image','image_prompt':{'source':'data_base64','data_base64':photo},'disable_recaption':True,'text_prompt':'Reconstruct this bedroom faithfully. Preserve existing furniture, wall, window and floor appearance. Do not add furniture.'}})
 state.write_text(json.dumps({'status':'running','operation_id':result['operation_id'],'balance_before':bal},indent=2));print('World task created',result['operation_id'])
elif args.poll:
 s=json.loads(state.read_text());op=call('operations/'+s['operation_id']);print('done',op.get('done'),'error',op.get('error'))
 if op.get('done'):
  s['operation']=op
  if op.get('response',{}).get('world_id'):s['world']=call('worlds/'+op['response']['world_id'])
  s['balance_after']=call('credits');s['status']='done';state.write_text(json.dumps(s,indent=2));print('cost',op.get('cost'),'balance_after',s['balance_after']);print('asset_types',list(s.get('world',{}).get('assets',{})))
