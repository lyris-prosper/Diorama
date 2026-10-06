// The public website (Cloudflare, DIORAMA_PUBLIC=1) next to the local app on one Mac. Online,
// every visitor is anonymous: a random id in a cookie owns their spaces, and free generation is
// limited per visitor and per day (by that id or by their network address) on top of the site's
// overall credit caps (WORLDLABS_CREDIT_LIMIT, TRIPO_CREDIT_LIMIT). Locally nothing changes: one
// owner, no daily limits.
import { env } from "cloudflare:workers";
import { say } from "./say";

const vars = () => env as unknown as Record<string, string | undefined>;
export const isPublic = () => vars().DIORAMA_PUBLIC === "1";

export const VISITOR_COOKIE = "diorama_visitor";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The visitor id in a request's cookies, when it is a well-formed one. */
export function visitorOf(req: Request) {
  const m = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return m && UUID.test(m[1]) ? m[1] : null;
}
export const visitorCookie = (id: string) => `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
/**
 * Who owns what a request reads and writes. Locally, the one person on this Mac; online, the
 * visitor's cookie (the Worker gives every request without one a fresh id, build/worker.ts).
 */
export function owner(req: Request) {
  if (!isPublic()) return "local-preview";
  const id = visitorOf(req);
  if (!id) throw say("请刷新页面后再试（浏览器需要允许本站的 Cookie）。", "Refresh the page and try again (the browser has to allow this site's cookie).");
  return "visitor-" + id;
}
/**
 * The visitor's network address, hashed (the address itself is never stored); without one (a local
 * preview), the visitor's own id, so visitors are never lumped together.
 */
export async function clientOf(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  if (!ip) return "visitor-" + (visitorOf(req) ?? "none");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("diorama:" + ip));
  return Array.from(new Uint8Array(digest).slice(0, 12), (n) => n.toString(16).padStart(2, "0")).join("");
}

export type Who = { user: string; client: string };
export const DAY = 24 * 60 * 60 * 1000;
const count = (name: string, fallback: number) => {
  const n = Number(vars()[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
/** What one visitor may do each day online. */
export const daily = () => ({
  world: count("DAILY_ROOMS", 1),
  furniture: count("DAILY_PIECES", 4),
  upload: count("DAILY_UPLOADS", 60),
});
export const MAX_SPACES = 10;
/**
 * The SQL condition (and its arguments) that keeps a submission within the visitor's daily
 * allowance: none locally. Counted by visitor id or network address, so a new cookie alone
 * doesn't reset it.
 */
export function quotaCheck(kind: "world" | "furniture" | "upload", who: Who) {
  if (!isPublic()) return { sql: "1", args: [] as unknown[] };
  return {
    sql: "(SELECT COUNT(*) FROM submissions WHERE kind=? AND created>? AND (owner=? OR client=?)) < ?",
    args: [kind, Date.now() - DAY, who.user, who.client, daily()[kind]] as unknown[],
  };
}
/** Records a submission; run in the same batch right after the statement it counts. */
export function recordSubmission(db: D1Database, kind: string, who: Who) {
  return db
    .prepare("INSERT INTO submissions(id,owner,client,kind,created) SELECT ?,?,?,?,? WHERE changes() > 0")
    .bind(crypto.randomUUID(), who.user, who.client, kind, Date.now());
}
/** How many of each the visitor can still make today. */
export async function allowanceLeft(db: D1Database, who: Who) {
  const rows = await db
    .prepare("SELECT kind, COUNT(*) AS n FROM submissions WHERE created>? AND (owner=? OR client=?) GROUP BY kind")
    .bind(Date.now() - DAY, who.user, who.client)
    .all<{ kind: string; n: number }>();
  const used = (k: string) => rows.results.find((r) => r.kind === k)?.n ?? 0;
  const d = daily();
  return { rooms: Math.max(0, d.world - used("world")), pieces: Math.max(0, d.furniture - used("furniture")), uploads: Math.max(0, d.upload - used("upload")) };
}
export const usedUp = (kind: "world" | "furniture" | "upload") =>
  kind === "upload"
    ? say("今天上传的照片太多了，明天再来吧。", "That's a lot of uploads for one day. Come back tomorrow.")
    : say(
        `今天的免费额度用完了（每人每天 ${daily().world} 个房间、${daily().furniture} 件家具）。明天再来，或者先看看示例卧室。`,
        `That's today's free generations used (${daily().world} room and ${daily().furniture} pieces a day). Come back tomorrow, or explore the sample bedroom.`,
      );
export const siteSpent = () =>
  say("这个网站的免费生成额度已经全部用完了；示例卧室和家具库还可以继续体验。", "The site's free generations are all used up. The sample bedroom and the library still work.");
