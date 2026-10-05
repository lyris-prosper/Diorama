"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, RotateCcw, Download, Lightbulb } from "lucide-react";
import type { Project, Dims } from "@/lib/types";
import { backdrop, backdropNote, PHOTO_TIPS, type Backdrop } from "@/lib/photo";
import DimsFields, { draftOf, readDims, type DimsDraft } from "./DimsFields";

const asset = (k: string) => "/api/assets?key=" + encodeURIComponent(k);
type Saving = "idle" | "saving" | "saved" | "error";

/**
 * Review step, one card per piece that will be modelled: the cut-out from the room photo can be
 * swapped for a clean product photo, and the real size given so the model is placed true to scale.
 */
export default function FurnitureInputs({
  project: p,
  disabled,
  onPhoto,
  onClearPhoto,
  onDims,
}: {
  project: Project;
  disabled: boolean;
  onPhoto: (candidate: string, file: File) => Promise<void>;
  onClearPhoto: (candidate: string) => Promise<void>;
  onDims: (candidate: string, dims: Dims | null) => Promise<void>;
}) {
  const ids = Object.keys(p.cutouts ?? {});
  return (
    <section className="piece-inputs" aria-label="用于生成 3D 的家具图片和尺寸">
      <div className="piece-tips">
        <Lightbulb size={15} />
        <p>
          房间照片里抠出的家具常被挡住一角。换成一张<b>白底或干净背景</b>的产品照，生成的 3D 模型会更完整；填上真实尺寸，模型会按实际大小摆进房间。
          <span>{PHOTO_TIPS.join(" · ")}</span>
        </p>
      </div>
      {ids.map((id) => (
        <PieceCard
          key={id}
          id={id}
          project={p}
          disabled={disabled}
          onPhoto={onPhoto}
          onClearPhoto={onClearPhoto}
          onDims={onDims}
        />
      ))}
    </section>
  );
}

function PieceCard({
  id,
  project: p,
  disabled,
  onPhoto,
  onClearPhoto,
  onDims,
}: {
  id: string;
  project: Project;
  disabled: boolean;
  onPhoto: (candidate: string, file: File) => Promise<void>;
  onClearPhoto: (candidate: string) => Promise<void>;
  onDims: (candidate: string, dims: Dims | null) => Promise<void>;
}) {
  const name = p.candidates.find((c) => c.id === id)?.name ?? "家具";
  const photo = p.productPhotos?.[id];
  const saved = p.furnitureDims?.[id];
  const [draft, setDraft] = useState<DimsDraft>(() => draftOf(saved));
  const [photoState, setPhotoState] = useState<Saving>("idle");
  const [dimsState, setDimsState] = useState<Saving>("idle");
  const [error, setError] = useState("");
  // The backdrop check belongs to one photo; a check for an earlier photo is not shown.
  const [checked, setChecked] = useState<{ photo: string; note: Backdrop } | null>(null);
  const note = photo && checked?.photo === photo ? checked.note : null;
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!photo) return;
    let live = true;
    fetch(asset(photo))
      .then((r) => r.blob())
      .then(backdrop)
      .then((b) => live && setChecked({ photo, note: b }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [photo]);
  async function choose(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。");
      return;
    }
    setError("");
    setPhotoState("saving");
    try {
      await onPhoto(id, file);
      setPhotoState("saved");
    } catch (e) {
      setPhotoState("error");
      setError((e as Error).message);
    }
  }
  async function clearPhoto() {
    setPhotoState("saving");
    try {
      await onClearPhoto(id);
      setPhotoState("idle");
    } catch (e) {
      setPhotoState("error");
      setError((e as Error).message);
    }
  }
  async function commit() {
    const dims = readDims(draft);
    if (dims === "incomplete") {
      setDimsState("idle");
      return;
    }
    if (JSON.stringify(dims ?? null) === JSON.stringify(saved ?? null)) return;
    setDimsState("saving");
    try {
      await onDims(id, dims);
      setDimsState("saved");
      setError("");
    } catch (e) {
      setDimsState("error");
      setError((e as Error).message);
    }
  }
  const incomplete = readDims(draft) === "incomplete";
  return (
    <article className={"piece" + (photo ? " has-product" : "")}>
      <div
        className={"piece-photo" + (over ? " drag-over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) void choose(e.dataTransfer.files[0]);
        }}
      >
        <img src={asset(photo ?? p.cutouts![id])} alt={photo ? `${name}的产品照片` : `${name}的抠图`} />
        <span className="piece-badge">{photo ? "白底照片" : "房间抠图"}</span>
        {photoState === "saving" && (
          <span className="piece-busy">
            <Loader2 className="spin" size={18} />
          </span>
        )}
      </div>
      <div className="piece-body">
        <div className="piece-head">
          <strong>{name}</strong>
          <a
            className="text-button"
            href={asset(p.cutouts![id]) + "&download=" + encodeURIComponent(`家具-${id.slice(0, 6)}.png`)}
            download={`家具-${id.slice(0, 6)}.png`}
            title="下载房间抠图（透明 PNG）"
          >
            <Download size={13} />
            抠图
          </a>
        </div>
        <div className="piece-actions">
          <button className="chip-button" disabled={disabled || photoState === "saving"} onClick={() => input.current?.click()}>
            <ImagePlus size={14} />
            {photo ? "换一张" : "换成白底照片"}
          </button>
          {photo && (
            <button className="chip-button quiet" disabled={disabled || photoState === "saving"} onClick={() => void clearPhoto()}>
              <RotateCcw size={13} />
              用回抠图
            </button>
          )}
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {photo && note && <p className={"backdrop-note " + note}>{backdropNote[note]}</p>}
        <DimsFields idPrefix={"dims-" + id} value={draft} onChange={(d) => { setDraft(d); setDimsState("idle"); }} onCommit={() => void commit()} />
        <p className={"piece-status" + (dimsState === "error" || error ? " error" : "")} aria-live="polite">
          {error ||
            (dimsState === "saving" ? (
              <>
                <Loader2 className="spin" size={12} /> 正在保存尺寸
              </>
            ) : dimsState === "saved" || (saved && !incomplete) ? (
              <>
                <Check size={12} /> 将按 {saved?.w ?? draft.w} × {saved?.d ?? draft.d} × {saved?.h ?? draft.h} cm 摆放
              </>
            ) : incomplete ? (
              "三项都填好（5–400 厘米）后自动保存"
            ) : (
              "尺寸可不填，不填时按常见尺寸估计"
            ))}
        </p>
      </div>
    </article>
  );
}
