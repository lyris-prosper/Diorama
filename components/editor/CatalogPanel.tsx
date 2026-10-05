"use client";
import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, Plus, Search, SendHorizontal, Sparkles, X } from "lucide-react";
import { availabilityLabel, catalog, dimsText, formatPrice, formatUSD, itemName, marketLabel, pricing, type CatalogItem } from "@/lib/catalog";
import { catalogCategories, kindWords } from "@/lib/furniture-kinds";
import { find, hasConditions, noConditions, parse, priceWords, shopWords, tagWords, type Conditions, type Limit } from "@/lib/catalog-search";
import { useLang, type Lang } from "@/lib/i18n";

const WIDTHS = [30, 60, 120];
const PRICES = [20, 50, 100];
const SUGGESTIONS = {
  zh: ["不超过 1 米的书桌", "50 美元以内的小东西", "床头放的小东西", "木质收纳", "挂在墙上的"],
  en: ["A desk under 1 m wide", "Something small under $50", "For the bedside", "Wooden storage", "Things for the wall"],
};
const AXIS = { zh: { w: "宽", d: "深", h: "高", long: "宽" }, en: { w: "W", d: "D", h: "H", long: "W" } } as const;
const limitLabel = (s: Limit, lang: Lang) =>
  `${AXIS[lang][s.axis]} ${s.around ? `≈${Math.round((s.min! + s.max!) / 2)}` : s.min !== undefined && s.max !== undefined ? `${s.min}–${s.max}` : s.max !== undefined ? `≤${s.max}` : `≥${s.min}`} cm`;
/** The long-side maximum set by the width chips: the one size condition the chips own. */
const isWidthChip = (s: Limit) => s.axis === "long" && s.max !== undefined && s.min === undefined && !s.around;

/** What the search understood, beyond what the chips already show; each can be removed on its own. */
function pills(c: Conditions, lang: Lang): { key: string; label: string; drop: (c: Conditions) => Conditions }[] {
  const en = lang === "en";
  const out: { key: string; label: string; drop: (c: Conditions) => Conditions }[] = [];
  for (const k of c.kinds) {
    const w = kindWords.find((x) => x.kind === k);
    out.push({ key: "k" + k, label: (en ? w?.nameEn : w?.name) ?? k, drop: (x) => ({ ...x, kinds: x.kinds.filter((v) => v !== k) }) });
  }
  c.sizes.forEach((s, i) => {
    // A width the chips can show (30/60/120) is shown there; any other limit gets its own pill.
    if (!isWidthChip(s) || !WIDTHS.includes(s.max!))
      out.push({ key: "s" + i, label: limitLabel(s, lang), drop: (x) => ({ ...x, sizes: x.sizes.filter((v) => v !== s) }) });
  });
  if (c.price && (c.price.min !== undefined || !PRICES.includes(c.price.max!)))
    out.push({
      key: "p",
      label: priceWords(c.price, lang),
      drop: (x) => ({ ...x, price: undefined }),
    });
  for (const t of c.tags) {
    const w = tagWords.find((x) => x.tag === t);
    out.push({ key: "t" + t, label: (en ? w?.labelEn : w?.label) ?? t, drop: (x) => ({ ...x, tags: x.tags.filter((v) => v !== t) }) });
  }
  for (const s of c.shops)
    out.push({ key: "b" + s, label: en ? s : shopWords.find((w) => w.shop === s)?.label ?? s, drop: (x) => ({ ...x, shops: x.shops.filter((v) => v !== s) }) });
  for (const w of c.words) out.push({ key: "w" + w, label: `“${w}”`, drop: (x) => ({ ...x, words: x.words.filter((v) => v !== w) }) });
  if (c.small) out.push({ key: "small", label: en ? "small" : "小件", drop: (x) => ({ ...x, small: undefined }) });
  if (c.tabletop) out.push({ key: "table", label: en ? "on a desk" : "放在桌上", drop: (x) => ({ ...x, tabletop: undefined }) });
  if (c.cheap) out.push({ key: "cheap", label: en ? "cheapest first" : "便宜的优先", drop: (x) => ({ ...x, cheap: undefined }) });
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
  const { lang, t } = useLang();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [query, setQuery] = useState<Conditions>(noConditions);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const answer = useMemo(() => find(catalog, query, lang), [query, lang]);
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
  const extra = pills(query, lang);
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
          placeholder={t("帮我找：不超过 1 米的书桌", "Find me… a desk under 1 m wide")}
          aria-label={t("描述你想找的家具", "Describe what you're looking for")}
          maxLength={120}
        />
        <button className="ask-send" type="submit" aria-label={t("搜索", "Search")} disabled={!text.trim()}>
          <SendHorizontal size={15} />
        </button>
      </form>
      {!active && !asked && (
        <div className="suggest" aria-label={t("试试这样问", "Try asking")}>
          {SUGGESTIONS[lang].map((s) => (
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
            <div className="pills" aria-label={t("已理解的条件", "Understood")}>
              {extra.map((p) => (
                <button key={p.key} onClick={() => refine(p.drop(query))} aria-label={t(`去掉条件：${p.label}`, `Remove: ${p.label}`)}>
                  {p.label}
                  <X size={11} />
                </button>
              ))}
            </div>
          )}
          <button className="text-button clear" onClick={() => refine(noConditions())}>
            {t("清除条件", "Clear")}
          </button>
        </div>
      )}
      <div className="filters">
        <div className="chip-row" role="radiogroup" aria-label={t("类别", "Category")}>
          <button role="radio" aria-checked={!query.category && !query.kinds.length} className={!query.category && !query.kinds.length ? "on" : ""} onClick={() => refine({ ...query, category: undefined, kinds: [] })}>
            {t("全部", "All")}
          </button>
          {catalogCategories.map((g) => {
            const on = query.category === g.id && !query.kinds.length;
            return (
              <button key={g.id} role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => refine({ ...query, category: on ? undefined : g.id, kinds: [] })}>
                {lang === "en" ? g.nameEn : g.name}
              </button>
            );
          })}
        </div>
        <div className="seg-row">
          <span>{t("最大宽度", "Max width")}</span>
          <div className="seg" role="radiogroup" aria-label={t("最大宽度", "Max width")}>
            {[undefined, ...WIDTHS].map((w) => (
              <button
                key={w ?? "any"}
                role="radio"
                aria-checked={width === w}
                className={width === w ? "on" : ""}
                onClick={() => refine({ ...query, sizes: [...query.sizes.filter((s) => !isWidthChip(s)), ...(w ? [{ axis: "long" as const, max: w }] : [])] })}
              >
                {w ? `${w}` : t("不限", "Any")}
              </button>
            ))}
          </div>
        </div>
        <div className="seg-row">
          <span>{t("价格", "Price")}</span>
          <div className="seg" role="radiogroup" aria-label={t("价格上限", "Max price")}>
            {[undefined, ...PRICES].map((v) => (
              <button
                key={v ?? "any"}
                role="radio"
                aria-checked={price === v && !(v === undefined && query.price)}
                className={price === v && !(v === undefined && query.price) ? "on" : ""}
                onClick={() => refine({ ...query, price: v ? { max: v } : undefined })}
              >
                {v ? `≤$${v}` : t("不限", "Any")}
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
                {!!inRoom[i.id] && <span className="cat-count">{t(`房间里 ${inRoom[i.id]} 件`, `${inRoom[i.id]} in the room`)}</span>}
                {availabilityLabel(i, lang) && <span className="cat-stock">{availabilityLabel(i, lang)}</span>}
              </div>
              <div className="cat-info">
                <strong title={itemName(i, lang)}>{itemName(i, lang)}</strong>
                <span className="cat-meta">
                  {i.shop} · {dimsText(i, lang)}
                </span>
                <div className="cat-row">
                  <span className="cat-price" title={t(`${marketLabel(i)}标价换算的参考价`, `Converted from the price on the ${marketLabel(i, "en")}`)}>
                    {formatPrice(i)}
                  </span>
                  <a
                    className="cat-buy"
                    href={i.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t(`打开 ${i.shop} ${marketLabel(i)}的商品页（新标签页）`, `Open the product page on the ${i.shop} ${marketLabel(i, "en")} (new tab)`)}
                  >
                    {t("去官网", "Shop")}
                    <ArrowUpRight size={13} />
                  </a>
                </div>
                <button className={"cat-add" + (added === i.id ? " done" : "")} disabled={!!blocked || adding === i.id} onClick={() => void add(i)}>
                  {adding === i.id ? <Loader2 className="spin" size={14} /> : added === i.id ? <Check size={14} /> : <Plus size={14} />}
                  {added === i.id ? t("已放进家具栏", "On the shelf") : inRoom[i.id] ? t("再放一件", "Add another") : t("放进房间", "Put in the room")}
                </button>
              </div>
            </article>
          ))}
        </div>
        <p className="cat-foot">
          {lang === "en" ? (
            <>
              Prices are each brand&apos;s public price on its regional site, checked on{" "}
              {new Date(pricing.verified + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}; other currencies are converted at the ECB rate of{" "}
              {new Date(pricing.fx.rateDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Shipping and duties are not included. All 20 come to about{" "}
              {formatUSD(pricing.total)}. Product photos are from the brands&apos; sites; the 3D models are scaled to the listed sizes. Drag a card straight into the room.
            </>
          ) : (
            <>
              价格是各品牌地区官网的公开标价，{pricing.verified.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, "$1 年 $2 月 $3 日")}核对；非美元标价按欧洲央行 {pricing.fx.rateDate.replace(/^\d+-0?(\d+)-0?(\d+)$/, "$1 月 $2 日")}汇率换算。不含运费和关税，不是中国到手价。20 件参考合计 {formatUSD(pricing.total)}。产品图来自各品牌官网，3D 模型按标称尺寸缩放，卡片可以直接拖进房间。
            </>
          )}
        </p>
      </div>
    </div>
  );
}
