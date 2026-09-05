// Bundles app/dist into an edge function that serves the SPA with correct content types, then deploys it.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"; import { join, relative, extname } from "node:path"; import { execSync } from "node:child_process";
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
const root = "app/dist"; const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(root);
const map = {}; for (const f of files) map[relative(root, f)] = { type: types[extname(f)] ?? "application/octet-stream", b64: readFileSync(f).toString("base64") };
writeFileSync("supabase/functions/site/assets.ts", `export const ASSETS: Record<string,{type:string,b64:string}> = ${JSON.stringify(map)};\n`);
writeFileSync("supabase/functions/site/index.ts", `import { ASSETS } from "./assets.ts";
const dec = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
Deno.serve((req) => {
  const url = new URL(req.url); let path = url.pathname.replace(/^\\/functions\\/v1\\/site\\/?/, "").replace(/^\\/site\\/?/, "").replace(/^\\/+/, "");
  if (!path || !ASSETS[path]) path = "index.html";
  const a = ASSETS[path];
  return new Response(dec(a.b64), { headers: { "Content-Type": a.type, "Cache-Control": path.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
});
`);
console.log("bundled", Object.keys(map).length, "files");
execSync("supabase functions deploy site --project-ref tylttoheoazyvbuixrrk --no-verify-jwt", { stdio: "inherit" });
console.log("https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/site/");
