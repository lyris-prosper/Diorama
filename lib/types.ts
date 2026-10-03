export type Branch = "remove" | "edit" | "none";
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
  room?: { splat: string; collider?: string; scale: number; offset: number };
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
