// “帮我找”: reads a sentence such as “我想要一张不超过 1 米的书桌” into filter conditions, ranks the
// library against them and answers in one sentence. Runs in the browser, offline, without a model.
import { catalogCategories, kindWords } from "./furniture-kinds";
import { formatBudget, toUSD, type CatalogItem } from "./catalog";

/** long: the longer side of the footprint, what people usually mean by “多大”. */
export type Axis = "w" | "d" | "h" | "long";
export type Limit = { axis: Axis; min?: number; max?: number; around?: boolean };
export type Conditions = {
  kinds: string[];
  category?: string;
  /** Centimetres. */
  sizes: Limit[];
  /** US dollars, like the library. A budget given in yuan is converted and kept in `asked` for the reply. */
  price?: { min?: number; max?: number; asked?: { currency: "CNY"; min?: number; max?: number } };
  tags: string[];
  shops: string[];
  /** Words that name a piece directly (“LISABO”, “Emberton”). */
  words: string[];
  cheap?: boolean;
  small?: boolean;
  /** “放在桌上的…”: small enough to stand on a desk or bedside table. */
  tabletop?: boolean;
};
export const noConditions = (): Conditions => ({ kinds: [], sizes: [], tags: [], shops: [], words: [] });
export const hasConditions = (c: Conditions) =>
  !!(c.kinds.length || c.category || c.sizes.length || c.price || c.tags.length || c.shops.length || c.words.length || c.cheap || c.small || c.tabletop);

export const tagWords: { tag: string; label: string; pattern: RegExp }[] = [
  { tag: "ash", label: "白蜡木", pattern: /白蜡木|梣木/g },
  { tag: "oak", label: "橡木", pattern: /橡木/g },
  { tag: "maple", label: "枫木", pattern: /枫木/g },
  { tag: "bamboo", label: "竹制", pattern: /竹/g },
  { tag: "rattan", label: "藤编", pattern: /藤|编织|草编/g },
  { tag: "wood", label: "原木", pattern: /原木|实木|木质|木制|木头|木/g },
  { tag: "glass", label: "玻璃", pattern: /玻璃/g },
  { tag: "linen", label: "亚麻", pattern: /亚麻|棉麻/g },
  { tag: "cotton", label: "棉质", pattern: /纯棉|棉/g },
  { tag: "steel", label: "金属", pattern: /金属|钢|铁/g },
  { tag: "red", label: "红色", pattern: /红/g },
  { tag: "green", label: "绿色", pattern: /绿/g },
  { tag: "amber", label: "琥珀色", pattern: /琥珀|橙|橘/g },
  { tag: "black", label: "黑色", pattern: /黑/g },
  { tag: "white", label: "白色", pattern: /白(?!蜡)/g },
  { tag: "cream", label: "奶油色", pattern: /奶油|米白|米色|原色/g },
  { tag: "brown", label: "棕色", pattern: /棕|咖啡色|褐/g },
  { tag: "nordic", label: "北欧风", pattern: /北欧/g },
  { tag: "japanese", label: "日式", pattern: /日式|日系|无印风|侘寂/g },
  { tag: "retro", label: "复古", pattern: /复古|中古|vintage/gi },
  { tag: "minimal", label: "简约", pattern: /极简|简约|简洁|素净/g },
  { tag: "warm", label: "温暖", pattern: /温暖|暖色|暖调|温馨|暖/g },
  { tag: "industrial", label: "工业风", pattern: /工业风/g },
  { tag: "accent", label: "点缀色", pattern: /点缀|亮色|跳色|个性|撞色|彩色/g },
  { tag: "bedroom", label: "卧室", pattern: /卧室|床头|床边|睡前/g },
  { tag: "study", label: "书房", pattern: /书房|办公|学习|工作/g },
  { tag: "living", label: "客厅", pattern: /客厅/g },
  { tag: "entry", label: "玄关", pattern: /玄关|门口|进门/g },
  { tag: "sleep", label: "助眠", pattern: /助眠|睡眠|好睡|放松/g },
  { tag: "portable", label: "便携", pattern: /便携|无线|充电|可移动|户外/g },
  { tag: "wall", label: "壁挂", pattern: /壁挂|挂墙|墙上|上墙/g },
  { tag: "display", label: "展示", pattern: /展示|陈列|收藏/g },
];
export const shopWords = [
  { shop: "IKEA", label: "宜家", pattern: /宜家|ikea/gi },
  { shop: "MUJI", label: "无印良品", pattern: /无印良品|无印|muji/gi },
  { shop: "Marshall", label: "Marshall", pattern: /马歇尔|marshall/gi },
  { shop: "Iittala", label: "Iittala", pattern: /伊塔拉|iittala/gi },
  { shop: "KINTO", label: "KINTO", pattern: /kinto/gi },
  { shop: "Vitra", label: "Vitra", pattern: /维特拉|vitra/gi },
  { shop: "&Tradition", label: "&Tradition", pattern: /&\s?tradition|and ?tradition/gi },
];
const SMALL = /小巧|迷你|小号|小件|小东西|小物|小摆件|小一点|小点|小的|不占地|不占空间/g;
const CHEAP = /便宜|实惠|性价比|省钱|平价|划算|不贵/g;
const TABLETOP = /(?:放|摆|用)在?(?:书桌|桌子|桌面|床头柜|边桌|柜子|桌|柜)上|桌上|桌面上|台面上?/g;
const FILLER = /不超过|以内|之内|以下|以上|左右|至少|最多|大概|差不多|预算|价格|价位|宽度|高度|深度|尺寸|大小|我|想|要|找|帮|给|推荐|买|适合|放|在|用|看看|请|一下|有没有|有|能|可以|一张|一个|一把|一件|一些|一款|一只|一盏|个|张|把|件|只|盏|款|些|点|的|了|吗|呢|吧|和|或|与|还|也|比较|更|最|很|挺|东西|种|类|样|房间|家里|里|一|啊|呀|哦/g;

const CN: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 一百二十 → 120, 两千 → 2000, 十五 → 15, 半 → 0.5. */
function cnNumber(s: string) {
  if (s === "半") return 0.5;
  let total = 0, section = 0, digit = 0;
  for (const ch of s) {
    if (ch in CN) digit = CN[ch];
    else if (ch === "十" || ch === "百" || ch === "千") {
      section += (digit || 1) * (ch === "十" ? 10 : ch === "百" ? 100 : 1000);
      digit = 0;
    } else if (ch === "万") {
      total += (section + digit) * 10000;
      section = digit = 0;
    }
  }
  return total + section + digit;
}
// 美元 before 元, so “50 美元” is read as dollars.
const UNIT = "(?:厘米|公分|cm|毫米|mm|米|m(?![a-z])|美元|美金|刀|usd|dollars?|元|块钱|块|人民币|rmb|cny)";
const YUAN = /^(?:元|块钱|块|人民币|rmb|cny)$/;
/** Arabic numerals throughout: “一米二” → 1.2米, “1米5” → 1.5米, “两千块” → 2000块, “1.5k” → 1500. */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，。；！？、]/g, (c) => ({ "，": ",", "。": ".", "；": ";", "！": "!", "？": "?", "、": "," })[c] ?? c)
    .replace(new RegExp(`([零〇一二两三四五六七八九十百千万]+|半)(?=\\s*${UNIT})`, "g"), (m) => String(cnNumber(m)))
    .replace(/(预算|价格|价位)([零〇一二两三四五六七八九十百千万]+)/g, (_, a, n) => a + cnNumber(n))
    .replace(/(\d+)\s*米\s*([一二三四五六七八九]|\d)(?![\d.]|\s*(?:厘米|公分|cm))/g, (_, a, b) => `${a}.${CN[b] ?? b}米`)
    .replace(/(\d+(?:\.\d+)?)\s*(千|k|万|w)(?![a-z])/g, (_, n, m) => String(Math.round(Number(n) * (m === "千" || m === "k" ? 1000 : 10000))));
}

type Mention = { start: number; end: number; a: number; b?: number; unit: string };
const MAX_BEFORE = /不超过|不超|不大于|不高于|不宽于|不长于|不深于|不到|小于|低于|矮于|少于|窄于|短于|最多|最大|顶多|控制在|限制在|<|≤|under|below|within|less than/;
const MIN_BEFORE = /至少|不少于|不小于|不低于|不矮于|大于|高于|宽于|长于|超过|多于|最少|起码|>|≥|over|at least|more than/;
const MAX_AFTER = /^\s*(?:以内|之内|以下|内|为止|之下|封顶)/;
const MIN_AFTER = /^\s*(?:以上|起|开外|多)/;
const AROUND = /左右|上下|附近|前后|大概|大约|约|差不多|around|about/;
const PRICE_CUE = /预算|价格|价位|价钱|售价|花|多少钱|[¥￥$]|美元|美金/;
const SIZE_CUE = /宽|长|深|高|矮|尺寸|直径|大小|进深/;

function numbers(text: string): Mention[] {
  const out: Mention[] = [];
  const re = new RegExp(`[¥￥$]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:(?:到|至|-|~|～|—)\\s*[¥￥$]?\\s*(\\d+(?:\\.\\d+)?)\\s*)?(${UNIT})?`, "g");
  for (let m; (m = re.exec(text)); ) {
    if (!m[0].trim()) { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length, a: Number(m[1]), b: m[2] === undefined ? undefined : Number(m[2]), unit: m[3] ?? (/[¥￥]/.test(m[0]) ? "元" : /\$/.test(m[0]) ? "usd" : "") });
  }
  return out;
}

/** Turns one sentence into conditions. */
export function parse(input: string): Conditions {
  const c = noConditions();
  let text = normalize(input.slice(0, 200));
  const mask = (re: RegExp, each?: () => void) => {
    text = text.replace(re, (m) => {
      each?.();
      return " ".repeat(m.length);
    });
  };
  mask(TABLETOP, () => (c.tabletop = true));

  // Numbers: price, then size. The window around each number is cut at the neighbouring number or comma.
  const found = numbers(text);
  let lastAxis: Axis | undefined;
  found.forEach((n, i) => {
    const from = Math.max(i ? found[i - 1].end : 0, n.start - 10);
    let before = text.slice(from, n.start);
    before = before.slice(Math.max(...[",", ";", "，", "和", "且", "并"].map((d) => before.lastIndexOf(d) + 1)));
    let after = text.slice(n.end, Math.min(found[i + 1]?.start ?? text.length, n.end + 8));
    after = after.split(/[,;，和且并]/)[0];
    const unit = n.unit;
    const isPrice = /元|块|rmb|cny|美金|刀|usd|dollar/.test(unit) || (!unit && PRICE_CUE.test(before));
    const isLength = /米|cm|mm|公分|^m$/.test(unit);
    if (!isPrice && !isLength && !SIZE_CUE.test(before)) return;
    const bound = MAX_BEFORE.test(before) || MAX_AFTER.test(after) ? "max" : MIN_BEFORE.test(before) || MIN_AFTER.test(after) ? "min" : AROUND.test(before + after) ? "around" : null;
    if (isPrice) {
      const p = c.price ?? {};
      let lo: number | undefined, hi: number | undefined;
      if (n.b !== undefined) [lo, hi] = [Math.min(n.a, n.b), Math.max(n.a, n.b)];
      else if (bound === "min") lo = n.a;
      else if (bound === "around") [lo, hi] = [Math.round(n.a * 0.8), Math.round(n.a * 1.2)];
      else hi = n.a;
      // Library prices are in US dollars; yuan are converted at the same ECB fixing as the prices.
      const yuan = YUAN.test(unit);
      const usd = (v: number) => (yuan ? Math.round(toUSD(v, "CNY") * 100) / 100 : v);
      if (lo !== undefined) p.min = usd(lo);
      if (hi !== undefined) p.max = usd(hi);
      if (yuan) p.asked = { currency: "CNY", ...p.asked, ...(lo !== undefined && { min: lo }), ...(hi !== undefined && { max: hi }) };
      c.price = p;
    } else {
      const cm = (v: number) =>
        Math.round((/^(米|m)$/.test(unit) ? v * 100 : /毫米|mm/.test(unit) ? v / 10 : !unit && v < 5 ? v * 100 : v) * 10) / 10;
      // Without an axis word, a number continues the previous one: “宽至少 80、不超过 120”.
      const axis: Axis = /高|矮/.test(before) ? "h" : /深|进深/.test(before) ? "d" : /宽|直径/.test(before) ? "w" : lastAxis ?? "long";
      lastAxis = axis;
      const limit: Limit = { axis };
      if (n.b !== undefined) Object.assign(limit, { min: cm(Math.min(n.a, n.b)), max: cm(Math.max(n.a, n.b)) });
      else if (bound === "max") limit.max = cm(n.a);
      else if (bound === "min") limit.min = cm(n.a);
      else Object.assign(limit, { min: Math.round(cm(n.a) * 0.85), max: Math.round(cm(n.a) * 1.15), around: true });
      // “宽至少 80、不超过 120” on one axis becomes a single range.
      const same = c.sizes.find((s) => s.axis === axis && !s.around && !limit.around);
      if (same) {
        same.min ??= limit.min;
        same.max ??= limit.max;
      } else c.sizes.push(limit);
    }
    text = text.slice(0, n.start) + " ".repeat(n.end - n.start) + text.slice(n.end);
  });

  // Specific kinds first; a word inside a longer, already-matched word (桌 in 床边桌) does not count.
  for (const k of kindWords) mask(new RegExp(k.pattern.source, "gi"), () => !c.kinds.includes(k.kind) && c.kinds.push(k.kind));
  for (const g of catalogCategories) mask(new RegExp(g.pattern.source, "gi"), () => (c.category ??= g.id));
  mask(/无印风/g, () => !c.tags.includes("japanese") && c.tags.push("japanese"));
  for (const s of shopWords) mask(new RegExp(s.pattern.source, "gi"), () => !c.shops.includes(s.shop) && c.shops.push(s.shop));
  for (const t of tagWords) mask(new RegExp(t.pattern.source, "gi"), () => !c.tags.includes(t.tag) && c.tags.push(t.tag));
  mask(SMALL, () => (c.small = true));
  mask(CHEAP, () => (c.cheap = true));
  mask(/小(?![\d])/g, () => (c.small = true));
  c.words = text
    .replace(FILLER, " ")
    .split(/[\s,.;!?，。；！？、"'“”()（）]+/)
    .filter((w) => w.length >= 2 && !/^\d/.test(w));
  return c;
}

const longSide = (i: CatalogItem) => Math.max(i.dims.w, i.dims.d);
const axisValue = (i: CatalogItem, a: Axis) => (a === "long" ? longSide(i) : i.dims[a]);
const fitsTable = (i: CatalogItem) => !i.wall && i.dims.h <= 45 && longSide(i) <= 50 && !["furniture", "textile"].includes(i.category);
const isSmall = (i: CatalogItem) => i.category !== "furniture" && longSide(i) <= 50 && i.dims.h <= 50;

type Rule = "words" | "tags" | "shops" | "tabletop" | "small" | "price" | "size" | "kind";
const RELAX: Rule[] = ["words", "tags", "shops", "tabletop", "small", "price", "size", "kind"];
const RELAX_LABEL: Record<Rule, string> = { words: "关键词", tags: "风格", shops: "品牌", tabletop: "“放在桌上”", small: "“小件”", price: "价格", size: "尺寸", kind: "品类" };

function fits(i: CatalogItem, c: Conditions, skip: Set<Rule>) {
  const text = (i.name + i.shop).toLowerCase();
  if (!skip.has("words") && c.words.length && !c.words.some((w) => text.includes(w.toLowerCase()))) return false;
  if (!skip.has("tags") && c.tags.length && !c.tags.some((t) => i.tags.includes(t))) return false;
  if (!skip.has("shops") && c.shops.length && !c.shops.includes(i.shop)) return false;
  if (!skip.has("tabletop") && c.tabletop && !fitsTable(i)) return false;
  if (!skip.has("small") && c.small && !isSmall(i)) return false;
  if (!skip.has("price") && c.price && ((c.price.max !== undefined && i.price > c.price.max) || (c.price.min !== undefined && i.price < c.price.min))) return false;
  if (!skip.has("size") && c.sizes.some((s) => (s.max !== undefined && axisValue(i, s.axis) > s.max) || (s.min !== undefined && axisValue(i, s.axis) < s.min))) return false;
  if (!skip.has("kind") && c.kinds.length && !c.kinds.includes(i.kind)) return false;
  if (!skip.has("kind") && !c.kinds.length && c.category && i.category !== c.category) return false;
  return true;
}
const active = (c: Conditions, r: Rule) =>
  ({ words: c.words.length > 0, tags: c.tags.length > 0, shops: c.shops.length > 0, tabletop: !!c.tabletop, small: !!c.small, price: !!c.price, size: c.sizes.length > 0, kind: c.kinds.length > 0 || !!c.category })[r];

function rank(items: CatalogItem[], c: Conditions) {
  const score = (i: CatalogItem) => c.tags.filter((t) => i.tags.includes(t)).length * 2 + (c.small && i.tags.includes("small") ? 1 : 0);
  const volume = (i: CatalogItem) => i.dims.w * i.dims.d * i.dims.h;
  return items
    .map((i, n) => ({ i, n }))
    .sort((a, b) => score(b.i) - score(a.i) || (c.cheap ? a.i.price - b.i.price : 0) || (c.small ? volume(a.i) - volume(b.i) : 0) || a.n - b.n)
    .map((x) => x.i);
}

const AXIS_NAME: Record<Axis, string> = { w: "宽度", d: "深度", h: "高度", long: "宽度" };
/** “$50 以内” · “$20–$50” · “500 元（约 $75）以内” */
export function priceWords({ min, max, asked }: NonNullable<Conditions["price"]>) {
  const whole = (v: number) => formatBudget(Math.round(v));
  if (asked) {
    const yuan = asked.min !== undefined && asked.max !== undefined ? `${asked.min}–${asked.max} 元` : `${asked.max ?? asked.min} 元`;
    const usd = min !== undefined && max !== undefined ? `${whole(min)}–${whole(max)}` : whole((max ?? min)!);
    return `${yuan}（约 ${usd}）${asked.min !== undefined && asked.max !== undefined ? "" : asked.max !== undefined ? "以内" : "以上"}`;
  }
  return min !== undefined && max !== undefined ? `${formatBudget(min)}–${formatBudget(max)}` : max !== undefined ? `${formatBudget(max)} 以内` : `${formatBudget(min!)} 以上`;
}
/** “宽度在 100 厘米以内、$500 以内的原木书桌” */
export function describe(c: Conditions) {
  const parts: string[] = [];
  for (const s of c.sizes) {
    const n = AXIS_NAME[s.axis];
    if (s.around) parts.push(`${n} ${Math.round((s.min! + s.max!) / 2)} 厘米左右`);
    else if (s.min !== undefined && s.max !== undefined) parts.push(`${n} ${s.min}–${s.max} 厘米`);
    else if (s.max !== undefined) parts.push(`${n}在 ${s.max} 厘米以内`);
    else if (s.min !== undefined) parts.push(`${n}至少 ${s.min} 厘米`);
  }
  if (c.price) parts.push(priceWords(c.price));
  if (c.tabletop) parts.push("能放在桌上");
  const shops = c.shops.map((s) => shopWords.find((w) => w.shop === s)?.label ?? s).join("或");
  const tags = c.tags.map((t) => tagWords.find((w) => w.tag === t)?.label ?? t);
  const noun =
    c.kinds.map((k) => kindWords.find((w) => w.kind === k)?.name ?? k).join("或") ||
    catalogCategories.find((g) => g.id === c.category)?.name ||
    (c.small || c.tabletop ? "小物件" : "家具");
  const style = tags.length > 1 ? tags.join("、") + "的" : tags.join("");
  const words = c.words.length ? `“${c.words.join("”“")}”` : "";
  const head = parts.length ? parts.join("、") + "的" : "";
  return head + (shops ? shops + "的" : "") + (c.cheap ? "实惠的" : "") + style + (words ? `与${words}相关的` : "") + noun;
}

/** The model name for named products (“LISABO”), the full name otherwise. */
const shortName = (i: CatalogItem) => (/^[A-Za-z&'’]/.test(i.name) ? i.name.split(" ")[0] : i.name);
/** A space wherever Chinese meets a number or a Latin word: “找到 3 件 $500 以内的 Marshall 音箱”. */
const spaced = (s: string) =>
  s.replace(/([A-Za-z0-9%])(?=[\u4e00-\u9fff“])/g, "$1 ").replace(/([\u4e00-\u9fff”])(?=[A-Za-z0-9&$])/g, "$1 ");
function without(c: Conditions, rules: Rule[]): Conditions {
  const r = new Set(rules);
  return {
    kinds: r.has("kind") ? [] : c.kinds, category: r.has("kind") ? undefined : c.category,
    sizes: r.has("size") ? [] : c.sizes, price: r.has("price") ? undefined : c.price,
    tags: r.has("tags") ? [] : c.tags, shops: r.has("shops") ? [] : c.shops, words: r.has("words") ? [] : c.words,
    cheap: c.cheap, small: r.has("small") ? undefined : c.small, tabletop: r.has("tabletop") ? undefined : c.tabletop,
  };
}
export type Answer = { items: CatalogItem[]; reply: string; relaxed: Rule[] };
/** Filters with every condition, then relaxes the least important ones until something fits. */
export function find(items: CatalogItem[], conditions: Conditions): Answer {
  // Leftover words count only when they name something in the library; shown as the library spells them.
  const words = conditions.words.flatMap((w) => {
    const hit = items.map((i) => i.name + " " + i.shop).find((t) => t.toLowerCase().includes(w));
    return hit ? [hit.substr(hit.toLowerCase().indexOf(w), w.length)] : [];
  });
  const c = { ...conditions, words };
  if (!hasConditions(c)) return { items, relaxed: [], reply: `家具库里共有 ${items.length} 件。可以说说品类、尺寸或预算，比如“不超过 1 米的书桌”。` };
  const skip = new Set<Rule>();
  // A kind the library does not carry at all is dropped first, so the other conditions still apply.
  if (active(c, "kind") && !items.some((i) => fits(i, c, new Set(RELAX.filter((r) => r !== "kind"))))) skip.add("kind");
  let hits = items.filter((i) => fits(i, c, skip));
  for (const r of RELAX) {
    if (hits.length) break;
    if (!active(c, r)) continue;
    skip.add(r);
    hits = items.filter((i) => fits(i, c, skip));
  }
  const relaxed = [...skip];
  const want = describe(c);
  if (!hits.length) return { items, relaxed, reply: spaced(`家具库里暂时没有${want}，先看看全部 ${items.length} 件？`) };
  const ranked = rank(hits, c);
  if (!relaxed.length) return { items: ranked, relaxed, reply: spaced(`找到 ${ranked.length} 件${want}。`) };
  // The library does not carry this kind at all: say so, then show what else fits.
  if (relaxed.includes("kind")) {
    const missing = describe({ ...noConditions(), kinds: c.kinds, category: c.category });
    const rest = without(c, relaxed);
    return {
      items: ranked,
      relaxed,
      reply: spaced(`家具库里暂时没有${missing}。` + (hasConditions(rest) && ranked.length < items.length ? `这里有 ${ranked.length} 件${describe(rest)}。` : `先看看全部 ${ranked.length} 件？`)),
    };
  }
  let detail = "";
  if (relaxed.includes("size") && ranked.length <= 2) {
    const s = c.sizes[0];
    detail = ranked.map((i) => `${shortName(i)} ${AXIS_NAME[s.axis].slice(0, 1)} ${axisValue(i, s.axis)} 厘米`).join("，") + "。";
  } else if (relaxed.includes("price") && ranked.length <= 2) {
    detail = ranked.map((i) => `${shortName(i)} ${formatBudget(i.price)}`).join("，") + "。";
  }
  return {
    items: ranked,
    relaxed,
    reply: spaced(`没有完全符合的${want}。放宽${relaxed.map((r) => RELAX_LABEL[r]).join("和")}后，找到 ${ranked.length} 件${detail ? "：" + detail : "。"}`),
  };
}
