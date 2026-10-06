import { env } from "cloudflare:workers";
import { outbound } from "./outbound";
import { say } from "./say";
import type { Project, Task } from "../types";
export function bindings() {
  const e = env as unknown as Record<string, any>;
  if (!e.DB || !e.BUCKET) throw say("项目存储暂时不可用，请重试。", "Storage is unavailable for a moment. Please try again.");
  return { db: e.DB as D1Database, bucket: e.BUCKET as R2Bucket, secrets: e };
}
export async function getProject(id: string, user: string): Promise<Project> {
  const { db } = bindings();
  const row = await db
    .prepare("SELECT data,revision FROM projects WHERE id=? AND owner=?")
    .bind(id, user)
    .first<{ data: string; revision: number }>();
  if (!row) throw say("空间不存在或无权访问。", "This space doesn't exist or isn't yours.");
  const p = JSON.parse(row.data);
  p.revision = row.revision;
  p.tasks = await tasks(id, user);
  return p;
}
export async function saveProject(p: Project, user: string) {
  const { db } = bindings();
  p.updatedAt = Date.now();
  const result = await db
    .prepare(
      "UPDATE projects SET data=?,updated=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?",
    )
    .bind(
      JSON.stringify({ ...p, tasks: [] }),
      p.updatedAt,
      p.id,
      user,
      p.revision,
    )
    .run();
  if (!result.meta.changes) throw say("空间已在另一处更新，请刷新后重试。", "This space was changed elsewhere. Refresh and try again.");
  p.revision++;
  return p;
}
export async function tasks(id: string, user: string): Promise<Task[]> {
  const { db } = bindings();
  const rows = await db
    .prepare("SELECT * FROM jobs WHERE project=? AND owner=? ORDER BY updated")
    .bind(id, user)
    .all<any>();
  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    target: r.target,
    status: r.status,
    providerId: r.provider,
    attempt: r.attempt,
    estimatedCredits: r.estimated,
    reservedCredits: r.reserved,
    actualCredits: r.actual_credits,
    billingDetails: r.billing_details ? JSON.parse(r.billing_details) : undefined,
    error: r.error,
    errorEn: r.result ? JSON.parse(r.result).errorEn : undefined,
    output: r.result ? JSON.parse(r.result) : undefined,
    quality: r.payload ? JSON.parse(r.payload).quality : undefined,
  }));
}
export async function bytes(key: string) {
  const o = await bindings().bucket.get(key);
  if (!o) throw say("图片资源不存在，请重新上传。", "That image is missing. Please upload it again.");
  return {
    buffer: await o.arrayBuffer(),
    type: o.httpMetadata?.contentType || "image/png",
  };
}
export async function cacheRemote(url: string, key: string, format?: "glb" | "spz") {
  if (typeof url !== "string" || !url.startsWith("https://")) throw say("服务商没有返回有效的资产下载地址，可继续查询原任务。", "The provider gave no valid download link. You can keep checking the original job.");
  // Room files can be tens of MB; allow time for a slow network.
  const res = await outbound(url, { signal: AbortSignal.timeout(240000) });
  if (!res.ok || !res.body) throw say(`生成资产下载失败（HTTP ${res.status}），可重试下载，无需重新生成。`, `Download failed (HTTP ${res.status}). Retry the download; nothing needs generating again.`);
  const length = Number(res.headers.get("content-length"));
  if (length > 256 * 1024 * 1024) throw say("生成文件过大，已暂停下载；原任务已保留。", "The file is too large, so the download stopped. The original job is kept.");
  const { bucket } = bindings();
  const httpMetadata = { contentType: format === "glb" ? "model/gltf-binary" : res.headers.get("content-type") || "application/octet-stream" };
  let size: number;
  if (length > 0 && typeof FixedLengthStream !== "undefined") {
    // Streamed straight into storage: a Worker has 128 MB of memory, and a room or an HD model can
    // come close to that on its own.
    const { readable, writable } = new FixedLengthStream(length);
    const piped = res.body.pipeTo(writable);
    piped.catch(() => {}); // a short or broken download fails the put below
    await bucket.put(key, readable, { httpMetadata });
    await piped;
    size = length;
  } else {
    const data = await res.arrayBuffer();
    if (data.byteLength > 64 * 1024 * 1024) throw say("生成文件过大，已暂停下载；原任务已保留。", "The file is too large, so the download stopped. The original job is kept.");
    await bucket.put(key, data, { httpMetadata });
    size = data.byteLength;
  }
  // Checked from its first bytes once stored; a damaged file is removed again.
  const first = await bucket.get(key, { range: { offset: 0, length: 12 } });
  const head = new Uint8Array(first ? await first.arrayBuffer() : new ArrayBuffer(0));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let problem: Error | null = null;
  if (!size) problem = say("生成文件为空或超过本地下载限制。", "The file is empty or over the local download limit.");
  else if (format === "glb" && (head.length < 12 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== size))
    problem = say("模型文件不是完整有效的 GLB，请重试下载原任务。", "The model isn't a complete GLB file. Retry the download of the original job.");
  else if (format === "spz" && !(head[0] === 0x1f && head[1] === 0x8b)) problem = say("房间文件格式异常，请重试下载原任务。", "The room file looks damaged. Retry the download of the original job.");
  if (problem) {
    await bucket.delete(key);
    throw problem;
  }
  return key;
}
/**
 * A lighter copy of a stored GLB, made by the dev server's local optimizer
 * (build/local-model-plugin.mjs): its key, or the original key when there is no optimizer or it
 * fails. The original stays as it is; a paid result is never lost to this step.
 */
export async function slimModel(key: string, largestCm?: number): Promise<string> {
  const { bucket, secrets } = bindings();
  const optimizer = secrets.LOCAL_OPTIMIZER as string | undefined;
  if (!optimizer || key.endsWith(".lite.glb")) return key;
  try {
    const source = await bucket.get(key);
    if (!source) return key;
    const body = await source.arrayBuffer();
    // Busy or short of memory (a 90 MB, 8K model needs about 1.1 GB for a few seconds): wait and try
    // again, since the unslimmed original is heavy for the browser.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 8000));
      res = await fetch(optimizer + (largestCm ? `?size=${Math.round(largestCm)}` : ""), {
        method: "POST",
        body,
        signal: AbortSignal.timeout(200000),
      });
      if (res.status !== 409 && res.status !== 503) break;
    }
    if (!res?.ok) return key;
    const data = await res.arrayBuffer();
    if (data.byteLength < 12 || new DataView(data).getUint32(0, true) !== 0x46546c67) return key;
    const lite = key.replace(/\.glb$/, "") + ".lite.glb";
    await bucket.put(lite, data, { httpMetadata: { contentType: "model/gltf-binary" } });
    return lite;
  } catch {
    return key;
  }
}
export const asset = (key: string) =>
  `/api/assets?key=${encodeURIComponent(key)}`;
