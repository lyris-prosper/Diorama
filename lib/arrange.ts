// “帮我布置”: one sentence becomes a handful of library pieces, each with a place in the room.
// The server asks DeepSeek (lib/server/arrange.ts) and keeps only what checkPlan accepts here;
// without a key, offline, or with an answer that doesn't hold up, rulePlan answers instead, with the
// same sentence parser as “帮我找”. Places: in the sample bedroom, hand-set spots (DEMO_ROOM.spots);
// in any other room, a zone the page fills from the room scan (lib/placement.ts autoSpot).
import { catalog, formatBudget, formatUSD, itemName, type CatalogItem } from "./catalog";
import { parse } from "./catalog-search";
import type { Lang } from "./i18n";

/** On the floor, on a table / bed / desk top, or hung on a wall. */
export type Zone = "floor" | "top" | "wall";
type Vec3 = [number, number, number];
/** A hand-set place in a known room: where a piece of this zone stands, and which way it faces. */
export type Spot = {
  id: string;
  zone: Zone;
  label: { zh: string; en: string };
  position: Vec3;
  rotation: number;
  /** Words (a regular expression) for the pieces this place suits best; any piece of the zone fits. */
  suits?: string;
  /** Largest footprint side, cm, that fits here. */
  room?: number;
};
export type PlanItem = { catalogId: string; zone: Zone; spot?: string };
export type Plan = { items: PlanItem[]; reason: string; total: number; source: "ai" | "rules" };

const TOP = /^(lamp|clock|mirror|diffuser|basket|tissue|tray|speaker|candle|cup|ornament|cushion|plant|vase|book)/;
/** Where a library piece goes: on a wall when the library says so (or tags it so, like the cuckoo
 * clock); small pieces of table kinds stand on tops; the rest on the floor. */
export function zoneOf(c: CatalogItem): Zone {
  if (c.wall || c.tags.includes("wall")) return "wall";
  if (TOP.test(c.kind) && c.dims.h < 60 && Math.max(c.dims.w, c.dims.d) < 60) return "top";
  return "floor";
}
const text = (c: CatalogItem) => `${c.kind} ${c.name} ${c.nameEn} ${c.tags.join(" ")}`;

// ———————————————————————— rules
type Slot = { zone?: Zone; like: RegExp };
type Theme = { id: string; zh: string; en: string; words: RegExp; slots: Slot[] };
const S = {
  rug: { like: /\brug\b|地毯/i },
  plant: { zone: "floor", like: /plant|ficus|monstera|olive|fejka|绿植|植物/i },
  floorLamp: { zone: "floor", like: /\blamp\b|落地灯|灯/i },
  books: { zone: "floor", like: /bookcase|bookshel|书架|书柜/i },
  lounge: { zone: "floor", like: /armchair|lounge|po[äa]ng|easy chair|扶手椅|休闲椅|单人椅|单椅/i },
  chair: { zone: "floor", like: /\bchair\b|椅/i },
  bench: { zone: "floor", like: /bench|ottoman|stool|长凳|床尾凳|脚凳/i },
  side: { zone: "floor", like: /side-table|bedside|nightstand|床边|床头/i },
  desk: { zone: "floor", like: /\bdesk\b|书桌/i },
  bin: { zone: "floor", like: /\bbin\b|垃圾桶|纸篓/i },
  art: { zone: "wall", like: /\bart\b|frame|poster|print|picture|画|海报|相框/i },
  wall: { zone: "wall", like: /shelf|hook|clock|搁板|挂钩|钟/i },
  lamp: { zone: "top", like: /\blamp\b|灯/i },
  cushion: { zone: "top", like: /cushion|pillow|靠垫|抱枕/i },
  glow: { zone: "top", like: /candle|diffuser|votive|烛|香薰/i },
  small: { zone: "top", like: /tray|basket|cup|mug|ornament|bird|托盘|收纳|杯|摆件/i },
  mirror: { like: /mirror|镜/i },
} satisfies Record<string, Slot>;
const THEMES: Theme[] = [
  {
    id: "study",
    zh: "书桌角",
    en: "desk corner",
    words: /书桌|学习|办公|工作|写字|看书桌|study|desk|work|office|homework/i,
    slots: [S.lamp, S.chair, S.books, S.wall, S.small, S.bin, S.plant, S.art, S.glow],
  },
  {
    id: "reading",
    zh: "阅读角",
    en: "reading corner",
    words: /阅读|看书|读书|休闲|窝着|发呆|reading|read|lounge|relax/i,
    slots: [S.lounge, S.floorLamp, S.side, S.rug, S.cushion, S.plant, S.art, S.glow],
  },
  {
    id: "cozy",
    zh: "温馨卧室",
    en: "cozy bedroom",
    words: /./,
    slots: [S.rug, S.plant, S.lounge, S.floorLamp, S.art, S.side, S.lamp, S.bench, S.cushion, S.art, S.glow, S.mirror, S.small],
  },
];
/** The theme a sentence asks for (the first that matches; a cozy bedroom otherwise). */
export const themeOf = (sentence: string) => THEMES.find((t) => t.words.test(sentence))!;

/**
 * The rules' answer: the theme's slots in order, each filled with the best library piece the
 * sentence allows (style words, a per-piece price or kind), within the total budget if it names one.
 */
export function rulePlan(sentence: string, spots: Spot[] | null, lang: Lang, items: CatalogItem[] = catalog): Plan {
  const theme = themeOf(sentence);
  const c = parse(sentence);
  const budget = c.price?.max;
  const styled = (i: CatalogItem) => c.tags.filter((t) => i.tags.includes(t)).length;
  const used = new Set<string>();
  const picked: CatalogItem[] = [];
  let total = 0;
  for (const slot of theme.slots) {
    const fits = items
      .filter((i) => !used.has(i.id) && slot.like.test(text(i)) && (!slot.zone || zoneOf(i) === slot.zone))
      .filter((i) => budget === undefined || total + i.price <= budget)
      // Style words first; then the cheaper piece if asked, else the bigger one (it changes the room more).
      .sort((a, b) => styled(b) - styled(a) || (c.cheap ? a.price - b.price : b.dims.w * b.dims.d - a.dims.w * a.dims.d));
    const best = fits[0];
    if (!best) continue;
    used.add(best.id);
    picked.push(best);
    total += best.price;
    if (picked.length >= 8) break;
  }
  const placed = assign(picked.map((i) => ({ catalogId: i.id, zone: zoneOf(i) })), spots);
  const sum = placed.reduce((n, p) => n + (items.find((i) => i.id === p.catalogId)?.price ?? 0), 0);
  const names = placed.slice(0, 3).map((p) => itemName(items.find((i) => i.id === p.catalogId)!, lang));
  const reason =
    lang === "en"
      ? `A ${theme.en}: ${placed.length} ${placed.length === 1 ? "piece" : "pieces"}, about ${formatUSD(sum)}${budget !== undefined ? `, within your ${formatBudget(budget)}` : ""}. Starting with ${names.join(", ")}.`
      : `按“${theme.zh}”挑了 ${placed.length} 件，参考合计 ${formatUSD(sum)}${budget !== undefined ? `，没超过 ${formatBudget(budget)} 的预算` : ""}。先摆上${names.map((n) => `「${n}」`).join("")}。`;
  return { items: placed, reason, total: Math.round(sum * 100) / 100, source: "rules" };
}

/**
 * Gives each piece a free place: in a known room, the spot it asked for, else the first free spot
 * of its zone that suits it, else one meant for nothing in particular; a piece with no such spot
 * left is dropped (a plant never takes the bench's place). Elsewhere the zone alone.
 */
export function assign(items: PlanItem[], spots: Spot[] | null, taken: Set<string> = new Set()): PlanItem[] {
  if (!spots) return items.map(({ catalogId, zone }) => ({ catalogId, zone }));
  const free = spots.filter((s) => !taken.has(s.id));
  const out: PlanItem[] = [];
  // Pieces that named their spot keep it when it is free and of their zone.
  const wanted = new Set<string>();
  for (const it of items) {
    const s = it.spot ? free.find((f) => f.id === it.spot && f.zone === it.zone && !wanted.has(f.id)) : undefined;
    if (s) wanted.add(s.id);
  }
  for (const it of items) {
    const entry = catalog.find((c) => c.id === it.catalogId);
    if (!entry) continue;
    const size = Math.max(entry.dims.w, entry.dims.d);
    const open = free.filter((f) => f.zone === it.zone && !out.some((o) => o.spot === f.id) && (f.id === it.spot || !wanted.has(f.id)) && (!f.room || size <= f.room));
    const s = open.find((f) => f.id === it.spot) ?? open.find((f) => f.suits && new RegExp(f.suits, "i").test(text(entry))) ?? open.find((f) => !f.suits);
    if (s) out.push({ catalogId: it.catalogId, zone: it.zone, spot: s.id });
  }
  return out;
}

// ———————————————————————— AI
/** The request to the language model: the library, the places, the sentence; JSON back. */
export function prompt(sentence: string, spots: Spot[] | null, lang: Lang, room: string, items: CatalogItem[] = catalog) {
  const lines = items.map((i) => `${i.id} | ${i.nameEn} / ${i.name} | ${i.kind} | ${zoneOf(i)} | $${i.price} | ${i.dims.w}×${i.dims.d}×${i.dims.h} cm | ${i.tags.join(",")}`);
  const places = spots
    ? spots.map((s) => `${s.id} | ${s.zone} | ${s.label.en}${s.room ? ` | up to ${s.room} cm` : ""}`)
    : ["floor | along a wall, on the floor", "top | on a desk, bedside table or bed", "wall | hung on a wall"];
  const system = [
    "You are an interior stylist inside a 3D room planner. Furnish the room for the person's request, choosing ONLY from the catalog.",
    `Room: ${room}`,
    "Catalog (id | name | kind | zone | price USD | size W×D×H | tags):",
    ...lines,
    spots ? "Places (id | zone | where | max size):" : "Zones:",
    ...places,
    "Rules: pick 4 to 8 pieces that look good together; a piece's zone must equal its place's zone" +
      (spots ? "; use each place at most once" : "") +
      "; if the request names a budget, add up the prices and keep the total within it; prefer what the request asks for (style, colour, use).",
    "The room is almost empty: start with the pieces that change it most (a big rug, a tall plant, an armchair, a floor lamp, pictures on the walls) where they fit, then add a few small accents.",
    `Reply with json only, like {"items":[{"id":"<catalog id>","place":"<${spots ? "place id" : "zone"}>"}],"reason":"<one or two warm, specific sentences in ${lang === "en" ? "English" : "Simplified Chinese"} about the feel these pieces give; mention only pieces you chose, at most three, and no prices>"}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: sentence.slice(0, 200) },
  ];
}

/** Checks the model's JSON against the library, the places and the budget; null when too little holds up. */
export function checkPlan(raw: unknown, sentence: string, spots: Spot[] | null, items: CatalogItem[] = catalog): Plan | null {
  const r = raw as { items?: { id?: unknown; place?: unknown }[]; reason?: unknown } | null;
  if (!r || !Array.isArray(r.items)) return null;
  const budget = parse(sentence).price?.max;
  const seen = new Set<string>();
  const wanted: PlanItem[] = [];
  let total = 0;
  for (const x of r.items.slice(0, 10)) {
    const entry = items.find((i) => i.id === x?.id);
    if (!entry) continue;
    if (seen.has(entry.id) && entry.price > 40) continue;
    if (budget !== undefined && total + entry.price > budget) continue;
    seen.add(entry.id);
    total += entry.price;
    const zone = zoneOf(entry);
    const place = typeof x.place === "string" ? x.place : undefined;
    wanted.push({ catalogId: entry.id, zone, spot: spots?.some((s) => s.id === place) ? place : undefined });
  }
  const placed = assign(wanted, spots);
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : "";
  if (placed.length < 2 || !reason) return null;
  const sum = placed.reduce((n, p) => n + (items.find((i) => i.id === p.catalogId)?.price ?? 0), 0);
  return { items: placed, reason, total: Math.round(sum * 100) / 100, source: "ai" };
}
