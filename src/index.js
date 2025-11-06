// /src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

function text(s, c = 200, h = {}) {
  return new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
}
function notFound() {
  return new Response(
    "<!doctype html><meta charset='utf-8'><title>Not found</title><p style='font-family:system-ui'>Not found.</p>",
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export default {
  async fetch(request, env, ctx) {
    try {
      const router = new Router();

      // Always expose a simple health endpoint
      router.add("GET", "/_health", () => text("ok"));

      // Mount the whole route tree (public, admin, onboarding, pdf, crm, etc.)
      mountAll(router);

      // Dispatch using your Router's .handle(request, env, ctx)
      const res = await router.handle(request, env, ctx);
      if (res) return res;

      // Fallback 404 from here if nothing matched
      return notFound();
    } catch (err) {
      // Log full details to Workers logs and return a clean 500
      console.error("Top-level fetch error:", err && err.stack ? err.stack : err);
      return text("Internal Server Error", 500);
    }
  },
};
