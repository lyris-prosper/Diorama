// Fitting from the room scan: the erase box around a clicked piece (lib/fit-box.ts), the ceiling
// (lib/placement.ts buildCeiling) and the size of a generated model (lib/fit-model.ts).
// Synthetic point rooms; pure and offline.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
const load=(file)=>{
  const code=ts.transpileModule(readFileSync(resolve(file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(n=>{if(n==='three')return THREE;throw Error('unexpected import '+n)},mod,mod.exports);
  return mod.exports;
};
const F=load('lib/fit-box.ts'),P=load('lib/placement.ts'),M=load('lib/fit-model.ts');
let n=0;
const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
const near=(a,b,tol,what='')=>assert(Math.abs(a-b)<=tol,`${what} ${a.toFixed(3)} ≉ ${b.toFixed(3)} (±${tol})`);
// Angles of a box are the same every 180°.
const sameAngle=(a,b,tol)=>{let d=((a-b)%Math.PI+Math.PI)%Math.PI;d=Math.min(d,Math.PI-d);assert(d<=tol,`angle ${a.toFixed(3)} ≉ ${b.toFixed(3)}`);};

// A room, floor at y 0 and ceiling at 2.6, back wall at z -3, left wall at x -2.5, a window wall
// segment with a floor-to-ceiling curtain, a bed against the back wall and a desk turned 30°.
const pts=[];
const sheet=(fn,a0,a1,b0,b1,step)=>{for(let a=a0;a<=a1+1e-9;a+=step)for(let b=b0;b<=b1+1e-9;b+=step)pts.push(fn(a,b));};
const CEIL=2.6;
sheet((x,z)=>[x,0,z],-2.5,2.5,-3,2.5,0.03);
sheet((x,y)=>[x,y,-3],-2.5,2.5,0,CEIL,0.03);
sheet((y,z)=>[-2.5,y,z],0,CEIL,-3,2.5,0.03);
sheet((x,z)=>[x,CEIL,z],-2.5,1.5,-3,2.5,0.05);
// A soffit over the right side: its underside at 2.35 and its face down from the ceiling.
sheet((x,z)=>[x,2.35,z],1.5,2.5,-3,2.5,0.05);
sheet((y,z)=>[1.5,y,z],2.35,CEIL,-3,2.5,0.05);
// Curtain hanging from just under the ceiling to the floor, along the back wall on the right.
sheet((x,y)=>[x,y,-2.85],1.0,2.0,0.02,2.5,0.03);
// Bed: 1.6 wide (x), 2.1 long (z), mattress top 0.55, headboard 0.95 a few cm from the wall.
const BED={cx:-1.2,cz:-1.9,w:1.6,d:2.1};
sheet((x,z)=>[x,0.55,z],BED.cx-BED.w/2,BED.cx+BED.w/2,BED.cz-BED.d/2+0.06,BED.cz+BED.d/2,0.03);
sheet((x,y)=>[x,y,BED.cz+BED.d/2],BED.cx-BED.w/2,BED.cx+BED.w/2,0.1,0.55,0.03);
for(const x of [BED.cx-BED.w/2,BED.cx+BED.w/2])sheet((y,z)=>[x,y,z],0.1,0.55,BED.cz-BED.d/2+0.06,BED.cz+BED.d/2,0.03);
sheet((x,y)=>[x,y,BED.cz-BED.d/2+0.05],BED.cx-BED.w/2,BED.cx+BED.w/2,0.1,0.95,0.03);
// Desk turned 30°: 1.2 × 0.6, top at 0.75, four legs.
const DESK={cx:0.8,cz:0.6,w:1.2,d:0.6,rot:Math.PI/6};
const deskPt=(u,y,v)=>{const c=Math.cos(DESK.rot),s=Math.sin(DESK.rot);return [DESK.cx+u*c+v*s,y,DESK.cz-u*s+v*c];};
sheet((u,v)=>deskPt(u,0.75,v),-DESK.w/2,DESK.w/2,-DESK.d/2,DESK.d/2,0.025);
for(const [u,v] of [[-0.57,-0.27],[0.57,-0.27],[-0.57,0.27],[0.57,0.27]])for(let y=0.07;y<=0.75;y+=0.02)for(const e of [-0.015,0.015])pts.push(deskPt(u+e,y,v+e));
const room=(extra=[])=>{const all=[...pts,...extra];const xyz=new Float32Array(all.length*3);all.forEach((p,i)=>xyz.set(p,i*3));return {xyz,alpha:new Uint8Array(all.length).fill(255),count:all.length};};
const scan=room();
const opts={scale:1,offset:0,floorY:0,ceilingY:CEIL};

check('the ceiling: the main one, and the soffit where it is lower',()=>{
  const c=P.buildCeiling(scan,{scale:1,offset:0,floorY:0,half:3.5});
  near(c.level,CEIL,0.03,'level');
  near(c.at(-0.5,0),CEIL,0.03,'middle');
  near(c.at(2.0,0),2.35,0.03,'soffit');
  near(c.at(30,30),CEIL,0.03,'outside the scan');
});
check('no ceiling in the scan: floor + 2.7',()=>{
  const open=room().xyz.length;assert(open);
  const floorOnly=[];for(let x=-2;x<=2;x+=0.03)for(let z=-2;z<=2;z+=0.03)floorOnly.push([x,0,z]);
  const xyz=new Float32Array(floorOnly.length*3);floorOnly.forEach((p,i)=>xyz.set(p,i*3));
  const c=P.buildCeiling({xyz,alpha:new Uint8Array(floorOnly.length).fill(255),count:floorOnly.length},{scale:1,offset:0,floorY:0,half:3});
  assert.equal(c.level,null);near(c.at(0,0),2.7,1e-9);
});
check('the bed against the wall: its box, without the wall',()=>{
  const b=F.fitBox(scan,opts,[BED.cx+0.2,0.55,BED.cz+0.3],[0,-1]);
  assert(b,'fitted');
  near(b.center[0],BED.cx,0.06,'x');near(b.center[2],BED.cz+0.03,0.06,'z');
  near(b.size[0],BED.w,0.08,'width');near(b.size[2],BED.d-0.05,0.08,'length');
  near(b.size[1],0.95,0.06,'height');near(b.center[1],b.size[1]/2,1e-3,'stands on the floor');
  sameAngle(b.rotation,0,0.05);
  assert.equal(b.kind,'bed');
});
check('a desk turned 30°: its turn, size and kind',()=>{
  const b=F.fitBox(scan,opts,deskPt(0.2,0.75,0),[0,-1]);
  assert(b,'fitted');
  near(b.center[0],DESK.cx,0.05,'x');near(b.center[2],DESK.cz,0.05,'z');
  near(b.size[0],DESK.w,0.08,'width');near(b.size[2],DESK.d,0.08,'depth');near(b.size[1],0.75,0.05,'height');
  sameAngle(b.rotation,DESK.rot,0.05);
  assert.equal(b.kind,'desk');
});
check('seen from the side, the width is still the side across the view',()=>{
  const b=F.fitBox(scan,opts,[BED.cx,0.55,BED.cz],[1,0]);
  near(b.size[0],BED.d-0.05,0.08,'width across the view');near(b.size[2],BED.w,0.08,'depth');
});
check('a click on a wall or a curtain fits nothing',()=>{
  assert.equal(F.fitBox(scan,opts,[-2.5,1.2,0.5]),null);
  assert.equal(F.fitBox(scan,opts,[0,1.6,-3]),null);
  assert.equal(F.fitBox(scan,opts,[1.5,1.2,-2.85]),null);
  assert.equal(F.fitBox(scan,opts,[0,1.2,1.5]),null,'empty air');
});
check('stray splats around a piece do not change its box',()=>{
  let seed=7;const r=()=>(seed=(seed*9301+49297)%233280)/233280;
  const noise=[];for(let i=0;i<600;i++)noise.push([-2.4+r()*4.8,0.1+r()*2.3,-2.9+r()*5.3]);
  const a=F.fitBox(scan,opts,deskPt(0.2,0.75,0),[0,-1]),b=F.fitBox(room(noise),opts,deskPt(0.2,0.75,0),[0,-1]);
  for(let i=0;i<3;i++){near(b.center[i],a.center[i],0.03,'centre');near(b.size[i],a.size[i],0.05,'size');}
});
check('the smallest rectangle around a turned square is the square',()=>{
  const c=Math.cos(0.4),s=Math.sin(0.4),sq=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[x*c-z*s,x*s+z*c]);
  const r=F.minRectangle(sq);near(r.area,4,1e-6,'area');near(r.len[0],2,1e-6);near(r.len[1],2,1e-6);
});
check('the walls\' heading: square rooms, turned rooms, and none without walls',()=>{
  const deg=(r)=>r*180/Math.PI,mod90=(d)=>Math.min(((d%90)+90)%90,90-((d%90)+90)%90);
  const area={scale:1,offset:0,floorY:0,half:3.5};
  assert(mod90(deg(P.wallHeading(scan,area)))<0.3,'square room');
  // The same room turned 25° (three.js rotation.y): the walls follow.
  const a=25*Math.PI/180,c=Math.cos(a),s=Math.sin(a),xyz=new Float32Array(scan.xyz.length);
  for(let i=0;i<scan.count;i++){const x=scan.xyz[i*3],z=scan.xyz[i*3+2];xyz[i*3]=x*c+z*s;xyz[i*3+1]=scan.xyz[i*3+1];xyz[i*3+2]=-x*s+z*c;}
  near(deg(P.wallHeading({...scan,xyz},area)),25,0.3,'turned room');
  let seed=3;const r=()=>(seed=(seed*9301+49297)%233280)/233280;
  const fog=new Float32Array(30000*3);for(let i=0;i<30000;i++){const t=r()*2*Math.PI,d=Math.sqrt(r())*3;fog.set([Math.cos(t)*d,1.2+r()*0.8,Math.sin(t)*d],i*3);}
  assert.equal(P.wallHeading({xyz:fog,alpha:new Uint8Array(30000).fill(255),count:30000},area),null,'no walls');
});
check('a model whose proportions match the typed size is sized exactly',()=>{
  const f=M.fitScale([1.0,0.55,1.4],{w:150,d:200,h:80});
  assert.equal(f.uniform,false);assert.equal(f.swap,false);
  near(f.scale[0],1.5,1e-9);near(f.scale[1],0.8/0.55,1e-9);near(f.scale[2],2/1.4,1e-9);
});
check('a pendant typed by its shade only keeps its shape and its rod',()=>{
  // Tripo's lamp: 0.53 × 1.0 × 0.53 (rod and shades); typed 43 × 43 × 28.3 cm (the shade).
  const f=M.fitScale([0.528,1.0,0.532],{w:43,d:43,h:28.3});
  assert.equal(f.uniform,true);
  near(f.scale[0],f.scale[1],1e-12);near(f.scale[1],f.scale[2],1e-12);
  near(0.528*f.scale[0],0.43,0.01,'shade width');near(1.0*f.scale[1],0.81,0.02,'height with the rod');
});
check('the longer typed side follows the longer side of the model',()=>{
  const f=M.fitScale([1.4,0.55,1.0],{w:150,d:200,h:80});
  assert.equal(f.swap,true);near(f.scale[0],2/1.4,1e-9);near(f.scale[2],1.5,1e-9);
});
console.log(`PASS ${n} fitting checks`);
