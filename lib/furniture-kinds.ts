// Words that name furniture, shared by room-photo recognition (server) and the furniture library
// search (browser), so “书桌” means the same thing everywhere.

/** Furniture that recognition can find in a room photo; `prompt` is what the segmenter is asked for. */
export const roomCategories = [
  { kind: "bed", name: "床", prompt: "bed", pattern: /床|bed/i },
  { kind: "desk", name: "书桌", prompt: "desk", pattern: /桌|desk|table/i },
  {
    kind: "cabinet",
    name: "柜子",
    prompt: "freestanding cabinet",
    pattern: /柜|cabinet|wardrobe/i,
  },
  { kind: "chair", name: "椅子", prompt: "chair", pattern: /椅|chair/i },
  { kind: "sofa", name: "沙发", prompt: "sofa", pattern: /沙发|sofa|couch/i },
];

/** Every kind the library knows. Longer, more specific words are listed before the short ones. */
export const kindWords: { kind: string; name: string; pattern: RegExp }[] = [
  { kind: "side-table", name: "床边桌", pattern: /床边桌|床头桌|床头柜|边几|边桌|角几|side ?table|nightstand|bedside/gi },
  { kind: "desk", name: "书桌", pattern: /书桌|电脑桌|写字台|办公桌|桌子|桌|desk/gi },
  { kind: "chair", name: "椅子", pattern: /椅子|椅|凳子|凳|chair|stool/gi },
  { kind: "cabinet", name: "柜子", pattern: /玻璃柜|展示柜|高柜|柜子|柜|cabinet/gi },
  { kind: "bed", name: "床", pattern: /床(?!边|头)|bed(?!side)/gi },
  { kind: "sofa", name: "沙发", pattern: /沙发|sofa|couch/gi },
  { kind: "shelf", name: "搁板", pattern: /搁板|层板|隔板|置物架|壁挂架|shelf/gi },
  { kind: "hook", name: "挂钩", pattern: /衣帽钩|挂钩|衣钩|hooks?/gi },
  { kind: "lamp", name: "台灯", pattern: /台灯|蘑菇灯|灯|lamp/gi },
  { kind: "candle", name: "烛台", pattern: /烛台|蜡烛|candle|votive/gi },
  { kind: "clock", name: "时钟", pattern: /布谷鸟钟|挂钟|时钟|钟|clock/gi },
  { kind: "mirror", name: "镜子", pattern: /镜子|台镜|镜|mirror/gi },
  { kind: "diffuser", name: "香薰机", pattern: /香薰机|香薰|加湿器|diffuser/gi },
  { kind: "basket", name: "收纳盒", pattern: /收纳盒|收纳篮|藤编盒|篮子|篮|basket/gi },
  { kind: "tissue", name: "纸巾盒", pattern: /纸巾盒|纸抽|纸巾|tissue/gi },
  { kind: "tray", name: "托盘", pattern: /托盘|tray/gi },
  { kind: "speaker", name: "音箱", pattern: /音箱|音响|speaker/gi },
  { kind: "cushion", name: "靠垫", pattern: /靠垫|抱枕|靠枕|坐垫|cushion|pillow/gi },
  { kind: "rug", name: "地毯", pattern: /地毯|地垫|脚垫|rug|carpet/gi },
  { kind: "cup", name: "杯子", pattern: /马克杯|水杯|杯子|杯|mug|cup/gi },
  { kind: "ornament", name: "摆件", pattern: /摆件|小鸟|鸟|ornament|figurine/gi },
  { kind: "bin", name: "垃圾桶", pattern: /垃圾桶|纸篓|垃圾篓|bin|trash/gi },
];

/** Groups shown as filter chips in the library. */
export const catalogCategories: { id: string; name: string; pattern: RegExp }[] = [
  { id: "furniture", name: "家具", pattern: /家具|大件|furniture/gi },
  { id: "storage", name: "收纳", pattern: /收纳|整理|storage/gi },
  { id: "lighting", name: "灯光", pattern: /灯光|照明|光源|lighting/gi },
  { id: "decor", name: "装饰", pattern: /装饰|饰品|decor/gi },
  { id: "textile", name: "软装", pattern: /软装|布艺|织物|textile/gi },
  { id: "appliance", name: "小电器", pattern: /小电器|电器|家电|appliance/gi },
  { id: "tableware", name: "杯具", pattern: /杯具|餐具|tableware/gi },
];

export const kindName = (kind: string) =>
  kindWords.find((k) => k.kind === kind)?.name ?? roomCategories.find((c) => c.kind === kind)?.name ?? "家具";

/** Common sizes (cm) for furniture the user brings in: a starting point the user corrects. */
export const typicalSizes: Record<string, { name: string; w: number; d: number; h: number }> = {
  desk: { name: "书桌", w: 120, d: 60, h: 75 },
  bed: { name: "床", w: 150, d: 200, h: 90 },
  cabinet: { name: "柜子", w: 100, d: 55, h: 200 },
  chair: { name: "椅子", w: 45, d: 50, h: 85 },
  sofa: { name: "沙发", w: 200, d: 90, h: 85 },
  other: { name: "家具", w: 80, d: 50, h: 80 },
};
