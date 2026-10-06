// Where the page loads a stored file from. Locally every stored key goes through the asset route;
// library and demo files are public paths already. The online demo has no server: it resolves keys
// itself (the sample bedroom from Marble's CDN, uploads from the browser), see lib/demo-backend.ts.

let resolver: ((key: string) => string | null) | null = null;
export const setAssetResolver = (r: ((key: string) => string | null) | null) => {
  resolver = r;
};
export const assetUrl = (key?: string | null) =>
  !key ? "" : key.startsWith("/") ? key : (resolver?.(key) ?? "/api/assets?key=" + encodeURIComponent(key));

/** The online demo (Vercel): the page runs without the local server and its paid services. */
export const isOnlineDemo = () => typeof window !== "undefined" && !!(window as { __DIORAMA_ONLINE__?: boolean }).__DIORAMA_ONLINE__;

/** The demo photos (resources/demo/, copied to public/demo/samples/), as files the page can upload. */
export async function samplePhoto(name: "bedroom.jpg" | "bed.png" | "pendant.png") {
  const r = await fetch("/demo/samples/" + name);
  if (!r.ok) throw Error("sample " + name + " " + r.status);
  const blob = await r.blob();
  return new File([blob], name, { type: name.endsWith(".jpg") ? "image/jpeg" : "image/png" });
}
