import { bindings, owner, getProject, saveProject, cacheRemote, slimModel } from "@/lib/server/storage";
import { balances, parseIntent, readWorld, parseMarbleSource } from "@/lib/server/providers";
import { enqueue, tick, retryJob } from "@/lib/server/jobs";
import { WORLD_ESTIMATE, TRIPO_ESTIMATE } from "@/lib/server/provider-http";
import { budgetSummary } from "@/lib/server/job-budget";
import { setFurnitureInput, addFurniture, addCatalogItem } from "@/lib/server/furniture";
import { emptyProject, MAX_ITEMS, type Project } from "@/lib/types";
import { say, langOf, spoken } from "@/lib/server/say";
import { ensureDemoFiles, applyDemoRoom, reusableModel } from "@/lib/server/demo";
import { DEMO_ROOM, isDemoPhoto, isDefaultName, printDistance } from "@/lib/demo-room";
// Download a Marble world named by a viewer link, embed code, world link or ID into this project.
// Same account as our API key: the API also gives the collider mesh and any metric scale.
async function downloadMarble(projectId: string, source: string) {
  const { full, light, worldId } = parseMarbleSource(source);
  if (!full && !light && !worldId)
    throw say("没有识别出 Marble 房间。请粘贴 Marble 的查看器链接或嵌入代码（里面带有 splatUrl），或世界页面链接。", "No Marble room found in that text. Paste a Marble viewer link or embed code (it contains splatUrl), or a world page link.");
  const world = worldId ? await readWorld(worldId) : null;
  const urls = world?.assets?.splats?.spz_urls ?? {};
  const fullUrl = full ?? urls.full_res;
  const lightUrl = light ?? urls["500k"] ?? urls["100k"];
  if (!fullUrl && !lightUrl)
    throw say("这个房间不属于当前 API 账号，读取不到文件地址。请在 Marble 里点“分享 / 嵌入”，复制嵌入代码粘贴过来。", "This room belongs to another account, so its files can't be read. In Marble, choose Share / Embed and paste the embed code here.");
  const stamp = Date.now().toString(36);
  const lightKey = lightUrl ? await cacheRemote(lightUrl, `${projectId}/room/import-${stamp}.spz`, "spz") : undefined;
  const fullKey = fullUrl ? await cacheRemote(fullUrl, `${projectId}/room/import-${stamp}-full.spz`, "spz") : undefined;
  const colliderUrl = world?.assets?.mesh?.collider_mesh_url;
  const collider = colliderUrl ? await cacheRemote(colliderUrl, `${projectId}/room/import-${stamp}-collider.glb`, "glb").catch(() => undefined) : undefined;
  return { lightKey, fullKey, collider, s: world?.assets?.splats?.semantics_metadata };
}
export async function GET(req: Request) {
  try {
    const user = owner();
    const q = new URL(req.url).searchParams;
    // Which paid services have a key in .dev.vars (recognition and repair run on this machine).
    if (q.has("capabilities")) return Response.json({ world: !!(bindings().secrets.WORLDLABS_API_KEY || process.env.WORLDLABS_API_KEY), furniture: !!(bindings().secrets.TRIPO_API_KEY || process.env.TRIPO_API_KEY) });
    if (q.has("budgets")) return Response.json({world: await budgetSummary("world"), furniture: await budgetSummary("furniture")});
    if (q.has("services")) return Response.json(await balances());
    if (q.has("id")) return Response.json(await getProject(q.get("id")!, user));
    if (q.has("list")) {
      // The person's own spaces, newest first, for the home page (the example room has its own button).
      const rows = await bindings()
        .db.prepare("SELECT data,updated FROM projects WHERE owner=? ORDER BY updated DESC LIMIT 100")
        .bind(user)
        .all<{ data: string; updated: number }>();
      return Response.json(
        rows.results
          .map((r) => ({ p: JSON.parse(r.data) as Project, updated: r.updated }))
          .filter(({ p }) => p.mode === "real")
          .map(({ p, updated }) => ({
            id: p.id,
            name: p.name,
            stage: p.stage,
            updated,
            original: p.original ?? null,
            room: !!p.room,
            pieces: p.items.length,
            placed: p.items.filter((i) => i.status === "placed").length,
          })),
      );
    }
    const row = await bindings()
      .db.prepare(
        "SELECT id FROM projects WHERE owner=? ORDER BY updated DESC LIMIT 1",
      )
      .bind(user)
      .first<{ id: string }>();
    return Response.json(row ? await getProject(row.id, user) : null);
  } catch (e) {
    return Response.json({ error: spoken(e, langOf(req)) }, { status: 503 });
  }
}
export async function POST(req: Request) {
  const lang = langOf(req);
  try {
    const user = owner();
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host)
      throw say("请求来源不被允许。", "Requests from that page aren't allowed.");
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
        throw say("请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。", "Choose a JPG, PNG or WebP image of 10 MB or less.");
      if (!/^[a-zA-Z0-9_-]{1,90}$/.test(role)) throw say("无效资源名。", "Invalid file role.");
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
    const { db } = bindings();
    // The sample bedroom's room files, copied (or downloaded, free) ahead of the first demo upload.
    if (b.action === "prepare-demo") return Response.json({ ready: true, copied: await ensureDemoFiles() });
    if (b.action === "create") {
      // One example room per person: “看示例房间” opens the same one again, with its arrangement.
      if (b.mode === "demo") {
        const demo = await db
          .prepare("SELECT id FROM projects WHERE owner=? AND json_extract(data,'$.mode')='demo' ORDER BY updated DESC LIMIT 1")
          .bind(user)
          .first<{ id: string }>();
        if (demo) return Response.json(await getProject(demo.id, user));
      }
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
    if (b.action === "rename") {
      const name = String(b.name ?? "").trim().slice(0, 40);
      if (!name) throw say("名称不能为空。", "The name can't be empty.");
      p.name = name;
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "delete-project") {
      if (p.tasks.some((t) => ["queued", "running", "submitting"].includes(t.status)))
        throw say("这个空间还有生成任务在进行，等它完成后再删除。", "This space still has a generation job running. Delete it once that finishes.");
      const { bucket } = bindings();
      // Spaces share files: a room reused through the photo fingerprint points at the first space's
      // files. Only files that no other space (of any owner) mentions are removed with this one.
      const others = await db.prepare("SELECT data FROM projects WHERE id<>?").bind(p.id).all<{ data: string }>();
      const mentioned = others.results.map((r) => r.data).join("\n");
      const doomed: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: p.id + "/", cursor });
        for (const o of page.objects) if (!mentioned.includes(o.key)) doomed.push(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      // Files it borrowed from a space that is already gone (a reused room) go too, unless still in use.
      const borrowed = new Set(
        [...JSON.stringify(p).matchAll(/"([^"/\s]+\/[^"\s]+)"/g)]
          .map((m) => m[1])
          // The sample room's files under presets/ belong to no space and always stay.
          .filter((k) => !k.includes("://") && !k.startsWith(p.id + "/") && !k.startsWith("presets/")),
      );
      for (const k of borrowed)
        if (!mentioned.includes(k) && !(await db.prepare("SELECT 1 FROM projects WHERE id=?").bind(k.slice(0, k.indexOf("/"))).first()))
          doomed.push(k);
      for (let i = 0; i < doomed.length; i += 500) await bucket.delete(doomed.slice(i, i + 500));
      // Its generation jobs stay: they are the record of credits spent.
      await db.prepare("DELETE FROM projects WHERE id=? AND owner=?").bind(p.id, user).run();
      return Response.json({ deleted: p.id, files: doomed.length });
    }
    if(b.action === "revise") {
      if(!["branch","confirm","review"].includes(p.stage))throw say("请等待当前任务结束。", "Wait for the current job to finish.");
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
        throw say("无效布局", "Invalid layout.");
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
        if (!Number.isFinite(k) || k < 0.05 || k > 20) throw say("房间比例无效。", "Invalid room scale.");
        p.room.scale = k;
      }
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "set-print") {
      const print = String(b.print ?? "");
      if (!/^[0-9a-f]{16}$/.test(print)) throw say("照片指纹无效。", "Invalid photo print.");
      p.photoPrint = print;
      // The sample bedroom's photo opens its Marble 1.1 room straight away (lib/demo-room.ts).
      let demo = false;
      if (p.mode === "real" && !p.room && isDemoPhoto(p.original, print)) {
        try {
          await ensureDemoFiles();
          applyDemoRoom(p);
          if (isDefaultName(p.name)) p.name = DEMO_ROOM.name.zh;
          demo = true;
        } catch (e) {
          // Files not here and Marble unreachable: carry on as with any photo.
          console.warn("Sample room files unavailable:", (e as Error).message);
        }
      }
      // The same photo (re-saved or re-compressed included) already has a room in another project:
      // reuse it rather than generating and paying again. Erasures belong to that project's edits.
      if (p.mode === "real" && !p.room) {
        const rows = await db
          .prepare("SELECT data FROM projects WHERE owner=? AND id<>? ORDER BY updated DESC LIMIT 50")
          .bind(user, p.id)
          .all<{ data: string }>();
        const source = rows.results
          .map((r) => JSON.parse(r.data) as Project)
          .find((o) => o.room && o.photoPrint && printDistance(o.photoPrint, print) <= 8);
        if (source?.room) {
          p.room = { ...source.room, erasures: [] };
          p.floor = { ...source.floor };
          p.stage = "ready";
        }
      }
      return Response.json({ ...(await saveProject(p, user)), demo });
    }
    if (b.action === "edit-furniture") {
      if (p.mode !== "real" || !p.room) throw say("请先打开一个 3D 房间。", "Open a 3D room first.");
      const photo = String(b.photo ?? "");
      if (!photo.startsWith(p.id + "/uploads/furniture-photo-") || !(await bindings().bucket.head(photo)))
        throw say("请先上传这件家具的照片。", "Upload a photo of this piece first.");
      const name = String(b.name ?? "").trim().slice(0, 24);
      if (!name) throw say("请填写家具名称。", "Give the piece a name.");
      const kind = ["bed", "desk", "cabinet", "chair", "sofa", "other"].includes(b.kind) ? b.kind : "other";
      const dims = { w: Number(b.dims?.w), d: Number(b.dims?.d), h: Number(b.dims?.h) };
      if (Object.values(dims).some((v) => !Number.isFinite(v) || v < 5 || v > 400)) throw say("尺寸请填写 5–400 厘米之间的数字。", "Sizes must be numbers from 5 to 400 cm.");
      const e = b.erase ?? {};
      const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
      if (
        !Array.isArray(e.center) || e.center.length !== 3 || !e.center.every((v: unknown) => finite(v, -50, 50)) ||
        !Array.isArray(e.size) || e.size.length !== 3 || !e.size.every((v: unknown) => finite(v, 0.05, 10)) ||
        !finite(e.rotation, -100, 100)
      )
        throw say("擦除范围无效，请重新框选。", "The erase box isn't valid. Place it again.");
      if ((p.room.erasures?.length ?? 0) >= 30) throw say("这个房间已擦除太多家具。", "Too many pieces have been erased in this room.");
      const id = crypto.randomUUID();
      const erasure = { id, item: id, center: e.center, size: e.size, rotation: e.rotation };
      // The same photo was turned into a model before: that model goes back in place at once, free.
      const reuse = await reusableModel(user, photo, typeof b.print === "string" ? b.print : undefined);
      if (reuse) {
        let position: [number, number, number] = [e.center[0], p.floor.height, e.center[2]];
        let rotation = e.rotation;
        const known = reuse.piece;
        if (known) {
          // The generated model faces another way than the box; and in the sample room, a box
          // left where it was offered puts the piece exactly where it stood.
          rotation = known.placed.rotation + (e.rotation - known.erase.rotation);
          if (p.room.preset === DEMO_ROOM.id && Math.hypot(e.center[0] - known.erase.center[0], e.center[2] - known.erase.center[2]) < 0.3)
            position = [
              Math.round((known.placed.position[0] + e.center[0] - known.erase.center[0]) * 1e4) / 1e4,
              p.floor.height,
              Math.round((known.placed.position[2] + e.center[2] - known.erase.center[2]) * 1e4) / 1e4,
            ];
        }
        p.items.push({
          id, name, kind, status: "placed", position, rotation, scale: 1, height: dims.h / 100, dims,
          model: reuse.model, thumbnail: reuse.thumbnail, source: "upload",
        });
        p.room.erasures = [...(p.room.erasures ?? []), erasure];
        await saveProject(p, user);
        return Response.json({
          ...(await getProject(p.id, user)),
          reused: true,
          note: lang === "en"
            ? `This photo was made into 3D before, so “${name}” is back in place now. No credits spent.`
            : `这张照片之前生成过 3D 模型，「${name}」已直接放回原处，未消耗积分。`,
        });
      }
      // Reserve credits first: when the budget is exceeded nothing is saved.
      await enqueue(p, user, "furniture", id, { image: photo });
      p.items.push({
        id, name, kind, status: "queued",
        position: [e.center[0], p.floor.height, e.center[2]],
        rotation: e.rotation, scale: 1, height: dims.h / 100, dims, placeOnReady: true,
      });
      p.room.erasures = [...(p.room.erasures ?? []), erasure];
      await saveProject(p, user);
      return Response.json(await getProject(p.id, user));
    }
    if (b.action === "set-furniture-input")
      return Response.json(await saveProject(await setFurnitureInput(p, b), user));
    if (b.action === "add-furniture") {
      const { note, added } = await addFurniture(p, user, b, lang);
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
        throw say("擦除范围无效，请重新调整。", "The erase box isn't valid. Adjust it again.");
      list[i] = { ...list[i], center: e.center, size: e.size, rotation: e.rotation };
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "import-clean-world") {
      if (p.mode !== "real" || !p.room) throw say("请先打开一个 3D 房间。", "Open a 3D room first.");
      const { lightKey, fullKey } = await downloadMarble(p.id, String(b.source ?? ""));
      p.room.clean = { splat: (lightKey ?? fullKey)!, splatFull: fullKey, scale: 1, shift: [0, 0, 0], aligned: false };
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "align-clean") {
      const c = p.room?.clean;
      if (!c) throw say("还没有空房间底图。", "There is no empty-room layer yet.");
      const ok = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
      if (!ok(b.scale, 0.05, 20) || !ok(b.yaw ?? 0, -Math.PI, Math.PI) || !Array.isArray(b.shift) || b.shift.length !== 3 || !b.shift.every((v: unknown) => ok(v, -10, 10)))
        throw say("底图对齐数据无效。", "Invalid alignment for the empty-room layer.");
      c.scale = b.scale;
      c.yaw = b.yaw ?? 0;
      c.shift = b.shift;
      c.aligned = true;
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "import-world") {
      if (p.mode !== "real") throw say("示例房间不能导入。", "The sample room can't import a room.");
      if (p.tasks.some((t) => ["queued", "running", "submitting"].includes(t.status)))
        throw say("还有任务在处理，请等它完成后再导入。", "A job is still running. Import once it finishes.");
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
        throw say("照片已更换，请重新识别。", "The photo changed. Recognise it again.");
      if (!["branch", "confirm", "detecting"].includes(p.stage) || p.tasks.some(t => ["running", "queued", "submitting"].includes(t.status)))
        throw say("当前空间正在处理中，请等待处理完成。", "This space is busy. Wait until it finishes.");
      if (!Array.isArray(b.candidates) || b.candidates.length > 15)
        throw say("识别结果格式有误。", "The recognition result is malformed.");
      const candidates = [];
      for (const c of b.candidates) {
        if (!["bed", "desk", "chair", "sofa", "cabinet"].includes(c.kind) ||
            typeof c.name !== "string" || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 ||
            !Array.isArray(c.box) || c.box.length !== 4 || c.box.some((v: unknown) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) ||
            c.box[0] >= c.box[2] || c.box[1] >= c.box[3] ||
            typeof c.mask !== "string" || !c.mask.startsWith(p.id + "/uploads/auto-mask-"))
          throw say("识别轮廓无效，请重新识别。", "An outline is invalid. Recognise the photo again.");
        if (!(await bindings().bucket.head(c.mask))) throw say("识别轮廓未保存，请重试。", "An outline wasn't saved. Try again.");
        candidates.push({id:crypto.randomUUID(), name:c.name.slice(0,30), kind:c.kind, mask:c.mask,
          box:c.box, score:c.score, selected:false, source:"local-detr" as const, needsReview:!!c.needsReview || c.kind === "cabinet"});
      }
      p.candidates = [...p.candidates.filter(c => c.source === "manual"), ...candidates];
      p.recognitionComplete = true;
      if (p.stage === "detecting") p.stage = "branch";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "correct-candidate") {
      if (!["branch","confirm"].includes(p.stage)) throw say("当前阶段不能修改识别结果。", "Recognition results can't be changed at this step.");
      const names: Record<string,string> = {bed:"床",desk:"桌子",cabinet:"柜子",chair:"椅子",sofa:"沙发"};
      const candidate=p.candidates.find(c=>c.id===b.candidate);
      if (!candidate || !names[b.kind]) throw say("请选择有效家具类别。", "Choose a valid kind of furniture.");
      candidate.kind=b.kind; candidate.name=names[b.kind]; candidate.needsReview=b.kind==="cabinet";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "select-candidates") {
      if (p.mode !== "real" || !["branch", "confirm"].includes(p.stage)) throw say("请先上传并识别照片。", "Upload and recognise a photo first.");
      if (!["remove", "edit"].includes(b.branch)) throw say("请选择处理方式。", "Choose what to do with the furniture.");
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
      if (!selected.length) throw intent ? say("没有找到对应家具，可以点击照片中的轮廓，或补充手动圈选。", "No matching furniture. Click its outline in the photo, or outline it by hand.") : say("请选择具体家具，或填写描述；空输入不会处理全部家具。", "Choose the pieces, or describe them; an empty answer doesn't pick everything.");
      p.branch=b.branch; p.intent=intent;
      p.candidates=p.candidates.map(c=>({...c, selected:selected.some(v=>v.id===c.id)}));
      p.stage="confirm";
      return Response.json(await saveProject(p,user));
    }
    if (b.action === "manual") {
      if (!p.original || !b.mask?.startsWith(p.id + "/uploads/"))
        throw say("请先圈选对象。", "Outline the piece first.");
      if (!["remove", "edit"].includes(b.branch))
        throw say("请先选择处理方式。", "Choose what to do with the furniture first.");
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
        throw say("无效流程。", "That step isn't available here.");
      // The background is repaired on this machine (LaMa, build/local-vision-plugin.mjs) before this call.
      if (typeof b.localBackground !== "string") throw say("请先在本机完成背景修复。", "Repair the background on this Mac first.");
      if (b.original && b.original !== p.original) throw say("照片已更换，请重新处理。", "The photo changed. Process it again.");
      if (!["confirm","branch","review"].includes(p.stage)) throw say("当前阶段无法重新处理图片。", "The image can't be processed again at this step.");
      const selected = p.candidates.filter((c) => b.selected?.includes(c.id));
      if (!selected.length) throw say("至少确认一件家具，或选择无需处理。", "Confirm at least one piece, or choose to leave them.");
      if (!b.mask?.startsWith(p.id + "/uploads/"))
        throw say("缺少像素掩膜。", "The pixel mask is missing.");
      if (!(await bindings().bucket.head(b.mask))) throw say("轮廓未保存，请重试。", "The outline wasn't saved. Try again.");
      if (!b.localBackground.startsWith(p.id + "/uploads/local-background-") || !(await bindings().bucket.head(b.localBackground)))
        throw say("本地修复图片无效。", "The locally repaired image isn't valid.");
      p.candidates = p.candidates.map((c) => ({
        ...c,
        selected: b.selected.includes(c.id),
      }));
      p.mask = b.mask;
      p.cutouts = {};
      p.originalCrops = {};
      if (p.branch === "edit")
        for (const c of selected) {
          const key = b.cutouts?.[c.id];
          if (!key?.startsWith(p.id + "/uploads/"))
            throw say("缺少单件家具图。", "A cut-out of one piece is missing.");
          p.cutouts[c.id] = key;
          if (b.originalCrops?.[c.id]?.startsWith(p.id + "/uploads/"))
            p.originalCrops[c.id] = b.originalCrops[c.id];
        }
      p.rawBackground = b.localBackground;
      p.stage = "review";
      return Response.json(await saveProject(p, user));
    }
    if (b.action === "generate") {
      if (!p.original) throw say("请先上传房间照片。", "Upload a room photo first.");
      if (p.room) return Response.json(p);
      if (p.mode === "demo") throw say("示例模式不调用生成服务。", "The sample room doesn't call generation services.");
      if (b.skip) {
        if (p.stage === "processing") throw say("请等待图片处理完成。", "Wait for the image processing to finish.");
        p.branch = "none";
        p.background = p.original;
        p.items = [];
      } else {
        if (
          p.stage !== "review" ||
          !b.approved ||
          !b.background?.startsWith(p.id + "/uploads/")
        )
          throw say("请先检查处理后图片，再确认生成。", "Check the processed image before confirming generation.");
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
        throw say(bal.world.error || "World Labs 可用积分不足。", bal.world.errorEn || "Not enough World Labs credits.");
      if (
        p.items.length &&
        (bal.tripo.error ||
          !Number.isFinite(bal.tripo.data?.balance) || bal.tripo.data.balance < TRIPO_ESTIMATE * p.items.length)
      )
        throw say(bal.tripo.error || "Tripo 可用积分不足。", bal.tripo.errorEn || "Not enough Tripo credits.");
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
    throw say("未知操作", "Unknown action.");
  } catch (e) {
    return Response.json({ error: spoken(e, lang) }, { status: 400 });
  }
}
