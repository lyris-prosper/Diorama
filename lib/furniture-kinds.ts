// Words that name furniture, shared by room-photo recognition (server) and the furniture library
// search (browser), so “书桌” means the same thing everywhere.

/** Furniture that recognition can find in a room photo; `prompt` is what the segmenter is asked for. */
export const roomCategories = [
  { kind: "bed", name: "床", nameEn: "Bed", prompt: "bed", pattern: /床|bed/i },
  { kind: "desk", name: "书桌", nameEn: "Desk", prompt: "desk", pattern: /桌|desk|table/i },
  {
    kind: "cabinet",
    name: "柜子",
    nameEn: "Cabinet",
    prompt: "freestanding cabinet",
    pattern: /柜|cabinet|wardrobe/i,
  },
  { kind: "chair", name: "椅子", nameEn: "Chair", prompt: "chair", pattern: /椅|chair/i },
  { kind: "sofa", name: "沙发", nameEn: "Sofa", prompt: "sofa", pattern: /沙发|sofa|couch/i },
];

/** Every kind the library knows. Longer, more specific words are listed before the short ones. */
export const kindWords: { kind: string; name: string; nameEn: string; pattern: RegExp }[] = [
  { kind: "side-table", name: "床边桌", nameEn: "bedside table", pattern: /床边桌|床头桌|床头柜|边几|边桌|角几|\bside ?tables?\b|\bnightstands?\b|\bbedside(?: tables?)?\b|\bend tables?\b/gi },
  { kind: "desk", name: "书桌", nameEn: "desk", pattern: /书桌|电脑桌|写字台|办公桌|桌子|桌|\b(?:writing |work |computer )?desks?\b|\btables?\b/gi },
  { kind: "chair", name: "椅子", nameEn: "chair", pattern: /椅子|椅|凳子|凳|\bchairs?\b|\bstools?\b|\bseats?\b/gi },
  { kind: "cabinet", name: "柜子", nameEn: "cabinet", pattern: /玻璃柜|展示柜|高柜|柜子|柜|\bcabinets?\b|\bcupboards?\b|\bdisplay cases?\b/gi },
  { kind: "bed", name: "床", nameEn: "bed", pattern: /床(?!边|头)|\bbeds?\b/gi },
  { kind: "sofa", name: "沙发", nameEn: "sofa", pattern: /沙发|\bsofas?\b|\bcouch(?:es)?\b/gi },
  { kind: "shelf", name: "搁板", nameEn: "shelf", pattern: /搁板|层板|隔板|置物架|壁挂架|\bshel(?:f|ves)\b/gi },
  { kind: "hook", name: "挂钩", nameEn: "hooks", pattern: /衣帽钩|挂钩|衣钩|\b(?:coat )?hooks?\b/gi },
  { kind: "lamp", name: "台灯", nameEn: "lamp", pattern: /台灯|蘑菇灯|灯|\blamps?\b/gi },
  { kind: "candle", name: "烛台", nameEn: "candle holder", pattern: /烛台|蜡烛|\bcandle ?holders?\b|\bcandles?\b|\bvotives?\b|\btealights?\b/gi },
  { kind: "clock", name: "时钟", nameEn: "clock", pattern: /布谷鸟钟|挂钟|时钟|钟|\bclocks?\b/gi },
  { kind: "mirror", name: "镜子", nameEn: "mirror", pattern: /镜子|台镜|镜|\bmirrors?\b/gi },
  { kind: "diffuser", name: "香薰机", nameEn: "diffuser", pattern: /香薰机|香薰|加湿器|\b(?:aroma )?diffusers?\b|\bhumidifiers?\b/gi },
  { kind: "basket", name: "收纳盒", nameEn: "basket", pattern: /收纳盒|收纳篮|藤编盒|篮子|篮|\bbaskets?\b|\bstorage box(?:es)?\b/gi },
  { kind: "tissue", name: "纸巾盒", nameEn: "tissue box", pattern: /纸巾盒|纸抽|纸巾|\btissues?(?: box(?:es)?)?\b/gi },
  { kind: "tray", name: "托盘", nameEn: "tray", pattern: /托盘|\btrays?\b/gi },
  { kind: "speaker", name: "音箱", nameEn: "speaker", pattern: /音箱|音响|\bspeakers?\b/gi },
  { kind: "cushion", name: "靠垫", nameEn: "cushion", pattern: /靠垫|抱枕|靠枕|坐垫|\bcushions?\b|\bpillows?\b/gi },
  { kind: "rug", name: "地毯", nameEn: "rug", pattern: /地毯|地垫|脚垫|\brugs?\b|\bcarpets?\b|\bmats?\b/gi },
  { kind: "cup", name: "杯子", nameEn: "cup", pattern: /马克杯|水杯|杯子|杯|\bmugs?\b|\bcups?\b|\btumblers?\b/gi },
  { kind: "ornament", name: "摆件", nameEn: "ornament", pattern: /摆件|小鸟|鸟|\bornaments?\b|\bfigurines?\b|\bbirds?\b/gi },
  { kind: "bin", name: "垃圾桶", nameEn: "bin", pattern: /垃圾桶|纸篓|垃圾篓|\b(?:waste|trash|rubbish) ?(?:bins?|cans?|baskets?)\b|\bbins?\b/gi },
];

/** Groups shown as filter chips in the library. */
export const catalogCategories: { id: string; name: string; nameEn: string; pattern: RegExp }[] = [
  { id: "furniture", name: "家具", nameEn: "Furniture", pattern: /家具|大件|\bfurniture\b/gi },
  { id: "storage", name: "收纳", nameEn: "Storage", pattern: /收纳|整理|\bstorage\b|\borganis(?:er|ing)\b|\borganiz(?:er|ing)\b/gi },
  { id: "lighting", name: "灯光", nameEn: "Lighting", pattern: /灯光|照明|光源|\blighting\b|\blights?\b/gi },
  { id: "decor", name: "装饰", nameEn: "Decor", pattern: /装饰|饰品|\bdecor(?:ation)?s?\b/gi },
  { id: "textile", name: "软装", nameEn: "Textiles", pattern: /软装|布艺|织物|\btextiles?\b|\bfabrics?\b/gi },
  { id: "appliance", name: "小电器", nameEn: "Gadgets", pattern: /小电器|电器|家电|\bappliances?\b|\bgadgets?\b|\belectronics?\b/gi },
  { id: "tableware", name: "杯具", nameEn: "Tableware", pattern: /杯具|餐具|\btableware\b|\bdrinkware\b/gi },
];

export const kindName = (kind: string, lang: "zh" | "en" = "zh") => {
  const k = kindWords.find((w) => w.kind === kind) ?? roomCategories.find((c) => c.kind === kind);
  if (lang === "en") return k ? k.nameEn.charAt(0).toUpperCase() + k.nameEn.slice(1) : "Furniture";
  return k?.name ?? "家具";
};

/** Common sizes (cm) for furniture the user brings in: a starting point the user corrects. */
export const typicalSizes: Record<string, { name: string; nameEn: string; w: number; d: number; h: number }> = {
  desk: { name: "书桌", nameEn: "Desk", w: 120, d: 60, h: 75 },
  bed: { name: "床", nameEn: "Bed", w: 150, d: 200, h: 90 },
  cabinet: { name: "柜子", nameEn: "Cabinet", w: 100, d: 55, h: 200 },
  chair: { name: "椅子", nameEn: "Chair", w: 45, d: 50, h: 85 },
  sofa: { name: "沙发", nameEn: "Sofa", w: 200, d: 90, h: 85 },
  other: { name: "家具", nameEn: "Furniture", w: 80, d: 50, h: 80 },
};

/** Names the app gives furniture by itself (recognition, typical sizes): shown in English on the English page. */
const DEFAULT_NAMES: Record<string, string> = {
  床: "Bed", 书桌: "Desk", 桌子: "Table", 柜子: "Cabinet", 椅子: "Chair", 沙发: "Sofa", 长凳: "Bench", 家具: "Furniture", 手动家具: "Furniture",
  // the example room's geometry
  橡木双人床: "Oak double bed", 原木书桌: "Wooden desk", 双门落地柜: "Two-door cabinet",
};
export const pieceName = (name: string, lang: "zh" | "en") => (lang === "en" ? DEFAULT_NAMES[name] ?? name : name);
