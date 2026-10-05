import { bindings, bytes } from "./storage";
import { ProviderError, providerJSON as json, safeText, creditNumber, TRIPO_SETTINGS } from "./provider-http";
import { roomCategories as categories } from "../furniture-kinds";
export { categories };
const W = "https://api.worldlabs.ai/marble/v1";
const T = "https://openapi.tripo3d.ai/v3";
function key(name: string) {
  const v = bindings().secrets[name] || process.env[name];
  if (!v) throw new ProviderError(`密钥未配置：${name}，不会启动付费生成。`, { category: "auth" });
  return v;
}
export async function balances() {
  const result: any = {};
  await Promise.all([
    ["world", "/credits", "WLT-Api-Key", "WORLDLABS_API_KEY"],
    ["tripo", "/account/balance", "Authorization", "TRIPO_API_KEY"],
  ].map(async ([name, url, header, k]) => {
    try {
      result[name] = await json((name === "world" ? W : T) + url, {
        headers: { [header]: name === "world" ? key(k) : `Bearer ${key(k)}` },
      });
    } catch (e) {
      result[name] = { error: (e as Error).message, category: (e as ProviderError).category, requestId: (e as ProviderError).requestId };
    }
  }));
  return result;
}
function requiredId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new ProviderError("服务商未返回任务编号，任务是否创建需要核对；不会自动重新提交。", { category: "provider", uncertain: true });
  return value;
}
export async function startWorld(image: string) {
  const data = await bytes(image);
  if (!data.buffer.byteLength || data.buffer.byteLength > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(data.type))
    throw new ProviderError("参数错误：房间图片须为不超过 10 MB 的 PNG、JPEG 或 WebP。", { category: "parameters" });
  const j = await json(W + "/worlds:generate", {
    method: "POST",
    headers: { "WLT-Api-Key": key("WORLDLABS_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "marble-1.0-draft", display_name: "我的空间", permission: { public: false },
      world_prompt: {
        type: "image", is_pano: false,
        image_prompt: { source: "data_base64", data_base64: Buffer.from(data.buffer).toString("base64"), extension: data.type === "image/jpeg" ? "jpg" : data.type.split("/")[1] },
        text_prompt: "Reconstruct the room faithfully. Preserve all visible walls, windows, flooring and remaining furniture. Do not add new furniture.",
        disable_recaption: true,
      },
    }),
  }, true);
  return requiredId(j.operation_id);
}
export async function pollWorld(id: string) {
  const k = key("WORLDLABS_API_KEY");
  const j = await json(W + "/operations/" + encodeURIComponent(id), { headers: { "WLT-Api-Key": k } });
  if (j.done && j.error) throw new ProviderError(`World Labs：服务商生成失败。${safeText(j.error.message, [k])}${j.request_id ? `（请求编号：${safeText(j.request_id, [k])}）` : ""}`, {
    category: "provider", terminal: true, taskStatus: "failed", code: j.error.code,
    requestId: j.request_id, credits: creditNumber(j.cost?.total_credits) ?? undefined,
  });
  if (!j.done) return null;
  if (!j.response?.world_id) throw new ProviderError("World Labs：生成结果缺少房间编号，可继续查询原任务。", { category: "provider" });
  const w = j.response.assets ? j.response : await json(W + "/worlds/" + encodeURIComponent(j.response.world_id), { headers: { "WLT-Api-Key": k } });
  return { ...w, cost: j.cost };
}
// A world made on the Marble website under another account answers 404 here; callers then
// fall back to the public file links pasted by the user.
export async function readWorld(id: string) {
  try {
    const w = await json(W + "/worlds/" + encodeURIComponent(id), { headers: { "WLT-Api-Key": key("WORLDLABS_API_KEY") } });
    return (w.world ?? w) as any;
  } catch {
    return null;
  }
}
// Accepts a Marble viewer link, its iframe embed code, a world page link, a direct .spz link or a bare world ID.
export function parseMarbleSource(input: string) {
  const text = input.replace(/&amp;/g, "&").slice(0, 4000);
  const param = (name: string) => {
    const m = new RegExp(name + "=([^&\"'\\s>]+)").exec(text);
    if (!m) return undefined;
    try { return decodeURIComponent(m[1]); } catch { return undefined; }
  };
  const cdn = (u?: string) => {
    if (!u) return undefined;
    try {
      const url = new URL(u);
      return url.protocol === "https:" && url.hostname === "cdn.marble.worldlabs.ai" && url.pathname.endsWith(".spz") ? url.href : undefined;
    } catch { return undefined; }
  };
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const direct = /https:\/\/cdn\.marble\.worldlabs\.ai\/[^\s"'&<>]+\.spz/i.exec(text)?.[0];
  const full = cdn(param("splatUrl")) ?? cdn(direct);
  const light = cdn(param("mobileUrl"));
  const worldId = (param("marbleWorldId") ?? /marble\.worldlabs\.ai\/world\/([0-9a-f-]{36})/i.exec(text)?.[1] ?? (full || light ? undefined : uuid.exec(text)?.[0]))?.toLowerCase();
  return { full, light, worldId: worldId && uuid.test(worldId) ? worldId : undefined };
}
export async function startTripo(image: string) {
  const b = await bytes(image);
  if (!b.buffer.byteLength || b.buffer.byteLength > 20 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(b.type))
    throw new ProviderError("参数错误：家具图片须为不超过 20 MB 的 PNG 或 JPEG。", { category: "parameters" });
  const form = new FormData();
  form.append("file", new Blob([b.buffer], { type: b.type }), b.type === "image/jpeg" ? "furniture.jpg" : "furniture.png");
  const f = await json(T + "/files", { method: "POST", headers: { Authorization: `Bearer ${key("TRIPO_API_KEY")}` }, body: form });
  if (typeof f.data?.file_token !== "string" || !f.data.file_token)
    throw new ProviderError("Tripo：上传结果缺少图片编号，尚未提交付费生成。", { category: "provider" });
  const j = await json(T + "/generation/image-to-model", {
    method: "POST", headers: { Authorization: `Bearer ${key("TRIPO_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: f.data.file_token, ...TRIPO_SETTINGS }),
  }, true);
  return requiredId(j.data?.task_id);
}
export async function pollTripo(id: string) {
  const k = key("TRIPO_API_KEY");
  const j = await json(T + "/tasks/" + encodeURIComponent(id), { headers: { Authorization: `Bearer ${k}` } });
  if (!j.data?.status) throw new ProviderError("Tripo：查询结果缺少任务状态，可继续查询原任务。", { category: "provider" });
  if (["failed", "cancelled", "banned", "expired"].includes(j.data.status)) {
    const labels: Record<string, string> = { failed: "服务商生成失败", cancelled: "任务已取消", banned: "输入内容被服务商拒绝", expired: "任务或文件已过期" };
    throw new ProviderError(`Tripo：${labels[j.data.status]}。${safeText(j.data.error_message || "", [k])}${j.request_id ? `（请求编号：${safeText(j.request_id, [k])}）` : ""}`, {
      category: j.data.status === "banned" ? "parameters" : "provider", terminal: true,
      taskStatus: j.data.status, code: j.data.error_code, requestId: j.request_id,
      credits: creditNumber(j.data.credits_consumed) ?? (["failed", "cancelled"].includes(j.data.status) ? 0 : undefined),
    });
  }
  if (!["queued", "running", "success"].includes(j.data.status)) throw new ProviderError("Tripo：未知任务状态，已保留任务编号，请稍后继续查询。", { category: "provider" });
  return j.data.status === "success" ? j.data : null;
}
export function parseIntent(s: string) {
  if (!s.trim()) throw Error("请填写具体家具，或选择无需处理。");
  const all = /全部|所有|all/i.test(s);
  const chosen = categories.filter((c) => all || c.pattern.test(s));
  if (!chosen.length)
    throw Error(
      "未理解要处理的家具。请写明床、书桌、柜子、椅子或沙发，也可以手动圈选。",
    );
  return chosen;
}
