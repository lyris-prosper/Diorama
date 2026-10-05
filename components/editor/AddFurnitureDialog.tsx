"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { typicalSizes } from "@/lib/furniture-kinds";
import { backdrop, backdropNote, PHOTO_TIPS, type Backdrop } from "@/lib/photo";
import type { Dims } from "@/lib/types";
import DimsFields, { noDims, readDims, type DimsDraft } from "./DimsFields";

export const MAX_BATCH = 8;
const CREDITS = 30;
export type NewPiece = { file: File; name: string; kind: string; dims: Dims };
type Row = { key: string; file: File | null; url: string; name: string; kind: string; dims: DimsDraft; note: Backdrop | null };
const blank = (): Row => ({ key: crypto.randomUUID(), file: null, url: "", name: "", kind: "other", dims: noDims, note: null });
const missing = (r: Row) => {
  const m: string[] = [];
  if (!r.file) m.push("照片");
  if (!r.name.trim()) m.push("名称");
  if (readDims(r.dims) === null || readDims(r.dims) === "incomplete") m.push("尺寸");
  return m;
};

/**
 * Brings in furniture that is not in the room photo: one clean photo and the real size per piece,
 * each modelled by Tripo and then waiting on the shelf.
 */
export default function AddFurnitureDialog({
  open,
  onOpenChange,
  ready,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why generation cannot start (no Tripo key, demo room…), or null. */
  ready: string | null;
  onSubmit: (pieces: NewPiece[], progress: (message: string) => void) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  // Closing clears the form, so the next opening starts fresh.
  function close() {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current.clear();
    setRows([blank()]);
    setAgree(false);
    setError("");
    onOpenChange(false);
  }
  const update = (key: string, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  function attach(files: File[], into?: string | null) {
    const images = files.filter((f) => ["image/png", "image/jpeg", "image/webp"].includes(f.type) && f.size <= 10 * 1024 * 1024);
    if (images.length < files.length) setError("有的文件不是 10 MB 以内的 JPG、PNG 或 WebP，已跳过。");
    else setError("");
    if (!images.length) return;
    const next = [...rows];
    let at = into ? next.findIndex((r) => r.key === into) : next.findIndex((r) => !r.file);
    const placed: [string, File][] = [];
    for (const f of images) {
      if (at < 0) {
        if (next.length >= MAX_BATCH) {
          setError(`一次最多 ${MAX_BATCH} 件，多出的照片没有加入。`);
          break;
        }
        next.push(blank());
        at = next.length - 1;
      }
      const url = URL.createObjectURL(f);
      urls.current.add(url);
      const old = next[at];
      if (old.url) URL.revokeObjectURL(old.url);
      // A name from the file is a better start than nothing: “oak-desk.jpg” → “oak-desk”.
      const name = old.name || f.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").slice(0, 24);
      next[at] = { ...old, file: f, url, name, note: null };
      placed.push([old.key, f]);
      const from = at;
      at = next.findIndex((r, i) => i > from && !r.file);
    }
    setRows(next);
    for (const [key, f] of placed)
      void backdrop(f).then((note) => setRows((cur) => cur.map((r) => (r.key === key && r.file === f ? { ...r, note } : r))));
  }
  function chooseKind(r: Row, kind: string) {
    const t = typicalSizes[kind];
    const wasDefault = !r.name.trim() || Object.values(typicalSizes).some((v) => v.name === r.name);
    update(r.key, { kind, ...(wasDefault ? { name: t.name } : {}) });
  }
  const filled = rows.filter((r) => r.file || r.name.trim() || readDims(r.dims) !== null);
  const blocked = filled.map(missing).find((m) => m.length);
  const count = filled.length;
  async function submit() {
    const pieces = filled.map((r) => ({ file: r.file!, name: r.name.trim(), kind: r.kind, dims: readDims(r.dims) as Dims }));
    setError("");
    setSending("正在准备照片");
    try {
      await onSubmit(pieces, setSending);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending("");
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !sending && (v ? onOpenChange(true) : close())}>
      {/* No auto-focus: the close button would open with a focus ring. */}
      <DialogContent className="add-furniture" showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="add-top">
          <div>
            <span className="eyebrow">家具栏 · 补充家具</span>
            <DialogTitle>添加照片里没有的家具</DialogTitle>
            <DialogDescription>每件家具一张照片、一组尺寸。Tripo 生成 3D 模型后，它会出现在家具栏，按真实大小摆进房间。</DialogDescription>
          </div>
          <button className="icon" aria-label="关闭" disabled={!!sending} onClick={close}>
            <X />
          </button>
        </div>
        <ul className="tip-strip" aria-label="拍摄建议">
          {PHOTO_TIPS.map((t, i) => (
            <li key={t}>
              <b>{i + 1}</b>
              {t}
            </li>
          ))}
        </ul>
        <div
          className={"add-rows" + (over ? " drag-over" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!sending) attach([...e.dataTransfer.files]);
          }}
        >
          {rows.map((r, i) => {
            const gaps = missing(r);
            return (
              <article className="add-row" key={r.key}>
                <button
                  className={"add-photo" + (r.url ? " has-photo" : "")}
                  disabled={!!sending}
                  onClick={() => {
                    target.current = r.key;
                    pick.current?.click();
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(false);
                    if (!sending) attach([...e.dataTransfer.files].slice(0, 1), r.key);
                  }}
                  aria-label={r.url ? `更换第 ${i + 1} 件的照片` : `选择第 ${i + 1} 件的照片`}
                >
                  {r.url ? (
                    <img src={r.url} alt="" />
                  ) : (
                    <>
                      <ImagePlus size={22} />
                      <span>拖入或点选照片</span>
                    </>
                  )}
                </button>
                <div className="add-fields">
                  <div className="add-name">
                    <input
                      value={r.name}
                      maxLength={24}
                      placeholder="名称，例如：胡桃木边柜"
                      aria-label={`第 ${i + 1} 件的名称`}
                      disabled={!!sending}
                      onChange={(e) => update(r.key, { name: e.target.value })}
                    />
                    {rows.length > 1 && (
                      <button
                        className="icon"
                        aria-label={`删去第 ${i + 1} 件`}
                        disabled={!!sending}
                        onClick={() => {
                          if (r.url) URL.revokeObjectURL(r.url);
                          setRows((rs) => rs.filter((x) => x.key !== r.key));
                        }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <div className="kind-chips small-chips" role="radiogroup" aria-label="类别">
                    {Object.entries(typicalSizes).map(([k, t]) => (
                      <button key={k} role="radio" aria-checked={r.kind === k} className={r.kind === k ? "chosen" : ""} disabled={!!sending} onClick={() => chooseKind(r, k)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <div className="add-dims">
                    <DimsFields idPrefix={"add-" + r.key} value={r.dims} onChange={(dims) => update(r.key, { dims })} />
                    {readDims(r.dims) === null && (
                      <button
                        className="text-button"
                        disabled={!!sending}
                        onClick={() => {
                          const t = typicalSizes[r.kind];
                          update(r.key, { dims: { w: String(t.w), d: String(t.d), h: String(t.h) } });
                        }}
                      >
                        先填常见尺寸
                      </button>
                    )}
                  </div>
                  <p className={"row-note" + (r.note === "busy" ? " warn" : r.note ? " good" : "")}>
                    {r.note ? backdropNote[r.note] : gaps.length && (r.file || r.name) ? `还差：${gaps.join("、")}` : " "}
                  </p>
                </div>
              </article>
            );
          })}
          {rows.length < MAX_BATCH && (
            <button className="add-more" disabled={!!sending} onClick={() => setRows((rs) => [...rs, blank()])}>
              <Plus size={15} />
              再加一件
              <span>
                {rows.length}/{MAX_BATCH} · 也可以一次拖入多张照片
              </span>
            </button>
          )}
          {over && <div className="drop-hint">松开，每张照片一件家具</div>}
        </div>
        <input
          ref={pick}
          className="hidden"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            attach([...(e.target.files ?? [])], target.current);
            target.current = null;
            e.target.value = "";
          }}
        />
        <footer className="add-footer">
          {ready ? (
            <p className="notice">{ready}</p>
          ) : (
            <label className="approve">
              <input type="checkbox" checked={agree} disabled={!!sending || !count} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                用 Tripo 生成 <b>{count || 0}</b> 件 3D 模型，预计消耗 <b>{CREDITS} × {count || 0} = {CREDITS * count}</b> 积分。每件约 1–3 分钟，失败的那件可以单独重试。
              </span>
            </label>
          )}
          {error && <p className="add-error" role="alert">{error}</p>}
          <div className="add-actions">
            <button className="text-button" disabled={!!sending} onClick={close}>
              取消
            </button>
            <button className="button primary" disabled={!!sending || !!ready || !count || !!blocked || !agree} onClick={() => void submit()}>
              {sending ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              {sending || (blocked ? `还差${blocked.join("、")}` : `开始生成 ${count || ""} 件`)}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
