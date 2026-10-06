import vinext from "vinext";
import { defineConfig } from "vite";
import { localVision } from "./build/local-vision-plugin.mjs";
import { localRelay } from "./build/local-relay-plugin.mjs";
import { localModel } from "./build/local-model-plugin.mjs";
import { rmSync } from "node:fs";

// The project database and file store live in .wrangler/state (Miniflare). The database id and the
// bucket name are how they are found again: changing either opens an empty database or store.
const DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const BUCKET_NAME = "site-creator-r2";
// `DIORAMA_TARGET=cloud` builds the public website (wrangler.cloud.jsonc) instead of the local app.
const CLOUD = process.env.DIORAMA_TARGET === "cloud";

export default defineConfig(async ({ command }) => {
  // Local tools only: no Cloudflare fetches, usage metrics or log files, state kept in the project.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // Vite turns console forwarding on when it detects a coding agent; while the HMR socket is down
      // (the Mac slept, the server restarted) every forwarded warning then fails with “send was
      // called before connect” and the failure is forwarded again. The browser console is enough.
      forwardConsole: false,
    },
    plugins: CLOUD
      ? [
          vinext(),
          cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
            inspectorPort: false,
            configPath: "./wrangler.cloud.jsonc",
            // `npm run preview:cloud` keeps its data apart from the local app's .wrangler/state.
            persistState: { path: ".wrangler/cloud-preview" },
          }),
          {
            // The recognition models (81 MB) only run in the Mac version. The Cloudflare plugin also
            // copies .dev.vars (the API keys) next to the build for `vite preview`: removed, so a
            // preview can't spend credits; online the keys are Worker secrets.
            name: "diorama-cloud-assets",
            apply: "build" as const,
            closeBundle() {
              rmSync("dist/client/vision", { recursive: true, force: true });
              rmSync("dist/server/.dev.vars", { force: true });
            },
          },
        ]
      : [
      // Loopback-only helpers in the dev server: provider relay, model slimming, local vision models.
      ...(command === "serve" ? [localRelay(), localModel(), localVision()] : []),
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          main: "./build/worker.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: DATABASE_ID }],
          r2_buckets: [{ binding: "BUCKET", bucket_name: BUCKET_NAME }],
          vars: {
            // Provider requests go through the dev server's loopback relay (build/local-relay-plugin.mjs).
            LOCAL_RELAY: "http://127.0.0.1:5173/api/local/relay",
            // Generated models are slimmed here before they are stored (build/local-model-plugin.mjs).
            LOCAL_OPTIMIZER: "http://127.0.0.1:5173/api/local/optimize-glb",
          },
        },
      }),
    ],
  };
});
