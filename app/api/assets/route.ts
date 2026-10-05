import { bindings, owner } from "@/lib/server/storage";
export async function GET(req: Request) {
  try {
    const user = owner();
    const query = new URL(req.url).searchParams;
    const key = query.get("key") || "";
    const download = query.get("download");
    const project = key.split("/")[0];
    const { db, bucket } = bindings();
    // A file is readable when it sits in one of the person's spaces, or when one of their spaces
    // uses it: a room reused through the photo fingerprint stays in the folder of the space that
    // first made it, which may since have been deleted.
    const allowed =
      (await db.prepare("SELECT id FROM projects WHERE id=? AND owner=?").bind(project, user).first()) ||
      (await db.prepare("SELECT id FROM projects WHERE owner=? AND instr(data, ?) > 0 LIMIT 1").bind(user, JSON.stringify(key)).first());
    if (!allowed) return new Response("Not found", { status: 404 });
    const obj = await bucket.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type":
          obj.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        ...(download ? {"Content-Disposition":`attachment; filename="room-image.png"; filename*=UTF-8''${encodeURIComponent(download.slice(0,100))}`} : {}),
      },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
