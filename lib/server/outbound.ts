import { bindings } from "./storage";
// Provider hosts are reached through the dev server's loopback relay when it is configured
// (local mode), because the Worker runtime cannot use the machine's HTTP proxy.
const RELAYED = ["worldlabs.ai", "tripo3d.ai", "tripo3d.com"];
export function outbound(url: string, init: RequestInit = {}) {
  const relay = bindings().secrets.LOCAL_RELAY as string | undefined;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (!relay || !RELAYED.some((d) => host === d || host.endsWith("." + d))) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set("x-relay-url", url);
  return fetch(relay, { ...init, headers });
}
