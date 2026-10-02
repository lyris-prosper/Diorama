import { bindings, owner } from "@/lib/server/storage";
export async function GET(req: Request) {
  try {
    const user = owner(req);
    const key = new URL(req.url).searchParams.get("key") || "";
    const project = key.split("/")[0];
    const { db, bucket } = bindings();
    if (
      !(await db
        .prepare("SELECT id FROM projects WHERE id=? AND owner=?")
        .bind(project, user)
        .first())
    )
      return new Response("Not found", { status: 404 });
    const obj = await bucket.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type":
          obj.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
