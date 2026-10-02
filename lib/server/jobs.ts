import { bindings, getProject, saveProject, cacheRemote } from "./storage";
import {
  startWorld,
  startTripo,
  startImage,
  pollWorld,
  pollTripo,
  pollImage,
} from "./providers";
import type { Project } from "../types";
export async function enqueue(
  p: Project,
  user: string,
  kind: string,
  target: string,
  payload: any,
) {
  const { db } = bindings();
  const id = `${p.id}-${kind}-${target}`;
  const reserved = kind === "world" ? 250 : kind === "furniture" ? 100 : 0;
  const limit =
    kind === "world"
      ? Math.min(
          7000,
          Number(bindings().secrets.WORLDLABS_CREDIT_LIMIT || 6770),
        )
      : 5000;
  await db
    .prepare(
      "INSERT OR IGNORE INTO jobs(id,project,owner,kind,target,status,payload,attempt,updated,reserved) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(reserved),0) FROM jobs WHERE kind=?) + ? <= ?",
    )
    .bind(
      id,
      p.id,
      user,
      kind,
      target,
      "queued",
      JSON.stringify(payload),
      1,
      Date.now(),
      reserved,
      kind,
      reserved,
      limit,
    )
    .run();
  if (!(await db.prepare("SELECT id FROM jobs WHERE id=?").bind(id).first()))
    throw Error("已达到本轮生成预算上限。");
}
export async function tick(id: string, user: string) {
  const { db } = bindings();
  const rows = await db
    .prepare(
      "SELECT * FROM jobs WHERE project=? AND owner=? AND status IN ('queued','running','submitting') ORDER BY updated LIMIT 2",
    )
    .bind(id, user)
    .all<any>();
  for (const j of rows.results) {
    if (j.status === "submitting") {
      if (Date.now() - j.updated > 120000)
        await db
          .prepare(
            "UPDATE jobs SET status='uncertain',error=? WHERE id=? AND status='submitting'",
          )
          .bind(
            "提交结果尚未确认，为避免重复扣费，已暂停。请通过服务商任务记录核对。",
            j.id,
          )
          .run();
      continue;
    }
    if (j.status === "queued") {
      const lock = await db
        .prepare(
          "UPDATE jobs SET status='submitting',updated=? WHERE id=? AND status='queued' AND (SELECT COUNT(*) FROM jobs WHERE status IN ('submitting','running'))<2",
        )
        .bind(Date.now(), j.id)
        .run();
      if (!lock.meta.changes) continue;
      try {
        const payload = JSON.parse(j.payload);
        const provider =
          j.kind === "world"
            ? await startWorld(payload.image)
            : j.kind === "furniture"
              ? await startTripo(payload.image)
              : await startImage(j.kind, payload);
        await db
          .prepare(
            "UPDATE jobs SET status='running',provider=?,updated=? WHERE id=?",
          )
          .bind(provider, Date.now(), j.id)
          .run();
      } catch (e) {
        await db
          .prepare(
            "UPDATE jobs SET status='uncertain',error=?,updated=? WHERE id=?",
          )
          .bind(
            (e as Error).message + " 提交未确认，不会自动重复请求。",
            Date.now(),
            j.id,
          )
          .run();
      }
      continue;
    }
    try {
      const out =
        j.kind === "world"
          ? await pollWorld(j.provider)
          : j.kind === "furniture"
            ? await pollTripo(j.provider)
            : await pollImage(j.kind, j.provider);
      if (!out) continue;
      const p = await getProject(id, user);
      if (j.kind === "detect") {
        const info = JSON.parse(j.payload);
        for (let i = 0; i < (out.masks || []).length; i++) {
          const key = await cacheRemote(
            out.masks[i].url,
            `${p.id}/masks/${j.target}-${i}.png`,
          );
          const c = {
            id: `${j.target}-${i}`,
            name: info.name + (out.masks.length > 1 ? ` ${i + 1}` : ""),
            kind: info.kind,
            mask: key,
            box: out.boxes?.[i] || out.metadata?.[i]?.box || [0.5, 0.5, 1, 1],
            score: out.scores?.[i] ?? out.metadata?.[i]?.score ?? 0,
            selected: false,
            source: "sam3" as const,
          };
          p.candidates = p.candidates.filter((v) => v.id !== c.id).concat(c);
        }
        p.stage = "confirm";
      }
      if (j.kind === "erase") {
        p.rawBackground = await cacheRemote(
          out.image.url,
          `${p.id}/processed/raw.png`,
        );
        p.stage = "review";
      }
      if (j.kind === "world") {
        const a = out.assets;
        if (!a?.splats?.spz_urls) throw Error("服务没有返回可加载的空间资产。");
        const splat = await cacheRemote(
          a.splats.spz_urls["100k"] || a.splats.spz_urls["500k"],
          `${p.id}/room/scene.spz`,
        );
        let collider;
        if (a.mesh?.collider_mesh_url)
          collider = await cacheRemote(
            a.mesh.collider_mesh_url,
            `${p.id}/room/collider.glb`,
          );
        const s = a.splats.semantics_metadata;
        p.room = {
          splat,
          collider,
          scale: s?.metric_scale_factor || 1,
          offset: s?.ground_plane_offset || 0,
        };
        p.floor.confirmed = false;
        p.stage = "ready";
      }
      if (j.kind === "furniture") {
        const model = await cacheRemote(
          out.output.model_url,
          `${p.id}/models/${j.target}.glb`,
        );
        const thumb = out.output.rendered_image_url
          ? await cacheRemote(
              out.output.rendered_image_url,
              `${p.id}/models/${j.target}.png`,
            )
          : undefined;
        const item = p.items.find((i) => i.id === j.target);
        if (item) {
          item.model = model;
          item.thumbnail = thumb;
          item.status = "ready";
          delete item.error;
        }
      }
      await saveProject(p, user);
      await db
        .prepare(
          "UPDATE jobs SET status='done',result=?,error=NULL,updated=? WHERE id=?",
        )
        .bind(
          JSON.stringify({ cost: out.cost || out.credits_consumed || null }),
          Date.now(),
          j.id,
        )
        .run();
    } catch (e) {
      const terminal = !!(e as any).terminal;
      await db
        .prepare(
          "UPDATE jobs SET status='failed',error=?,result=?,updated=? WHERE id=?",
        )
        .bind(
          (e as Error).message,
          JSON.stringify({ terminal }),
          Date.now(),
          j.id,
        )
        .run();
    }
  }
  return getProject(id, user);
}
