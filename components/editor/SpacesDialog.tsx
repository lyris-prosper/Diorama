"use client";
import { useState } from "react";
import { ArrowRight, Check, Loader2, PencilLine, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

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
const when = (t: number) =>
  new Date(t).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** Where the space stands, in the words of its next step. */
export function stageLabel(s: Pick<SpaceSummary, "stage" | "room" | "placed">) {
  if (s.stage === "ready") return s.room ? (s.placed ? `已摆放 ${s.placed} 件` : "3D 空间已就绪") : "照片已处理";
  return (
    { upload: "等待上传照片", branch: "正在选家具", detecting: "正在识别家具", confirm: "正在选家具", processing: "正在处理照片", review: "检查处理结果", generating: "正在生成 3D" } as Record<string, string>
  )[s.stage] ?? "进行中";
}

/** The most recent space on the home page: one click back into it. */
export function ContinueCard({ space, onOpen }: { space: SpaceSummary; onOpen: () => void }) {
  return (
    <button className="continue-card" onClick={onOpen}>
      <span className="continue-thumb">{space.original ? <img src={thumb(space.original)} alt="" /> : null}</span>
      <span className="continue-text">
        <span className="eyebrow">继续上次</span>
        <strong>{space.name}</strong>
        <span>
          {when(space.updated)} · {stageLabel(space)}
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
            <span className="eyebrow">我的空间 · {spaces.length} 个</span>
            <DialogTitle>打开一个空间</DialogTitle>
            <DialogDescription>每个空间是一张房间照片和它的 3D 房间、家具与摆法。删除只会去掉这个空间；别的空间还在用的房间文件会保留。</DialogDescription>
          </div>
          <button className="icon" aria-label="关闭" onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        {error && (
          <p className="add-error" role="alert">
            {error}
          </p>
        )}
        <ul className="space-grid">
          {spaces.map((s) => (
            <li key={s.id} className="space-card">
              <button className="space-open" disabled={!!busy} onClick={() => onOpen(s.id)} aria-label={`打开「${s.name}」`}>
                <span className="space-thumb">{s.original ? <img src={thumb(s.original)} alt="" loading="lazy" /> : <span>还没有照片</span>}</span>
              </button>
              <div className="space-info">
                {editing === s.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={40}
                    aria-label="空间名称"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(s.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <strong title={s.name}>{s.name}</strong>
                )}
                <span>
                  {when(s.updated)} · {stageLabel(s)}
                </span>
                <div className="space-actions">
                  <button className="text-button" disabled={!!busy} onClick={() => onOpen(s.id)}>
                    打开
                  </button>
                  <button
                    className="icon"
                    aria-label={`重命名「${s.name}」`}
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
                    aria-label={`删除「${s.name}」`}
                    disabled={!!busy}
                    onClick={() => {
                      if (window.confirm(`删除「${s.name}」（${when(s.updated)}）？\n照片、家具和摆法会一起删除，不能恢复；别的空间还在用的房间文件会保留。`))
                        void act(s.id, () => onDelete(s.id));
                    }}
                  >
                    {busy === s.id ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
