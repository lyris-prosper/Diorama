import { createFalClient } from "@fal-ai/client";
import { bindings, bytes, dataURI } from "./storage";
const W = "https://api.worldlabs.ai/marble/v1";
const T = "https://openapi.tripo3d.ai/v3";
function key(name: string) {
  const v = bindings().secrets[name] || process.env[name];
  if (!v) throw Error(`尚未配置 ${name}，不会启动付费生成。`);
  return v;
}
async function json(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw Error(`服务返回 ${r.status}，请检查余额、凭据或稍后重试。`);
  const j = (await r.json()) as any;
  if (j.code && j.code !== 0) throw Error(`Tripo 错误 ${j.code}`);
  return j;
}
export async function balances() {
  const result: any = {};
  for (const [name, url, header, k] of [
    ["world", "/credits", "WLT-Api-Key", "WORLDLABS_API_KEY"],
    ["tripo", "/account/balance", "Authorization", "TRIPO_API_KEY"],
  ]) {
    try {
      result[name] = await json((name === "world" ? W : T) + url, {
        headers: { [header]: name === "world" ? key(k) : `Bearer ${key(k)}` },
      });
    } catch (e) {
      result[name] = { error: (e as Error).message };
    }
  }
  result.image = !!(bindings().secrets.FAL_KEY || process.env.FAL_KEY);
  return result;
}
export async function startWorld(image: string) {
  const j = await json(W + "/worlds:generate", {
    method: "POST",
    headers: {
      "WLT-Api-Key": key("WORLDLABS_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "marble-1.0-draft",
      display_name: "我的空间",
      permission: { public: false },
      world_prompt: {
        type: "image",
        image_prompt: {
          source: "data_base64",
          data_base64: (await dataURI(image)).split(",")[1],
        },
        text_prompt:
          "Reconstruct the room faithfully. Preserve all visible walls, windows, flooring and remaining furniture. Do not add new furniture.",
        disable_recaption: true,
      },
    }),
  });
  return j.operation_id;
}
export async function pollWorld(id: string) {
  const j = await json(W + "/operations/" + encodeURIComponent(id), {
    headers: { "WLT-Api-Key": key("WORLDLABS_API_KEY") },
  });
  if (j.error)
    throw Object.assign(Error("空间生成失败，请查看任务后重试。"), {
      terminal: true,
    });
  if (!j.done) return null;
  const w = await json(
    W + "/worlds/" + encodeURIComponent(j.response.world_id),
    { headers: { "WLT-Api-Key": key("WORLDLABS_API_KEY") } },
  );
  return { ...w, cost: j.cost };
}
export async function startTripo(image: string) {
  const b = await bytes(image);
  const form = new FormData();
  form.append("file", new Blob([b.buffer], { type: b.type }), "furniture.png");
  const f = await json(T + "/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${key("TRIPO_API_KEY")}` },
    body: form,
  });
  const j = await json(T + "/generation/image-to-model", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key("TRIPO_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: f.data.file_token,
      model: "v3.1-20260211",
      texture: true,
      pbr: true,
      texture_quality: "standard",
    }),
  });
  return j.data.task_id;
}
export async function pollTripo(id: string) {
  const j = await json(T + "/tasks/" + encodeURIComponent(id), {
    headers: { Authorization: `Bearer ${key("TRIPO_API_KEY")}` },
  });
  if (["failed", "cancelled"].includes(j.data.status))
    throw Object.assign(Error("家具生成失败，其他家具不受影响。"), {
      terminal: true,
    });
  return j.data.status === "success" ? j.data : null;
}
export const fal = () => createFalClient({ credentials: key("FAL_KEY") });
export const FAL_SEG = "fal-ai/sam-3/image";
export const FAL_ERASE = "fal-ai/bria/eraser";
export async function startImage(kind: string, payload: any) {
  return (
    await fal().queue.submit(kind === "detect" ? FAL_SEG : FAL_ERASE, {
      input:
        kind === "detect"
          ? {
              image_url: await dataURI(payload.image),
              prompt: payload.prompt,
              apply_mask: false,
              return_multiple_masks: true,
              max_masks: 8,
              include_scores: true,
              include_boxes: true,
            }
          : {
              image_url: await dataURI(payload.image),
              mask_url: await dataURI(payload.mask),
              mask_type: "manual",
            },
    })
  ).request_id;
}
export async function pollImage(kind: string, id: string) {
  const model = kind === "detect" ? FAL_SEG : FAL_ERASE;
  const q = await fal().queue.status(model, { requestId: id, logs: false });
  if (q.status !== "COMPLETED") return null;
  return (await fal().queue.result(model, { requestId: id })).data as any;
}
export const categories = [
  { kind: "bed", name: "床", prompt: "bed", pattern: /床|bed/i },
  { kind: "desk", name: "书桌", prompt: "desk", pattern: /桌|desk|table/i },
  {
    kind: "cabinet",
    name: "柜子",
    prompt: "freestanding cabinet",
    pattern: /柜|cabinet|wardrobe/i,
  },
  { kind: "chair", name: "椅子", prompt: "chair", pattern: /椅|chair/i },
  { kind: "sofa", name: "沙发", prompt: "sofa", pattern: /沙发|sofa|couch/i },
];
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
