// Where pieces land: the room scan's surfaces (lib/placement.ts) on a synthetic room, and pieces
// standing on pieces. Pure and offline.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
const code=ts.transpileModule(readFileSync(resolve('lib/placement.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const mod={exports:{}};
new Function('require','module','exports',code)(n=>{if(n==='three')return THREE;throw Error('unexpected import '+n)},mod,mod.exports);
const P=mod.exports;
let n=0;
const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};

// A room scanned as points (the .spz frame is y-up, camera at the origin): floor 1.2 m below the
// eye, a wall on the left, a back wall, a ceiling, a desk (top 74 cm, a 14 cm apron at the front,
// four legs) and a wardrobe 2.2 m tall.
const FLOOR=-1.2;
const pts=[];
const sheet=(fn,a0,a1,b0,b1,step)=>{for(let a=a0;a<=a1+1e-9;a+=step)for(let b=b0;b<=b1+1e-9;b+=step)pts.push(fn(a,b));};
sheet((x,z)=>[x,FLOOR,z],-2,2,-5,0.5,0.02);
sheet((y,z)=>[-2,y,z],FLOOR,1.45,-5,0.5,0.03);
sheet((x,y)=>[x,y,-5],-2,2,FLOOR,1.45,0.03);
sheet((x,z)=>[x,1.45,z],-2,2,-5,0.5,0.05);
const TOP=FLOOR+0.74;
sheet((x,z)=>[x,TOP,z],0.4,1.6,-4.2,-3.6,0.02);
sheet((x,y)=>[x,y,-3.6],0.4,1.6,TOP-0.14,TOP,0.02);
for(const [x,z] of [[0.42,-3.62],[1.58,-3.62],[0.42,-4.18],[1.58,-4.18]])for(let y=FLOOR;y<=TOP;y+=0.02)pts.push([x,y,z]);
sheet((y,z)=>[1.4,y,z],FLOOR,FLOOR+2.2,-2.5,-1,0.03);
sheet((x,z)=>[x,FLOOR+2.2,z],1.4,2,-2.5,-1,0.03);
// A low ottoman (40 cm) on the left, to be erased.
sheet((x,z)=>[x,FLOOR+0.4,z],-1.2,-0.6,-2.6,-2.0,0.02);
sheet((x,y)=>[x,y,-2.0],-1.2,-0.6,FLOOR,FLOOR+0.4,0.02);
const xyz=new Float32Array(pts.length*3);pts.forEach((p,i)=>xyz.set(p,i*3));
const grid=P.buildRoomGrid({xyz,alpha:new Uint8Array(pts.length).fill(255),count:pts.length},{scale:1,offset:0,floorY:FLOOR,half:5.5});
const eye=new THREE.Vector3(0,0,0);
const cast=(target,boxes=[])=>P.castRoom(grid,eye,new THREE.Vector3(...target).sub(eye).normalize(),boxes);
const near=(a,b,tol=0.03)=>assert(Math.abs(a-b)<=tol,`${a.toFixed(3)} ≉ ${b.toFixed(3)}`);

check('pointing at the desk top lands on it',()=>{const h=cast([1,TOP,-3.9]);assert.equal(h.kind,'top');near(h.point.y,TOP);});
check('pointing at the desk front lands on the desk top, not on the floor behind it',()=>{const h=cast([1,TOP-0.07,-3.6]);assert.equal(h.kind,'top');near(h.point.y,TOP);});
check('pointing at the open floor lands exactly on the floor',()=>{const h=cast([0,FLOOR,-2]);assert.equal(h.kind,'floor');assert.equal(h.point.y,FLOOR);});
check('a wall takes nothing, at any height',()=>{for(const y of [-0.8,0,0.8])assert.equal(cast([-2,y,-2]).kind,'blocked');});
check('the side of a wardrobe above eye level is not a way onto its top',()=>assert.equal(cast([1.4,-0.2,-1.8]).kind,'blocked'));
check('the ceiling takes nothing',()=>assert.equal(cast([0,1.45,-2]).kind,'blocked'));
check('the floor behind the desk is never returned through the desk',()=>{
  // Rays fanned over the desk's outline from the eye: each one either stops on the desk top or
  // reaches floor that the eye can actually see (under the desk, below the apron).
  for(let x=0.45;x<1.6;x+=0.1)for(let y=TOP+0.02;y>FLOOR;y-=0.05)for(const z of [-3.6,-3.9]){
    const h=cast([x,y,z]);if(!h||h.kind!=='floor')continue;
    const t=(TOP-0.15-eye.y)/(h.point.y-eye.y),zc=eye.z+(h.point.z-eye.z)*t;
    // Where the ray crosses the apron's lower edge it must already be past the desk front, or under it.
    assert(!(zc<=-3.6&&zc>=-4.2&&h.point.z<-3.6&&t<1&&Math.abs(eye.x+(h.point.x-eye.x)*t-x)<0.2&&(eye.y+(h.point.y-eye.y)*((-3.6-eye.z)/(h.point.z-eye.z)))>TOP-0.14),'floor seen through the desk at '+[x,y,z]);
  }
});
check('an erased box is see-through: the ottoman erased, the ray reaches the floor behind it',()=>{
  const h0=cast([-0.9,FLOOR+0.4,-2.3]);assert.equal(h0.kind,'top');near(h0.point.y,FLOOR+0.4);
  const boxes=P.eraseBoxes([{id:'e',center:[-0.9,FLOOR+0.25,-2.3],size:[0.7,0.5,0.7],rotation:0.3}],FLOOR,0.25);
  const h=cast([-0.9,FLOOR+0.4,-2.3],boxes);assert.equal(h.kind,'floor');assert(h.point.z<-2.6,'beyond the ottoman');
  // The desk top erased: nothing to stand on there, and the ray goes on to the back wall.
  const desk=P.eraseBoxes([{id:'d',center:[1,FLOOR+0.45,-3.9],size:[1.4,0.9,0.8],rotation:0}],FLOOR,0.25);
  assert.notEqual(cast([1,TOP,-3.9],desk).kind,'top');
});
check('the surface under a point: desk top, or floor beside it, or floor when erased',()=>{
  near(P.roomBelow(grid,1,-3.9,0,[]),TOP);
  assert.equal(P.roomBelow(grid,0,-2,0,[]),FLOOR);
  const boxes=P.eraseBoxes([{id:'e',center:[1,FLOOR+0.45,-3.9],size:[1.4,0.9,0.8],rotation:0}],FLOOR,0.25);
  assert.equal(P.roomBelow(grid,1,-3.9,0,boxes),FLOOR);
});

// Pieces: a library desk on the floor, a lamp and a tray on it, a mug on the tray.
const piece=(id,size,at)=>{const g=new THREE.Group();g.userData.itemId=id;const m=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.position.y=size[1]/2;g.add(m);g.position.set(...at);g.updateMatrixWorld(true);return g;};
const desk=piece('desk',[1.2,0.74,0.6],[0,FLOOR,-3]);
const deskTop=FLOOR+0.74;
const lamp=piece('lamp',[0.16,0.3,0.16],[-0.4,deskTop,-3]);
const tray=piece('tray',[0.27,0.02,0.19],[0.3,deskTop,-3]);
const mug=piece('mug',[0.1,0.09,0.08],[0.3,deskTop+0.02,-3]);
const pieces=new Map([['desk',desk],['lamp',lamp],['tray',tray],['mug',mug]]);
const ray=(target,origin=eye)=>new THREE.Raycaster(origin.clone(),new THREE.Vector3(...target).sub(origin).normalize());
check('the side of a piece puts the new one on its top',()=>{
  const r=ray([0,FLOOR+0.3,-2.7]),hit=P.hitPieces(r,[desk]);
  assert.equal(hit.root.userData.itemId,'desk');assert.equal(hit.up,false);
  near(P.landOnPiece(hit,r.ray.direction).y,deskTop,0.005);
});
check('a top facing up is landed on where it was hit',()=>{
  const r=ray([0,deskTop,-3]),hit=P.hitPieces(r,[desk]);assert.equal(hit.up,true);near(hit.point.y,deskTop,0.005);
});
check('the underside of a piece is never a top',()=>{
  const shelf=piece('shelf',[0.6,0.04,0.3],[0,0.3,-2]);
  const r=ray([0,0.3,-2],new THREE.Vector3(0,-0.5,-0.5)),hit=P.hitPieces(r,[shelf]);
  assert.equal(hit.up,false);near(P.landOnPiece(hit,r.ray.direction).y,0.34,0.005);
});
check('what rests on a desk travels with it, the mug on the tray included',()=>{
  assert.deepEqual(P.ridersOf('desk',pieces).sort(),['lamp','mug','tray']);
  assert.deepEqual(P.ridersOf('tray',pieces),['mug']);
  assert.deepEqual(P.ridersOf('lamp',pieces),[]);
});
check('with the desk taken away, what stood on it drops to the floor',()=>{
  assert.equal(P.piecesBelow([tray,mug],-0.4,-3,deskTop+0.02),null); // the lamp itself and the desk left out
  near(P.piecesBelow([desk],-0.4,-3,deskTop+0.02),deskTop,0.005);
});
console.log(`${n} placement checks passed`);
