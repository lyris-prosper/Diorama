"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CleanLayer, Erasure, Project } from "@/lib/types";
import { alignClean, readSpzPoints } from "@/lib/align-clean";
import { currentLang, pick } from "@/lib/i18n";
import { buildCeiling, buildRoomGrid, castRoom, eraseBoxes, hitPieces, landOnPiece, piecesBelow, ridersOf, roomBelow, topOfPiece, type RoomGrid } from "@/lib/placement";
import { fitBox, type FittedBox } from "@/lib/fit-box";
import { fitScale } from "@/lib/fit-model";
import { hangsFromCeiling } from "@/lib/furniture-kinds";
const asset = (key: string) =>
  key.startsWith("/") ? key : "/api/assets?key=" + encodeURIComponent(key);
// Library models are meshopt-compressed; generated ones load the same way.
const gltfLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function box(
  g: THREE.Group,
  size: number[],
  pos: number[],
  color: string,
  radius = 0,
) {
  const geo = new RoundedBoxGeometry(size[0],size[1],size[2],3, radius || Math.min(...size)*0.16);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.68 }),
  );
  m.position.set(...(pos as [number, number, number]));
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function demoModel(kind: string) {
  const g = new THREE.Group();
  const wood = "#c99f70",
    dark = "#a07650";
  if (kind === "bed") {
    box(g, [1.72, 0.19, 2.2], [0, 0.28, 0], wood);
    box(g, [1.66, 0.23, 2.08], [0, 0.49, 0], "#f4efe6");
    box(g, [1.69, 0.06, 1.42], [0, 0.64, 0.3], "#e8dccb");
    box(g, [1.8, 0.9, 0.1], [0, 0.48, -1.08], wood);
    for (const x of [-0.77, 0.77])
      for (const z of [-0.95, 0.95])
        box(g, [0.09, 0.22, 0.09], [x, 0.11, z], dark);
    for (const x of [-0.43, 0.43])
      box(g, [0.65, 0.12, 0.4], [x, 0.655, -0.69], "#f7f3e9");
  } else if (kind === "desk") {
    box(g, [1.45, 0.07, 0.67], [0, 0.73, 0], wood);
    box(g, [1.25, 0.19, 0.57], [0, 0.6, 0], wood);
    for (const x of [-0.64, 0.64])
      for (const z of [-0.25, 0.25])
        box(g, [0.055, 0.72, 0.055], [x, 0.36, z], dark);
    box(g, [0.13, 0.015, 0.025], [0.3, 0.61, 0.299], "#5c5147");
  } else {
    box(g, [1.1, 2.02, 0.55], [0, 1.09, 0], wood);
    for (const x of [-0.275, 0.275])
      box(
        g,
        [0.535, 1.96, 0.035],
        [x, 1.1, 0.294],
        x < 0 ? "#d2ab7d" : "#cba477",
      );
    for (const x of [-0.035, 0.035])
      box(g, [0.014, 0.21, 0.025], [x, 1.03, 0.33], "#534638");
    for (const x of [-0.45, 0.45])
      for (const z of [-0.2, 0.2])
        box(g, [0.07, 0.16, 0.07], [x, 0.08, z], dark);
  }
  return g;
}
function demoRoom() {
  const g = new THREE.Group();
  box(g, [5.8, 0.14, 5.2], [0, -0.08, 0], "#dcc199");
  box(g, [0.12, 2.9, 5.2], [-2.95, 1.4, 0], "#f3eee4");
  box(g, [5.8, 0.88, 0.12], [0, 0.38, -2.65], "#f3eee4");
  box(g, [5.8, 0.45, 0.12], [0, 2.69, -2.65], "#f3eee4");
  box(g, [1.1, 1.7, 0.12], [-2.35, 1.65, -2.65], "#f3eee4");
  box(g, [1.5, 1.7, 0.12], [2.15, 1.65, -2.65], "#f3eee4");
  box(g, [3.2, 1.65, 0.06], [-0.2, 1.66, -2.66], "#c9d9e4");
  for (const x of [-1.8, -0.2, 1.4])
    box(g, [0.045, 1.7, 0.1], [x, 1.66, -2.6], "#8c7563");
  box(g, [3.3, 0.06, 0.17], [-0.2, 0.82, -2.57], "#eae1d1");
  for (let x = -2.8; x < 2.9; x += 0.38) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.001, -2.6),
        new THREE.Vector3(x, 0.001, 2.6),
      ]),
      new THREE.LineBasicMaterial({
        color: "#b4966c",
        transparent: true,
        opacity: 0.25,
      }),
    );
    g.add(line);
  }
  return g;
}
const NO_SPOT = () => pick(currentLang())("这里放不下：对准地面，或桌面、床面这样的台面再放。", "Nothing can go there. Aim at the floor or at a top, like a desk or a bed.");
type Move = { id: string; position: [number, number, number] };
/** What the page can ask the 3D view about how pieces rest on each other. */
export type PlacementApi = {
  /** Pieces resting on this one, and the ones resting on those. */
  riders(id: string): string[];
  /** Height a piece would rest at under x,z, below fromY, with the `ignore` pieces taken away. */
  restAt(x: number, z: number, fromY: number, ignore: string[]): number;
  /** Before a piece is resized: what rests on it is seated on its new top once the new size shows. */
  carry(id: string): void;
  /** The erase box fitted to the room furniture at a clicked point (lib/fit-box.ts), or null. */
  fitAt(point: [number, number, number], forward: [number, number]): FittedBox | null;
  /** A piece's size as shown (metres, before its turn), and whether it keeps its photo's proportions. */
  sizeOf(id: string): { size: [number, number, number]; uniform: boolean } | null;
  /** The ceiling over x,z (world y); floor + 2.7 m where the scan shows none. */
  ceilingAt(x: number, z: number): number;
};
type Props = {
  project: Project;
  selected: string | null;
  pending: string | null;
  reset: number;
  focus: number;
  onSelect: (id: string | null) => void;
  /** A drag ended: the piece and what rests on it, at their new spots. */
  onMoveMany: (moves: Move[]) => void;
  onPlace: (id: string, pos: [number, number, number]) => void;
  /** Pieces re-seated after a resize; not a step of its own in the undo history. */
  onAdjust?: (moves: Move[]) => void;
  onEngine?: (api: PlacementApi | null) => void;
  /** A short message for the user, e.g. why a piece cannot go where it was dropped. */
  onHint?: (s: string) => void;
  onThumb: (id: string, url: string) => void;
  onError: (s: string) => void;
  onFloorDetected?: (fit: FloorFit | null) => void;
  floorEditing?: boolean;
  /** Clicks on the room offer to make the furniture there movable (the toolbar switch). */
  pickEnabled?: boolean;
  /** A click on the room itself (not the floor, not placed furniture): world point and screen position. */
  onRoomPick?: (point: [number, number, number], screen: { x: number; y: number }, forward: [number, number]) => void;
  /** The erase box being fitted; its contents are hidden live and it can be dragged along the floor. */
  eraseDraft?: Erasure | null;
  onDraftMove?: (center: [number, number, number]) => void;
  /** First automatic alignment of the empty-room layer to the room. */
  onCleanAligned?: (fit: Pick<CleanLayer, "scale" | "yaw" | "shift">) => void;
};
export type FloorFit = { height: number; size: number; ceiling: number | null };
// The collider mesh shares the splat's coordinates, with the camera (where the photo was taken)
// at the origin. Rays cast straight down around it find the floor: per ray the lowest surface
// within reach, then the median across rays, so a bed under one ray does not skew the result.
// Rays cast upward find the ceiling, which lets the page convert the room to real metres.
function detectFloor(collider: THREE.Object3D, eye: THREE.Vector3): FloorFit | null {
  const ray = new THREE.Raycaster();
  const sample = (dir: number) => {
    const found: number[] = [];
    for (const dx of [-0.6, 0, 0.6])
      for (const dz of [-0.6, 0, 0.6]) {
        ray.set(new THREE.Vector3(eye.x + dx, eye.y, eye.z + dz), new THREE.Vector3(0, dir, 0));
        ray.far = 8;
        const hits = ray.intersectObject(collider, true);
        if (hits.length) found.push(dir < 0 ? Math.min(...hits.map((h) => h.point.y)) : hits[0].point.y);
      }
    found.sort((a, b) => a - b);
    return found.length >= 3 ? found[Math.floor(found.length / 2)] : null;
  };
  const height = sample(-1);
  if (height === null) return null;
  const ceiling = sample(1);
  // Placement area: the footprint of floor-level surfaces around the camera. Extents are
  // area-weighted (0.5%–99.5%) because the mesh is denser near the camera; the page adds a margin.
  // Tolerance relative to camera height, so the result is the same whether or not the world
  // has already been converted to metres.
  const tolerance = Math.max(0.02, 0.06 * Math.abs(height - eye.y));
  const pts: [number, number, number][] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3();
  collider.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(e1.subVectors(c, a));
      const area = n.length() / 2;
      n.normalize();
      const y = (a.y + b.y + c.y) / 3;
      if (Math.abs(n.y) > 0.9 && Math.abs(y - height) < tolerance)
        pts.push([(a.x + b.x + c.x) / 3 - eye.x, (a.z + b.z + c.z) / 3 - eye.z, area]);
    }
  });
  const total = pts.reduce((sum, p) => sum + p[2], 0);
  const quantile = (axis: 0 | 1, q: number) => {
    let acc = 0;
    for (const p of [...pts].sort((x, y) => x[axis] - y[axis])) if ((acc += p[2]) >= total * q) return p[axis];
    return 0;
  };
  const reach = pts.length
    ? Math.max(-quantile(0, 0.005), quantile(0, 0.995), -quantile(1, 0.005), quantile(1, 0.995))
    : 3;
  return { height, size: reach * 2, ceiling };
}
// Fallback for worlds without a collider (e.g. imported from the Marble website): the floor and
// ceiling are the densest horizontal layers of splat centres below and above the camera.
type SplatVisitor = (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number) => void;
function detectFloorFromSplats(splat: THREE.Object3D & { forEachSplat?: (visit: SplatVisitor) => void; numSplats?: number }, eye: THREE.Vector3): FloorFit | null {
  if (typeof splat.forEachSplat !== "function") return null;
  splat.updateMatrixWorld(true);
  const m = splat.matrixWorld,
    v = new THREE.Vector3();
  const pts: number[] = [];
  splat.forEachSplat((_i: number, center: THREE.Vector3, _s: unknown, _q: unknown, opacity: number) => {
    if (opacity < 0.4) return;
    v.copy(center).applyMatrix4(m);
    const dx = v.x - eye.x,
      dz = v.z - eye.z;
    if (dx * dx + dz * dz < 64) pts.push(dx, v.y - eye.y, dz);
  });
  if (pts.length < 3000) return null;
  const bin = 0.02,
    span = 6,
    counts = new Uint32Array(Math.round((2 * span) / bin));
  for (let i = 1; i < pts.length; i += 3) {
    const k = Math.floor((pts[i] + span) / bin);
    if (k >= 0 && k < counts.length) counts[k]++;
  }
  const peak = (from: number, to: number) => {
    let best = -1;
    for (let k = Math.max(0, from); k < Math.min(counts.length, to); k++) if (best < 0 || counts[k] > counts[best]) best = k;
    return best < 0 || counts[best] < 200 ? null : (best + 0.5) * bin - span;
  };
  const centre = Math.round(span / bin);
  const floor = peak(0, centre - Math.round(0.3 / bin));
  if (floor === null) return null;
  const ceiling = peak(centre + Math.round(0.3 / bin), counts.length);
  const tolerance = Math.max(0.02, 0.06 * Math.abs(floor));
  const xs: number[] = [],
    zs: number[] = [];
  for (let i = 0; i < pts.length; i += 3)
    if (Math.abs(pts[i + 1] - floor) < tolerance) {
      xs.push(pts[i]);
      zs.push(pts[i + 2]);
    }
  const q = (a: number[], f: number) => (a.sort((x, y) => x - y), a[Math.min(a.length - 1, Math.floor(a.length * f))] ?? 0);
  const reach = xs.length ? Math.max(-q(xs, 0.01), q(xs, 0.99), -q(zs, 0.01), q(zs, 0.99)) : 3;
  return { height: eye.y + floor, size: reach * 2, ceiling: ceiling === null ? null : eye.y + ceiling };
}
export default function Scene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  // The latest props for event handlers and effects, updated before any effect of the same render runs.
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  const engine = useRef<any>(null);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ece4d6");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 150);
    camera.position.set(7.2, 6.1, 8.5);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", pick(currentLang())("房间三维画布", "3D view of the room"));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.65, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 0.5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    scene.add(new THREE.HemisphereLight("#fff8ee", "#b89a74", 2.5));
    const sun = new THREE.DirectionalLight("#ffeccf", 3.4);
    sun.position.set(-2, 7, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.normalBias = 0.025;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const fill = new THREE.DirectionalLight("#dfe8f0", 1);
    fill.position.set(5, 3, -4);
    scene.add(fill);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: "#b5834f",
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.visible = false;
    scene.add(plane);
    const grid = new THREE.GridHelper(6, 12, "#a88a62", "#cdb994");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    scene.add(grid);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.2, 40),
      new THREE.MeshBasicMaterial({
        color: "#d9958c",
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 100;
    scene.add(ring);
    const outline = new THREE.Box3Helper(
      new THREE.Box3(),
      new THREE.Color("#5f84a0"),
    );
    (outline.material as THREE.Material).depthTest = false;
    outline.renderOrder = 100;
    outline.visible = false;
    scene.add(outline);
    const objects = new Map<string, THREE.Group>();
    const ray = new THREE.Raycaster();
    const pt = new THREE.Vector2();
    let dragging: string | null = null,
      // Pieces resting on the one being dragged travel with it (a lamp on a desk), from these spots.
      starts = new Map<string, THREE.Vector3>(),
      // A piece hung on a wall (nothing under it) slides at its own height.
      dragHeight: number | null = null,
      // A piece hanging from the ceiling slides along it, this far below it.
      hangDrop: number | null = null,
      pointerStart = [0, 0],
      dirty = true,
      frames = 0,
      room: THREE.Object3D | null = null,
      ghost: THREE.Group | null = null,
      ghostId = "",
      // The last spot the pending piece could land: it waits there while the pointer is over a wall.
      lastLanding: THREE.Vector3 | null = null;
    const mark = () => {
      dirty = true;
      frames = 8;
    };
    controls.addEventListener("change", mark);
    function floor(e: { clientX: number; clientY: number }) {
      const r = renderer.domElement.getBoundingClientRect();
      pt.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pt, camera);
      const f = live.current.project.floor;
      const p = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -f.height),
        new THREE.Vector3(),
      );
      if (
        !p ||
        Math.abs(p.x) > f.size / 2 ||
        Math.abs(p.z) > f.size / 2 ||
        !f.confirmed
      )
        return null;
      return p;
    }
    const erasedBoxes = () => {
      const p = live.current.project;
      return eraseBoxes(p.room?.erasures ?? [], p.floor.height, engine.current?.cleanSplat ? 0.25 : 0);
    };
    // Pieces in the room; `holding`: only those that can carry another (not what hangs from the ceiling).
    const pieces = (skip: Set<string>, holding = false) =>
      [...objects.entries()].filter(([id, o]) => o.visible && !skip.has(id) && !(holding && hanging(id))).map(([, o]) => o);
    // Where a piece would land, or null where it cannot go: whichever the pointer meets first of
    // placed furniture (its top), the room scan (its floor, desk top, windowsill) and, in the demo
    // room, its walls. The side of furniture puts the piece on top of it; a wall does not take it.
    // `skip`: the pieces being moved, which never carry themselves.
    function landing(e: { clientX: number; clientY: number }, skip: Set<string>): THREE.Vector3 | null {
      const plane = floor(e);
      const f = live.current.project.floor;
      if (!f.confirmed) return null;
      const { origin, direction } = ray.ray;
      const piece = hitPieces(ray, pieces(skip, true));
      const grid: RoomGrid | null = engine.current?.scan ?? null;
      if (grid) {
        const scan = castRoom(grid, origin, direction, erasedBoxes());
        if (piece && piece.t <= (scan?.t ?? Infinity)) return landOnPiece(piece, direction);
        return scan && scan.kind !== "blocked" ? scan.point : null;
      }
      // No scan (the demo room, or while it is being read): furniture, the demo walls, the floor.
      const set = room && live.current.project.mode === "demo" ? hitPieces(ray, [room]) : null;
      const tPlane = plane ? plane.distanceTo(origin) : Infinity;
      if (piece && piece.t <= Math.min(set?.t ?? Infinity, tPlane)) return landOnPiece(piece, direction);
      if (set && set.t < tPlane - 0.02) return set.up ? (set.point.y - f.height < 0.03 ? set.point.setY(f.height) : set.point) : null;
      return plane;
    }
    // Pointer on the horizontal plane at height y, within the placement area. (Pointing at a wall,
    // the floor point behind it is out of bounds while the point at hanging height is not.)
    function level(e: { clientX: number; clientY: number }, y: number) {
      floor(e);
      const f = live.current.project.floor;
      const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
      return p && f.confirmed && Math.abs(p.x) <= f.size / 2 + 0.5 && Math.abs(p.z) <= f.size / 2 + 0.5 ? p : null;
    }
    // The height a piece would rest at under x,z: placed furniture, the scan or the floor below fromY.
    function restAt(x: number, z: number, fromY: number, ignore: Iterable<string>) {
      const f = live.current.project.floor,
        grid: RoomGrid | null = engine.current?.scan ?? null;
      return Math.max(
        f.height,
        piecesBelow(pieces(new Set(ignore), true), x, z, fromY) ?? -Infinity,
        grid ? roomBelow(grid, x, z, fromY, erasedBoxes()) : -Infinity,
      );
    }
    // Hung on a wall: off the floor with nothing just under it. Such a piece slides at its height.
    function hung(id: string) {
      const o = objects.get(id)!;
      if (o.position.y - live.current.project.floor.height < 0.02) return false;
      const rest = restAt(o.position.x, o.position.z, o.position.y + 0.02, [id, ...ridersOf(id, objects)]);
      return o.position.y - rest > 0.05;
    }
    const itemOf = (id: string) => live.current.project.items.find((i) => i.id === id);
    const hanging = (id: string) => {
      const it = itemOf(id);
      return !!it && hangsFromCeiling(it);
    };
    const ceilingAt = (x: number, z: number) => engine.current?.ceiling?.at(x, z) ?? live.current.project.floor.height + 2.7;
    const ceilingLevel = () => engine.current?.ceiling?.level ?? live.current.project.floor.height + 2.7;
    // A piece's height as shown; before its model has loaded, its own height.
    function heightOf(id: string) {
      const o = objects.get(id);
      const b = o?.children.length ? new THREE.Box3().setFromObject(o) : null;
      const it = itemOf(id);
      return b && !b.isEmpty() ? b.max.y - b.min.y : (it?.height ?? 0.5) * (it?.scale ?? 1);
    }
    // A hanging piece follows the pointer along the ceiling: aimed at the ceiling, it goes under
    // that spot; aimed lower (or seen from above the room), above the spot pointed at. Its top
    // stays `drop` below the ceiling there.
    function hangLanding(e: { clientX: number; clientY: number }, id: string, drop = 0) {
      if (!live.current.project.floor.confirmed) return null;
      const p = (camera.position.y < ceilingLevel() ? level(e, ceilingLevel()) : null) ?? landing(e, new Set([id]));
      return p ? new THREE.Vector3(p.x, ceilingAt(p.x, p.z) - heightOf(id) - drop, p.z) : null;
    }
    const landingFor = (e: { clientX: number; clientY: number }, id: string) => (hanging(id) ? hangLanding(e, id) : landing(e, new Set([id])));
    function clearGhost() {
      if (!ghost) return;
      scene.remove(ghost);
      ghost.traverse((o) => o instanceof THREE.Mesh && (o.material as THREE.Material).dispose());
      ghost = null;
    }
    function preview(e: { clientX: number; clientY: number }, bare = false) {
      const id = live.current.pending;
      if (!id) {
        // Dragging a library card: no object yet, only the landing ring.
        if (!bare) return null;
        const p = landing(e, new Set());
        ring.visible = !!p;
        if (p) ring.position.set(p.x, p.y + 0.02, p.z);
        mark();
        return p;
      }
      const p = landingFor(e, id);
      if (p) lastLanding = p;
      const at = p ?? lastLanding;
      ring.visible = !!p;
      if (p) ring.position.set(p.x, p.y + 0.02, p.z);
      renderer.domElement.style.cursor = p ? "" : "not-allowed";
      if (at) {
        // Re-clone once the model has loaded: the first clone may be of the still-empty group.
        if (ghostId !== id || (ghost && !ghost.children.length && objects.get(id)?.children.length)) {
          clearGhost();
          const source = objects.get(id);
          if (source) {
            ghost = source.clone(true);
            ghost.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                o.material = (o.material as THREE.Material).clone();
                o.material.transparent = true;
                o.material.opacity = 0.38;
                o.castShadow = false;
              }
            });
            scene.add(ghost);
            ghostId = id;
          }
        }
        if (ghost) {
          ghost.visible = true;
          ghost.position.copy(at);
        }
      } else if (ghost) ghost.visible = false;
      mark();
      return p;
    }
    let downAt = [0, 0],
      draftGrab: THREE.Vector3 | null = null;
    function down(e: PointerEvent) {
      if (e.button !== 0) return;
      downAt = [e.clientX, e.clientY];
      if (live.current.pending) {
        preview(e);
        return;
      }
      const draft = live.current.eraseDraft;
      if (draft) {
        // While fitting an erase box, dragging on the floor moves the box.
        const p = floor(e);
        if (p) {
          draftGrab = new THREE.Vector3(p.x - draft.center[0], 0, p.z - draft.center[2]);
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
        return;
      }
      floor(e);
      const hit = hitPieces(ray, pieces(new Set()));
      // A piece the scan stands in front of (behind the wardrobe) is out of reach.
      const grid: RoomGrid | null = engine.current?.scan ?? null;
      const front = hit && grid ? castRoom(grid, ray.ray.origin, ray.ray.direction, erasedBoxes()) : null;
      const id: string | undefined = hit && !(front && front.t < hit.t - 0.03) ? hit.root.userData.itemId : undefined;
      if (id) {
        live.current.onSelect(id);
        dragging = id;
        if (hanging(id)) {
          const at = objects.get(id)!.position;
          starts = new Map([[id, at.clone()]]);
          hangDrop = ceilingAt(at.x, at.z) - (at.y + heightOf(id));
          dragHeight = null;
        } else {
          starts = new Map([id, ...ridersOf(id, objects)].map((k) => [k, objects.get(k)!.position.clone()]));
          dragHeight = hung(id) ? starts.get(id)!.y : null;
        }
        pointerStart = [e.clientX, e.clientY];
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      } else live.current.onSelect(null);
      mark();
    }
    function move(e: PointerEvent) {
      if (live.current.pending) {
        preview(e);
        return;
      }
      const draft = live.current.eraseDraft;
      if (draftGrab && draft) {
        const p = floor(e);
        if (p) live.current.onDraftMove?.([p.x - draftGrab.x, draft.center[1], p.z - draftGrab.z]);
        return;
      }
      if (dragging) {
        const p =
          hangDrop !== null ? hangLanding(e, dragging, hangDrop) : dragHeight === null ? landing(e, new Set(starts.keys())) : level(e, dragHeight);
        renderer.domElement.style.cursor = p ? "" : "not-allowed";
        // Nowhere to go (a wall): the piece waits at its last good spot.
        if (p) {
          const delta = p.sub(starts.get(dragging)!);
          for (const [k, s] of starts) objects.get(k)?.position.copy(s).add(delta);
        }
        mark();
      }
    }
    function release(e: PointerEvent) {
      const pending = live.current.pending;
      // Placed by a click on its spot, not by letting go after turning the view.
      if (pending && e.button === 0 && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
        const p = landingFor(e, pending);
        if (p) live.current.onPlace(pending, p.toArray() as [number, number, number]);
        else live.current.onHint?.(NO_SPOT());
      }
      if (dragging) {
        const obj = objects.get(dragging)!;
        if (
          Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 3 &&
          !obj.position.equals(starts.get(dragging)!)
        )
          live.current.onMoveMany(
            [...starts.keys()].map((k) => ({ id: k, position: objects.get(k)!.position.toArray() as [number, number, number] })),
          );
        else for (const [k, s] of starts) objects.get(k)?.position.copy(s);
      }
      // A plain click on the room (no drag) picks the piece of furniture under the pointer.
      const still = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4;
      if (still && !dragging && !draftGrab && !pending && !live.current.eraseDraft && live.current.pickEnabled && engine.current?.splat) {
        floor(e);
        const hit = ray.intersectObject(engine.current.splat, false)[0];
        if (hit && hit.point.y - live.current.project.floor.height > 0.05) {
          const r = renderer.domElement.getBoundingClientRect();
          const f = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
          live.current.onRoomPick?.(hit.point.toArray() as [number, number, number], { x: e.clientX - r.left, y: e.clientY - r.top }, [f.x, f.z]);
        }
      }
      draftGrab = null;
      dragging = null;
      starts = new Map();
      dragHeight = null;
      hangDrop = null;
      if (!pending) renderer.domElement.style.cursor = "";
      controls.enabled = true;
      mark();
    }
    function cancel() {
      draftGrab = null;
      for (const [k, s] of starts) objects.get(k)?.position.copy(s);
      dragging = null;
      starts = new Map();
      dragHeight = null;
      hangDrop = null;
      renderer.domElement.style.cursor = "";
      controls.enabled = true;
      mark();
    }
    const dragover = (e: DragEvent) => {
      e.preventDefault();
      const p = preview(e, true);
      if (e.dataTransfer) e.dataTransfer.dropEffect = p ? "copy" : "none";
    };
    const dragleave = () => {
      if (live.current.pending) return;
      ring.visible = false;
      mark();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("text/plain");
      const pending = live.current.pending;
      const p = id && hanging(id) ? hangLanding(e, id) : landing(e, new Set(pending ? [pending] : []));
      if (id && p) live.current.onPlace(id, p.toArray() as [number, number, number]);
      else if (id) live.current.onHint?.(NO_SPOT());
      ring.visible = false;
      if (ghost) ghost.visible = false;
      mark();
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", release);
    renderer.domElement.addEventListener("pointercancel", cancel);
    renderer.domElement.addEventListener("dragover", dragover);
    renderer.domElement.addEventListener("dragleave", dragleave);
    renderer.domElement.addEventListener("drop", drop);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      mark();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    function thumb(id: string, g: THREE.Group) {
      const ts = new THREE.Scene();
      ts.background = new THREE.Color("#f9f6f0");
      const clone = g.clone(true);
      clone.visible = true;
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.setScalar(1);
      ts.add(clone);
      ts.add(new THREE.HemisphereLight("#fff8ee", "#a88a62", 3));
      const l = new THREE.DirectionalLight("#fff7e8", 3);
      l.position.set(3, 5, 4);
      ts.add(l);
      const bounds = new THREE.Box3().setFromObject(clone),
        s = bounds.getSize(new THREE.Vector3()),
        c = bounds.getCenter(new THREE.Vector3()),
        d = Math.max(s.x, s.y, s.z);
      const cam = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
      cam.position.copy(c).add(new THREE.Vector3(d * 1.65, d * 0.95, d * 1.85));
      cam.lookAt(c);
      const old = renderer.getSize(new THREE.Vector2());
      renderer.setSize(260, 260, false);
      renderer.setClearColor("#f9f6f0", 1);
      renderer.render(ts, cam);
      live.current.onThumb(id, renderer.domElement.toDataURL("image/png"));
      renderer.setSize(old.x, old.y, false);
      mark();
    }
    engine.current = {
      renderer,
      scene,
      camera,
      controls,
      objects,
      plane,
      grid,
      mark,
      thumb,
      setRoom: (o: THREE.Object3D) => {
        if (room) scene.remove(room);
        room = o;
        scene.add(o);
        mark();
      },
      // Saved erasures and the box being fitted hide the splats inside them. Outlines show the box
      // being fitted (blue) and furniture still being generated (pink placeholder).
      syncErasures: () => {
        const e = engine.current;
        const S = e?.sparkLib;
        if (!e || !S) return;
        if (!e.edit) {
          // A soft edge also fades splats whose centres sit just outside the box: their blurred
          // footprint would otherwise leave a ghost of the furniture around it. The same boxes,
          // inverted, show the empty-room layer only where the room was erased. Both edits stay
          // out of the scene graph so each applies only to its own splat mesh.
          e.edit = new S.SplatEdit({ rgbaBlendMode: S.SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.08 });
          e.reveal = new S.SplatEdit({ rgbaBlendMode: S.SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.08, invert: true });
        }
        if (e.splat && e.splat.edits?.[0] !== e.edit) e.splat.edits = [e.edit];
        if (e.cleanSplat && e.cleanSplat.edits?.[0] !== e.reveal) e.cleanSplat.edits = [e.reveal];
        for (const c of [...e.edit.children]) e.edit.remove(c);
        for (const c of [...e.reveal.children]) e.reveal.remove(c);
        for (const w of e.wires ?? []) {
          scene.remove(w);
          w.geometry.dispose();
        }
        e.wires = [];
        const p = live.current.project;
        const draft = live.current.eraseDraft;
        // An erasure being refitted is drawn from the draft instead of its saved box.
        const list = [
          ...(p.room?.erasures ?? []).filter((x) => x.id !== draft?.id).map((x) => ({ ...x, draft: false })),
          ...(draft ? [{ ...draft, draft: true }] : []),
        ];
        // With an empty-room layer the boxes reach 25 cm below the floor: inside them floor and wall
        // both come from the empty room, replacing what the room never saw under the furniture
        // (holes, contact shadows). Without one, the room's own floor is kept.
        const floorY = p.floor.height, below = e.cleanSplat ? 0.25 : 0;
        for (const er of list) {
          const sdf = new S.SplatEditSdf({ type: S.SplatEditSdfType.BOX, opacity: 0 });
          const top = er.center[1] + er.size[1] / 2, bottom = Math.min(er.center[1] - er.size[1] / 2, floorY - below);
          sdf.position.set(er.center[0], (top + bottom) / 2, er.center[2]);
          sdf.rotation.y = er.rotation;
          sdf.scale.set(er.size[0] / 2, (top - bottom) / 2, er.size[2] / 2);
          e.edit.add(sdf);
          const hole = new S.SplatEditSdf({ type: S.SplatEditSdfType.BOX, opacity: 0 });
          hole.position.copy(sdf.position);
          hole.rotation.copy(sdf.rotation);
          hole.scale.copy(sdf.scale);
          e.reveal.add(hole);
          const item = er.item ? p.items.find((i) => i.id === er.item) : undefined;
          if (er.draft || (item && !item.model)) {
            // A translucent volume plus its edges, drawn over the room so the box is easy to fit.
            const color = er.draft ? "#5f84a0" : "#d9958c";
            const box = new THREE.BoxGeometry(...er.size);
            const wire = new THREE.LineSegments(
              new THREE.EdgesGeometry(box),
              new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
            );
            const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.16 }));
            for (const o of [wire, fill]) {
              o.position.set(...er.center);
              o.rotation.y = er.rotation;
              o.renderOrder = 60;
              scene.add(o);
              e.wires.push(o);
            }
          }
        }
        if (e.cleanGroup) e.cleanGroup.visible = list.length > 0;
        mark();
      },
      // The empty-room layer: loaded once per file, positioned by its own scale and shift.
      loadClean: () => {
        const e = engine.current;
        const S = e?.sparkLib;
        const c = live.current.project.room?.clean;
        if (!e || !S || !e.splat) return;
        const sig = c?.splat ?? "";
        if (e.cleanSig === sig) return;
        e.cleanSig = sig;
        if (e.cleanGroup) {
          scene.remove(e.cleanGroup);
          e.cleanSplat?.dispose?.();
          e.cleanGroup = e.cleanSplat = null;
        }
        if (!c) return;
        const desktop = window.innerWidth > 900 && !window.matchMedia("(pointer: coarse)").matches;
        const roomSplat = e.splat;
        // One room file is decoded at a time: Safari 17 crashes (a JavaScriptCore race when two of
        // Spark's WebAssembly workers first run its SIMD code at once), so the empty-room layer
        // starts once the room itself has loaded and its first sort has run.
        roomSplat.initialized
          .catch(() => undefined)
          .then(() => new Promise((r) => setTimeout(r, 1200)))
          .then(() => {
            if (e.disposed() || e.cleanSig !== sig || e.splat !== roomSplat) return;
            placeClean(c, desktop);
          });
      },
      disposed: () => disposed,
    };
    // The empty-room layer's splats, in their alignment, hidden until erasures reveal them.
    function placeClean(c: CleanLayer, desktop: boolean) {
      const e = engine.current;
      const S = e.sparkLib;
      // Outer group: alignment (shift, heading about the camera, scale). Inner: the world's flip.
      const group = new THREE.Group(), flip = new THREE.Group();
      flip.rotation.x = Math.PI;
      const splat = new S.SplatMesh({ url: asset((desktop && c.splatFull) || c.splat), raycastable: false });
      flip.add(splat);
      group.add(flip);
      group.scale.setScalar(c.scale);
      group.rotation.y = c.yaw ?? 0;
      group.position.set(...c.shift);
      group.visible = false;
      scene.add(group);
      e.cleanGroup = group;
      e.cleanSplat = splat;
      e.syncErasures();
      if (!c.aligned)
        Promise.all([splat.initialized, e.splat.initialized])
          .then(async () => {
            // Read both lighter files directly (see lib/align-clean.ts) and register the plans.
            const room = live.current.project.room;
            if (e.disposed() || e.cleanSplat !== splat || !room) return;
            const [mainPts, cleanPts] = await Promise.all([readSpzPoints(asset(room.splat)), readSpzPoints(asset(c.splat))]);
            const fit = await alignClean(mainPts, cleanPts, room.scale, live.current.project.floor.height);
            if (fit && e.cleanSplat === splat) live.current.onCleanAligned?.(fit);
          })
          .catch(() => undefined);
    }
    live.current.onEngine?.({
      riders: (id) => ridersOf(id, objects),
      restAt,
      carry: (id) => {
        const support = objects.get(id);
        if (!support?.visible) return;
        // Height of each rider above the support's top under it, kept through the resize.
        const list = ridersOf(id, objects).map((r) => {
          const o = objects.get(r)!;
          return { id: r, above: o.position.y - (topOfPiece(support, o.position.x, o.position.z)?.y ?? o.position.y) };
        });
        engine.current.carry = list.length ? { id, list } : null;
      },
      fitAt: (point, forward) => {
        const e = engine.current,
          p = live.current.project,
          room = p.room;
        const data = room && e?.points?.key === room.splat ? e.points.data : null;
        if (!data || !room || !p.floor.confirmed) return null;
        return fitBox(data, { scale: room.scale, offset: room.offset, floorY: p.floor.height, ceilingY: e.ceiling?.level ?? null }, point, forward);
      },
      sizeOf: (id) => {
        const o = objects.get(id);
        if (!o?.children.length) return null;
        const turn = o.rotation.y;
        o.rotation.y = 0;
        o.updateMatrixWorld(true);
        const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
        o.rotation.y = turn;
        o.updateMatrixWorld(true);
        return s.lengthSq() ? { size: [s.x, s.y, s.z], uniform: !!o.userData.uniform } : null;
      },
      ceilingAt,
    });
    let last = 0;
    renderer.setAnimationLoop((t) => {
      if (t - last < 30) return;
      last = t;
      controls.update();
      const id = live.current.selected,
        obj = id ? objects.get(id) : null;
      outline.visible = !!obj?.visible;
      if (obj?.visible) outline.box.setFromObject(obj);
      if (!live.current.pending) {
        ring.visible = false;
        if (ghost) ghost.visible = false;
        ghostId = "";
        lastLanding = null;
      }
      if (dirty || frames > 0 || live.current.project.room) {
        // Seen edge-on (camera level with the floor grid) the grid is only a stray line.
        grid.visible = !!grid.userData.wanted && Math.abs(camera.position.y - grid.position.y) > 0.2;
        renderer.render(scene, camera);
        dirty = false;
        frames--;
      }
    });
    return () => {
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      engine.current?.spark?.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      el.replaceChildren();
      engine.current = null;
      live.current.onEngine?.(null);
    };
  }, [props.project.id]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const p = props.project;
    const sig = p.mode === "demo" ? "demo" : p.room?.splat || "empty";
    if (e.roomSig === sig) return;
    e.roomSig = sig;
    if (p.mode === "demo") {
      e.camera.fov = 43;
      e.camera.updateProjectionMatrix();
      e.setRoom(demoRoom());
      return;
    }
    if (p.room) {
      import("@sparkjsdev/spark")
        .then((sparkLib) => {
          const { SplatMesh, SparkRenderer } = sparkLib;
          if (e.disposed()) return;
          e.sparkLib = sparkLib;
          if (!e.spark) {
            // Rooms here have no level-of-detail data; without its driver Spark runs one worker
            // fewer (see loadClean on why fewer workers at once matters to Safari).
            e.spark = new SparkRenderer({ renderer: e.renderer, enableLod: false });
            e.scene.add(e.spark);
          }
          const group = new THREE.Group();
          group.rotation.x = Math.PI;
          // Desktop gets the full-resolution room when there is one; phones keep the lighter file.
          const desktop = window.innerWidth > 900 && !window.matchMedia("(pointer: coarse)").matches;
          const splat = new SplatMesh({ url: asset((desktop && p.room!.splatFull) || p.room!.splat) });
          splat.position.y = -p.room!.offset;
          // Scaling the group around the camera origin converts the world to metres without moving the viewpoint.
          group.scale.setScalar(p.room!.scale);
          e.roomGroup = group;
          e.splat = splat;
          group.add(splat);
          e.setRoom(group);
          // The world's origin is where the photo was taken, looking along local +Z. Start there:
          // that view is reconstructed from real pixels; everything behind it is generated guesswork.
          group.updateMatrixWorld(true);
          const eye = splat.localToWorld(new THREE.Vector3(0, 0, 0));
          const ahead = splat.localToWorld(new THREE.Vector3(0, 0, 1));
          e.home = { eye: eye.clone(), target: ahead.clone() };
          // Match a phone camera's vertical field of view, so the opening view frames the room
          // like the photo did and the nearby floor is visible for placing furniture.
          e.camera.fov = 55;
          e.camera.updateProjectionMatrix();
          e.camera.position.copy(eye);
          e.controls.target.copy(ahead);
          e.controls.update();
          if (p.room!.collider)
            gltfLoader().load(
              asset(p.room!.collider),
              (gltf) => {
                if (e.disposed()) return;
                const collider = gltf.scene;
                collider.position.y = -p.room!.offset;
                // Never drawn; only used for the floor rays.
                collider.traverse((o) => {
                  if (o instanceof THREE.Mesh) (o.material as THREE.Material).visible = false;
                });
                group.add(collider);
                group.updateMatrixWorld(true);
                live.current.onFloorDetected?.(detectFloor(collider, eye));
              },
              undefined,
              () => live.current.onFloorDetected?.(null),
            );
          else
            splat.initialized
              .then(() => !e.disposed() && live.current.onFloorDetected?.(detectFloorFromSplats(splat as never, eye)))
              .catch(() => live.current.onFloorDetected?.(null));
          splat.initialized.catch(() =>
            props.onError(pick(currentLang())("空间加载失败，请刷新重试。", "The room failed to load. Refresh to try again.")),
          );
          e.syncErasures();
          e.cleanSig = undefined;
          e.loadClean();
        })
        .catch(() => props.onError(pick(currentLang())("空间渲染器加载失败。", "The 3D renderer failed to load.")));
    } else e.setRoom(new THREE.Group());
  }, [props.project.id, props.project.mode, props.project.room?.splat]);
  useEffect(() => {
    engine.current?.syncErasures?.();
  }, [props.project.room?.erasures, props.eraseDraft, props.project.items]);
  useEffect(() => {
    engine.current?.loadClean?.();
  }, [props.project.room?.clean?.splat]);
  useEffect(() => {
    const e = engine.current, c = props.project.room?.clean;
    if (!e?.cleanGroup || !c) return;
    e.cleanGroup.scale.setScalar(c.scale);
    e.cleanGroup.rotation.y = c.yaw ?? 0;
    e.cleanGroup.position.set(...c.shift);
    e.mark();
  }, [props.project.room?.clean?.scale, props.project.room?.clean?.yaw, props.project.room?.clean?.shift]);
  useEffect(() => {
    const e = engine.current;
    if (!e?.roomGroup || !props.project.room) return;
    e.roomGroup.scale.setScalar(props.project.room.scale);
    e.mark();
  }, [props.project.room?.scale]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const p = props.project;
    // In a generated room the grid is a calibration aid: shown on top only while the floor panel
    // is open, since the splat would otherwise hide it.
    e.grid.userData.wanted = p.mode !== "demo" && !!props.floorEditing;
    (e.grid.material as THREE.Material).depthTest = !props.floorEditing;
    e.grid.renderOrder = props.floorEditing ? 50 : 0;
    e.grid.position.y = p.floor.height + 0.005;
    e.grid.scale.setScalar(p.floor.size / 6);
    e.plane.visible = p.mode === "real" && !p.floor.confirmed;
    e.plane.position.y = p.floor.height;
    e.plane.scale.setScalar(p.floor.size);
    // Geometry and textures of a piece that left (or whose model was replaced) are freed with it.
    const drop = (o: THREE.Object3D) => {
      e.scene.remove(o);
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        m.geometry.dispose();
        for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
          mat.map?.dispose();
          mat.normalMap?.dispose();
          mat.roughnessMap?.dispose();
          mat.dispose();
        }
      });
    };
    for (const [id, o] of e.objects) {
      if (!p.items.some((i) => i.id === id)) {
        drop(o);
        e.objects.delete(id);
      }
    }
    for (const item of p.items) {
      let old = e.objects.get(item.id);
      // A model that arrived or was replaced (a slimmed copy) is loaded afresh.
      if (old && item.model && old.userData.model !== item.model) {
        drop(old);
        e.objects.delete(item.id);
        old = null;
      }
      if (!old) {
        const group = new THREE.Group();
        group.userData.itemId = item.id;
        group.userData.model = item.model;
        group.visible = false;
        e.objects.set(item.id, group);
        e.scene.add(group);
        if (!item.model && p.mode === "demo") {
          group.add(demoModel(item.kind));
          e.thumb(item.id, group);
          e.mark();
        } else if (item.model) {
          gltfLoader().load(
            asset(item.model),
            (gltf) => {
              if (e.disposed()) return;
              const model = gltf.scene,
                b = new THREE.Box3().setFromObject(model),
                size = b.getSize(new THREE.Vector3()),
                center = b.getCenter(new THREE.Vector3());
              const pivot = new THREE.Group();
              // Library models are prepared at real size already; only user-given sizes reshape a model.
              if (item.dims && item.source !== "catalog") {
                // Fit the model to its real size (lib/fit-model.ts): the longer side of the footprint
                // goes to the model's longer horizontal axis (turning it 90° when needed). Each axis
                // takes its typed length when that agrees with the photo's proportions; otherwise
                // the model is scaled evenly and keeps its shape.
                const fit = fitScale([size.x, size.y, size.z], item.dims);
                const [kx, ky, kz] = fit.scale;
                model.scale.set(kx, ky, kz);
                model.position.set(-center.x * kx, -b.min.y * ky, -center.z * kz);
                if (fit.swap) pivot.rotation.y = Math.PI / 2;
                group.userData.uniform = fit.uniform;
              } else {
                const k = item.height / Math.max(size.y, 0.001);
                model.scale.setScalar(k);
                model.position.set(-center.x * k, -b.min.y * k, -center.z * k);
              }
              pivot.add(model);
              model.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                  o.castShadow = true;
                  o.receiveShadow = true;
                }
              });
              group.add(pivot);
              e.thumb(item.id, group);
              e.mark();
            },
            undefined,
            () => props.onError(pick(currentLang())(item.name + " 模型加载失败，可刷新重试。", `The model of ${item.name} failed to load. Refresh to try again.`)),
          );
        }
      }
      const group = e.objects.get(item.id);
      group.visible = item.status === "placed";
      group.position.set(...item.position);
      group.rotation.y = item.rotation;
      const base = group.userData.height || item.height;
      group.userData.height = base;
      group.scale.setScalar((item.scale * item.height) / base);
    }
    // A resized piece: what rests on it sits on its new top.
    const carry = e.carry;
    if (carry) {
      e.carry = null;
      const support = e.objects.get(carry.id);
      support?.updateMatrixWorld(true);
      const moves: Move[] = [];
      for (const r of carry.list) {
        const o = e.objects.get(r.id);
        const top = support && o ? topOfPiece(support, o.position.x, o.position.z) : null;
        if (o && top && Math.abs(top.y + r.above - o.position.y) > 0.002) moves.push({ id: r.id, position: [o.position.x, top.y + r.above, o.position.z] });
      }
      if (moves.length) live.current.onAdjust?.(moves);
    }
    e.mark();
  }, [props.project.items, props.project.floor, props.project.id, props.floorEditing]);
  // The room scan's surfaces for placement (lib/placement.ts), read from the lighter .spz and
  // rebuilt when the floor or the metric scale changes. Until it is ready, pieces land on
  // furniture and the floor plane as before.
  useEffect(() => {
    const e = engine.current,
      p = props.project,
      room = p.room;
    if (!e) return;
    e.scan = null;
    e.ceiling = null;
    if (!room || p.mode !== "real" || !p.floor.confirmed) return;
    let stale = false;
    const key = room.splat;
    const points = e.points?.key === key ? Promise.resolve(e.points.data) : readSpzPoints(asset(key)).then((data) => ((e.points = { key, data }), data));
    points
      .then((data) => {
        if (stale || e.disposed()) return;
        const area = { scale: room.scale, offset: room.offset, floorY: p.floor.height, half: p.floor.size / 2 + 0.5 };
        // The ceiling (for hanging pieces) also ends the scan grid, when it is a believable one.
        e.ceiling = buildCeiling(data, area);
        const ceilingY = e.ceiling.level !== null && e.ceiling.level - p.floor.height >= 2.2 ? e.ceiling.level : null;
        e.scan = buildRoomGrid(data, { ...area, ceilingY });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [props.project.id, props.project.mode, props.project.room?.splat, props.project.room?.scale, props.project.room?.offset, props.project.floor.height, props.project.floor.size, props.project.floor.confirmed]);
  useEffect(() => {
    const e = engine.current;
    const id = live.current.selected;
    if (!e || !id) return;
    const obj = e.objects.get(id);
    if (!obj?.visible) return;
    const center = new THREE.Box3()
      .setFromObject(obj)
      .getCenter(new THREE.Vector3());
    const delta = e.camera.position.clone().sub(e.controls.target);
    e.controls.target.copy(center);
    e.camera.position.copy(center).add(delta);
    e.controls.update();
    e.mark();
  }, [props.focus]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (e.home) {
      e.camera.position.copy(e.home.eye);
      e.controls.target.copy(e.home.target);
    } else {
      e.camera.position.set(7.2, 6.1, 8.5);
      e.controls.target.set(0, 0.65, 0);
    }
    e.controls.update();
    e.mark();
  }, [props.reset]);
  return <div className="scene" ref={host} />;
}
