// How a generated model is sized to the dimensions the person typed.
//
// A photo-made model has the proportions of the photo. When the typed size agrees with them
// (within 30% between axes), each axis is stretched to its typed length, so a bed is exactly
// 150 × 200 × 80. When it does not (a pendant whose typed height is only the shade, while the
// model has its rod too), stretching would squash the piece flat: it is scaled evenly instead, by
// the scale most axes agree on (the median), and keeps the shape of the photo.

export type ModelFit = {
  /** Scale per model axis (x, y, z). */
  scale: [number, number, number];
  /** The model is turned 90° so its longer side follows the typed longer side. */
  swap: boolean;
  /** Scaled evenly because the typed size disagrees with the photo's proportions. */
  uniform: boolean;
};

/** `size`: the model's bounding box (its own units); `dims`: the typed size in cm. */
export function fitScale(size: [number, number, number], dims: { w: number; d: number; h: number }): ModelFit {
  const w = dims.w / 100,
    d = dims.d / 100,
    h = dims.h / 100;
  const [sx, sy, sz] = size.map((v) => Math.max(v, 0.001));
  const swap = sx >= sz !== w >= d;
  const k: [number, number, number] = [(swap ? d : w) / sx, h / sy, (swap ? w : d) / sz];
  const spread = Math.max(...k) / Math.min(...k);
  if (spread <= 1.3) return { scale: k, swap, uniform: false };
  const median = [...k].sort((a, b) => a - b)[1];
  return { scale: [median, median, median], swap, uniform: true };
}
