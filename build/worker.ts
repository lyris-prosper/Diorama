// The Worker behind the dev server and the public website: every request goes to vinext's app
// router (app/). Online (DIORAMA_PUBLIC=1), a request without a visitor cookie is given a fresh
// visitor id, which the app reads as the owner of what it makes (lib/server/site.ts) and the
// response sets as a cookie. The page's own request comes first, so its API calls carry the id.
import handler from "vinext/server/fetch-handler";
import { VISITOR_COOKIE, visitorOf, visitorCookie } from "../lib/server/site";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    if ((env as unknown as Record<string, string>).DIORAMA_PUBLIC !== "1") return handler.fetch(request, env, ctx);
    // Recognition and background repair run on the Mac only: the page asks, and hears so.
    if (new URL(request.url).pathname === "/api/local/status") return Response.json({ local: false, recognition: false, inpainting: false });
    if (visitorOf(request)) return handler.fetch(request, env, ctx);
    const id = crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set("cookie", [request.headers.get("cookie"), `${VISITOR_COOKIE}=${id}`].filter(Boolean).join("; "));
    const res = await handler.fetch(new Request(request, { headers }), env, ctx);
    const out = new Response(res.body, res);
    out.headers.append("Set-Cookie", visitorCookie(id));
    return out;
  },
};
