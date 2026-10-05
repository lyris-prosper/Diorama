"use client";
import { useState } from "react";
import { ArrowRight, Check, Loader2, PencilLine, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLang, type Lang, type T } from "@/lib/i18n";
import { spaceName } from "@/lib/demo-room";

/** One of the person's spaces as the home page lists it (GET /api/workbench?list=1). */
export type SpaceSummary = {
  id: string;
  name: string;
  stage: string;
  updated: number;
  original: string | null;
  room: boolean;
  pieces: number;
  placed: number;
};

const thumb = (key: string) => "/api/assets?key=" + encodeURIComponent(key);
const when = (time: number, lang: Lang) =>
  new Date(time).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { month: lang === "en" ? "short" : "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** Where the space stands, in the words of its next step. */
export function stageLabel(s: Pick<SpaceSummary, "stage" | "room" | "placed">, t: T) {
  if (s.stage === "ready")
    return s.room ? (s.placed ? t(`已摆放 ${s.placed} 件`, `${s.placed} ${s.placed === 1 ? "piece" : "pieces"} placed`) : t("3D 空间已就绪", "3D room ready")) : t("照片已处理", "Photo processed");
  const steps: Record<string, [string, string]> = {
    upload: ["等待上传照片", "Waiting for a photo"],
    branch: ["正在选家具", "Choosing furniture"],
    detecting: ["正在识别家具", "Recognising furniture"],
    confirm: ["正在选家具", "Choosing furniture"],
    processing: ["正在处理照片", "Processing the photo"],
    review: ["检查处理结果", "Checking the result"],
    generating: ["正在生成 3D", "Generating 3D"],
  };
  const step = steps[s.stage];
  return step ? t(step[0], step[1]) : t("进行中", "In progress");
}

/** The most recent space on the home page: one click back into it. */
export function ContinueCard({ space, onOpen }: { space: SpaceSummary; onOpen: () => void }) {
  const { lang, t } = useLang();
  return (
    <button className="continue-card" onClick={onOpen}>
      <span className="continue-thumb">{space.original ? <img src={thumb(space.original)} alt="" /> : null}</span>
      <span className="continue-text">
        <span className="eyebrow">{t("继续上次", "Pick up where you left off")}</span>
        <strong>{spaceName(space.name, lang)}</strong>
        <span>
          {when(space.updated, lang)} · {stageLabel(space, t)}
        </span>
      </span>
      <ArrowRight size={16} />
    </button>
  );
}

/** All of the person's spaces: open, rename or delete one. */
export default function SpacesDialog({
  open,
  onOpenChange,
  spaces,
  onOpen,
  onRename,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: SpaceSummary[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { lang, t } = useLang();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const commit = (id: string) => {
    const name = draft.trim();
    setEditing(null);
    if (name && name !== spaces.find((s) => s.id === id)?.name) void act(id, () => onRename(id, name));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="spaces" showCloseButton={false}>
        <div className="add-top">
          <div>
            <span className="eyebrow">{t(`我的空间 · ${spaces.length} 个`, `My spaces · ${spaces.length}`)}</span>
            <DialogTitle>{t("打开一个空间", "Open a space")}</DialogTitle>
            <DialogDescription>
              {t(
                "每个空间是一张房间照片和它的 3D 房间、家具与摆法。删除只会去掉这个空间；别的空间还在用的房间文件会保留。",
                "Each space is one room photo with its 3D room, furniture and layout. Deleting removes only that space; room files another space uses are kept.",
              )}
            </DialogDescription>
          </div>
          <button className="icon" aria-label={t("关闭", "Close")} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        {error && (
          <p className="add-error" role="alert">
            {error}
          </p>
        )}
        <ul className="space-grid">
          {spaces.map((s) => {
            const name = spaceName(s.name, lang);
            return (
            <li key={s.id} className="space-card">
              <button className="space-open" disabled={!!busy} onClick={() => onOpen(s.id)} aria-label={t(`打开「${name}」`, `Open “${name}”`)}>
                <span className="space-thumb">{s.original ? <img src={thumb(s.original)} alt="" loading="lazy" /> : <span>{t("还没有照片", "No photo yet")}</span>}</span>
              </button>
              <div className="space-info">
                {editing === s.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={40}
                    aria-label={t("空间名称", "Space name")}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(s.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <strong title={name}>{name}</strong>
                )}
                <span>
                  {when(s.updated, lang)} · {stageLabel(s, t)}
                </span>
                <div className="space-actions">
                  <button className="text-button" disabled={!!busy} onClick={() => onOpen(s.id)}>
                    {t("打开", "Open")}
                  </button>
                  <button
                    className="icon"
                    aria-label={t(`重命名「${name}」`, `Rename “${name}”`)}
                    disabled={!!busy}
                    onClick={() => {
                      setDraft(s.name);
                      setEditing(s.id);
                    }}
                  >
                    {editing === s.id ? <Check size={15} /> : <PencilLine size={15} />}
                  </button>
                  <button
                    className="icon danger"
                    aria-label={t(`删除「${name}」`, `Delete “${name}”`)}
                    disabled={!!busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            `删除「${name}」（${when(s.updated, lang)}）？\n照片、家具和摆法会一起删除，不能恢复；别的空间还在用的房间文件会保留。`,
                            `Delete “${name}” (${when(s.updated, lang)})?\nIts photo, furniture and layout go with it and can't be restored; room files another space uses are kept.`,
                          ),
                        )
                      )
                        void act(s.id, () => onDelete(s.id));
                    }}
                  >
                    {busy === s.id ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
