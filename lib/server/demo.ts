// The sample bedroom (lib/demo-room.ts) on the server: its room files under `presets/`, which no
// space owns and deleting a space never removes, and reuse of furniture models already generated.
import { bindings, cacheRemote } from "./storage";
import { TRIPO_QUALITY } from "./provider-http";
import { DEMO_ROOM, demoPieceFor, shaOfKey, type DemoModel } from "../demo-room";
import type { Project } from "../types";

/** Room files of the sample bedroom: copied from this Mac when they are here, else downloaded from Marble (free). */
export async function ensureDemoFiles() {
  const { bucket } = bindings();
  let copied = 0;
  for (const f of DEMO_ROOM.files) {
    if (await bucket.head(f.key)) continue;
    const local = await bucket.get(f.local);
    if (local) await bucket.put(f.key, await local.arrayBuffer(), { httpMetadata: { contentType: "application/octet-stream" } });
    else await cacheRemote(f.url, f.key, "spz");
    copied++;
  }
  return copied;
}

/** The sample bedroom as this space's room: calibrated, aligned, nothing erased yet. */
export function applyDemoRoom(p: Project) {
  p.room = {
    ...DEMO_ROOM.room,
    source: "imported",
    preset: DEMO_ROOM.id,
    erasures: [],
    clean: { ...DEMO_ROOM.clean, shift: [...DEMO_ROOM.clean.shift] },
  };
  p.floor = { ...DEMO_ROOM.floor };
  p.stage = "ready";
}

export type Reuse = { model: string; thumbnail?: string; piece?: DemoModel };
/**
 * A model already made from this furniture photo: the sample bedroom's pieces first, then the
 * person's finished high-detail Tripo jobs whose input was the same file (its SHA-256 is in the
 * upload key). Generating again would cost credits for the same result; a model from the earlier,
 * standard settings is not reused, so the photo is made again in high detail.
 */
export async function reusableModel(user: string, photo: string, print?: string): Promise<Reuse | null> {
  const sha = shaOfKey(photo);
  const piece = demoPieceFor(sha, print);
  if (piece) return { model: piece.model, thumbnail: piece.thumbnail, piece };
  if (!sha) return null;
  const { db, bucket } = bindings();
  const jobs = await db
    .prepare("SELECT project,target FROM jobs WHERE owner=? AND kind='furniture' AND status='done' AND instr(payload, ?) > 0 AND json_extract(payload,'$.quality')=? ORDER BY updated DESC LIMIT 10")
    .bind(user, sha, TRIPO_QUALITY)
    .all<{ project: string; target: string }>();
  for (const j of jobs.results) {
    const row = await db.prepare("SELECT data FROM projects WHERE id=? AND owner=?").bind(j.project, user).first<{ data: string }>();
    if (!row) continue;
    const q = JSON.parse(row.data) as Project;
    const it = [...q.items, ...(q.archived ?? [])].find((i) => i.id === j.target);
    // The space that made it may have lost the file since (deleted, nobody else using it).
    if (it?.model && (it.model.startsWith("/") || (await bucket.head(it.model)))) return { model: it.model, thumbnail: it.thumbnail };
  }
  return null;
}
