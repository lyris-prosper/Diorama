export type Branch = "remove" | "edit" | "none";
/** Real-world size in centimetres: width, depth, height. */
export type Dims = { w: number; d: number; h: number };
/** Furniture a project can hold: room furniture, uploads and library pieces together. */
export const MAX_ITEMS = 60;
export type Item = {
  id: string;
  name: string;
  kind: string;
  status: "ready" | "placed" | "queued" | "running" | "failed";
  position: [number, number, number];
  rotation: number;
  scale: number;
  height: number;
  model?: string;
  thumbnail?: string;
  error?: string;
  /** Real-world size in centimetres, when the user gave it. */
  dims?: Dims;
  /** Made from a piece of furniture erased out of the room: placed where it stood once generated. */
  placeOnReady?: boolean;
  /** photo: cut out of the room photo · upload: the user's own product photo · catalog: the furniture library. */
  source?: "photo" | "upload" | "catalog";
  /** Library entry this piece came from (lib/catalog.json), for its price and shop link. */
  catalogId?: string;
};
/** Empty-room base layer: its own metric scale and a world-space shift that aligns it to the room. */
export type CleanLayer = {
  splat: string;
  splatFull?: string;
  scale: number;
  /** Turn about the vertical axis through the camera, in radians. */
  yaw?: number;
  shift: [number, number, number];
  /** False until the automatic alignment has run once. */
  aligned: boolean;
};
/** A box (centre, full size in metres, rotation about Y) whose splats are hidden from the room. */
export type Erasure = {
  id: string;
  item?: string;
  center: [number, number, number];
  size: [number, number, number];
  rotation: number;
};
export type Candidate = {
  id: string;
  name: string;
  kind: string;
  mask: string;
  box: number[];
  score: number;
  selected: boolean;
  source: "sam3" | "manual" | "local-detr";
  needsReview?: boolean;
};
export type Task = {
  id: string;
  kind: string;
  target: string;
  status: string;
  providerId?: string;
  estimatedCredits?: number;
  reservedCredits?: number;
  actualCredits?: number | null;
  billingDetails?: unknown;
  progress?: number;
  error?: string;
  attempt: number;
  output?: any;
};
export type Project = {
  id: string;
  name: string;
  mode: "demo" | "real";
  stage: string;
  original?: string;
  branch: Branch;
  intent: string;
  candidates: Candidate[];
  recognitionComplete?: boolean;
  items: Item[];
  archived?: Item[];
  tasks: Task[];
  background?: string;
  rawBackground?: string;
  mask?: string;
  cutouts?: Record<string, string>;
  originalCrops?: Record<string, string>;
  /** Clean product photos the user chose per candidate; sent to Tripo instead of the cut-out. */
  productPhotos?: Record<string, string>;
  /** Real sizes the user gave per candidate, in centimetres. */
  furnitureDims?: Record<string, Dims>;
  room?: {
    splat: string;
    splatFull?: string;
    collider?: string;
    scale: number;
    offset: number;
    source?: "generated" | "imported";
    erasures?: Erasure[];
    /** An empty-room world shown only inside erasures, to fill what the furniture hid. */
    clean?: CleanLayer;
  };
  /** 64-bit difference hash of the original photo, for reusing a room made from the same photo. */
  photoPrint?: string;
  floor: { height: number; size: number; confirmed: boolean };
  updatedAt: number;
  revision: number;
};
export const demoItems: Item[] = [
  {
    id: "demo-bed",
    name: "橡木双人床",
    kind: "bed",
    status: "ready",
    position: [0, 0, 0],
    rotation: 0,
    scale: 1,
    height: 0.86,
  },
  {
    id: "demo-desk",
    name: "原木书桌",
    kind: "desk",
    status: "ready",
    position: [0, 0, 0],
    rotation: 0,
    scale: 1,
    height: 0.76,
  },
  {
    id: "demo-cabinet",
    name: "双门落地柜",
    kind: "cabinet",
    status: "ready",
    position: [0, 0, 0],
    rotation: 0,
    scale: 1,
    height: 2.1,
  },
];
export const emptyProject = (id: string, mode: "demo" | "real"): Project => ({
  id,
  name: mode === "demo" ? "示例房间" : "我的空间",
  mode,
  stage: mode === "demo" ? "ready" : "upload",
  branch: "edit",
  intent: "",
  candidates: [],
  items: mode === "demo" ? structuredClone(demoItems) : [],
  tasks: [],
  floor: { height: 0, size: 6, confirmed: mode === "demo" },
  updatedAt: Date.now(),
  revision: 0,
});
