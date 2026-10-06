// The erase box fitted to a piece of furniture in the room scan, from one click on it.
//
// The scan is a cloud of splat centres. Around the clicked point they are binned into 4 cm voxels
// above the floor and below the ceiling; stray splats are dropped. Walls, curtains and anything else
// that runs from mid-height up to the ceiling are "structure" and never part of a piece. From the
// voxel under the click, the piece is grown through touching voxels; its footprint gives the
// smallest rectangle around it (rotating calipers over the convex hull), its highest voxel the height.
import type { ScanPoints } from "./placement";

export type FittedBox = {
  /** Centre of the box, standing on the floor (metres, world). */
  center: [number, number, number];
  /** Width (along the box's x), height, depth (along its z). */
  size: [number, number, number];
  /** About y, as three.js rotation.y. */
  rotation: number;
  /** A guess from the size: bed, desk, cabinet, chair, sofa or other. */
  kind: string;
};

const VOX = 0.04;
/** How far from the click a piece may reach. */
const REACH = 2.4;
/** Splat opacity byte below which a centre is ignored (as in lib/placement.ts). */
const OPAQUE = 100;
/** Centres in a voxel's 3×3×3 neighbourhood for it to count as a surface. */
const SURFACE = 4;
/** Lowest centres above the floor that belong to furniture rather than to the floor's own blur. */
const ABOVE_FLOOR = 0.06;

type Pt = [number, number];
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [],
    upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Smallest-area rectangle around the points: its axis (unit vector), lengths and centre. */
export function minRectangle(points: Pt[]) {
  const h = hull(points);
  let best = { area: Infinity, ax: 1, az: 0, len: [0, 0] as [number, number], mid: [0, 0] as Pt };
  const edges = h.length > 1 ? h.length : 1;
  for (let i = 0; i < edges; i++) {
    const a = h[i],
      b = h[(i + 1) % h.length] ?? a;
    let ax = b[0] - a[0],
      az = b[1] - a[1];
    const l = Math.hypot(ax, az);
    if (l < 1e-9) {
      ax = 1;
      az = 0;
    } else {
      ax /= l;
      az /= l;
    }
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const [x, z] of h) {
      const u = x * ax + z * az,
        v = -x * az + z * ax;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area - 1e-9) {
      const um = (u0 + u1) / 2,
        vm = (v0 + v1) / 2;
      best = { area, ax, az, len: [u1 - u0, v1 - v0], mid: [um * ax - vm * az, um * az + vm * ax] };
    }
  }
  return best;
}

export function guessKind(w: number, d: number, h: number) {
  const long = Math.max(w, d),
    short = Math.min(w, d);
  if (h >= 1.4) return "cabinet";
  // Wider than a sofa is deep, or long and low: a bed (its headboard may stand up to ~1.3 m).
  if (long >= 1.8 && h <= 1.3 && (short >= 1.1 || (short >= 0.85 && h <= 0.7))) return "bed";
  if (long >= 1.4 && short >= 0.7 && h <= 1.1) return "sofa";
  if (long <= 0.75 && h >= 0.6 && h <= 1.25) return "chair";
  if (long >= 0.7 && short <= 0.95 && h >= 0.6 && h <= 1) return "desk";
  return "other";
}

/**
 * The box around the piece of furniture at `click` (a point on its surface, world metres), or null
 * when the click is on a wall, a curtain or nothing solid. `forward` (camera direction on the floor)
 * makes the box's width the side facing the viewer, as furniture is measured.
 */
export function fitBox(
  points: ScanPoints,
  o: { scale: number; offset: number; floorY: number; ceilingY?: number | null },
  click: [number, number, number],
  forward: [number, number] = [0, -1],
): FittedBox | null {
  const s = o.scale,
    bottom = o.floorY + ABOVE_FLOOR,
    ceiling = o.ceilingY ?? o.floorY + 2.7,
    top = ceiling - 0.06;
  if (top - bottom < 0.5) return null;
  const nx = Math.ceil((2 * REACH) / VOX),
    nz = nx,
    ny = Math.ceil((top - bottom) / VOX);
  const x0 = click[0] - REACH,
    z0 = click[2] - REACH;
  const raw = new Uint8Array(nx * nz * ny);
  const at = (ix: number, iz: number, iy: number) => (iz * nx + ix) * ny + iy;
  const { xyz, alpha } = points;
  for (let i = 0; i < points.count; i++) {
    if (alpha[i] <= OPAQUE) continue;
    const ix = Math.floor((xyz[i * 3] * s - x0) / VOX),
      iz = Math.floor((xyz[i * 3 + 2] * s - z0) / VOX),
      iy = Math.floor(((xyz[i * 3 + 1] + o.offset) * s - bottom) / VOX);
    if (ix < 0 || iz < 0 || iy < 0 || ix >= nx || iz >= nz || iy >= ny) continue;
    const k = at(ix, iz, iy);
    if (raw[k] < 255) raw[k]++;
  }
  // A voxel is solid with enough centres around it; a lone splat floating in the air is not.
  const solid = new Uint8Array(raw.length);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++) {
        if (!raw[at(ix, iz, iy)]) continue;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              const x = ix + dx,
                z = iz + dz,
                y = iy + dy;
              if (x >= 0 && z >= 0 && y >= 0 && x < nx && z < nz && y < ny) n += raw[at(x, z, y)];
            }
        if (n >= SURFACE) solid[at(ix, iz, iy)] = 1;
      }
  // Structure: a column solid both at mid-height and just under the ceiling (a wall, a curtain, a
  // built-in cupboard). Widened by one voxel so a piece is not grown along the wall it stands against.
  const band = (y0: number, y1: number) => [Math.max(0, Math.floor((y0 - bottom) / VOX)), Math.min(ny - 1, Math.floor((y1 - bottom) / VOX))];
  const [m0, m1] = band(o.floorY + 0.9, o.floorY + 1.5),
    [t0, t1] = band(top - 0.3, top);
  const tall = new Uint8Array(nx * nz);
  for (let c = 0; c < nx * nz; c++) {
    let mid = false,
      high = false;
    for (let y = m0; y <= m1 && !mid; y++) mid = solid[c * ny + y] === 1;
    for (let y = t0; y <= t1 && !high; y++) high = solid[c * ny + y] === 1;
    tall[c] = mid && high && m1 < t0 ? 1 : 0;
  }
  const structure = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      if (!tall[iz * nx + ix]) continue;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx,
            z = iz + dz;
          if (x >= 0 && z >= 0 && x < nx && z < nz) structure[z * nx + x] = 1;
        }
    }
  const free = (ix: number, iz: number, iy: number) => solid[at(ix, iz, iy)] === 1 && !structure[iz * nx + ix];
  // The voxel under the click, or the nearest solid one within 12 cm.
  const cx = Math.floor(REACH / VOX),
    cz = cx,
    cy = Math.floor((click[1] - bottom) / VOX);
  let seed = -1,
    bestD = Infinity;
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++) {
        const x = cx + dx,
          z = cz + dz,
          y = cy + dy;
        if (x < 0 || z < 0 || y < 0 || x >= nx || z >= nz || y >= ny || !free(x, z, y)) continue;
        const d = dx * dx + dz * dz + dy * dy;
        if (d < bestD) {
          bestD = d;
          seed = at(x, z, y);
        }
      }
  if (seed < 0) return null;
  // Grow through touching voxels.
  const seen = new Uint8Array(raw.length);
  const queue = new Int32Array(raw.length);
  let head = 0,
    tail = 0;
  queue[tail++] = seed;
  seen[seed] = 1;
  const reach2 = (REACH / VOX) ** 2;
  while (head < tail) {
    const k = queue[head++];
    const iy = k % ny,
      c = (k - iy) / ny,
      ix = c % nx,
      iz = (c - ix) / nx;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const x = ix + dx,
            z = iz + dz,
            y = iy + dy;
          if (x < 0 || z < 0 || y < 0 || x >= nx || z >= nz || y >= ny) continue;
          const n = at(x, z, y);
          if (seen[n] || !free(x, z, y) || (x - cx) ** 2 + (z - cz) ** 2 > reach2) continue;
          seen[n] = 1;
          queue[tail++] = n;
        }
  }
  if (tail < 12) return null;
  // Footprint: columns of the piece with at least two voxels (a single one is likely blur).
  const count = new Uint16Array(nx * nz);
  let high = 0;
  for (let i = 0; i < tail; i++) {
    const k = queue[i],
      iy = k % ny,
      c = (k - iy) / ny;
    count[c]++;
    high = Math.max(high, iy);
  }
  const foot: Pt[] = [];
  for (let c = 0; c < nx * nz; c++) {
    if (count[c] < 2) continue;
    const ix = c % nx,
      iz = (c - ix) / nx;
    const x = x0 + ix * VOX,
      z = z0 + iz * VOX;
    foot.push([x, z], [x + VOX, z], [x, z + VOX], [x + VOX, z + VOX]);
  }
  if (foot.length < 12) return null;
  const r = minRectangle(foot);
  // Width is the side facing the viewer: the axis more across the view.
  let [w, d] = r.len,
    ax = r.ax,
    az = r.az;
  const along = Math.abs(ax * forward[0] + az * forward[1]);
  if (along > Math.SQRT1_2) {
    [w, d] = [d, w];
    [ax, az] = [-az, ax];
  }
  // three.js rotation.y turns the box's x axis to (cos θ, -sin θ); keep θ within ±90°.
  let rotation = Math.atan2(-az, ax);
  if (rotation > Math.PI / 2) rotation -= Math.PI;
  if (rotation <= -Math.PI / 2) rotation += Math.PI;
  const h = bottom + (high + 1) * VOX - o.floorY;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    center: [round(r.mid[0]), round(o.floorY + h / 2), round(r.mid[1])],
    size: [round(w), round(h), round(d)],
    rotation: round(rotation),
    kind: guessKind(w, d, h),
  };
}
