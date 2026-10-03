// Only furniture classes are returned. Fixed room structures are never targets.
export const furnitureLabels = {
  bed: ['bed', '床'], chair: ['chair', '椅子'], couch: ['sofa', '沙发'],
  'dining table': ['desk', '桌子'], desk: ['desk', '书桌'],
  'desk-stuff': ['desk', '书桌'], table: ['desk', '桌子'],
  cabinet: ['cabinet', '柜子'], cupboard: ['cabinet', '柜子'],
  'cabinet-merged': ['cabinet', '柜子'], 'table-merged': ['desk', '桌子'],
  bench: ['chair', '长凳'],
};
export function furnitureSegments(results) {
  const counts = {};
  return results.flatMap(({ label, score, mask, needsReview }) => {
    const meta = furnitureLabels[label];
    if (!meta || score < 0.5) return [];
    let xmin=mask.width, ymin=mask.height, xmax=-1, ymax=-1, area=0;
    for (let y=0; y<mask.height; y++) for (let x=0; x<mask.width; x++) {
      if (mask.data[(y*mask.width+x)*mask.channels] > 127) {
        xmin=Math.min(xmin,x); ymin=Math.min(ymin,y);
        xmax=Math.max(xmax,x); ymax=Math.max(ymax,y); area++;
      }
    }
    if (area < mask.width*mask.height*0.002 || xmax <= xmin || ymax <= ymin) return [];
    counts[meta[0]]=(counts[meta[0]] || 0)+1;
    return [{ kind:meta[0], name:meta[1]+' '+counts[meta[0]], score,
      box:[xmin/mask.width,ymin/mask.height,(xmax+1)/mask.width,(ymax+1)/mask.height],
      mask, label, needsReview:!!needsReview || meta[0]==='cabinet' || score<.7 }];
  }).slice(0,15);
}
