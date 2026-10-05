import { blob, canvas, loadImage } from "./image";
import type { Bi } from "./i18n";

/** Tripo accepts PNG/JPEG up to 20 MB: other formats are converted and the long side kept ≤ 2048 px. */
export async function productPhoto(file: Blob) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const k = Math.min(1, 2048 / Math.max(img.width, img.height));
    if (k === 1 && ["image/png", "image/jpeg"].includes(file.type) && file.size < 9 * 1024 * 1024) return file;
    const c = canvas(Math.round(img.width * k), Math.round(img.height * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await blob(c);
  } finally {
    URL.revokeObjectURL(src);
  }
}

export type Backdrop = "white" | "clean" | "busy";
/** How plain the photo's border is: a white or single-colour backdrop models much better. */
export async function backdrop(file: Blob): Promise<Backdrop> {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const c = canvas(96, 96), ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 96, 96);
    const d = ctx.getImageData(0, 0, 96, 96).data;
    const lum: number[] = [];
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if (x < 6 || y < 6 || x >= 90 || y >= 90) {
          const i = (y * 96 + x) * 4;
          // Transparent pixels count as a clean white backdrop.
          lum.push(d[i + 3] < 30 ? 255 : d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        }
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
    return mean > 215 && sd < 14 ? "white" : sd < 22 ? "clean" : "busy";
  } finally {
    URL.revokeObjectURL(src);
  }
}
export const backdropNote: Record<Backdrop, Bi> = {
  white: { zh: "白底，很适合生成", en: "White backdrop, ideal" },
  clean: { zh: "背景干净，可以生成", en: "Clean backdrop, good to go" },
  busy: { zh: "背景有点杂，换成白底或纯色背景效果更好", en: "Busy backdrop; a white or plain one works better" },
};

export const PHOTO_TIPS: Bi[] = [
  { zh: "白底或纯色背景", en: "White or plain backdrop" },
  { zh: "拍到家具全貌", en: "The whole piece in frame" },
  { zh: "没有遮挡和杂物", en: "Nothing in front of it" },
  { zh: "正面略带一点侧角", en: "From the front, slightly to one side" },
];
