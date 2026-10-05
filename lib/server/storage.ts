import { env } from "cloudflare:workers";
import { outbound } from "./outbound";
import type { Project, Task } from "../types";
export function bindings() {
  const e = env as unknown as Record<string, any>;
  if (!e.DB || !e.BUCKET) throw Error("项目存储暂时不可用，请重试。");
  return { db: e.DB as D1Database, bucket: e.BUCKET as R2Bucket, secrets: e };
}
/** The workbench runs on one person's Mac, without sign-in: every space belongs to this owner. */
export function owner() {
  return "local-preview";
}
export async function getProject(id: string, user: string): Promise<Project> {
  const { db } = bindings();
  const row = await db
    .prepare("SELECT data,revision FROM projects WHERE id=? AND owner=?")
    .bind(id, user)
    .first<{ data: string; revision: number }>();
  if (!row) throw Error("空间不存在或无权访问。");
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
  if (!result.meta.changes) throw Error("空间已在另一处更新，请刷新后重试。");
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
    output: r.result ? JSON.parse(r.result) : undefined,
  }));
}
export async function bytes(key: string) {
  const o = await bindings().bucket.get(key);
  if (!o) throw Error("图片资源不存在，请重新上传。");
  return {
    buffer: await o.arrayBuffer(),
    type: o.httpMetadata?.contentType || "image/png",
  };
}
export async function cacheRemote(url: string, key: string, format?: "glb" | "spz") {
  if (typeof url !== "string" || !url.startsWith("https://")) throw Error("服务商没有返回有效的资产下载地址，可继续查询原任务。");
  // Room files can be tens of MB; allow time for a slow network.
  const res = await outbound(url, { signal: AbortSignal.timeout(240000) });
  if (!res.ok || !res.body) throw Error(`生成资产下载失败（HTTP ${res.status}），可重试下载，无需重新生成。`);
  if (Number(res.headers.get("content-length")) > 256 * 1024 * 1024) throw Error("生成文件过大，已暂停下载；原任务已保留。");
  const data = await res.arrayBuffer();
  const head = new Uint8Array(data);
  if (!data.byteLength || data.byteLength > 256 * 1024 * 1024) throw Error("生成文件为空或超过本地下载限制。");
  if (format === "glb" && (data.byteLength < 12 || new DataView(data).getUint32(0,true) !== 0x46546c67 || new DataView(data).getUint32(4,true) !== 2 || new DataView(data).getUint32(8,true) !== data.byteLength)) throw Error("模型文件不是完整有效的 GLB，请重试下载原任务。");
  if (format === "spz" && !(head[0] === 0x1f && head[1] === 0x8b)) throw Error("房间文件格式异常，请重试下载原任务。");
  await bindings().bucket.put(key, data, { httpMetadata: {contentType: format === "glb" ? "model/gltf-binary" : res.headers.get("content-type") || "application/octet-stream"} });
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
    const res = await fetch(optimizer + (largestCm ? `?size=${Math.round(largestCm)}` : ""), {
      method: "POST",
      body: await source.arrayBuffer(),
      signal: AbortSignal.timeout(200000),
    });
    if (!res.ok) return key;
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
