import { bindings, owner, getProject, saveProject, cacheRemote, slimModel } from "@/lib/server/storage";
import { balances, parseIntent, readWorld, parseMarbleSource } from "@/lib/server/providers";
import { enqueue, tick, retryJob } from "@/lib/server/jobs";
import { WORLD_ESTIMATE, TRIPO_ESTIMATE } from "@/lib/server/provider-http";
import { budgetSummary } from "@/lib/server/job-budget";
import { setFurnitureInput, addFurniture, addCatalogItem } from "@/lib/server/furniture";
import { emptyProject, MAX_ITEMS, type Project } from "@/lib/types";
// Download a Marble world named by a viewer link, embed code, world link or ID into this project.
// Same account as our API key: the API also gives the collider mesh and any metric scale.
async function downloadMarble(projectId: string, source: string) {
  const { full, light, worldId } = parseMarbleSource(source);
  if (!full && !light && !worldId)
    throw Error("没有识别出 Marble 房间。请粘贴 Marble 的查看器链接或嵌入代码（里面带有 splatUrl），或世界页面链接。");
  const world = worldId ? await readWorld(worldId) : null;
  const urls = world?.assets?.splats?.spz_urls ?? {};
  const fullUrl = full ?? urls.full_res;
  const lightUrl = light ?? urls["500k"] ?? urls["100k"];
  if (!fullUrl && !lightUrl)
    throw Error("这个房间不属于当前 API 账号，读取不到文件地址。请在 Marble 里点“分享 / 嵌入”，复制嵌入代码粘贴过来。");
  const stamp = Date.now().toString(36);
  const lightKey = lightUrl ? await cacheRemote(lightUrl, `${projectId}/room/import-${stamp}.spz`, "spz") : undefined;
  const fullKey = fullUrl ? await cacheRemote(fullUrl, `${projectId}/room/import-${stamp}-full.spz`, "spz") : undefined;
  const colliderUrl = world?.assets?.mesh?.collider_mesh_url;
  const collider = colliderUrl ? await cacheRemote(colliderUrl, `${projectId}/room/import-${stamp}-collider.glb`, "glb").catch(() => undefined) : undefined;
  return { lightKey, fullKey, collider, s: world?.assets?.splats?.semantics_metadata };
}
export async function GET(req: Request) {
  try {
    const user = owner(req);
    const q = new URL(req.url).searchParams;
    if (q.has("capabilities")) return Response.json({ localRecognition: true, imageRepair: !!(bindings().secrets.FAL_KEY || process.env.FAL_KEY), world: !!(bindings().secrets.WORLDLABS_API_KEY || process.env.WORLDLABS_API_KEY), furniture: !!(bindings().secrets.TRIPO_API_KEY || process.env.TRIPO_API_KEY) });
    if (q.has("budgets")) return Response.json({world: await budgetSummary("world"), furniture: await budgetSummary("furniture")});
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
    if(b.action === "revise") {
      if(!["branch","confirm","review"].includes(p.stage))throw Error("请等待当前任务结束。");
      p.stage="confirm";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "save") {
      const items = b.items;
      if (
        !Array.isArray(items) ||
        items.length > MAX_ITEMS ||
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
          height: Math.max(0.01, Math.min(5, Number(i.height) || 1)),
        }));
      if (b.floor)
        p.floor = {
          height: Math.max(-10, Math.min(10, Number(b.floor.height) || 0)),
          size: Math.max(2, Math.min(20, Number(b.floor.size) || 6)),
          confirmed: !!b.floor.confirmed,
        };
      // Metric scale estimated in the browser from the room's floor and ceiling.
      if (p.room && b.roomScale !== undefined) {
        const k = Number(b.roomScale);
        if (!Number.isFinite(k) || k < 0.05 || k > 20) throw Error("房间比例无效。");
        p.room.scale = k;
      }
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "set-print") {
      const print = String(b.print ?? "");
      if (!/^[0-9a-f]{16}$/.test(print)) throw Error("照片指纹无效。");
      p.photoPrint = print;
      // The same photo (re-saved or re-compressed included) already has a room in another project:
      // reuse it rather than generating and paying again. Erasures belong to that project's edits.
      if (p.mode === "real" && !p.room) {
        // Hamming distance between two 64-bit hex prints, 4 bits at a time.
        const distance = (a: string, c: string) => {
          let n = 0;
          for (let i = 0; i < 16; i++) {
            let x = parseInt(a[i], 16) ^ parseInt(c[i], 16);
            for (; x; x &= x - 1) n++;
          }
          return n;
        };
        const rows = await db
          .prepare("SELECT data FROM projects WHERE owner=? AND id<>? ORDER BY updated DESC LIMIT 50")
          .bind(user, p.id)
          .all<{ data: string }>();
        const source = rows.results
          .map((r) => JSON.parse(r.data) as Project)
          .find((o) => o.room && o.photoPrint && distance(o.photoPrint, print) <= 8);
        if (source?.room) {
          p.room = { ...source.room, erasures: [] };
          p.floor = { ...source.floor };
          p.stage = "ready";
        }
      }
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "edit-furniture") {
      if (p.mode !== "real" || !p.room) throw Error("请先打开一个 3D 房间。");
      const photo = String(b.photo ?? "");
      if (!photo.startsWith(p.id + "/uploads/furniture-photo-") || !(await bindings().bucket.head(photo)))
        throw Error("请先上传这件家具的照片。");
      const name = String(b.name ?? "").trim().slice(0, 24);
      if (!name) throw Error("请填写家具名称。");
      const kind = ["bed", "desk", "cabinet", "chair", "sofa", "other"].includes(b.kind) ? b.kind : "other";
      const dims = { w: Number(b.dims?.w), d: Number(b.dims?.d), h: Number(b.dims?.h) };
      if (Object.values(dims).some((v) => !Number.isFinite(v) || v < 5 || v > 400)) throw Error("尺寸请填写 5–400 厘米之间的数字。");
      const e = b.erase ?? {};
      const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
      if (
        !Array.isArray(e.center) || e.center.length !== 3 || !e.center.every((v: unknown) => finite(v, -50, 50)) ||
        !Array.isArray(e.size) || e.size.length !== 3 || !e.size.every((v: unknown) => finite(v, 0.05, 10)) ||
        !finite(e.rotation, -100, 100)
      )
        throw Error("擦除范围无效，请重新框选。");
      if ((p.room.erasures?.length ?? 0) >= 30) throw Error("这个房间已擦除太多家具。");
      const id = crypto.randomUUID();
      // Reserve credits first: when the budget is exceeded nothing is saved.
      await enqueue(p, user, "furniture", id, { image: photo });
      p.items.push({
        id, name, kind, status: "queued",
        position: [e.center[0], p.floor.height, e.center[2]],
        rotation: e.rotation, scale: 1, height: dims.h / 100, dims, placeOnReady: true,
      });
      p.room.erasures = [...(p.room.erasures ?? []), { id, item: id, center: e.center, size: e.size, rotation: e.rotation }];
      await saveProject(p, user);
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "set-furniture-input")
      return Response.json(await saveProject(await setFurnitureInput(p, b), user));
    if (b.action === "add-furniture") {
      const { note, added } = await addFurniture(p, user, b);
      await saveProject(p, user);
      return Response.json({ ...(await getProject(p.id, user)), note, added });
    }
    if (b.action === "add-catalog-item") {
      const item = await addCatalogItem(p, b);
      return Response.json({ ...(await saveProject(p, user)), added: item.id });
    }
    if (b.action === "optimize-models") {
      // Models generated before slimming existed (a 42 MB bed) get their light copy; originals stay.
      for (const i of [...p.items, ...(p.archived ?? [])])
        if (i.model && !i.model.startsWith("/") && !i.model.endsWith(".lite.glb"))
          i.model = await slimModel(i.model, i.dims ? Math.max(i.dims.w, i.dims.d, i.dims.h) : undefined);
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "update-erasure") {
      const e = b.erasure ?? {};
      const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
      const list = p.room?.erasures ?? [];
      const i = list.findIndex((x) => x.id === e.id);
      if (
        i < 0 ||
        !Array.isArray(e.center) || e.center.length !== 3 || !e.center.every((v: unknown) => finite(v, -50, 50)) ||
        !Array.isArray(e.size) || e.size.length !== 3 || !e.size.every((v: unknown) => finite(v, 0.05, 10)) ||
        !finite(e.rotation, -100, 100)
      )
        throw Error("擦除范围无效，请重新调整。");
      list[i] = { ...list[i], center: e.center, size: e.size, rotation: e.rotation };
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "import-clean-world") {
      if (p.mode !== "real" || !p.room) throw Error("请先打开一个 3D 房间。");
      const { lightKey, fullKey } = await downloadMarble(p.id, String(b.source ?? ""));
      p.room.clean = { splat: (lightKey ?? fullKey)!, splatFull: fullKey, scale: 1, shift: [0, 0, 0], aligned: false };
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "align-clean") {
      const c = p.room?.clean;
      if (!c) throw Error("还没有空房间底图。");
      const ok = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
      if (!ok(b.scale, 0.05, 20) || !ok(b.yaw ?? 0, -Math.PI, Math.PI) || !Array.isArray(b.shift) || b.shift.length !== 3 || !b.shift.every((v: unknown) => ok(v, -10, 10)))
        throw Error("底图对齐数据无效。");
      c.scale = b.scale;
      c.yaw = b.yaw ?? 0;
      c.shift = b.shift;
      c.aligned = true;
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "import-world") {
      if (p.mode !== "real") throw Error("示例房间不能导入。");
      if (p.tasks.some((t) => ["queued", "running", "submitting"].includes(t.status)))
        throw Error("还有任务在处理，请等它完成后再导入。");
      const got = await downloadMarble(p.id, String(b.source ?? ""));
      const { lightKey, fullKey, collider, s } = got;
      p.room = {
        splat: (lightKey ?? fullKey)!,
        splatFull: fullKey,
        collider,
        scale: s?.metric_scale_factor || 1,
        offset: s?.ground_plane_offset || 0,
        source: "imported",
      };
      p.floor = { height: 0, size: 6, confirmed: false };
      p.stage = "ready";
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "recognize") {
      if (p.mode !== "real" || !p.original || b.original !== p.original)
        throw Error("照片已更换，请重新识别。");
      if (!["branch", "confirm", "detecting"].includes(p.stage) || p.tasks.some(t => ["running", "queued", "submitting"].includes(t.status)))
        throw Error("当前空间正在处理中，请等待处理完成。");
      if (!Array.isArray(b.candidates) || b.candidates.length > 15)
        throw Error("识别结果格式有误。");
      const candidates = [];
      for (const c of b.candidates) {
        if (!["bed", "desk", "chair", "sofa", "cabinet"].includes(c.kind) ||
            typeof c.name !== "string" || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 ||
            !Array.isArray(c.box) || c.box.length !== 4 || c.box.some((v: unknown) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) ||
            c.box[0] >= c.box[2] || c.box[1] >= c.box[3] ||
            typeof c.mask !== "string" || !c.mask.startsWith(p.id + "/uploads/auto-mask-"))
          throw Error("识别轮廓无效，请重新识别。");
        if (!(await bindings().bucket.head(c.mask))) throw Error("识别轮廓未保存，请重试。");
        candidates.push({id:crypto.randomUUID(), name:c.name.slice(0,30), kind:c.kind, mask:c.mask,
          box:c.box, score:c.score, selected:false, source:"local-detr" as const, needsReview:!!c.needsReview || c.kind === "cabinet"});
      }
      p.candidates = [...p.candidates.filter(c => c.source === "manual"), ...candidates];
      p.recognitionComplete = true;
      if (p.stage === "detecting") p.stage = "branch";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "correct-candidate") {
      if (!["branch","confirm"].includes(p.stage)) throw Error("当前阶段不能修改识别结果。");
      const names: Record<string,string> = {bed:"床",desk:"桌子",cabinet:"柜子",chair:"椅子",sofa:"沙发"};
      const candidate=p.candidates.find(c=>c.id===b.candidate);
      if (!candidate || !names[b.kind]) throw Error("请选择有效家具类别。");
      candidate.kind=b.kind; candidate.name=names[b.kind]; candidate.needsReview=b.kind==="cabinet";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "select-candidates") {
      if (p.mode !== "real" || !["branch", "confirm"].includes(p.stage)) throw Error("请先上传并识别照片。");
      if (!["remove", "edit"].includes(b.branch)) throw Error("请选择处理方式。");
      const ids = Array.isArray(b.selected) ? b.selected : [];
      const intent = String(b.intent || "").trim().slice(0,500);
      let selected = p.candidates.filter(c => ids.includes(c.id));
      if (!selected.length && intent) {
        const kinds = parseIntent(intent).map(c=>c.kind);
        selected = p.candidates.filter(c=>kinds.includes(c.kind));
        // Relative directions can narrow candidates, but do not imply spatial certainty.
        if (/左|left/i.test(intent)) selected=selected.filter(c=>c.source!=="local-detr" || (c.box[0]+c.box[2])/2 < 0.5);
        if (/右|right/i.test(intent)) selected=selected.filter(c=>c.source!=="local-detr" || (c.box[0]+c.box[2])/2 >= 0.5);
      }
      if (!selected.length) throw Error(intent ? "没有找到对应家具，可以点击照片中的轮廓，或补充手动圈选。" : "请选择具体家具，或填写描述；空输入不会处理全部家具。");
      p.branch=b.branch; p.intent=intent;
      p.candidates=p.candidates.map(c=>({...c, selected:selected.some(v=>v.id===c.id)}));
      p.stage="confirm";
      return Response.json(await saveProject(p,user));
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
        selected: true,
        source: "manual",
      });
      p.stage = "confirm";
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "prepare") {
      if (p.mode !== "real" || !["remove", "edit"].includes(p.branch))
        throw Error("无效流程。");
      const localPrepared = typeof b.localBackground === "string" && ["localhost","127.0.0.1"].includes(new URL(req.url).hostname);
      if (!localPrepared && !(secrets.FAL_KEY || process.env.FAL_KEY))
        throw Error(
          "背景修复服务尚未配置：需要后端 FAL_KEY。原图与选择已保留，未调用 World Labs 或 Tripo。",
        );
      if (b.original && b.original !== p.original) throw Error("照片已更换，请重新处理。");
      if (!["confirm","branch","review"].includes(p.stage)) throw Error("当前阶段无法重新处理图片。");
      const selected = p.candidates.filter((c) => b.selected?.includes(c.id));
      if (!selected.length) throw Error("至少确认一件家具，或选择无需处理。");
      if (!b.mask?.startsWith(p.id + "/uploads/"))
        throw Error("缺少像素掩膜。");
      if (!(await bindings().bucket.head(b.mask))) throw Error("轮廓未保存，请重试。");
      if(localPrepared && (!b.localBackground.startsWith(p.id + "/uploads/local-background-") || !(await bindings().bucket.head(b.localBackground))))
        throw Error("本地修复图片无效。");
      p.candidates = p.candidates.map((c) => ({
        ...c,
        selected: b.selected.includes(c.id),
      }));
      if (
        p.mask === b.mask &&
        p.rawBackground && !localPrepared &&
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
      if(localPrepared){
        p.rawBackground=b.localBackground;
        p.stage="review";
        return Response.json(await saveProject(p,user));
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
            .map((c) => {
              const dims = p.furnitureDims?.[c.id];
              return {
                id: c.id,
                name: c.name,
                kind: c.kind,
                status: "queued",
                position: [0, 0, 0],
                rotation: 0,
                scale: 1,
                height: dims ? dims.h / 100 : c.kind === "bed" ? 0.86 : c.kind === "cabinet" ? 2.1 : 0.76,
                ...(dims ? { dims } : {}),
                source: "photo",
              };
            });
      }
      const bal = await balances();
      if (bal.world.error || !Number.isFinite(bal.world.remaining_credits) || bal.world.remaining_credits < WORLD_ESTIMATE)
        throw Error(bal.world.error || "World Labs 可用积分不足。");
      if (
        p.items.length &&
        (bal.tripo.error ||
          !Number.isFinite(bal.tripo.data?.balance) || bal.tripo.data.balance < TRIPO_ESTIMATE * p.items.length)
      )
        throw Error(bal.tripo.error || "Tripo 可用积分不足。");
      p.stage = "generating";
      await saveProject(p, user);
      await enqueue(p, user, "world", "room", { image: p.background });
      if (p.branch === "edit")
        for (const i of p.items)
          // A clean product photo, when the user gave one, models better than the cut-out.
          await enqueue(p, user, "furniture", i.id, {
            image: p.productPhotos?.[i.id] ?? p.cutouts![i.id],
          });
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "tick") return Response.json(await tick(p.id, user));
    if (b.action === "retry") {
      await retryJob(b.task, p.id, user, b.confirmPaid === true);
      return Response.json(await getProject(p.id, user));
    }
    throw Error("未知操作");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
