import { TRIPO_CREDITS, WORLD_CREDITS } from "../credits";
import { outbound } from "./outbound";
import { isPublic } from "./site";
export type ErrorCategory = "auth" | "balance" | "parameters" | "timeout" | "provider" | "network";
export class ProviderError extends Error {
  category: ErrorCategory;
  requestId?: string;
  code?: string | number;
  retryable = false;
  uncertain = false;
  terminal = false;
  taskStatus?: string;
  credits?: number;
  /** The message in English (`message` is Chinese). */
  en?: string;
  constructor(message: string, options: Partial<ProviderError> & { category: ErrorCategory }) {
    super(message);
    Object.assign(this, options);
    this.category = options.category;
  }
}
export function safeText(value: unknown, secrets: string[] = []) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[hidden]");
  return text.replace(/Bearer\s+\S+/gi, "Bearer [hidden]").slice(0, 700);
}
export function failure(provider: string, status: number, body: any, requestId?: string, secrets: string[] = []) {
  const code = body?.code;
  const category: ErrorCategory = status === 401 || [1000, 1001].includes(Number(code)) ? "auth"
    : status === 402 || Number(code) === 2010 ? "balance"
    : [400, 422].includes(status) || [1004, 2002, 2003, 2004, 2008, 2015].includes(Number(code)) ? "parameters"
    : "provider";
  const labels = {auth:"密钥无效或未获授权",balance:"余额不足",parameters:"参数或输入图片错误",provider:"服务商错误",timeout:"请求超时",network:"网络连接失败"};
  const labelsEn = {auth:"key invalid or not authorised",balance:"not enough credits",parameters:"bad parameters or input image",provider:"provider error",timeout:"request timed out",network:"network connection failed"};
  const detail = safeText(body?.message ?? body?.detail ?? body?.error?.message ?? `HTTP ${status}`, secrets);
  const id = safeText(requestId || body?.request_id || "", secrets);
  return new ProviderError(`${provider}：${labels[category]}。${detail}${id ? `（请求编号：${id}）` : ""}`, {
    en: `${provider}: ${labelsEn[category]}. ${detail}${id ? ` (request ${id})` : ""}`,
    category, code, requestId: id || undefined,
    retryable: status === 429 || status >= 500 || Number(code) === 2000,
  });
}
// Only GET requests are retried. A generation POST is never automatically repeated.
export async function providerJSON(url: string, init: RequestInit = {}, paid = false) {
  const provider = url.includes("tripo3d") ? "Tripo" : "World Labs";
  const headers = new Headers(init.headers);
  const secrets = [headers.get("Authorization")?.replace(/^Bearer /i, "") || "", headers.get("WLT-Api-Key") || ""];
  const maxAttempts = (init.method || "GET") === "GET" ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let error: ProviderError;
    try {
      const response = await outbound(url, { ...init, signal: AbortSignal.timeout(25000) });
      const id = response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
      let body: any;
      try { body = await response.json(); }
      catch {
        if (!response.ok) {
          const e = failure(provider, response.status, {}, id, secrets);
          e.uncertain = paid && (response.status >= 500 || response.status === 408);
          throw e;
        }
        throw new ProviderError(`${provider}：服务商返回了无法解析的结果。${id ? `（请求编号：${safeText(id, secrets)}）` : ""}`, {
          en: `${provider}: the reply could not be read.${id ? ` (request ${safeText(id, secrets)})` : ""}`,
          category: "provider", requestId: id, uncertain: paid && (response.ok || response.status >= 500 || response.status === 408),
          retryable: response.ok || response.status >= 500 || response.status === 429,
        });
      }
      if (!response.ok || (body.code !== undefined && body.code !== 0)) {
        const e = failure(provider, response.status, body, id, secrets);
        e.uncertain = paid && (response.status >= 500 || response.status === 408);
        throw e;
      }
      return body;
    } catch (e) {
      const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
      error = e instanceof ProviderError ? e : new ProviderError(`${provider}：${timedOut ? "请求超时" : "网络连接失败"}。`, {
        en: `${provider}: ${timedOut ? "request timed out" : "network connection failed"}.`,
        category: ["TimeoutError", "AbortError"].includes((e as Error).name) ? "timeout" : "network",
        retryable: true, uncertain: paid,
      });
    }
    if (!error.retryable || attempt + 1 === maxAttempts) throw error;
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new ProviderError("查询未完成", { en: "The check did not finish.", category: "network" });
}
export function creditNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function billing(kind: string, output: any) {
  return {
    cost: creditNumber(kind === "world" ? output?.cost?.total_credits : output?.credits_consumed),
    details: kind === "world" ? output?.cost?.line_items ?? [] : { credits_consumed: output?.credits_consumed ?? null },
  };
}
export const WORLD_ESTIMATE = WORLD_CREDITS;
export const TRIPO_ESTIMATE = TRIPO_CREDITS;
/**
 * Tripo's best image-to-model: H3.1 with detailed geometry and extreme (8K) PBR textures (base
 * colour, metal/roughness, normal). Models made this way carry `quality: TRIPO_QUALITY` in their
 * job, so only they are reused for a photo seen again.
 */
export const TRIPO_SETTINGS = Object.freeze({
  model: "v3.1-20260211", texture: true, pbr: true, texture_quality: "extreme",
  geometry_quality: "detailed", enable_image_autofix: false,
});
/**
 * The public website has no model optimizer (it needs about 1 GB of memory), so Tripo is asked for
 * a model the browser can load as it comes: detailed PBR textures, at most 150k triangles,
 * meshopt-compressed geometry.
 */
export const TRIPO_WEB_SETTINGS = Object.freeze({
  model: "v3.1-20260211", texture: true, pbr: true, texture_quality: "detailed",
  geometry_quality: "standard", face_limit: 150000, compress: "geometry", enable_image_autofix: false,
});
export const tripoSettings = () => (isPublic() ? TRIPO_WEB_SETTINGS : TRIPO_SETTINGS);
/** The settings a model was made at, recorded in its job so a photo seen again reuses only its like. */
export const tripoQuality = () => (isPublic() ? "web" : "hd");
