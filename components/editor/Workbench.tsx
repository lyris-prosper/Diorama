"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { recognizeFurniture } from "@/lib/recognition";
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
} from "lucide-react";
import type { Project, Item, Branch, Candidate } from "@/lib/types";
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
const url = (k?: string) =>
  k ? "/api/assets?key=" + encodeURIComponent(k) : "";
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
    [savedAt, setSavedAt] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionMessage, setRecognitionMessage] = useState("");
  const [recognitionPercent, setRecognitionPercent] = useState<number | undefined>();
  const [recognitionError, setRecognitionError] = useState("");
  const [imageRepair, setImageRepair] = useState<boolean | null>(null);
  const recognitionAbort = useRef<AbortController | null>(null);
  const attemptedPhoto = useRef("");
  const masksRef = useRef<Record<string, ImageData>>({});
  const fileRef = useRef<HTMLInputElement>(null),
    viewRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(p);
  stateRef.current = p;
  useEffect(() => {
    fetch("/api/workbench?capabilities=1").then(r=>r.json()).then((j:any)=>setImageRepair(!!j.imageRepair)).catch(()=>{});
    fetch("/api/workbench")
      .then(async (r) => {
        const j: any = await r.json();
        if (!r.ok) throw Error(j.error);
        setP(j);
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
              ? { ...next, items: current.items, floor: current.floor }
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
    if (!p?.rawBackground || !p.mask || !p.original) return;
    let active = true;
    preserveOutside(p.original, p.rawBackground, p.mask)
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
  }, [p?.rawBackground]);
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
  useEffect(()=>()=>recognitionAbort.current?.abort(),[]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  async function create(mode: "real" | "demo") {
    recognitionAbort.current?.abort();
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
      setP(r.project);
      setDrawer(true);
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
    setP(
      await api({
        action: "manual",
        id: p.id,
        branch,
        intent,
        name: manualName,
        mask: r.key,
      }),
    );
    setManual(false);
    setPoints([]);
  }
  async function prepare() {
    if (!p?.original) return;
    if (imageRepair === false) throw Error("家具识别和选择已保留。背景修复服务还未连接，暂时无法移除家具；没有消耗生成积分。");
    const selected = p.candidates.filter((c) => choices.includes(c.id));
    if (!selected.length) throw Error("请勾选本次要处理的家具。");
    const r = await prepareImages(p.original, selected);
    const m = await upload(p.id, "union-mask", r.mask);
    const cutouts: Record<string, string> = {},
      originalCrops: Record<string, string> = {};
    if (p.branch === "edit")
      for (const [id, cut] of Object.entries(r.cuts)) {
        cutouts[id] = (await upload(p.id, "cutout-" + id, cut)).key;
        originalCrops[id] = (await upload(p.id, "crop-" + id, r.crops[id])).key;
      }
    setP(
      await api({
        action: "prepare",
        id: p.id,
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
    if (current.items.find((i) => i.id === id)?.status === "placed") {
      setSelected(id);
      setPending(null);
      return;
    }
    patch(id, { status: "placed", position: pos });
    setSelected(id);
    setPending(null);
    setToast("家具已放置，可直接拖动调整。");
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
  return (
    <main className="workbench">
      <header className="topbar">
        <div className="title-block">
          <span className="space-label">我的空间</span>
          <span className="slash">/</span>
          <strong>房间工作台</strong>
          {p?.mode === "demo" && <span className="badge">示例模式</span>}
        </div>
        <div className="top-actions">
          <span className="save-status">
            {dirty
              ? "有未保存的调整"
              : savedAt
                ? "已保存 " + savedAt
                : p
                  ? "已恢复空间"
                  : "准备一个新的空间"}
          </span>
          <button
            className="icon"
            title="撤销"
            aria-label="撤销"
            disabled={!history.length}
            onClick={undo}
          >
            <Undo2 />
          </button>
          <button
            className="icon"
            title="重做"
            aria-label="重做"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 />
          </button>
          <span className="divider" />
          <button
            className="button ghost"
            onClick={() => fileRef.current?.click()}
            disabled={busy || recognizing}
          >
            <Upload size={16} />
            {p ? "更换房间" : "上传照片"}
          </button>
          <button
            className="button primary"
            onClick={save}
            disabled={!p || busy}
          >
            <Save size={16} />
            保存
          </button>
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
      <section className={"workspace " + (!p ? "empty-workspace" : "")}>
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
          />
        ) : p?.original ? (
          <div className="photo-stage">
            <img src={url(p.original)} alt="上传的房间原图" />
            <span>原始照片 · 空间尚未生成</span>
          </div>
        ) : null}
        {!p && <figure className="room-art"><img src="/room-atmosphere.webp" alt="暖阳下的室内设计概念模型" /><figcaption>光、材质，与家的可能。<span>空间灵感 · 非照片生成结果</span></figcaption></figure>}
        <div className="workspace-label">
          <span className="eyebrow">ROOM WORKSPACE</span>
          <h1>{p ? p.name : "给房间，留一点想象"}</h1>
          {p?.mode === "demo" ? (
            <p>示例几何模型 · 不代表照片生成结果</p>
          ) : p?.room ? (
            <p>生成式空间 · 隐藏区域为推测补全</p>
          ) : (
            <p>把熟悉的角落，慢慢变成喜欢的样子。</p>
          )}
        </div>
        {!p && !boot && (
          <div
            className="empty-card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              receive(e.dataTransfer.files[0]);
            }}
          >
            <div className="upload-symbol">
              <ImageIcon size={31} strokeWidth={1.25} />
              <span>
                <Plus size={15} />
              </span>
            </div>
            <h2>从一张照片开始</h2>
            <p>
              有家具的房间，或一个空房间，都可以。
              <br />
              上传后自动识别家具，再由你决定如何调整。
            </p>
            <button
              className="button primary large"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={17} />
              选择照片
            </button>
            <span className="file-hint">
              也可拖拽到这里 · JPG / PNG / WebP · 最大 10 MB
            </span>
            <div className="empty-divider" />
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await create("demo");
                })
              }
            >
              探索 3D 示例房间 <Box size={15} />
            </button>
            <span className="demo-caption">
              仅体验摆放与编辑，不调用生成服务
            </span>
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
              <button className="tool" onClick={() => setFloorOpen((v) => !v)}>
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
          </div>
        )}
        {pending && (
          <div className="placement-hint">
            <Move size={17} />
            在地面点击，放置 {p?.items.find((i) => i.id === pending)?.name}
            <button
              className="icon"
              onClick={() => setPending(null)}
              aria-label="取消放置"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {p && p.items.length > 0 && (
          <aside className="shelf">
            <div className="shelf-heading">
              <div>
                <span className="eyebrow">FURNITURE</span>
                <h2>
                  待摆放家具 <span>{p.items.length}</span>
                </h2>
              </div>
              <Box size={19} />
            </div>
            <p className="shelf-note">拖入房间，或点击后选择落点</p>
            <div className="furniture-list">
              {p.items.map((i) => {
                const task = p.tasks.find((t) => t.target === i.id);
                const status =
                  task?.status === "failed" || task?.status === "uncertain"
                    ? "failed"
                    : i.status;
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
                    <button
                      className="remove-card"
                      aria-label={"移除" + i.name}
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
                    {status === "failed" && task && (
                      <button
                        className="text-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          run(async () =>
                            setP(
                              await api({
                                action: "retry",
                                id: p.id,
                                task: task.id,
                              }),
                            ),
                          );
                        }}
                      >
                        单项重试
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="shelf-footer">
              <Info size={14} />
              家具尺寸为估计，可手动校准
            </div>
          </aside>
        )}
        {p?.mode === "real" && p.room && !p.items.length && (
          <aside className="shelf empty-shelf">
            <Box size={24} />
            <h2>没有独立家具</h2>
            <p>
              {p.branch === "remove"
                ? "选中的家具已按移除流程处理。"
                : "此空间未指定可编辑家具。"}
              <br />
              背景中的家具不能单独移动。
            </p>
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
        {item?.status === "placed" && (
          <div className="inspector">
            <div className="inspector-title">
              <strong>{item.name}</strong>
              <span>当前 3D 对象</span>
              <button
                className="icon"
                aria-label="取消选中"
                onClick={() => setSelected(null)}
              >
                <X size={15} />
              </button>
            </div>
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
                {Math.round((item.rotation * 180) / Math.PI) % 360}°
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
                  patch(item.id, { scale: Math.max(0.1, item.scale - 0.1) })
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
                  patch(item.id, { scale: Math.min(5, item.scale + 0.1) })
                }
              >
                <Plus />
              </button>
            </div>
            <div className="inspector-row secondary">
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
                  changeItems(p!.items.filter((i) => i.id !== item.id));
                  setSelected(null);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}
        {floorOpen && p && (
          <div className="floor-panel">
            <div className="inspector-title">
              <strong>手动校准地面</strong>
              <button
                className="icon"
                onClick={() => setFloorOpen(false)}
                aria-label="关闭地面校准"
              >
                <X />
              </button>
            </div>
            <p>调整网格到房间地面。只在确认的方形区域内放置家具。</p>
            <label>
              地面高度{" "}
              <input
                type="number"
                step=".05"
                value={p.floor.height}
                onChange={(e) => {
                  setP({
                    ...p,
                    floor: {
                      ...p.floor,
                      height: Number(e.target.value),
                      confirmed: false,
                    },
                  });
                  setDirty(true);
                }}
              />{" "}
              m
            </label>
            <label>
              可摆放区域{" "}
              <input
                type="number"
                step=".5"
                min="2"
                max="20"
                value={p.floor.size}
                onChange={(e) => {
                  setP({
                    ...p,
                    floor: {
                      ...p.floor,
                      size: Number(e.target.value),
                      confirmed: false,
                    },
                  });
                  setDirty(true);
                }}
              />{" "}
              m
            </label>
            <button
              className="button primary"
              onClick={() => {
                setP({ ...p, floor: { ...p.floor, confirmed: true } });
                setDirty(true);
                setFloorOpen(false);
              }}
            >
              确认地面位置
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
                <span className="eyebrow">YOUR ROOM, YOUR CHOICE</span>
                <DialogTitle>
                  {p.mode === "demo"
                    ? "示例房间"
                    : p.stage === "branch" || p.stage === "upload"
                      ? "先决定，如何处理家具"
                      : p.stage === "confirm" || p.stage === "detecting"
                        ? "确认本次处理的家具"
                        : p.stage === "review"
                          ? "看看处理后的房间"
                          : "空间正在准备中"}
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
                  {["照片与选择", "确认家具", "处理图片", "生成空间"].map(
                    (s, i) => (
                      <span
                        className={
                          i ===
                          (["upload", "branch"].includes(p.stage)
                            ? 0
                            : ["confirm", "detecting"].includes(p.stage)
                              ? 1
                              : ["processing", "review"].includes(p.stage)
                                ? 2
                                : 3)
                            ? "current"
                            : ""
                        }
                        key={s}
                      >
                        <b>{i + 1}</b>
                        {s}
                      </span>
                    ),
                  )}
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
                            <p>转换为独立模型，稍后由你放回房间。</p>
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
                            disabled={busy || recognizing}
                            onClick={() => run(() => generate(true))}
                          >
                            这是空房／没有需要处理的家具
                          </button>
                          {branch === "edit" && (
                            <button
                              className="text-button"
                              disabled={busy || recognizing}
                              onClick={() => run(() => generate(true))}
                            >
                              暂不编辑家具，仅生成空间
                            </button>
                          )}
                          <span>
                            直接生成会使用 World Labs 积分（草稿约 230）。
                          </span>
                        </div>
                      </>
                    )}
                    {["detecting", "confirm"].includes(p.stage) && (
                      <>
                        <button className="text-button" disabled={busy||running||recognizing} onClick={()=>setP({...p,stage:"branch"})}><ChevronLeft size={15}/> 调整处理方式</button>
                        <h3>{running ? "正在查找家具" : "请确认具体对象"}</h3>
                        <p className="muted">
                          {p.branch === "remove"
                            ? "仅移除你勾选的家具，不生成独立模型。"
                            : "选中的家具会转换为独立模型，生成后可从侧栏放回房间；其余家具保持原样。"}
                        </p>
                        {p.intent && (
                          <div className="intent-quote">“{p.intent}”</div>
                        )}
                        {p.tasks
                          .filter(
                            (t) =>
                              t.kind === "detect" &&
                              ["failed", "uncertain"].includes(t.status),
                          )
                          .map((t) => (
                            <div className="notice" key={t.id}>
                              {t.error}
                              {t.status === "failed" && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    run(async () =>
                                      setP(
                                        await api({
                                          action: "retry",
                                          id: p.id,
                                          task: t.id,
                                        }),
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
                        {imageRepair===false && <div className="notice">家具已识别，可以选择和补充轮廓。背景修复服务尚未连接，移除家具和转为独立模型暂不可用；尚未消耗生成积分。</div>}
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
                          确认处理 {choices.length} 件家具
                        </button>
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
                        <h3>生成前，再检查一次</h3>
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
                          <div className="cutout-review">
                            {Object.entries(p.cutouts).map(([id, key]) => (
                              <figure key={id}>
                                <img
                                  src={url(key)}
                                  alt={
                                    p.candidates.find((c) => c.id === id)
                                      ?.name || "单件家具图"
                                  }
                                />
                                <figcaption>
                                  {p.candidates.find((c) => c.id === id)?.name}{" "}
                                  · 检查是否完整
                                </figcaption>
                              </figure>
                            ))}
                          </div>
                        )}
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
                          disabled={busy || !approved || !processed}
                          onClick={() => run(() => generate())}
                        >
                          确认并生成空间{p.branch === "edit" ? "与家具" : ""}
                        </button>
                        <p className="small muted">
                          空间使用草稿模式。家具分别生成；未拍到的部分属于推测补全。
                        </p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setP({ ...p, stage: "confirm" });
                            setApproved(false);
                          }}
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
                              <div className="task" key={t.id}>
                                {t.status === "done" ? (
                                  <CheckCircle2 size={18} />
                                ) : ["failed", "uncertain"].includes(
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
                                  {t.status === "failed" && (
                                    <button
                                      className="text-button"
                                      disabled={busy || t.attempt >= 3}
                                      onClick={() =>
                                        run(async () =>
                                          setP(
                                            await api({
                                              action: "retry",
                                              id: p.id,
                                              task: t.id,
                                            }),
                                          ),
                                        )
                                      }
                                    >
                                      重试此项（{t.attempt}/3）
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                        {p.room && (
                          <>
                            <div className="notice">
                              摆放前，请校准地面。背景家具不可单独移动。
                            </div>
                            <button
                              className="button primary full"
                              onClick={() => {
                                setDrawer(false);
                                setFloorOpen(true);
                              }}
                            >
                              进入空间，校准地面
                            </button>
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
                    {services.image ? "已配置 fal.ai" : "待配置 FAL_KEY"}
                  </span>
                </div>
                <p className="muted">
                  自动识别已在浏览器内运行，无需密钥。背景修复使用 Bria Eraser，需要配置后端服务。
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
