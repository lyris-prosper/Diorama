"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { typicalSizes } from "@/lib/furniture-kinds";
import { backdrop, backdropNote, PHOTO_TIPS, type Backdrop } from "@/lib/photo";
import type { Dims } from "@/lib/types";
import DimsFields, { draftOf, noDims, readDims, type DimsDraft } from "./DimsFields";
import { demoPieceFor } from "@/lib/demo-room";
import { isOnlineDemo, samplePhoto } from "@/lib/asset-url";
import { useLang, type T } from "@/lib/i18n";
import { TRIPO_CREDITS as CREDITS } from "@/lib/credits";

export const MAX_BATCH = 8;
export type NewPiece = { file: File; name: string; kind: string; dims: Dims };
/** `reuse`: the photo of a piece already made in high detail (the demo pendant): its model comes back, free. */
type Row = { key: string; file: File | null; url: string; name: string; kind: string; dims: DimsDraft; note: Backdrop | null; reuse?: boolean };
async function sha256(file: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(d), (n) => n.toString(16).padStart(2, "0")).join("");
}
const blank = (): Row => ({ key: crypto.randomUUID(), file: null, url: "", name: "", kind: "other", dims: noDims, note: null });
const missing = (r: Row, t: T) => {
  const m: string[] = [];
  if (!r.file) m.push(t("照片", "photo"));
  if (!r.name.trim()) m.push(t("名称", "name"));
  if (readDims(r.dims) === null || readDims(r.dims) === "incomplete") m.push(t("尺寸", "size"));
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
  const { lang, t } = useLang();
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
    if (images.length < files.length) setError(t("有的文件不是 10 MB 以内的 JPG、PNG 或 WebP，已跳过。", "Some files weren't JPG, PNG or WebP of 10 MB or less, and were skipped."));
    else setError("");
    if (!images.length) return;
    const next = [...rows];
    let at = into ? next.findIndex((r) => r.key === into) : next.findIndex((r) => !r.file);
    const placed: [string, File][] = [];
    for (const f of images) {
      if (at < 0) {
        if (next.length >= MAX_BATCH) {
          setError(t(`一次最多 ${MAX_BATCH} 件，多出的照片没有加入。`, `Up to ${MAX_BATCH} pieces at a time; the extra photos weren't added.`));
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
      next[at] = { ...old, file: f, url, name, note: null, reuse: false };
      placed.push([old.key, f]);
      const from = at;
      at = next.findIndex((r, i) => i > from && !r.file);
    }
    setRows(next);
    for (const [key, f] of placed) {
      void backdrop(f).then((note) => setRows((cur) => cur.map((r) => (r.key === key && r.file === f ? { ...r, note } : r))));
      // A photo already made into a model (the demo pendant) fills in its name, kind and size.
      const fromFile = f.name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").slice(0, 24);
      void sha256(f).then((sha) => {
        const piece = demoPieceFor(sha);
        if (!piece) return;
        setRows((cur) =>
          cur.map((r) =>
            r.key === key && r.file === f
              ? { ...r, reuse: true, kind: piece.kind, dims: draftOf(piece.dims), name: !r.name.trim() || r.name === fromFile ? piece.name[lang] : r.name }
              : r,
          ),
        );
      });
    }
  }
  function chooseKind(r: Row, kind: string) {
    const typical = typicalSizes[kind];
    const wasDefault = !r.name.trim() || Object.values(typicalSizes).some((v) => v.name === r.name || v.nameEn === r.name);
    update(r.key, { kind, ...(wasDefault ? { name: lang === "en" ? typical.nameEn : typical.name } : {}) });
  }
  const filled = rows.filter((r) => r.file || r.name.trim() || readDims(r.dims) !== null);
  const blocked = filled.map((r) => missing(r, t)).find((m) => m.length);
  const count = filled.length;
  // Only pieces that are actually generated cost credits and need the confirmation.
  const paid = filled.filter((r) => !r.reuse).length;
  async function submit() {
    const pieces = filled.map((r) => ({ file: r.file!, name: r.name.trim(), kind: r.kind, dims: readDims(r.dims) as Dims }));
    setError("");
    setSending(t("正在准备照片", "Preparing the photos"));
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
            <span className="eyebrow">{t("家具栏 · 补充家具", "Shelf · new furniture")}</span>
            <DialogTitle>{t("添加照片里没有的家具", "Add furniture that isn't in the photo")}</DialogTitle>
            <DialogDescription>
              {t(
                "每件家具一张照片、一组尺寸。Tripo 生成 3D 模型后，它会出现在家具栏，按真实大小摆进房间。",
                "One photo and one size per piece. Once Tripo has made the 3D model it waits on the shelf, true to size.",
              )}
            </DialogDescription>
          </div>
          <button className="icon" aria-label={t("关闭", "Close")} disabled={!!sending} onClick={close}>
            <X />
          </button>
        </div>
        <ul className="tip-strip" aria-label={t("拍摄建议", "Photo tips")}>
          {PHOTO_TIPS.map((tip, i) => (
            <li key={tip.zh}>
              <b>{i + 1}</b>
              {tip[lang]}
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
            const gaps = missing(r, t);
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
                  aria-label={r.url ? t(`更换第 ${i + 1} 件的照片`, `Replace photo ${i + 1}`) : t(`选择第 ${i + 1} 件的照片`, `Choose photo ${i + 1}`)}
                >
                  {r.url ? (
                    <img src={r.url} alt="" />
                  ) : (
                    <>
                      <ImagePlus size={22} />
                      <span>{t("拖入或点选照片", "Drop or choose a photo")}</span>
                    </>
                  )}
                </button>
                <div className="add-fields">
                  <div className="add-name">
                    <input
                      value={r.name}
                      maxLength={24}
                      placeholder={t("名称，例如：胡桃木边柜", "Name, e.g. walnut sideboard")}
                      aria-label={t(`第 ${i + 1} 件的名称`, `Name of piece ${i + 1}`)}
                      disabled={!!sending}
                      onChange={(e) => update(r.key, { name: e.target.value })}
                    />
                    {rows.length > 1 && (
                      <button
                        className="icon"
                        aria-label={t(`删去第 ${i + 1} 件`, `Remove piece ${i + 1}`)}
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
                  <div className="kind-chips small-chips" role="radiogroup" aria-label={t("类别", "Kind")}>
                    {Object.entries(typicalSizes).map(([k, typical]) => (
                      <button key={k} role="radio" aria-checked={r.kind === k} className={r.kind === k ? "chosen" : ""} disabled={!!sending} onClick={() => chooseKind(r, k)}>
                        {lang === "en" ? typical.nameEn : typical.name}
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
                          const typical = typicalSizes[r.kind];
                          update(r.key, { dims: { w: String(typical.w), d: String(typical.d), h: String(typical.h) } });
                        }}
                      >
                        {t("先填常见尺寸", "Use a typical size")}
                      </button>
                    )}
                  </div>
                  <p className={"row-note" + (r.reuse ? " good" : r.note === "busy" ? " warn" : r.note ? " good" : "")}>
                    {r.reuse
                      ? t("这张照片已经高精度生成过 3D 模型，直接复用，不消耗积分。", "This photo was already made into a high-detail 3D model. It's reused, no credits.")
                      : r.note
                        ? backdropNote[r.note][lang]
                        : gaps.length && (r.file || r.name)
                          ? t(`还差：${gaps.join("、")}`, `Still needs: ${gaps.join(", ")}`)
                          : " "}
                  </p>
                </div>
              </article>
            );
          })}
          {isOnlineDemo() && !rows.some((r) => r.reuse) && (
            <button className="text-button sample-photo" disabled={!!sending} onClick={() => void samplePhoto("pendant.png").then((f) => attach([f]))}>
              <ImagePlus size={14} />
              {t("用示例吊灯照片（在线演示只认得示例照片）", "Use the sample pendant photo (the online demo knows only the sample photos)")}
            </button>
          )}
          {rows.length < MAX_BATCH && (
            <button className="add-more" disabled={!!sending} onClick={() => setRows((rs) => [...rs, blank()])}>
              <Plus size={15} />
              {t("再加一件", "Add another")}
              <span>
                {rows.length}/{MAX_BATCH} · {t("也可以一次拖入多张照片", "or drop several photos at once")}
              </span>
            </button>
          )}
          {over && <div className="drop-hint">{t("松开，每张照片一件家具", "Drop: one piece per photo")}</div>}
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
          {count > 0 && paid === 0 ? (
            <p className="notice">{t("这些照片都已经生成过 3D 模型，直接放进家具栏，不消耗积分。", "These photos were all made into 3D before: they go straight to the shelf, no credits.")}</p>
          ) : ready ? (
            <p className="notice">{ready}</p>
          ) : (
            <label className="approve">
              <input type="checkbox" checked={agree} disabled={!!sending || !paid} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                {t("用 Tripo 高精度生成 ", "Generate ")}
                <b>{paid || 0}</b>
                {t(" 件 3D 模型（8K 贴图），预计消耗 ", paid === 1 ? " high-detail 3D model (8K textures) with Tripo, about " : " high-detail 3D models (8K textures) with Tripo, about ")}
                <b>
                  {CREDITS} × {paid || 0} = {CREDITS * paid}
                </b>
                {t(
                  " 积分。每件约 2–5 分钟，失败的那件可以单独重试；之前高精度生成过的照片直接复用，不再扣费。",
                  " credits. About 2–5 minutes each; a piece that fails can be retried on its own. Photos already made into 3D in high detail are reused for free.",
                )}
              </span>
            </label>
          )}
          {error && <p className="add-error" role="alert">{error}</p>}
          <div className="add-actions">
            <button className="text-button" disabled={!!sending} onClick={close}>
              {t("取消", "Cancel")}
            </button>
            <button className="button primary" disabled={!!sending || !count || !!blocked || (paid > 0 && (!!ready || !agree))} onClick={() => void submit()}>
              {sending ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              {sending ||
                (blocked
                  ? t(`还差${blocked.join("、")}`, `Still needs ${blocked.join(", ")}`)
                  : paid
                    ? t(`开始生成 ${count || ""} 件`, `Generate ${count || ""}`)
                    : t(`放进家具栏 ${count} 件`, `Add ${count} to the shelf`))}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
