"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, RotateCcw, Download, Lightbulb } from "lucide-react";
import type { Project, Dims } from "@/lib/types";
import { backdrop, backdropNote, PHOTO_TIPS, type Backdrop } from "@/lib/photo";
import DimsFields, { draftOf, readDims, type DimsDraft } from "./DimsFields";
import { useLang } from "@/lib/i18n";
import { pieceName } from "@/lib/furniture-kinds";
import { assetUrl } from "@/lib/asset-url";

const asset = (k: string) => assetUrl(k);
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
  const { lang, t } = useLang();
  const ids = Object.keys(p.cutouts ?? {});
  return (
    <section className="piece-inputs" aria-label={t("用于生成 3D 的家具图片和尺寸", "Photos and sizes for the 3D models")}>
      <div className="piece-tips">
        <Lightbulb size={15} />
        <p>
          {lang === "en" ? (
            <>
              A piece cut out of the room photo is often partly hidden. A product photo on a <b>white or plain backdrop</b> makes a more complete 3D model, and the
              real size places it true to scale.
            </>
          ) : (
            <>
              房间照片里抠出的家具常被挡住一角。换成一张<b>白底或干净背景</b>的产品照，生成的 3D 模型会更完整；填上真实尺寸，模型会按实际大小摆进房间。
            </>
          )}
          <span>{PHOTO_TIPS.map((tip) => tip[lang]).join(" · ")}</span>
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
  const { lang, t } = useLang();
  const name = pieceName(p.candidates.find((c) => c.id === id)?.name ?? "家具", lang);
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
      setError(t("请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。", "Choose a JPG, PNG or WebP image of 10 MB or less."));
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
        <img src={asset(photo ?? p.cutouts![id])} alt={photo ? t(`${name}的产品照片`, `Product photo of ${name}`) : t(`${name}的抠图`, `Cut-out of ${name}`)} />
        <span className="piece-badge">{photo ? t("白底照片", "Product photo") : t("房间抠图", "Cut-out")}</span>
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
            href={asset(p.cutouts![id]) + "&download=" + encodeURIComponent(t(`家具-${id.slice(0, 6)}.png`, `furniture-${id.slice(0, 6)}.png`))}
            download={t(`家具-${id.slice(0, 6)}.png`, `furniture-${id.slice(0, 6)}.png`)}
            title={t("下载房间抠图（透明 PNG）", "Download the cut-out (transparent PNG)")}
          >
            <Download size={13} />
            {t("抠图", "Cut-out")}
          </a>
        </div>
        <div className="piece-actions">
          <button className="chip-button" disabled={disabled || photoState === "saving"} onClick={() => input.current?.click()}>
            <ImagePlus size={14} />
            {photo ? t("换一张", "Replace") : t("换成白底照片", "Use a product photo")}
          </button>
          {photo && (
            <button className="chip-button quiet" disabled={disabled || photoState === "saving"} onClick={() => void clearPhoto()}>
              <RotateCcw size={13} />
              {t("用回抠图", "Back to the cut-out")}
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
        {photo && note && <p className={"backdrop-note " + note}>{backdropNote[note][lang]}</p>}
        <DimsFields idPrefix={"dims-" + id} value={draft} onChange={(d) => { setDraft(d); setDimsState("idle"); }} onCommit={() => void commit()} />
        <p className={"piece-status" + (dimsState === "error" || error ? " error" : "")} aria-live="polite">
          {error ||
            (dimsState === "saving" ? (
              <>
                <Loader2 className="spin" size={12} /> {t("正在保存尺寸", "Saving the size")}
              </>
            ) : dimsState === "saved" || (saved && !incomplete) ? (
              <>
                <Check size={12} /> {t("将按 ", "Placed at ")}
                {saved?.w ?? draft.w} × {saved?.d ?? draft.d} × {saved?.h ?? draft.h} cm{t(" 摆放", "")}
              </>
            ) : incomplete ? (
              t("三项都填好（5–400 厘米）后自动保存", "Saved once all three are filled in (5–400 cm)")
            ) : (
              t("尺寸可不填，不填时按常见尺寸估计", "Size is optional; without it a typical size is assumed")
            ))}
        </p>
      </div>
    </article>
  );
}
