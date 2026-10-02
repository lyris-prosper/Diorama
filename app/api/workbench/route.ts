import { bindings, owner, getProject, saveProject } from "@/lib/server/storage";
import { balances, parseIntent } from "@/lib/server/providers";
import { enqueue, tick } from "@/lib/server/jobs";
import { emptyProject } from "@/lib/types";
export async function GET(req: Request) {
  try {
    const user = owner(req);
    const q = new URL(req.url).searchParams;
    if (q.has("services")) return Response.json(await balances());
    if (q.has("id")) return Response.json(await getProject(q.get("id")!, user));
    const row = await bindings()
      .db.prepare(
        "SELECT id FROM projects WHERE owner=? ORDER BY updated DESC LIMIT 1",
      )
      .bind(user)
      .first<{ id: string }>();
    return Response.json(row ? await getProject(row.id, user) : null);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
export async function POST(req: Request) {
  try {
    const user = owner(req);
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host)
      throw Error("请求来源不被允许。");
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const f = await req.formData();
      const id = String(f.get("id"));
      const p = await getProject(id, user);
      const file = f.get("file") as File;
      const role = String(f.get("role"));
      if (
        !file ||
        file.size > 10 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw Error("请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。");
      if (!/^[a-zA-Z0-9_-]{1,90}$/.test(role)) throw Error("无效资源名。");
      const data = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
      const key = `${id}/uploads/${role}-${hash}.png`;
      await bindings().bucket.put(key, data, {
        httpMetadata: { contentType: file.type },
      });
      if (role === "original") {
        p.original = key;
        p.stage = "branch";
        await saveProject(p, user);
      }
      return Response.json({ key, project: p });
    }
    const b = (await req.json()) as any;
    const { db, secrets } = bindings();
    if (b.action === "create") {
      const p = emptyProject(
        crypto.randomUUID(),
        b.mode === "demo" ? "demo" : "real",
      );
      await db
        .prepare(
          "INSERT INTO projects(id,owner,data,updated,revision) VALUES(?,?,?,?,0)",
        )
        .bind(p.id, user, JSON.stringify(p), Date.now())
        .run();
      return Response.json(p);
    }
    const p = await getProject(b.id, user);
    if (b.action === "save") {
      const items = b.items;
      if (
        !Array.isArray(items) ||
        items.length > 25 ||
        items.some(
          (i: any) =>
            !Array.isArray(i.position) ||
            i.position.length !== 3 ||
            i.position.some(
              (v: any) => typeof v !== "number" || !Number.isFinite(v),
            ),
        )
      )
        throw Error("无效布局");
      const known = new Map(
        [...p.items, ...(p.archived || [])].map((i) => [i.id, i]),
      );
      p.archived = [...known.values()].filter(
        (i) => !items.some((v: any) => v.id === i.id),
      );
      p.items = items
        .filter((i: any) => known.has(i.id))
        .map((i: any) => ({
          ...known.get(i.id)!,
          status:
            known.get(i.id)!.status === "queued" ||
            known.get(i.id)!.status === "running"
              ? known.get(i.id)!.status
              : i.status === "placed"
                ? "placed"
                : "ready",
          position: i.position.map((v: number) =>
            Number.isFinite(v) ? Math.max(-50, Math.min(50, v)) : 0,
          ),
          rotation: Number(i.rotation) || 0,
          scale: Math.max(0.1, Math.min(5, Number(i.scale) || 1)),
          height: Math.max(0.1, Math.min(5, Number(i.height) || 1)),
        }));
      if (b.floor)
        p.floor = {
          height: Math.max(-10, Math.min(10, Number(b.floor.height) || 0)),
          size: Math.max(2, Math.min(20, Number(b.floor.size) || 6)),
          confirmed: !!b.floor.confirmed,
        };
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "detect") {
      if (p.mode === "demo") throw Error("示例模式不进行图片识别。");
      if (!p.original) throw Error("请先上传照片。");
      const cats = parseIntent(b.intent);
      if (!(secrets.FAL_KEY || process.env.FAL_KEY))
        throw Error(
          "识别服务尚未配置：需要后端 FAL_KEY。可先使用手动圈选，或体验示例房间；没有启动付费任务。",
        );
      if (
        await db
          .prepare(
            "SELECT id FROM jobs WHERE project=? AND status IN ('running','queued','submitting')",
          )
          .bind(p.id)
          .first()
      )
        throw Error("请等待当前任务结束。");
      p.branch = b.branch === "remove" ? "remove" : "edit";
      p.intent = String(b.intent).slice(0, 500);
      p.candidates = [];
      p.stage = "detecting";
      await saveProject(p, user);
      for (const c of cats)
        await enqueue(
          p,
          user,
          "detect",
          c.kind + "-" + crypto.randomUUID().slice(0, 8),
          { image: p.original, ...c },
        );
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "manual") {
      if (!p.original || !b.mask?.startsWith(p.id + "/uploads/"))
        throw Error("请先圈选对象。");
      if (!["remove", "edit"].includes(b.branch))
        throw Error("请先选择处理方式。");
      p.branch = b.branch;
      p.intent = String(b.intent || "手动圈选");
      p.candidates.push({
        id: crypto.randomUUID(),
        name: String(b.name || "手动家具").slice(0, 30),
        kind: parseIntent(String(b.name))[0].kind,
        mask: b.mask,
        box: [0.5, 0.5, 1, 1],
        score: 1,
        selected: false,
        source: "manual",
      });
      p.stage = "confirm";
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "prepare") {
      if (p.mode !== "real" || !["remove", "edit"].includes(p.branch))
        throw Error("无效流程。");
      if (!(secrets.FAL_KEY || process.env.FAL_KEY))
        throw Error(
          "背景修复服务尚未配置：需要后端 FAL_KEY。原图与选择已保留，未调用 World Labs 或 Tripo。",
        );
      const selected = p.candidates.filter((c) => b.selected?.includes(c.id));
      if (!selected.length) throw Error("至少确认一件家具，或选择无需处理。");
      if (!b.mask?.startsWith(p.id + "/uploads/"))
        throw Error("缺少像素掩膜。");
      p.candidates = p.candidates.map((c) => ({
        ...c,
        selected: b.selected.includes(c.id),
      }));
      if (
        p.mask === b.mask &&
        p.rawBackground &&
        JSON.stringify(
          p.candidates.filter((c) => c.selected).map((c) => c.id),
        ) === JSON.stringify(b.selected)
      ) {
        p.stage = "review";
        return Response.json(await saveProject(p, user));
      }
      p.mask = b.mask;
      p.cutouts = {};
      p.originalCrops = {};
      if (p.branch === "edit")
        for (const c of selected) {
          const key = b.cutouts?.[c.id];
          if (!key?.startsWith(p.id + "/uploads/"))
            throw Error("缺少单件家具图。");
          p.cutouts[c.id] = key;
          if (b.originalCrops?.[c.id]?.startsWith(p.id + "/uploads/"))
            p.originalCrops[c.id] = b.originalCrops[c.id];
        }
      p.stage = "processing";
      await saveProject(p, user);
      await enqueue(p, user, "erase", p.mask!.split("-").pop()!.slice(0, 24), {
        image: p.original,
        mask: p.mask,
      });
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "generate") {
      if (!p.original) throw Error("请先上传房间照片。");
      if (p.room) return Response.json(p);
      if (p.mode === "demo") throw Error("示例模式不调用生成服务。");
      if (b.skip) {
        if (p.stage === "processing") throw Error("请等待图片处理完成。");
        p.branch = "none";
        p.background = p.original;
        p.items = [];
      } else {
        if (
          p.stage !== "review" ||
          !b.approved ||
          !b.background?.startsWith(p.id + "/uploads/")
        )
          throw Error("请先检查处理后图片，再确认生成。");
        p.background = b.background;
        if (p.branch === "edit")
          p.items = p.candidates
            .filter((c) => c.selected)
            .map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              status: "queued",
              position: [0, 0, 0],
              rotation: 0,
              scale: 1,
              height:
                c.kind === "bed" ? 0.86 : c.kind === "cabinet" ? 2.1 : 0.76,
            }));
      }
      const bal = await balances();
      if (bal.world.error || Number(bal.world.remaining_credits) < 250)
        throw Error(bal.world.error || "World Labs 可用积分不足。");
      if (
        p.items.length &&
        (bal.tripo.error ||
          Number(bal.tripo.data?.balance) < 100 * p.items.length)
      )
        throw Error(bal.tripo.error || "Tripo 可用积分不足。");
      p.stage = "generating";
      await saveProject(p, user);
      await enqueue(p, user, "world", "room", { image: p.background });
      if (p.branch === "edit")
        for (const i of p.items)
          await enqueue(p, user, "furniture", i.id, {
            image: p.cutouts![i.id],
          });
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "tick") return Response.json(await tick(p.id, user));
    if (b.action === "retry") {
      const j = await db
        .prepare("SELECT * FROM jobs WHERE id=? AND project=? AND owner=?")
        .bind(b.task, p.id, user)
        .first<any>();
      if (!j || j.status !== "failed" || j.attempt >= 3)
        throw Error("此任务无法自动重试，请核对服务商记录。");
      const terminal = j.result && JSON.parse(j.result).terminal;
      if (terminal) {
        const limit =
          j.kind === "world"
            ? Math.min(7000, Number(secrets.WORLDLABS_CREDIT_LIMIT || 6770))
            : 5000;
        const cost =
          j.kind === "world" ? 250 : j.kind === "furniture" ? 100 : 0;
        const r = await db
          .prepare(
            "UPDATE jobs SET status='queued',provider=NULL,attempt=attempt+1,error=NULL,updated=?,reserved=reserved+? WHERE id=? AND (SELECT COALESCE(SUM(reserved),0) FROM jobs WHERE kind=?)+?<=?",
          )
          .bind(Date.now(), cost, j.id, j.kind, cost, limit)
          .run();
        if (!r.meta.changes) throw Error("重试将超出预算上限。");
      } else
        await db
          .prepare(
            "UPDATE jobs SET status=?,attempt=attempt+1,error=NULL,updated=? WHERE id=?",
          )
          .bind(j.provider ? "running" : "queued", Date.now(), j.id)
          .run();
      return Response.json(await getProject(p.id, user));
    }
    throw Error("未知操作");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
