// Prepares the furniture library: turns the source models listed in lib/catalog.json into light
// GLBs under public/catalog/models, sized in real metres, and records their measured size.
//
//   node scripts/build-catalog.mjs [--src <folder>] [--force] [--only id,id]
//   node scripts/build-catalog.mjs --images <folder>
//
// --images rebuilds the card pictures (public/catalog/images/<id>.webp) from the official product
// photos, numbered like the catalog: 01_….jpg is the first entry, 20_….jpg the last.
//
// Source models are full Tripo exports (three 4096² textures, 4–18 MB each). Each one is
// re-oriented (when the catalog asks), scaled uniformly to the product's real size, centred on the
// floor, given 1024 px WebP textures and meshopt-compressed geometry. No paid service is called:
// items without a source model are listed with their Tripo estimate and left for the user to decide.
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clearNodeTransform, getBounds } from "@gltf-transform/functions";
import sharp from "sharp";
import { gltfIO, slim } from "./optimize-glb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const src = resolve(root, option("--src") ?? process.env.CATALOG_SRC ?? "../20款产品3D模型");
const only = option("--only")?.split(",");
const catalogPath = join(root, "lib/catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const TRIPO_ESTIMATE = 30;
// Tripo models face +X; the app (like glTF) treats +Z as the front.
const TRIPO_YAW = -90;
const MAX_TRIANGLES = 40000;

// 4×4 column-major matrices.
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const rot = (axis, deg) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  if (axis === "x") return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === "y") return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
const scaleMove = (k, t) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, t[0], t[1], t[2], 1];
const median = (v) => {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function bake(scene, matrix) {
  for (const node of scene.listChildren()) {
    node.setMatrix(mul(matrix, node.getMatrix()));
    clearNodeTransform(node);
  }
}
// Real size (cm) per model unit. The product's longer footprint side goes with the model's longer
// horizontal side. The median of the per-axis ratios ignores one odd axis: a tissue sticking out
// of its box, a mug handle, a lamp shade wider than the listed base.
function unitScale(item, size) {
  const known = item.known ?? ["w", "d", "h"];
  const footprint = [["w", item.dims.w], ["d", item.dims.d]].sort((a, b) => b[1] - a[1]);
  const model = [Math.max(size[0], size[2]), Math.min(size[0], size[2])];
  const ratios = [];
  footprint.forEach(([key, cm], i) => known.includes(key) && model[i] > 1e-4 && ratios.push(cm / model[i]));
  if (known.includes("h") && size[1] > 1e-4) ratios.push(item.dims.h / size[1]);
  if (!ratios.length) throw Error(`${item.id}: 没有可用的已知尺寸`);
  return median(ratios);
}
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// A square card picture: the product trimmed to its outline, centred with a margin on its own
// backdrop colour (white, or Marshall's grey), 512 px WebP.
async function cardImage(file, out) {
  const [r, g, b] = await sharp(file).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const background = { r, g, b };
  const trimmed = await sharp(file).flatten({ background }).trim({ threshold: 18 }).toBuffer();
  // Two passes: sharp always resizes before it extends within one pipeline.
  const { data, info } = await sharp(trimmed).resize(456, 456, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const x = 512 - info.width, y = 512 - info.height;
  await sharp(data)
    .extend({ left: x >> 1, right: x - (x >> 1), top: y >> 1, bottom: y - (y >> 1), background })
    .webp({ quality: 84 })
    .toFile(out);
}
const imageDir = option("--images");
if (imageDir) {
  const dir = resolve(root, imageDir);
  const files = readdirSync(dir);
  for (const [k, item] of catalog.items.entries()) {
    const file = files.find((f) => f.startsWith(String(k + 1).padStart(2, "0") + "_"));
    if (!file) throw Error(`${item.id}: ${dir} 里没有编号 ${k + 1} 的图片`);
    await cardImage(join(dir, file), join(root, "public", item.image));
    console.log(`✓ ${item.id.padEnd(16)} ← ${file}`);
  }
  process.exit(0);
}

const io = await gltfIO();

const missing = [];
let total = 0;
for (const item of catalog.items) {
  if (only && !only.includes(item.id)) continue;
  const out = `/catalog/models/${item.id}.glb`;
  const outFile = join(root, "public", out);
  const source = item.source?.file ? join(src, item.source.file) : null;
  if (!source || !existsSync(source)) {
    if (!existsSync(outFile)) missing.push(item);
    else console.log(`· ${item.id}: 没有源文件，保留已有模型`);
    continue;
  }
  if (!flag("--force") && existsSync(outFile) && statSync(outFile).mtimeMs > statSync(source).mtimeMs && item.modelSize) {
    console.log(`· ${item.id}: 已是最新`);
    total += statSync(outFile).size;
    continue;
  }
  const doc = await io.read(source);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const [rx = 0, ry = 0, rz = 0] = item.source.rotate ?? [];
  bake(scene, mul(rot("y", TRIPO_YAW + (item.source.yaw ?? 0)), mul(rot("z", rz), mul(rot("y", ry), rot("x", rx)))));
  let { min, max } = getBounds(scene);
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  const cm = unitScale(item, size);
  const k = cm / 100;
  // Centre the footprint on the origin and stand the model on y = 0, in metres.
  bake(scene, scaleMove(k, [-((min[0] + max[0]) / 2) * k, -min[1] * k, -((min[2] + max[2]) / 2) * k]));
  ({ min, max } = getBounds(scene));
  await slim(doc, { maxTriangles: MAX_TRIANGLES, texture: 1024 });
  await io.write(outFile, doc);
  const bytes = statSync(outFile).size;
  total += bytes;
  item.model = out;
  item.modelSize = { w: round((max[0] - min[0]) * 100), d: round((max[2] - min[2]) * 100), h: round((max[1] - min[1]) * 100) };
  item.modelHeight = round(max[1] - min[1], 4);
  console.log(
    `✓ ${item.id.padEnd(16)} ${(statSync(source).size / 1e6).toFixed(1).padStart(5)} MB → ${(bytes / 1e6).toFixed(2)} MB` +
      `  模型 ${item.modelSize.w}×${item.modelSize.d}×${item.modelSize.h} cm（标称 ${item.dimsLabel}）`,
  );
}
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
console.log(`\n家具库模型共 ${(total / 1e6).toFixed(1)} MB。`);
if (missing.length) {
  console.log(
    `\n${missing.length} 件没有源模型：${missing.map((i) => i.name).join("、")}。\n` +
      `可以用工作台里的“添加家具”上传白底照片，交给 Tripo 生成（预计 ${TRIPO_ESTIMATE} × ${missing.length} = ${TRIPO_ESTIMATE * missing.length} 积分），` +
      `再把下载的 GLB 放进源文件夹后重新运行本脚本。本脚本不会调用付费服务。`,
  );
  process.exitCode = 1;
}
