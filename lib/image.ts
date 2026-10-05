import type { Candidate } from "./types";
export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(Error("图片加载失败，请重试。"));
    i.src = src;
  });
}
export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
export function blob(c: HTMLCanvasElement) {
  return new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
}
const url = (key: string) => "/api/assets?key=" + encodeURIComponent(key);
export async function prepareImages(original: string, selected: Candidate[]) {
  const img = await loadImage(url(original));
  const w = img.width,
    h = img.height;
  const combined = canvas(w, h),
    ctx = combined.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, w, h);
  const cuts: Record<string, Blob> = {},
    crops: Record<string, Blob> = {};
  for (const c of selected) {
    const m = await loadImage(url(c.mask));
    const mc = canvas(w, h),
      mx = mc.getContext("2d")!;
    mx.drawImage(m, 0, 0, w, h);
    const mask = mx.getImageData(0, 0, w, h),
      source = canvas(w, h);
    source.getContext("2d")!.drawImage(img, 0, 0);
    const pixels = source.getContext("2d")!.getImageData(0, 0, w, h);
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    for (let i = 0; i < mask.data.length; i += 4) {
      const on = mask.data[i] > 127 && mask.data[i + 3] > 127;
      pixels.data[i + 3] = on ? 255 : 0;
      if (on) {
        const n = i / 4,
          x = n % w,
          y = Math.floor(n / w);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = on ? 255 : 0;
      mask.data[i + 3] = 255;
    }
    if (x1 <= x0 || y1 <= y0) throw Error(c.name + " 掩膜为空，请重新圈选。");
    source.getContext("2d")!.putImageData(pixels, 0, 0);
    mx.putImageData(mask, 0, 0);
    ctx.globalCompositeOperation = "lighten";
    ctx.drawImage(mc, 0, 0);
    const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.18;
    const cut = canvas(1024, 1024);
    const cc = cut.getContext("2d")!;
    // Preserve transparency for downloading and subsequent compositing.
    cc.clearRect(0, 0, 1024, 1024);
    cc.drawImage(
      source,
      x0,
      y0,
      x1 - x0 + 1,
      y1 - y0 + 1,
      ((side - (x1 - x0 + 1)) / 2 / side) * 1024,
      ((side - (y1 - y0 + 1)) / 2 / side) * 1024,
      ((x1 - x0 + 1) / side) * 1024,
      ((y1 - y0 + 1) / side) * 1024,
    );
    cuts[c.id] = await blob(cut);
    const crop = canvas(x1 - x0 + 1, y1 - y0 + 1);
    crop
      .getContext("2d")!
      .drawImage(
        img,
        x0,
        y0,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
    crops[c.id] = await blob(crop);
  }
  // Expand removal mask slightly to include object fringes; never use the detection rectangle as a mask.
  const expanded = canvas(w, h),
    ex = expanded.getContext("2d")!;
  ex.fillStyle = "black";
  ex.fillRect(0, 0, w, h);
  ex.globalCompositeOperation = "lighten";
  for (let x = -4; x <= 4; x += 2)
    for (let y = -4; y <= 4; y += 2) ex.drawImage(combined, x, y);
  return { mask: await blob(expanded), cuts, crops };
}
export async function preserveOutside(
  original: string,
  raw: string,
  maskKey: string,
) {
  const [a, b, m] = await Promise.all([
    loadImage(url(original)),
    loadImage(url(raw)),
    loadImage(url(maskKey)),
  ]);
  const c = canvas(a.width, a.height),
    ctx = c.getContext("2d")!;
  ctx.drawImage(a, 0, 0);
  const ap = ctx.getImageData(0, 0, c.width, c.height);
  ctx.drawImage(b, 0, 0, c.width, c.height);
  const bp = ctx.getImageData(0, 0, c.width, c.height);
  ctx.drawImage(m, 0, 0, c.width, c.height);
  const mp = ctx.getImageData(0, 0, c.width, c.height);
  let change = 0,
    n = 0;
  for (let i = 0; i < ap.data.length; i += 4) {
    if (mp.data[i] > 127) {
      for (let j = 0; j < 3; j++) ap.data[i + j] = bp.data[i + j];
    } else {
      for (let j = 0; j < 3; j++)
        change += Math.abs(ap.data[i + j] - bp.data[i + j]);
      n += 3;
    }
  }
  ctx.putImageData(ap, 0, 0);
  return { blob: await blob(c), outsideDifference: n ? change / n : 0 };
}
