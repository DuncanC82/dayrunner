import { ASSETS } from "./assets.ts";
const dec = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
Deno.serve((req) => {
  const url = new URL(req.url); let path = url.pathname.replace(/^\/functions\/v1\/site\/?/, "").replace(/^\/site\/?/, "").replace(/^\/+/, "");
  if (!path || !ASSETS[path]) path = "index.html";
  const a = ASSETS[path];
  return new Response(dec(a.b64), { headers: { "Content-Type": a.type, "Cache-Control": path.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
});
