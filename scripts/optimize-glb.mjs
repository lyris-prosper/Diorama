// Shared GLB slimming for the furniture library (scripts/build-catalog.mjs) and for models Tripo
// generates (build/local-model-plugin.mjs). Tripo exports carry three 4096² textures and up to
// 1.5 M triangles; the browser needs neither. Geometry is welded, simplified to a triangle budget
// and meshopt-compressed; textures become WebP at a size that suits the piece.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, getBounds, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

let ioPromise;
/** A NodeIO that reads and writes every glTF extension, meshopt included. */
export function gltfIO() {
  ioPromise ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]).then(() =>
    new NodeIO()
      .setLogger(new Logger(Logger.Verbosity.WARN))
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder }),
  );
  return ioPromise;
}

export const countTriangles = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);

/**
 * Slims a document in place: weld, simplify to the triangle budget, WebP textures, meshopt.
 * @param {import("@gltf-transform/core").Document} doc
 * @param {{ maxTriangles: number, texture: number }} options  triangle budget; base colour / normal map size in px
 */
export async function slim(doc, { maxTriangles, texture }) {
  const triangles = countTriangles(doc);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    ...(triangles > maxTriangles ? [simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / triangles, error: 0.0005 })] : []),
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^(baseColor|normal|emissive)/, resize: [texture, texture], quality: 86 }),
    textureCompress({ encoder: sharp, targetFormat: "webp", slots: /^(metallicRoughness|occlusion)/, resize: [texture / 2, texture / 2], quality: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return { before: triangles, after: countTriangles(doc) };
}

/**
 * A generated model slimmed for the room. Big pieces (a bed, a wardrobe: 1 m or more on any side)
 * keep 2048 px textures and up to 150k triangles; smaller ones 1024 px and 60k. Without a real size
 * the model's own proportions decide: wide and low reads as a bed or a desk.
 * @param {Uint8Array} bytes
 * @param {{ largestCm?: number }} [hint]
 */
export async function optimizeGlb(bytes, { largestCm } = {}) {
  const io = await gltfIO();
  const doc = await io.readBinary(bytes);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const extent = Math.max(max[0] - min[0], max[2] - min[2]), height = max[1] - min[1];
  const large = largestCm ? largestCm >= 100 : height > 0 && extent / height > 1.4;
  const stats = await slim(doc, { maxTriangles: large ? 150_000 : 60_000, texture: large ? 2048 : 1024 });
  return { bytes: await io.writeBinary(doc), ...stats };
}

// Child-process entry, used by build/local-model-plugin.mjs so the dev server's memory stays small:
//   node scripts/optimize-glb.mjs <in.glb> <out.glb> [largest side in cm]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, cm] = process.argv.slice(2);
  const r = await optimizeGlb(readFileSync(input), { largestCm: Number(cm) || undefined });
  writeFileSync(output, r.bytes);
  process.stdout.write(JSON.stringify({ before: r.before, after: r.after, bytes: r.bytes.byteLength }));
}
