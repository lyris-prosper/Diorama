"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Upload } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { ContinueCard, type SpaceSummary } from "./SpacesDialog";
import { isOnlineDemo } from "@/lib/asset-url";

const Maquette = dynamic(() => import("./Maquette"), { ssr: false, loading: () => <div className="maquette" /> });

// The home page: the promise in a sentence, one button, the diorama to play with. The Chinese page
// says a little more; the English one stays short and lets the model speak.
export default function Landing({
  busy,
  spaces,
  onUpload,
  onDemo,
  onOpenSpace,
  onAllSpaces,
  onDropFile,
}: {
  busy: boolean;
  spaces: SpaceSummary[] | null;
  onUpload: () => void;
  onDemo: () => void;
  onOpenSpace: (id: string) => void;
  onAllSpaces: () => void;
  onDropFile: (file: File) => void;
}) {
  const { lang, t } = useLang();
  const online = isOnlineDemo();
  const [over, setOver] = useState(false);
  const steps =
    lang === "en"
      ? [["Snap a photo"], ["Step into 3D"], ["Move what you own"], ["Try what you don't"]]
      : [
          ["拍一张照片", "一张普通的房间照片就够，不用量尺寸，也不用建模。"],
          ["变成 3D 房间", "照片变成可以转动、走近的 3D 空间，地面和比例自动对齐。"],
          ["挪动原有家具", "点一下照片里的床或书桌，换成能拖动的模型，原处自动擦净。"],
          ["先摆上看看", "从家具库挑真实好物摆进去，看尺寸、看搭配，再决定买不买。"],
        ];
  return (
    <div
      className={"landing" + (over ? " drag-over" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onDropFile(f);
      }}
    >
      <div className="landing-glow" aria-hidden="true" />
      {/* Keyed by language: switching replays the entrance, a soft cross-fade. */}
      <div className={"landing-copy lang-" + lang} key={lang}>
        {lang === "en" ? (
          <>
            <h1 className="hero">
              <span className="line">Rearrange your room</span>
              <span className="line">
                without <em>lifting a finger.</em>
              </span>
            </h1>
            <p className="hero-sub">Try it before you buy it.</p>
          </>
        ) : (
          <>
            <p className="kicker">方寸 · 一张照片里的家</p>
            <h1 className="hero">
              <span className="line">
                不用搬，就能<em>换个摆法</em>；
              </span>
              <span className="line">
                不用买，就能<em>先摆上看看</em>。
              </span>
            </h1>
            <p className="lede">
              拍一张房间照片，方寸把它变成能走进去的 3D 房间。原来的家具可以擦掉、挪动；家具库里的真实好物可以先摆上看看——尺寸、价格、官网链接，一目了然。
            </p>
          </>
        )}
        <div className="landing-actions">
          <button className="button primary large shine" disabled={busy} onClick={onUpload}>
            <Upload size={17} />
            {t("上传房间照片", "Upload a room photo")}
          </button>
          <button className="text-button" disabled={busy} onClick={onDemo}>
            {online ? t("看示例卧室", "See the sample bedroom") : t("先看示例房间", "See a sample room")} <ArrowRight size={15} />
          </button>
        </div>
        <p className="fine-print">
          {online
            ? t("在线演示：用示例卧室体验挪动、换家具和吊灯；用你自己的房间照片生成 3D，需要在本地运行完整版。", "Online demo: the sample bedroom shows it all. A 3D room from your own photo needs the full app running locally.")
            : t("JPG / PNG / WebP，也可以直接把照片拖到页面上。", "Or drop a photo anywhere.")}
        </p>
        {!!spaces?.length && (
          <div className="my-spaces">
            <ContinueCard space={spaces[0]} onOpen={() => onOpenSpace(spaces[0].id)} />
            <button className="text-button" onClick={onAllSpaces}>
              {t(`全部 ${spaces.length} 个空间`, `All spaces (${spaces.length})`)}
            </button>
          </div>
        )}
      </div>
      <div className="landing-model">
        <Maquette />
      </div>
      <ol className={"process lang-" + lang}>
        {steps.map(([title, text], i) => (
          <li key={title} style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
            <b>{String(i + 1).padStart(2, "0")}</b>
            <strong>{title}</strong>
            {text && <span>{text}</span>}
          </li>
        ))}
      </ol>
      {over && <div className="drop-veil">{t("松开，开始这间房", "Drop to begin")}</div>}
    </div>
  );
}
