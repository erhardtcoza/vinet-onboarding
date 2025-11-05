// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const router = new Router();
    mountAll(router);

    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    let res = await router.handle(request, env, ctx);
    if (!res) return new Response("Not found", { status: 404 });

    // --- Minimal fix: ensure pages are HTML and never forced to download
    const h = new Headers(res.headers);
    const ct = h.get("content-type") || "";
    if (!ct && url.pathname === "/") h.set("content-type", "text/html; charset=utf-8");
    if (ct.startsWith("text/plain") && url.pathname === "/") h.set("content-type", "text/html; charset=utf-8");
    h.delete("content-disposition"); // prevent “Download” prompt

    return new Response(res.body, { status: res.status, headers: h });
  },
};
