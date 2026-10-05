// Before a commit: no API key from .dev.vars may appear in any file git would take (tracked, or new
// and not ignored). Prints only file names, never the keys.
//   node scripts/security-scan.mjs
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const keys = existsSync(".dev.vars")
  ? readFileSync(".dev.vars", "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""))
      .filter((v) => v.length >= 12)
  : [];
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
const leaks = files.filter((f) => {
  try {
    const data = readFileSync(f);
    return keys.some((k) => data.includes(Buffer.from(k)));
  } catch {
    return false;
  }
});
console.log(JSON.stringify({ keys: keys.length, scanned: files.length, leaks }));
if (leaks.length) process.exit(1);
