"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, ChevronsRight, Upload } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { usePhone } from "@/lib/use-phone";
import { ContinueCard, type SpaceSummary } from "./SpacesDialog";
import { isOnlineDemo } from "@/lib/asset-url";
import type { PublicSite } from "@/lib/types";

const Maquette = dynamic(() => import("./Maquette"), { ssr: false, loading: () => <div className="maquette" /> });

/**
 * A track with a round knob: drag the knob to the end (or tap the track) to start. Keyboard users
 * press it like any button.
 */
function SlideToStart({ label, onDone, disabled }: { label: string; onDone: () => void; disabled?: boolean }) {
  const track = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const room = () => (track.current ? track.current.clientWidth - 62 : 0);
  const finish = () => {
    setX(room());
    setDone(true);
    setTimeout(onDone, 180);
  };
  return (
    <button
      ref={track}
      className={"slide-start" + (drag.current ? " dragging" : "") + (done ? " done" : "")}
      disabled={disabled}
      aria-label={label}
      onClick={() => {
        // A drag ends with a click too; only a plain tap (or a key press) starts from here.
        if (!drag.current?.moved && !done) finish();
        drag.current = null;
      }}
      onPointerDown={(e) => {
        if (disabled || done) return;
        drag.current = { from: e.clientX - x, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const next = Math.max(0, Math.min(room(), e.clientX - d.from));
        if (Math.abs(next - x) > 3) d.moved = true;
        setX(next);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d?.moved) return;
        if (x > room() * 0.8) finish();
        else setX(0);
      }}
    >
      <span className="slide-knob" style={{ transform: `translateX(${x}px)` }} aria-hidden="true">
        <ArrowRight size={20} />
      </span>
      <span className="slide-label" style={{ opacity: Math.max(0, 1 - x / Math.max(1, room() * 0.6)) }}>
        {label}
      </span>
      <ChevronsRight className="slide-chevrons" size={20} aria-hidden="true" />
    </button>
  );
}

// The home page: the promise in a sentence, one button, the diorama to play with. The Chinese page
// says a little more; the English one stays short and lets the model speak. A phone gets a full-screen
// room with the promise over it and a slider into the sample room instead of the model.
export default function Landing({
  busy,
  spaces,
  onUpload,
  onDemo,
  onOpenSpace,
  onAllSpaces,
  onDropFile,
  site,
}: {
  busy: boolean;
  spaces: SpaceSummary[] | null;
  onUpload: () => void;
  onDemo: () => void;
  onOpenSpace: (id: string) => void;
  onAllSpaces: () => void;
  onDropFile: (file: File) => void;
  /** The public website's free allowance, or null in the Mac version. */
  site: PublicSite | null;
}) {
  const { lang, t } = useLang();
  const phone = usePhone();
  const online = isOnlineDemo();
  const samples = online || !!site;
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
      {phone && (
        <section className={"phone-hero lang-" + lang} key={"hero-" + lang}>
          <img src="/landing/hero.webp" alt="" />
          <div className="phone-hero-copy">
            <p className="phone-kicker">{t("方寸 · 一张照片里的家", "Diorama · a room from one photo")}</p>
            {lang === "en" ? (
              <h1>
                Rearrange your room <em>without lifting a finger.</em>
              </h1>
            ) : (
              <h1>
                方寸之间，
                <br />
                摆出<em>心里的家</em>。
              </h1>
            )}
            <p className="phone-sub">
              {t("一张房间照片，变成能走进去的 3D 房间；家具库里的真实好物，先摆上看看。", "One photo of your room becomes a 3D space to step into. Try real furniture in it before you buy.")}
            </p>
            <SlideToStart
              label={samples ? t("滑动，走进示例卧室", "Slide into the sample bedroom") : t("滑动，看看示例房间", "Slide to see a sample room")}
              onDone={onDemo}
              disabled={busy}
            />
            <button className="phone-upload" disabled={busy} onClick={onUpload}>
              <Upload size={15} />
              {t("或者上传你的房间照片", "Or upload a photo of your room")}
            </button>
          </div>
        </section>
      )}
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
              <span className="line">方寸之间，</span>
              <span className="line">
                摆出<em>心里的家</em>。
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
            {samples ? t("看示例卧室", "See the sample bedroom") : t("先看示例房间", "See a sample room")} <ArrowRight size={15} />
          </button>
        </div>
        <p className="fine-print">
          {online
            ? t("在线演示：用示例卧室体验挪动、换家具和吊灯；用你自己的房间照片生成 3D，需要在本地运行完整版。", "Online demo: the sample bedroom shows it all. A 3D room from your own photo needs the full app running locally.")
            : site
              ? t(
                  `免费试用：每人每天可以把 ${site.daily.world} 张房间照片变成 3D，再生成 ${site.daily.furniture} 件家具。照片会发送给 World Labs 和 Tripo 来生成 3D。`,
                  `Free to try: turn ${site.daily.world} room photo a day into 3D, and make ${site.daily.furniture} pieces. Photos are sent to World Labs and Tripo to make the 3D.`,
                )
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
      {phone !== true && <div className="landing-model">{phone === false && <Maquette />}</div>}
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
