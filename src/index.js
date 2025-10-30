// src/index.js
import { handlePublic } from "./public/routes.js";
import { handleAdmin } from "./admin/routes.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Public routes (landing + lead form + submit + PWA)
    const pub = await handlePublic(request, env);
    if (pub) return pub;

    // 2) Admin routes
    const adm = await handleAdmin(request, env);
    if (adm) return adm;

    // 3) Fallback
    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  },
};
