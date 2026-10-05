import { bindings, getProject, saveProject, cacheRemote } from "./storage";
import { startWorld, startTripo, startImage, pollWorld, pollTripo, pollImage } from "./providers";
import { ProviderError, billing } from "./provider-http";
import { estimate, budgetLimit, BUDGET_USED_SQL, settle } from "./job-budget";
import type { Project } from "../types";
export async function enqueue(p: Project, user: string, kind: string, target: string, payload: any) {
  const { db } = bindings();
  const id = `${p.id}-${kind}-${target}`;
  const cost = estimate(kind);
  await db.prepare(`INSERT OR IGNORE INTO jobs(id,project,owner,kind,target,status,payload,attempt,updated,reserved,estimated)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${BUDGET_USED_SQL} + ? <= ?`)
    .bind(id,p.id,user,kind,target,"queued",JSON.stringify(payload),1,Date.now(),cost,cost,kind,kind,cost,budgetLimit(kind)).run();
  if (!(await db.prepare("SELECT id FROM jobs WHERE id=? AND owner=?").bind(id,user).first())) throw Error("已达到本地生成预算上限；这不是服务商余额不足。");
}
export async function retryJob(id: string, project: string, user: string, confirmPaid = false) {
  const { db } = bindings();
  const j = await db.prepare("SELECT * FROM jobs WHERE id=? AND project=? AND owner=?").bind(id,project,user).first<any>();
  if (!j || !["failed","paused","uncertain"].includes(j.status)) throw Error("此任务当前不能重试。");
  const result = j.result ? JSON.parse(j.result) : {};
  if (j.provider && !result.terminal) {
    await db.prepare("UPDATE jobs SET status='running',error=NULL,poll_started=?,next_poll=0,poll_failures=0,updated=? WHERE id=? AND status=?")
      .bind(Date.now(),Date.now(),j.id,j.status).run();
    return;
  }
  if (j.status === "uncertain" || (!j.provider && !result.definiteRejection)) throw Error("待核对：无法确认任务是否已创建，禁止再次提交；请核对服务商任务记录。");
  if (!confirmPaid) throw Error(`重新生成预计消耗 ${estimate(j.kind)} 积分，请明确确认后再提交。`);
  if (j.attempt >= 3) throw Error("已达到 3 次提交上限，请先检查输入或服务商原因。");
  const cost = estimate(j.kind);
  const r = await db.prepare(`UPDATE jobs SET status='queued',provider=NULL,attempt=attempt+1,error=NULL,result=NULL,
    updated=?,reserved=?,estimated=?,actual_credits=NULL,billing_details=NULL,settled=0,poll_started=NULL,next_poll=0,poll_failures=0
    WHERE id=? AND status=? AND attempt=? AND ${BUDGET_USED_SQL} + ? <= ?`)
    .bind(Date.now(),cost,cost,j.id,j.status,j.attempt,j.kind,j.kind,cost,budgetLimit(j.kind)).run();
  if (!r.meta.changes) throw Error("任务状态已变更或重新生成将超出本地预算上限。");
}
export async function tick(id: string, user: string) {
  const { db } = bindings();
  const rows = await db.prepare("SELECT * FROM jobs WHERE project=? AND owner=? AND status IN ('queued','running','submitting') ORDER BY updated LIMIT 2")
    .bind(id,user).all<any>();
  for (const j of rows.results) {
    if (j.status === "submitting") {
      if (Date.now() - j.updated > 120000) await db.prepare("UPDATE jobs SET status='uncertain',error=?,updated=? WHERE id=? AND status='submitting'")
        .bind("待核对：提交结果尚未确认。为避免重复扣费，已停止自动提交。",Date.now(),j.id).run();
      continue;
    }
    if (j.status === "queued") {
      const lock = await db.prepare("UPDATE jobs SET status='submitting',updated=? WHERE id=? AND status='queued' AND (SELECT COUNT(*) FROM jobs WHERE status IN ('submitting','running'))<2")
        .bind(Date.now(),j.id).run();
      if (!lock.meta.changes) continue;
      let provider: string | undefined;
      try {
        const payload = JSON.parse(j.payload);
        provider = j.kind === "world" ? await startWorld(payload.image) : j.kind === "furniture" ? await startTripo(payload.image) : await startImage(j.kind,payload);
        await db.prepare("UPDATE jobs SET status='running',provider=?,poll_started=?,next_poll=0,updated=? WHERE id=? AND status='submitting'")
          .bind(provider,Date.now(),Date.now(),j.id).run();
      } catch (e) {
        const err = e as ProviderError;
        const uncertain = !!provider || !!err.uncertain || (!["world","furniture"].includes(j.kind) && !(e instanceof ProviderError));
        const result = { definiteRejection: !uncertain, terminal: false, category: err.category, requestId: err.requestId, code: err.code };
        await db.prepare("UPDATE jobs SET status=?,provider=?,error=?,result=?,reserved=CASE WHEN ? THEN reserved ELSE 0 END,updated=? WHERE id=? AND status='submitting'")
          .bind(uncertain ? "uncertain" : "failed",provider || null,
            err.message + (uncertain ? " 待核对：不会自动重新提交。" : " 尚未创建生成任务。"),JSON.stringify(result),uncertain ? 1 : 0,Date.now(),j.id).run();
      }
      continue;
    }
    if (j.next_poll > Date.now()) continue;
    if (Date.now() - (j.poll_started || j.updated) > (j.kind === "world" ? 10 : 5) * 60000) {
      await db.prepare("UPDATE jobs SET status='paused',error=?,updated=? WHERE id=? AND status='running'")
        .bind("等待超时：任务编号已保留。可继续查询原任务，不会重新生成或再次提交。",Date.now(),j.id).run();
      continue;
    }
    // A short lease prevents overlapping browser ticks from downloading/saving twice.
    const lease = await db.prepare("UPDATE jobs SET next_poll=? WHERE id=? AND status='running' AND next_poll<=?")
      .bind(Date.now()+600000,j.id,Date.now()).run();
    if (!lease.meta.changes) continue;
    try {
      const out = j.kind === "world" ? await pollWorld(j.provider) : j.kind === "furniture" ? await pollTripo(j.provider) : await pollImage(j.kind,j.provider);
      if (!out) {
        await db.prepare("UPDATE jobs SET next_poll=?,poll_failures=0 WHERE id=?").bind(Date.now()+5000,j.id).run();
        continue;
      }
      const charge = billing(j.kind,out);
      if (!j.settled) await settle(j,"success",charge.cost,charge.details);
      const p = await getProject(id,user);
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
          a.splats.spz_urls["500k"] || a.splats.spz_urls.full_res || a.splats.spz_urls["100k"],
          `${p.id}/room/scene.spz`, "spz",
        );
        let collider;
        if (a.mesh?.collider_mesh_url)
          collider = await cacheRemote(
            a.mesh.collider_mesh_url,
            `${p.id}/room/collider.glb`, "glb",
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
          out.output?.model_url,
          `${p.id}/models/${j.target}.glb`, "glb",
        );
        const thumb = out.output?.rendered_image_url
          ? await cacheRemote(
              out.output?.rendered_image_url,
              `${p.id}/models/${j.target}.png`,
            )
          : undefined;
        // The piece may have been put away (undone) while it was generating: keep its model anyway.
        const item = p.items.find((i) => i.id === j.target) ?? p.archived?.find((i) => i.id === j.target);
        if (item) {
          item.model = model;
          item.thumbnail = thumb;
          item.status = item.placeOnReady ? "placed" : "ready";
          delete item.error;
        }
      }
      await saveProject(p,user);
      await db.prepare("UPDATE jobs SET status='done',result=?,error=NULL,updated=?,next_poll=0 WHERE id=?")
        .bind(JSON.stringify({cost:charge.cost,details:charge.details}),Date.now(),j.id).run();
    } catch (e) {
      const err = e as ProviderError;
      const terminal = !!err.terminal;
      if (terminal && !j.settled) await settle(j,err.taskStatus || "failed",err.credits ?? null,{status:err.taskStatus,code:err.code,requestId:err.requestId});
      await db.prepare("UPDATE jobs SET status=?,error=?,result=?,updated=?,next_poll=0,poll_failures=poll_failures+1 WHERE id=?")
        .bind(terminal ? "failed" : "paused",err.message + (terminal ? "" : " 已暂停自动查询，可继续查询原任务；不会重新提交。"),
          JSON.stringify({terminal,category:err.category,requestId:err.requestId,code:err.code,providerStatus:err.taskStatus}),Date.now(),j.id).run();
    }
  }
  return getProject(id,user);
}
