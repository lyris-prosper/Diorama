// The online demo (npm run build:demo, deployed to Vercel): the same page as the local app, with its
// API answered in the browser (lib/demo-backend.ts) instead of by the local server.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/figtree";
import "../app/globals.css";
import { createRoot } from "react-dom/client";
import { installDemoBackend } from "@/lib/demo-backend";

(window as { __DIORAMA_ONLINE__?: boolean }).__DIORAMA_ONLINE__ = true;

async function start() {
  await installDemoBackend();
  const { default: Workbench } = await import("@/components/editor/Workbench");
  createRoot(document.getElementById("root")!).render(<Workbench />);
}
void start();
