// Floor-plan registration of an empty-room world to a room world. Both worlds put the camera at the
// origin; separate generations still differ in scale, a little in heading, and in position. Wall
// splats 1.2–2 m above the floor (above beds and desks) are rasterised as plans; for each candidate
// scale and heading a zero-padded FFT cross-correlation finds the best translation, and the scale
// and heading with the largest overlap win. A coarse pass (8 cm cells) is refined at 4 cm.
//
// Points are read straight from the .spz files rather than from the renderer, whose splat set can
// include generated level-of-detail splats that skew the statistics.
import { currentLang, pick } from "./i18n";

type Points = { xyz: Float32Array; alpha: Uint8Array; count: number };

/** Splat centres (already flipped into the room's y-up frame: x, −y, −z) and opacities of an .spz (v2+). */
export async function readSpzPoints(url: string): Promise<Points> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw Error(pick(currentLang())("房间文件读取失败。", "The room file could not be read."));
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x5053474e) throw Error(pick(currentLang())("房间文件格式无法识别。", "The room file format is not recognised."));
  const version = dv.getUint32(4, true), count = dv.getUint32(8, true), frac = dv.getUint8(13);
  if (version < 2) throw Error(pick(currentLang())("房间文件版本过旧。", "The room file is too old a version."));
  const bytes = new Uint8Array(buf), xyz = new Float32Array(count * 3), scale = 1 / (1 << frac);
  for (let i = 0, o = 16; i < count * 3; i++, o += 3) {
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    const c = i % 3;
    xyz[i] = c === 0 ? v * scale : -v * scale;
  }
  return { xyz, alpha: bytes.subarray(16 + count * 9, 16 + count * 10), count };
}

function fft(re: Float64Array, im: Float64Array, n: number, off: number, stride: number, inverse: boolean) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride, b = a + half * stride;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false) {
  for (let r = 0; r < n; r++) fft(re, im, n, r * n, 1, inverse);
  for (let c = 0; c < n; c++) fft(re, im, n, c, n, inverse);
}

type Grid = { n: number; cell: number; x0: number; z0: number };
/** Occupancy of the plan in the top-left quarter of an n×n grid (the rest is zero padding). */
function rasterise(xs: number[], zs: number[], g: Grid, blur: boolean) {
  const half = g.n >> 1, cnt = new Float64Array(g.n * g.n);
  for (let i = 0; i < xs.length; i++) {
    const x = Math.floor((xs[i] - g.x0) / g.cell), z = Math.floor((zs[i] - g.z0) / g.cell);
    if (x >= 0 && x < half && z >= 0 && z < half) cnt[z * g.n + x]++;
  }
  for (let i = 0; i < cnt.length; i++) cnt[i] = cnt[i] > 2 ? 1 : 0;
  if (!blur) return cnt;
  const out = new Float64Array(cnt.length);
  for (let z = 1; z < half - 1; z++)
    for (let x = 1; x < half - 1; x++) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += cnt[(z + dz) * g.n + x + dx];
      out[z * g.n + x] = s / 9;
    }
  return out;
}

export type CleanFit = { scale: number; yaw: number; shift: [number, number, number] };

/**
 * Align the empty room (clean) to the room (main). `mainScale` converts the room to metres and
 * `mainFloor` is its floor height (camera at height 0). Returns the empty room's scale, heading
 * (radians about the camera) and world shift.
 */
export async function alignClean(main: Points, clean: Points, mainScale: number, mainFloor: number): Promise<CleanFit | null> {
  // Empty room floor (its own units): the densest horizontal layer below the camera.
  const hist = new Uint32Array(580);
  for (let i = 0; i < clean.count; i++) {
    const y = clean.xyz[i * 3 + 1];
    if (clean.alpha[i] > 100 && y < -0.2 && y > -6) hist[Math.floor((y + 6) / 0.01)]++;
  }
  let fb = 0;
  for (let k = 1; k < hist.length; k++) if (hist[k] > hist[fb]) fb = k;
  const floorUnits = fb * 0.01 - 6 + 0.005;
  if (floorUnits > -0.05) return null;

  const mx: number[] = [], mz: number[] = [];
  for (let i = 0; i < main.count; i++) {
    const y = main.xyz[i * 3 + 1] * mainScale;
    if (main.alpha[i] > 100 && y > mainFloor + 1.2 && y < mainFloor + 2) {
      mx.push(main.xyz[i * 3] * mainScale);
      mz.push(main.xyz[i * 3 + 2] * mainScale);
    }
  }
  if (mx.length < 500) return null;
  // Plan window: the room's wall extent plus a margin, so both plans fit the unpadded quarter.
  const cx = (Math.min(...mx) + Math.max(...mx)) / 2, cz = (Math.min(...mz) + Math.max(...mz)) / 2;
  const cleanBand: number[] = [];
  for (let i = 0; i < clean.count; i++) if (clean.alpha[i] > 100) cleanBand.push(clean.xyz[i * 3], clean.xyz[i * 3 + 1], clean.xyz[i * 3 + 2]);

  // Same viewpoint, so the camera stands about as high above both floors: the scale stays near
  // this ratio (separate generations still differ by a few per cent).
  const k0 = mainFloor / floorUnits;
  const search = async (g: Grid, scales: number[], yaws: number[]) => {
    const m = rasterise(mx, mz, g, true), mIm = new Float64Array(m.length);
    fft2(m, mIm, g.n);
    const re = new Float64Array(g.n * g.n), im = new Float64Array(g.n * g.n);
    const found: { score: number; scale: number; yaw: number; dx: number; dz: number }[] = [];
    for (const scale of scales) {
      const dy = mainFloor - floorUnits * scale;
      for (const yaw of yaws) {
        const c = Math.cos(yaw), s = Math.sin(yaw), xs: number[] = [], zs: number[] = [];
        for (let i = 0; i < cleanBand.length; i += 3) {
          const y = cleanBand[i + 1] * scale + dy;
          if (y < mainFloor + 1.2 || y > mainFloor + 2) continue;
          const x = cleanBand[i] * scale, z = cleanBand[i + 2] * scale;
          xs.push(x * c + z * s);
          zs.push(-x * s + z * c);
        }
        const occ = rasterise(xs, zs, g, false);
        let total = 0;
        for (let i = 0; i < occ.length; i++) { re[i] = occ[i]; im[i] = 0; total += occ[i]; }
        if (total < 50) continue;
        fft2(re, im, g.n);
        for (let i = 0; i < re.length; i++) {
          const r = m[i] * re[i] + mIm[i] * im[i], j = mIm[i] * re[i] - m[i] * im[i];
          re[i] = r; im[i] = j;
        }
        fft2(re, im, g.n, true);
        let peak = 0;
        for (let i = 1; i < re.length; i++) if (re[i] > re[peak]) peak = i;
        const tz = Math.floor(peak / g.n), tx = peak % g.n, h = g.n >> 1;
        found.push({ score: re[peak] / total, scale, yaw, dx: (tx < h ? tx : tx - g.n) * g.cell, dz: (tz < h ? tz : tz - g.n) * g.cell });
      }
      await new Promise((r) => setTimeout(r)); // keep the page responsive
    }
    return found.sort((a, b) => b.score - a.score);
  };
  const range = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let v = from; v <= to + 1e-9; v += step) out.push(v);
    return out;
  };
  const deg = Math.PI / 180;
  const ranked = await search({ n: 256, cell: 0.08, x0: cx - 5.12, z0: cz - 5.12 }, range(k0 * 0.9, k0 * 1.15, k0 * 0.0125), range(-6 * deg, 6 * deg, 1.5 * deg));
  // Rooms of different depth can match two ways (back wall or far wall) with similar coarse
  // scores; keep up to three candidates more than 0.5 m apart and let the fine pass decide.
  const candidates: typeof ranked = [];
  for (const r of ranked)
    if (candidates.length < 3 && candidates.every((c) => Math.hypot(c.dx - r.dx, c.dz - r.dz) > 0.5)) candidates.push(r);
  if (!candidates.length) return null;

  // Fine pass at 4 cm: the translation is already known to within a coarse cell, so overlap is
  // scored directly over ±24 cm around it instead of with full-size FFTs.
  const n = 320, cell = 0.04, x0 = cx - 6.4, z0 = cz - 6.4;
  const plan = new Float64Array(n * n);
  {
    const occ = new Uint8Array(n * n);
    for (let i = 0; i < mx.length; i++) {
      const x = Math.floor((mx[i] - x0) / cell), z = Math.floor((mz[i] - z0) / cell);
      if (x >= 0 && x < n && z >= 0 && z < n) occ[z * n + x] = Math.min(255, occ[z * n + x] + 1);
    }
    for (let z = 1; z < n - 1; z++)
      for (let x = 1; x < n - 1; x++) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) sum += occ[(z + dz) * n + x + dx] > 2 ? 1 : 0;
        plan[z * n + x] = sum / 9;
      }
  }
  let fine = { ...candidates[0], score: -1 };
  for (const coarse of candidates)
  for (const scale of range(coarse.scale * 0.97, coarse.scale * 1.03, coarse.scale * 0.0075)) {
    const dy = mainFloor - floorUnits * scale;
    for (const yaw of range(coarse.yaw - 2 * deg, coarse.yaw + 2 * deg, 0.5 * deg)) {
      const c = Math.cos(yaw), sn = Math.sin(yaw), cells = new Set<number>();
      for (let i = 0; i < cleanBand.length; i += 3) {
        const y = cleanBand[i + 1] * scale + dy;
        if (y < mainFloor + 1.2 || y > mainFloor + 2) continue;
        const x = cleanBand[i] * scale, z = cleanBand[i + 2] * scale;
        const gx = Math.floor((x * c + z * sn + coarse.dx - x0) / cell), gz = Math.floor((-x * sn + z * c + coarse.dz - z0) / cell);
        if (gx >= 6 && gx < n - 6 && gz >= 6 && gz < n - 6) cells.add(gz * n + gx);
      }
      if (cells.size < 50) continue;
      for (let oz = -6; oz <= 6; oz++)
        for (let ox = -6; ox <= 6; ox++) {
          let sum = 0;
          for (const k of cells) sum += plan[k + oz * n + ox];
          const score = sum / cells.size;
          if (score > fine.score) fine = { score, scale, yaw, dx: coarse.dx + ox * cell, dz: coarse.dz + oz * cell };
        }
    }
    await new Promise((r) => setTimeout(r));
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { scale: r3(fine.scale), yaw: Math.round(fine.yaw * 10000) / 10000, shift: [r3(fine.dx), r3(mainFloor - floorUnits * fine.scale), r3(fine.dz)] };
}
