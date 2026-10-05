"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Moon, Sun } from "lucide-react";
import { catalogItem, formatPrice, itemName } from "@/lib/catalog";
import { useLang, type Bi, type Lang } from "@/lib/i18n";

// A basswood scale model of a bedroom for the home page, furnished Japanese-calm and a little
// Instagram-cosy: a low platform bed, paper lantern, linen, plants, and real pieces from the
// furniture library (their own 3D models, with prices). Sun comes through the window; at dusk the
// lamps, lantern and string lights come on. Every piece on the floor can be picked up and moved.

type Piece = {
  group: THREE.Group;
  name: Bi;
  /** A library piece: its tooltip shows the price. */
  catalogId?: string;
  dims: string;
  half: [number, number];
  height: number;
  delay: number;
  lift: number;
};

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.86, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + roughness + JSON.stringify(extra);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra }));
  return materials.get(key)!;
}
function shadowed<T extends THREE.Object3D>(o: T, cast = true) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = true;
    }
  });
  return o;
}
function block(parent: THREE.Object3D, [w, h, d]: number[], [x, y, z]: number[], color: string | THREE.Material, radius = 0.018) {
  const r = Math.min(radius, Math.min(w, h, d) / 2 - 0.001);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, r)), typeof color === "string" ? mat(color) : color);
  m.position.set(x, y, z);
  parent.add(shadowed(m));
  return m;
}
function cylinder(parent: THREE.Object3D, r: number, h: number, [x, y, z]: number[], color: string | THREE.Material, top = r, segments = 40) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, segments), typeof color === "string" ? mat(color) : color);
  m.position.set(x, y, z);
  parent.add(shadowed(m));
  return m;
}
/** A turned shape (pot, vase, teapot) from a profile of [radius, height] points. */
function lathe(parent: THREE.Object3D, profile: [number, number][], [x, y, z]: number[], color: string | THREE.Material) {
  const m = new THREE.Mesh(
    new THREE.LatheGeometry(
      profile.map(([r, h]) => new THREE.Vector2(r, h)),
      48,
    ),
    typeof color === "string" ? mat(color, 0.7) : color,
  );
  m.position.set(x, y, z);
  parent.add(shadowed(m));
  return m;
}
// Deterministic randomness, so the model looks the same on every visit.
function rng(seed: number) {
  return () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
}
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Interior floor (metres), inside the two walls.
const FLOOR = { x0: -2.38, x1: 2.5, z0: -2.08, z1: 2.2 };
const H = 2.4;
const OAK = "#C99F70",
  OAK_LIGHT = "#DCBB8E",
  WALNUT = "#5B4433",
  LINEN = "#F3EEE4",
  SAGE = "#9DAE8F",
  BLUSH = "#E7C3B6",
  CLAY = "#C98E6E",
  WALL = "#F5F0E7";

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
/** A library piece's own model (metres, centred, standing on y = 0). */
function libraryModel(id: string) {
  const entry = catalogItem(id);
  if (!entry?.model) return Promise.reject(Error("no model"));
  return loader.loadAsync(entry.model).then((g) => shadowed(g.scene));
}

/** Cloth over a mattress (a duvet, a throw): gently rumpled on top, falling over the sides and foot. */
function cloth(w: number, d: number, top: number, color: string, seed: number) {
  const g = new THREE.PlaneGeometry(w + 0.34, d + 0.22, 56, 64);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const r = rng(seed);
  const waves = Array.from({ length: 6 }, () => [r() * 9 + 3, r() * 9 + 3, r() * 6, r() * 0.012 + 0.006]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    const ox = Math.max(0, Math.abs(x) - w / 2),
      oz = Math.max(0, z - d / 2);
    let y = top;
    for (const [a, b, c, k] of waves) y += Math.sin(x * a + c) * Math.cos(z * b - c) * k;
    const over = Math.hypot(ox, oz);
    y -= over > 0 ? Math.min(over * 1.9, 0.2) + over * 0.15 : 0;
    // What falls over an edge hangs close to it instead of sticking out.
    p.setXYZ(i, x - Math.sign(x) * Math.max(0, ox - 0.12) * 0.75, y, z - Math.max(0, oz - 0.12) * 0.75);
  }
  g.computeVertexNormals();
  return shadowed(new THREE.Mesh(g, mat(color, 0.95, { side: THREE.DoubleSide })));
}
/** Sheer linen: a hanging panel with soft vertical folds. */
function curtain(width: number, height: number, folds: number) {
  const g = new THREE.PlaneGeometry(width, height, 48, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    const u = (x / width + 0.5) * folds * Math.PI * 2;
    // Folds deepen towards the hem.
    p.setZ(i, Math.sin(u) * (0.035 + 0.02 * (0.5 - y / height)));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#FBF7EF", roughness: 1, transparent: true, opacity: 0.78, side: THREE.DoubleSide }));
  m.castShadow = true;
  return m;
}
/** A leaf outline, pointed at both ends. */
function leafGeometry(length: number, width: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width, length * 0.45, 0, length);
  s.quadraticCurveTo(-width, length * 0.45, 0, 0);
  return new THREE.ShapeGeometry(s, 6);
}
function plant(parent: THREE.Object3D, leaves: number, spread: number, height: number, leaf: THREE.BufferGeometry, colors: string[], seed: number, y0: number) {
  const r = rng(seed);
  for (let i = 0; i < leaves; i++) {
    const m = new THREE.Mesh(leaf, mat(colors[i % colors.length], 0.75, { side: THREE.DoubleSide }));
    const a = r() * Math.PI * 2,
      h = y0 + Math.pow(r(), 0.7) * height;
    const rad = spread * (0.35 + r() * 0.65) * (1 - (h - y0) / (Math.max(height, 0.01) * 1.6));
    m.position.set(Math.cos(a) * rad, h, Math.sin(a) * rad);
    m.rotation.set(-0.6 - r() * 0.6, a + Math.PI / 2, (r() - 0.5) * 0.8, "YXZ");
    parent.add(shadowed(m));
  }
}

function room(walls: THREE.Group, sky: THREE.MeshBasicMaterial) {
  // Base board: stacked plies, so its cut edge reads as a real model board.
  ["#D8BC90", "#EAD6B6", "#D3B488", "#ECDABB"].forEach((c, i) => block(walls, [5.0, 0.06, 4.4], [0, -0.21 + i * 0.06, 0], c, 0.006));
  // Floor planks with randomised seams and tones.
  const tones = ["#DCC09A", "#E2C8A3", "#D6B98F", "#E6CEAB"];
  const rand = rng(7);
  for (let z = FLOOR.z0; z < FLOOR.z1 - 0.01; z += 0.2) {
    const split = FLOOR.x0 + 0.6 + rand() * 3.4;
    for (const [a, b] of [
      [FLOOR.x0, split],
      [split, FLOOR.x1],
    ]) {
      const plank = block(walls, [b - a - 0.008, 0.02, 0.192], [(a + b) / 2, 0.01, z + 0.1], tones[Math.floor(rand() * tones.length)], 0.004);
      plank.castShadow = false;
    }
  }
  const wall = mat(WALL, 0.95);
  // Back wall, with a large window opening (x 0.1–1.7, y 0.95–2.05).
  block(walls, [2.6, H, 0.12], [-1.2, H / 2, -2.14], wall, 0.01);
  block(walls, [0.8, H, 0.12], [2.1, H / 2, -2.14], wall, 0.01);
  block(walls, [1.6, 0.95, 0.12], [0.9, 0.475, -2.14], wall, 0.01);
  block(walls, [1.6, 0.35, 0.12], [0.9, 2.225, -2.14], wall, 0.01);
  // Thin dark frame and mullion; a deep sill.
  for (const [w, h, x, y] of [
    [1.6, 0.035, 0.9, 0.965],
    [1.6, 0.035, 0.9, 2.035],
    [0.035, 1.1, 0.115, 1.5],
    [0.035, 1.1, 1.685, 1.5],
    [0.025, 1.06, 0.9, 1.5],
  ])
    block(walls, [w, h, 0.05], [x, y, -2.1], WALNUT, 0.004);
  block(walls, [1.7, 0.035, 0.2], [0.9, 0.945, -2.03], "#EFE7DA", 0.008);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 1.06), new THREE.MeshStandardMaterial({ color: "#D9E6EE", transparent: true, opacity: 0.16, roughness: 0.05 }));
  glass.position.set(0.9, 1.5, -2.12);
  walls.add(glass);
  // Outside: sky and a tree, unlit (it is the light). Just behind the opening, so the wall hides its edges.
  const view = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 1.22), sky);
  view.position.set(0.9, 1.5, -2.215);
  walls.add(view);
  // Left wall, a shade warmer (limewash).
  block(walls, [0.12, H, 4.4], [-2.44, H / 2, 0], mat("#F1E9DD", 0.97), 0.01);
  // Skirting.
  block(walls, [4.88, 0.07, 0.015], [0.06, 0.055, -2.075], "#EAE1D1", 0.003);
  block(walls, [0.015, 0.07, 4.28], [-2.375, 0.055, 0.06], "#EAE1D1", 0.003);
  // Curtain rod and sheer curtains either side of the window.
  cylinder(walls, 0.008, 2.0, [0.9, 2.2, -2.02], WALNUT).rotation.z = Math.PI / 2;
  const left = curtain(0.42, 1.55, 3.5);
  left.position.set(0.02, 1.43, -2.0);
  const right = curtain(0.42, 1.55, 3.5);
  right.position.set(1.8, 1.43, -2.0);
  walls.add(left, right);
  // Two prints above the bed: a terracotta arch; a sage sun over a line.
  const prints: [number, number, number, (c: CanvasRenderingContext2D) => void][] = [
    [
      0.36,
      0.48,
      -1.78,
      (c) => {
        c.fillStyle = "#F4ECE0";
        c.fillRect(0, 0, 360, 480);
        c.fillStyle = "#D19A7E";
        c.beginPath();
        c.moveTo(80, 400);
        c.lineTo(80, 210);
        c.arc(180, 210, 100, Math.PI, 0);
        c.lineTo(280, 400);
        c.fill();
        c.fillStyle = "#E9C9B5";
        c.beginPath();
        c.arc(240, 150, 46, 0, Math.PI * 2);
        c.fill();
      },
    ],
    [
      0.3,
      0.3,
      -1.28,
      (c) => {
        c.fillStyle = "#F2EDE3";
        c.fillRect(0, 0, 300, 300);
        c.fillStyle = "#A9B79A";
        c.beginPath();
        c.arc(150, 140, 70, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#5B4433";
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(40, 220);
        c.bezierCurveTo(110, 190, 190, 250, 260, 214);
        c.stroke();
      },
    ],
  ];
  for (const [w, h, x, draw] of prints) {
    block(walls, [w + 0.04, h + 0.04, 0.025], [x, 1.32, -2.065], OAK, 0.004);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTexture(Math.round(w * 1000), Math.round(h * 1000), draw), roughness: 0.9 }));
    art.position.set(x, 1.32, -2.05);
    walls.add(art);
  }
}

function dimension(scene: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3) {
  const m = new THREE.LineBasicMaterial({ color: "#5F84A0", transparent: true, opacity: 0.6 });
  const tick = normal.clone().multiplyScalar(0.12);
  for (const [p, q] of [
    [a, b],
    [a.clone().sub(tick), a.clone().add(tick)],
    [b.clone().sub(tick), b.clone().add(tick)],
  ])
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), m));
}

/** Night lights, switched on at dusk: emissive materials and lights at full strength. */
type Glow = { material?: THREE.MeshStandardMaterial; emissive?: number; light?: THREE.PointLight; power?: number; flicker?: boolean };

/** Everything on the floor, each piece a group that is picked up with what stands on it. */
function furnish(model: THREE.Group, glows: Glow[]) {
  const pieces: Omit<Piece, "lift">[] = [];
  const add = (name: Bi, dims: string, half: [number, number], height: number, x: number, z: number, build: (g: THREE.Group) => void, catalogId?: string) => {
    const group = new THREE.Group();
    build(group);
    group.position.set(x, 0.02, z);
    model.add(group);
    pieces.push({ group, name, dims, half, height, delay: pieces.length, catalogId });
  };
  /** A library model placed in a group, once it has loaded. */
  const put = (g: THREE.Object3D, id: string, [x, y, z]: number[], ry = 0, tilt = 0) =>
    void libraryModel(id)
      .then((o) => {
        o.position.set(x, y, z);
        o.rotation.set(tilt, ry, 0);
        g.add(o);
      })
      .catch(() => undefined);

  // Low Japanese platform bed with linen, pillows, a sage knit throw and the DYTÅG cushion.
  add({ zh: "矮床", en: "Platform bed" }, "160 × 208 cm", [0.8, 1.04], 0.7, -1.47, -1.02, (g) => {
    block(g, [1.6, 0.14, 2.08], [0, 0.07, 0], OAK, 0.03);
    block(g, [1.66, 0.04, 2.14], [0, 0.155, 0], OAK_LIGHT, 0.02);
    block(g, [1.6, 0.5, 0.05], [0, 0.4, -1.04], OAK, 0.02);
    block(g, [1.44, 0.16, 1.92], [0, 0.255, 0.02], "#FBF8F2", 0.06);
    const duvet = cloth(1.44, 1.5, 0.35, LINEN, 11);
    duvet.position.set(0, 0, 0.3);
    g.add(duvet);
    for (const x of [-0.36, 0.36]) block(g, [0.58, 0.13, 0.36], [x, 0.4, -0.72], "#FFFDF8", 0.06).rotation.x = -0.18;
    const throwBlanket = cloth(1.44, 0.42, 0.372, SAGE, 23);
    throwBlanket.position.set(0, 0.005, 0.66);
    g.add(throwBlanket);
    put(g, "dytag-cushion", [0.12, 0.33, -0.55], -0.15, -0.32);
  });
  // Bedside: NESNA with the aroma diffuser and the Kivi candle (it flickers at dusk).
  add({ zh: "NESNA 竹制床边桌", en: "NESNA bedside table" }, "", [0.2, 0.2], 0.62, -0.4, -1.84, (g) => {
    put(g, "nesna-bedside", [0, 0, 0]);
    put(g, "aroma-diffuser", [-0.07, 0.45, -0.04]);
    put(g, "kivi-votive", [0.09, 0.45, 0.05]);
    const candle = new THREE.PointLight("#ff9a4a", 0, 1.2, 2);
    candle.position.set(0.09, 0.53, 0.05);
    g.add(candle);
    glows.push({ light: candle, power: 0.9, flicker: true });
  }, "nesna-bedside");
  // The desk under the window: the mushroom lamp, an amber glass, the cream speaker, a few books.
  add({ zh: "LISABO 书桌", en: "LISABO desk" }, "", [0.6, 0.24], 1.1, 0.95, -1.82, (g) => {
    put(g, "lisabo-desk", [0, 0, 0]);
    put(g, "flowerpot-vp9", [-0.42, 0.762, -0.08]);
    put(g, "cast-amber-mug", [0.12, 0.762, 0.1]);
    put(g, "emberton-iii", [0.38, 0.762, -0.1], -0.25);
    ["#B9C4B0", "#E7C3B6", "#EFE7DA"].forEach((c, i) => (block(g, [0.24, 0.03, 0.17], [-0.12, 0.776 + i * 0.031, -0.08], c, 0.004).rotation.y = (i - 1) * 0.12));
    const lamp = new THREE.PointLight("#ffb56b", 0, 3.4, 1.6);
    lamp.position.set(-0.42, 0.96, -0.08);
    g.add(lamp);
    // The bulb under the mushroom shade, lit at dusk.
    const bulb = new THREE.MeshStandardMaterial({ color: "#fff3df", emissive: new THREE.Color("#ffb969"), emissiveIntensity: 0.05 });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), bulb);
    glow.position.set(-0.42, 0.975, -0.08);
    g.add(glow);
    glows.push({ material: bulb, emissive: 3, light: lamp, power: 2.6 });
  }, "lisabo-desk");
  add({ zh: "LISABO 椅子", en: "LISABO chair" }, "", [0.24, 0.26], 0.82, 0.92, -1.16, (g) => put(g, "lisabo-chair", [0, 0, 0], Math.PI), "lisabo-chair");
  add({ zh: "木制圆形垃圾桶", en: "Round wooden bin" }, "", [0.13, 0.13], 0.32, 1.78, -1.72, (g) => put(g, "wood-bin", [0, 0, 0]), "wood-bin");
  // Arched floor mirror leaning on the back wall, beside the window.
  add({ zh: "拱形落地镜", en: "Arched floor mirror" }, "55 × 160 cm", [0.3, 0.12], 1.6, 2.13, -1.94, (g) => {
    const lean = new THREE.Group();
    lean.rotation.x = -0.1;
    g.add(lean);
    const outline = (w: number, base: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w, base);
      s.lineTo(-w, 1.325);
      s.absarc(0, 1.325, w, Math.PI, 0, true);
      s.lineTo(w, base);
      s.lineTo(-w, base);
      return s;
    };
    const frame = outline(0.275, 0);
    frame.holes.push(outline(0.235, 0.04));
    lean.add(shadowed(new THREE.Mesh(new THREE.ExtrudeGeometry(frame, { depth: 0.035, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, curveSegments: 32 }), mat(OAK_LIGHT, 0.6))));
    // A painted reflection: pale room light with a soft diagonal sheen (cheaper and calmer than a real one).
    const glassMap = canvasTexture(128, 512, (c) => {
      const base = c.createLinearGradient(0, 0, 0, 512);
      base.addColorStop(0, "#f4f1ea");
      base.addColorStop(0.6, "#e6e3dc");
      base.addColorStop(1, "#d9cfbf");
      c.fillStyle = base;
      c.fillRect(0, 0, 128, 512);
      const sheen = c.createLinearGradient(0, 120, 128, 260);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,.7)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = sheen;
      c.fillRect(0, 0, 128, 512);
    });
    const mirrorGeo = new THREE.ShapeGeometry(outline(0.235, 0.04), 32);
    // Map the texture over the arch's own bounds.
    const uv = mirrorGeo.attributes.uv as THREE.BufferAttribute;
    const pos = mirrorGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 0.235) / 0.47, pos.getY(i) / 1.56);
    const mirror = new THREE.Mesh(mirrorGeo, new THREE.MeshStandardMaterial({ map: glassMap, roughness: 0.15, metalness: 0.1 }));
    mirror.position.z = 0.02;
    lean.add(mirror);
  });
  // Olive tree in a terracotta pot.
  add({ zh: "橄榄树", en: "Olive tree" }, "↕ 150 cm", [0.2, 0.2], 1.55, 2.12, -1.12, (g) => {
    lathe(g, [[0, 0], [0.14, 0], [0.17, 0.3], [0.18, 0.32], [0, 0.32]], [0, 0, 0], CLAY);
    cylinder(g, 0.018, 0.9, [0, 0.75, 0], "#7a6450", 0.012);
    const crown = new THREE.Group();
    crown.position.y = 0.95;
    g.add(crown);
    plant(crown, 90, 0.34, 0.55, leafGeometry(0.075, 0.016), ["#8E9F7E", "#A3B293", "#7D8E6E"], 41, 0);
  });
  // Low oak sideboard with slatted doors: pampas grass in a cream vase, books, the rattan box.
  add({ zh: "矮柜", en: "Low sideboard" }, "120 × 40 cm", [0.21, 0.62], 0.62, -2.16, 0.68, (g) => {
    block(g, [0.4, 0.5, 1.22], [0, 0.29, 0], OAK, 0.015);
    for (let i = 0; i < 11; i++) block(g, [0.006, 0.4, 0.05], [0.203, 0.29, -0.5 + i * 0.1], "#B88C5D", 0.002);
    for (const z of [-0.5, 0.5]) block(g, [0.34, 0.04, 0.04], [0, 0.02, z], WALNUT, 0.006);
    lathe(g, [[0, 0], [0.06, 0], [0.085, 0.12], [0.06, 0.24], [0.035, 0.29], [0.04, 0.3], [0, 0.3]], [0, 0.54, -0.38], "#EFE6D8");
    const r = rng(5);
    for (let i = 0; i < 7; i++) {
      const stem = new THREE.Group();
      stem.position.set(0, 0.8, -0.38);
      stem.rotation.set((r() - 0.5) * 0.7, r() * Math.PI, (r() - 0.5) * 0.7);
      cylinder(stem, 0.004, 0.62, [0, 0.12, 0], "#C9B48E", 0.003, 6);
      const plume = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 10), mat("#E9DAC0", 1));
      plume.position.y = 0.48;
      stem.add(shadowed(plume));
      g.add(stem);
    }
    ["#9DAE8F", "#D9B8A6", "#EFE7DA", "#8C7563"].forEach((c, i) => block(g, [0.2, 0.035, 0.26], [0, 0.558 + i * 0.036, 0.12], c, 0.004));
    put(g, "rattan-box", [0, 0.54, 0.42], Math.PI / 2);
  });
  // Paper floor lantern (Akari-like): rice paper on a slim black stand; it glows at dusk.
  add({ zh: "纸灯笼落地灯", en: "Paper floor lantern" }, "⌀ 45 cm", [0.24, 0.24], 1.25, -2.0, 1.66, (g) => {
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const leg = cylinder(g, 0.006, 0.55, [Math.cos(a) * 0.1, 0.27, Math.sin(a) * 0.1], "#2b2420", 0.006, 6);
      leg.rotation.set(Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16);
    }
    cylinder(g, 0.006, 0.3, [0, 0.62, 0], "#2b2420", 0.006, 6);
    const paper = new THREE.MeshStandardMaterial({ color: "#FBF4E6", roughness: 1, emissive: new THREE.Color("#ffcf8f"), emissiveIntensity: 0.05 });
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.22, 40, 28), paper);
    shade.scale.set(1, 1.28, 1);
    shade.position.y = 0.98;
    g.add(shadowed(shade, false));
    for (let i = -4; i <= 4; i++) {
      const y = (i / 4.6) * 0.27,
        rr = 0.222 * Math.sqrt(Math.max(0, 1 - (y / 0.282) ** 2));
      const rib = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0018, 4, 48), mat("#E7DCC6", 1));
      rib.rotation.x = Math.PI / 2;
      rib.position.y = 0.98 + y;
      g.add(rib);
    }
    const light = new THREE.PointLight("#ffd29a", 0, 4.5, 1.4);
    light.position.y = 0.98;
    g.add(light);
    glows.push({ material: paper, emissive: 1.25, light, power: 3.2 });
  });
  // Round jute rug with two floor cushions and a tea tray.
  add({ zh: "黄麻圆地毯", en: "Round jute rug" }, "⌀ 170 cm", [0.86, 0.86], 0.05, 0.45, 0.5, (g) => {
    const rugTex = canvasTexture(512, 512, (c) => {
      c.fillStyle = "#D9C3A0";
      c.beginPath();
      c.arc(256, 256, 256, 0, Math.PI * 2);
      c.fill();
      for (let r = 250; r > 8; r -= 9) {
        c.strokeStyle = r % 18 ? "rgba(140,108,72,.28)" : "rgba(255,246,228,.35)";
        c.lineWidth = 3;
        c.beginPath();
        c.arc(256, 256, r, 0, Math.PI * 2);
        c.stroke();
      }
    });
    const edge = new THREE.MeshStandardMaterial({ color: "#C9AE86", roughness: 1 });
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.014, 72), [edge, new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }), edge]);
    rug.position.y = 0.007;
    rug.receiveShadow = true;
    g.add(rug);
    for (const [x, z, c, r] of [
      [-0.38, 0.12, BLUSH, 0.3],
      [0.38, 0.22, SAGE, -0.25],
    ] as [number, number, string, number][]) {
      block(g, [0.5, 0.09, 0.5], [x, 0.06, z], c, 0.045).rotation.y = r;
      block(g, [0.06, 0.03, 0.06], [x, 0.11, z], mat(c, 1), 0.015).rotation.y = r;
    }
    put(g, "wood-tray", [0, 0.014, -0.18], 0.2);
    lathe(g, [[0, 0], [0.05, 0], [0.065, 0.04], [0.06, 0.07], [0.03, 0.09], [0.035, 0.1], [0, 0.11]], [-0.04, 0.034, -0.2], "#EDE4D3");
    for (const x of [0.07, 0.13]) lathe(g, [[0, 0], [0.022, 0], [0.028, 0.04], [0, 0.04]], [x, 0.034, -0.12], "#D9C7AA");
  });
  add({ zh: "SORTSÖ 小地毯", en: "SORTSÖ rug" }, "", [0.28, 0.43], 0.02, -0.34, -0.72, (g) => put(g, "sortso-rug", [0, 0, 0]), "sortso-rug");
  // Fiddle-leaf fig in a big cream pot, front right.
  add({ zh: "琴叶榕", en: "Fiddle-leaf fig" }, "↕ 170 cm", [0.24, 0.24], 1.7, 2.05, 1.58, (g) => {
    lathe(g, [[0, 0], [0.17, 0], [0.21, 0.14], [0.2, 0.36], [0.21, 0.38], [0, 0.38]], [0, 0, 0], "#EDE6DA");
    cylinder(g, 0.02, 1.2, [0, 0.95, 0], "#6f5a46", 0.015);
    const crown = new THREE.Group();
    crown.position.y = 0.6;
    g.add(crown);
    plant(crown, 110, 0.4, 0.95, leafGeometry(0.22, 0.12), ["#4F6B45", "#5F7A55", "#46603F", "#6B8660"], 17, 0.35);
  });
  return pieces;
}

/** Things fixed to the walls: the oak shelf with the bird, the cuckoo clock, hooks with a tote and a hat, string lights. */
function wallThings(model: THREE.Group, glows: Glow[]) {
  const put = (id: string, [x, y, z]: number[], ry = 0) =>
    void libraryModel(id)
      .then((o) => {
        o.position.set(x, y, z);
        o.rotation.y = ry;
        model.add(o);
      })
      .catch(() => undefined);
  put("oak-wall-shelf", [-0.4, 1.42, -2.02]);
  put("loiseau-bird", [-0.48, 1.52, -2.0]);
  lathe(model, [[0, 0], [0.04, 0], [0.05, 0.07], [0, 0.07]], [-0.24, 1.52, -2.03], CLAY);
  const trail = new THREE.Group();
  trail.position.set(-0.24, 1.6, -2.03);
  model.add(trail);
  plant(trail, 16, 0.07, 0.04, leafGeometry(0.045, 0.02), ["#6E8A5E", "#82996F"], 9, -0.12);
  put("cuckoo-clock", [-2.37, 1.48, 0.32], Math.PI / 2);
  put("oak-hooks", [-2.375, 1.55, 1.96], Math.PI / 2);
  // A canvas tote and a straw hat on the hooks.
  block(model, [0.02, 0.36, 0.3], [-2.355, 1.32, 1.84], "#EDE3D0", 0.01).rotation.x = 0.04;
  const hat = new THREE.Group();
  hat.position.set(-2.33, 1.5, 2.08);
  hat.rotation.z = Math.PI / 2 - 0.15;
  cylinder(hat, 0.2, 0.008, [0, 0, 0], "#E2C892", 0.2, 48);
  lathe(hat, [[0, 0], [0.1, 0], [0.095, 0.08], [0, 0.09]], [0, 0, 0], "#D9BC85");
  model.add(hat);
  // String lights above the bed, sagging between two pins.
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-2.36, 1.98, -2.06), new THREE.Vector3(-1.25, 1.62, -2.07), new THREE.Vector3(-0.15, 1.98, -2.06));
  model.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0025, 4), mat("#3a2c22", 0.6)));
  const bulb = new THREE.MeshStandardMaterial({ color: "#FFF4DC", emissive: new THREE.Color("#ffc46b"), emissiveIntensity: 0.15, roughness: 0.4 });
  for (let i = 1; i < 18; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), bulb);
    b.position.copy(curve.getPoint(i / 18)).add(new THREE.Vector3(0, -0.018, 0.01));
    model.add(b);
  }
  glows.push({ material: bulb, emissive: 2.2 });
  for (const t of [0.3, 0.7]) {
    const l = new THREE.PointLight("#ffc77d", 0, 2.2, 1.8);
    l.position.copy(curve.getPoint(t)).add(new THREE.Vector3(0, -0.05, 0.12));
    model.add(l);
    glows.push({ light: l, power: 0.9 });
  }
  // Little succulents on the sill.
  for (const x of [0.32, 1.48]) {
    lathe(model, [[0, 0], [0.035, 0], [0.042, 0.06], [0, 0.06]], [x, 0.963, -2.0], "#EFE6D8");
    const s = new THREE.Group();
    s.position.set(x, 1.0, -2.0);
    model.add(s);
    plant(s, 9, 0.03, 0.03, leafGeometry(0.04, 0.02), ["#8FA67E", "#A3B88F"], Math.round(x * 10), 0);
  }
}

/** The view through the window: a soft day, or dusk. */
function skyTexture(dusk: boolean) {
  return canvasTexture(512, 352, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 352);
    if (dusk) {
      g.addColorStop(0, "#36446e");
      g.addColorStop(0.55, "#b98aa2");
      g.addColorStop(1, "#f3b98a");
    } else {
      g.addColorStop(0, "#bcd7ea");
      g.addColorStop(0.7, "#e4eef2");
      g.addColorStop(1, "#f7efe0");
    }
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 352);
    // A tree's canopy, soft-edged.
    const r = rng(3);
    c.filter = "blur(6px)";
    for (let i = 0; i < 26; i++) {
      c.fillStyle = dusk ? `rgba(46,52,66,${0.55 + r() * 0.3})` : `rgba(${110 + r() * 40},${140 + r() * 30},${100 + r() * 20},${0.55 + r() * 0.3})`;
      c.beginPath();
      c.arc(300 + r() * 200, 150 + r() * 210, 30 + r() * 46, 0, Math.PI * 2);
      c.fill();
    }
    c.filter = "none";
  });
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
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export default function Maquette() {
  const { lang, t } = useLang();
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const widthLabel = useRef<HTMLSpanElement>(null);
  const depthLabel = useRef<HTMLSpanElement>(null);
  const [dusk, setDusk] = useState(false);
  // The render loop reads these without rebuilding the scene.
  const live = useRef({ lang: "zh" as Lang, dusk: false, wake: () => {} });
  useLayoutEffect(() => {
    live.current.lang = lang;
    live.current.dusk = dusk;
    live.current.wake();
  }, [lang, dusk]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const state = live.current;
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.insertBefore(renderer.domElement, el.firstChild);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.32;
    const model = new THREE.Group();
    scene.add(model);
    const walls = new THREE.Group();
    model.add(walls);
    const daySky = skyTexture(false),
      duskSky = skyTexture(true);
    const sky = new THREE.MeshBasicMaterial({ map: daySky, toneMapped: false });
    room(walls, sky);
    const glows: Glow[] = [];
    const pieces: Piece[] = furnish(model, glows).map((p) => ({ ...p, lift: 0 }));
    pieces.forEach((p) => (p.group.userData.piece = p));
    wallThings(walls, glows);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.13 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.24;
    ground.receiveShadow = true;
    scene.add(ground);
    const g = -0.235;
    dimension(scene, new THREE.Vector3(-2.5, g, 2.62), new THREE.Vector3(2.5, g, 2.62), new THREE.Vector3(0, 0, 1));
    dimension(scene, new THREE.Vector3(2.92, g, -2.2), new THREE.Vector3(2.92, g, 2.2), new THREE.Vector3(1, 0, 0));

    const hemi = new THREE.HemisphereLight("#fffaf2", "#d6bd98", 1.9);
    const fill = new THREE.DirectionalLight("#eef2f4", 1.2);
    fill.position.set(7, 5, 8);
    // The sun stands behind the back wall: it reaches the room through the window.
    const sun = new THREE.DirectionalLight("#ffe2b8", 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    sun.target.position.set(0.6, 0, -0.2);
    scene.add(hemi, fill, sun, sun.target);

    // A shaft of light from the window to the floor, and dust drifting in it.
    const beamMat = new THREE.MeshBasicMaterial({ color: "#fff1d6", transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.BufferGeometry(), beamMat);
    scene.add(beam);
    const DUST = reduced ? 0 : 160;
    const dustPos = new Float32Array(DUST * 3),
      dustSeed = new Float32Array(DUST);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: "#fff6e2", size: 0.018, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(dustGeo, dustMat));
    const opening = { x0: 0.13, x1: 1.67, y0: 0.98, y1: 2.02, z: -2.1 };
    const sunDir = new THREE.Vector3();
    const dustRand = rng(29);
    function shaft() {
      // The window's corners carried along the sunlight down to the floor.
      sunDir.subVectors(sun.target.position, sun.position).normalize();
      const down = (x: number, y: number, s = 1) => {
        const k = ((y - 0.03) / -sunDir.y) * s;
        return [x + sunDir.x * k, y + sunDir.y * k, opening.z + sunDir.z * k];
      };
      const w = [
        [opening.x0, opening.y0],
        [opening.x1, opening.y0],
        [opening.x1, opening.y1],
        [opening.x0, opening.y1],
      ];
      const v = [...w.map(([x, y]) => [x, y, opening.z]), ...w.map(([x, y]) => down(x, y))].flat();
      const idx = [
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ].flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
      beam.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      beam.geometry.setIndex(idx);
      beam.geometry.computeBoundingSphere();
      for (let i = 0; i < DUST; i++) {
        dustSeed[i] = dustRand();
        dustPos.set(down(mix(opening.x0, opening.x1, dustRand()), mix(opening.y0, opening.y1, dustRand()), dustRand() * 0.95), i * 3);
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    const target = new THREE.Vector3(0.15, 0.5, 0.15);
    let radius = 15.2;
    const aim = { x: 0.1, y: -0.1 },
      now = { x: 0.1, y: -0.1 };
    function place() {
      const yaw = THREE.MathUtils.degToRad(36 + now.x * 5),
        pitch = THREE.MathUtils.degToRad(31 - now.y * 3);
      camera.position.set(target.x + radius * Math.cos(pitch) * Math.sin(yaw), target.y + radius * Math.sin(pitch), target.z + radius * Math.cos(pitch) * Math.cos(yaw));
      camera.lookAt(target);
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
    state.wake = () => wake(120);

    function pointer(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    }
    function pick(e: PointerEvent) {
      pointer(e);
      const hit = ray.intersectObjects(
        pieces.map((p) => p.group),
        true,
      )[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.piece) o = o.parent;
      return (o?.userData.piece as Piece) ?? null;
    }
    function floorAt(e: PointerEvent) {
      pointer(e);
      return ray.ray.intersectPlane(floorPlane, hitPoint);
    }
    const onWindowMove = (e: PointerEvent) => {
      aim.x = (e.clientX / window.innerWidth) * 2 - 1;
      aim.y = (e.clientY / window.innerHeight) * 2 - 1;
      wake(40);
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
      radius = 15.2 * Math.max(1, 1.3 / camera.aspect);
      camera.updateProjectionMatrix();
      wake();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    // Paused while scrolled away or in a background tab.
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
    });
    io.observe(el);

    const projected = new THREE.Vector3();
    function label(node: HTMLElement | null, v: THREE.Vector3) {
      if (!node) return;
      projected.copy(v).project(camera);
      node.style.transform = `translate(-50%,-50%) translate(${((projected.x + 1) / 2) * el!.clientWidth}px,${((1 - projected.y) / 2) * el!.clientHeight}px)`;
    }
    const widthAt = new THREE.Vector3(0, -0.235, 2.62),
      depthAt = new THREE.Vector3(2.92, -0.235, 0),
      tipAt = new THREE.Vector3();

    // Day ↔ dusk, eased: sun, sky, ambient and every night light.
    let duskAmount = 0,
      shaftAt = -1;
    const daySun = new THREE.Color("#ffe2b8"),
      duskSun = new THREE.Color("#ff9e62"),
      dayHemi = new THREE.Color("#fffaf2"),
      duskHemi = new THREE.Color("#aeb6d8");
    function lighting(k: number, time: number) {
      if (Math.abs(k - shaftAt) > 0.02) {
        // Day: high behind the window; dusk: low and to the side, long and orange.
        const az = mix(0.32, 0.75, k),
          alt = mix(0.72, 0.36, k);
        sun.position.set(sun.target.position.x + 11 * Math.sin(az) * Math.cos(alt), 11 * Math.sin(alt), sun.target.position.z - 11 * Math.cos(az) * Math.cos(alt));
        shaft();
        shaftAt = k;
      }
      sun.color.copy(daySun).lerp(duskSun, k);
      sun.intensity = mix(3.6, 1.5, k);
      hemi.color.copy(dayHemi).lerp(duskHemi, k);
      hemi.intensity = mix(1.9, 0.55, k);
      fill.intensity = mix(1.2, 0.25, k);
      renderer.toneMappingExposure = mix(1.04, 1.12, k);
      sky.map = k > 0.5 ? duskSky : daySky;
      sky.color.setScalar(k > 0.5 ? mix(0.6, 1, (k - 0.5) * 2) : mix(1, 0.6, k * 2));
      beamMat.opacity = 0.055 * (1 - k);
      dustMat.opacity = 0.75 * (1 - k);
      scene.environmentIntensity = mix(0.32, 0.12, k);
      for (const gl of glows) {
        const f = gl.flicker && !reduced ? 0.82 + 0.18 * Math.sin(time * 13) * Math.sin(time * 7.3 + 1.1) : 1;
        if (gl.material) gl.material.emissiveIntensity = mix(0.05, gl.emissive ?? 1, k);
        if (gl.light) gl.light.intensity = (gl.power ?? 1) * k * f;
      }
    }

    const start = performance.now();
    const introEnd = reduced ? 0 : 0.6 + pieces.length * 0.08 + 0.9;
    let raf = 0,
      frame = 0;
    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const elapsed = (time - start) / 1000;
      const intro = elapsed < introEnd;
      const want = state.dusk ? 1 : 0;
      const changing = Math.abs(want - duskAmount) > 0.002;
      // Idle: dust and candlelight move gently, at half the frame rate.
      const idle = !reduced && (DUST > 0 || duskAmount > 0.01);
      frame++;
      if (!intro && busy <= 0 && !changing && !(idle && frame % 2 === 0)) return;
      busy--;
      duskAmount = reduced || !changing ? want : duskAmount + (want - duskAmount) * 0.05;
      const k = reduced ? 1 : 0.08;
      now.x += (aim.x - now.x) * k;
      now.y += (aim.y - now.y) * k;
      place();
      lighting(duskAmount, elapsed);
      if (DUST && duskAmount < 0.99) {
        for (let i = 0; i < DUST; i++) {
          const s = dustSeed[i];
          dustPos[i * 3] += Math.sin(elapsed * 0.3 + s * 40) * 0.0004;
          dustPos[i * 3 + 1] += Math.sin(elapsed * 0.22 + s * 70) * 0.0005;
        }
        dustGeo.attributes.position.needsUpdate = true;
      }
      walls.scale.y = reduced ? 1 : Math.max(0.001, easeOutCubic(THREE.MathUtils.clamp((elapsed - 0.05) / 0.55, 0, 1)));
      for (const p of pieces) {
        const lift = p === dragging ? 0.16 : p === hovered ? 0.07 : 0;
        p.lift += (lift - p.lift) * (reduced ? 1 : 0.22);
        const d = reduced ? 1 : THREE.MathUtils.clamp((elapsed - 0.55 - p.delay * 0.08) / 0.75, 0, 1);
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
          const lang = state.lang;
          const entry = shown.catalogId ? catalogItem(shown.catalogId) : undefined;
          tipAt.copy(shown.group.position).setY(shown.group.position.y + shown.height + 0.22);
          tip.current.firstElementChild!.textContent = entry ? itemName(entry, lang) : shown.name[lang];
          tip.current.lastElementChild!.textContent = entry ? `${formatPrice(entry)} · ${entry.shop}` : shown.dims;
          tip.current.classList.toggle("priced", !!entry);
          label(tip.current, tipAt);
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onWindowMove);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
          o.geometry.dispose();
          for (const m of [o.material].flat()) {
            (m as THREE.MeshStandardMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
      materials.forEach((m) => m.dispose());
      materials.clear();
      daySky.dispose();
      duskSky.dispose();
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.wake = () => {};
    };
  }, []);

  return (
    <div
      className={"maquette" + (dusk ? " dusk" : "")}
      ref={host}
      role="img"
      aria-label={t("一间卧室的木作模型：家具可以拖动，可以切换白天和黄昏", "A wooden model of a bedroom: drag the furniture, switch between day and dusk")}
    >
      <span className="dim-label" ref={widthLabel}>
        5.0 m
      </span>
      <span className="dim-label" ref={depthLabel}>
        4.4 m
      </span>
      <div className="piece-tip" ref={tip} hidden>
        <strong />
        <span />
      </div>
      <div className="maquette-controls">
        <button type="button" className="daylight" aria-pressed={dusk} aria-label={t("切换白天与黄昏", "Switch between day and dusk")} onClick={() => setDusk((v) => !v)}>
          <span className={!dusk ? "on" : ""}>
            <Sun size={14} /> {t("白天", "Day")}
          </span>
          <span className={dusk ? "on" : ""}>
            <Moon size={14} /> {t("黄昏", "Dusk")}
          </span>
        </button>
      </div>
      <p className="model-hint">{t("拖动家具试试", "Drag anything")}</p>
    </div>
  );
}
