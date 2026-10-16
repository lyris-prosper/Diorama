// The sample bedroom for demos. Its photo is recognised (same file, or the same picture re-saved),
// and a fresh space opens its Marble 1.1 room at once: calibrated, with the empty-room layer
// aligned, without World Labs. The bed in it was generated from a product photo once, and so was a
// pendant lamp to add to the room; the same photos get those models back instead of new Tripo jobs.
// Shared by the server (lib/server/demo.ts) and the page (prefilled erase box, reuse notice).

import type { Spot } from "./arrange";

export type Bi = { zh: string; en: string };
type Vec3 = [number, number, number];

// The room's own frame for placing things: the walls turn 20° from the scan's axes (lib/placement.ts
// wallHeading finds the same). u runs along the left wall towards the camera, n across to the right
// wall; the bed's head is under the window at u ≈ −5, its foot at u ≈ −2.8; the walls are at n ≈ −0.57
// (left) and n ≈ 2.45 (right, desk and wardrobe); the desk top is 0.75 m high at u −4.1…−2.7.
const FLOOR = -1.23;
const H = (20 * Math.PI) / 180;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** A point u, n in the wall frame, h metres above the floor. */
const at = (u: number, n: number, h = 0): Vec3 => [r3(u * Math.sin(H) + n * Math.cos(H)), r3(FLOOR + h), r3(u * Math.cos(H) - n * Math.sin(H))];
/** Turns that face a piece's front towards the camera, the window, the right wall or the left wall. */
const FACE = { camera: r3(H), window: r3(H + Math.PI), right: r3(H + Math.PI / 2), left: r3(H - Math.PI / 2) };

/** Hamming distance between two 64-bit hex photo prints (lib: photoPrint in Workbench.tsx). */
export function printDistance(a: string, b: string) {
  let n = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    for (; x; x &= x - 1) n++;
  }
  return n;
}
/** The SHA-256 an upload key carries: `<space>/uploads/<role>-<sha256>.png`. */
export const shaOfKey = (key?: string) => /-([0-9a-f]{64})\.png$/.exec(key ?? "")?.[1];

export const DEMO_ROOM = {
  id: "bedroom",
  name: { zh: "卧室", en: "Bedroom" } as Bi,
  photo: {
    sha256: "50feb849aed0dbd0f486ab3876fd75af7ff80e2a4a312b5c8411de1c358d21dd",
    print: "a3aba3177be6031f",
  },
  room: { splat: "presets/bedroom/room.spz", splatFull: "presets/bedroom/room-full.spz", scale: 0.678, offset: 0 },
  clean: {
    splat: "presets/bedroom/clean.spz",
    splatFull: "presets/bedroom/clean-full.spz",
    scale: 1.54,
    shift: [-0.4846, 0.063, -0.7292] as Vec3,
    yaw: 0.0262,
    aligned: true,
  },
  floor: { height: -1.23, size: 9.5, confirmed: true },
  /** Where each room file comes from: the copy already on this Mac, else Marble's public CDN (free). */
  files: [
    {
      key: "presets/bedroom/room.spz",
      local: "ec41b0a7-307a-4270-92e8-d77d96fd8cae/room/import-muthk1u8.spz",
      url: "https://cdn.marble.worldlabs.ai/dbf9b812-0db9-40c4-ae74-7fec6b05b600/75436f3c-4e00-4caf-a036-ac7f127c9ea1_ceramic_500k.spz",
    },
    {
      key: "presets/bedroom/room-full.spz",
      local: "ec41b0a7-307a-4270-92e8-d77d96fd8cae/room/import-muthk1u8-full.spz",
      url: "https://cdn.marble.worldlabs.ai/dbf9b812-0db9-40c4-ae74-7fec6b05b600/c0f822c6-f8cf-4357-800a-26a813dcf4ee_ceramic.spz",
    },
    {
      key: "presets/bedroom/clean.spz",
      local: "58214e39-b0ee-406c-aa57-b83b5261caa0/room/import-muux5zfn.spz",
      url: "https://cdn.marble.worldlabs.ai/3d1295b4-e546-42e0-8f51-b878ff47b05a/02ae7d8d-6fc3-4106-a4d4-f9d009e21062_ceramic_500k.spz",
    },
    {
      key: "presets/bedroom/clean-full.spz",
      local: "58214e39-b0ee-406c-aa57-b83b5261caa0/room/import-muux5zfn-full.spz",
      url: "https://cdn.marble.worldlabs.ai/3d1295b4-e546-42e0-8f51-b878ff47b05a/74ddc85c-1dea-4bed-aee1-0efd5a63e338_ceramic.spz",
    },
  ],
  /** The room in a sentence, for the stylist model (“帮我布置”). */
  description:
    "A rented bedroom about 3 m wide and 5 m deep, seen from the door: a double bed against the left wall with its head under the window, a wooden desk on the right wall by the window, a tall wardrobe on the right near the door; bare walls and an empty wooden floor.",
  /** Hand-set places for “帮我布置”, in the order they are filled; each faces into the room. */
  spots: [
    // On the floor, like a rug dropped by hand: the 3D view keeps the scan's floor from showing through.
    { id: "rug", zone: "floor", label: { zh: "床和书桌之间的地面（地毯）", en: "floor between the bed and the desk (a rug)" }, position: at(-3.25, 1.2), rotation: FACE.camera, suits: "rug|地毯" },
    { id: "window-corner", zone: "floor", label: { zh: "窗边、书桌旁的角落", en: "corner by the window, next to the desk" }, position: at(-4.55, 2.05), rotation: FACE.left, suits: "plant|绿植|植物|floor-lamp|落地灯", room: 110 },
    { id: "reading", zone: "floor", label: { zh: "右侧衣柜前（单椅）", en: "right side, in front of the wardrobe (a chair)" }, position: at(-2.35, 1.85), rotation: FACE.left, suits: "armchair|lounge|chair|椅", room: 90 },
    { id: "chair-light", zone: "floor", label: { zh: "单椅旁（落地灯）", en: "beside that chair (a floor lamp)" }, position: at(-1.8, 2.15), rotation: FACE.left, suits: "lamp|灯", room: 65 },
    { id: "bed-foot", zone: "floor", label: { zh: "床尾", en: "at the foot of the bed" }, position: at(-2.45, 0.45), rotation: FACE.camera, suits: "bench|ottoman|stool|凳", room: 130 },
    { id: "bedside", zone: "floor", label: { zh: "床头右侧，窗下", en: "right of the bed's head, under the window" }, position: at(-4.95, 1.4), rotation: FACE.left, suits: "side-table|bedside|nightstand|床边|床头", room: 45 },
    { id: "desk-left", zone: "top", label: { zh: "书桌靠窗一端", en: "on the desk, window end" }, position: at(-3.85, 2.2, 0.75), rotation: FACE.left, suits: "lamp|灯" },
    { id: "desk-right", zone: "top", label: { zh: "书桌靠门一端", en: "on the desk, door end" }, position: at(-3.05, 2.15, 0.75), rotation: FACE.left },
    { id: "bed-top", zone: "top", label: { zh: "床头的床面", en: "on the bed, by the pillows" }, position: at(-4.7, 0.45, 0.55), rotation: FACE.camera, suits: "cushion|pillow|靠垫|抱枕" },
    { id: "wall-desk", zone: "wall", label: { zh: "书桌上方的墙", en: "wall above the desk" }, position: at(-3.5, 2.43, 1.2), rotation: FACE.left, suits: "art|frame|picture|poster|画" },
    { id: "wall-bed", zone: "wall", label: { zh: "床边的左墙", en: "left wall beside the bed" }, position: at(-3.9, -0.55, 1.2), rotation: FACE.right },
    { id: "wall-foot", zone: "wall", label: { zh: "床尾的左墙", en: "left wall by the foot of the bed" }, position: at(-2.3, -0.55, 1.35), rotation: FACE.right },
  ] satisfies Spot[] as Spot[],
  /** Furniture of this room that was already generated, with the box that erases it from the scan. */
  furniture: [
    {
      kind: "bed",
      name: { zh: "床", en: "Bed" } as Bi,
      dims: { w: 150, d: 200, h: 80 },
      erase: { center: [-0.9497, -0.75, -3.9059] as Vec3, size: [2.07, 0.94, 2.45] as Vec3, rotation: 0.4364 },
      /** Where the generated model stands once placed; its front differs from the box by ~95°. */
      placed: { position: [-0.9131, -1.23, -3.8309] as Vec3, rotation: -1.2217 },
      photo: { sha256: "457bfcbece19b66ff3a46f73dd188b8cecfbf979d36b55f49fd8ff0d52c0134e", print: "" },
      model: "/demo/bed.glb",
      thumbnail: "/demo/bed.webp",
    },
  ],
  /**
   * Pieces to add to the room (“添加家具”), already made in high detail from their product photo
   * (resources/demo/): the same photo puts the model on the shelf at once. The pendant hangs from
   * the ceiling once placed; its size includes the rod.
   */
  extras: [
    {
      kind: "pendant",
      name: { zh: "木纹叠层吊灯", en: "Layered wood pendant" } as Bi,
      dims: { w: 43, d: 43, h: 80 },
      photo: { sha256: "5f6779a81cf8acbecdb41922c5430c717e0ab775247d63396439d0cf7363ebf0", print: "" },
      model: "/demo/pendant.glb",
      thumbnail: "/demo/pendant.webp",
    },
  ],
};
/** A piece of the sample bedroom that stands in the room and can be erased from the scan (the bed). */
export type DemoPiece = (typeof DEMO_ROOM.furniture)[number];
/** A piece made from a product photo once, in the room or added to it. */
export type DemoModel = Omit<DemoPiece, "erase" | "placed"> & Partial<Pick<DemoPiece, "erase" | "placed">>;

export const isDemoPhoto = (key?: string, print?: string) =>
  shaOfKey(key) === DEMO_ROOM.photo.sha256 || (!!print && printDistance(print, DEMO_ROOM.photo.print) <= 8);
/** A furniture photo this room already has a model for: the same file, or nearly the same picture. */
export const demoPieceFor = (sha?: string, print?: string): DemoModel | undefined =>
  [...DEMO_ROOM.furniture, ...DEMO_ROOM.extras].find(
    (f) => (!!sha && f.photo.sha256 === sha) || (!!print && !!f.photo.print && printDistance(print, f.photo.print) <= 6),
  );
/** The known piece whose erase box covers this floor point (x, z), if any. */
export function demoPieceAt(x: number, z: number) {
  return DEMO_ROOM.furniture.find((f) => {
    const [cx, , cz] = f.erase.center, c = Math.cos(f.erase.rotation), s = Math.sin(f.erase.rotation);
    const dx = x - cx, dz = z - cz;
    // World to box: the inverse of three.js rotation.y, as in lib/placement.ts.
    const u = dx * c - dz * s, v = dx * s + dz * c;
    return Math.abs(u) <= f.erase.size[0] / 2 + 0.1 && Math.abs(v) <= f.erase.size[2] / 2 + 0.1;
  });
}

/** Names the app gives spaces by itself, shown in the page's language. */
const DEFAULT_NAMES: Record<string, string> = { 我的空间: "My space", 示例房间: "Sample room", 卧室: "Bedroom" };
export const isDefaultName = (name: string) => name in DEFAULT_NAMES;
export const spaceName = (name: string, lang: "zh" | "en") => (lang === "en" ? DEFAULT_NAMES[name] ?? name : name);
