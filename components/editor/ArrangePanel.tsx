"use client";
import { useState } from "react";
import { Loader2, SendHorizontal, Sparkles, Undo2, X } from "lucide-react";
import { catalogItem, formatUSD, itemName } from "@/lib/catalog";
import type { Plan } from "@/lib/arrange";
import { useLang } from "@/lib/i18n";

const SUGGESTIONS = {
  zh: ["温馨一点的卧室，预算 600 美元", "窗边来个阅读角", "给书桌布置一个学习角", "日式简约，多一点绿植"],
  en: ["A cozy bedroom under $600", "A reading corner by the window", "Set up the desk for studying", "Japanese and simple, more plants"],
};

/**
 * “帮我布置”: a sentence in, a few library pieces into the room. Shows what was asked, why these
 * pieces (DeepSeek's words, or the rules'), what they cost, and a way to take them all out again.
 */
export default function ArrangePanel({
  busy,
  result,
  before,
  onBefore,
  onAsk,
  onUndo,
  onAgain,
  onClose,
}: {
  busy: boolean;
  result: { plan: Plan; ids: string[]; asked: string } | null;
  /** Showing the room as it was, without these pieces. */
  before: boolean;
  onBefore: (before: boolean) => void;
  onAsk: (sentence: string) => void;
  onUndo: () => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const { lang, t } = useLang();
  const [text, setText] = useState("");
  const ask = (s: string) => {
    if (!s.trim() || busy) return;
    onAsk(s.trim());
  };
  return (
    <div className="arrange" role="dialog" aria-label={t("一句话帮我布置", "Arrange it for me")}>
      <div className="arrange-head">
        <span className="arrange-mark" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <strong>{t("一句话帮我布置", "Arrange it for me")}</strong>
        <button className="icon" aria-label={t("关闭", "Close")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {result ? (
        <>
          <div className="before-after" role="radiogroup" aria-label={t("布置前后", "Before and after")}>
            <button role="radio" aria-checked={before} className={before ? "on" : ""} onClick={() => onBefore(true)}>
              {t("之前", "Before")}
            </button>
            <button role="radio" aria-checked={!before} className={!before ? "on" : ""} onClick={() => onBefore(false)}>
              {t("之后", "After")}
            </button>
          </div>
          <p className="arrange-said">“{result.asked}”</p>
          <p className="arrange-reason">{result.plan.reason}</p>
          <ul className="arrange-items">
            {result.plan.items.map((it, k) => {
              const c = catalogItem(it.catalogId);
              return (
                c && (
                  <li key={it.catalogId + k} style={{ animationDelay: `${0.25 + k * 0.42}s` }} title={`${itemName(c, lang)} · ${formatUSD(c.price)}`}>
                    <img src={c.image} alt={itemName(c, lang)} />
                  </li>
                )
              );
            })}
          </ul>
          <div className="arrange-total">
            <span>
              {t(`共 ${result.plan.items.length} 件 · 参考合计`, `${result.plan.items.length} ${result.plan.items.length === 1 ? "piece" : "pieces"} · about`)} <b>{formatUSD(result.plan.total)}</b>
            </span>
            <em>{result.plan.source === "ai" ? t("DeepSeek 挑选", "Picked by DeepSeek") : t("按规则挑选", "Picked by rules")}</em>
          </div>
          <div className="arrange-actions">
            <button className="button" onClick={onUndo}>
              <Undo2 size={15} />
              {t("撤销这次布置", "Take them out")}
            </button>
            <button className="button primary" onClick={onAgain}>
              <Sparkles size={15} />
              {t("换个说法", "Try another")}
            </button>
          </div>
        </>
      ) : (
        <>
          <form
            className="ask"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("想要什么样的房间？", "What should the room feel like?")}
              aria-label={t("想要什么样的房间", "What the room should feel like")}
              maxLength={200}
              disabled={busy}
              autoFocus
            />
            <button className="ask-send" type="submit" aria-label={t("布置", "Arrange")} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="spin" size={15} /> : <SendHorizontal size={15} />}
            </button>
          </form>
          {busy ? (
            <p className="arrange-wait">
              <Loader2 className="spin" size={15} />
              {t("正在挑选家具、找位置…", "Choosing pieces and finding them a place…")}
            </p>
          ) : (
            <div className="suggest" aria-label={t("试试这样说", "Try saying")}>
              {SUGGESTIONS[lang].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setText(s);
                    ask(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
