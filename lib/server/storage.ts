import { env } from "cloudflare:workers";
import type { Project, Task } from "../types";
export function bindings() {
  const e = env as unknown as Record<string, any>;
  if (!e.DB || !e.BUCKET) throw Error("项目存储暂时不可用，请重试。");
  return { db: e.DB as D1Database, bucket: e.BUCKET as R2Bucket, secrets: e };
}
export function owner(req: Request) {
  const id = req.headers.get("oai-authenticated-user-id");
  if (id) return id;
  if (process.env.NODE_ENV === "development") return "local-preview";
  throw Error("请先登录以访问自己的空间。");
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
export async function dataURI(key: string) {
  const b = await bytes(key);
  return `data:${b.type};base64,${Buffer.from(b.buffer).toString("base64")}`;
}
export async function cacheRemote(url: string, key: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body)
    throw Error("生成资产下载失败，可重试下载，无需重新生成。");
  await bindings().bucket.put(key, res.body, {
    httpMetadata: {
      contentType:
        res.headers.get("content-type") || "application/octet-stream",
    },
  });
  return key;
}
export const asset = (key: string) =>
  `/api/assets?key=${encodeURIComponent(key)}`;
