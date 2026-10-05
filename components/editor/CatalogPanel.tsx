"use client";
import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, Plus, Search, SendHorizontal, Sparkles, X } from "lucide-react";
import { catalog, formatPrice, type CatalogItem } from "@/lib/catalog";
import { catalogCategories, kindWords } from "@/lib/furniture-kinds";
import { find, hasConditions, noConditions, parse, shopWords, tagWords, type Conditions, type Limit } from "@/lib/catalog-search";

const WIDTHS = [30, 60, 120];
const PRICES = [200, 500, 1000];
const SUGGESTIONS = ["不超过 1 米的书桌", "500 元以内的灯", "床头放的小东西", "木质收纳", "挂在墙上的"];
const AXIS = { w: "宽", d: "深", h: "高", long: "宽" } as const;
const limitLabel = (s: Limit) =>
  `${AXIS[s.axis]} ${s.around ? `≈${Math.round((s.min! + s.max!) / 2)}` : s.min !== undefined && s.max !== undefined ? `${s.min}–${s.max}` : s.max !== undefined ? `≤${s.max}` : `≥${s.min}`} cm`;
/** The long-side maximum set by the width chips: the one size condition the chips own. */
const isWidthChip = (s: Limit) => s.axis === "long" && s.max !== undefined && s.min === undefined && !s.around;

/** What the search understood, beyond what the chips already show; each can be removed on its own. */
function pills(c: Conditions): { key: string; label: string; drop: (c: Conditions) => Conditions }[] {
  const out: { key: string; label: string; drop: (c: Conditions) => Conditions }[] = [];
  for (const k of c.kinds)
    out.push({ key: "k" + k, label: kindWords.find((w) => w.kind === k)?.name ?? k, drop: (x) => ({ ...x, kinds: x.kinds.filter((v) => v !== k) }) });
  c.sizes.forEach((s, i) => {
    // A width the chips can show (30/60/120) is shown there; any other limit gets its own pill.
    if (!isWidthChip(s) || !WIDTHS.includes(s.max!))
      out.push({ key: "s" + i, label: limitLabel(s), drop: (x) => ({ ...x, sizes: x.sizes.filter((v) => v !== s) }) });
  });
  if (c.price && (c.price.min !== undefined || !PRICES.includes(c.price.max!)))
    out.push({
      key: "p",
      label: c.price.min !== undefined && c.price.max !== undefined ? `¥${c.price.min}–${c.price.max}` : c.price.max !== undefined ? `≤ ¥${c.price.max}` : `≥ ¥${c.price.min}`,
      drop: (x) => ({ ...x, price: undefined }),
    });
  for (const t of c.tags)
    out.push({ key: "t" + t, label: tagWords.find((w) => w.tag === t)?.label ?? t, drop: (x) => ({ ...x, tags: x.tags.filter((v) => v !== t) }) });
  for (const s of c.shops)
    out.push({ key: "b" + s, label: shopWords.find((w) => w.shop === s)?.label ?? s, drop: (x) => ({ ...x, shops: x.shops.filter((v) => v !== s) }) });
  for (const w of c.words) out.push({ key: "w" + w, label: `“${w}”`, drop: (x) => ({ ...x, words: x.words.filter((v) => v !== w) }) });
  if (c.small) out.push({ key: "small", label: "小件", drop: (x) => ({ ...x, small: undefined }) });
  if (c.tabletop) out.push({ key: "table", label: "放在桌上", drop: (x) => ({ ...x, tabletop: undefined }) });
  if (c.cheap) out.push({ key: "cheap", label: "便宜的优先", drop: (x) => ({ ...x, cheap: undefined }) });
  return out;
}

/**
 * The furniture library: real products with prepared models, price and a shop link. A sentence in
 * the search box (“不超过 1 米的书桌”) becomes filters, shown as chips the user can adjust.
 */
export default function CatalogPanel({
  inRoom,
  blocked,
  onAdd,
}: {
  /** Library id → how many of it are already in this space. */
  inRoom: Record<string, number>;
  /** Why pieces cannot be added right now, or null. */
  blocked: string | null;
  onAdd: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [query, setQuery] = useState<Conditions>(noConditions);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const answer = useMemo(() => find(catalog, query), [query]);
  const active = hasConditions(query);
  function ask(sentence: string) {
    const s = sentence.trim();
    if (!s) return;
    setAsked(s);
    setQuery(parse(s));
    setText("");
    list.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  // Chips refine the current conditions; the question they started from no longer describes them.
  function refine(next: Conditions) {
    setAsked(null);
    setQuery(next);
  }
  const width = query.sizes.find(isWidthChip)?.max;
  const price = query.price?.min === undefined ? query.price?.max : undefined;
  async function add(item: CatalogItem) {
    setAdding(item.id);
    try {
      await onAdd(item.id);
      setAdded(item.id);
      setTimeout(() => setAdded((v) => (v === item.id ? null : v)), 1800);
    } catch {
      // The page shows the error banner.
    } finally {
      setAdding(null);
    }
  }
  const extra = pills(query);
  return (
    <div className="catalog">
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <Search size={16} aria-hidden="true" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setText(""), refine(noConditions()))}
          placeholder="帮我找：不超过 1 米的书桌"
          aria-label="描述你想找的家具"
          maxLength={120}
        />
        <button className="ask-send" type="submit" aria-label="搜索" disabled={!text.trim()}>
          <SendHorizontal size={15} />
        </button>
      </form>
      {!active && !asked && (
        <div className="suggest" aria-label="试试这样问">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {(asked || active) && (
        <div className="dialogue" aria-live="polite">
          {asked && <p className="said">{asked}</p>}
          <p className="reply">
            <Sparkles size={13} aria-hidden="true" />
            <span>{answer.reply}</span>
          </p>
          {extra.length > 0 && (
            <div className="pills" aria-label="已理解的条件">
              {extra.map((p) => (
                <button key={p.key} onClick={() => refine(p.drop(query))} aria-label={`去掉条件：${p.label}`}>
                  {p.label}
                  <X size={11} />
                </button>
              ))}
            </div>
          )}
          <button className="text-button clear" onClick={() => refine(noConditions())}>
            清除条件
          </button>
        </div>
      )}
      <div className="filters">
        <div className="chip-row" role="radiogroup" aria-label="类别">
          <button role="radio" aria-checked={!query.category && !query.kinds.length} className={!query.category && !query.kinds.length ? "on" : ""} onClick={() => refine({ ...query, category: undefined, kinds: [] })}>
            全部
          </button>
          {catalogCategories.map((g) => {
            const on = query.category === g.id && !query.kinds.length;
            return (
              <button key={g.id} role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => refine({ ...query, category: on ? undefined : g.id, kinds: [] })}>
                {g.name}
              </button>
            );
          })}
        </div>
        <div className="seg-row">
          <span>最大宽度</span>
          <div className="seg" role="radiogroup" aria-label="最大宽度">
            {[undefined, ...WIDTHS].map((w) => (
              <button
                key={w ?? "any"}
                role="radio"
                aria-checked={width === w}
                className={width === w ? "on" : ""}
                onClick={() => refine({ ...query, sizes: [...query.sizes.filter((s) => !isWidthChip(s)), ...(w ? [{ axis: "long" as const, max: w }] : [])] })}
              >
                {w ? `${w}` : "不限"}
              </button>
            ))}
          </div>
        </div>
        <div className="seg-row">
          <span>价格</span>
          <div className="seg" role="radiogroup" aria-label="价格上限">
            {[undefined, ...PRICES].map((v) => (
              <button
                key={v ?? "any"}
                role="radio"
                aria-checked={price === v && !(v === undefined && query.price)}
                className={price === v && !(v === undefined && query.price) ? "on" : ""}
                onClick={() => refine({ ...query, price: v ? { max: v } : undefined })}
              >
                {v ? `≤${v}` : "不限"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="catalog-list" ref={list}>
        {blocked && <p className="notice">{blocked}</p>}
        <div className="cat-grid">
          {answer.items.map((i) => (
            <article
              key={i.id}
              className="cat-card"
              draggable={!blocked}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", "catalog:" + i.id);
                e.dataTransfer.effectAllowed = "copy";
                const img = e.currentTarget.querySelector("img");
                if (img) e.dataTransfer.setDragImage(img, 40, 40);
              }}
            >
              <div className="cat-img">
                <img src={i.image} alt="" loading="lazy" draggable={false} />
                {!!inRoom[i.id] && <span className="cat-count">房间里 {inRoom[i.id]} 件</span>}
              </div>
              <div className="cat-info">
                <strong title={i.name}>{i.name}</strong>
                <span className="cat-meta">
                  {i.shop} · {i.dimsLabel}
                </span>
                <div className="cat-row">
                  <span className={"cat-price" + (i.priceVerified ? "" : " approx")} title={i.priceVerified ? "官网价" : "参考价，以购买页为准"}>
                    {formatPrice(i)}
                  </span>
                  <a
                    className="cat-buy"
                    href={i.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={i.linkKind === "search" ? `在 ${i.shop} 官方店搜索（新标签页）` : `打开 ${i.shop} 商品页（新标签页）`}
                  >
                    {i.linkKind === "search" ? "去搜索" : "去购买"}
                    <ArrowUpRight size={13} />
                  </a>
                </div>
                <button className={"cat-add" + (added === i.id ? " done" : "")} disabled={!!blocked || adding === i.id} onClick={() => void add(i)}>
                  {adding === i.id ? <Loader2 className="spin" size={14} /> : added === i.id ? <Check size={14} /> : <Plus size={14} />}
                  {added === i.id ? "已放进家具栏" : inRoom[i.id] ? "再放一件" : "放进房间"}
                </button>
              </div>
            </article>
          ))}
        </div>
        <p className="cat-foot">
          价格与链接查询于 2026 年 10 月；带“约”的是参考价，以购买页为准。产品图来自各品牌官网，3D 模型按标称尺寸缩放。可以把卡片直接拖进房间。
        </p>
      </div>
    </div>
  );
}
