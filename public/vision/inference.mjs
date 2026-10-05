import { furnitureLabels, furnitureSegments } from './segments.mjs';
// DETR supplies class/extent; SlimSAM supplies real pixel masks. Boxes are never masks.
export async function segmentFurniture(detector,raw,RawImage,sam,processor,Tensor,onProgress=()=>{}) {
  const input=await detector.processor(raw);
  const output=await detector.model(input);
  const detection=detector.processor.image_processor.post_process_object_detection(output,0.5)[0];
  const targets=detection.classes.map((id,i)=>({label:detector.model.config.id2label[id],score:detection.scores[i],box:detection.boxes[i]}))
    .filter(t=>furnitureLabels[t.label]).sort((a,b)=>b.score-a.score).slice(0,12);
  if(!targets.length)return [];
  onProgress('正在描绘家具轮廓');
  const processed=await processor(raw);
  const embeddings=await sam.get_image_embeddings(processed);
  const results=[];
  for(let index=0;index<targets.length;index++) {
    const target=targets[index];
    const b=target.box.map(v=>Math.max(0,Math.min(1,v)));
    const [x0,y0,x1,y1]=b, cx=(x0+x1)/2,cy=(y0+y1)/2;
    // Beds and sofas fill their box, so interior points work well. Desks, tables, cabinets and chairs
    // often have empty space at the box centre (e.g. wall between desk legs), so they are prompted
    // with the box itself, encoded as SAM's top-left/bottom-right corner labels 2 and 3.
    const filled=target.label==='couch' || target.label==='bed';
    const positives=filled
      ? [[cx,cy],[x0+(x1-x0)*.22,cy],[x0+(x1-x0)*.78,cy],[cx,y0+(y1-y0)*.25],[cx,y0+(y1-y0)*.75]]
      : [];
    const points=(filled
      ? [...positives,[Math.max(0,x0-0.035),cy],[Math.min(1,x1+0.035),cy],[cx,Math.max(0,y0-0.035)],[cx,Math.min(1,y1+0.035)]]
      : [[x0,y0],[x1,y1]]).map(([x,y])=>[x*raw.width,y*raw.height]);
    const labels=filled?[...positives.map(()=>1n),0n,0n,0n,0n]:[2n,3n];
    const input_points=processor.reshape_input_points([points],processed.original_sizes,processed.reshaped_input_sizes);
    const input_labels=new Tensor('int64',BigInt64Array.from(labels),[1,1,points.length]);
    const result=await sam({...embeddings,input_points,input_labels});
    const masks=await processor.post_process_masks(result.pred_masks,processed.original_sizes,processed.reshaped_input_sizes);
    const candidates=masks[0][0];
    // Rank usable SAM masks by its score and how much of the object extent they cover.
    let best=null,bestRank=-Infinity;
    for(let k=0;k<candidates.dims[0];k++) {
      const data=new Uint8ClampedArray(raw.width*raw.height);
      let inside=0,total=0;
      const source=candidates[k].data;
      for(let y=0;y<raw.height;y++)for(let x=0;x<raw.width;x++){
        const i=y*raw.width+x;if(!source[i])continue;total++;
        if(x/raw.width>=x0-0.025&&x/raw.width<=x1+0.025&&y/raw.height>=y0-0.025&&y/raw.height<=y1+0.025){data[i]=255;inside++;}
      }
      const boxArea=Math.max(1,(x1-x0)*(y1-y0)*raw.width*raw.height);
      if(inside<boxArea*.06||inside<raw.width*raw.height*.002)continue;
      const rank=result.iou_scores.data[k]+.25*Math.min(1,inside/boxArea)-.5*(1-inside/Math.max(1,total));
      if(rank>bestRank){bestRank=rank;best=new RawImage(data,raw.width,raw.height,1);}
    }
    if(best){
      const area=best.data.reduce((n,v)=>n+(v>127?1:0),0);
      const coverage=area/Math.max(1,(x1-x0)*(y1-y0)*raw.width*raw.height);
      results.push({...target,mask:best,needsReview:coverage<.35});
    }
    onProgress(`正在描绘家具轮廓 · ${index+1}/${targets.length}`);
    for(const tensor of [input_points,input_labels,...Object.values(result),...masks])tensor?.dispose?.();
  }
  for(const tensor of [...Object.values(input),...Object.values(output),...Object.values(embeddings)])tensor?.dispose?.();
  processed.pixel_values?.dispose();
  return furnitureSegments(results);
}
