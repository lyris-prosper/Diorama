"""Download an already-generated world. No paid operation. No secret output."""
import pathlib,json,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
s=json.loads((root/'work/world-smoke.json').read_text());a=s['world']['assets'];out=root/'resources/validation';out.mkdir(exist_ok=True,parents=True)
for name,url in [('room-100k.spz',a['splats']['spz_urls']['100k']),('collider.glb',a['mesh']['collider_mesh_url']),('thumbnail.webp',a['thumbnail_url'])]:
 with urllib.request.urlopen(url,timeout=45) as r:(out/name).write_bytes(r.read())
 print(name,(out/name).stat().st_size)
(out/'world.json').write_text(json.dumps({'world_id':s['world']['world_id'],'operation_id':s['operation_id'],'cost':s['operation']['cost'],'semantics_metadata':a['splats']['semantics_metadata'],'mode':'real-unmodified-photo','furniture_generated':False},indent=2))
