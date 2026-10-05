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
