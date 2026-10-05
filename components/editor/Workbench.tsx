"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { recognizeFurniture } from "@/lib/recognition";
import { localStatus, localVisionJob, base64Blob } from "@/lib/local-vision";
import { typicalSizes } from "@/lib/furniture-kinds";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Upload,
  Undo2,
  Redo2,
  Save,
  Plus,
  Minus,
  RotateCcw,
  RotateCw,
  Move,
  MousePointer2,
  X,
  Check,
  ChevronDown,
  ChevronLeft,
  Image as ImageIcon,
  Box,
  Scan,
  Layers,
  Maximize,
  ArrowUpFromLine,
  Trash2,
  Info,
  Loader2,
  AlertCircle,
  CheckCircle2,
  PanelRightClose,
  SlidersHorizontal,
  ArrowRight,
  Download,
  ArrowUpRight,
  Library,
  ArrowDownToLine,
} from "lucide-react";
import { MAX_ITEMS, type Project, type Item, type Branch, type Candidate, type Task, type Erasure, type Dims } from "@/lib/types";
import { availabilityLabel, catalogItem, formatOriginal, formatPrice, formatUSD, marketLabel } from "@/lib/catalog";
import { productPhoto } from "@/lib/photo";
import CatalogPanel from "./CatalogPanel";
import AddFurnitureDialog, { type NewPiece } from "./AddFurnitureDialog";
import FurnitureInputs from "./FurnitureInputs";
import type { FloorFit } from "./Scene";
import {
  prepareImages,
  preserveOutside,
  canvas,
  blob,
  loadImage,
} from "@/lib/image";
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => (
    <div className="canvas-loading">
      <Loader2 className="spin" />
      正在准备画布
    </div>
  ),
});
const Maquette = dynamic(() => import("./Maquette"), {
  ssr: false,
  loading: () => <div className="maquette" />,
});
function Mark() {
  // An isometric room corner: two walls and a floor, as on a model board.
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 4 4 10v12l12 6 12-6V10L16 4Z" fill="#E4CDA8" />
      <path d="M4 10v12l12 6V16L4 10Z" fill="#C99F70" />
      <path d="M16 16v12l12-6V10l-12 6Z" fill="#F5F0E7" />
      <path d="M16 4 4 10l12 6 12-6L16 4Z" fill="none" stroke="#3A2C22" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4 10v12l12 6 12-6V10M16 16v12" fill="none" stroke="#3A2C22" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
// 64-bit difference hash of a photo: survives re-saving and re-compression, so the same photo
// can be recognised and its existing room reused.
async function photoPrint(src: string) {
  const img = await loadImage(src);
  const mid = canvas(72, 64);
  mid.getContext("2d")!.drawImage(img, 0, 0, 72, 64);
  const small = canvas(9, 8),
    ctx = small.getContext("2d")!;
  ctx.drawImage(mid, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const lum = (i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  let hex = "";
  for (let n = 0; n < 64; n += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) {
      const y = Math.floor((n + b) / 8), x = (n + b) % 8, i = (y * 9 + x) * 4;
      nibble = (nibble << 1) | (lum(i) > lum(i + 4) ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}
// Typical sizes (cm) to start the erase box with; the user corrects them.
const TYPICAL = typicalSizes;
type EditDraft = {
  kind: string;
  name: string;
  w: string;
  d: string;
  h: string;
  pad: number;
  photo: Blob | null;
  photoURL: string;
  agree: boolean;
  erase: Erasure;
  /** Horizontal camera direction when the box was placed: nudges are relative to it. */
  view: [number, number];
  /** "adjust" refits an erasure that already exists (no photo, no generation). */
  mode: "new" | "adjust";
};
// Stored keys go through the asset route; library files are public paths already.
const url = (k?: string) =>
  !k ? "" : k.startsWith("/") ? k : "/api/assets?key=" + encodeURIComponent(k);
// Keeps the user's unsaved layout while taking what generation produced on the server:
// a finished model, its thumbnail and status.
function mergeItems(local: Item[], server: Item[]) {
  const fresh = new Map(server.map((i) => [i.id, i]));
  return local.map((i) => {
    const s = fresh.get(i.id);
    if (!s || !(i.status === "queued" || i.status === "running" || (!i.model && s.model))) return i;
    return { ...i, status: s.status, model: s.model, thumbnail: s.thumbnail, error: s.error };
  });
}
async function api(body: any): Promise<any> {
  const r = await fetch("/api/workbench", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error || "操作失败，请重试。");
  return j;
}
async function upload(id: string, role: string, file: Blob): Promise<any> {
  const f = new FormData();
  f.append("id", id);
  f.append("role", role);
  f.append("file", file, "image.png");
  const r = await fetch("/api/workbench", { method: "POST", body: f });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
}
/** Height above the floor in cm, typed directly: hanging a shelf at 150 cm should not take 30 clicks. */
function LiftInput({ id, value, onCommit }: { id: string; value: number; onCommit: (cm: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const v = Math.round(Number(draft));
    if (draft.trim() && Number.isFinite(v) && v !== value) onCommit(Math.max(0, Math.min(300, v)));
    else setDraft(String(value));
  };
  return (
    <span className="lift">
      <input
        id={id}
        inputMode="numeric"
        aria-label="离地高度（厘米）"
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      cm
    </span>
  );
}
const canResume = (t: Task) => !!t.providerId && !t.output?.terminal;
const canRetry = (t: Task) => ["failed", "paused", "uncertain"].includes(t.status) &&
  (canResume(t) || (t.status === "failed" && (t.output?.terminal || t.output?.definiteRejection) && t.attempt < 3));
const retryLabel = (t: Task) => canResume(t) ? "继续查询原任务（不重新生成）" : `重新生成（预计 ${t.estimatedCredits ?? 0} 积分）`;
export default function Workbench() {
  const [p, setP] = useState<Project | null>(null),
    [boot, setBoot] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [drawer, setDrawer] = useState(false),
    [branch, setBranch] = useState<Branch>("edit"),
    [intent, setIntent] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [thumbs, setThumbs] = useState<Record<string, string>>({}),
    [reset, setReset] = useState(0),
    [focus, setFocus] = useState(0),
    [reference, setReference] = useState(true),
    [history, setHistory] = useState<Item[][]>([]),
    [future, setFuture] = useState<Item[][]>([]),
    [dirty, setDirty] = useState(false),
    [choices, setChoices] = useState<string[]>([]),
    [manual, setManual] = useState(false),
    [points, setPoints] = useState<number[][]>([]),
    [manualName, setManualName] = useState("书桌"),
    [services, setServices] = useState<any>(null),
    [showServices, setShowServices] = useState(false),
    [approved, setApproved] = useState(false),
    [processed, setProcessed] = useState<Blob | null>(null),
    [processedURL, setProcessedURL] = useState(""),
    [quality, setQuality] = useState<number | null>(null),
    [floorOpen, setFloorOpen] = useState(false),
    [savedAt, setSavedAt] = useState(""),
    [dragOver, setDragOver] = useState(false),
    [floorDraft, setFloorDraft] = useState(""),
    [floorNote, setFloorNote] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState(""),
    [roomPick, setRoomPick] = useState<{ point: [number, number, number]; x: number; y: number; forward: [number, number] } | null>(null),
    [editDraft, setEditDraft] = useState<EditDraft | null>(null),
    [panel, setPanel] = useState<"shelf" | "library">("shelf"),
    [addOpen, setAddOpen] = useState(false),
    [cleanOpen, setCleanOpen] = useState(false),
    [cleanText, setCleanText] = useState("");
  const editPhotoRef = useRef<HTMLInputElement>(null);
  const lastView = useRef<[number, number]>([0, -1]);
  const engineView = () => lastView.current;
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionMessage, setRecognitionMessage] = useState("");
  const [recognitionPercent, setRecognitionPercent] = useState<number | undefined>();
  const [recognitionError, setRecognitionError] = useState("");
  const [imageRepair, setImageRepair] = useState<boolean | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [generationReady, setGenerationReady] = useState({world:false,furniture:false});
  const [repairMessage, setRepairMessage] = useState("");
  const repairAbort = useRef<AbortController | null>(null);
  const recognitionAbort = useRef<AbortController | null>(null);
  const attemptedPhoto = useRef("");
  const masksRef = useRef<Record<string, ImageData>>({});
  const fileRef = useRef<HTMLInputElement>(null),
    viewRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(p);
  stateRef.current = p;
  async function retryTask(taskId: string) {
    const current = stateRef.current;
    const task = current?.tasks.find(t => t.id === taskId);
    if (!current || !task || !canRetry(task)) throw Error("待核对：此任务不能再次提交，请先核对服务商记录。");
    const confirmPaid = !canResume(task);
    if (confirmPaid && !window.confirm(`${retryLabel(task)}？这会创建新任务并可能扣费。`)) return current;
    return api({action:"retry",id:current.id,task:task.id,confirmPaid});
  }
  useEffect(() => {
    Promise.all([localStatus(),fetch("/api/workbench?capabilities=1").then(r=>r.json() as Promise<{imageRepair:boolean;world:boolean;furniture:boolean}>) ]).then(([local,j])=>{
      setLocalMode(!!local?.local);setImageRepair(local?.local?!!local.inpainting:!!j.imageRepair);
      setGenerationReady({world:!!j.world,furniture:!!j.furniture});
    }).catch(()=>{});
    fetch("/api/workbench")
      .then(async (r) => {
        const j: any = await r.json();
        if (!r.ok) throw Error(j.error);
        setP(j);
        if (j?.original && !j.photoPrint)
          void photoPrint(url(j.original))
            .then((print) => api({ action: "set-print", id: j.id, print }))
            .then((saved: Project) => setP((cur) => (cur && cur.id === saved.id ? { ...cur, photoPrint: saved.photoPrint } : cur)))
            .catch(() => undefined);
        if (j) {
          setBranch(j.branch);
          setIntent(j.intent);
          setChoices(
            j.candidates
              .filter((c: Candidate) => c.selected)
              .map((c: Candidate) => c.id),
          );
          if (j.stage !== "ready") setDrawer(true);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (
      !p ||
      !p.tasks.some((t) =>
        ["queued", "running", "submitting"].includes(t.status),
      )
    )
      return;
    let active = true,
      working = false;
    const t = setInterval(async () => {
      if (working) return;
      working = true;
      try {
        const next = await api({ action: "tick", id: p.id });
        if (active) {
          setP((current) =>
            current && dirty
              ? { ...next, items: mergeItems(current.items, next.items), floor: current.floor }
              : next,
          );
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        working = false;
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [p?.id, p?.tasks.map((t) => t.status).join(), dirty]);
  useEffect(() => {
    if (p?.stage !== 'review' || !p.rawBackground || !p.mask || !p.original) return;
    let active = true;
    // Local repair already keeps every pixel beyond its slightly grown, feathered edge untouched.
    // Re-clipping to the tight outline here would restore the furniture's edge pixels as a ghost.
    (localMode
      ? fetch(url(p.rawBackground)).then((r) => r.blob()).then((blob) => ({ blob, outsideDifference: 0 }))
      : preserveOutside(p.original, p.rawBackground, p.mask))
      .then((r) => {
        if (active) {
          setProcessed(r.blob);
          setProcessedURL((old) => {
            if (old) URL.revokeObjectURL(old);
            return URL.createObjectURL(r.blob);
          });
          setQuality(r.outsideDifference);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [p?.rawBackground,p?.mask,p?.original,p?.stage,localMode]);
  useEffect(() => {
    if (!p) return;
    for (const c of p.candidates)
      loadImage(url(c.mask))
        .then((img) => {
          const cv = canvas(300, 300);
          cv.getContext("2d")!.drawImage(img, 0, 0, 300, 300);
          masksRef.current[c.id] = cv
            .getContext("2d")!
            .getImageData(0, 0, 300, 300);
        })
        .catch(() => {});
  }, [p?.candidates]);
  async function autoRecognize(project: Project) {
    if (!project.original) return;
    recognitionAbort.current?.abort();
    const controller = new AbortController();
    recognitionAbort.current = controller;
    setRecognizing(true); setRecognitionError(""); setRecognitionPercent(undefined);
    setRecognitionMessage("正在准备家具识别");
    try {
      const response = await fetch(url(project.original), {signal:controller.signal});
      if (!response.ok) throw Error("原图暂时无法读取，请重试。");
      const results = await recognizeFurniture(await response.blob(), (message,percent)=>{
        setRecognitionMessage(message); setRecognitionPercent(percent);
      }, controller.signal);
      setRecognitionMessage("正在保存家具轮廓"); setRecognitionPercent(undefined);
      const candidates = [];
      for (let i=0; i<results.length; i++) {
        if (controller.signal.aborted) return;
        const {mask,...candidate} = results[i];
        const saved = await upload(project.id,"auto-mask-"+i,mask);
        candidates.push({...candidate,mask:saved.key});
      }
      if (controller.signal.aborted) return;
      const next = await api({action:"recognize",id:project.id,original:project.original,candidates});
      if (controller.signal.aborted) return;
      setP(next); setChoices(next.candidates.filter((c:Candidate)=>c.selected).map((c:Candidate)=>c.id));
      setToast(candidates.length ? `已找到 ${candidates.length} 件候选家具，请核对轮廓。` : "未找到明确家具，可以手动圈选或按空房继续。");
    } catch(e) {
      if (!controller.signal.aborted) setRecognitionError((e as Error).message);
    } finally {
      if (recognitionAbort.current===controller) {
        setRecognizing(false); recognitionAbort.current=null;
      }
    }
  }
  useEffect(()=>{
    if (p?.mode === "real" && p.original && ["branch","confirm"].includes(p.stage) && !p.recognitionComplete && !p.candidates.length && attemptedPhoto.current!==p.original) {
      attemptedPhoto.current=p.original;
      void autoRecognize(p);
    }
  },[p?.id,p?.original]);
  useEffect(()=>()=>{recognitionAbort.current?.abort();repairAbort.current?.abort();},[]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setRepairMessage("");
      repairAbort.current=null;
    }
  };
  async function create(mode: "real" | "demo") {
    recognitionAbort.current?.abort();
    repairAbort.current?.abort();
    setRecognitionError(""); setBranch("edit"); setIntent("");
    const next = await api({ action: "create", mode });
    setP(next);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setSelected(null);
    setPending(null);
    setChoices([]);
    setProcessed(null);
    setProcessedURL("");
    setApproved(false);
    setDrawer(mode === "real");
    return next;
  }
  async function receive(file?: File) {
    if (!file) return;
    await run(async () => {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw Error("请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。");
      const next = await create("real");
      const r = await upload(next.id, "original", file);
      const source = URL.createObjectURL(file);
      const print = await photoPrint(source).catch(() => null);
      URL.revokeObjectURL(source);
      const project: Project = print ? await api({ action: "set-print", id: r.project.id, print }) : r.project;
      setP(project);
      setDrawer(project.stage !== "ready");
    });
  }
  function changeItems(items: Item[]) {
    if (!p) return;
    setHistory((h) => [...h.slice(-39), structuredClone(p.items)]);
    setFuture([]);
    setP({ ...p, items });
    setDirty(true);
  }
  function patch(id: string, data: Partial<Item>) {
    if (p)
      changeItems(p.items.map((i) => (i.id === id ? { ...i, ...data } : i)));
  }
  function undo() {
    if (!p || !history.length) return;
    setFuture((f) => [...f, structuredClone(p.items)]);
    setP({ ...p, items: history[history.length - 1] });
    setHistory((h) => h.slice(0, -1));
    setDirty(true);
    setSelected(null);
  }
  function redo() {
    if (!p || !future.length) return;
    setHistory((h) => [...h, structuredClone(p.items)]);
    setP({ ...p, items: future[future.length - 1] });
    setFuture((f) => f.slice(0, -1));
    setDirty(true);
  }
  const clock = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  // The floor is stored as soon as it is known, so calibration is never lost to an unsaved reload.
  async function persistFloor(floor: Project["floor"], message?: string, roomScale?: number) {
    const current = stateRef.current;
    if (!current) return;
    try {
      const next = await api({ action: "save", id: current.id, items: current.items, floor, roomScale });
      setP(next);
      setDirty(false);
      setSavedAt(clock());
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function floorDetected(fit: FloorFit | null) {
    const current = stateRef.current;
    if (!current?.room || current.mode !== "real" || current.floor.confirmed) return;
    if (!fit) {
      setFloorNote("没能从房间结构里找到地板，请拖动滑块，让网格贴在地板上。");
      setFloorDraft(String(current.floor.height));
      setFloorOpen(true);
      return;
    }
    // Draft worlds carry no real-world scale. Assume a 2.7 m ceiling (or a 1.5 m camera height when
    // no ceiling was found) so furniture in metres appears at its true size. A world that already
    // came with a metric scale (room.scale ≠ 1) is left as it is.
    let k = 1;
    if (current.room.scale === 1) {
      const span = fit.ceiling !== null ? fit.ceiling - fit.height : NaN;
      k = span > 0.5 && span < 20 ? 2.7 / span : 1.5 / Math.max(0.2, -fit.height);
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    void persistFloor(
      // 0.4 m margin (in metres, after scaling) on each side of the detected floor footprint.
      { height: r2(fit.height * k), size: Math.min(20, Math.max(2, Math.ceil((fit.size * k + 0.8) * 2) / 2)), confirmed: true },
      "已自动找到地面，并按真实尺寸校正了房间比例。",
      k === 1 ? undefined : Math.round(current.room.scale * k * 1000) / 1000,
    );
  }
  function setFloor(change: Partial<Project["floor"]>) {
    if (!p) return;
    const floor = { ...p.floor, ...change, confirmed: false };
    floor.height = Math.round(Math.max(-10, Math.min(10, floor.height)) * 100) / 100;
    // Placed furniture stands on the floor, so it moves with it.
    const dy = floor.height - p.floor.height;
    const items = dy
      ? p.items.map((i) => (i.status === "placed" ? { ...i, position: [i.position[0], i.position[1] + dy, i.position[2]] as Item["position"] } : i))
      : p.items;
    setP({ ...p, floor, items });
    if (change.height !== undefined) setFloorDraft(String(floor.height));
    setDirty(true);
  }
  function commitFloorDraft() {
    const v = Number(floorDraft);
    if (floorDraft.trim() && Number.isFinite(v)) setFloor({ height: v });
    else setFloorDraft(String(p?.floor.height ?? 0));
  }
  const save = () =>
    run(async () => {
      if (!p) return;
      const next = await api({
        action: "save",
        id: p.id,
        items: p.items,
        floor: p.floor,
      });
      setP(next);
      setDirty(false);
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setToast("布局已保存，刷新后可继续。");
    });
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (e.key === "Escape") {
        setPending(null);
        setSelected(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const item = p?.items.find((i) => i.id === selected);
  // The library needs somewhere to put things: the demo room or a generated/imported room.
  const libraryOpen = !!p && (p.mode === "demo" || !!p.room);
  const tab = panel === "library" && libraryOpen ? "library" : "shelf";
  const inRoom: Record<string, number> = {};
  for (const i of p?.items ?? []) if (i.catalogId) inRoom[i.catalogId] = (inRoom[i.catalogId] ?? 0) + 1;
  const running = p?.tasks.some((t) =>
    ["queued", "running", "submitting"].includes(t.status),
  );
  async function detect() {
    if (!p) return;
    const next = await api({ action: "select-candidates", id: p.id, branch, intent, selected: choices });
    setChoices(next.candidates.filter((c:Candidate)=>c.selected).map((c:Candidate)=>c.id));
    setP(next);
  }
  async function addManual() {
    if (!p || points.length < 3) return;
    recognitionAbort.current?.abort();
    const image = await loadImage(url(p.original));
    const c = canvas(image.width, image.height),
      cx = c.getContext("2d")!;
    cx.clearRect(0, 0, c.width, c.height);
    cx.fillStyle = "white";
    cx.beginPath();
    points.forEach(([x, y], i) =>
      i
        ? cx.lineTo(x * c.width, y * c.height)
        : cx.moveTo(x * c.width, y * c.height),
    );
    cx.closePath();
    cx.fill();
    const r = await upload(p.id, "manual-mask", await blob(c));
    const next = await api({
        action: "manual",
        id: p.id,
        branch,
        intent,
        name: manualName,
        mask: r.key,
      });
    setP(next);
    setChoices(v=>[...v,next.candidates[next.candidates.length-1].id]);
    setManual(false);
    setPoints([]);
  }
  async function prepare() {
    if (!p?.original) return;
    if (imageRepair === false) throw Error("家具识别和选择已保留。背景修复服务还未连接，暂时无法移除家具；没有消耗生成积分。");
    const selected = p.candidates.filter((c) => choices.includes(c.id));
    if (!selected.length) throw Error("请勾选本次要处理的家具。");
    const controller=new AbortController();repairAbort.current=controller;
    setApproved(false);setRepairMessage("正在准备家具轮廓和透明图片");
    const r = await prepareImages(p.original, selected);
    const m = await upload(p.id, "union-mask", r.mask);
    const cutouts: Record<string, string> = {},
      originalCrops: Record<string, string> = {};
    if (p.branch === "edit")
      for (const [id, cut] of Object.entries(r.cuts)) {
        cutouts[id] = (await upload(p.id, "cutout-" + id, cut)).key;
        originalCrops[id] = (await upload(p.id, "crop-" + id, r.crops[id])).key;
      }
    let localBackground;
    if(localMode){
      try {
        if(controller.signal.aborted)throw Error('已取消处理，照片和选择已保留。');
        const original=await fetch(url(p.original),{signal:controller.signal}).then(r=>r.blob());
        const result=await localVisionJob('inpaint',original,r.mask,setRepairMessage,controller.signal);
        if(controller.signal.aborted)return;
        setRepairMessage("正在保存修复结果");
        localBackground=(await upload(p.id,'local-background',base64Blob(result.image))).key;
      }finally{repairAbort.current=null;setRepairMessage("");}
    }
    setProcessed(null);setProcessedURL("");
    setP(
      await api({
        action: "prepare",
        id: p.id,
        original:p.original,
        localBackground,
        selected: choices,
        mask: m.key,
        cutouts,
        originalCrops,
      }),
    );
  }
  async function generate(skip = false) {
    if (!p) return;
    let background;
    if (!skip) {
      if (!processed || !approved) throw Error("请先检查并确认处理后的图片。");
      background = (await upload(p.id, "background", processed)).key;
    }
    setP(
      await api({ action: "generate", id: p.id, skip, approved, background }),
    );
  }
  function place(id: string, pos: [number, number, number]) {
    const current = stateRef.current;
    if (!current?.floor.confirmed) {
      setFloorOpen(true);
      return;
    }
    if (id.startsWith("catalog:")) {
      void run(() => addFromCatalog(id.slice(8), pos));
      return;
    }
    if (current.items.find((i) => i.id === id)?.status === "placed") {
      setSelected(id);
      setPending(null);
      return;
    }
    patch(id, { status: "placed", position: pos });
    setSelected(id);
    setPending(null);
    const placed = current.items.find((i) => i.id === id);
    setToast(placed?.catalogId && catalogItem(placed.catalogId)?.wall ? "这是壁挂家具：拖到墙边，再用“离地”把它挂上去。" : "家具已放置，可直接拖动调整。");
  }
  function selectCard(i: Item) {
    if (i.status === "placed") {
      setSelected(i.id);
      setPending(null);
      setFocus((v) => v + 1);
    } else if (i.status === "ready") {
      if (!p?.floor.confirmed) {
        setFloorOpen(true);
        setToast("先校准地面，再摆放家具。");
        return;
      }
      setSelected(null);
      setPending(i.id);
    }
  }
  const thumb = useCallback(
    (id: string, u: string) => setThumbs((t) => ({ ...t, [id]: u })),
    [],
  );
  function goHome() {
    if (!p) return;
    if (dirty && !window.confirm("有未保存的调整，确定回到首页吗？")) return;
    recognitionAbort.current?.abort();
    repairAbort.current?.abort();
    setP(null);
    setDrawer(false);
    setFloorOpen(false);
    setSelected(null);
    setPending(null);
    setDirty(false);
    setHistory([]);
    setFuture([]);
  }
  const demo = () => run(async () => { await create("demo"); });
  // A room already generated on the Marble website (often a better model than the draft) is
  // brought in from its public file links, at no credit cost.
  async function importWorld() {
    if (!p) return;
    const next = await api({ action: "import-world", id: p.id, source: importText });
    setP(next);
    setImportText("");
    setImportOpen(false);
    setDrawer(false);
    setToast("已导入 Marble 房间，正在对齐地面。");
  }
  // Clicking furniture in the room: offer to make it editable.
  function pickRoom(point: [number, number, number], screen: { x: number; y: number }, forward: [number, number]) {
    if (!p || p.mode !== "real" || !p.room || editDraft || pending) return;
    setSelected(null);
    lastView.current = forward;
    setRoomPick({ point, ...screen, forward });
  }
  // The erase box sits on the floor, sized from the furniture plus a margin, centred half a depth
  // behind the clicked surface (seen from the camera).
  // The margin applies on every side and on top (headboards, lamps on desks); the bottom stays
  // 1 cm above the floor so the floor itself is kept.
  function eraseBox(d: Pick<EditDraft, "w" | "d" | "h" | "pad">, center: [number, number], rotation: number, id = "draft"): Erasure {
    const w = Number(d.w) / 100 || 0.5, dep = Number(d.d) / 100 || 0.5, h = Number(d.h) / 100 || 0.5;
    const floorY = p?.floor.height ?? 0, bottom = floorY + 0.01, sizeY = h + d.pad + 0.02;
    return { id, center: [center[0], bottom + sizeY / 2, center[1]], size: [w + 2 * d.pad, sizeY, dep + 2 * d.pad], rotation };
  }
  function startEdit() {
    if (!roomPick) return;
    const t = TYPICAL.desk;
    const base = { w: String(t.w), d: String(t.d), h: String(t.h), pad: 0.12 };
    const [fx, fz] = roomPick.forward;
    const reach = t.d / 200;
    setEditDraft({
      kind: "desk", name: t.name, ...base, photo: null, photoURL: "", agree: false, view: roomPick.forward, mode: "new",
      erase: eraseBox(base, [roomPick.point[0] + fx * reach, roomPick.point[2] + fz * reach], 0),
    });
    setRoomPick(null);
  }
  function changeEdit(change: Partial<EditDraft>) {
    setEditDraft((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...change };
      next.erase = eraseBox(next, [cur.erase.center[0], cur.erase.center[2]], change.erase?.rotation ?? cur.erase.rotation, cur.erase.id);
      return next;
    });
  }
  // Move the box 5 cm at a time relative to the view: right/left and further/nearer.
  function nudge(right: number, ahead: number) {
    setEditDraft((cur) => {
      if (!cur) return cur;
      const [fx, fz] = cur.view, [cx, cy, cz] = cur.erase.center;
      return { ...cur, erase: { ...cur.erase, center: [cx - fz * right + fx * ahead, cy, cz + fx * right + fz * ahead] } };
    });
  }
  function chooseKind(kind: string) {
    const t = TYPICAL[kind];
    changeEdit({ kind, name: t.name, w: String(t.w), d: String(t.d), h: String(t.h) });
  }
  // Refit the erase box of furniture that is already editable: the box's own size is edited directly.
  function adjustErasure(itemId: string) {
    const er = p?.room?.erasures?.find((x) => x.item === itemId);
    const it = p?.items.find((i) => i.id === itemId);
    if (!er || !it) return;
    const cm = (m: number) => String(Math.round(m * 100));
    const forward = engineView();
    setSelected(null);
    setEditDraft({
      kind: it.kind, name: it.name, w: cm(er.size[0]), d: cm(er.size[2]), h: cm(er.size[1] - 0.02), pad: 0,
      photo: null, photoURL: "", agree: true, erase: er, view: forward, mode: "adjust",
    });
  }
  async function saveErasure() {
    const d = editDraft;
    if (!p || !d || d.mode !== "adjust") return;
    const next = await api({ action: "update-erasure", id: p.id, erasure: d.erase });
    setP(next);
    closeEdit();
    setToast("擦除范围已更新。");
  }
  function closeEdit() {
    if (editDraft?.photoURL) URL.revokeObjectURL(editDraft.photoURL);
    setEditDraft(null);
  }
  async function submitEdit() {
    const d = editDraft;
    if (!p || !d?.photo) return;
    const photo = await upload(p.id, "furniture-photo", await productPhoto(d.photo));
    const next = await api({
      action: "edit-furniture",
      id: p.id,
      photo: photo.key,
      name: d.name,
      kind: d.kind,
      dims: { w: Number(d.w), d: Number(d.d), h: Number(d.h) },
      erase: { center: d.erase.center, size: d.erase.size, rotation: d.erase.rotation },
    });
    setP(next);
    closeEdit();
    setToast(`已开始生成「${d.name}」，大约 1–3 分钟后会出现在原来的位置。`);
  }
  // Pieces the server just created join the local layout without discarding unsaved moves.
  function takeAdded(next: Project & { added?: string | string[] }, undoable: boolean) {
    const ids = new Set([next.added ?? []].flat());
    const cur = stateRef.current;
    if (!cur || cur.id !== next.id) return setP(next);
    if (undoable) {
      setHistory((h) => [...h.slice(-39), structuredClone(cur.items)]);
      setFuture([]);
    }
    setP({ ...next, items: [...cur.items, ...next.items.filter((i) => ids.has(i.id))], floor: cur.floor });
  }
  // Review step: a clean product photo or the real size for one detected piece.
  async function setPiecePhoto(candidate: string, file: File) {
    const cur = stateRef.current;
    if (!cur) return;
    const photo = await upload(cur.id, "product-photo-" + candidate, await productPhoto(file));
    setP(await api({ action: "set-furniture-input", id: cur.id, candidate, photo: photo.key }));
  }
  async function clearPiecePhoto(candidate: string) {
    const cur = stateRef.current;
    if (cur) setP(await api({ action: "set-furniture-input", id: cur.id, candidate, photo: null }));
  }
  async function setPieceDims(candidate: string, dims: Dims | null) {
    const cur = stateRef.current;
    if (cur) setP(await api({ action: "set-furniture-input", id: cur.id, candidate, dims }));
  }
  // Furniture that is not in the photo: upload each photo, then one request creates and queues them all.
  async function addPieces(pieces: NewPiece[], progress: (message: string) => void) {
    const cur = stateRef.current;
    if (!cur) return;
    const furniture = [];
    for (const [n, f] of pieces.entries()) {
      progress(pieces.length > 1 ? `正在上传照片 ${n + 1}/${pieces.length}` : "正在上传照片");
      const image = (await upload(cur.id, "add-furniture", await productPhoto(f.file))).key;
      furniture.push({ name: f.name, kind: f.kind, dims: f.dims, image });
    }
    progress("正在提交生成任务");
    const next = await api({ action: "add-furniture", id: cur.id, approved: true, furniture });
    takeAdded(next, false);
    setPanel("shelf");
    setToast(next.note || `已开始生成 ${furniture.length} 件家具，大约 1–3 分钟后出现在家具栏。`);
  }
  // A library piece: ready at once. Dropped on the room it is placed there; otherwise it waits for a click on the floor.
  async function addFromCatalog(catalogId: string, at?: [number, number, number]) {
    const cur = stateRef.current;
    if (!cur) return;
    const entry = catalogItem(catalogId);
    const next = await api({ action: "add-catalog-item", id: cur.id, catalogId, position: at });
    takeAdded(next, true);
    if (at) {
      setSelected(next.added);
      setPending(null);
      setToast(entry?.wall ? `已放下「${entry.name}」。它是壁挂的：靠到墙边后，用“离地”把它挂上去。` : `已放下「${entry?.name}」，可以直接拖动调整。`);
    } else if (cur.floor.confirmed) {
      // The placement hint at the top says where to click; no toast on top of it.
      setSelected(null);
      setPending(next.added);
    } else setToast(`「${entry?.name}」已放进家具栏，地面对齐后就能摆放。`);
  }
  // Empty-room base layer: shown inside erased areas so they show clean floor and wall.
  async function importClean() {
    if (!p) return;
    const next = await api({ action: "import-clean-world", id: p.id, source: cleanText });
    setP(next);
    setCleanText("");
    setCleanOpen(false);
    setDrawer(false);
    setToast("已导入空房间底图，正在自动对齐。");
  }
  async function saveCleanAlign(fit: { scale: number; yaw?: number; shift: [number, number, number] }, message?: string) {
    const current = stateRef.current;
    if (!current?.room?.clean) return;
    try {
      const next = await api({ action: "align-clean", id: current.id, ...fit });
      setP((cur) => (cur && cur.id === next.id && cur.room && next.room ? { ...cur, room: { ...cur.room, clean: next.room.clean } } : cur));
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  // Fine-tune the base layer: axis 0–2 moves it 2 cm, axis 3 turns it 0.5° about the camera.
  function nudgeClean(axis: 0 | 1 | 2 | 3, by: number) {
    const c = p?.room?.clean;
    if (!c) return;
    const shift = [...c.shift] as [number, number, number];
    let yaw = c.yaw ?? 0;
    if (axis === 3) yaw = Math.round((yaw + by) * 10000) / 10000;
    else shift[axis] = Math.round((shift[axis] + by) * 1000) / 1000;
    setP({ ...p!, room: { ...p!.room!, clean: { ...c, shift, yaw } } });
    void saveCleanAlign({ scale: c.scale, yaw, shift });
  }
  const importBlock = (
    <div className="import-world">
      <label className="field-label" htmlFor="marble-source">
        粘贴 Marble 房间
      </label>
      <textarea
        id="marble-source"
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder="在 Marble 打开房间 → 分享 / 嵌入，复制嵌入代码或查看器链接，粘贴到这里"
      />
      <button className="button primary full" disabled={busy || !importText.trim()} onClick={() => run(importWorld)}>
        {busy ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
        {busy ? "正在下载房间文件…" : "导入房间（不消耗积分）"}
      </button>
      <p className="small muted">房间文件会下载到这台电脑（约 10–40 MB），导入后自动对齐地面。原来的 3D 空间会被替换。</p>
    </div>
  );
  return (
    <main className={"workbench" + (p ? "" : " at-home")}>
      <header className="topbar">
        <div className="title-block">
          <button className="brand" onClick={goHome} aria-label="房间工作台，回到首页" disabled={!p}>
            <Mark />
            <span>房间工作台</span>
          </button>
          {p && (
            <>
              <span className="slash">/</span>
              <span className="project-name">{p.name}</span>
            </>
          )}
          {p?.mode === "demo" && <span className="badge">示例</span>}
        </div>
        <div className="top-actions">
          {p ? (
            <>
              <span className="save-status">
                {dirty ? "有未保存的调整" : savedAt ? "已保存 " + savedAt : "已恢复空间"}
              </span>
              <button className="icon" title="撤销" aria-label="撤销" disabled={!history.length} onClick={undo}>
                <Undo2 />
              </button>
              <button className="icon" title="重做" aria-label="重做" disabled={!future.length} onClick={redo}>
                <Redo2 />
              </button>
              <span className="divider" />
              <button className="button ghost" onClick={() => fileRef.current?.click()} disabled={busy || recognizing}>
                <Upload size={16} />
                换一张照片
              </button>
              <button className="button primary" onClick={save} disabled={busy}>
                <Save size={16} />
                保存
              </button>
            </>
          ) : (
            <>
              <button className="text-button" disabled={busy || boot} onClick={demo}>
                看示例房间
              </button>
              <button className="button primary" disabled={busy || boot} onClick={() => fileRef.current?.click()}>
                <Upload size={16} />
                上传照片
              </button>
            </>
          )}
        </div>
      </header>
      <input
        className="hidden"
        type="file"
        ref={fileRef}
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          receive(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <section className={"workspace " + (!p ? "empty-workspace" : "") + (tab === "library" && !editDraft ? " library-open" : "")}>
        {p && (p.mode === "demo" || p.room) ? (
          <Scene
            project={p}
            selected={selected}
            pending={pending}
            reset={reset}
            focus={focus}
            onSelect={setSelected}
            onMove={(id, pos) => patch(id, { position: pos })}
            onPlace={place}
            onThumb={thumb}
            onError={setError}
            onFloorDetected={floorDetected}
            floorEditing={floorOpen}
            onRoomPick={pickRoom}
            eraseDraft={editDraft?.erase ?? null}
            onDraftMove={(c) => setEditDraft((cur) => (cur ? { ...cur, erase: { ...cur.erase, center: c } } : cur))}
            onCleanAligned={(fit) => void saveCleanAlign(fit, "空房间底图已自动对齐，擦除的地方会用它补齐。")}
          />
        ) : p?.original ? (
          <div className="photo-stage">
            <img src={url(p.original)} alt="上传的房间原图" />
            <span>原始照片 · 空间尚未生成</span>
          </div>
        ) : null}
        {p && (
          <div className="workspace-label">
            <h1>{p.name}</h1>
            <p>
              {p.mode === "demo"
                ? "示例房间 · 几何模型，只用于体验摆放"
                : p.room
                  ? "生成式空间 · 照片没拍到的地方为推测补全"
                  : "照片已上传 · 3D 空间还没有生成"}
            </p>
          </div>
        )}
        {!p && !boot && (
          <div
            className={"landing" + (dragOver ? " drag-over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              receive(e.dataTransfer.files[0]);
            }}
          >
            <div className="landing-copy">
              <h1>
                搬家具之前，
                <br />
                先在这里<em>搬一遍</em>。
              </h1>
              <p className="lede">
                上传一张房间照片。工作台会认出照片里的家具，补全被挡住的墙和地板，再把房间和家具变成 3D，让你挪一挪、转一转，比较不同的摆法。
              </p>
              <div className="landing-actions">
                <button className="button primary large" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload size={17} />
                  上传房间照片
                </button>
                <button className="text-button" disabled={busy} onClick={demo}>
                  先看示例房间 <ArrowRight size={15} />
                </button>
              </div>
              <p className="fine-print">JPG / PNG / WebP，10 MB 以内，也可以直接拖到页面上。</p>
              <p className="local-note">
                <span className="local-dot" />
                识别、抠图、补全背景都在这台电脑上完成，不上传、不花钱。生成 3D 时才会用到服务商积分。
              </p>
            </div>
            <div className="landing-model">
              <Maquette />
              <p className="model-hint">
                <span>拖动家具试试</span>
                <span>移动鼠标，日光跟着走</span>
              </p>
            </div>
            <ol className="process">
              <li>
                <b>1</b>
                <strong>认出家具</strong>
                <span>自动框出床、桌、柜，点一下就能选中或取消。</span>
              </li>
              <li>
                <b>2</b>
                <strong>补全背景</strong>
                <span>移走的家具背后，墙面和地板按周围的样子补齐。</span>
              </li>
              <li>
                <b>3</b>
                <strong>生成 3D</strong>
                <span>房间和每件家具分别生成，失败的那件可以单独重试。</span>
              </li>
              <li>
                <b>4</b>
                <strong>重新摆放</strong>
                <span>把家具拖进房间，旋转、缩放，满意了再保存。</span>
              </li>
            </ol>
            {dragOver && <div className="drop-veil">松开，开始识别这间房</div>}
          </div>
        )}
        {boot && (
          <div className="canvas-loading">
            <Loader2 className="spin" />
            正在打开工作台
          </div>
        )}
        {p && (
          <div className="canvas-toolbar">
            <button className="tool active" title="选择与移动">
              <MousePointer2 size={17} />
              选择
            </button>
            <span className="divider" />
            <button className="tool" onClick={() => setReset((v) => v + 1)}>
              <Maximize size={17} />
              重置视角
            </button>
            {p.mode === "real" && (
              <button
                className="tool"
                onClick={() => {
                  setFloorDraft(String(p.floor.height));
                  setFloorOpen((v) => !v);
                }}
              >
                <SlidersHorizontal size={17} />
                校准地面
              </button>
            )}
            <button
              className="tool"
              onClick={() => {
                setDrawer(true);
                setError("");
              }}
            >
              <Layers size={17} />
              处理步骤
            </button>
            {(p.mode === "demo" || p.room) && (
              <>
                <span className="divider" />
                <button
                  className={"tool" + (panel === "library" && !editDraft ? " on" : "")}
                  aria-pressed={panel === "library" && !editDraft}
                  onClick={() => setPanel((v) => (v === "library" ? "shelf" : "library"))}
                >
                  <Library size={17} />
                  家具库
                </button>
              </>
            )}
          </div>
        )}
        {pending && (
          <div className="placement-hint">
            <Move size={17} />
            在地面或桌面上点击，放下 {p?.items.find((i) => i.id === pending)?.name}
            <button
              className="icon"
              onClick={() => setPending(null)}
              aria-label="取消放置"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {p && !editDraft && (p.mode === "demo" || p.room || p.items.length > 0) && (
          <aside className={"shelf" + (tab === "library" ? " library" : "")} aria-label="家具">
            <div className="panel-tabs" role="tablist" aria-label="家具栏与家具库">
              <button role="tab" aria-selected={tab === "shelf"} className={tab === "shelf" ? "on" : ""} onClick={() => setPanel("shelf")}>
                <Box size={15} />
                家具栏 <span>{p.items.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "library"}
                className={tab === "library" ? "on" : ""}
                disabled={!libraryOpen}
                title={libraryOpen ? undefined : "生成或导入 3D 房间后可用"}
                onClick={() => setPanel("library")}
              >
                <Library size={15} />
                家具库
              </button>
            </div>
            {tab === "library" ? (
              <CatalogPanel
                inRoom={inRoom}
                blocked={p.items.length >= MAX_ITEMS ? `一个空间最多放 ${MAX_ITEMS} 件家具，先移除几件再添加。` : null}
                onAdd={async (id) => {
                  setError("");
                  try {
                    await addFromCatalog(id);
                  } catch (e) {
                    setError((e as Error).message);
                    throw e;
                  }
                }}
              />
            ) : (
              <>
                {p.items.length > 0 && <p className="shelf-note">拖进房间，或点一下再选落点</p>}
                {(() => {
                  // What the library pieces in this space would cost, at the listed reference prices.
                  const prices = p.items.flatMap((i) => (i.catalogId ? [catalogItem(i.catalogId)?.price ?? 0] : []));
                  return prices.length > 0 ? (
                    <p className="shelf-total">
                      家具库商品 {prices.length} 件 · 参考合计 <b>{formatUSD(prices.reduce((a, b) => a + b, 0))}</b>
                    </p>
                  ) : null;
                })()}
                {p.items.length > 0 && p.mode === "real" && (
                  <button className="add-tile" onClick={() => setAddOpen(true)}>
                    <Plus size={15} />
                    添加家具
                    <span>上传照片生成 3D</span>
                  </button>
                )}
                {p.items.length > 0 ? (
                  <div className="furniture-list">
                    {p.items.map((i) => {
                      const task = p.tasks.find((t) => t.target === i.id);
                      const status =
                        task && ["failed", "uncertain", "paused"].includes(task.status)
                          ? "failed"
                          : i.status;
                      const generating = ["queued", "running"].includes(i.status) || ["queued", "running", "submitting"].includes(task?.status ?? "");
                      const entry = i.catalogId ? catalogItem(i.catalogId) : undefined;
                      const meta = entry ? `${entry.shop} · ${formatPrice(entry)}` : i.dims ? `${i.dims.w} × ${i.dims.d} × ${i.dims.h} cm` : "";
                      return (
                        <article
                          key={i.id}
                          className={
                            "furniture-card " +
                            (selected === i.id || pending === i.id ? "selected" : "")
                          }
                          draggable={i.status === "ready" && p.floor.confirmed}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", i.id);
                            setPending(i.id);
                          }}
                          onDragEnd={() => setPending(null)}
                          onClick={() => selectCard(i)}
                        >
                          {!generating && (
                            <button
                              className="remove-card"
                              aria-label={"移除" + i.name}
                              disabled={busy || recognizing}
                              onPointerDown={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onDragStart={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                changeItems(p.items.filter((v) => v.id !== i.id));
                                setSelected(null);
                                setPending(null);
                              }}
                            >
                              <X size={14} />
                            </button>
                          )}
                          <div className="furniture-preview">
                            {thumbs[i.id] || i.thumbnail ? (
                              <img
                                src={thumbs[i.id] || url(i.thumbnail)}
                                alt={i.name}
                              />
                            ) : (
                              <div className="model-wait">
                                {status === "failed" ? (
                                  <AlertCircle />
                                ) : (
                                  <Loader2 className="spin" />
                                )}
                              </div>
                            )}
                          </div>
                          <div className="card-caption">
                            <strong>{i.name}</strong>
                            <span className={"item-status " + status}>
                              {status === "placed" ? (
                                <>
                                  <Check size={12} />
                                  已摆放
                                </>
                              ) : status === "ready" ? (
                                "待摆放"
                              ) : status === "failed" ? (
                                "失败"
                              ) : (
                                "生成中"
                              )}
                            </span>
                          </div>
                          {meta && <span className="card-meta">{meta}</span>}
                          {status === "failed" && task && <p className="small muted">{task.error}</p>}
                          {task && canRetry(task) && (
                            <button
                              className="text-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                run(async () =>
                                  setP(
                                    await retryTask(task.id),
                                  ),
                                );
                              }}
                            >
                              {retryLabel(task)}
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-shelf">
                    <Box size={24} />
                    <h2>想挪动或添置家具？</h2>
                    <p>在房间里点一下照片里的家具，上传它的照片，就能变成可以移动的 3D 模型。</p>
                    <div className="empty-actions">
                      <button className="button primary" disabled={!libraryOpen} onClick={() => setPanel("library")}>
                        <Library size={15} />
                        从家具库挑一件
                      </button>
                      {p.mode === "real" && (
                        <button className="text-button" onClick={() => setAddOpen(true)}>
                          <Plus size={14} />
                          上传照片添加新家具
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {p.items.length > 0 && (
                  <div className="shelf-footer">
                    <Info size={14} />
                    填了尺寸的按真实大小摆放，其余为估计
                  </div>
                )}
              </>
            )}
          </aside>
        )}
        {p && (
          <AddFurnitureDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            ready={p.mode !== "real" ? "示例房间不生成新家具，可以从家具库挑选。" : !generationReady.furniture ? "尚未配置 Tripo，暂时不能生成家具。可以先从家具库挑选。" : null}
            onSubmit={addPieces}
          />
        )}
        {roomPick && (
          <div className="pick-pop" style={{ left: roomPick.x, top: roomPick.y }} role="dialog" aria-label="把家具变成可编辑">
            <strong>把它变成可编辑的家具？</strong>
            <p>上传这件家具的照片，会生成 3D 模型放回原处，之后就能挪动它。</p>
            <div className="pick-actions">
              <button className="button primary" onClick={startEdit}>
                是，上传照片
              </button>
              <button className="text-button" onClick={() => setRoomPick(null)}>
                取消
              </button>
            </div>
          </div>
        )}
        {editDraft && (
          <aside className="shelf edit-panel" aria-label="变成可编辑家具">
            <div className="shelf-heading">
              <h2>{editDraft.mode === "adjust" ? "调整擦除范围" : "变成可编辑家具"}</h2>
              <button className="icon" aria-label="取消" onClick={closeEdit}>
                <X size={16} />
              </button>
            </div>
            <p className="shelf-note">拖动房间里的蓝色方框，直到原来的家具完全消失（连同靠墙的部分和床头）。</p>
            <div className="edit-body">
              {editDraft.mode === "new" && (
              <>
              <div className="kind-chips">
                {Object.entries(TYPICAL).map(([k, t]) => (
                  <button key={k} className={editDraft.kind === k ? "chosen" : ""} aria-pressed={editDraft.kind === k} onClick={() => chooseKind(k)}>
                    {t.name}
                  </button>
                ))}
              </div>
              <label className="edit-field">
                <span>名称</span>
                <input value={editDraft.name} maxLength={24} onChange={(e) => changeEdit({ name: e.target.value })} />
              </label>
              </>
              )}
              <div className="dims">
                {(["w", "d", "h"] as const).map((k) => (
                  <label key={k}>
                    <span>{(editDraft.mode === "adjust" ? { w: "范围宽", d: "范围深", h: "范围高" } : { w: "宽", d: "深", h: "高" })[k]}</span>
                    <input inputMode="decimal" value={editDraft[k]} onChange={(e) => changeEdit({ [k]: e.target.value } as Partial<EditDraft>)} />
                    <em>cm</em>
                  </label>
                ))}
              </div>
              {editDraft.mode === "new" && (
                <div className="edit-field">
                  <span>
                    擦除范围再放宽 <b>{Math.round(editDraft.pad * 100)} cm</b>
                  </span>
                  <input type="range" min={0} max={0.4} step={0.01} value={editDraft.pad} aria-label="擦除范围外扩" onChange={(e) => changeEdit({ pad: Number(e.target.value) })} />
                </div>
              )}
              <div className="rotate-row">
                <span>方向</span>
                <button className="icon" aria-label="向左转 5 度" onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation + Math.PI / 36 } })}>
                  <RotateCcw />
                </button>
                <span className="value">{Math.round((((editDraft.erase.rotation * 180) / Math.PI) % 360 + 360) % 360)}°</span>
                <button className="icon" aria-label="向右转 5 度" onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation - Math.PI / 36 } })}>
                  <RotateCw />
                </button>
                <button className="text-button" onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation + Math.PI / 2 } })}>
                  转 90°
                </button>
              </div>
              <div className="nudge-row">
                <span>位置</span>
                <button className="icon" aria-label="方框往左 5 厘米" onClick={() => nudge(-0.05, 0)}>
                  <ChevronLeft />
                </button>
                <button className="icon" aria-label="方框往里 5 厘米" onClick={() => nudge(0, 0.05)}>
                  <ChevronDown style={{ transform: "rotate(180deg)" }} />
                </button>
                <button className="icon" aria-label="方框往外 5 厘米" onClick={() => nudge(0, -0.05)}>
                  <ChevronDown />
                </button>
                <button className="icon" aria-label="方框往右 5 厘米" onClick={() => nudge(0.05, 0)}>
                  <ChevronLeft style={{ transform: "rotate(180deg)" }} />
                </button>
              </div>
              {editDraft.mode === "adjust" ? (
                <button className="button primary full" disabled={busy} onClick={() => run(saveErasure)}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                  保存擦除范围
                </button>
              ) : (
              <>
              <button
                className={"photo-drop" + (editDraft.photoURL ? " has-photo" : "")}
                onClick={() => editPhotoRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f?.type.startsWith("image/")) {
                    if (editDraft.photoURL) URL.revokeObjectURL(editDraft.photoURL);
                    changeEdit({ photo: f, photoURL: URL.createObjectURL(f) });
                  }
                }}
              >
                {editDraft.photoURL ? (
                  <img src={editDraft.photoURL} alt="家具照片" />
                ) : (
                  <>
                    <ImageIcon size={22} />
                    <strong>上传这件家具的照片</strong>
                    <span>白底或干净背景、拍到全貌、没有遮挡</span>
                  </>
                )}
              </button>
              <input
                className="hidden"
                type="file"
                ref={editPhotoRef}
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (editDraft.photoURL) URL.revokeObjectURL(editDraft.photoURL);
                    changeEdit({ photo: f, photoURL: URL.createObjectURL(f) });
                  }
                  e.target.value = "";
                }}
              />
              <label className="approve">
                <input type="checkbox" checked={editDraft.agree} onChange={(e) => changeEdit({ agree: e.target.checked })} />
                用 Tripo 生成 3D 模型，预计消耗约 30 积分
              </label>
              <button
                className="button primary full"
                disabled={busy || !editDraft.photo || !editDraft.agree || !editDraft.name.trim()}
                onClick={() => run(submitEdit)}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                擦除原家具并生成
              </button>
              </>
              )}
            </div>
          </aside>
        )}
        {p?.original && (
          <div className={"reference " + (!reference ? "collapsed" : "")}>
            <button onClick={() => setReference((v) => !v)}>
              <ImageIcon size={15} />
              原图参考
              <ChevronDown size={15} />
            </button>
            {reference && <img src={url(p.original)} alt="房间原图参考" />}
          </div>
        )}
        {item?.status === "placed" && p && (() => {
          const entry = item.catalogId ? catalogItem(item.catalogId) : undefined;
          const lift = Math.round((item.position[1] - p.floor.height) * 100);
          const raise = (cm: number) =>
            patch(item.id, { position: [item.position[0], Math.max(p.floor.height, item.position[1] + cm / 100), item.position[2]] });
          const size = (v: number) => Math.round(v * item.scale);
          return (
            <div className="inspector">
              <div className="inspector-title">
                <strong>{item.name}</strong>
                <span>{entry ? `${entry.shop} · ${formatPrice(entry)}` : item.source === "upload" ? "你上传的家具" : "当前 3D 对象"}</span>
                {entry && (
                  <a className="buy-link" href={entry.link} target="_blank" rel="noopener noreferrer" title={`打开 ${entry.shop} ${marketLabel(entry)}的商品页（新标签页）`}>
                    去官网
                    <ArrowUpRight size={13} />
                  </a>
                )}
                <button
                  className="icon"
                  aria-label="取消选中"
                  onClick={() => setSelected(null)}
                >
                  <X size={15} />
                </button>
              </div>
              {entry && (
                <p className="inspector-offer">
                  {marketLabel(entry)}标价 {formatOriginal(entry)} · {entry.variant}
                  {availabilityLabel(entry) && (
                    <>
                      {" · "}
                      <em>{availabilityLabel(entry)}</em>
                    </>
                  )}
                  {entry.buyNote && ` · ${entry.buyNote}`}
                  {entry.memberOffer && ` · ${entry.memberOffer.label} ${formatUSD(entry.memberOffer.price)}`}
                </p>
              )}
              <div className="inspector-row">
                <label>旋转</label>
                <button
                  className="icon"
                  aria-label="向左旋转"
                  onClick={() =>
                    patch(item.id, { rotation: item.rotation - Math.PI / 12 })
                  }
                >
                  <RotateCcw />
                </button>
                <span className="value">
                  {(((Math.round((item.rotation * 180) / Math.PI) % 360) + 360) % 360)}°
                </span>
                <button
                  className="icon"
                  aria-label="向右旋转"
                  onClick={() =>
                    patch(item.id, { rotation: item.rotation + Math.PI / 12 })
                  }
                >
                  <RotateCw />
                </button>
                <span className="divider" />
                <label>比例</label>
                <button
                  className="icon"
                  aria-label="缩小家具"
                  onClick={() =>
                    patch(item.id, { scale: Math.max(0.1, Math.round((item.scale - 0.1) * 10) / 10) })
                  }
                >
                  <Minus />
                </button>
                <button
                  className="value reset-scale"
                  title="恢复初始比例"
                  onClick={() => patch(item.id, { scale: 1 })}
                >
                  {Math.round(item.scale * 100)}%
                </button>
                <button
                  className="icon"
                  aria-label="放大家具"
                  onClick={() =>
                    patch(item.id, { scale: Math.min(5, Math.round((item.scale + 0.1) * 10) / 10) })
                  }
                >
                  <Plus />
                </button>
                <span className="divider" />
                <label htmlFor="lift-input" title="壁挂的搁板、挂钩可以挂到墙上">离地</label>
                <button className="icon" aria-label="降低 5 厘米" disabled={lift <= 0} onClick={() => raise(-5)}>
                  <Minus />
                </button>
                <LiftInput key={item.id + ":" + lift} id="lift-input" value={lift} onCommit={(cm) => raise(cm - lift)} />
                <button className="icon" aria-label="升高 5 厘米" onClick={() => raise(5)}>
                  <Plus />
                </button>
              </div>
              <div className="inspector-row secondary">
                {item.dims ? (
                  <span className="size-readout" title={entry ? `标称 ${entry.dimsLabel}` : "你填写的尺寸"}>
                    <label>尺寸</label>
                    <b>
                      {size(item.dims.w)} × {size(item.dims.d)} × {size(item.dims.h)}
                    </b>
                    <span>cm</span>
                  </span>
                ) : (
                  <>
                    <label>初始高度（估计）</label>
                    <input
                      type="number"
                      min=".1"
                      max="5"
                      step=".05"
                      aria-label="家具初始高度"
                      value={item.height}
                      onChange={(e) =>
                        patch(item.id, { height: Number(e.target.value) || 1 })
                      }
                    />
                    <span>m</span>
                  </>
                )}
                <div className="inspector-actions">
                {lift > 0 && (
                  <button className="tool" title="放回地面" onClick={() => raise(-lift)}>
                    <ArrowDownToLine size={15} />
                    落地
                  </button>
                )}
                {p.room?.erasures?.some((x) => x.item === item.id) && (
                  <button className="tool" onClick={() => adjustErasure(item.id)}>
                    <Scan size={15} />
                    调整擦除范围
                  </button>
                )}
                <button
                  className="tool"
                  onClick={() => {
                    patch(item.id, { status: "ready" });
                    setSelected(null);
                  }}
                >
                  <ArrowUpFromLine size={15} />
                  收回
                </button>
                <button
                  className="icon danger"
                  aria-label="移除选中家具"
                  onClick={() => {
                    changeItems(p.items.filter((i) => i.id !== item.id));
                    setSelected(null);
                  }}
                >
                  <Trash2 size={16} />
                </button>
                </div>
              </div>
            </div>
          );
        })()}
        {floorOpen && p && (
          <div className="floor-panel">
            <div className="inspector-title">
              <strong>地面位置</strong>
              <button className="icon" onClick={() => setFloorOpen(false)} aria-label="关闭地面校准">
                <X />
              </button>
            </div>
            <p>
              {floorNote ||
                "让网格刚好贴在地板上：网格浮在地板上方就往左拖，网格看不见了就往右一点。"}
            </p>
            <div className="floor-field">
              <span>地面高度</span>
              <input
                type="range"
                min={-3}
                max={1}
                step={0.01}
                value={p.floor.height}
                aria-label="地面高度"
                onChange={(e) => setFloor({ height: Number(e.target.value) })}
              />
              <div className="floor-step">
                <button className="icon" aria-label="地面下移 1 厘米" onClick={() => setFloor({ height: p.floor.height - 0.01 })}>
                  <Minus />
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="地面高度（米）"
                  value={floorDraft}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setFloorDraft(e.target.value)}
                  onBlur={commitFloorDraft}
                  onKeyDown={(e) => e.key === "Enter" && commitFloorDraft()}
                />
                <span>m</span>
                <button className="icon" aria-label="地面上移 1 厘米" onClick={() => setFloor({ height: p.floor.height + 0.01 })}>
                  <Plus />
                </button>
              </div>
            </div>
            <div className="floor-field">
              <span>
                可摆放范围 <b>{p.floor.size} × {p.floor.size} m</b>
              </span>
              <input
                type="range"
                min={2}
                max={20}
                step={0.5}
                value={p.floor.size}
                aria-label="可摆放范围"
                onChange={(e) => setFloor({ size: Number(e.target.value) })}
              />
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                commitFloorDraft();
                void persistFloor({ ...p.floor, confirmed: true }, "地面位置已保存。");
                setFloorNote("");
                setFloorOpen(false);
              }}
            >
              确认并保存
            </button>
          </div>
        )}
        <footer className="workspace-footer">
          <div>
            <span className="tiny-dot" />
            {p?.mode === "demo"
              ? "示例模式"
              : p?.room
                ? "3D 空间"
                : "照片 → 空间"}
          </div>
          <span>拖动空白旋转 · 右键平移 · 滚轮缩放视角</span>
          <button
            className="text-button"
            onClick={() => {
              setShowServices(true);
              fetch("/api/workbench?services=1")
                .then((r) => r.json())
                .then(setServices)
                .catch(() => setServices({ error: "服务状态暂时不可用" }));
            }}
          >
            服务状态
          </button>
        </footer>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            className="icon"
            aria-label="关闭提示"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}
      {p && (
        <Dialog open={drawer} onOpenChange={setDrawer}>
          <DialogContent className="workflow" showCloseButton={false} aria-describedby={undefined}>
            <div className="workflow-top">
              <div>
                <span className="eyebrow">{p.name} · 处理步骤</span>
                <DialogTitle>
                  {p.mode === "demo"
                    ? "示例房间"
                    : p.stage === "branch" || p.stage === "upload"
                      ? "先决定，如何处理家具"
                      : p.stage === "confirm" || p.stage === "detecting"
                        ? "确认本次处理的家具"
                        : p.stage === "review"
                          ? "看看处理后的房间"
                          : p.stage === "processing"
                            ? "正在修复房间背景"
                            : p.room
                              ? "空间已就绪"
                              : "正在生成空间"}
                </DialogTitle>
              </div>
              <button
                className="icon"
                aria-label="关闭处理步骤"
                onClick={() => setDrawer(false)}
              >
                <X />
              </button>
            </div>
            {p.mode === "demo" ? (
              <div className="demo-explanation">
                <Box size={40} />
                <h3>从右侧挑一件家具，放进房间。</h3>
                <p>
                  这里的床、书桌和柜子是明确标注的示例几何模型，供验证交互。
                  <br />
                  上传自己的照片后，将进入真实识别与生成流程。
                </p>
                <button
                  className="button primary"
                  onClick={() => setDrawer(false)}
                >
                  继续摆放
                </button>
              </div>
            ) : (
              <>
                <div className="steps">
                  {["照片与选择", "确认家具", "预览与下载", "可选 3D"].map((s, i) => {
                    const at = ["upload", "branch"].includes(p.stage)
                      ? 0
                      : ["confirm", "detecting"].includes(p.stage)
                        ? 1
                        : ["processing", "review"].includes(p.stage)
                          ? 2
                          : 3;
                    return (
                      <span className={i === at ? "current" : i < at ? "done" : ""} key={s}>
                        <b>{i < at ? <Check size={11} strokeWidth={2.5} /> : i + 1}</b>
                        {s}
                      </span>
                    );
                  })}
                </div>
                <div className="workflow-body">
                  <div className="photo-column">
                    <div
                      className={"photo-confirm " + (manual ? "drawing" : "")}
                      ref={viewRef}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const x = (e.clientX - r.left) / r.width,
                          y = (e.clientY - r.top) / r.height;
                        if (manual) {
                          setPoints((v) => [...v, [x, y]]);
                          return;
                        }
                        const hit = p.candidates.find(
                          (c) =>
                            masksRef.current[c.id]?.data[
                              (Math.min(299, Math.floor(y * 300)) * 300 +
                                Math.min(299, Math.floor(x * 300))) *
                                4
                            ] > 127,
                        );
                        if (hit)
                          setChoices((v) =>
                            v.includes(hit.id)
                              ? v.filter((id) => id !== hit.id)
                              : [...v, hit.id],
                          );
                      }}
                    >
                      {p.original ? (
                        <img
                          src={
                            p.stage === "review" && processedURL
                              ? processedURL
                              : url(p.original)
                          }
                          alt={
                            p.stage === "review"
                              ? "处理后的房间"
                              : "原始房间照片"
                          }
                        />
                      ) : (
                        <button
                          className="button"
                          onClick={() => fileRef.current?.click()}
                        >
                          选择照片
                        </button>
                      )}
                      {!manual &&
                        p.stage !== "review" &&
                        p.candidates.map((c, i) => (
                          <button
                            key={c.id}
                            aria-label={"选择" + c.name}
                            className={
                              "mask-overlay " +
                              (choices.includes(c.id) ? "checked" : "")
                            }
                            style={{
                              maskImage: `url("${url(c.mask)}")`,
                              WebkitMaskImage: `url("${url(c.mask)}")`,
                            }}
                            onClick={() =>
                              setChoices((v) =>
                                v.includes(c.id)
                                  ? v.filter((x) => x !== c.id)
                                  : [...v, c.id],
                              )
                            }
                          />
                        ))}
                      {!manual && ["branch","confirm","detecting"].includes(p.stage) && p.candidates.filter(c=>c.source==="local-detr").map((c,i)=>(
                        <button key={c.id} className={"object-pin "+(choices.includes(c.id)?"chosen":"")}
                          style={{left:`${Math.min(83,c.box[0]*100)}%`,top:`${Math.max(2,c.box[1]*100)}%`}}
                          onClick={e=>{e.stopPropagation();setChoices(v=>v.includes(c.id)?v.filter(id=>id!==c.id):[...v,c.id]);}}
                          aria-pressed={choices.includes(c.id)} aria-label={"选择"+c.name}>{i+1} · {c.name}</button>
                      ))}
                      {recognizing && <div className="recognition-veil"><Scan size={25}/><span>正在识别家具</span></div>}
                      {manual && (
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                          <polygon
                            points={points
                              .map((v) => v.map((n) => n * 100).join(","))
                              .join(" ")}
                            fill="rgba(99,125,90,.3)"
                            stroke="#d3e1c5"
                            strokeWidth=".3"
                          />
                          {points.map(([x, y], i) => (
                            <circle
                              key={i}
                              cx={x * 100}
                              cy={y * 100}
                              r=".6"
                              fill="#fff"
                            />
                          ))}
                        </svg>
                      )}
                    </div>
                    <div className="photo-caption">
                      <ImageIcon size={14} />
                      {manual
                        ? "依次点击家具轮廓，至少 3 个点；白色区域将成为像素掩膜。"
                        : p.stage === "review"
                          ? "已将掩膜外区域恢复为原图像素"
                          : "原始照片 · 保持家具本来的样子"}
                    </div>
                    {p.stage === "review" && (
                      <details>
                        <summary>对照原图</summary>
                        <img
                          className="compare-original"
                          src={url(p.original)}
                          alt="处理前原图"
                        />
                      </details>
                    )}
                  </div>
                  <div className="flow-controls">
                    {["branch","confirm","detecting"].includes(p.stage) && <div className="recognition-status" role="status" aria-live="polite">
                      <div className="recognition-heading">{recognizing ? <Loader2 className="spin" size={18}/> : recognitionError ? <AlertCircle size={18}/> : <Scan size={18}/>}
                        <strong>{recognizing ? recognitionMessage : recognitionError ? "识别暂未完成" : p.recognitionComplete ? `已找到 ${p.candidates.length} 件候选家具` : "自动识别家具"}</strong>
                      </div>
                      {recognizing && recognitionPercent!==undefined && <progress max={100} value={recognitionPercent} aria-label="模型下载进度"/>}
                      <p>{recognitionError || (recognizing ? "照片在你的设备上识别，请稍候。" : "点击照片标记或下方名称选择。请检查轮廓；柜子还需确认是否为嵌入式。")}</p>
                      {recognizing ? <button className="text-button" onClick={()=>{recognitionAbort.current?.abort();setRecognitionError("识别已取消，可以重试或手动圈选。");}}>取消识别</button> : <button className="text-button" disabled={busy||running} onClick={()=>void autoRecognize(p)}>重新自动识别</button>}
                    </div>}

                    {["branch", "upload"].includes(p.stage) && (
                      <>
                        <h3>是否要移除屋内家具？</h3>
                        <button
                          className={
                            "branch-option " +
                            (branch === "remove" ? "chosen" : "")
                          }
                          onClick={() => setBranch("remove")}
                        >
                          <span className="radio" />
                          <div>
                            <strong>是，移除指定家具</strong>
                            <p>这些家具不要了，只修复背景，不生成模型。</p>
                          </div>
                        </button>
                        <button
                          className={
                            "branch-option " +
                            (branch === "edit" ? "chosen" : "")
                          }
                          onClick={() => setBranch("edit")}
                        >
                          <span className="radio" />
                          <div>
                            <strong>否，保留并让它们可编辑</strong>
                            <p>免费提取透明家具图、补全背景；之后可选生成 3D。</p>
                          </div>
                        </button>
                        {!!p.candidates.length && <div className="detected-chips" aria-label="识别出的家具">{p.candidates.map(c=>(
                          <button key={c.id} className={choices.includes(c.id)?"chosen":""} aria-pressed={choices.includes(c.id)} onClick={()=>setChoices(v=>v.includes(c.id)?v.filter(id=>id!==c.id):[...v,c.id])}>
                            {choices.includes(c.id)?<Check size={14}/>:<Plus size={14}/>} {c.name}
                          </button>
                        ))}</div>}
                        <label className="field-label" htmlFor="intent">
                          {branch === "remove"
                            ? "你想移除哪些家具？"
                            : "你想让哪些家具变得可编辑？"}
                        </label>
                        <textarea
                          id="intent"
                          value={intent}
                          onChange={(e) => setIntent(e.target.value)}
                          placeholder={
                            branch === "remove"
                              ? "例如：删除书桌"
                              : "例如：床和书桌，或窗边的柜子"
                          }
                          maxLength={500}
                        />
                        <p className="muted small">
                          未选中的家具保留在背景中，不能单独移动。
                        </p>
                        <button
                          className="button primary full"
                          disabled={busy || recognizing || (!intent.trim() && !choices.length)}
                          onClick={() => run(detect)}
                        >
                          {busy ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Scan size={16} />
                          )}
                          查看并确认选择
                        </button>
                        <button
                          className="text-button full"
                          onClick={() => {
                            setManual(true);
                            setPoints([]);
                          }}
                        >
                          手动圈选家具
                        </button>
                        {manual && (
                          <div className="manual-controls">
                            <select
                              value={manualName}
                              onChange={(e) => setManualName(e.target.value)}
                            >
                              <option>书桌</option>
                              <option>床</option>
                              <option>柜子</option>
                              <option>椅子</option>
                              <option>沙发</option>
                            </select>
                            <button
                              className="button"
                              onClick={() => setPoints((v) => v.slice(0, -1))}
                            >
                              撤回点
                            </button>
                            <button
                              className="button primary"
                              disabled={points.length < 3 || busy}
                              onClick={() => run(addManual)}
                            >
                              完成圈选
                            </button>
                          </div>
                        )}
                        <div className="skip-actions">
                          <button
                            className="text-button"
                            disabled={busy || recognizing || !generationReady.world}
                            onClick={() => run(() => generate(true))}
                          >
                            这是空房／没有需要处理的家具
                          </button>
                          {branch === "edit" && (
                            <button
                              className="text-button"
                              disabled={busy || recognizing || !generationReady.world}
                              onClick={() => run(() => generate(true))}
                            >
                              暂不编辑家具，仅生成空间
                            </button>
                          )}
                          <span>
                            {generationReady.world ? "直接生成 3D 会使用 World Labs 积分（草稿约 230）。" : "图片识别、抠图与修复免费；3D 空间生成需另行配置 World Labs。"}
                          </span>
                          <button className="text-button" disabled={busy || recognizing} onClick={() => setImportOpen((v) => !v)}>
                            已经在 Marble 官网生成过房间？导入它
                          </button>
                        </div>
                        {importOpen && importBlock}
                      </>
                    )}
                    {["detecting", "confirm"].includes(p.stage) && (
                      <>
                        <button className="text-button" disabled={busy||running||recognizing} onClick={()=>setP({...p,stage:"branch"})}><ChevronLeft size={15}/> 调整处理方式</button>
                        <h3>{running ? "正在查找家具" : "请确认具体对象"}</h3>
                        <p className="muted">
                          {p.branch === "remove"
                            ? "仅移除你勾选的家具，不生成独立模型。"
                            : "先提取选中家具的透明图片，并补全它们背后的房间。预览满意后可以下载，也可以继续生成 3D。"}
                        </p>
                        {p.intent && (
                          <div className="intent-quote">“{p.intent}”</div>
                        )}
                        {p.tasks
                          .filter(
                            (t) =>
                              t.kind === "detect" &&
                              ["failed", "uncertain", "paused"].includes(t.status),
                          )
                          .map((t) => (
                            <div className="notice" key={t.id}>
                              {t.error}
                              {canRetry(t) && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    run(async () =>
                                      setP(
                                        await retryTask(t.id),
                                      ),
                                    )
                                  }
                                >
                                  重试此项
                                </button>
                              )}
                            </div>
                          ))}
                        {p.candidates.length === 0 && !running && (
                          <div className="notice">
                            没有找到匹配对象。可以修改描述重新检测，或手动圈选。
                          </div>
                        )}
                        {p.candidates.map((c) => (
                          <div className="candidate" key={c.id}>
                            <input
                              type="checkbox"
                              aria-label={"本次处理"+c.name}
                              disabled={busy || recognizing || running}
                              checked={choices.includes(c.id)}
                              onChange={() =>
                                setChoices((v) =>
                                  v.includes(c.id)
                                    ? v.filter((x) => x !== c.id)
                                    : [...v, c.id],
                                )
                              }
                            />
                            <div
                              className="candidate-mask"
                              style={{
                                backgroundImage: `url(${url(p.original)})`,
                                maskImage: `url(${url(c.mask)})`,
                                WebkitMaskImage: `url(${url(c.mask)})`,
                              }}
                            />
                            <div>
                              <strong>{c.name}</strong>
                              <span>
                                {c.source === "manual"
                                  ? "手动轮廓 · 请检查完整性"
                                  : c.score < 0.7
                                    ? "识别不确定 · 请仔细确认"
                                    : c.source === "local-detr"
                                      ? `自动识别 · ${Math.round(c.score*100)}%${c.needsReview ? (c.kind === "cabinet" ? " · 请确认可移动" : " · 轮廓需检查") : " · 请核对轮廓"}`
                                      : "候选实例 · 请核对照片"}
                              </span>
                            </div>
                            <select className="candidate-kind" aria-label={"修正"+c.name+"类别"} value={c.kind} disabled={busy||recognizing||running} onChange={e=>{
                              const kind=e.target.value;
                              void run(async()=>setP(await api({action:"correct-candidate",id:p.id,candidate:c.id,kind})));
                            }}>
                              <option value="bed">床</option><option value="desk">桌子</option><option value="cabinet">柜子</option><option value="chair">椅子／凳</option><option value="sofa">沙发</option>
                            </select>
                          </div>
                        ))}
                        {p.candidates.length > 1 && (
                          <p className="small muted">
                            名称相同也可能是不同实例；“窗边”等方位需在图中核对。
                          </p>
                        )}
                        {imageRepair===false && <div className="notice">{localMode ? "本地修复模型未就绪，请重新启动工作台完成模型检查。已圈选的家具会保留。" : "背景修复服务尚未连接。请使用本地工作台，免费完成抠图与修复。"}</div>}
                        {localMode && imageRepair && <p className="small muted">本地 LaMa 修复 · 无需密钥 · 不消耗积分 · 照片留在本机</p>}
                        <button
                          className="button primary full"
                          disabled={busy || recognizing || running || !choices.length || imageRepair===false}
                          onClick={() => run(prepare)}
                        >
                          {busy ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          {busy ? (repairMessage || "正在准备图片…") : `免费处理 ${choices.length} 件家具`}
                        </button>
                        {busy && repairMessage && <button className="text-button" onClick={()=>repairAbort.current?.abort()}>取消处理，保留选择</button>}
                        <button
                          className="text-button full"
                          disabled={running}
                          onClick={() => {
                            setManual((v) => !v);
                            setPoints([]);
                          }}
                        >
                          补充手动圈选
                        </button>
                        {manual && (
                          <div className="manual-controls">
                            <select
                              value={manualName}
                              onChange={(e) => setManualName(e.target.value)}
                            >
                              <option>书桌</option>
                              <option>床</option>
                              <option>柜子</option>
                              <option>椅子</option>
                              <option>沙发</option>
                            </select>
                            <button
                              className="button"
                              onClick={() => setPoints((v) => v.slice(0, -1))}
                            >
                              撤回点
                            </button>
                            <button
                              className="button primary"
                              disabled={points.length < 3 || busy}
                              onClick={() => run(addManual)}
                            >
                              完成
                            </button>
                          </div>
                        )}
                        <textarea
                          aria-label="修改家具描述"
                          value={intent}
                          onChange={(e) => setIntent(e.target.value)}
                          placeholder="修改描述，例如左侧的书桌"
                        />
                        <button
                          className="text-button full"
                          disabled={busy || recognizing || running || !intent.trim()}
                          onClick={() => run(detect)}
                        >
                          按描述更新选择
                        </button>
                      </>
                    )}
                    {p.stage === "review" && (
                      <>
                        <h3>修复完成，看看新的空间</h3>
                        <p className="muted">
                          目标家具应完整消失，未选家具、墙面与地板应保持原样。
                        </p>
                        <div className="notice">
                          掩膜外像素已严格保留。边缘残影、遮挡区域和大面积修复仍需人工检查。
                          {quality !== null &&
                            quality > 3 &&
                            " 修复服务改动过未选区域，现已恢复。"}
                        </div>
                        {p.branch === "edit" && p.cutouts && (
                          <FurnitureInputs
                            project={p}
                            disabled={busy}
                            onPhoto={setPiecePhoto}
                            onClearPhoto={clearPiecePhoto}
                            onDims={setPieceDims}
                          />
                        )}
                        <a className="button primary full" href={localMode && p.rawBackground ? url(p.rawBackground)+'&download='+encodeURIComponent('房间-修复背景.png') : processedURL || undefined} download="房间-修复背景.png" aria-disabled={!processed}>下载修复后的房间</a>
                        <p className="small muted">免费处理已完成，结果已保存在本机。大面积遮挡和家具背后的区域是推测补全，可返回重新圈选。</p>
                        <h3>需要三维空间？</h3>
                        <p className="small muted">这是独立的可选步骤。World Labs 生成空间，Tripo 生成家具模型；两者可能消耗服务商积分。</p>
                        <label className="approve">
                          <input
                            type="checkbox"
                            checked={approved}
                            onChange={(e) => setApproved(e.target.checked)}
                          />
                          已检查：没有明显残留或误删，单件家具可用于建模
                        </label>
                        <button
                          className="button primary full"
                          disabled={busy || !approved || !processed || !generationReady.world || (p.branch==='edit' && !generationReady.furniture)}
                          onClick={() => run(() => generate())}
                        >
                          继续生成 3D 空间{p.branch === "edit" ? "与家具" : ""}
                        </button>
                        <p className="small muted">
                          {!generationReady.world || (p.branch==='edit'&&!generationReady.furniture)
                            ? "尚未配置 3D 服务，不影响上面的免费修复和下载。"
                            : `预计消耗 World Labs 约 230 积分${p.branch === "edit" && p.cutouts ? `，Tripo 30 × ${Object.keys(p.cutouts).length} = ${30 * Object.keys(p.cutouts).length} 积分` : ""}。空间使用草稿模式，家具分别生成${Object.keys(p.productPhotos ?? {}).some((id) => p.cutouts?.[id]) ? "（换了白底照片的用照片生成）" : ""}；未拍到的部分属于推测补全。`}
                        </p>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => run(async()=>{setP(await api({action:'revise',id:p.id}));setApproved(false);})}
                        >
                          返回调整选择／重新修复
                        </button>
                      </>
                    )}
                    {["processing", "generating", "ready"].includes(
                      p.stage,
                    ) && (
                      <>
                        <h3>
                          {p.stage === "processing"
                            ? "正在修复房间背景"
                            : p.room
                              ? "空间已就绪"
                              : "正在生成空间"}
                        </h3>
                        <p className="muted">
                          可以收起面板。服务商任务已保存，刷新后继续查询，不会重新提交。
                        </p>
                        <div className="task-list">
                          {p.tasks
                            .filter((t) => t.kind !== "detect")
                            .map((t) => (
                              <div className={"task " + (t.status === "done" ? "done" : ["failed", "uncertain", "paused"].includes(t.status) ? "failed" : "")} key={t.id}>
                                {t.status === "done" ? (
                                  <CheckCircle2 size={18} />
                                ) : ["failed", "uncertain", "paused"].includes(
                                    t.status,
                                  ) ? (
                                  <AlertCircle size={18} />
                                ) : (
                                  <Loader2 className="spin" size={18} />
                                )}
                                <div>
                                  <strong>
                                    {t.kind === "world"
                                      ? "房间空间"
                                      : t.kind === "erase"
                                        ? "背景修复"
                                        : p.items.find((i) => i.id === t.target)
                                            ?.name || "独立家具"}
                                  </strong>
                                  <span>
                                    {t.status === "done"
                                      ? "已完成"
                                      : t.status === "queued"
                                        ? "等待处理"
                                        : t.status === "running"
                                          ? "服务商正在处理"
                                          : t.status === "submitting"
                                            ? "正在提交任务"
                                            : t.error || "失败"}
                                  </span>
                                  {t.providerId && <small>任务编号：{t.providerId}</small>}
                                  {["world", "furniture"].includes(t.kind) && <small>
                                    预计 {t.estimatedCredits ?? "待确认"} · 预留 {t.reservedCredits ?? 0} · 实际扣费 {t.actualCredits ?? "待结算"} 积分
                                  </small>}
                                  {canRetry(t) && (
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() =>
                                        run(async () =>
                                          setP(
                                            await retryTask(t.id),
                                          ),
                                        )
                                      }
                                    >
                                      {retryLabel(t)}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                        {p.room && (
                          <>
                            <div className="notice">
                              {p.floor.confirmed
                                ? "地面已对齐，可以直接摆放家具。照片里的其他家具属于背景，不能单独移动。"
                                : "正在根据房间结构查找地面；找不到时会请你手动对齐。照片里的其他家具属于背景，不能单独移动。"}
                            </div>
                            <button className="button primary full" onClick={() => setDrawer(false)}>
                              进入空间
                            </button>
                          </>
                        )}
                        {p.stage === "ready" && p.room && (
                          <div className="clean-layer">
                            <strong>空房间底图</strong>
                            <p className="small muted">
                              {p.room.clean
                                ? "已设置。擦除家具的地方会显示底图里干净的地板和墙面。"
                                : "导入一个同一视角、没有家具的 Marble 房间。擦除家具的地方会用它补齐，不再露出痕迹。"}
                            </p>
                            {p.room.clean && (
                              <div className="clean-nudge" aria-label="底图对齐微调">
                                <span>对齐微调 · 每次 2 cm</span>
                                {(
                                  [
                                    ["左", 0, -0.02],
                                    ["右", 0, 0.02],
                                    ["前", 2, -0.02],
                                    ["后", 2, 0.02],
                                    ["上", 1, 0.02],
                                    ["下", 1, -0.02],
                                    ["左转", 3, 0.0087],
                                    ["右转", 3, -0.0087],
                                  ] as const
                                ).map(([label, axis, by]) => (
                                  <button key={label} className="button" disabled={busy} onClick={() => nudgeClean(axis, by)}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button className="text-button" disabled={busy} onClick={() => setCleanOpen((v) => !v)}>
                              {p.room.clean ? "换一个空房间底图" : "导入空房间底图"}
                            </button>
                            {cleanOpen && (
                              <div className="import-world">
                                <textarea
                                  aria-label="空房间底图的 Marble 嵌入代码"
                                  value={cleanText}
                                  onChange={(e) => setCleanText(e.target.value)}
                                  placeholder="粘贴空房间的 Marble 嵌入代码或查看器链接"
                                />
                                <button className="button primary full" disabled={busy || !cleanText.trim()} onClick={() => run(importClean)}>
                                  {busy ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                                  {busy ? "正在下载底图…" : "导入底图（不消耗积分）"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {p.stage === "ready" && (
                          <>
                            <button className="text-button" disabled={busy} onClick={() => setImportOpen((v) => !v)}>
                              换成在 Marble 官网生成的房间
                            </button>
                            {importOpen && importBlock}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
      {showServices && (
        <div className="overlay">
          <section
            className="service-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="服务状态"
          >
            <div className="inspector-title">
              <h2>服务状态</h2>
              <button
                className="icon"
                aria-label="关闭服务状态"
                onClick={() => setShowServices(false)}
              >
                <X />
              </button>
            </div>
            {!services ? (
              <p>正在读取实际余额…</p>
            ) : (
              <>
                <div className="service-row">
                  <strong>World Labs</strong>
                  <span>
                    {services.world?.error ||
                      `${services.world?.remaining_credits ?? "—"} 积分`}
                  </span>
                </div>
                <div className="service-row">
                  <strong>Tripo</strong>
                  <span>
                    {services.tripo?.error ||
                      `${services.tripo?.data?.balance ?? "—"} 积分`}
                  </span>
                </div>
                <div className="service-row">
                  <strong>背景修复</strong>
                  <span>
                    {localMode ? (imageRepair ? "本地 LaMa · 免费 · 已就绪" : "本地模型待安装") : services.image ? "已配置 fal.ai" : "待配置 FAL_KEY"}
                  </span>
                </div>
                <p className="muted">
                  {localMode ? "识别、透明抠图、背景补全都在本机完成，不需要 API 密钥。World Labs 和 Tripo 仅用于可选的 3D 生成。" : "浏览器识别无需密钥。背景修复可在本地工作台免费运行。"}
                </p>
                <p className="small muted">
                  本轮 Tripo 上限 5,000 积分。示例房间不消耗生成积分。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
