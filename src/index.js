// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

// super small helper so iOS doesn't try to download pages
function mimeFromPath(pathname) {
  if (pathname === "/" || !pathname.includes(".")) return "text/html; charset=utf-8";
  const ext = pathname.split(".").pop().toLowerCase();
  switch (ext) {
    case "html": return "text/html; charset=utf-8";
    case "js":   return "application/javascript; charset=utf-8";
    case "mjs":  return "application/javascript; charset=utf-8";
    case "css":  return "text/css; charset=utf-8";
    case "json": return "application/json; charset=utf-8";
    case "svg":  return "image/svg+xml";
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "ico":  return "image/x-icon";
    default:     return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Router
    const router = new Router();
    mountAll(router);

    // Favicon shortcuts
    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    let res = await router.handle(request, env, ctx);
    if (!res) return new Response("Not found", { status: 404 });

    // ---- Minimal header hardening so Safari/iOS doesn't "Download" the page
    const h = new Headers(res.headers);
    const want = mimeFromPath(url.pathname);
    const has = (h.get("content-type") || "").toLowerCase();

    // If route forgot to set a type, or set a generic octet-stream, fix it.
    if ((!has || has.startsWith("application/octet-stream")) && want) {
      h.set("content-type", want);
    }

    // Never force download for our HTML / assets
    if (want && want.startsWith("text/html")) {
      h.delete("content-disposition");
    }

    return new Response(res.body, { status: res.status, headers: h });
  },
};
