// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // (Optional) Convenience: onboard.<domain>/ → /admin
      if (url.hostname.startsWith("onboard.") && url.pathname === "/") {
        return Response.redirect(`${url.origin}/admin`, 302);
      }

      // Build router and mount all route modules (public, admin, pdf, crm, otp, terms, etc.)
      const router = new Router();
      mountAll(router);

      // Route the request via our tiny router API (handle), never .route()
      const res = await router.handle(request, env, ctx);
      if (res) return res;

      return text("Not found", 404);
    } catch (err) {
      console.error("Top-level fetch error:", err && (err.stack || err.message || err));
      return text("Internal Server Error", 500);
    }
  },
};
