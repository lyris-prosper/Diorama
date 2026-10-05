"use client";
import type { Dims } from "@/lib/types";
import { useLang } from "@/lib/i18n";

/** Width × depth × height as typed, so partial input (“1”, “12”) is never rejected mid-way. */
export type DimsDraft = { w: string; d: string; h: string };
export const noDims: DimsDraft = { w: "", d: "", h: "" };
export const draftOf = (d?: Dims): DimsDraft => (d ? { w: String(d.w), d: String(d.d), h: String(d.h) } : noDims);
const field = (s: string) => {
  const v = Number(s.trim().replace(/[，,]/g, "."));
  return s.trim() && Number.isFinite(v) && v >= 5 && v <= 400 ? Math.round(v * 10) / 10 : null;
};
export const fieldInvalid = (s: string) => !!s.trim() && field(s) === null;
/** All three filled and valid → the size; all empty → null; anything else → "incomplete". */
export function readDims(d: DimsDraft): Dims | null | "incomplete" {
  if (!d.w.trim() && !d.d.trim() && !d.h.trim()) return null;
  const w = field(d.w), dep = field(d.d), h = field(d.h);
  return w !== null && dep !== null && h !== null ? { w, d: dep, h } : "incomplete";
}
const LABEL = { w: ["宽", "W", "width"], d: ["深", "D", "depth"], h: ["高", "H", "height"] } as const;

export default function DimsFields({
  value,
  onChange,
  onCommit,
  idPrefix,
}: {
  value: DimsDraft;
  onChange: (next: DimsDraft) => void;
  /** Called when focus leaves the group, for saving. */
  onCommit?: () => void;
  idPrefix: string;
}) {
  const { lang, t } = useLang();
  return (
    <div
      className="dims"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onCommit?.();
      }}
    >
      {(["w", "d", "h"] as const).map((k) => (
        <label key={k} className={fieldInvalid(value[k]) ? "invalid" : ""}>
          <span>{lang === "en" ? LABEL[k][1] : LABEL[k][0]}</span>
          <input
            id={`${idPrefix}-${k}`}
            inputMode="decimal"
            placeholder="—"
            aria-label={t(`${LABEL[k][0]}（厘米）`, `${LABEL[k][2]} (cm)`)}
            aria-invalid={fieldInvalid(value[k])}
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <em>cm</em>
        </label>
      ))}
    </div>
  );
}
