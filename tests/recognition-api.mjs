import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
const headers={'oai-authenticated-user-id':'recognition-qa'};
const api=async body=>{const response=await fetch(base+'/api/workbench',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
const upload=async(id,role,path)=>{const form=new FormData();form.append('id',id);form.append('role',role);form.append('file',new Blob([await readFile(path)],{type:path.endsWith('.webp')?'image/webp':'image/png'}),'room.png');const response=await fetch(base+'/api/workbench',{method:'POST',headers,body:form});assert.equal(response.status,200);return response.json();};
const p=(await api({action:'create',mode:'real'})).data;
const original=await upload(p.id,'original','resources/validation/thumbnail.webp');
const reports=JSON.parse(await readFile('work/recognition/results.json'));
const candidates=[];
for(let i=0;i<reports[0].objects.length;i++){
 const mask=await upload(p.id,'auto-mask-'+i,`work/recognition/0-${i}.png`);
 candidates.push({...reports[0].objects[i],mask:mask.key});
}
const wrong=await api({action:'recognize',id:p.id,original:'another-photo',candidates});assert.equal(wrong.status,400,'stale photo rejected');
const cross=await api({action:'recognize',id:p.id,original:original.key,candidates:[{...candidates[0],mask:'other-user/uploads/auto-mask-1.png'}]});assert.equal(cross.status,400,'foreign mask rejected');
const recognized=await api({action:'recognize',id:p.id,original:original.key,candidates});assert.equal(recognized.status,200);assert(recognized.data.recognitionComplete);assert.equal(recognized.data.tasks.length,0,'no paid generation');assert(recognized.data.candidates.every(c=>!c.selected),'nothing selected automatically');
const blank=await api({action:'select-candidates',id:p.id,branch:'remove',intent:'',selected:[]});assert.equal(blank.status,400,'blank is not all');
const selected=await api({action:'select-candidates',id:p.id,branch:'edit',intent:'床',selected:[]});assert.equal(selected.status,200);assert.equal(selected.data.candidates.filter(c=>c.selected).length,1);assert.equal(selected.data.candidates.find(c=>c.selected).kind,'bed');
const restored=await fetch(base+'/api/workbench?id='+p.id,{headers}).then(r=>r.json());assert(restored.recognitionComplete);assert.equal(restored.candidates.length,candidates.length,'masks persist on reload');
const repair=await api({action:'prepare',id:p.id,selected:restored.candidates.filter(c=>c.selected).map(c=>c.id)});assert.equal(repair.status,400);assert.match(repair.data.error,/FAL_KEY/,'repair honestly blocked without key');
const uncertain=restored.candidates.find(c=>c.score<0.7);
if(uncertain){
 const corrected=await api({action:'correct-candidate',id:p.id,candidate:uncertain.id,kind:'desk'});
 assert.equal(corrected.status,200);assert.equal(corrected.data.candidates.find(c=>c.id===uncertain.id).kind,'desk');
 assert.equal(corrected.data.candidates.find(c=>c.id===uncertain.id).mask,uncertain.mask,'correction preserves contour');
}
const missing=await api({action:'select-candidates',id:p.id,branch:'remove',intent:'沙发',selected:[]});assert.equal(missing.status,400,'nonexistent object not invented');
console.log('PASS: real inference masks upload, persistence, selection, empty intent, stale-photo guard, owner mask isolation and no paid tasks.');
