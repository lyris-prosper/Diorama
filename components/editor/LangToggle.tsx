"use client";
import { useRef, useState } from "react";
import { useLang } from "@/lib/i18n";

// 中 | EN as a sliding switch: click it, drag the knob sideways, or use the arrow keys.
const TRAVEL = 34;

export default function LangToggle() {
  const { lang, setLang } = useLang();
  const en = lang === "en";
  const press = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={en}
      aria-label={en ? "Language: English. Switch to Chinese" : "语言：中文。切换为英文"}
      title={en ? "切换为中文" : "Switch to English"}
      className={"lang-toggle" + (en ? " en" : "") + (offset !== null ? " dragging" : "")}
      onPointerDown={(e) => {
        press.current = { x: e.clientX, from: en ? TRAVEL : 0, moved: false };
        dragged.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p) return;
        const dx = e.clientX - p.x;
        if (!p.moved && Math.abs(dx) < 3) return;
        p.moved = true;
        setOffset(Math.max(0, Math.min(TRAVEL, p.from + dx)));
      }}
      onPointerUp={() => {
        const p = press.current;
        press.current = null;
        if (p?.moved && offset !== null) {
          dragged.current = true;
          setLang(offset > TRAVEL / 2 ? "en" : "zh");
        }
        setOffset(null);
      }}
      onPointerCancel={() => {
        press.current = null;
        setOffset(null);
      }}
      onClick={() => {
        // A drag already chose; a plain click flips.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        setLang(en ? "zh" : "en");
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setLang("en");
        else if (e.key === "ArrowLeft") setLang("zh");
        else return;
        e.preventDefault();
      }}
    >
      <span className="lang-thumb" aria-hidden="true" style={offset !== null ? { transform: `translateX(${offset}px)` } : undefined} />
      <span className={"lang-option" + (!en ? " on" : "")} aria-hidden="true">
        中
      </span>
      <span className={"lang-option" + (en ? " on" : "")} aria-hidden="true">
        EN
      </span>
    </button>
  );
}
