import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const call = async (body, user = "qa-owner") => {
  const r = await fetch(base + "/api/workbench", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "oai-authenticated-user-id": user,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const get = async (id, user = "qa-owner") => {
  const r = await fetch(base + "/api/workbench?id=" + id, {
    headers: { "oai-authenticated-user-id": user },
  });
  return { status: r.status, data: await r.json() };
};
const demo = (await call({ action: "create", mode: "demo" })).data;
assert.equal(demo.items.length, 3);
const items = structuredClone(demo.items);
items[0].status = "placed";
items[0].position = [1, 0, 2];
items[0].rotation = Math.PI / 4;
items[0].scale = 1.2;
let saved = await call({
  action: "save",
  id: demo.id,
  items,
  floor: demo.floor,
});
assert.equal(saved.status, 200);
let restored = await get(demo.id);
assert.deepEqual(restored.data.items[0].position, [1, 0, 2]);
assert.equal(restored.data.items[0].scale, 1.2);
await call({
  action: "save",
  id: demo.id,
  items: items.slice(1),
  floor: demo.floor,
});
assert.equal((await get(demo.id)).data.items.length, 2);
await call({ action: "save", id: demo.id, items, floor: demo.floor });
assert.equal(
  (await get(demo.id)).data.items.length,
  3,
  "undo restores archived object after save",
);
assert.notEqual(
  (await get(demo.id, "another-user")).status,
  200,
  "cross-user read blocked",
);
const real = (await call({ action: "create", mode: "real" })).data;
const f = new FormData();
f.append("id", real.id);
f.append("role", "original");
f.append(
  "file",
  new Blob([await readFile(process.env.TEST_IMAGE || "../upload/image.png")], {
    type: "image/png",
  }),
  "room.png",
);
const u = await fetch(base + "/api/workbench", {
  method: "POST",
  headers: { "oai-authenticated-user-id": "qa-owner" },
  body: f,
});
assert.equal(u.status, 200);
const uploaded = await u.json();
assert.equal(uploaded.project.stage, "branch");
for (const [branch, intent] of [
  ["remove", "删除书桌"],
  ["edit", "床和书桌"],
]) {
  const r = await call({ action: "detect", id: real.id, branch, intent });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /FAL_KEY/);
  assert.equal(
    (await get(real.id)).data.tasks.length,
    0,
    "no paid tasks when blocked",
  );
}
assert.match(
  (await call({ action: "detect", id: real.id, branch: "remove", intent: "" }))
    .data.error,
  /填写/,
);
assert.match(
  (
    await call({
      action: "detect",
      id: real.id,
      branch: "edit",
      intent: "钢琴",
    })
  ).data.error,
  /未理解/,
);
const a = await fetch(
  base + "/api/assets?key=" + encodeURIComponent(uploaded.key),
  { headers: { "oai-authenticated-user-id": "qa-owner" } },
);
assert.equal(a.status, 200);
const other = await fetch(
  base + "/api/assets?key=" + encodeURIComponent(uploaded.key),
  { headers: { "oai-authenticated-user-id": "another-user" } },
);
assert.equal(other.status, 404);
console.log(
  JSON.stringify(
    {
      passed: 12,
      checks: [
        "demo creates 3 objects",
        "save transform",
        "restore after reload",
        "remove",
        "undo after save",
        "cross-user isolation",
        "real photo upload",
        "A missing credential gate",
        "B missing credential gate",
        "empty intent gate",
        "unsupported intent feedback",
        "private asset access",
      ],
      realProject: real.id,
    },
    null,
    2,
  ),
);
