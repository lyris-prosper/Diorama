"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// A basswood scale model of a bedroom for the landing page. The cursor steers the sun through the
// window; every piece of furniture can be picked up and moved, previewing what the workbench does.

type Piece = {
  group: THREE.Group;
  name: string;
  dims: string;
  half: [number, number];
  height: number;
  delay: number;
  lift: number;
};

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.86) {
  const key = color + roughness;
  if (!materials.has(key))
    materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
  return materials.get(key)!;
}
function block(
  parent: THREE.Object3D,
  [w, h, d]: number[],
  [x, y, z]: number[],
  color: string,
  radius = 0.018,
) {
  const r = Math.min(radius, Math.min(w, h, d) / 2 - 0.001);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, r)), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cylinder(parent: THREE.Object3D, r: number, h: number, [x, y, z]: number[], color: string) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Interior floor bounds (metres), inside the two walls.
const FLOOR = { x0: -2.38, x1: 2.5, z0: -2.08, z1: 2.2 };
const OAK = "#C99F70",
  OAK_DARK = "#B08257",
  LINEN = "#F4EFE6";

function furniture(): Omit<Piece, "lift">[] {
  const pieces: Omit<Piece, "lift">[] = [];
  const add = (name: string, dims: string, half: [number, number], height: number, x: number, z: number, build: (g: THREE.Group) => void, rotation = 0) => {
    const group = new THREE.Group();
    build(group);
    group.position.set(x, 0.02, z);
    group.rotation.y = rotation;
    pieces.push({ group, name, dims, half, height, delay: pieces.length });
  };
  add("床", "150 × 200 cm", [0.78, 1.0], 0.95, -1.32, -1.06, (g) => {
    block(g, [1.5, 0.26, 2.0], [0, 0.13, 0], OAK, 0.03);
    block(g, [1.42, 0.2, 1.9], [0, 0.36, 0.02], LINEN, 0.06);
    block(g, [1.47, 0.07, 1.25], [0, 0.48, 0.36], "#E8DCCB", 0.035);
    for (const x of [-0.36, 0.36]) block(g, [0.56, 0.11, 0.34], [x, 0.51, -0.66], "#FBF8F1", 0.05);
    block(g, [1.56, 0.92, 0.07], [0, 0.46, -0.97], OAK, 0.025);
  });
  add("床头柜", "42 × 38 cm", [0.22, 0.2], 0.72, -0.28, -1.86, (g) => {
    block(g, [0.42, 0.46, 0.38], [0, 0.23, 0], OAK_DARK, 0.02);
    block(g, [0.36, 0.006, 0.01], [0, 0.32, 0.192], "#8A6644", 0.002);
    cylinder(g, 0.065, 0.2, [0.06, 0.56, 0], "#7F9FB6");
  });
  add("书桌", "120 × 55 cm", [0.6, 0.28], 0.76, 0.92, -1.79, (g) => {
    block(g, [1.2, 0.04, 0.55], [0, 0.74, 0], OAK_DARK, 0.012);
    for (const x of [-0.56, 0.56]) for (const z of [-0.23, 0.23]) block(g, [0.04, 0.72, 0.04], [x, 0.36, z], OAK_DARK, 0.012);
    block(g, [0.3, 0.02, 0.22], [-0.25, 0.77, 0.02], "#EDE6DA", 0.006);
  });
  add("椅子", "44 × 42 cm", [0.24, 0.24], 0.9, 0.92, -1.12, (g) => {
    block(g, [0.44, 0.04, 0.42], [0, 0.45, 0], OAK, 0.012);
    block(g, [0.44, 0.38, 0.035], [0, 0.66, 0.2], OAK, 0.012);
    for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) block(g, [0.034, 0.44, 0.034], [x, 0.22, z], OAK, 0.01);
  });
  add("矮柜", "130 × 40 cm", [0.2, 0.66], 0.62, -2.16, 0.86, (g) => {
    block(g, [0.4, 0.6, 1.3], [0, 0.3, 0], "#D6B386", 0.02);
    for (const z of [-0.32, 0.32]) block(g, [0.006, 0.5, 0.6], [0.203, 0.3, z], "#C9A577", 0.002);
  });
  add("地毯", "⌀ 120 cm", [0.61, 0.61], 0.05, 0.42, 0.62, (g) => {
    const rug = cylinder(g, 0.6, 0.014, [0, 0.007, 0], "#EACBC2");
    rug.castShadow = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.515, 64), mat("#DDAA9F"));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.0145;
    g.add(ring);
  });
  add("绿植", "高 110 cm", [0.18, 0.18], 1.1, 2.12, 1.62, (g) => {
    cylinder(g, 0.16, 0.34, [0, 0.17, 0], "#EFE7DA");
    const leaf = new THREE.SphereGeometry(1, 20, 14);
    const leaves: [number, number, number, number, number][] = [
      [0, 0.72, 0, 0.2, 0.4],
      [0.12, 0.62, 0.06, 0.15, 0.32],
      [-0.11, 0.6, -0.04, 0.14, 0.3],
      [0.03, 0.9, -0.08, 0.13, 0.26],
      [-0.06, 0.52, 0.11, 0.12, 0.22],
    ];
    leaves.forEach(([x, y, z, r, h], i) => {
      const m = new THREE.Mesh(leaf, mat(i % 2 ? "#6E8A5E" : "#5F7A55", 0.7));
      m.scale.set(r, h, r);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
    });
  });
  return pieces;
}

function room(scene: THREE.Group) {
  // Base board: stacked plies, so its cut edge reads as a real model board.
  ["#D8BC90", "#EAD6B6", "#D3B488", "#ECDABB"].forEach((c, i) =>
    block(scene, [5.0, 0.06, 4.4], [0, -0.21 + i * 0.06, 0], c, 0.006),
  );
  // Floor planks with randomised seams and tones.
  const tones = ["#D9BC92", "#DEC39C", "#D3B58A", "#E2C9A2"];
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let z = FLOOR.z0; z < FLOOR.z1 - 0.01; z += 0.2) {
    const split = FLOOR.x0 + 0.6 + rand() * 3.4;
    for (const [a, b] of [[FLOOR.x0, split], [split, FLOOR.x1]]) {
      const plank = block(scene, [b - a - 0.008, 0.02, 0.192], [(a + b) / 2, 0.01, z + 0.1], tones[Math.floor(rand() * tones.length)], 0.004);
      plank.castShadow = false;
    }
  }
  const WALL = "#F5F0E7",
    H = 2.4;
  // Back wall, with a window opening (x 0.1–1.7, y 0.95–2.05).
  block(scene, [2.6, H, 0.12], [-1.2, H / 2, -2.14], WALL, 0.01);
  block(scene, [0.8, H, 0.12], [2.1, H / 2, -2.14], WALL, 0.01);
  block(scene, [1.6, 0.95, 0.12], [0.9, 0.475, -2.14], WALL, 0.01);
  block(scene, [1.6, 0.35, 0.12], [0.9, 2.225, -2.14], WALL, 0.01);
  for (const [w, h, x, y] of [
    [1.6, 0.04, 0.9, 0.97],
    [1.6, 0.04, 0.9, 2.03],
    [0.04, 1.1, 0.12, 1.5],
    [0.04, 1.1, 1.68, 1.5],
    [0.03, 1.06, 0.9, 1.5],
  ])
    block(scene, [w, h, 0.05], [x, y, -2.1], "#8C7563", 0.004);
  block(scene, [1.66, 0.03, 0.16], [0.9, 0.955, -2.05], "#EDE4D5", 0.006);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.56, 1.06),
    new THREE.MeshStandardMaterial({ color: "#BFD3E0", transparent: true, opacity: 0.28, roughness: 0.1 }),
  );
  glass.position.set(0.9, 1.5, -2.12);
  scene.add(glass);
  // Left wall, with a small framed print.
  block(scene, [0.12, H, 4.4], [-2.44, H / 2, 0], WALL, 0.01);
  block(scene, [0.025, 0.66, 0.5], [-2.37, 1.52, 0.86], "#EADFCB", 0.006);
  block(scene, [0.012, 0.52, 0.36], [-2.355, 1.52, 0.86], "#E4AFA4", 0.003);
  block(scene, [0.014, 0.16, 0.16], [-2.35, 1.46, 0.9], "#7F9FB6", 0.003);
  // Skirting boards.
  block(scene, [4.88, 0.07, 0.015], [0.06, 0.055, -2.075], "#EAE1D1", 0.003);
  block(scene, [0.015, 0.07, 4.28], [-2.375, 0.055, 0.06], "#EAE1D1", 0.003);
}

function dimension(scene: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3) {
  const m = new THREE.LineBasicMaterial({ color: "#5F84A0", transparent: true, opacity: 0.75 });
  const tick = normal.clone().multiplyScalar(0.12);
  const lines = [
    [a, b],
    [a.clone().sub(tick), a.clone().add(tick)],
    [b.clone().sub(tick), b.clone().add(tick)],
  ];
  for (const [p, q] of lines) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), m));
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
function easeOutBounce(t: number) {
  const n = 7.5625,
    d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export default function Maquette() {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const widthLabel = useRef<HTMLSpanElement>(null);
  const depthLabel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.dataset.fallback = "true";
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.insertBefore(renderer.domElement, el.firstChild);

    const scene = new THREE.Scene();
    const model = new THREE.Group();
    scene.add(model);
    const walls = new THREE.Group();
    model.add(walls);
    room(walls);
    const pieces: Piece[] = furniture().map((p) => ({ ...p, lift: 0 }));
    pieces.forEach((p) => {
      p.group.userData.piece = p;
      model.add(p.group);
    });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.14 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.24;
    ground.receiveShadow = true;
    scene.add(ground);
    const g = -0.235;
    dimension(scene, new THREE.Vector3(-2.5, g, 2.62), new THREE.Vector3(2.5, g, 2.62), new THREE.Vector3(0, 0, 1));
    dimension(scene, new THREE.Vector3(2.92, g, -2.2), new THREE.Vector3(2.92, g, 2.2), new THREE.Vector3(1, 0, 0));

    scene.add(new THREE.HemisphereLight("#fffaf2", "#d6bd98", 2.1));
    const fill = new THREE.DirectionalLight("#eef2f4", 1.7);
    fill.position.set(7, 5, 8);
    scene.add(fill);
    const sun = new THREE.DirectionalLight("#ffe6c2", 3.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.target.position.set(0.7, 0, -0.6);
    scene.add(sun, sun.target);

    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    const target = new THREE.Vector3(0.1, 0.45, 0.1);
    let radius = 15;
    // Pointer state, normalised -1..1 across the viewport; the sun and camera ease toward it.
    const aim = { x: 0.15, y: -0.1 },
      now = { x: 0.15, y: -0.1 };
    function place() {
      const yaw = THREE.MathUtils.degToRad(38 + now.x * 7),
        pitch = THREE.MathUtils.degToRad(31 - now.y * 4);
      camera.position.set(
        target.x + radius * Math.cos(pitch) * Math.sin(yaw),
        target.y + radius * Math.sin(pitch),
        target.z + radius * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);
      const az = -0.62 + (now.x + 1) * 0.62,
        el2 = 0.5 + (1 - (now.y + 1) / 2) * 0.42;
      sun.position.set(
        sun.target.position.x + 12 * Math.sin(az) * Math.cos(el2),
        12 * Math.sin(el2),
        sun.target.position.z - 12 * Math.cos(az) * Math.cos(el2),
      );
    }

    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2(),
      floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02),
      hitPoint = new THREE.Vector3();
    let hovered: Piece | null = null,
      dragging: Piece | null = null;
    const grab = new THREE.Vector3();
    let busy = 120;
    const wake = (frames = 90) => (busy = Math.max(busy, frames));

    function pick(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pieces.map((p) => p.group), true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.piece) o = o.parent;
      return (o?.userData.piece as Piece) ?? null;
    }
    function floorAt(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(floorPlane, hitPoint);
    }
    const onWindowMove = (e: PointerEvent) => {
      aim.x = (e.clientX / window.innerWidth) * 2 - 1;
      aim.y = (e.clientY / window.innerHeight) * 2 - 1;
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        const p = floorAt(e);
        if (p) {
          const [hx, hz] = dragging.half;
          dragging.group.position.x = THREE.MathUtils.clamp(p.x - grab.x, FLOOR.x0 + hx, FLOOR.x1 - hx);
          dragging.group.position.z = THREE.MathUtils.clamp(p.z - grab.z, FLOOR.z0 + hz, FLOOR.z1 - hz);
        }
        wake();
        return;
      }
      const next = pick(e);
      if (next !== hovered) {
        hovered = next;
        renderer.domElement.style.cursor = hovered ? "grab" : "";
        wake();
      }
    };
    const onDown = (e: PointerEvent) => {
      const p = pick(e);
      if (!p) return;
      const f = floorAt(e);
      if (!f) return;
      dragging = p;
      hovered = p;
      grab.set(f.x - p.group.position.x, 0, f.z - p.group.position.z);
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      el.classList.add("is-dragging");
      e.preventDefault();
      wake();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = null;
      renderer.domElement.style.cursor = hovered ? "grab" : "";
      el.classList.remove("is-dragging");
      wake();
    };
    const onLeave = () => {
      if (dragging) return;
      hovered = null;
      wake();
    };
    window.addEventListener("pointermove", onWindowMove);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointercancel", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Keep the whole board in frame on narrow screens.
      radius = 15.5 * Math.max(1, 1.3 / camera.aspect);
      camera.updateProjectionMatrix();
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const projected = new THREE.Vector3();
    function label(node: HTMLElement | null, v: THREE.Vector3) {
      if (!node) return;
      projected.copy(v).project(camera);
      node.style.transform = `translate(-50%,-50%) translate(${((projected.x + 1) / 2) * el!.clientWidth}px,${((1 - projected.y) / 2) * el!.clientHeight}px)`;
    }
    const widthAt = new THREE.Vector3(0, -0.235, 2.62),
      depthAt = new THREE.Vector3(2.92, -0.235, 0),
      tipAt = new THREE.Vector3();

    const start = performance.now();
    const introEnd = reduced ? 0 : 0.6 + pieces.length * 0.09 + 0.8;
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const elapsed = (t - start) / 1000;
      const intro = elapsed < introEnd;
      if (!intro && busy <= 0) return;
      busy--;
      const k = reduced ? 1 : 0.08;
      now.x += (aim.x - now.x) * k;
      now.y += (aim.y - now.y) * k;
      place();
      walls.scale.y = reduced ? 1 : Math.max(0.001, easeOutCubic(THREE.MathUtils.clamp((elapsed - 0.05) / 0.55, 0, 1)));
      for (const p of pieces) {
        const target = p === dragging ? 0.16 : p === hovered ? 0.07 : 0;
        p.lift += (target - p.lift) * (reduced ? 1 : 0.22);
        const d = reduced ? 1 : THREE.MathUtils.clamp((elapsed - 0.55 - p.delay * 0.09) / 0.75, 0, 1);
        p.group.visible = d > 0;
        p.group.position.y = 0.02 + p.lift + (1 - easeOutBounce(d)) * 1.6;
      }
      renderer.render(scene, camera);
      label(widthLabel.current, widthAt);
      label(depthLabel.current, depthAt);
      const shown = dragging ?? hovered;
      if (tip.current) {
        tip.current.hidden = !shown;
        if (shown) {
          tipAt.copy(shown.group.position).setY(shown.group.position.y + shown.height + 0.22);
          tip.current.firstElementChild!.textContent = shown.name;
          tip.current.lastElementChild!.textContent = shown.dims;
          label(tip.current, tipAt);
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onWindowMove);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      materials.clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="maquette" ref={host} role="img" aria-label="一间卧室的木作模型，家具可以拖动，光线随鼠标移动">
      <span className="dim-label" ref={widthLabel}>5.0 m</span>
      <span className="dim-label" ref={depthLabel}>4.4 m</span>
      <div className="piece-tip" ref={tip} hidden>
        <strong />
        <span />
      </div>
    </div>
  );
}
