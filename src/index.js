// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Mount once
    const router = new Router();
    mountAll(router);

    // Favicon/ico shortcuts
    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Route
    const res = await router.handle(request, env, ctx);
    if (res) return res;

    return new Response("Not found", { status: 404 });
  },
};
