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
  SlidersHorizontal,
  ArrowRight,
  Download,
  ArrowUpRight,
  Library,
  ArrowDownToLine,
  Sparkles,
  Lamp,
  Hand,
} from "lucide-react";
import { MAX_ITEMS, type Project, type Item, type Branch, type Candidate, type Task, type Erasure, type Dims } from "@/lib/types";
import { availabilityLabel, buyNoteText, catalogItem, dimsText, formatOriginal, formatPrice, formatUSD, itemName, marketLabel, variantText } from "@/lib/catalog";
import { currentLang, pick, useDocumentLang, useLang, type T } from "@/lib/i18n";
import { DEMO_ROOM, demoPieceAt, demoPieceFor, spaceName } from "@/lib/demo-room";
import { hangsFromCeiling, pieceName } from "@/lib/furniture-kinds";
import { TRIPO_CREDITS, WORLD_CREDITS } from "@/lib/credits";
import Landing from "./Landing";
import LangToggle from "./LangToggle";
import { productPhoto } from "@/lib/photo";
import CatalogPanel from "./CatalogPanel";
import AddFurnitureDialog, { type NewPiece } from "./AddFurnitureDialog";
import FurnitureInputs from "./FurnitureInputs";
import type { FloorFit, PlacementApi } from "./Scene";
import type { FittedBox } from "@/lib/fit-box";
import SpacesDialog, { type SpaceSummary } from "./SpacesDialog";
import {
  prepareImages,
  canvas,
  blob,
  loadImage,
} from "@/lib/image";
function CanvasLoading() {
  const { t } = useLang();
  return (
    <div className="canvas-loading">
      <Loader2 className="spin" />
      {t("正在准备画布", "Preparing the canvas")}
    </div>
  );
}
const Scene = dynamic(() => import("./Scene"), { ssr: false, loading: () => <CanvasLoading /> });
const TITLE = { zh: "方寸 · 不用搬，就能换个摆法", en: "Diorama — Rearrange your room" };
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
/** Margin around a box fitted from the scan: the splats' soft edges reach a little beyond the piece. */
const FIT_PAD = 0.06;
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
  /** The point clicked on the piece, for fitting the box again. */
  at?: [number, number, number];
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
    if (!s) return i;
    if (i.status === "queued" || i.status === "running" || (!i.model && s.model)) return { ...i, status: s.status, model: s.model, thumbnail: s.thumbnail, error: s.error };
    // A piece made again in high detail: its new model, wherever it stands now.
    if (s.model && s.model !== i.model) return { ...i, model: s.model, thumbnail: s.thumbnail };
    return i;
  });
}
/**
 * Safari on a Mac: its WebAssembly engine crashes while decoding the 3D room (seen on macOS 14.5,
 * repeatedly, until Safari gives up on the page). Chrome and Edge are fine.
 */
const macSafari = () =>
  typeof navigator !== "undefined" &&
  /Macintosh/.test(navigator.userAgent) &&
  /Safari\//.test(navigator.userAgent) &&
  !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(navigator.userAgent);
const SAFARI_OK = "room.safari-ok";
// Requests say which language the page is in, so the server answers (and fails) in it.
async function api(body: any): Promise<any> {
  const r = await fetch("/api/workbench", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lang": currentLang() },
    body: JSON.stringify(body),
  });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error || pick(currentLang())("操作失败，请重试。", "That didn't work. Please try again."));
  return j;
}
async function upload(id: string, role: string, file: Blob): Promise<any> {
  const f = new FormData();
  f.append("id", id);
  f.append("role", role);
  f.append("file", file, "image.png");
  const r = await fetch("/api/workbench", { method: "POST", body: f, headers: { "x-lang": currentLang() } });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
}
/** SHA-256 of a file, as the server names uploads: the same file can be recognised before it is sent. */
async function sha256(file: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, "0")).join("");
}
/**
 * Room photos above 10 MB or 4096 px are scaled to 2560 px instead of refused. Anything smaller goes
 * as it is, byte for byte, so a known photo (the sample bedroom) is still recognised by its SHA-256.
 */
async function roomPhoto(file: File): Promise<Blob> {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const long = Math.max(img.width, img.height);
    if (file.size <= 10 * 1024 * 1024 && long <= 4096) return file;
    const k = 2560 / long;
    const c = canvas(Math.round(img.width * k), Math.round(img.height * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(Error("encode"))), "image/jpeg", 0.92));
  } finally {
    URL.revokeObjectURL(src);
  }
}
/** Height above the floor in cm, typed directly: hanging a shelf at 150 cm should not take 30 clicks. */
function LiftInput({ id, value, onCommit }: { id: string; value: number; onCommit: (cm: number) => void }) {
  const { t } = useLang();
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const v = Math.round(Number(draft));
    if (draft.trim() && Number.isFinite(v) && v !== value) onCommit(Math.max(0, Math.min(500, v)));
    else setDraft(String(value));
  };
  return (
    <span className="lift">
      <input
        id={id}
        inputMode="numeric"
        aria-label={t("离地高度（厘米）", "Height above the floor (cm)")}
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
const retryLabel = (task: Task, t: T) =>
  canResume(task) ? t("继续查询原任务（不重新生成）", "Keep checking the original job (no new generation)") : t(`重新生成（预计 ${task.estimatedCredits ?? 0} 积分）`, `Generate again (about ${task.estimatedCredits ?? 0} credits)`);
const MARBLE = "https://marble.worldlabs.ai";
export default function Workbench() {
  const { lang, t } = useLang();
  useDocumentLang(TITLE);
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
    [floorDraft, setFloorDraft] = useState(""),
    [floorNote, setFloorNote] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState(""),
    [roomPick, setRoomPick] = useState<{ point: [number, number, number]; x: number; y: number; forward: [number, number] } | null>(null),
    // The toolbar switch: only while it is on does a click on the room offer to make furniture movable.
    [pickMode, setPickMode] = useState(false),
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
  // Set when automatic recognition was skipped on purpose (not enough free memory): a note, not an error.
  const [recognitionSkipped, setRecognitionSkipped] = useState("");
  // Draft rooms suggest Marble 1.1 once; the note can be closed for this space.
  const [draftNoteClosed, setDraftNoteClosed] = useState<string | null>(null);
  // The chosen furniture photo was already made into 3D (the sample bedroom's bed): no credits needed.
  const [editReuse, setEditReuse] = useState(false);
  const [imageRepair, setImageRepair] = useState<boolean | null>(null);
  const [generationReady, setGenerationReady] = useState({world:false,furniture:false});
  const [repairMessage, setRepairMessage] = useState("");
  const repairAbort = useRef<AbortController | null>(null);
  const recognitionAbort = useRef<AbortController | null>(null);
  const attemptedPhoto = useRef("");
  const masksRef = useRef<Record<string, ImageData>>({});
  const fileRef = useRef<HTMLInputElement>(null),
    viewRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(p);
  // In Safari the room waits behind a note until the person chooses to load it anyway (remembered).
  // (Nothing the server renders depends on it: the home page is shown until a space is opened.)
  const [safariHold, setSafariHold] = useState(() => {
    if (!macSafari()) return false;
    try {
      return localStorage.getItem(SAFARI_OK) !== "1";
    } catch {
      return true;
    }
  });
  // The person's spaces for the home page; null until loaded.
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [spacesOpen, setSpacesOpen] = useState(false);
  // The 3D view's answers about pieces resting on each other (Scene.tsx).
  const placement = useRef<PlacementApi | null>(null);
  stateRef.current = p;
  async function retryTask(taskId: string) {
    const current = stateRef.current;
    const task = current?.tasks.find(t => t.id === taskId);
    if (!current || !task || !canRetry(task)) throw Error(t("待核对：此任务不能再次提交，请先核对服务商记录。", "Needs checking: this job can't be submitted again. Check the provider's records first."));
    const confirmPaid = !canResume(task);
    if (confirmPaid && !window.confirm(t(`${retryLabel(task, t)}？这会创建新任务并可能扣费。`, `${retryLabel(task, t)}? This creates a new job and may cost credits.`))) return current;
    return api({action:"retry",id:current.id,task:task.id,confirmPaid});
  }
  useEffect(() => {
    Promise.all([localStatus(),fetch("/api/workbench?capabilities=1").then(r=>r.json() as Promise<{world:boolean;furniture:boolean}>) ]).then(([local,j])=>{
      setImageRepair(!!local?.inpainting);
      setGenerationReady({world:!!j.world,furniture:!!j.furniture});
    }).catch(()=>{});
    // The home page comes first: the person picks a space, uploads a photo or opens the example.
    loadSpaces()
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
  }, []);
  async function loadSpaces() {
    const r = await fetch("/api/workbench?list=1");
    const j: unknown = await r.json();
    if (!r.ok) throw Error((j as { error?: string }).error);
    setSpaces(j as SpaceSummary[]);
  }
  // A space opened from the home page continues where it was left.
  function enter(j: Project) {
    setP(j);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setSelected(null);
    setPending(null);
    setProcessed(null);
    setProcessedURL("");
    setApproved(false);
    if (j.original && !j.photoPrint)
      void photoPrint(url(j.original))
        .then((print) => api({ action: "set-print", id: j.id, print }))
        .then((saved: Project) => setP((cur) => (cur && cur.id === saved.id ? { ...cur, photoPrint: saved.photoPrint } : cur)))
        .catch(() => undefined);
    setBranch(j.branch);
    setIntent(j.intent);
    setChoices(j.candidates.filter((c: Candidate) => c.selected).map((c: Candidate) => c.id));
    setDrawer(j.stage !== "ready");
  }
  const openSpace = (id: string) =>
    run(async () => {
      const r = await fetch("/api/workbench?id=" + encodeURIComponent(id));
      const j: unknown = await r.json();
      if (!r.ok) throw Error((j as { error?: string }).error);
      setSpacesOpen(false);
      enter(j as Project);
    });
  async function renameSpace(id: string, name: string) {
    await api({ action: "rename", id, name });
    await loadSpaces();
  }
  async function deleteSpace(id: string) {
    await api({ action: "delete-project", id });
    await loadSpaces();
    setToast(t("空间已删除。", "Space deleted."));
  }
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
    fetch(url(p.rawBackground))
      .then((r) => r.blob())
      .then((blob) => ({ blob, outsideDifference: 0 }))
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
  }, [p?.rawBackground,p?.mask,p?.original,p?.stage]);
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
    setRecognitionError(""); setRecognitionSkipped(""); setRecognitionPercent(undefined);
    // Recognition needs about 3 GB free; on a busy 8 GB Mac it is skipped with a note instead of failing.
    const local = await localStatus();
    if (local?.memoryMB !== undefined && local.neededMB && local.memoryMB < local.neededMB.recognize) {
      if (recognitionAbort.current === controller) recognitionAbort.current = null;
      setRecognitionSkipped(
        t(
          `这台电脑现在可用内存约 ${(local.memoryMB / 1024).toFixed(1)} GB，自动识别需要约 3 GB，已跳过。可以直接生成 3D 房间，或手动圈选家具。`,
          `About ${(local.memoryMB / 1024).toFixed(1)} GB of memory is free and automatic recognition needs about 3 GB, so it was skipped. Generate the 3D room directly, or outline furniture by hand.`,
        ),
      );
      return;
    }
    setRecognizing(true);
    setRecognitionMessage(t("正在准备家具识别", "Getting furniture recognition ready"));
    try {
      const response = await fetch(url(project.original), {signal:controller.signal});
      if (!response.ok) throw Error(t("原图暂时无法读取，请重试。", "The photo can't be read right now. Please try again."));
      const results = await recognizeFurniture(await response.blob(), (message,percent)=>{
        setRecognitionMessage(message); setRecognitionPercent(percent);
      }, controller.signal);
      setRecognitionMessage(t("正在保存家具轮廓", "Saving the outlines")); setRecognitionPercent(undefined);
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
      setToast(candidates.length ? t(`已找到 ${candidates.length} 件候选家具，请核对轮廓。`, `Found ${candidates.length} possible ${candidates.length === 1 ? "piece" : "pieces"}. Check the outlines.`) : t("未找到明确家具，可以手动圈选或按空房继续。", "No clear furniture found. Outline it by hand, or go on as an empty room."));
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
      if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name))
        throw Error(t("这是 HEIC 照片，浏览器读不了。请在“照片”里导出为 JPG 再上传。", "This is a HEIC photo, which browsers can't read. Export it as JPG from Photos, then upload."));
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw Error(t("请选择 JPG、PNG 或 WebP 图片。", "Choose a JPG, PNG or WebP image."));
      const photo = await roomPhoto(file);
      const next = await create("real");
      const r = await upload(next.id, "original", photo);
      const source = URL.createObjectURL(photo);
      const print = await photoPrint(source).catch(() => null);
      URL.revokeObjectURL(source);
      const project: Project & { demo?: boolean } = print ? await api({ action: "set-print", id: r.project.id, print }) : r.project;
      setP(project);
      setDrawer(project.stage !== "ready");
      if (project.demo) setToast(t("认出了这张照片：已打开它的 Marble 1.1 高清房间，没有花积分。", "Recognised this photo: its Marble 1.1 room is open. No credits spent."));
      else if (project.room) setToast(t("这张照片已经有 3D 房间了，直接打开，没有花积分。", "This photo already has a 3D room, so it opened straight away. No credits spent."));
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
  type Move = { id: string; position: Item["position"] };
  const moved = (items: Item[], moves: Move[]) => {
    const at = new Map(moves.map((m) => [m.id, m.position]));
    return items.map((i) => (at.has(i.id) ? { ...i, position: at.get(i.id)! } : i));
  };
  // A desk dragged with what stands on it: one step in the history.
  function moveMany(moves: Move[]) {
    if (p) changeItems(moved(p.items, moves));
  }
  // Pieces re-seated on a resized piece belong to the resize step, so no history entry of their own.
  function adjust(moves: Move[]) {
    setP((cur) => (cur ? { ...cur, items: moved(cur.items, moves) } : cur));
    setDirty(true);
  }
  const shifted = (i: Item, dy: number): Item => ({ ...i, position: [i.position[0], i.position[1] + dy, i.position[2]] });
  // Pieces that rested on `gone` (put away or removed) drop onto whatever is below them, and what
  // they carry comes along.
  function settleOff(items: Item[], gone: string): Item[] {
    const api = placement.current;
    const all = api?.riders(gone) ?? [];
    if (!api || !all.length) return items;
    const carriedBy = new Map(all.map((r) => [r, api.riders(r)]));
    const nested = new Set([...carriedBy.values()].flat());
    const dy = new Map<string, number>();
    for (const r of all.filter((r) => !nested.has(r))) {
      const it = items.find((i) => i.id === r);
      if (!it) continue;
      const carried = carriedBy.get(r)!;
      const rest = api.restAt(it.position[0], it.position[2], it.position[1] + 0.02, [gone, r, ...carried]);
      for (const k of [r, ...carried]) dy.set(k, rest - it.position[1]);
    }
    return items.map((i) => (dy.has(i.id) ? shifted(i, dy.get(i.id)!) : i));
  }
  // Turning a piece turns what stands on it about the piece's centre (the same turn as three.js rotation.y).
  function turn(item: Item, delta: number) {
    if (!p) return;
    const riders = new Set(placement.current?.riders(item.id) ?? []);
    const [cx, , cz] = item.position,
      c = Math.cos(delta),
      s = Math.sin(delta);
    changeItems(
      p.items.map((i) => {
        if (i.id === item.id) return { ...i, rotation: i.rotation + delta };
        if (!riders.has(i.id)) return i;
        const dx = i.position[0] - cx,
          dz = i.position[2] - cz;
        return { ...i, rotation: i.rotation + delta, position: [cx + dx * c + dz * s, i.position[1], cz - dx * s + dz * c] };
      }),
    );
  }
  // Hung from the ceiling (its top under the ceiling there) or put back on what is below it.
  function setMount(it: Item, mount: "ceiling" | "floor") {
    const api = placement.current;
    if (!p || !api) return;
    const [x, y, z] = it.position;
    const h = api.sizeOf(it.id)?.size[1] ?? it.height * it.scale;
    const ny = mount === "ceiling" ? api.ceilingAt(x, z) - h : api.restAt(x, z, y + 0.02, [it.id]);
    changeItems(p.items.map((i) => (i.id === it.id ? { ...i, mount, position: [x, ny, z] } : i)));
  }
  // A piece made from a photo, made again at the high-detail settings. Only the job changes on the
  // server; the layout here (unsaved moves included) stays as it is.
  async function regenerate(it: Item) {
    const current = stateRef.current;
    if (!current) return;
    const name = displayName(it);
    if (
      !window.confirm(
        t(
          `用 Tripo 高精度重新生成「${name}」（8K 贴图），预计消耗约 ${TRIPO_CREDITS} 积分。生成期间旧模型继续显示，完成后自动替换。现在生成？`,
          `Regenerate “${name}” in high detail with Tripo (8K textures), about ${TRIPO_CREDITS} credits? The old model stays until the new one is ready.`,
        ),
      )
    )
      return;
    const next = await api({ action: "regenerate", id: current.id, item: it.id, confirmPaid: true });
    setP((cur) => (cur ? { ...cur, tasks: next.tasks, revision: next.revision } : cur));
    setToast(t(`已开始高精度重新生成「${name}」，大约 2–5 分钟后自动替换。`, `Regenerating “${name}” in high detail. It is swapped in automatically in about 2–5 minutes.`));
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
  const clock = () => new Date().toLocaleTimeString(lang === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
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
      setFloorNote(t("没能从房间结构里找到地板，请拖动滑块，让网格贴在地板上。", "Couldn't find the floor in the room. Drag the slider until the grid sits on the floor."));
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
      t("已自动找到地面，并按真实尺寸校正了房间比例。", "Found the floor and set the room to real-world scale."),
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
      setSavedAt(clock());
      setToast(t("布局已保存，刷新后可继续。", "Layout saved. It will be here after a refresh."));
    });
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.target instanceof Element && e.target.matches("input,textarea,select")) return;
      if (e.key === "Escape") {
        setPending(null);
        setSelected(null);
        setRoomPick(null);
        setPickMode(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
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
  // Names the app gave (library, recognition, the sample room) follow the page language; typed names stay.
  const displayName = (i: Item) => {
    const e = i.catalogId ? catalogItem(i.catalogId) : undefined;
    return e ? itemName(e, lang) : pieceName(i.name, lang);
  };
  const taskError = (task: Task) => (lang === "en" ? task.errorEn ?? task.error : task.error) ?? "";
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
    if (imageRepair === false) throw Error(t("本机的背景修复模型还没装好：请关掉工作台窗口再重新启动，它会自动检查并补全模型。已圈选的家具会保留。", "The background repair model isn't installed on this Mac yet. Close the app window and start it again; it checks and completes the models. Your selection is kept."));
    const selected = p.candidates.filter((c) => choices.includes(c.id));
    if (!selected.length) throw Error(t("请勾选本次要处理的家具。", "Tick the furniture to process."));
    const controller=new AbortController();repairAbort.current=controller;
    setApproved(false);setRepairMessage(t("正在准备家具轮廓和透明图片", "Preparing outlines and cut-outs"));
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
    try {
      if(controller.signal.aborted)throw Error(t('已取消处理，照片和选择已保留。','Cancelled. Your photo and choices are kept.'));
      const original=await fetch(url(p.original),{signal:controller.signal}).then(r=>r.blob());
      const result=await localVisionJob('inpaint',original,r.mask,setRepairMessage,controller.signal);
      if(controller.signal.aborted)return;
      setRepairMessage(t("正在保存修复结果", "Saving the repaired image"));
      localBackground=(await upload(p.id,'local-background',base64Blob(result.image))).key;
    }finally{repairAbort.current=null;setRepairMessage("");}
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
      if (!processed || !approved) throw Error(t("请先检查并确认处理后的图片。", "Check and confirm the processed image first."));
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
    setToast(
      placed?.catalogId && catalogItem(placed.catalogId)?.wall
        ? t("这是壁挂家具：拖到墙边，再用“离地”把它挂上去。", "This one hangs on a wall: drag it to the wall, then raise it with “Height”.")
        : t("家具已放置，可直接拖动调整。", "Placed. Drag it to adjust."),
    );
  }
  function selectCard(i: Item) {
    if (i.status === "placed") {
      setSelected(i.id);
      setPending(null);
      setFocus((v) => v + 1);
    } else if (i.status === "ready") {
      if (!p?.floor.confirmed) {
        setFloorOpen(true);
        setToast(t("先校准地面，再摆放家具。", "Set the floor first, then place furniture."));
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
    if (dirty && !window.confirm(t("有未保存的调整，确定回到首页吗？", "You have unsaved changes. Go back to the home page anyway?"))) return;
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
    void loadSpaces().catch(() => undefined);
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
    setToast(t("已导入 Marble 房间，正在对齐地面。", "Marble room imported. Finding the floor."));
  }
  // Clicking furniture in the room: offer to make it editable.
  function pickRoom(point: [number, number, number], screen: { x: number; y: number }, forward: [number, number]) {
    if (!p || p.mode !== "real" || !p.room || editDraft || pending || !pickMode) return;
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
    // In the sample bedroom a click on a known piece (the bed) starts from its fitted box and size.
    const known = p?.room?.preset === DEMO_ROOM.id ? demoPieceAt(roomPick.point[0], roomPick.point[2]) : undefined;
    setEditReuse(false);
    setPickMode(false);
    if (known) {
      const e = known.erase;
      setEditDraft({
        kind: known.kind, name: known.name[lang], w: String(known.dims.w), d: String(known.dims.d), h: String(known.dims.h),
        pad: 0, photo: null, photoURL: "", agree: false, view: roomPick.forward, mode: "new",
        erase: { id: "draft", center: [...e.center], size: [...e.size], rotation: e.rotation },
      });
      setRoomPick(null);
      return;
    }
    // The box fitted to the piece in the scan (lib/fit-box.ts), or a typical desk to adjust by hand.
    const fit = placement.current?.fitAt(roomPick.point, roomPick.forward) ?? null;
    if (fit) {
      const kind = TYPICAL[fit.kind] && fit.kind !== "pendant" ? fit.kind : "other";
      setEditDraft({
        kind, name: lang === "en" ? TYPICAL[kind].nameEn : TYPICAL[kind].name, ...fittedDraft(fit, FIT_PAD),
        photo: null, photoURL: "", agree: false, view: roomPick.forward, mode: "new", at: roomPick.point,
      });
      setRoomPick(null);
      setToast(t("已按扫描自动贴合方框，可以再微调。", "The box is fitted to the piece from the scan; fine-tune it if needed."));
      return;
    }
    const typical = TYPICAL.desk;
    const base = { w: String(typical.w), d: String(typical.d), h: String(typical.h), pad: 0.12 };
    const [fx, fz] = roomPick.forward;
    const reach = typical.d / 200;
    setEditDraft({
      kind: "desk", name: lang === "en" ? typical.nameEn : typical.name, ...base, photo: null, photoURL: "", agree: false, view: roomPick.forward, mode: "new",
      erase: eraseBox(base, [roomPick.point[0] + fx * reach, roomPick.point[2] + fz * reach], 0), at: roomPick.point,
    });
    setRoomPick(null);
  }
  // A fitted box as the edit fields show it: the piece's own size, and the erase box around it.
  function fittedDraft(fit: FittedBox, pad: number, id = "draft") {
    const cm = (m: number) => String(Math.round(m * 100));
    const base = { w: cm(fit.size[0]), d: cm(fit.size[2]), h: cm(fit.size[1]), pad };
    return { ...base, erase: eraseBox(base, [fit.center[0], fit.center[2]], fit.rotation, id) };
  }
  // Fit the box again from the scan: at the clicked point, else down through the box's middle.
  function autoFit() {
    const d = editDraft,
      api = placement.current;
    if (!d || !api || !p) return;
    const probes: [number, number, number][] = d.at ? [d.at] : [];
    const [cx, cy, cz] = d.erase.center;
    for (let y = cy + d.erase.size[1] / 2 - 0.05; y > p.floor.height + 0.08; y -= 0.1) probes.push([cx, y, cz]);
    let fit: FittedBox | null = null;
    for (const at of probes) if ((fit = api.fitAt(at, d.view))) break;
    if (!fit) {
      setToast(t("没能在这里找到家具的轮廓，请手动调整方框。", "Couldn't find the piece's outline here. Adjust the box by hand."));
      return;
    }
    const found = fit;
    setEditDraft((cur) => {
      if (!cur) return cur;
      // Refitting a saved erasure: the fields are the box itself, the margin included.
      if (cur.mode === "adjust") {
        const grown: FittedBox = { ...found, size: [found.size[0] + 2 * FIT_PAD, found.size[1] + FIT_PAD, found.size[2] + 2 * FIT_PAD] };
        return { ...cur, ...fittedDraft(grown, 0, cur.erase.id) };
      }
      return { ...cur, ...fittedDraft(found, cur.pad || FIT_PAD, cur.erase.id) };
    });
    setToast(t("方框已贴合到家具。", "The box now fits the piece."));
  }
  function changeEdit(change: Partial<EditDraft>) {
    setEditDraft((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...change };
      // A box fitted for a known piece stays as fitted until its size or margin is changed.
      const resized = ["w", "d", "h", "pad"].some((k) => k in change);
      if (resized) next.erase = eraseBox(next, [cur.erase.center[0], cur.erase.center[2]], change.erase?.rotation ?? cur.erase.rotation, cur.erase.id);
      else if (change.erase) next.erase = { ...cur.erase, rotation: change.erase.rotation };
      return next;
    });
  }
  // Choosing a furniture photo: a photo that was already made into 3D needs no credits.
  function choosePhoto(f: File) {
    if (editDraft?.photoURL) URL.revokeObjectURL(editDraft.photoURL);
    changeEdit({ photo: f, photoURL: URL.createObjectURL(f) });
    setEditReuse(false);
    void sha256(f).then((sha) => setEditReuse(!!demoPieceFor(sha)));
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
    const typical = TYPICAL[kind];
    changeEdit({ kind, name: lang === "en" ? typical.nameEn : typical.name, w: String(typical.w), d: String(typical.d), h: String(typical.h) });
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
    setToast(t("擦除范围已更新。", "Erase box updated."));
  }
  function closeEdit() {
    if (editDraft?.photoURL) URL.revokeObjectURL(editDraft.photoURL);
    setEditDraft(null);
    setEditReuse(false);
  }
  async function submitEdit() {
    const d = editDraft;
    if (!p || !d?.photo) return;
    const image = await productPhoto(d.photo);
    const photo = await upload(p.id, "furniture-photo", image);
    const source = URL.createObjectURL(image);
    const print = await photoPrint(source).catch(() => undefined);
    URL.revokeObjectURL(source);
    const next = await api({
      action: "edit-furniture",
      id: p.id,
      photo: photo.key,
      print,
      name: d.name,
      kind: d.kind,
      dims: { w: Number(d.w), d: Number(d.d), h: Number(d.h) },
      erase: { center: d.erase.center, size: d.erase.size, rotation: d.erase.rotation },
    });
    setP(next);
    closeEdit();
    setToast(next.note || t(`已开始生成「${d.name}」，大约 2–5 分钟后会出现在原来的位置。`, `Generating “${d.name}”. It appears in its old spot in about 2–5 minutes.`));
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
      progress(pieces.length > 1 ? t(`正在上传照片 ${n + 1}/${pieces.length}`, `Uploading photo ${n + 1} of ${pieces.length}`) : t("正在上传照片", "Uploading the photo"));
      const image = (await upload(cur.id, "add-furniture", await productPhoto(f.file))).key;
      const source = URL.createObjectURL(f.file);
      const print = await photoPrint(source).catch(() => undefined);
      URL.revokeObjectURL(source);
      furniture.push({ name: f.name, kind: f.kind, dims: f.dims, image, print });
    }
    progress(t("正在提交生成任务", "Submitting"));
    const next = await api({ action: "add-furniture", id: cur.id, approved: true, furniture });
    takeAdded(next, false);
    setPanel("shelf");
    setToast(next.note || t(`已开始生成 ${furniture.length} 件家具，大约 2–5 分钟后出现在家具栏。`, `Generating ${furniture.length} ${furniture.length === 1 ? "piece" : "pieces"}. ${furniture.length === 1 ? "It appears" : "They appear"} on the shelf in about 2–5 minutes.`));
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
      const name = entry ? itemName(entry, lang) : "";
      setToast(
        entry?.wall
          ? t(`已放下「${name}」。它是壁挂的：靠到墙边后，用“离地”把它挂上去。`, `Placed “${name}”. It hangs on a wall: move it to the wall, then raise it with “Height”.`)
          : t(`已放下「${name}」，可以直接拖动调整。`, `Placed “${name}”. Drag it to adjust.`),
      );
    } else if (cur.floor.confirmed) {
      // The placement hint at the top says where to click; no toast on top of it.
      setSelected(null);
      setPending(next.added);
    } else setToast(t(`「${entry ? itemName(entry, lang) : ""}」已放进家具栏，地面对齐后就能摆放。`, `“${entry ? itemName(entry, lang) : ""}” is on the shelf. Place it once the floor is set.`));
  }
  // Empty-room base layer: shown inside erased areas so they show clean floor and wall.
  async function importClean() {
    if (!p) return;
    const next = await api({ action: "import-clean-world", id: p.id, source: cleanText });
    setP(next);
    setCleanText("");
    setCleanOpen(false);
    setDrawer(false);
    setToast(t("已导入空房间底图，正在自动对齐。", "Empty-room layer imported. Aligning it."));
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
  // Recognition progress, shown on the photo steps.
  const recognitionStatus = p && (
    <div className="recognition-status" role="status" aria-live="polite">
      <div className="recognition-heading">
        {recognizing ? <Loader2 className="spin" size={18} /> : recognitionError ? <AlertCircle size={18} /> : <Scan size={18} />}
        <strong>
          {recognizing
            ? recognitionMessage
            : recognitionError
              ? t("识别暂未完成", "Recognition didn't finish")
              : recognitionSkipped
                ? t("已跳过自动识别", "Automatic recognition skipped")
                : p.recognitionComplete
                  ? t(`已找到 ${p.candidates.length} 件候选家具`, `Found ${p.candidates.length} possible ${p.candidates.length === 1 ? "piece" : "pieces"}`)
                  : t("自动识别家具", "Recognise furniture")}
        </strong>
      </div>
      {recognizing && recognitionPercent !== undefined && <progress max={100} value={recognitionPercent} aria-label={t("模型下载进度", "Model download progress")} />}
      <p>
        {recognitionError ||
          recognitionSkipped ||
          (recognizing
            ? t("照片在你的设备上识别，请稍候。", "The photo is being recognised on this Mac. One moment.")
            : t("点击照片标记或下方名称选择。请检查轮廓；柜子还需确认是否为嵌入式。", "Click a marker on the photo or a name below to choose. Check the outlines; for cabinets, check they aren't built in."))}
      </p>
      {recognizing ? (
        <button
          className="text-button"
          onClick={() => {
            recognitionAbort.current?.abort();
            setRecognitionError(t("识别已取消，可以重试或手动圈选。", "Recognition cancelled. Try again, or outline by hand."));
          }}
        >
          {t("取消识别", "Cancel")}
        </button>
      ) : (
        <button className="text-button" disabled={busy || running} onClick={() => p && void autoRecognize(p)}>
          {t("重新自动识别", "Recognise again")}
        </button>
      )}
    </div>
  );
  // Outlining a piece by hand: its kind, undo the last point, finish.
  const manualControls = (done: string) => (
    <div className="manual-controls">
      <select value={manualName} onChange={(e) => setManualName(e.target.value)} aria-label={t("家具类别", "Kind of furniture")}>
        {["书桌", "床", "柜子", "椅子", "沙发"].map((n) => (
          <option key={n} value={n}>
            {pieceName(n, lang)}
          </option>
        ))}
      </select>
      <button className="button" onClick={() => setPoints((v) => v.slice(0, -1))}>
        {t("撤回点", "Undo point")}
      </button>
      <button className="button primary" disabled={points.length < 3 || busy} onClick={() => run(addManual)}>
        {done}
      </button>
    </div>
  );
  const importBlock = (
    <div className="import-world">
      <label className="field-label" htmlFor="marble-source">
        {t("粘贴 Marble 房间", "Paste a Marble room")}
      </label>
      <textarea
        id="marble-source"
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder={t("在 Marble 打开房间 → 分享 / 嵌入，复制嵌入代码或查看器链接，粘贴到这里", "In Marble, open the room → Share / Embed, copy the embed code or viewer link, and paste it here")}
      />
      <button className="button primary full" disabled={busy || !importText.trim()} onClick={() => run(importWorld)}>
        {busy ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
        {busy ? t("正在下载房间文件…", "Downloading the room…") : t("导入房间（不消耗积分）", "Import room (no credits)")}
      </button>
      <p className="small muted">{t("房间文件会下载到这台电脑（约 10–40 MB），导入后自动对齐地面。原来的 3D 空间会被替换。", "The room files download to this Mac (about 10–40 MB) and the floor is found automatically. The current 3D room is replaced.")}</p>
    </div>
  );
  return (
    <main className={"workbench" + (p ? "" : " at-home")} lang={lang === "en" ? "en" : "zh-CN"}>
      <header className="topbar">
        <div className="title-block">
          <button className="brand" onClick={goHome} aria-label={t("方寸，回到首页", "Diorama, back to the home page")} disabled={!p}>
            <Mark />
            {lang === "en" ? (
              <span className="brand-name">Diorama</span>
            ) : (
              <span className="brand-name">
                方寸<small>Diorama</small>
              </span>
            )}
          </button>
          <LangToggle />
          {p && (
            <>
              <span className="slash">/</span>
              <span className="project-name">{spaceName(p.name, lang)}</span>
            </>
          )}
          {p?.mode === "demo" && <span className="badge">{t("示例", "Sample")}</span>}
        </div>
        <div className="top-actions">
          {p ? (
            <>
              <span className="save-status">
                {dirty ? t("有未保存的调整", "Unsaved changes") : savedAt ? t("已保存 ", "Saved ") + savedAt : t("已恢复空间", "Space restored")}
              </span>
              <button className="icon" title={t("撤销", "Undo")} aria-label={t("撤销", "Undo")} disabled={!history.length} onClick={undo}>
                <Undo2 />
              </button>
              <button className="icon" title={t("重做", "Redo")} aria-label={t("重做", "Redo")} disabled={!future.length} onClick={redo}>
                <Redo2 />
              </button>
              <span className="divider" />
              <button
                className="button ghost"
                title={t("上传另一张照片，开始一个新空间（当前空间会保留）", "Upload another photo to start a new space (this one is kept)")}
                onClick={() => fileRef.current?.click()}
                disabled={busy || recognizing}
              >
                <Upload size={16} />
                {t("用新照片开始", "New photo")}
              </button>
              <button className="button primary" onClick={save} disabled={busy}>
                <Save size={16} />
                {t("保存", "Save")}
              </button>
            </>
          ) : (
            <>
              <button className="text-button header-sample" disabled={busy || boot} onClick={demo}>
                {t("看示例房间", "Sample room")}
              </button>
              <button className="button primary" disabled={busy || boot} onClick={() => fileRef.current?.click()}>
                <Upload size={16} />
                {t("上传照片", "Upload photo")}
              </button>
            </>
          )}
        </div>
      </header>
      <input
        className="hidden"
        type="file"
        ref={fileRef}
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        onChange={(e) => {
          receive(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <section className={"workspace " + (!p ? "empty-workspace" : "") + (tab === "library" && !editDraft ? " library-open" : "") + (pickMode && !editDraft ? " picking" : "")}>
        {p?.room && p.mode === "real" && safariHold ? (
          <div className="safari-note" role="alert">
            <span className="eyebrow">{t("浏览器提示", "Browser note")}</span>
            <h2>{t("这个 3D 房间请用 Chrome 打开", "Please open this 3D room in Chrome")}</h2>
            <p>
              {t(
                "Safari 加载 3D 房间时会反复崩溃（这是 Safari 的 WebAssembly 问题，和照片、网络无关）。用 Chrome 或 Edge 打开同一个地址就能正常查看；首页和示例房间在 Safari 里也能用。",
                "Safari keeps crashing while it loads 3D rooms (a Safari WebAssembly issue, not your photo or network). Open the same address in Chrome or Edge and it works; the home page and the sample room are fine in Safari.",
              )}
            </p>
            <div className="safari-actions">
              <button
                className="button primary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(location.origin)
                    .then(() => setToast(t("地址已复制，粘贴到 Chrome 的地址栏打开。", "Address copied. Paste it into Chrome's address bar.")))
                    .catch(() => setToast(t("请在 Chrome 里打开 ", "Open this in Chrome: ") + location.origin))
                }
              >
                {t("复制地址", "Copy address")}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  try {
                    localStorage.setItem(SAFARI_OK, "1");
                  } catch {}
                  setSafariHold(false);
                }}
              >
                {t("仍然在 Safari 中打开", "Open in Safari anyway")}
              </button>
            </div>
          </div>
        ) : p && (p.mode === "demo" || p.room) ? (
          <Scene
            project={p}
            selected={selected}
            pending={pending}
            reset={reset}
            focus={focus}
            onSelect={(id) => {
              setSelected(id);
              setRoomPick(null);
            }}
            onMoveMany={moveMany}
            onAdjust={adjust}
            onEngine={(api) => (placement.current = api)}
            onHint={setToast}
            onPlace={place}
            onThumb={thumb}
            onError={setError}
            onFloorDetected={floorDetected}
            floorEditing={floorOpen}
            onRoomPick={pickRoom}
            pickEnabled={pickMode && !editDraft}
            eraseDraft={editDraft?.erase ?? null}
            onDraftMove={(c) => setEditDraft((cur) => (cur ? { ...cur, erase: { ...cur.erase, center: c } } : cur))}
            onCleanAligned={(fit) => void saveCleanAlign(fit, t("空房间底图已自动对齐，擦除的地方会用它补齐。", "The empty-room layer is aligned; erased areas are filled from it."))}
          />
        ) : p?.original ? (
          <div className="photo-stage">
            <img src={url(p.original)} alt={t("上传的房间原图", "The uploaded room photo")} />
            <span>{t("原始照片 · 空间尚未生成", "Original photo · no 3D room yet")}</span>
          </div>
        ) : null}
        {p && (
          <div className="workspace-label">
            <h1>{spaceName(p.name, lang)}</h1>
            <p>
              {p.mode === "demo"
                ? t("示例房间 · 几何模型，只用于体验摆放", "Sample room · simple shapes, to try placing")
                : p.room?.preset
                  ? t("Marble 1.1 房间 · 照片没拍到的地方为推测补全", "Marble 1.1 room · areas the photo didn't show are inferred")
                  : p.room
                    ? t("生成式空间 · 照片没拍到的地方为推测补全", "Generated room · areas the photo didn't show are inferred")
                    : t("照片已上传 · 3D 空间还没有生成", "Photo uploaded · the 3D room isn't generated yet")}
            </p>
          </div>
        )}
        {p?.mode === "real" && p.room && p.room.source !== "imported" && draftNoteClosed !== p.id && !editDraft && !pending && (
          <div className="draft-note" role="note">
            <strong>{t("这是草稿版房间", "This is a draft room")}</strong>
            <span>
              {t(
                "想要更清晰逼真的效果，可以去 Marble 官网用 Marble 1.1 模型生成同一张照片，再导入替换（不消耗本工作台积分）。",
                "For a sharper, more lifelike room, generate the same photo with Marble 1.1 on the Marble website, then import it here (no credits from this app).",
              )}
            </span>
            <a className="text-button" href={MARBLE} target="_blank" rel="noopener noreferrer">
              {t("去 Marble 官网", "Open Marble")} <ArrowUpRight size={13} />
            </a>
            <button className="text-button" onClick={() => { setDrawer(true); setImportOpen(true); }}>
              {t("导入房间", "Import room")}
            </button>
            <button className="icon" aria-label={t("关闭提示", "Dismiss")} onClick={() => setDraftNoteClosed(p.id)}>
              <X size={14} />
            </button>
          </div>
        )}
        {!p && !boot && (
          <>
            <Landing
              busy={busy}
              spaces={spaces}
              onUpload={() => fileRef.current?.click()}
              onDemo={demo}
              onOpenSpace={(id) => void openSpace(id)}
              onAllSpaces={() => setSpacesOpen(true)}
              onDropFile={(f) => void receive(f)}
            />
            <SpacesDialog
              open={spacesOpen}
              onOpenChange={setSpacesOpen}
              spaces={spaces ?? []}
              onOpen={(id) => void openSpace(id)}
              onRename={renameSpace}
              onDelete={deleteSpace}
            />
          </>
        )}
        {boot && (
          <div className="canvas-loading">
            <Loader2 className="spin" />
            {t("正在打开", "Opening")}
          </div>
        )}
        {p && (
          <div className="canvas-toolbar glass">
            {p.mode === "real" && p.room && (
              <>
                <button
                  className={"tool" + (pickMode ? " active" : "")}
                  aria-pressed={pickMode}
                  title={t("打开后，点房间里的家具，可以把它变成可以挪动的 3D 模型", "When on, click a piece in the room to make it a movable 3D model")}
                  onClick={() => {
                    setPickMode((v) => !v);
                    setRoomPick(null);
                    setSelected(null);
                  }}
                >
                  <Hand size={17} />
                  <span>{t("挪动原家具", "Move room furniture")}</span>
                </button>
                <span className="divider" />
              </>
            )}
            <button className="tool" title={t("重置视角", "Reset view")} onClick={() => setReset((v) => v + 1)}>
              <Maximize size={17} />
              <span>{t("重置视角", "Reset view")}</span>
            </button>
            {p.mode === "real" && (
              <button
                className="tool"
                title={t("校准地面", "Floor")}
                onClick={() => {
                  setFloorDraft(String(p.floor.height));
                  setFloorOpen((v) => !v);
                }}
              >
                <SlidersHorizontal size={17} />
                <span>{t("校准地面", "Floor")}</span>
              </button>
            )}
            <button
              className="tool"
              title={t("处理步骤", "Steps")}
              onClick={() => {
                setDrawer(true);
                setError("");
              }}
            >
              <Layers size={17} />
              <span>{t("处理步骤", "Steps")}</span>
            </button>
            {(p.mode === "demo" || p.room) && (
              <>
                <span className="divider" />
                <button
                  className={"tool" + (panel === "library" && !editDraft ? " on" : "")}
                  aria-pressed={panel === "library" && !editDraft}
                  title={t("家具库", "Library")}
                  onClick={() => setPanel((v) => (v === "library" ? "shelf" : "library"))}
                >
                  <Library size={17} />
                  <span>{t("家具库", "Library")}</span>
                </button>
              </>
            )}
          </div>
        )}
        {pickMode && p?.room && !roomPick && !editDraft && !pending && !item && (
          <div className="placement-hint pick-hint">
            <Hand size={16} />
            {t("点房间里的家具，把它变成可以挪动的", "Click a piece in the room to make it movable")}
            <button className="icon" onClick={() => setPickMode(false)} aria-label={t("关闭挪动原家具", "Turn off moving room furniture")}>
              <X size={15} />
            </button>
          </div>
        )}
        {pending && (
          <div className="placement-hint">
            <Move size={17} />
            {(() => {
              const it = p?.items.find((i) => i.id === pending);
              if (!it) return "";
              return hangsFromCeiling(it)
                ? t(`对准天花板（或下面的地面）点击，挂上 ${displayName(it)}`, `Click the ceiling (or the floor under it) to hang ${displayName(it)}`)
                : t(`在地面或桌面上点击，放下 ${displayName(it)}`, `Click the floor or a tabletop to place ${displayName(it)}`);
            })()}
            <button
              className="icon"
              onClick={() => setPending(null)}
              aria-label={t("取消放置", "Cancel placing")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {p && !editDraft && (p.mode === "demo" || p.room || p.items.length > 0) && (
          <aside className={"shelf" + (tab === "library" ? " library" : "")} aria-label={t("家具", "Furniture")}>
            <div className="panel-tabs" role="tablist" aria-label={t("家具栏与家具库", "Shelf and library")}>
              <button role="tab" aria-selected={tab === "shelf"} className={tab === "shelf" ? "on" : ""} onClick={() => setPanel("shelf")}>
                <Box size={15} />
                {t("家具栏", "Shelf")} <span>{p.items.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "library"}
                className={tab === "library" ? "on" : ""}
                disabled={!libraryOpen}
                title={libraryOpen ? undefined : t("生成或导入 3D 房间后可用", "Available once the 3D room is generated or imported")}
                onClick={() => setPanel("library")}
              >
                <Library size={15} />
                {t("家具库", "Library")}
              </button>
            </div>
            {tab === "library" ? (
              <CatalogPanel
                inRoom={inRoom}
                blocked={p.items.length >= MAX_ITEMS ? t(`一个空间最多放 ${MAX_ITEMS} 件家具，先移除几件再添加。`, `A space holds up to ${MAX_ITEMS} pieces. Remove some first.`) : null}
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
                {p.items.length > 0 && <p className="shelf-note">{t("拖进房间，或点一下再选落点", "Drag into the room, or click and then choose a spot")}</p>}
                {(() => {
                  // What the library pieces in this space would cost, at the listed reference prices.
                  const prices = p.items.flatMap((i) => (i.catalogId ? [catalogItem(i.catalogId)?.price ?? 0] : []));
                  return prices.length > 0 ? (
                    <p className="shelf-total">
                      {t(`家具库商品 ${prices.length} 件 · 参考合计 `, `${prices.length} library ${prices.length === 1 ? "piece" : "pieces"} · about `)}
                      <b>{formatUSD(prices.reduce((a, b) => a + b, 0))}</b>
                      {t("", " in total")}
                    </p>
                  ) : null;
                })()}
                {p.items.length > 0 && p.mode === "real" && (
                  <button className="add-tile" onClick={() => setAddOpen(true)}>
                    <Plus size={15} />
                    {t("添加家具", "Add furniture")}
                    <span>{t("上传照片生成 3D", "From a photo")}</span>
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
                      // Made again in high detail: the old model stays in use meanwhile.
                      const regenerating = generating && !!i.model && (i.status === "ready" || i.status === "placed");
                      const remakeable = !generating && !!i.model && !i.model.startsWith("/") && !i.catalogId && task?.status === "done" && task.quality !== "hd";
                      const entry = i.catalogId ? catalogItem(i.catalogId) : undefined;
                      const meta = entry ? `${entry.shop} · ${formatPrice(entry)}` : i.dims ? `${i.dims.w} × ${i.dims.d} × ${i.dims.h} cm` : "";
                      const name = displayName(i);
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
                              aria-label={t("移除" + name, "Remove " + name)}
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
                                alt={name}
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
                            <strong title={name}>{name}</strong>
                            <span className={"item-status " + (regenerating ? "running" : status)}>
                              {regenerating ? (
                                <>
                                  <Loader2 className="spin" size={12} />
                                  {t("重新生成中", "Regenerating")}
                                </>
                              ) : status === "placed" ? (
                                <>
                                  <Check size={12} />
                                  {t("已摆放", "Placed")}
                                </>
                              ) : status === "ready" ? (
                                t("待摆放", "To place")
                              ) : status === "failed" ? (
                                t("失败", "Failed")
                              ) : (
                                t("生成中", "Generating")
                              )}
                            </span>
                          </div>
                          {meta && <span className="card-meta">{meta}</span>}
                          {status === "failed" && task && <p className="small muted">{taskError(task)}</p>}
                          {remakeable && (
                            <button
                              className="text-button remake"
                              disabled={busy}
                              title={t(`用 Tripo 高精度重新生成（8K 贴图），约 ${TRIPO_CREDITS} 积分`, `Make it again with Tripo in high detail (8K textures), about ${TRIPO_CREDITS} credits`)}
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(() => regenerate(i));
                              }}
                            >
                              <Sparkles size={13} />
                              {t("高精度重新生成", "Regenerate in HD")}
                            </button>
                          )}
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
                              {retryLabel(task, t)}
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-shelf">
                    <Box size={24} />
                    <h2>{t("想挪动或添置家具？", "Move or add furniture?")}</h2>
                    <p>{t("打开工具栏的「挪动原家具」，在房间里点一下照片里的家具，上传它的照片，就能变成可以移动的 3D 模型。", "Turn on “Move room furniture” in the toolbar, click a piece in the room and upload a photo of it: it becomes a 3D model you can move.")}</p>
                    <div className="empty-actions">
                      <button className="button primary" disabled={!libraryOpen} onClick={() => setPanel("library")}>
                        <Library size={15} />
                        {t("从家具库挑一件", "Pick from the library")}
                      </button>
                      {p.mode === "real" && (
                        <button className="text-button" onClick={() => setAddOpen(true)}>
                          <Plus size={14} />
                          {t("上传照片添加新家具", "Add new furniture from a photo")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {p.items.length > 0 && (
                  <div className="shelf-footer">
                    <Info size={14} />
                    {t("填了尺寸的按真实大小摆放，其余为估计", "Pieces with sizes are true to scale; the rest are estimates")}
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
            ready={
              p.mode !== "real"
                ? t("示例房间不生成新家具，可以从家具库挑选。", "The sample room doesn't generate furniture. Pick from the library instead.")
                : !generationReady.furniture
                  ? t("尚未配置 Tripo，暂时不能生成家具。可以先从家具库挑选。", "Tripo isn't set up, so furniture can't be generated yet. Pick from the library meanwhile.")
                  : null
            }
            onSubmit={addPieces}
          />
        )}
        {roomPick && (
          <div className="pick-pop" style={{ left: roomPick.x, top: roomPick.y }} role="dialog" aria-label={t("把家具变成可编辑", "Make this piece movable")}>
            <strong>{t("把它变成可编辑的家具？", "Make this piece movable?")}</strong>
            <p>{t("上传这件家具的照片，会生成 3D 模型放回原处，之后就能挪动它。", "Upload a photo of it: a 3D model takes its place, and then you can move it.")}</p>
            <div className="pick-actions">
              <button className="button primary" onClick={startEdit}>
                {t("是，上传照片", "Yes, upload a photo")}
              </button>
              <button className="text-button" onClick={() => setRoomPick(null)}>
                {t("取消", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {editDraft && (
          <aside className="shelf edit-panel" aria-label={t("变成可编辑家具", "Make a piece movable")}>
            <div className="shelf-heading">
              <h2>{editDraft.mode === "adjust" ? t("调整擦除范围", "Adjust the erase box") : t("变成可编辑家具", "Make it movable")}</h2>
              <button className="icon" aria-label={t("取消", "Cancel")} onClick={closeEdit}>
                <X size={16} />
              </button>
            </div>
            <p className="shelf-note">
              {t("拖动房间里的蓝色方框，直到原来的家具完全消失（连同靠墙的部分和床头）。", "Drag the blue box in the room until the old piece is completely gone (including the headboard and what touches the wall).")}
            </p>
            <div className="edit-body">
              {editDraft.mode === "new" && (
              <>
              <div className="kind-chips">
                {Object.entries(TYPICAL).filter(([k]) => k !== "pendant").map(([k, typical]) => (
                  <button key={k} className={editDraft.kind === k ? "chosen" : ""} aria-pressed={editDraft.kind === k} onClick={() => chooseKind(k)}>
                    {lang === "en" ? typical.nameEn : typical.name}
                  </button>
                ))}
              </div>
              <label className="edit-field">
                <span>{t("名称", "Name")}</span>
                <input value={editDraft.name} maxLength={24} onChange={(e) => changeEdit({ name: e.target.value })} />
              </label>
              </>
              )}
              <div className="dims">
                {(["w", "d", "h"] as const).map((k) => (
                  <label key={k}>
                    <span>
                      {(editDraft.mode === "adjust"
                        ? { w: t("范围宽", "Box W"), d: t("范围深", "Box D"), h: t("范围高", "Box H") }
                        : { w: t("宽", "W"), d: t("深", "D"), h: t("高", "H") })[k]}
                    </span>
                    <input inputMode="decimal" value={editDraft[k]} onChange={(e) => changeEdit({ [k]: e.target.value } as Partial<EditDraft>)} />
                    <em>cm</em>
                  </label>
                ))}
              </div>
              {editDraft.mode === "new" && (
                <div className="edit-field">
                  <span>
                    {t("擦除范围再放宽 ", "Extra margin ")}<b>{Math.round(editDraft.pad * 100)} cm</b>
                  </span>
                  <input type="range" min={0} max={0.4} step={0.01} value={editDraft.pad} aria-label={t("擦除范围外扩", "Erase box margin")} onChange={(e) => changeEdit({ pad: Number(e.target.value) })} />
                </div>
              )}
              {p?.mode === "real" && (
                <button className="text-button fit-button" onClick={autoFit} title={t("按房间扫描重新找出这件家具的轮廓", "Find the piece's outline in the room scan again")}>
                  <Scan size={14} />
                  {t("自动贴合方框", "Fit the box to the piece")}
                </button>
              )}
              <div className="rotate-row">
                <span>{t("方向", "Turn")}</span>
                <button className="icon" aria-label={t("向左转 5 度", "Turn 5° left")} onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation + Math.PI / 36 } })}>
                  <RotateCcw />
                </button>
                <span className="value">{Math.round((((editDraft.erase.rotation * 180) / Math.PI) % 360 + 360) % 360)}°</span>
                <button className="icon" aria-label={t("向右转 5 度", "Turn 5° right")} onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation - Math.PI / 36 } })}>
                  <RotateCw />
                </button>
                <button className="text-button" onClick={() => changeEdit({ erase: { ...editDraft.erase, rotation: editDraft.erase.rotation + Math.PI / 2 } })}>
                  {t("转 90°", "Turn 90°")}
                </button>
              </div>
              <div className="nudge-row">
                <span>{t("位置", "Move")}</span>
                <button className="icon" aria-label={t("方框往左 5 厘米", "Box 5 cm left")} onClick={() => nudge(-0.05, 0)}>
                  <ChevronLeft />
                </button>
                <button className="icon" aria-label={t("方框往里 5 厘米", "Box 5 cm further")} onClick={() => nudge(0, 0.05)}>
                  <ChevronDown style={{ transform: "rotate(180deg)" }} />
                </button>
                <button className="icon" aria-label={t("方框往外 5 厘米", "Box 5 cm nearer")} onClick={() => nudge(0, -0.05)}>
                  <ChevronDown />
                </button>
                <button className="icon" aria-label={t("方框往右 5 厘米", "Box 5 cm right")} onClick={() => nudge(0.05, 0)}>
                  <ChevronLeft style={{ transform: "rotate(180deg)" }} />
                </button>
              </div>
              {editDraft.mode === "adjust" ? (
                <button className="button primary full" disabled={busy} onClick={() => run(saveErasure)}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                  {t("保存擦除范围", "Save the erase box")}
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
                  if (f?.type.startsWith("image/")) choosePhoto(f);
                }}
              >
                {editDraft.photoURL ? (
                  <img src={editDraft.photoURL} alt={t("家具照片", "Furniture photo")} />
                ) : (
                  <>
                    <ImageIcon size={22} />
                    <strong>{t("上传这件家具的照片", "Upload a photo of this piece")}</strong>
                    <span>{t("白底或干净背景、拍到全貌、没有遮挡", "Plain backdrop, the whole piece, nothing in front")}</span>
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
                  if (f) choosePhoto(f);
                  e.target.value = "";
                }}
              />
              {editReuse ? (
                <p className="reuse-note">
                  <CheckCircle2 size={15} />
                  {t("这张照片之前已经生成过 3D 模型，直接复用，不消耗积分。", "This photo was already made into 3D, so its model is reused. No credits.")}
                </p>
              ) : (
                <label className="approve">
                  <input type="checkbox" checked={editDraft.agree} onChange={(e) => changeEdit({ agree: e.target.checked })} />
                  {t(`用 Tripo 高精度生成 3D 模型（8K 贴图），预计消耗约 ${TRIPO_CREDITS} 积分`, `Generate the 3D model with Tripo in high detail (8K textures), about ${TRIPO_CREDITS} credits`)}
                </label>
              )}
              <button
                className="button primary full"
                disabled={busy || !editDraft.photo || !(editDraft.agree || editReuse) || !editDraft.name.trim()}
                onClick={() => run(submitEdit)}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                {editReuse ? t("擦除原家具并放回模型", "Erase the old piece and put the model in") : t("擦除原家具并生成", "Erase the old piece and generate")}
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
              {t("原图参考", "Photo")}
              <ChevronDown size={15} />
            </button>
            {reference && <img src={url(p.original)} alt={t("房间原图参考", "The room photo, for reference")} />}
          </div>
        )}
        {item?.status === "placed" && p && (() => {
          const entry = item.catalogId ? catalogItem(item.catalogId) : undefined;
          const lift = Math.round((item.position[1] - p.floor.height) * 100);
          const hangs = hangsFromCeiling(item);
          const carried = new Set(hangs ? [] : (placement.current?.riders(item.id) ?? []));
          // Raised or lowered, what stands on the piece goes with it.
          const liftBy = (dy: number) =>
            changeItems(p.items.map((i) => (i.id === item.id || carried.has(i.id) ? shifted(i, dy) : i)));
          const raise = (cm: number) => liftBy(Math.max(p.floor.height, item.position[1] + cm / 100) - item.position[1]);
          // Hung on a wall or left in mid-air: 落下 puts it on the desk, bed or floor under it.
          const rest = placement.current?.restAt(item.position[0], item.position[2], item.position[1] + 0.02, [item.id, ...carried]) ?? p.floor.height;
          const floating = !hangs && item.position[1] - rest > 0.04;
          const shown = placement.current?.sizeOf(item.id) ?? null;
          const resize = (data: Partial<Item>) => {
            // A hanging piece keeps its top where it hangs from; a standing one its riders on its top.
            if (hangs && data.scale !== undefined && shown) {
              const h = shown.size[1],
                next = (h * data.scale) / item.scale;
              patch(item.id, { ...data, position: [item.position[0], item.position[1] + h - next, item.position[2]] });
              return;
            }
            placement.current?.carry(item.id);
            patch(item.id, data);
          };
          const size = (v: number) => Math.round(v * item.scale);
          const cm = (v: number) => Math.round(v * 100);
          // Typed sizes as typed (and scaled); a model kept in its photo's proportions, as shown.
          const sizeText =
            item.dims && !shown?.uniform
              ? `${size(item.dims.w)} × ${size(item.dims.d)} × ${size(item.dims.h)}`
              : shown
                ? `${cm(shown.size[0])} × ${cm(shown.size[2])} × ${cm(shown.size[1])}`
                : "";
          const original = item.model?.endsWith(".lite.glb") ? item.model.replace(/\.lite\.glb$/, ".glb") : null;
          const generated = !!item.model && !item.model.startsWith("/") && !item.catalogId;
          const canHang = hangs || ["pendant", "lamp", "other"].includes(item.kind);
          return (
            <div className="inspector glass">
              <div className="inspector-head">
                <div className="inspector-name">
                  <strong title={displayName(item)}>{displayName(item)}</strong>
                  <span className="inspector-meta">
                    {entry ? (
                      <>
                        {entry.shop} · <b>{formatPrice(entry)}</b>
                        <span className="offer-tip" tabIndex={0} aria-label={t("标价详情", "Price details")}>
                          <Info size={13} />
                          <span className="offer-card glass" role="tooltip">
                            {t(`${marketLabel(entry)}标价 ${formatOriginal(entry)}`, `${formatOriginal(entry)} on the ${marketLabel(entry, "en")}`)} · {variantText(entry, lang)}
                            {availabilityLabel(entry, lang) && (
                              <>
                                {" · "}
                                <em>{availabilityLabel(entry, lang)}</em>
                              </>
                            )}
                            {buyNoteText(entry, lang) && ` · ${buyNoteText(entry, lang)}`}
                            {entry.memberOffer && ` · ${lang === "en" ? entry.memberOffer.labelEn : entry.memberOffer.label} ${formatUSD(entry.memberOffer.price)}`}
                          </span>
                        </span>
                      </>
                    ) : item.source === "upload" ? (
                      t("你上传的家具", "Your upload")
                    ) : (
                      t("当前 3D 对象", "3D object")
                    )}
                    {sizeText && (
                      <span
                        className="size-readout"
                        title={entry ? t(`标称 ${dimsText(entry, lang)}`, `Listed ${dimsText(entry, lang)}`) : shown?.uniform ? t("填写的尺寸和照片比例差别较大，已按照片比例缩放", "The size you gave differs a lot from the photo's proportions, so the photo's proportions are kept") : t("你填写的尺寸", "The size you gave")}
                      >
                        · <b>{sizeText}</b> cm{shown?.uniform && <em>{t("按照片比例", "photo proportions")}</em>}
                      </span>
                    )}
                  </span>
                </div>
                <div className="inspector-actions">
                  {entry && (
                    <a
                      className="buy-link"
                      href={entry.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t(`打开 ${entry.shop} ${marketLabel(entry)}的商品页（新标签页）`, `Open the product page on the ${entry.shop} ${marketLabel(entry, "en")} (new tab)`)}
                    >
                      {t("去官网", "Shop")}
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                  {original && (
                    <a className="icon" href={url(original)} download={displayName(item) + ".glb"} title={t("下载原始模型（8K 贴图）", "Download the original model (8K textures)")} aria-label={t("下载原始模型", "Download the original model")}>
                      <Download size={15} />
                    </a>
                  )}
                  {generated && (
                    <button className="icon" title={t(`高精度重新生成（约 ${TRIPO_CREDITS} 积分）`, `Regenerate in high detail (about ${TRIPO_CREDITS} credits)`)} aria-label={t("高精度重新生成", "Regenerate in high detail")} disabled={busy} onClick={() => run(() => regenerate(item))}>
                      <Sparkles size={15} />
                    </button>
                  )}
                  <button
                    className="tool"
                    onClick={() => {
                      changeItems(settleOff(p.items, item.id).map((i) => (i.id === item.id ? { ...i, status: "ready" as const } : i)));
                      setSelected(null);
                    }}
                  >
                    <ArrowUpFromLine size={15} />
                    {t("收回", "Put away")}
                  </button>
                  <button
                    className="icon danger"
                    aria-label={t("移除选中家具", "Remove this piece")}
                    title={t("移除", "Remove")}
                    onClick={() => {
                      changeItems(settleOff(p.items, item.id).filter((i) => i.id !== item.id));
                      setSelected(null);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                  <button className="icon" aria-label={t("取消选中", "Deselect")} onClick={() => setSelected(null)}>
                    <X size={15} />
                  </button>
                </div>
              </div>
              <div className="inspector-row">
                <label>{t("旋转", "Turn")}</label>
                <button className="icon" aria-label={t("向左旋转", "Turn left")} onClick={() => turn(item, -Math.PI / 12)}>
                  <RotateCcw />
                </button>
                <span className="value">{(((Math.round((item.rotation * 180) / Math.PI) % 360) + 360) % 360)}°</span>
                <button className="icon" aria-label={t("向右旋转", "Turn right")} onClick={() => turn(item, Math.PI / 12)}>
                  <RotateCw />
                </button>
                <span className="divider" />
                <label>{t("比例", "Scale")}</label>
                <button className="icon" aria-label={t("缩小家具", "Smaller")} onClick={() => resize({ scale: Math.max(0.1, Math.round((item.scale - 0.1) * 10) / 10) })}>
                  <Minus />
                </button>
                <button className="value reset-scale" title={t("恢复初始比例", "Back to 100%")} onClick={() => resize({ scale: 1 })}>
                  {Math.round(item.scale * 100)}%
                </button>
                <button className="icon" aria-label={t("放大家具", "Larger")} onClick={() => resize({ scale: Math.min(5, Math.round((item.scale + 0.1) * 10) / 10) })}>
                  <Plus />
                </button>
                <span className="divider" />
                <label htmlFor="lift-input" title={t("壁挂的搁板、挂钩可以挂到墙上", "Raise shelves and hooks onto a wall")}>
                  {t("离地", "Height")}
                </label>
                <button className="icon" aria-label={t("降低 5 厘米", "5 cm lower")} disabled={lift <= 0} onClick={() => raise(-5)}>
                  <Minus />
                </button>
                <LiftInput key={item.id + ":" + lift} id="lift-input" value={lift} onCommit={(v) => raise(v - lift)} />
                <button className="icon" aria-label={t("升高 5 厘米", "5 cm higher")} onClick={() => raise(5)}>
                  <Plus />
                </button>
                {!item.dims && (
                  <>
                    <span className="divider" />
                    <label htmlFor="height-input">{t("高度（估计）", "Height (est.)")}</label>
                    <input
                      id="height-input"
                      className="small-number"
                      type="number"
                      min=".1"
                      max="5"
                      step=".05"
                      value={item.height}
                      onChange={(e) => resize({ height: Number(e.target.value) || 1 })}
                    />
                    <span className="unit">m</span>
                  </>
                )}
                <div className="inspector-extras">
                  {canHang && (
                    <button
                      className={"tool" + (hangs ? " on" : "")}
                      aria-pressed={hangs}
                      title={t("吊在天花板上，拖动时沿天花板移动", "Hang it from the ceiling; dragging moves it along the ceiling")}
                      onClick={() => setMount(item, hangs ? "floor" : "ceiling")}
                    >
                      <Lamp size={15} />
                      {t("吊在天花板", "Hang")}
                    </button>
                  )}
                  {floating && (
                    <button className="tool" title={t("落到下面的桌面、床面或地面", "Drop onto the desk, bed or floor below")} onClick={() => liftBy(rest - item.position[1])}>
                      <ArrowDownToLine size={15} />
                      {t("落下", "Drop")}
                    </button>
                  )}
                  {p.room?.erasures?.some((x) => x.item === item.id) && (
                    <button className="tool" onClick={() => adjustErasure(item.id)}>
                      <Scan size={15} />
                      {t("调整擦除范围", "Erase box")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        {floorOpen && p && (
          <div className="floor-panel">
            <div className="inspector-title">
              <strong>{t("地面位置", "Floor")}</strong>
              <button className="icon" onClick={() => setFloorOpen(false)} aria-label={t("关闭地面校准", "Close floor settings")}>
                <X />
              </button>
            </div>
            <p>
              {floorNote ||
                t("让网格刚好贴在地板上：网格浮在地板上方就往左拖，网格看不见了就往右一点。", "Make the grid sit right on the floor: if it floats above, drag left; if it disappears, nudge right.")}
            </p>
            <div className="floor-field">
              <span>{t("地面高度", "Floor height")}</span>
              <input
                type="range"
                min={-3}
                max={1}
                step={0.01}
                value={p.floor.height}
                aria-label={t("地面高度", "Floor height")}
                onChange={(e) => setFloor({ height: Number(e.target.value) })}
              />
              <div className="floor-step">
                <button className="icon" aria-label={t("地面下移 1 厘米", "Floor 1 cm down")} onClick={() => setFloor({ height: p.floor.height - 0.01 })}>
                  <Minus />
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t("地面高度（米）", "Floor height (m)")}
                  value={floorDraft}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setFloorDraft(e.target.value)}
                  onBlur={commitFloorDraft}
                  onKeyDown={(e) => e.key === "Enter" && commitFloorDraft()}
                />
                <span>m</span>
                <button className="icon" aria-label={t("地面上移 1 厘米", "Floor 1 cm up")} onClick={() => setFloor({ height: p.floor.height + 0.01 })}>
                  <Plus />
                </button>
              </div>
            </div>
            <div className="floor-field">
              <span>
                {t("可摆放范围 ", "Placement area ")}<b>{p.floor.size} × {p.floor.size} m</b>
              </span>
              <input
                type="range"
                min={2}
                max={20}
                step={0.5}
                value={p.floor.size}
                aria-label={t("可摆放范围", "Placement area")}
                onChange={(e) => setFloor({ size: Number(e.target.value) })}
              />
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                commitFloorDraft();
                void persistFloor({ ...p.floor, confirmed: true }, t("地面位置已保存。", "Floor saved."));
                setFloorNote("");
                setFloorOpen(false);
              }}
            >
              {t("确认并保存", "Confirm and save")}
            </button>
          </div>
        )}
        <footer className="workspace-footer">
          <div>
            <span className="tiny-dot" />
            {p?.mode === "demo" ? t("示例模式", "Sample") : p?.room ? t("3D 空间", "3D room") : t("照片 → 空间", "Photo → room")}
          </div>
          <span>{t("拖动空白旋转 · 右键平移 · 滚轮缩放视角", "Drag to orbit · right-drag to pan · scroll to zoom")}</span>
          <button
            className="text-button"
            onClick={() => {
              setShowServices(true);
              fetch("/api/workbench?services=1")
                .then((r) => r.json())
                .then(setServices)
                .catch(() => setServices({ error: t("服务状态暂时不可用", "Service status is unavailable for a moment") }));
            }}
          >
            {t("服务状态", "Services")}
          </button>
        </footer>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            className="icon"
            aria-label={t("关闭提示", "Dismiss")}
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
                <span className="eyebrow">{spaceName(p.name, lang)} · {t("处理步骤", "Steps")}</span>
                <DialogTitle>
                  {p.mode === "demo"
                    ? t("示例房间", "Sample room")
                    : p.stage === "branch" || p.stage === "upload"
                      ? t("把照片变成 3D 房间", "Turn the photo into a 3D room")
                      : p.stage === "confirm" || p.stage === "detecting"
                        ? t("确认本次处理的家具", "Confirm the furniture to process")
                        : p.stage === "review"
                          ? t("看看处理后的房间", "Look at the processed room")
                          : p.stage === "processing"
                            ? t("正在修复房间背景", "Repairing the background")
                            : p.room
                              ? t("空间已就绪", "The room is ready")
                              : t("正在生成空间", "Generating the room")}
                </DialogTitle>
              </div>
              <button
                className="icon"
                aria-label={t("关闭处理步骤", "Close steps")}
                onClick={() => setDrawer(false)}
              >
                <X />
              </button>
            </div>
            {p.mode === "demo" ? (
              <div className="demo-explanation">
                <Box size={40} />
                <h3>{t("从右侧挑一件家具，放进房间。", "Pick a piece on the right and place it in the room.")}</h3>
                <p>
                  {t("这里的床、书桌和柜子是明确标注的示例几何模型，供验证交互。", "The bed, desk and cabinet here are simple sample shapes, for trying things out.")}
                  <br />
                  {t("上传自己的照片后，将进入真实识别与生成流程。", "Upload your own photo to turn your real room into 3D.")}
                </p>
                <button
                  className="button primary"
                  onClick={() => setDrawer(false)}
                >
                  {t("继续摆放", "Keep arranging")}
                </button>
              </div>
            ) : (
              <>
                <div className="steps">
                  {[t("照片与选择", "Photo"), t("确认家具", "Furniture"), t("预览与下载", "Preview"), t("可选 3D", "3D")].map((s, i) => {
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
                          alt={p.stage === "review" ? t("处理后的房间", "The processed room") : t("原始房间照片", "The original room photo")}
                        />
                      ) : (
                        <button
                          className="button"
                          onClick={() => fileRef.current?.click()}
                        >
                          {t("选择照片", "Choose a photo")}
                        </button>
                      )}
                      {!manual &&
                        p.stage !== "review" &&
                        p.candidates.map((c) => (
                          <button
                            key={c.id}
                            aria-label={t("选择" + c.name, "Choose " + pieceName(c.name, "en"))}
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
                          aria-pressed={choices.includes(c.id)} aria-label={t("选择" + c.name, "Choose " + pieceName(c.name, "en"))}>{i+1} · {pieceName(c.name, lang)}</button>
                      ))}
                      {recognizing && <div className="recognition-veil"><Scan size={25}/><span>{t("正在识别家具", "Recognising furniture")}</span></div>}
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
                        ? t("依次点击家具轮廓，至少 3 个点；白色区域将成为像素掩膜。", "Click around the piece, at least 3 points; the white area becomes the mask.")
                        : p.stage === "review"
                          ? t("已将掩膜外区域恢复为原图像素", "Everything outside the mask is the original photo")
                          : t("原始照片 · 保持家具本来的样子", "Original photo · furniture as it is")}
                    </div>
                    {p.stage === "review" && (
                      <details>
                        <summary>{t("对照原图", "Compare with the original")}</summary>
                        <img
                          className="compare-original"
                          src={url(p.original)}
                          alt={t("处理前原图", "Before processing")}
                        />
                      </details>
                    )}
                  </div>
                  <div className="flow-controls">
                    {["detecting", "confirm"].includes(p.stage) && recognitionStatus}
                    {["branch", "upload"].includes(p.stage) && (
                      <>
                        <div className="draft-first">
                          <h3>{t("生成这间房的 3D 空间", "Turn this room into 3D")}</h3>
                          <p className="muted small">
                            {t(
                              "World Labs 用这张照片生成可以走进去的 3D 房间（草稿模型，约 5 分钟）。照片里的家具会留在房间里，之后可以点它们，换成能移动的模型。",
                              "World Labs turns the photo into a 3D room you can step into (draft model, about 5 minutes). The furniture stays in the room; later you can click a piece to swap it for a movable model.",
                            )}
                          </p>
                          <button
                            className="button primary full"
                            disabled={busy || recognizing || !generationReady.world}
                            onClick={() => {
                              if (window.confirm(t(`用 World Labs 草稿模型生成 3D 房间，预计消耗约 ${WORLD_CREDITS} 积分。现在生成？`, `Generate the 3D room with the World Labs draft model, about ${WORLD_CREDITS} credits. Generate now?`)))
                                void run(() => generate(true));
                            }}
                          >
                            {busy ? <Loader2 className="spin" size={16} /> : <Box size={16} />}
                            {t(`直接生成 3D 房间（草稿 · 约 ${WORLD_CREDITS} 积分）`, `Generate the 3D room (draft · about ${WORLD_CREDITS} credits)`)}
                          </button>
                          {!generationReady.world && (
                            <p className="small muted">{t("尚未配置 World Labs 密钥，暂时不能生成；可以导入在 Marble 官网生成的房间。", "No World Labs key is set up, so generation is off; you can import a room made on the Marble website.")}</p>
                          )}
                          <div className="marble-hint">
                            <p>
                              {t(
                                "草稿生成快，但画面偏糊。想要更清晰逼真的房间，可以去 Marble 官网用 Marble 1.1 模型生成同一张照片，再把链接粘贴进来导入（不消耗本工作台积分）。",
                                "Draft rooms are quick but soft. For a sharper, more lifelike room, generate the same photo with Marble 1.1 on the Marble website, then paste its link here to import it (no credits from this app).",
                              )}
                            </p>
                            <div>
                              <a className="text-button" href={MARBLE} target="_blank" rel="noopener noreferrer">
                                {t("去 Marble 官网", "Open Marble")} <ArrowUpRight size={13} />
                              </a>
                              <button className="text-button" disabled={busy || recognizing} onClick={() => setImportOpen((v) => !v)}>
                                {t("导入 Marble 房间", "Import a Marble room")}
                              </button>
                            </div>
                          </div>
                          {importOpen && importBlock}
                        </div>
                        <details className="optional-flow" open={p.candidates.length > 0 || recognizing || undefined}>
                          <summary>
                            {t("先处理家具（可选）", "Handle the furniture first (optional)")}
                            <span>{t("移走家具、补全背景，或单独生成家具模型", "Remove pieces and fill the background, or model pieces separately")}</span>
                          </summary>
                          {recognitionStatus}
                        <h3>{t("是否要移除屋内家具？", "Remove furniture from the room?")}</h3>
                        <button
                          className={
                            "branch-option " +
                            (branch === "remove" ? "chosen" : "")
                          }
                          onClick={() => setBranch("remove")}
                        >
                          <span className="radio" />
                          <div>
                            <strong>{t("是，移除指定家具", "Yes, remove chosen pieces")}</strong>
                            <p>{t("这些家具不要了，只修复背景，不生成模型。", "They go; only the background is repaired, no models are made.")}</p>
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
                            <strong>{t("否，保留并让它们可编辑", "No, keep them and make them movable")}</strong>
                            <p>{t("免费提取透明家具图、补全背景；之后可选生成 3D。", "Free cut-outs and background repair; 3D models are optional later.")}</p>
                          </div>
                        </button>
                        {!!p.candidates.length && <div className="detected-chips" aria-label={t("识别出的家具", "Recognised furniture")}>{p.candidates.map(c=>(
                          <button key={c.id} className={choices.includes(c.id)?"chosen":""} aria-pressed={choices.includes(c.id)} onClick={()=>setChoices(v=>v.includes(c.id)?v.filter(id=>id!==c.id):[...v,c.id])}>
                            {choices.includes(c.id)?<Check size={14}/>:<Plus size={14}/>} {pieceName(c.name, lang)}
                          </button>
                        ))}</div>}
                        <label className="field-label" htmlFor="intent">
                          {branch === "remove"
                            ? t("你想移除哪些家具？", "Which pieces should go?")
                            : t("你想让哪些家具变得可编辑？", "Which pieces should become movable?")}
                        </label>
                        <textarea
                          id="intent"
                          value={intent}
                          onChange={(e) => setIntent(e.target.value)}
                          placeholder={
                            branch === "remove"
                              ? t("例如：删除书桌", "For example: the desk")
                              : t("例如：床和书桌，或窗边的柜子", "For example: the bed and the desk, or the cabinet by the window")
                          }
                          maxLength={500}
                        />
                        <p className="muted small">
                          {t("未选中的家具保留在背景中，不能单独移动。", "Pieces not chosen stay in the background and can't be moved on their own.")}
                        </p>
                        <button
                          className="button full"
                          disabled={busy || recognizing || (!intent.trim() && !choices.length)}
                          onClick={() => run(detect)}
                        >
                          {busy ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <Scan size={16} />
                          )}
                          {t("查看并确认选择", "Review the selection")}
                        </button>
                        <button
                          className="text-button full"
                          onClick={() => {
                            setManual(true);
                            setPoints([]);
                          }}
                        >
                          {t("手动圈选家具", "Outline a piece by hand")}
                        </button>
                        {manual && manualControls(t("完成圈选", "Done"))}
                        </details>
                      </>
                    )}
                    {["detecting", "confirm"].includes(p.stage) && (
                      <>
                        <button className="text-button" disabled={busy||running||recognizing} onClick={()=>setP({...p,stage:"branch"})}><ChevronLeft size={15}/> {t("调整处理方式", "Change the approach")}</button>
                        <h3>{running ? t("正在查找家具", "Finding the furniture") : t("请确认具体对象", "Confirm the pieces")}</h3>
                        <p className="muted">
                          {p.branch === "remove"
                            ? t("仅移除你勾选的家具，不生成独立模型。", "Only the ticked pieces are removed; no models are made.")
                            : t("先提取选中家具的透明图片，并补全它们背后的房间。预览满意后可以下载，也可以继续生成 3D。", "First the chosen pieces are cut out and the room behind them is filled in. Then download it, or go on to 3D.")}
                        </p>
                        {p.intent && (
                          <div className="intent-quote">“{p.intent}”</div>
                        )}
                        {p.candidates.length === 0 && !running && (
                          <div className="notice">
                            {t("没有找到匹配对象。可以修改描述重新检测，或手动圈选。", "Nothing matched. Change the description, or outline by hand.")}
                          </div>
                        )}
                        {p.candidates.map((c) => (
                          <div className="candidate" key={c.id}>
                            <input
                              type="checkbox"
                              aria-label={t("本次处理" + c.name, "Process " + pieceName(c.name, "en"))}
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
                              <strong>{pieceName(c.name, lang)}</strong>
                              <span>
                                {c.source === "manual"
                                  ? t("手动轮廓 · 请检查完整性", "Hand outline · check it's complete")
                                  : c.score < 0.7
                                    ? t("识别不确定 · 请仔细确认", "Unsure · check carefully")
                                    : c.source === "local-detr"
                                      ? t(
                                          `自动识别 · ${Math.round(c.score*100)}%${c.needsReview ? (c.kind === "cabinet" ? " · 请确认可移动" : " · 轮廓需检查") : " · 请核对轮廓"}`,
                                          `Recognised · ${Math.round(c.score*100)}%${c.needsReview ? (c.kind === "cabinet" ? " · check it can be moved" : " · check the outline") : " · check the outline"}`,
                                        )
                                      : t("候选实例 · 请核对照片", "Candidate · check the photo")}
                              </span>
                            </div>
                            <select className="candidate-kind" aria-label={t("修正" + c.name + "类别", "Kind of " + pieceName(c.name, "en"))} value={c.kind} disabled={busy||recognizing||running} onChange={e=>{
                              const kind=e.target.value;
                              void run(async()=>setP(await api({action:"correct-candidate",id:p.id,candidate:c.id,kind})));
                            }}>
                              <option value="bed">{t("床", "Bed")}</option><option value="desk">{t("桌子", "Table")}</option><option value="cabinet">{t("柜子", "Cabinet")}</option><option value="chair">{t("椅子／凳", "Chair / stool")}</option><option value="sofa">{t("沙发", "Sofa")}</option>
                            </select>
                          </div>
                        ))}
                        {p.candidates.length > 1 && (
                          <p className="small muted">
                            {t("名称相同也可能是不同实例；“窗边”等方位需在图中核对。", "Same names can be different pieces; check places like “by the window” on the photo.")}
                          </p>
                        )}
                        {imageRepair===false && <div className="notice">{t("本地修复模型未就绪，请重新启动工作台完成模型检查。已圈选的家具会保留。", "The local repair model isn't ready. Restart the app to finish the model check; your selection is kept.")}</div>}
                        {imageRepair && <p className="small muted">{t("本地 LaMa 修复 · 无需密钥 · 不消耗积分 · 照片留在本机", "Local LaMa repair · no key · no credits · the photo stays on this Mac")}</p>}
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
                          {busy ? (repairMessage || t("正在准备图片…", "Preparing the image…")) : t(`免费处理 ${choices.length} 件家具`, `Process ${choices.length} ${choices.length === 1 ? "piece" : "pieces"} (free)`)}
                        </button>
                        {busy && repairMessage && <button className="text-button" onClick={()=>repairAbort.current?.abort()}>{t("取消处理，保留选择", "Cancel, keep the selection")}</button>}
                        <button
                          className="text-button full"
                          disabled={running}
                          onClick={() => {
                            setManual((v) => !v);
                            setPoints([]);
                          }}
                        >
                          {t("补充手动圈选", "Add a hand outline")}
                        </button>
                        {manual && manualControls(t("完成", "Done"))}
                        <textarea
                          aria-label={t("修改家具描述", "Change the description")}
                          value={intent}
                          onChange={(e) => setIntent(e.target.value)}
                          placeholder={t("修改描述，例如左侧的书桌", "Change the description, e.g. the desk on the left")}
                        />
                        <button
                          className="text-button full"
                          disabled={busy || recognizing || running || !intent.trim()}
                          onClick={() => run(detect)}
                        >
                          {t("按描述更新选择", "Update the selection")}
                        </button>
                      </>
                    )}
                    {p.stage === "review" && (
                      <>
                        <h3>{t("修复完成，看看新的空间", "Repaired. Have a look")}</h3>
                        <p className="muted">
                          {t("目标家具应完整消失，未选家具、墙面与地板应保持原样。", "The chosen pieces should be gone entirely; everything else should look as before.")}
                        </p>
                        <div className="notice">
                          {t("掩膜外像素已严格保留。边缘残影、遮挡区域和大面积修复仍需人工检查。", "Pixels outside the mask are untouched. Check edges, hidden areas and large repairs by eye.")}
                          {quality !== null &&
                            quality > 3 &&
                            t(" 修复服务改动过未选区域，现已恢复。", " The repair changed areas outside the mask; they have been restored.")}
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
                        <a className="button primary full" href={p.rawBackground ? url(p.rawBackground)+'&download='+encodeURIComponent(t('房间-修复背景.png', 'room-repaired.png')) : undefined} download={t("房间-修复背景.png", "room-repaired.png")} aria-disabled={!processed}>{t("下载修复后的房间", "Download the repaired room")}</a>
                        <p className="small muted">{t("免费处理已完成，结果已保存在本机。大面积遮挡和家具背后的区域是推测补全，可返回重新圈选。", "Done for free and saved on this Mac. Large hidden areas are inferred; you can go back and outline again.")}</p>
                        <h3>{t("需要三维空间？", "Want it in 3D?")}</h3>
                        <p className="small muted">{t("这是独立的可选步骤。World Labs 生成空间，Tripo 生成家具模型；两者可能消耗服务商积分。", "An optional step: World Labs makes the room, Tripo the furniture models. Both may use provider credits.")}</p>
                        <label className="approve">
                          <input
                            type="checkbox"
                            checked={approved}
                            onChange={(e) => setApproved(e.target.checked)}
                          />
                          {t("已检查：没有明显残留或误删，单件家具可用于建模", "Checked: no visible leftovers or missing parts; the cut-outs are fine for modelling")}
                        </label>
                        <button
                          className="button primary full"
                          disabled={busy || !approved || !processed || !generationReady.world || (p.branch==='edit' && !generationReady.furniture)}
                          onClick={() => run(() => generate())}
                        >
                          {p.branch === "edit" ? t("继续生成 3D 空间与家具", "Generate the 3D room and furniture") : t("继续生成 3D 空间", "Generate the 3D room")}
                        </button>
                        <p className="small muted">
                          {!generationReady.world || (p.branch==='edit'&&!generationReady.furniture)
                            ? t("尚未配置 3D 服务，不影响上面的免费修复和下载。", "3D services aren't set up; the free repair and download above still work.")
                            : t(
                                `预计消耗 World Labs 约 ${WORLD_CREDITS} 积分${p.branch === "edit" && p.cutouts ? `，Tripo ${TRIPO_CREDITS} × ${Object.keys(p.cutouts).length} = ${TRIPO_CREDITS * Object.keys(p.cutouts).length} 积分` : ""}。空间使用草稿模式，家具分别生成${Object.keys(p.productPhotos ?? {}).some((id) => p.cutouts?.[id]) ? "（换了白底照片的用照片生成）" : ""}；未拍到的部分属于推测补全。`,
                                `About ${WORLD_CREDITS} World Labs credits${p.branch === "edit" && p.cutouts ? `, plus Tripo ${TRIPO_CREDITS} × ${Object.keys(p.cutouts).length} = ${TRIPO_CREDITS * Object.keys(p.cutouts).length}` : ""}. The room uses the draft model and each piece is generated separately${Object.keys(p.productPhotos ?? {}).some((id) => p.cutouts?.[id]) ? " (from the product photo where you gave one)" : ""}; what the photo didn't show is inferred.`,
                              )}
                        </p>
                        <p className="small muted marble-line">
                          {t("想要更清晰的房间？可以去 ", "Want a sharper room? Generate it with Marble 1.1 on ")}
                          <a href={MARBLE} target="_blank" rel="noopener noreferrer">
                            {t("Marble 官网", "the Marble website")}
                          </a>
                          {t("用 Marble 1.1 生成，再导入。", ", then import it.")}
                        </p>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => run(async()=>{setP(await api({action:'revise',id:p.id}));setApproved(false);})}
                        >
                          {t("返回调整选择／重新修复", "Back: change the selection or repair again")}
                        </button>
                      </>
                    )}
                    {["processing", "generating", "ready"].includes(
                      p.stage,
                    ) && (
                      <>
                        <h3>
                          {p.stage === "processing"
                            ? t("正在修复房间背景", "Repairing the background")
                            : p.room
                              ? t("空间已就绪", "The room is ready")
                              : t("正在生成空间", "Generating the room")}
                        </h3>
                        <p className="muted">
                          {p.room?.preset
                            ? t("这张照片的 Marble 1.1 房间已经准备好，地面也已对齐。", "This photo's Marble 1.1 room is ready, with the floor already set.")
                            : t("可以收起面板。服务商任务已保存，刷新后继续查询，不会重新提交。", "You can close this. Provider jobs are saved; after a refresh they are checked again, never resubmitted.")}
                        </p>
                        <div className="task-list">
                          {p.tasks
                            .map((task) => (
                              <div className={"task " + (task.status === "done" ? "done" : ["failed", "uncertain", "paused"].includes(task.status) ? "failed" : "")} key={task.id}>
                                {task.status === "done" ? (
                                  <CheckCircle2 size={18} />
                                ) : ["failed", "uncertain", "paused"].includes(
                                    task.status,
                                  ) ? (
                                  <AlertCircle size={18} />
                                ) : (
                                  <Loader2 className="spin" size={18} />
                                )}
                                <div>
                                  <strong>
                                    {task.kind === "world"
                                      ? t("房间空间", "Room")
                                      : (() => {
                                          const it = p.items.find((i) => i.id === task.target);
                                          return it ? displayName(it) : t("独立家具", "Furniture");
                                        })()}
                                  </strong>
                                  <span>
                                    {task.status === "done"
                                      ? t("已完成", "Done")
                                      : task.status === "queued"
                                        ? t("等待处理", "Waiting")
                                        : task.status === "running"
                                          ? t("服务商正在处理", "The provider is working on it")
                                          : task.status === "submitting"
                                            ? t("正在提交任务", "Submitting")
                                            : taskError(task) || t("失败", "Failed")}
                                  </span>
                                  {task.providerId && <small>{t("任务编号：", "Job: ")}{task.providerId}</small>}
                                  {["world", "furniture"].includes(task.kind) && <small>
                                    {t(
                                      `预计 ${task.estimatedCredits ?? "待确认"} · 预留 ${task.reservedCredits ?? 0} · 实际扣费 ${task.actualCredits ?? "待结算"} 积分`,
                                      `Estimate ${task.estimatedCredits ?? "pending"} · reserved ${task.reservedCredits ?? 0} · charged ${task.actualCredits ?? "pending"} credits`,
                                    )}
                                  </small>}
                                  {canRetry(task) && (
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() =>
                                        run(async () =>
                                          setP(
                                            await retryTask(task.id),
                                          ),
                                        )
                                      }
                                    >
                                      {retryLabel(task, t)}
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
                                ? t("地面已对齐，可以直接摆放家具。照片里的其他家具属于背景，点一下可以把它变成能移动的模型。", "The floor is set: place furniture right away. Furniture in the photo is part of the room; click a piece to make it movable.")
                                : t("正在根据房间结构查找地面；找不到时会请你手动对齐。照片里的其他家具属于背景，不能单独移动。", "Finding the floor from the room; if it can't, you'll be asked to set it. Furniture in the photo is part of the room and can't move on its own.")}
                            </div>
                            <button className="button primary full" onClick={() => setDrawer(false)}>
                              {t("进入空间", "Enter the room")}
                            </button>
                          </>
                        )}
                        {p.stage === "ready" && p.room && (
                          <div className="clean-layer">
                            <strong>{t("空房间底图", "Empty-room layer")}</strong>
                            <p className="small muted">
                              {p.room.clean
                                ? t("已设置。擦除家具的地方会显示底图里干净的地板和墙面。", "Set. Where furniture is erased, the clean floor and walls of this layer show.")
                                : t("导入一个同一视角、没有家具的 Marble 房间。擦除家具的地方会用它补齐，不再露出痕迹。", "Import a Marble room of the same view without furniture. Erased areas are filled from it, without traces.")}
                            </p>
                            {p.room.clean && (
                              <div className="clean-nudge" aria-label={t("底图对齐微调", "Fine-tune the layer")}>
                                <span>{t("对齐微调 · 每次 2 cm", "Fine-tune · 2 cm a step")}</span>
                                {(
                                  [
                                    [t("左", "Left"), 0, -0.02],
                                    [t("右", "Right"), 0, 0.02],
                                    [t("前", "Front"), 2, -0.02],
                                    [t("后", "Back"), 2, 0.02],
                                    [t("上", "Up"), 1, 0.02],
                                    [t("下", "Down"), 1, -0.02],
                                    [t("左转", "Turn left"), 3, 0.0087],
                                    [t("右转", "Turn right"), 3, -0.0087],
                                  ] as const
                                ).map(([label, axis, by]) => (
                                  <button key={label} className="button" disabled={busy} onClick={() => nudgeClean(axis as 0 | 1 | 2 | 3, by)}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button className="text-button" disabled={busy} onClick={() => setCleanOpen((v) => !v)}>
                              {p.room.clean ? t("换一个空房间底图", "Replace the empty-room layer") : t("导入空房间底图", "Import an empty-room layer")}
                            </button>
                            {cleanOpen && (
                              <div className="import-world">
                                <textarea
                                  aria-label={t("空房间底图的 Marble 嵌入代码", "Marble embed code of the empty room")}
                                  value={cleanText}
                                  onChange={(e) => setCleanText(e.target.value)}
                                  placeholder={t("粘贴空房间的 Marble 嵌入代码或查看器链接", "Paste the empty room's Marble embed code or viewer link")}
                                />
                                <button className="button primary full" disabled={busy || !cleanText.trim()} onClick={() => run(importClean)}>
                                  {busy ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                                  {busy ? t("正在下载底图…", "Downloading the layer…") : t("导入底图（不消耗积分）", "Import layer (no credits)")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {p.stage === "ready" && (
                          <>
                            <button className="text-button" disabled={busy} onClick={() => setImportOpen((v) => !v)}>
                              {t("换成在 Marble 官网生成的房间", "Replace with a room made on the Marble website")}
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
            aria-label={t("服务状态", "Services")}
          >
            <div className="inspector-title">
              <h2>{t("服务状态", "Services")}</h2>
              <button
                className="icon"
                aria-label={t("关闭服务状态", "Close services")}
                onClick={() => setShowServices(false)}
              >
                <X />
              </button>
            </div>
            {!services ? (
              <p>{t("正在读取实际余额…", "Reading the balances…")}</p>
            ) : (
              <>
                <div className="service-row">
                  <strong>World Labs</strong>
                  <span>
                    {(lang === "en" ? services.world?.errorEn : undefined) ||
                      services.world?.error ||
                      t(`${services.world?.remaining_credits ?? "—"} 积分`, `${services.world?.remaining_credits ?? "—"} credits`)}
                  </span>
                </div>
                <div className="service-row">
                  <strong>Tripo</strong>
                  <span>
                    {(lang === "en" ? services.tripo?.errorEn : undefined) ||
                      services.tripo?.error ||
                      t(`${services.tripo?.data?.balance ?? "—"} 积分`, `${services.tripo?.data?.balance ?? "—"} credits`)}
                  </span>
                </div>
                <div className="service-row">
                  <strong>{t("背景修复", "Background repair")}</strong>
                  <span>
                    {imageRepair ? t("本地 LaMa · 免费 · 已就绪", "Local LaMa · free · ready") : t("本地模型待安装", "Local model not installed")}
                  </span>
                </div>
                <p className="muted">
                  {t("识别、透明抠图、背景补全都在本机完成，不需要 API 密钥。World Labs 和 Tripo 仅用于可选的 3D 生成。", "Recognition, cut-outs and background repair run on this Mac without API keys. World Labs and Tripo are only for optional 3D generation.")}
                </p>
                <p className="small muted">
                  {t("本地预算上限见 .dev.vars。示例房间和演示卧室不消耗生成积分。", "Local budget limits are in .dev.vars. The sample room and the demo bedroom use no generation credits.")}
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
