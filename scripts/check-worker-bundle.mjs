// Guard for `npm run build:worker`: Cloudflare validates the bundle's STATIC
// import graph at upload and rejects any `import ... from "node:*"` — even one
// whose code never runs on Workers (that exact failure shipped once: a
// top-level `node:fs` import in bot.ts broke the first canary deploy).
// Dynamic `import("node:*")` inside Node-only functions is fine and allowed.
import { readFileSync } from "node:fs";

const bundle = new URL("../dist/worker.js", import.meta.url);
const src = readFileSync(bundle, "utf8");
const offenders = src.match(/^import\s[^;]*?from\s*["']node:[^"']+["'];?/gm) ?? [];
if (offenders.length > 0) {
  console.error(
    "[check-worker-bundle] FAIL — static node:* imports in dist/worker.js (Cloudflare will reject the upload):",
  );
  for (const line of offenders) console.error("  " + line.trim());
  console.error(
    "Move each into a lazy `await import(\"node:...\")` inside the Node-only function that uses it.",
  );
  process.exit(1);
}
console.log("[check-worker-bundle] OK — no static node:* imports in dist/worker.js");
