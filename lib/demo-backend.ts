// The read-only demo (static build) has no server: the page's /api/workbench and /api/assets requests are
// answered here, in the browser. Spaces and uploaded photos stay in this browser (IndexedDB). The
// sample bedroom loads from Marble's public CDN and its bed and pendant from public/demo/; nothing
// is generated and no provider is called. A room or new furniture from other photos needs the full
// app running locally (README).
//
// createDemoServer is the server's logic for the sample-bedroom flow (app/api/workbench/route.ts,
// lib/server/furniture.ts) over a plain store, so it can be tested without a browser.
import { DEMO_ROOM, demoPieceFor, isDefaultName, isDemoPhoto, printDistance, shaOfKey } from "./demo-room";
import { catalogItem } from "./catalog";
import { emptyProject, MAX_ITEMS, type Item, type Project } from "./types";
import { setAssetResolver } from "./asset-url";

export type Lang = "zh" | "en";
type Said = Error & { en: string };
const say = (zh: string, en: string): Said => Object.assign(new Error(zh), { en });
const onlySample = () =>
  say(
    "在线演示版只能体验示例卧室：用你自己的照片生成 3D 房间或新家具，需要在本地运行完整版（见 README）。",
    "The online demo runs the sample bedroom only: a 3D room or new furniture from your own photos needs the full app running locally (see the README).",
  );
// Error message in the page's language.
export const spoken = (e: unknown, lang: Lang) => (lang === "en" && (e as Said).en ? (e as Said).en : (e as Error).message);

export type DemoStore = {
  projects: Map<string, Project>;
  files: Map<string, Blob>;
  /** Persist a project (stored without its tasks). */
  save(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  putFile(key: string, blob: Blob): Promise<void>;
  dropFiles(keys: string[]): Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are checked field by field, as in the server
type Body = Record<string, any>;
/** A piece as the page sends it back on save; every field is checked before use. */
type SentItem = { id?: string; status?: string; position: number[]; rotation?: unknown; scale?: unknown; height?: unknown; mount?: unknown };
const KINDS = ["bed", "desk", "cabinet", "chair", "sofa", "pendant", "other"];
const point = (v: unknown): Item["position"] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 50) ? [v[0], v[1], v[2]] : null;
const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
function readDims(v: unknown) {
  const o = (v ?? {}) as Record<string, unknown>;
  const dims = { w: Number(o.w), d: Number(o.d), h: Number(o.h) };
  if (Object.values(dims).some((n) => !Number.isFinite(n) || n < 5 || n > 400)) throw say("尺寸请填写 5–400 厘米之间的数字。", "Sizes must be numbers from 5 to 400 cm.");
  return dims;
}
async function sha256(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (n) => n.toString(16).padStart(2, "0")).join("");
}

export function createDemoServer(store: DemoStore) {
  const get = (id: unknown) => {
    const p = store.projects.get(String(id));
    if (!p) throw say("空间不存在或无权访问。", "This space doesn't exist or isn't yours.");
    return structuredClone(p);
  };
  const out = (p: Project) => ({ ...p, tasks: [] });
  async function save(p: Project) {
    p.updatedAt = Date.now();
    p.revision = (p.revision ?? 0) + 1;
    await store.save({ ...p, tasks: [] });
    return out(p);
  }
  const ownUpload = (p: Project, key: unknown, role: string) => {
    const k = String(key ?? "");
    if (!k.startsWith(`${p.id}/uploads/${role}-`) || !store.files.has(k)) throw say("照片不属于这个空间，请重新上传。", "That photo isn't part of this space. Please upload it again.");
    return k;
  };

  async function query(q: URLSearchParams) {
    if (q.has("capabilities")) return { world: false, furniture: false };
    if (q.has("services")) {
      const note = { error: "在线演示版不连接生成服务。", errorEn: "The online demo doesn't connect to generation services." };
      return { world: note, tripo: note };
    }
    if (q.has("budgets")) return {};
    if (q.has("id")) return out(get(q.get("id")));
    const all = [...store.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (q.has("list"))
      return all
        .filter((p) => p.mode === "real")
        .map((p) => ({
          id: p.id,
          name: p.name,
          stage: p.stage,
          updated: p.updatedAt,
          original: p.original ?? null,
          room: !!p.room,
          pieces: p.items.length,
          placed: p.items.filter((i) => i.status === "placed").length,
        }));
    return all[0] ? out(structuredClone(all[0])) : null;
  }

  async function upload(form: FormData) {
    const p = get(form.get("id"));
    const file = form.get("file") as File | null;
    const role = String(form.get("role"));
    if (!file || file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw say("请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。", "Choose a JPG, PNG or WebP image of 10 MB or less.");
    if (!/^[a-zA-Z0-9_-]{1,90}$/.test(role)) throw say("无效资源名。", "Invalid file role.");
    const key = `${p.id}/uploads/${role}-${await sha256(await file.arrayBuffer())}.png`;
    await store.putFile(key, file);
    if (role === "original") {
      p.original = key;
      p.stage = "branch";
      return { key, project: await save(p) };
    }
    return { key, project: out(p) };
  }

  async function post(b: Body, lang: Lang) {
    if (b.action === "prepare-demo") return { ready: true, copied: 0 };
    if (b.action === "create") {
      if (b.mode === "demo") {
        const demo = [...store.projects.values()].find((x) => x.mode === "demo");
        if (demo) return out(structuredClone(demo));
      }
      const p = emptyProject(crypto.randomUUID(), b.mode === "demo" ? "demo" : "real");
      await store.save(p);
      return p;
    }
    const p = get(b.id);
    switch (b.action) {
      case "rename": {
        const name = String(b.name ?? "").trim().slice(0, 40);
        if (!name) throw say("名称不能为空。", "The name can't be empty.");
        p.name = name;
        return save(p);
      }
      case "delete-project": {
        await store.remove(p.id);
        const mentioned = [...store.projects.values()].map((x) => JSON.stringify(x)).join("\n");
        await store.dropFiles([...store.files.keys()].filter((k) => k.startsWith(p.id + "/") && !mentioned.includes(k)));
        return { deleted: p.id, files: 0 };
      }
      case "tick":
        return out(p);
      case "save": {
        const items = b.items as SentItem[];
        if (!Array.isArray(items) || items.length > MAX_ITEMS || items.some((i) => !Array.isArray(i.position) || i.position.length !== 3 || i.position.some((v: unknown) => typeof v !== "number" || !Number.isFinite(v))))
          throw say("无效布局", "Invalid layout.");
        const known = new Map([...p.items, ...(p.archived || [])].map((i) => [i.id, i]));
        p.archived = [...known.values()].filter((i) => !items.some((v) => v.id === i.id));
        p.items = items
          .filter((i) => known.has(i.id!))
          .map((i) => ({
            ...known.get(i.id!)!,
            status: i.status === "placed" ? ("placed" as const) : ("ready" as const),
            position: i.position.map((v) => (Number.isFinite(v) ? Math.max(-50, Math.min(50, v)) : 0)) as Item["position"],
            rotation: Number(i.rotation) || 0,
            scale: Math.max(0.1, Math.min(5, Number(i.scale) || 1)),
            height: Math.max(0.01, Math.min(5, Number(i.height) || 1)),
            mount: i.mount === "ceiling" || i.mount === "floor" ? i.mount : undefined,
          }));
        if (b.floor)
          p.floor = {
            height: Math.max(-10, Math.min(10, Number(b.floor.height) || 0)),
            size: Math.max(2, Math.min(20, Number(b.floor.size) || 6)),
            confirmed: !!b.floor.confirmed,
          };
        if (p.room && b.roomScale !== undefined) {
          const k = Number(b.roomScale);
          if (!Number.isFinite(k) || k < 0.05 || k > 20) throw say("房间比例无效。", "Invalid room scale.");
          p.room.scale = k;
        }
        return save(p);
      }
      case "set-print": {
        const print = String(b.print ?? "");
        if (!/^[0-9a-f]{16}$/.test(print)) throw say("照片指纹无效。", "Invalid photo print.");
        p.photoPrint = print;
        let demo = false;
        if (p.mode === "real" && !p.room && isDemoPhoto(p.original, print)) {
          p.room = { ...DEMO_ROOM.room, source: "imported", preset: DEMO_ROOM.id, erasures: [], clean: { ...DEMO_ROOM.clean, shift: [...DEMO_ROOM.clean.shift] } };
          p.floor = { ...DEMO_ROOM.floor };
          p.stage = "ready";
          if (isDefaultName(p.name)) p.name = DEMO_ROOM.name.zh;
          demo = true;
        }
        if (p.mode === "real" && !p.room) {
          const source = [...store.projects.values()].find((o) => o.id !== p.id && o.room && o.photoPrint && printDistance(o.photoPrint, print) <= 8);
          if (source?.room) {
            p.room = { ...source.room, erasures: [] };
            p.floor = { ...source.floor };
            p.stage = "ready";
          }
        }
        // Any other photo would need a room generated: not here. The space it made is removed again.
        if (p.mode === "real" && !p.room) {
          await store.remove(p.id);
          await store.dropFiles([...store.files.keys()].filter((k) => k.startsWith(p.id + "/")));
          throw say(
            "在线演示版只认得示例卧室的照片：点“看示例卧室”试试。用你自己的房间生成 3D 需要在本地运行完整版（见 README）。",
            "The online demo only knows the sample bedroom's photo: try “See the sample bedroom”. A 3D room from your own photo needs the full app running locally (see the README).",
          );
        }
        return { ...(await save(p)), demo };
      }
      case "edit-furniture": {
        if (p.mode !== "real" || !p.room) throw say("请先打开一个 3D 房间。", "Open a 3D room first.");
        const photo = ownUpload(p, b.photo, "furniture-photo");
        const name = String(b.name ?? "").trim().slice(0, 24);
        if (!name) throw say("请填写家具名称。", "Give the piece a name.");
        const kind = KINDS.includes(b.kind) ? b.kind : "other";
        const dims = readDims(b.dims);
        const e = b.erase ?? {};
        if (
          !Array.isArray(e.center) || e.center.length !== 3 || !e.center.every((v: unknown) => finite(v, -50, 50)) ||
          !Array.isArray(e.size) || e.size.length !== 3 || !e.size.every((v: unknown) => finite(v, 0.05, 10)) ||
          !finite(e.rotation, -100, 100)
        )
          throw say("擦除范围无效，请重新框选。", "The erase box isn't valid. Place it again.");
        const known = demoPieceFor(shaOfKey(photo), typeof b.print === "string" ? b.print : undefined);
        if (!known) throw onlySample();
        const id = crypto.randomUUID();
        let position: Item["position"] = [e.center[0], p.floor.height, e.center[2]];
        let rotation = e.rotation;
        if (known.erase && known.placed) {
          const { erase, placed } = known;
          rotation = placed.rotation + (e.rotation - erase.rotation);
          if (p.room.preset === DEMO_ROOM.id && Math.hypot(e.center[0] - erase.center[0], e.center[2] - erase.center[2]) < 0.3)
            position = [
              Math.round((placed.position[0] + e.center[0] - erase.center[0]) * 1e4) / 1e4,
              p.floor.height,
              Math.round((placed.position[2] + e.center[2] - erase.center[2]) * 1e4) / 1e4,
            ];
        }
        p.items.push({ id, name, kind, status: "placed", position, rotation, scale: 1, height: dims.h / 100, dims, model: known.model, thumbnail: known.thumbnail, source: "upload" });
        p.room.erasures = [...(p.room.erasures ?? []), { id, item: id, center: e.center, size: e.size, rotation: e.rotation }];
        return {
          ...(await save(p)),
          reused: true,
          note: lang === "en" ? `This photo was made into 3D before, so “${name}” is back in place now. No credits spent.` : `这张照片之前生成过 3D 模型，「${name}」已直接放回原处，未消耗积分。`,
        };
      }
      case "add-furniture": {
        if (p.mode !== "real") throw say("示例房间不生成新家具，可以从家具库里挑选。", "The sample room doesn't generate new furniture. Pick from the library instead.");
        const list: Body[] = Array.isArray(b.furniture) ? b.furniture : [];
        if (!list.length) throw say("请至少添加一件家具。", "Add at least one piece.");
        if (p.items.length + list.length > MAX_ITEMS) throw say(`一个空间最多放 ${MAX_ITEMS} 件家具。`, `A space holds up to ${MAX_ITEMS} pieces.`);
        const pieces = list.map((f) => {
          const name = String(f.name ?? "").trim().slice(0, 24);
          if (!name) throw say("请为每件家具填写名称。", "Give every piece a name.");
          const image = ownUpload(p, f.image, "add-furniture");
          const known = demoPieceFor(shaOfKey(image), typeof f.print === "string" ? f.print : undefined);
          if (!known) throw onlySample();
          return { name, kind: KINDS.includes(String(f.kind)) ? String(f.kind) : "other", dims: readDims(f.dims), known };
        });
        const added: string[] = [];
        for (const f of pieces) {
          const id = crypto.randomUUID();
          p.items.push({
            id, name: f.name, kind: f.kind, status: "ready", position: [0, p.floor.height, 0], rotation: 0, scale: 1,
            height: f.dims.h / 100, dims: f.dims, source: "upload", model: f.known.model, thumbnail: f.known.thumbnail,
          });
          added.push(id);
        }
        const n = added.length;
        const note = lang === "en"
          ? `${n} ${n === 1 ? "photo was" : "photos were"} already made into 3D, so ${n === 1 ? "its model was" : "their models were"} reused with no credits spent.`
          : `${n} 张照片之前已生成过 3D 模型，直接复用，未消耗积分。`;
        return { ...(await save(p)), note, added };
      }
      case "add-catalog-item": {
        const c = catalogItem(String(b.catalogId ?? ""));
        if (!c?.model || !c.modelHeight) throw say("家具库里没有这件家具。", "That piece isn't in the library.");
        if (p.mode === "real" && !p.room) throw say("先生成或导入 3D 房间，再从家具库挑选。", "Generate or import the 3D room first, then pick from the library.");
        if (p.items.length >= MAX_ITEMS) throw say(`一个空间最多放 ${MAX_ITEMS} 件家具。`, `A space holds up to ${MAX_ITEMS} pieces.`);
        const at = b.position === undefined ? null : point(b.position);
        if (b.position !== undefined && !at) throw say("放置位置无效。", "That spot isn't valid.");
        const turn = at && typeof b.rotation === "number" && Number.isFinite(b.rotation) && Math.abs(b.rotation) <= 2 * Math.PI ? b.rotation : 0;
        const item: Item = {
          id: crypto.randomUUID(), name: c.name, kind: c.kind, status: at ? "placed" : "ready", position: at ?? [0, p.floor.height, 0],
          rotation: turn, scale: 1, height: c.modelHeight, dims: c.dims, model: c.model, thumbnail: c.image, source: "catalog", catalogId: c.id,
        };
        p.items.push(item);
        return { ...(await save(p)), added: item.id };
      }
      case "update-erasure": {
        const e = b.erasure ?? {};
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
        return save(p);
      }
      case "align-clean": {
        const c = p.room?.clean;
        if (!c) throw say("还没有空房间底图。", "There is no empty-room layer yet.");
        if (!finite(b.scale, 0.05, 20) || !finite(b.yaw ?? 0, -Math.PI, Math.PI) || !Array.isArray(b.shift) || b.shift.length !== 3 || !b.shift.every((v: unknown) => finite(v, -10, 10)))
          throw say("底图对齐数据无效。", "Invalid alignment for the empty-room layer.");
        Object.assign(c, { scale: b.scale, yaw: b.yaw ?? 0, shift: b.shift, aligned: true });
        return save(p);
      }
      default:
        // Generating, recognising, importing, retrying: the full app's work, on a Mac.
        throw onlySample();
    }
  }
  return { query, upload, post };
}

/* ———————— the browser side: IndexedDB, the asset resolver and the fetch hook ———————— */

const DB = "diorama-demo";
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("projects");
        req.result.createObjectStore("files");
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
}
const run = <T,>(db: IDBDatabase | null, name: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void) =>
  new Promise<T | undefined>((ok) => {
    if (!db) return ok(undefined);
    try {
      const t = db.transaction(name, mode);
      const r = fn(t.objectStore(name));
      t.oncomplete = () => ok(r ? r.result : undefined);
      t.onerror = t.onabort = () => ok(undefined);
    } catch {
      ok(undefined);
    }
  });

/** Answers the page's API in this browser (call once, before the page starts). */
export async function installDemoBackend() {
  const db = await openDb();
  const projects = new Map<string, Project>();
  const files = new Map<string, Blob>();
  const urls = new Map<string, string>();
  for (const p of (await run<Project[]>(db, "projects", "readonly", (s) => s.getAll())) ?? []) projects.set(p.id, p);
  const keys = ((await run<IDBValidKey[]>(db, "files", "readonly", (s) => s.getAllKeys())) ?? []) as string[];
  const blobs = (await run<Blob[]>(db, "files", "readonly", (s) => s.getAll())) ?? [];
  keys.forEach((k, i) => {
    files.set(k, blobs[i]);
    urls.set(k, URL.createObjectURL(blobs[i]));
  });
  const store: DemoStore = {
    projects,
    files,
    async save(p) {
      projects.set(p.id, structuredClone(p));
      await run(db, "projects", "readwrite", (s) => s.put(structuredClone(p), p.id));
    },
    async remove(id) {
      projects.delete(id);
      await run(db, "projects", "readwrite", (s) => s.delete(id));
    },
    async putFile(key, blob) {
      files.set(key, blob);
      if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
      await run(db, "files", "readwrite", (s) => s.put(blob, key));
    },
    async dropFiles(list) {
      for (const k of list) {
        files.delete(k);
        const u = urls.get(k);
        if (u) URL.revokeObjectURL(u);
        urls.delete(k);
        await run(db, "files", "readwrite", (s) => s.delete(k));
      }
    },
  };
  // The sample bedroom's room files come from Marble's CDN (it allows any origin); uploads from here.
  const cdn = new Map(DEMO_ROOM.files.map((f) => [f.key, f.url]));
  setAssetResolver((key) => cdn.get(key) ?? urls.get(key) ?? null);

  const server = createDemoServer(store);
  const real = window.fetch.bind(window);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith("/api/")) return real(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const lang: Lang = headers.get("x-lang") === "en" ? "en" : "zh";
    try {
      if (u.pathname === "/api/assets") {
        const key = u.searchParams.get("key") ?? "";
        if (cdn.has(key)) return real(cdn.get(key)!);
        const blob = files.get(key);
        return blob ? new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }) : json({ error: "Not found" }, 404);
      }
      if (u.pathname !== "/api/workbench") return json({ error: "Not available in the online demo" }, 404);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET") return json(await server.query(u.searchParams));
      if (init?.body instanceof FormData) return json(await server.upload(init.body));
      return json(await server.post(JSON.parse(String(init?.body ?? "{}")), lang));
    } catch (e) {
      return json({ error: spoken(e, lang) }, 400);
    }
  };
}
