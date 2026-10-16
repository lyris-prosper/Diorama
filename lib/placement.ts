// Where a piece of furniture lands when it is placed or dragged.
//
// The room itself is a Gaussian-splat scan: its desk, wardrobe and bed are not meshes, so a ray
// cast for placement passes straight through them. A coarse occupancy grid built once from the
// scan's splat centres lets the ray stop at the scan's surfaces: a surface with free space above
// it is a top (floor, desk top, windowsill); one with more scan above it is the side of something.
// Pointing at the side of furniture puts the piece on top of it; pointing at a wall leaves it where
// it was. A piece is never put where the scan or another piece would hide it.
import * as THREE from "three";
import type { Erasure } from "./types";

/** Splat centres of a .spz in the room's y-up frame (see readSpzPoints in lib/align-clean.ts). */
export type ScanPoints = { xyz: Float32Array; alpha: Uint8Array; count: number };

export type RoomGrid = {
  cell: number;
  bin: number;
  x0: number;
  z0: number;
  y0: number;
  nx: number;
  nz: number;
  ny: number;
  /** Splat centres per cell (saturating). */
  raw: Uint8Array;
  /** 1 where a surface of the scan passes: enough centres in the 3×3×3 neighbourhood. */
  occ: Uint8Array;
  floorY: number;
};

const CELL = 0.05;
const BIN = 0.025;
/** Centres in a 3×3×3 neighbourhood needed to count as a surface rather than a stray splat. */
const SURFACE = 6;
/** Opacity byte below which a splat is too faint to matter. */
const OPAQUE = 100;
/** Within this of the floor, a surface is the floor itself. */
const FLOOR_BAND = 0.08;
/** A side taller than this is a wall: nothing can stand on top of it. */
const MAX_SIDE = 1.3;

/**
 * Builds the occupancy grid of the room scan in metres. `scale` and `offset` are the room's
 * (project.room), the grid covers `half` metres around the camera and up to the ceiling.
 */
export function buildRoomGrid(
  points: ScanPoints,
  o: { scale: number; offset: number; floorY: number; half: number; ceilingY?: number | null },
): RoomGrid {
  const half = Math.max(1, o.half);
  const y0 = o.floorY - 0.1;
  const top = Math.min(o.floorY + 2.7, (o.ceilingY ?? Infinity) - 0.04);
  const nx = Math.ceil((2 * half) / CELL),
    nz = nx,
    ny = Math.max(8, Math.ceil((top - y0) / BIN));
  const raw = new Uint8Array(nx * nz * ny);
  const { xyz, alpha } = points,
    s = o.scale;
  for (let i = 0; i < points.count; i++) {
    if (alpha[i] <= OPAQUE) continue;
    const ix = Math.floor((xyz[i * 3] * s + half) / CELL),
      iz = Math.floor((xyz[i * 3 + 2] * s + half) / CELL),
      iy = Math.floor(((xyz[i * 3 + 1] + o.offset) * s - y0) / BIN);
    if (ix < 0 || iz < 0 || iy < 0 || ix >= nx || iz >= nz || iy >= ny) continue;
    const k = (iz * nx + ix) * ny + iy;
    if (raw[k] < 255) raw[k]++;
  }
  // 3×3×3 box sum, one axis at a time.
  const a = new Uint16Array(raw.length),
    b = new Uint16Array(raw.length);
  for (let c = 0; c < nx * nz; c++)
    for (let y = 0, base = c * ny; y < ny; y++)
      a[base + y] = raw[base + y] + (y > 0 ? raw[base + y - 1] : 0) + (y < ny - 1 ? raw[base + y + 1] : 0);
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      for (let y = 0, k = (z * nx + x) * ny; y < ny; y++, k++)
        b[k] = a[k] + (x > 0 ? a[k - ny] : 0) + (x < nx - 1 ? a[k + ny] : 0);
  const occ = new Uint8Array(raw.length),
    row = nx * ny;
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      for (let y = 0, k = (z * nx + x) * ny; y < ny; y++, k++)
        occ[k] = b[k] + (z > 0 ? b[k - row] : 0) + (z < nz - 1 ? b[k + row] : 0) >= SURFACE ? 1 : 0;
  return { cell: CELL, bin: BIN, x0: -half, z0: -half, y0, nx, nz, ny, raw, occ, floorY: o.floorY };
}

export type Ceiling = {
  /** Height of the main ceiling (world y), or null when the scan shows none. */
  level: number | null;
  /** The ceiling over x,z: the lowest flat layer there (a beam, a soffit), else the main one. */
  at(x: number, z: number): number;
};
const CEIL_CELL = 0.1;
/**
 * The ceiling of the room scan. Over the whole room it is the densest flat layer between 1.9 and
 * 4.5 m above the floor; locally the lowest layer at least half as dense as the densest one above
 * that spot, so a soffit or a beam lower than the ceiling is found where it is.
 * Without a ceiling in the scan, `at` answers floor + 2.7 m.
 */
export function buildCeiling(points: ScanPoints, o: { scale: number; offset: number; floorY: number; half: number }): Ceiling {
  const half = Math.max(1, o.half),
    y0 = o.floorY + 1.9,
    y1 = o.floorY + 4.5;
  const n = Math.ceil((2 * half) / CEIL_CELL),
    ny = Math.ceil((y1 - y0) / BIN);
  const cells = new Uint16Array(n * n * ny),
    whole = new Float64Array(ny);
  const { xyz, alpha } = points,
    s = o.scale;
  for (let i = 0; i < points.count; i++) {
    if (alpha[i] <= OPAQUE) continue;
    const y = (xyz[i * 3 + 1] + o.offset) * s;
    if (y < y0 || y >= y1) continue;
    const ix = Math.floor((xyz[i * 3] * s + half) / CEIL_CELL),
      iz = Math.floor((xyz[i * 3 + 2] * s + half) / CEIL_CELL),
      iy = Math.floor((y - y0) / BIN);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
    const k = (iz * n + ix) * ny + iy;
    if (cells[k] < 65535) cells[k]++;
    whole[iy]++;
  }
  // The main ceiling: a peak well above the walls' even spread over the heights.
  const sorted = [...whole].sort((a, b) => a - b),
    median = sorted[Math.floor(sorted.length / 2)];
  let peak = 0;
  for (let y = 1; y < ny; y++) if (whole[y] > whole[peak]) peak = y;
  const found = whole[peak] >= 50 && whole[peak] > 3 * Math.max(1, median);
  const level = found ? y0 + (peak + 0.5) * BIN : null;
  const fallback = level ?? o.floorY + 2.7;
  const local = new Float32Array(n * n).fill(NaN);
  const column = new Float64Array(ny);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      column.fill(0);
      let total = 0;
      for (let z = Math.max(0, iz - 1); z <= Math.min(n - 1, iz + 1); z++)
        for (let x = Math.max(0, ix - 1); x <= Math.min(n - 1, ix + 1); x++)
          for (let y = 0, k = (z * n + x) * ny; y < ny; y++, k++) {
            column[y] += cells[k];
            total += cells[k];
          }
      if (total < 12) continue;
      let max = 0;
      for (let y = 0; y < ny; y++) max = Math.max(max, column[y]);
      // A flat layer stands out from what runs up and down through the column (a wall's face).
      if (max < 12 || max < (3 * total) / ny) continue;
      for (let y = 0; y < ny; y++)
        if (column[y] >= max / 2 && (y === 0 || column[y] >= column[y - 1]) && (y === ny - 1 || column[y] >= column[y + 1])) {
          local[iz * n + ix] = y0 + (y + 0.5) * BIN;
          break;
        }
    }
  return {
    level,
    at(x: number, z: number) {
      const ix = Math.floor((x + half) / CEIL_CELL),
        iz = Math.floor((z + half) / CEIL_CELL);
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) return fallback;
      const v = local[iz * n + ix];
      return Number.isNaN(v) ? fallback : v;
    },
  };
}

const WALL_BIN = 0.04;
const DEG = Math.PI / 180;
/**
 * The turn (radians, 0 to 90°) that squares a piece with the room's walls: turned by it (three.js
 * rotation.y), or by it plus any quarter turn, a piece's sides run along the walls. Splats 1.2–2 m
 * above the floor (over beds and desks, under the ceiling) are projected onto a piece's axes at each
 * candidate turn; walls are straight, so the right turn gives the sharpest histograms. Null when no
 * turn stands out (a scan without clear walls).
 */
export function wallHeading(points: ScanPoints, o: { scale: number; offset: number; floorY: number; half: number }): number | null {
  const s = o.scale,
    lo = o.floorY + 1.2,
    hi = o.floorY + 2,
    lim = Math.max(1, o.half);
  const xs: number[] = [],
    zs: number[] = [];
  const { xyz, alpha } = points;
  for (let i = 0; i < points.count; i++) {
    if (alpha[i] <= OPAQUE) continue;
    const y = (xyz[i * 3 + 1] + o.offset) * s;
    if (y < lo || y > hi) continue;
    const x = xyz[i * 3] * s,
      z = xyz[i * 3 + 2] * s;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    xs.push(x);
    zs.push(z);
  }
  if (xs.length < 500) return null;
  const n = Math.ceil((2 * lim * Math.SQRT2) / WALL_BIN) + 2,
    mid = n / 2;
  const hx = new Float64Array(n),
    hz = new Float64Array(n);
  const sharpness = (deg: number) => {
    const c = Math.cos(deg * DEG),
      sn = Math.sin(deg * DEG);
    hx.fill(0);
    hz.fill(0);
    // A piece turned by t has its x axis along (cos t, −sin t) and its z axis along (sin t, cos t).
    for (let i = 0; i < xs.length; i++) {
      hx[Math.floor((xs[i] * c - zs[i] * sn) / WALL_BIN + mid)]++;
      hz[Math.floor((xs[i] * sn + zs[i] * c) / WALL_BIN + mid)]++;
    }
    let sum = 0;
    for (let k = 0; k < n; k++) sum += hx[k] * hx[k] + hz[k] * hz[k];
    return sum;
  };
  let best = 0,
    top = -1,
    total = 0;
  for (let d = 0; d < 90; d += 0.5) {
    const v = sharpness(d);
    total += v;
    if (v > top) [top, best] = [v, d];
  }
  if (top < 1.25 * (total / 180)) return null;
  for (let d = best - 0.4; d <= best + 0.4 + 1e-9; d += 0.1) {
    const v = sharpness(d);
    if (v > top) [top, best] = [v, d];
  }
  return (((best % 90) + 90) % 90) * DEG;
}

/** An erased box, ready for point tests: its contents are hidden from the scan. */
export type EraseBox = { cx: number; cz: number; cos: number; sin: number; hx: number; hz: number; top: number; bottom: number };
/**
 * The boxes as the room shows them (Scene's syncErasures): with an empty-room layer they reach
 * `below` metres under the floor, where the layer's own floor shows instead.
 */
export function eraseBoxes(list: Erasure[], floorY: number, below: number): EraseBox[] {
  return list.map((e) => ({
    cx: e.center[0],
    cz: e.center[2],
    cos: Math.cos(e.rotation),
    sin: Math.sin(e.rotation),
    // The edge fades over a few centimetres; a little margin keeps that seam out too.
    hx: e.size[0] / 2 + 0.03,
    hz: e.size[2] / 2 + 0.03,
    top: e.center[1] + e.size[1] / 2 + 0.03,
    bottom: Math.min(e.center[1] - e.size[1] / 2, floorY - below),
  }));
}
export function erased(x: number, y: number, z: number, boxes: EraseBox[]) {
  for (const b of boxes) {
    if (y > b.top || y < b.bottom) continue;
    const dx = x - b.cx,
      dz = z - b.cz;
    // World to box: the inverse of three.js rotation.y.
    if (Math.abs(dx * b.cos - dz * b.sin) <= b.hx && Math.abs(dx * b.sin + dz * b.cos) <= b.hz) return true;
  }
  return false;
}

const cellOf = (g: RoomGrid, x: number, z: number) => {
  const ix = Math.floor((x - g.x0) / g.cell),
    iz = Math.floor((z - g.z0) / g.cell);
  return ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz ? -1 : iz * g.nx + ix;
};
const binY = (g: RoomGrid, iy: number) => g.y0 + (iy + 0.5) * g.bin;
/** Splat centres in the 3×3 columns around `column`, at bin k. */
function rawNear(g: RoomGrid, column: number, k: number) {
  const cx = column % g.nx,
    cz = (column - cx) / g.nx;
  let n = 0;
  for (let z = Math.max(0, cz - 1); z <= Math.min(g.nz - 1, cz + 1); z++)
    for (let x = Math.max(0, cx - 1); x <= Math.min(g.nx - 1, cx + 1); x++) n += g.raw[(z * g.nx + x) * g.ny + k];
  return n;
}

/**
 * The top of the scan surface met at bin `iy` of a column: the surface itself when there is free
 * space above it, otherwise the top of the side it belongs to (a desk front leads to the desk top).
 * null when the side keeps rising like a wall.
 */
function topFrom(g: RoomGrid, column: number, iy: number, x: number, z: number, boxes: EraseBox[]) {
  const base = column * g.ny;
  let j = iy;
  while (j + 1 < g.ny && g.occ[base + j + 1] && !erased(x, binY(g, j + 1), z, boxes)) j++;
  if (j >= g.ny - 1 || (j - iy) * g.bin > MAX_SIDE) return null;
  // Occupancy is padded by one bin, and a ray from above enters it in the padding: the surface is
  // the highest bin with centres around it, looked for down to two bins under the one met.
  for (let k = j; k >= Math.max(0, iy - 2); k--) if (rawNear(g, column, k) >= 2) return binY(g, k);
  return binY(g, Math.max(iy, j - 1));
}

/**
 * Whether the scan holds a top at bin k around x,z: free above, and wide enough just past the
 * point that was hit. A wall whose scan thins out near the ceiling has a ragged upper edge, but
 * nothing beyond it; a desk top continues behind its front edge.
 */
function flatTop(g: RoomGrid, x: number, z: number, along: THREE.Vector3, k: number) {
  const cx = x + along.x * 0.08,
    cz = z + along.z * 0.08;
  let n = 0;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      const column = cellOf(g, cx + dx * g.cell, cz + dz * g.cell);
      if (column < 0) continue;
      const o = g.occ,
        base = column * g.ny;
      const here = o[base + k] || (k > 0 && o[base + k - 1]) || (k + 1 < g.ny && o[base + k + 1]);
      // Soft tops (a duvet) undulate by a few centimetres: free space is looked for 10–12 cm up.
      const above = (k + 4 < g.ny && o[base + k + 4]) || (k + 5 < g.ny && o[base + k + 5]);
      if (here && !above) n++;
    }
  return n >= 8;
}

export type RoomHit = { t: number; point: THREE.Vector3; kind: "top" | "floor" | "blocked" };
/**
 * Marches a ray through the room scan. The first surface decides: a top (floor included, snapped
 * to the floor height), the top of whatever side was hit, or blocked by a wall. Erased boxes are
 * see-through. null when the ray leaves the room without meeting anything.
 */
export function castRoom(g: RoomGrid, origin: THREE.Vector3, dir: THREE.Vector3, boxes: EraseBox[], maxT = 16): RoomHit | null {
  const step = g.cell * 0.4;
  for (let t = 0.15; t < maxT; t += step) {
    const x = origin.x + dir.x * t,
      y = origin.y + dir.y * t,
      z = origin.z + dir.z * t;
    if (y < g.floorY - FLOOR_BAND) {
      // Through the floor without meeting the scan: where the ray crosses the floor plane.
      const tf = dir.y < 0 ? (g.floorY - origin.y) / dir.y : t;
      const p = origin.clone().addScaledVector(dir, tf);
      p.y = g.floorY;
      return cellOf(g, p.x, p.z) < 0 ? null : { t: tf, point: p, kind: "floor" };
    }
    const column = cellOf(g, x, z);
    if (column < 0) {
      // Outside the grid and heading further out: nothing more to meet.
      if ((x - g.x0 < 0 && dir.x < 0) || (x > g.x0 + g.nx * g.cell && dir.x > 0) || (z - g.z0 < 0 && dir.z < 0) || (z > g.z0 + g.nz * g.cell && dir.z > 0)) return null;
      continue;
    }
    const iy = Math.floor((y - g.y0) / g.bin);
    if (iy < 0 || iy >= g.ny || !g.occ[column * g.ny + iy] || erased(x, y, z, boxes)) continue;
    const point = new THREE.Vector3(x, y, z);
    if (y - g.floorY < FLOOR_BAND) return { t, point: point.setY(g.floorY), kind: "floor" };
    const top = topFrom(g, column, iy, x, z, boxes);
    if (top !== null && Math.abs(top - g.floorY) < FLOOR_BAND) return { t, point: point.setY(g.floorY), kind: "floor" };
    const along = new THREE.Vector3(dir.x, 0, dir.z);
    if (along.lengthSq() > 1e-8) along.normalize();
    // From a side, only a top below eye level: one the viewer could see and reach (a desk, not a wardrobe).
    const side = top !== null && top - y > 2 * g.bin;
    if (top === null || (side && top > origin.y - 0.05) || !flatTop(g, x, z, along, Math.floor((top - g.y0) / g.bin)))
      return { t, point, kind: "blocked" };
    return { t, point: point.setY(top), kind: "top" };
  }
  return null;
}

/** Height of the scan surface (or the floor) at x,z, at or below `y`. */
export function roomBelow(g: RoomGrid, x: number, z: number, y: number, boxes: EraseBox[]) {
  const column = cellOf(g, x, z);
  if (column < 0) return g.floorY;
  const base = column * g.ny;
  for (let k = Math.min(g.ny - 1, Math.floor((y - g.y0) / g.bin)); k >= 0; k--) {
    const at = binY(g, k);
    if (at - g.floorY < FLOOR_BAND) return g.floorY;
    if (!g.occ[base + k] || erased(x, at, z, boxes)) continue;
    // The top of the surface met, refined as castRoom refines it, so both agree on its height.
    for (let r = k; r >= Math.max(0, k - 2); r--)
      if (rawNear(g, column, r) >= 2) return binY(g, r) - g.floorY < FLOOR_BAND ? g.floorY : binY(g, r);
    return at;
  }
  return g.floorY;
}

// ———————————————————————————————————————— free places (“帮我布置” in any room)

/** Per grid column: the surface height above the floor (under 2 m), and whether it is wall-like. */
export type HeightMap = { g: RoomGrid; h: Float32Array; wall: Uint8Array };
/** The room scan seen from above, for finding free places; about 30 ms for a 10 m grid. */
export function heightMap(g: RoomGrid, boxes: EraseBox[]): HeightMap {
  const h = new Float32Array(g.nx * g.nz),
    wall = new Uint8Array(g.nx * g.nz);
  const bins = [1.15, 1.35, 1.55].map((y) => Math.floor((g.floorY + y - g.y0) / g.bin)).filter((k) => k < g.ny);
  for (let iz = 0; iz < g.nz; iz++)
    for (let ix = 0; ix < g.nx; ix++) {
      const c = iz * g.nx + ix,
        x = g.x0 + (ix + 0.5) * g.cell,
        z = g.z0 + (iz + 0.5) * g.cell;
      h[c] = roomBelow(g, x, z, g.floorY + 2, boxes) - g.floorY;
      let n = 0;
      for (const k of bins) if (g.occ[c * g.ny + k] && !erased(x, binY(g, k), z, boxes)) n++;
      wall[c] = n >= 2 ? 1 : 0;
    }
  return { g, h, wall };
}
export type SpotQuery = {
  zone: "floor" | "top" | "wall";
  /** The piece's width, depth and height in metres. */
  size: [number, number, number];
  /** The walls' turn (wallHeading), or null. */
  heading: number | null;
  /** Where the viewer stands and looks (x, z and a horizontal direction). */
  eye: { x: number; z: number; fx: number; fz: number };
  /** Places already given out: centre and radius. */
  taken: { x: number; z: number; r: number }[];
};
/**
 * A free place for a piece where the viewer can see it: on free floor with its back to a wall, on a
 * flat top 0.4–0.95 m high, or on a wall facing the viewer, 1.45 m up at its middle. Turned square
 * with the walls, its front (+z) towards the room. null when nothing fits.
 */
export function autoSpot(m: HeightMap, q: SpotQuery): { position: [number, number, number]; rotation: number } | null {
  const { g } = m,
    [w, d, ht] = q.size;
  const col = (x: number, z: number) => cellOf(g, x, z);
  const heightAt = (x: number, z: number) => {
    const c = col(x, z);
    return c < 0 ? Infinity : m.h[c];
  };
  const wallAt = (x: number, z: number) => {
    const c = col(x, z);
    return c < 0 || m.wall[c] === 1 || m.h[c] > 1.6;
  };
  const base = q.heading ?? 0,
    flen = Math.hypot(q.eye.fx, q.eye.fz) || 1,
    fx = q.eye.fx / flen,
    fz = q.eye.fz / flen;
  let best: { score: number; x: number; z: number; y: number; t: number } | null = null;
  for (let iz = 0; iz < g.nz; iz += 2)
    for (let ix = 0; ix < g.nx; ix += 2) {
      const x = g.x0 + (ix + 0.5) * g.cell,
        z = g.z0 + (iz + 0.5) * g.cell;
      const vx = x - q.eye.x,
        vz = z - q.eye.z,
        dist = Math.hypot(vx, vz);
      if (dist < 1.4 || dist > 5) continue;
      const seen = (vx * fx + vz * fz) / dist;
      if (seen < Math.cos(40 * DEG)) continue;
      if (q.taken.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + Math.max(w, d) / 2)) continue;
      for (let k = 0; k < 4; k++) {
        const t = base + (k * Math.PI) / 2;
        // A piece turned by t: its x axis along (cos t, −sin t), its front (z) along (sin t, cos t).
        const ax = Math.cos(t),
          az = -Math.sin(t),
          bx = Math.sin(t),
          bz = Math.cos(t);
        const toEye = (-vx * bx - vz * bz) / dist;
        // Sample the footprint every 10 cm.
        const under: number[] = [];
        for (let a = -w / 2; a <= w / 2 + 1e-6; a += Math.min(0.1, w / 2 || 0.1))
          for (let b = -d / 2; b <= d / 2 + 1e-6; b += Math.min(0.1, d / 2 || 0.1)) under.push(heightAt(x + ax * a + bx * b, z + az * a + bz * b));
        // A wall behind, within 35 cm of the back edge.
        let back: number | null = null;
        for (let s = 0; s <= 0.35; s += 0.05)
          if (wallAt(x - bx * (d / 2 + s), z - bz * (d / 2 + s))) {
            back = s;
            break;
          }
        let score: number, y: number;
        if (q.zone === "floor") {
          if (under.some((v) => v > 0.04) || wallAt(x, z)) continue;
          score = (back !== null ? 1.6 - back * 3 : 0) + toEye * 0.6 + seen * 0.4 - Math.abs(dist - 2.8) * 0.15;
          y = g.floorY;
        } else if (q.zone === "top") {
          const h0 = heightAt(x, z);
          if (h0 < 0.38 || h0 > 0.95 || under.some((v) => Math.abs(v - h0) > 0.04)) continue;
          score = toEye * 0.8 + seen * 0.6 - Math.abs(h0 - 0.75) * 0.5 - Math.abs(dist - 2.5) * 0.1;
          y = g.floorY + h0;
        } else {
          // On a wall: the wall right behind across the piece's width, free in front at hanging height,
          // and nothing beyond it (a curtain hangs in front of a wall; a wall is the room's edge).
          if (back === null || back > 0.1 || toEye < 0.3 || heightAt(x, z) > 1.2) continue;
          const bx2 = x - bx * (d / 2 + back + 0.25),
            bz2 = z - bz * (d / 2 + back + 0.25),
            beyond = col(bx2, bz2);
          if (beyond >= 0 && (m.wall[beyond] === 1 || m.h[beyond] > 0.05)) continue;
          let along = 0;
          for (let a = -w / 2; a <= w / 2 + 1e-6; a += Math.min(0.1, w / 2 || 0.1)) if (wallAt(x + ax * a - bx * (d / 2 + 0.12), z + az * a - bz * (d / 2 + 0.12))) along++;
          if (along < Math.max(2, Math.round(w / 0.1) * 0.8)) continue;
          score = toEye + seen * 0.5 - Math.abs(dist - 3) * 0.1;
          y = g.floorY + 1.45 - ht / 2;
        }
        if (!best || score > best.score) best = { score, x, z, y, t };
      }
    }
  return best && { position: [best.x, best.y, best.z], rotation: best.t };
}

// ———————————————————————————————————————— placed furniture (meshes)

const _n = new THREE.Vector3(),
  _m = new THREE.Matrix3(),
  _down = new THREE.Vector3(0, -1, 0),
  _box = new THREE.Box3();

export type PieceHit = { t: number; point: THREE.Vector3; root: THREE.Object3D; up: boolean };
/** The piece a ray meets first; `up` when it meets a face that looks upward (a top to stand on). */
export function hitPieces(ray: THREE.Raycaster, roots: THREE.Object3D[]): PieceHit | null {
  const hit = ray.intersectObjects(roots, true)[0];
  if (!hit?.face) return null;
  let root: THREE.Object3D = hit.object;
  while (root.parent && !root.userData.itemId) root = root.parent;
  _n.copy(hit.face.normal).applyMatrix3(_m.getNormalMatrix(hit.object.matrixWorld)).normalize();
  // Faces are drawn from both sides: take the side that faces the viewer.
  if (_n.dot(ray.ray.direction) > 0) _n.negate();
  return { t: hit.distance, point: hit.point.clone(), root, up: _n.y >= 0.6 };
}

/** The top of one piece at x,z: a ray straight down from just above it. */
export function topOfPiece(root: THREE.Object3D, x: number, z: number): THREE.Vector3 | null {
  _box.setFromObject(root);
  if (_box.isEmpty()) return null;
  const probe = new THREE.Raycaster(new THREE.Vector3(x, _box.max.y + 0.05, z), _down, 0, _box.max.y - _box.min.y + 0.1);
  return probe.intersectObject(root, true)[0]?.point.clone() ?? null;
}

/**
 * Where a piece lands when the ray meets another piece: on the face when it looks upward; on the
 * side of furniture, on top of that furniture (a few centimetres in from the side that was hit).
 */
export function landOnPiece(hit: PieceHit, dir: THREE.Vector3): THREE.Vector3 | null {
  if (hit.up) return hit.point;
  const inward = new THREE.Vector3(dir.x, 0, dir.z);
  if (inward.lengthSq() > 1e-8) inward.normalize().multiplyScalar(0.04);
  return topOfPiece(hit.root, hit.point.x + inward.x, hit.point.z + inward.z) ?? topOfPiece(hit.root, hit.point.x, hit.point.z);
}

/** Height of the highest piece surface under x,z, at or below `y` (null when there is none). */
export function piecesBelow(roots: THREE.Object3D[], x: number, z: number, y: number): number | null {
  if (!roots.length) return null;
  const probe = new THREE.Raycaster(new THREE.Vector3(x, y, z), _down, 0, 50);
  return probe.intersectObjects(roots, true)[0]?.point.y ?? null;
}

/**
 * The pieces resting on `id`, and the ones resting on those (a mug on a tray on a desk). A piece
 * rests on another when a short ray straight down from its base meets it.
 */
export function ridersOf(id: string, pieces: Map<string, THREE.Object3D>): string[] {
  const found: string[] = [];
  const queue = [id];
  while (queue.length) {
    const support = pieces.get(queue.shift()!);
    if (!support?.visible) continue;
    for (const [other, o] of pieces) {
      if (other === id || found.includes(other) || !o.visible || o === support) continue;
      const probe = new THREE.Raycaster(o.position.clone().add(new THREE.Vector3(0, 0.02, 0)), _down, 0, 0.06);
      if (probe.intersectObject(support, true).length) {
        found.push(other);
        queue.push(other);
      }
    }
  }
  return found;
}
