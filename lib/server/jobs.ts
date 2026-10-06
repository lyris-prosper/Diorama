import { bindings, getProject, saveProject, cacheRemote, slimModel } from "./storage";
import { startWorld, startTripo, pollWorld, pollTripo } from "./providers";
import { ProviderError, billing, tripoQuality } from "./provider-http";
import { estimate, budgetLimit, BUDGET_USED_SQL, settle } from "./job-budget";
import type { Project } from "../types";
import { say, both } from "./say";
import { isPublic, quotaCheck, recordSubmission, allowanceLeft, usedUp, siteSpent, type Who } from "./site";
/** Runs a paid submission and, online, records it against the visitor's day in the same batch. */
async function submit(db: D1Database, statement: D1PreparedStatement, kind: "world" | "furniture", who: Who) {
  const results = isPublic() ? await db.batch([statement, recordSubmission(db, kind, who)]) : [await statement.run()];
  return results[0].meta.changes > 0;
}
/** Why a paid submission was turned away: the visitor's day, the site's cap, or the local budget. */
async function refusal(kind: "world" | "furniture", who: Who, local: Error) {
  if (!isPublic()) return local;
  const left = await allowanceLeft(bindings().db, who);
  return (kind === "world" ? left.rooms : left.pieces) === 0 ? usedUp(kind) : siteSpent();
}
const paidKind = (kind: string) => (kind === "world" ? "world" : "furniture");
export async function enqueue(p: Project, who: Who, kind: string, target: string, payload: any) {
  const { db } = bindings();
  const user = who.user;
  const id = `${p.id}-${kind}-${target}`;
  const cost = estimate(kind);
  // Furniture records the settings it is made at (high detail locally, web online), for reuse.
  if (kind === "furniture") payload = { ...payload, quality: tripoQuality() };
  const quota = quotaCheck(paidKind(kind), who);
  await submit(db, db.prepare(`INSERT OR IGNORE INTO jobs(id,project,owner,kind,target,status,payload,attempt,updated,reserved,estimated)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${BUDGET_USED_SQL} + ? <= ? AND ${quota.sql}`)
    .bind(id,p.id,user,kind,target,"queued",JSON.stringify(payload),1,Date.now(),cost,cost,kind,kind,cost,budgetLimit(kind),...quota.args), paidKind(kind), who);
  if (!(await db.prepare("SELECT id FROM jobs WHERE id=? AND owner=?").bind(id,user).first()))
    throw await refusal(paidKind(kind), who, say("已达到本地生成预算上限；这不是服务商余额不足。", "The local generation budget is used up (this is not the provider's balance)."));
}
export async function retryJob(id: string, project: string, who: Who, confirmPaid = false) {
  const { db } = bindings();
  const user = who.user;
  const j = await db.prepare("SELECT * FROM jobs WHERE id=? AND project=? AND owner=?").bind(id,project,user).first<any>();
  if (!j || !["failed","paused","uncertain"].includes(j.status)) throw say("此任务当前不能重试。", "This job can't be retried now.");
  const result = j.result ? JSON.parse(j.result) : {};
  if (j.provider && !result.terminal) {
    await db.prepare("UPDATE jobs SET status='running',error=NULL,poll_started=?,next_poll=0,poll_failures=0,updated=? WHERE id=? AND status=?")
      .bind(Date.now(),Date.now(),j.id,j.status).run();
    return;
  }
  if (j.status === "uncertain" || (!j.provider && !result.definiteRejection)) throw say("待核对：无法确认任务是否已创建，禁止再次提交；请核对服务商任务记录。", "Needs checking: it isn't certain whether the job was created, so it can't be submitted again. Check the provider's job list.");
  if (!confirmPaid) throw say(`重新生成预计消耗 ${estimate(j.kind)} 积分，请明确确认后再提交。`, `Generating again costs about ${estimate(j.kind)} credits. Confirm before submitting.`);
  if (j.attempt >= 3) throw say("已达到 3 次提交上限，请先检查输入或服务商原因。", "This job has been submitted 3 times, the limit. Check the input or the provider first.");
  const cost = estimate(j.kind);
  const quota = quotaCheck(paidKind(j.kind), who);
  const changed = await submit(db, db.prepare(`UPDATE jobs SET status='queued',provider=NULL,attempt=attempt+1,error=NULL,result=NULL,
    updated=?,reserved=?,estimated=?,actual_credits=NULL,billing_details=NULL,settled=0,poll_started=NULL,next_poll=0,poll_failures=0
    WHERE id=? AND status=? AND attempt=? AND ${BUDGET_USED_SQL} + ? <= ? AND ${quota.sql}`)
    .bind(Date.now(),cost,cost,j.id,j.status,j.attempt,j.kind,j.kind,cost,budgetLimit(j.kind),...quota.args), paidKind(j.kind), who);
  if (!changed) throw await refusal(paidKind(j.kind), who, say("任务状态已变更或重新生成将超出本地预算上限。", "The job changed meanwhile, or generating again would exceed the local budget."));
}
/**
 * Makes a finished piece again at the current (high-detail) settings, from the same photo: the job
 * goes back in the queue as a new attempt (its earlier charge stays on record). The piece keeps
 * its old model until the new one is ready.
 */
export async function regenerateJob(project: string, item: string, user: string) {
  // High detail needs the local model optimizer: it is made on the Mac version only.
  if (isPublic()) throw say("在线版不提供高精度重新生成。", "The online version doesn't regenerate in high detail.");
  const { db } = bindings();
  const id = `${project}-furniture-${item}`;
  const j = await db.prepare("SELECT id,status,payload,attempt FROM jobs WHERE id=? AND owner=?").bind(id,user).first<{ id: string; status: string; payload: string; attempt: number }>();
  if (!j) throw say("找不到这件家具的生成记录（复用来的模型不能重新生成）。", "There's no generation record for this piece (a reused model can't be regenerated).");
  if (!["done","failed"].includes(j.status)) throw say("这件家具正在生成，请等它完成。", "This piece is still being generated. Wait for it to finish.");
  const payload = { ...JSON.parse(j.payload), quality: tripoQuality() };
  const cost = estimate("furniture");
  const r = await db.prepare(`UPDATE jobs SET status='queued',provider=NULL,attempt=attempt+1,error=NULL,result=NULL,payload=?,
    updated=?,reserved=?,estimated=?,actual_credits=NULL,billing_details=NULL,settled=0,poll_started=NULL,next_poll=0,poll_failures=0
    WHERE id=? AND status=? AND attempt=? AND ${BUDGET_USED_SQL} + ? <= ?`)
    .bind(JSON.stringify(payload),Date.now(),cost,cost,j.id,j.status,j.attempt,"furniture","furniture",cost,budgetLimit("furniture")).run();
  if (!r.meta.changes) throw say("任务状态已变更，或重新生成将超出本地预算上限。", "The job changed meanwhile, or generating again would exceed the local budget.");
}
export async function tick(id: string, user: string) {
  const { db } = bindings();
  const rows = await db.prepare("SELECT * FROM jobs WHERE project=? AND owner=? AND status IN ('queued','running','submitting') ORDER BY updated LIMIT 2")
    .bind(id,user).all<any>();
  for (const j of rows.results) {
    if (j.status === "submitting") {
      if (Date.now() - j.updated > 120000) await db.prepare("UPDATE jobs SET status='uncertain',error=?,result=json_set(COALESCE(result,'{}'),'$.errorEn',?),updated=? WHERE id=? AND status='submitting'")
        .bind("待核对：提交结果尚未确认。为避免重复扣费，已停止自动提交。","Needs checking: the submission wasn't confirmed. To avoid paying twice, it won't be submitted automatically.",Date.now(),j.id).run();
      continue;
    }
    if (j.status === "queued") {
      const lock = await db.prepare("UPDATE jobs SET status='submitting',updated=? WHERE id=? AND status='queued' AND (SELECT COUNT(*) FROM jobs WHERE status IN ('submitting','running'))<2")
        .bind(Date.now(),j.id).run();
      if (!lock.meta.changes) continue;
      let provider: string | undefined;
      try {
        const payload = JSON.parse(j.payload);
        provider = j.kind === "world" ? await startWorld(payload.image) : await startTripo(payload.image);
        await db.prepare("UPDATE jobs SET status='running',provider=?,poll_started=?,next_poll=0,updated=? WHERE id=? AND status='submitting'")
          .bind(provider,Date.now(),Date.now(),j.id).run();
      } catch (e) {
        const err = e as ProviderError;
        const uncertain = !!provider || !!err.uncertain;
        const said = both(err);
        const result = { definiteRejection: !uncertain, terminal: false, category: err.category, requestId: err.requestId, code: err.code,
          errorEn: said.en + (uncertain ? " Needs checking: it won't be resubmitted automatically." : " No generation job was created.") };
        await db.prepare("UPDATE jobs SET status=?,provider=?,error=?,result=?,reserved=CASE WHEN ? THEN reserved ELSE 0 END,updated=? WHERE id=? AND status='submitting'")
          .bind(uncertain ? "uncertain" : "failed",provider || null,
            err.message + (uncertain ? " 待核对：不会自动重新提交。" : " 尚未创建生成任务。"),JSON.stringify(result),uncertain ? 1 : 0,Date.now(),j.id).run();
      }
      continue;
    }
    if (j.next_poll > Date.now()) continue;
    // High-detail furniture (8K textures, detailed geometry) takes Tripo several minutes.
    if (Date.now() - (j.poll_started || j.updated) > (j.kind === "world" ? 10 : 15) * 60000) {
      await db.prepare("UPDATE jobs SET status='paused',error=?,result=json_set(COALESCE(result,'{}'),'$.errorEn',?),updated=? WHERE id=? AND status='running'")
        .bind("等待超时：任务编号已保留。可继续查询原任务，不会重新生成或再次提交。","Timed out waiting. The job number is kept: keep checking the original job; nothing is generated or submitted again.",Date.now(),j.id).run();
      continue;
    }
    // A short lease prevents overlapping browser ticks from downloading/saving twice.
    const lease = await db.prepare("UPDATE jobs SET next_poll=? WHERE id=? AND status='running' AND next_poll<=?")
      .bind(Date.now()+600000,j.id,Date.now()).run();
    if (!lease.meta.changes) continue;
    try {
      const out = j.kind === "world" ? await pollWorld(j.provider) : await pollTripo(j.provider);
      if (!out) {
        await db.prepare("UPDATE jobs SET next_poll=?,poll_failures=0 WHERE id=?").bind(Date.now()+5000,j.id).run();
        continue;
      }
      const charge = billing(j.kind,out);
      if (!j.settled) await settle(j,"success",charge.cost,charge.details);
      const p = await getProject(id,user);
      if (j.kind === "world") {
        const a = out.assets;
        if (!a?.splats?.spz_urls) throw say("服务没有返回可加载的空间资产。", "The provider returned no room files that can be loaded.");
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
        // The piece may have been put away (undone) while it was generating: keep its model anyway.
        const item = p.items.find((i) => i.id === j.target) ?? p.archived?.find((i) => i.id === j.target);
        const payload = JSON.parse(j.payload);
        // The PBR model when Tripo made one. A high-detail model gets its own file name, so a
        // regenerated piece never shows the old file from the browser's cache.
        const source = out.output?.pbr_model_url ?? out.output?.pbr_model ?? out.output?.model_url;
        const suffix = payload.quality ? `-${payload.quality}` : "";
        // The room loads a slimmed copy (fewer triangles, WebP textures); the download is kept as it came.
        const model = await slimModel(
          await cacheRemote(source, `${p.id}/models/${j.target}${suffix}.glb`, "glb"),
          item?.dims ? Math.max(item.dims.w, item.dims.d, item.dims.h) : undefined,
        );
        const thumb = out.output?.rendered_image_url
          ? await cacheRemote(
              out.output?.rendered_image_url,
              `${p.id}/models/${j.target}${suffix}.png`,
            )
          : undefined;
        if (item) {
          item.model = model;
          item.thumbnail = thumb;
          // A regenerated piece stays where it was placed.
          item.status = item.placeOnReady || item.status === "placed" ? "placed" : "ready";
          delete item.error;
        }
      }
      await saveProject(p,user);
      // Which outputs the provider sent (names only), to see what a model came with.
      await db.prepare("UPDATE jobs SET status='done',result=?,error=NULL,updated=?,next_poll=0 WHERE id=?")
        .bind(JSON.stringify({cost:charge.cost,details:charge.details,outputs:Object.keys(out.output ?? out.assets ?? {})}),Date.now(),j.id).run();
    } catch (e) {
      const err = e as ProviderError;
      const terminal = !!err.terminal;
      if (terminal && !j.settled) await settle(j,err.taskStatus || "failed",err.credits ?? null,{status:err.taskStatus,code:err.code,requestId:err.requestId});
      await db.prepare("UPDATE jobs SET status=?,error=?,result=?,updated=?,next_poll=0,poll_failures=poll_failures+1 WHERE id=?")
        .bind(terminal ? "failed" : "paused",err.message + (terminal ? "" : " 已暂停自动查询，可继续查询原任务；不会重新提交。"),
          JSON.stringify({terminal,category:err.category,requestId:err.requestId,code:err.code,providerStatus:err.taskStatus,
            errorEn:both(err).en + (terminal ? "" : " Automatic checking paused: you can keep checking the original job; it won't be resubmitted.")}),Date.now(),j.id).run();
    }
  }
  return getProject(id,user);
}
