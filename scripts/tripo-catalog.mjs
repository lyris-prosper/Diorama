// Generates source models for library pieces that have none yet, with Tripo, from the official
// product photos. Paid: about 70 credits a piece (TRIPO_SETTINGS: H3.1, detailed geometry, 8K PBR).
//
//   node scripts/tripo-catalog.mjs --images <folder> [--out <folder>] [--only id,id] [--yes]
//
// The pieces are the entries of lib/catalog.json without a prepared model. Photos are numbered like
// the catalog: 21_….jpg is the 21st entry. Each GLB is saved as <out>/<source.file> (default
// ../新增家具3D模型); `node scripts/build-catalog.mjs --src <out>` then prepares it for the app.
//
// Without --yes nothing paid is submitted: the script prints the pieces, the estimate and the
// Tripo balance. With --yes it checks the balance, submits each photo once, waits for the models
// and downloads them, then checks the balance again. Tasks are recorded in <out>/tripo-tasks.json
// as soon as Tripo returns them, so a stopped run resumes the same tasks instead of paying again; a
// submission whose outcome is unknown is marked there and never resubmitted automatically.
//
// The key is read from .dev.vars (TRIPO_API_KEY) and never printed. Requests go through the shell's
// HTTPS_PROXY or the macOS system proxy, like the local relay (build/local-relay-plugin.mjs).
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch, FormData } from "undici";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const imageDir = option("--images") && resolve(root, option("--images"));
const out = resolve(root, option("--out") ?? "../新增家具3D模型");
const only = option("--only")?.split(",");
const paid = args.includes("--yes");
if (!imageDir) {
  console.error("用法：node scripts/tripo-catalog.mjs --images <商品图文件夹> [--out <文件夹>] [--only id,id] [--yes]");
  process.exit(2);
}

const T = "https://openapi.tripo3d.ai/v3";
// lib/credits.ts TRIPO_CREDITS: what one high-detail model is expected to cost.
const ESTIMATE = 70;
// The app's own settings (lib/server/provider-http.ts), read from the source so the two never differ.
const SETTINGS = (() => {
  const src = readFileSync(join(root, "lib/server/provider-http.ts"), "utf8");
  const literal = /export const TRIPO_SETTINGS = Object\.freeze\((\{[\s\S]*?\})\);/.exec(src)?.[1];
  if (!literal) throw Error("lib/server/provider-http.ts 里找不到 TRIPO_SETTINGS");
  return new Function(`return (${literal});`)();
})();

function apiKey() {
  const file = join(root, ".dev.vars");
  const line = existsSync(file) ? readFileSync(file, "utf8").split("\n").find((l) => /^\s*TRIPO_API_KEY\s*=/.test(l)) : undefined;
  const key = (line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "") || process.env.TRIPO_API_KEY || "";
  if (!key) throw Error(".dev.vars 里没有 TRIPO_API_KEY，不会提交付费生成。");
  return key;
}
function proxyUrl() {
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (env) return env;
  if (process.platform !== "darwin") return undefined;
  try {
    const text = execFileSync("scutil", ["--proxy"], { encoding: "utf8" });
    const v = (k) => new RegExp(`${k}\\s*:\\s*(\\S+)`).exec(text)?.[1];
    if (v("HTTPSEnable") === "1" && v("HTTPSProxy")) return `http://${v("HTTPSProxy")}:${v("HTTPSPort") || 80}`;
  } catch {}
  return undefined;
}
const proxy = proxyUrl();
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const key = apiKey();
const hide = (text) => String(text).split(key).join("[hidden]");

// GET requests are retried; a POST that creates something is sent once.
async function tripo(path, init = {}) {
  const tries = (init.method ?? "GET") === "GET" ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(T + path, { ...init, dispatcher, headers: { Authorization: `Bearer ${key}`, ...init.headers }, signal: AbortSignal.timeout(init.timeout ?? 30000) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || (body.code !== undefined && body.code !== 0))
        throw Object.assign(Error(`Tripo ${r.status}：${hide(body.message ?? body.error ?? "无法解析的回复")}`), { status: r.status, answered: true });
      return body.data;
    } catch (e) {
      if (attempt >= tries || (e.answered && e.status < 500 && e.status !== 429)) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
}
const balance = async () => {
  const d = await tripo("/account/balance");
  return { balance: d?.balance, frozen: d?.frozen };
};

const catalog = JSON.parse(readFileSync(join(root, "lib/catalog.json"), "utf8"));
const photos = readdirSync(imageDir);
const pieces = catalog.items
  .map((item, k) => ({ item, photo: photos.find((f) => f.startsWith(String(k + 1).padStart(2, "0") + "_")) }))
  .filter(({ item }) => !item.model && item.source?.file && (!only || only.includes(item.id)));
mkdirSync(out, { recursive: true });
const tasksFile = join(out, "tripo-tasks.json");
const tasks = existsSync(tasksFile) ? JSON.parse(readFileSync(tasksFile, "utf8")) : {};
const save = () => writeFileSync(tasksFile, JSON.stringify(tasks, null, 2) + "\n");

const todo = [];
for (const p of pieces) {
  const file = join(out, p.item.source.file);
  if (existsSync(file)) console.log(`· ${p.item.id}: 已有 ${p.item.source.file}，跳过`);
  else if (!p.photo) throw Error(`${p.item.id}: ${imageDir} 里没有它的编号图片`);
  else if (![".jpg", ".jpeg", ".png"].includes(extname(p.photo).toLowerCase())) throw Error(`${p.item.id}: Tripo 只收 JPEG 或 PNG（${p.photo}）`);
  else todo.push({ ...p, file });
}
const fresh = todo.filter((p) => !tasks[p.item.id]?.task);
const before = await balance();
console.log(`Tripo 余额 ${before.balance}（冻结 ${before.frozen ?? 0}）；代理 ${proxy ?? "无"}；设置 ${JSON.stringify(SETTINGS)}`);
console.log(`${todo.length} 件待生成，其中 ${fresh.length} 件需要新提交，预计 ${fresh.length * ESTIMATE} 积分：`);
for (const p of todo) console.log(`  ${p.item.id.padEnd(26)} ← ${p.photo}${tasks[p.item.id]?.task ? `（继续任务 ${tasks[p.item.id].task}）` : ""}`);
if (!paid) {
  console.log("\n没有 --yes，不提交任何付费任务。");
  process.exit(0);
}
if (!(before.balance >= fresh.length * ESTIMATE)) throw Error(`余额 ${before.balance} 不够预计的 ${fresh.length * ESTIMATE} 积分，没有提交。`);

// Submit: upload the photo, create the task, record its id at once. Tripo sometimes refuses a photo
// uploaded a moment ago (“input image is not accessible”); that refusal creates nothing, so the
// photo is uploaded again, a little later, up to three times.
const notReady = (e) => e.answered && e.status === 400 && /not accessible/i.test(e.message);
async function submit(p) {
  const id = p.item.id;
  const type = /\.png$/i.test(p.photo) ? "image/png" : "image/jpeg";
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(join(imageDir, p.photo))], { type }), `${id}${type === "image/png" ? ".png" : ".jpg"}`);
    const upload = await tripo("/files", { method: "POST", body: form, timeout: 120000 });
    if (!upload?.file_token) throw Error("上传没有返回图片编号，没有提交付费生成");
    await new Promise((ok) => setTimeout(ok, 3000 * attempt));
    try {
      const task = await tripo("/generation/image-to-model", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: upload.file_token, ...SETTINGS }),
      });
      if (!task?.task_id) throw Object.assign(Error("没有返回任务编号"), { answered: true, status: 200 });
      tasks[id] = { task: task.task_id, photo: p.photo, submitted: new Date().toISOString() };
      console.log(`→ ${id}: 已提交任务 ${task.task_id}`);
      return;
    } catch (e) {
      if (notReady(e) && attempt < 3) continue;
      // Answered with an error: nothing was created. No answer, or no task id: it may have been.
      if (e.answered && e.status >= 400 && e.status < 500) throw e;
      tasks[id] = { uncertain: true, photo: p.photo, submitted: new Date().toISOString(), error: e.message };
      console.log(`! ${id}: 提交结果未知（${e.message}），已记下，不会自动重新提交`);
      return;
    }
  }
}
for (const p of fresh) {
  const id = p.item.id;
  if (tasks[id]?.uncertain) {
    console.log(`! ${id}: 上次提交结果未知，需要在 Tripo 后台核对，不会自动重新提交`);
    continue;
  }
  try {
    await submit(p);
  } catch (e) {
    console.log(`✗ ${id}: 没有提交（${e.message}）`);
  }
  save();
}

// Wait for every recorded task, then download its model (PBR GLB) next to the others.
async function finish(p) {
  const id = p.item.id, t = tasks[id];
  if (!t?.task) return;
  const started = Date.now();
  for (;;) {
    const d = await tripo(`/tasks/${encodeURIComponent(t.task)}`);
    if (d?.status === "success") {
      t.status = "success";
      t.credits = d.credits_consumed ?? null;
      const url = d.output?.pbr_model_url ?? d.output?.pbr_model ?? d.output?.model_url ?? d.output?.model;
      if (!url) throw Error(`${id}: 任务成功但没有模型地址（${Object.keys(d.output ?? {}).join(", ")}）`);
      const r = await fetch(url, { dispatcher, signal: AbortSignal.timeout(600000) });
      if (!r.ok) throw Error(`${id}: 下载模型失败 HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(p.file + ".part"));
      renameSync(p.file + ".part", p.file);
      t.bytes = statSync(p.file).size;
      save();
      console.log(`✓ ${id}: ${(t.bytes / 1e6).toFixed(1)} MB，扣 ${t.credits ?? "?"} 积分，${Math.round((Date.now() - started) / 1000)} 秒`);
      return;
    }
    if (["failed", "cancelled", "banned", "expired"].includes(d?.status)) {
      t.status = d.status;
      t.credits = d.credits_consumed ?? null;
      save();
      console.log(`✗ ${id}: ${d.status}${d.error_message ? `：${hide(d.error_message)}` : ""}`);
      return;
    }
    if (Date.now() - started > 30 * 60000) {
      console.log(`… ${id}: 30 分钟还没完成（${d?.status} ${d?.progress ?? ""}），任务 ${t.task} 已记下，重新运行会继续等`);
      return;
    }
    await new Promise((ok) => setTimeout(ok, 10000));
  }
}
const results = await Promise.allSettled(todo.map(finish));
results.forEach((r, i) => r.status === "rejected" && console.log(`✗ ${todo[i].item.id}: ${hide(r.reason?.message ?? r.reason)}`));

const after = await balance();
const reported = todo.reduce((sum, p) => sum + (Number(tasks[p.item.id]?.credits) || 0), 0);
console.log(`\nTripo 余额 ${before.balance} → ${after.balance}（冻结 ${after.frozen ?? 0}），减少 ${before.balance - after.balance}；任务报告的扣费合计 ${reported}。`);
console.log(`模型在 ${out}。下一步：node scripts/build-catalog.mjs --src ${out} --only ${todo.map((p) => p.item.id).join(",")}`);
if (results.some((r) => r.status === "rejected") || todo.some((p) => tasks[p.item.id]?.status !== "success")) process.exitCode = 1;
