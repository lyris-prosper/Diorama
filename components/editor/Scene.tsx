"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CleanLayer, Erasure, Item, Project } from "@/lib/types";
import { alignClean, readSpzPoints } from "@/lib/align-clean";
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
type Props = {
  project: Project;
  selected: string | null;
  pending: string | null;
  reset: number;
  focus: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, pos: [number, number, number]) => void;
  onPlace: (id: string, pos: [number, number, number]) => void;
  onThumb: (id: string, url: string) => void;
  onError: (s: string) => void;
  onFloorDetected?: (fit: FloorFit | null) => void;
  floorEditing?: boolean;
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
function detectFloorFromSplats(splat: THREE.Object3D & { forEachSplat?: Function; numSplats?: number }, eye: THREE.Vector3): FloorFit | null {
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
  const live = useRef(props);
  live.current = props;
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "房间三维画布");
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
      // A piece lifted off every support (a shelf hung on the wall) slides at its own height.
      dragHeight: number | null = null,
      start: [number, number, number] | null = null,
      pointerStart = [0, 0],
      dirty = true,
      frames = 0,
      room: THREE.Object3D | null = null,
      ghost: THREE.Group | null = null,
      ghostId = "";
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
    // Where a piece would land: on top of placed furniture under the pointer (a lamp on a desk),
    // otherwise on the floor. The piece being moved never counts as its own support.
    const up = new THREE.Vector3(),
      normal = new THREE.Matrix3();
    function surface(e: { clientX: number; clientY: number }, exclude?: string | null) {
      // Aims the ray. Seen from eye height, the floor point behind a far table top can lie outside
      // the area while the top itself is inside, so a top is judged on its own.
      const p = floor(e);
      const f = live.current.project.floor;
      const hit = ray.intersectObjects(
        [...objects.entries()].filter(([id, o]) => o.visible && id !== exclude).map(([, o]) => o),
        true,
      )[0];
      if (!hit?.face || !f.confirmed) return p;
      up.copy(hit.face.normal).applyMatrix3(normal.getNormalMatrix(hit.object.matrixWorld)).normalize();
      // Only an upward-facing top counts; the side of a cabinet leaves the piece on the floor.
      if (Math.abs(up.y) < 0.75 || Math.abs(hit.point.x) > f.size / 2 || Math.abs(hit.point.z) > f.size / 2) return p;
      return hit.point.clone();
    }
    // Pointer on the horizontal plane at height y, within the placement area. (Pointing at a wall,
    // the floor point behind it is out of bounds while the point at hanging height is not.)
    function level(e: { clientX: number; clientY: number }, y: number) {
      floor(e);
      const f = live.current.project.floor;
      const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
      return p && f.confirmed && Math.abs(p.x) <= f.size / 2 && Math.abs(p.z) <= f.size / 2 ? p : null;
    }
    // Above the floor with nothing directly underneath: lifted by hand, not resting on furniture.
    const down3 = new THREE.Vector3(0, -1, 0);
    function floating(id: string) {
      const o = objects.get(id)!;
      if (o.position.y - live.current.project.floor.height < 0.02) return false;
      const probe = new THREE.Raycaster(o.position.clone().add(new THREE.Vector3(0, 0.02, 0)), down3, 0, 0.06);
      return !probe.intersectObjects([...objects.entries()].filter(([k, v]) => v.visible && k !== id).map(([, v]) => v), true).length;
    }
    function preview(e: { clientX: number; clientY: number }, bare = false) {
      const id = live.current.pending;
      if (!id) {
        // Dragging a library card: no object yet, only the landing ring.
        if (bare) {
          const p = surface(e);
          ring.visible = !!p;
          if (p) ring.position.set(p.x, p.y + 0.02, p.z);
          mark();
        }
        return;
      }
      const p = surface(e, id);
      ring.visible = !!p;
      if (p) {
        ring.position.set(p.x, p.y + 0.02, p.z);
        // Re-clone once the model has loaded: the first clone may be of the still-empty group.
        if (ghostId !== id || (ghost && !ghost.children.length && objects.get(id)?.children.length)) {
          if (ghost) scene.remove(ghost);
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
          ghost.position.copy(p);
        }
      } else if (ghost) ghost.visible = false;
      mark();
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
      const hits = ray.intersectObjects(
        [...objects.values()].filter((o) => o.visible),
        true,
      );
      if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !o.userData.itemId) o = o.parent;
        const id = o.userData.itemId;
        if (id) {
          live.current.onSelect(id);
          dragging = id;
          start = objects.get(id)!.position.toArray() as [
            number,
            number,
            number,
          ];
          dragHeight = floating(id) ? start[1] : null;
          pointerStart = [e.clientX, e.clientY];
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
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
        const p = dragHeight === null ? surface(e, dragging) : level(e, dragHeight);
        if (p) objects.get(dragging)?.position.copy(p);
        mark();
      }
    }
    function release(e: PointerEvent) {
      if (live.current.pending) {
        const p = surface(e, live.current.pending);
        if (p)
          live.current.onPlace(
            live.current.pending,
            p.toArray() as [number, number, number],
          );
      }
      if (dragging) {
        const obj = objects.get(dragging)!;
        // The piece only ever moves to valid spots, so a drag that ends outside the room keeps
        // the last one instead of jumping back.
        if (
          Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 3 &&
          start &&
          !obj.position.equals(new THREE.Vector3(...start))
        )
          live.current.onMove(
            dragging,
            obj.position.toArray() as [number, number, number],
          );
        else if (start) obj.position.set(...start);
      }
      // A plain click on the room (no drag) picks the piece of furniture under the pointer.
      const still = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4;
      if (still && !dragging && !draftGrab && !live.current.pending && !live.current.eraseDraft && engine.current?.splat) {
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
      dragHeight = null;
      controls.enabled = true;
      mark();
    }
    function cancel() {
      draftGrab = null;
      if (dragging && start) objects.get(dragging)?.position.set(...start);
      dragging = null;
      controls.enabled = true;
      mark();
    }
    const dragover = (e: DragEvent) => {
      e.preventDefault();
      preview(e, true);
    };
    const dragleave = () => {
      if (live.current.pending) return;
      ring.visible = false;
      mark();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("text/plain");
      const p = surface(e, live.current.pending);
      if (id && p)
        live.current.onPlace(id, p.toArray() as [number, number, number]);
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
      ts.background = new THREE.Color("#f3ece0");
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
      renderer.setClearColor("#f3ece0", 1);
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
      },
      disposed: () => disposed,
    };
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
            e.spark = new SparkRenderer({ renderer: e.renderer });
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
            props.onError("空间加载失败，请刷新重试。"),
          );
          e.syncErasures();
          e.cleanSig = undefined;
          e.loadClean();
        })
        .catch(() => props.onError("空间渲染器加载失败。"));
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
    for (const [id, o] of e.objects) {
      if (!p.items.some((i) => i.id === id)) {
        e.scene.remove(o);
        e.objects.delete(id);
      }
    }
    for (const item of p.items) {
      let old = e.objects.get(item.id);
      if (old && item.model && !old.userData.model) {
        e.scene.remove(old);
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
                // Fit the model to its real size: the longer side of the footprint goes to the
                // model's longer horizontal axis (turning it 90° when needed), height to height.
                const w = item.dims.w / 100, d = item.dims.d / 100, h = item.dims.h / 100;
                const swap = size.x >= size.z !== w >= d;
                const kx = (swap ? d : w) / Math.max(size.x, 0.001),
                  ky = h / Math.max(size.y, 0.001),
                  kz = (swap ? w : d) / Math.max(size.z, 0.001);
                model.scale.set(kx, ky, kz);
                model.position.set(-center.x * kx, -b.min.y * ky, -center.z * kz);
                if (swap) pivot.rotation.y = Math.PI / 2;
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
            () => props.onError(item.name + " 模型加载失败，可刷新重试。"),
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
    e.mark();
  }, [props.project.items, props.project.floor, props.project.id, props.floorEditing]);
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
