// /src/index.js
import { Router } from "./router.js";
import { mount as mountPublic } from "./routes/public.js";
// (If you have other route groups, mount them here too.)
// import { mount as mountAdmin } from "./routes/admin.js";

function runRouter(router, req, env, ctx) {
  if (router && typeof router.route === "function") return router.route(req, env, ctx);
  if (router && typeof router.handle === "function") return router.handle(req, env, ctx);
  if (router && typeof router.fetch === "function") return router.fetch(req, env, ctx);
  // Fallback: no known dispatcher on this Router
  return null;
}

export default {
  async fetch(req, env, ctx) {
    try {
      const router = new Router();

      // Mount your routes
      mountPublic(router, env, ctx);
      // mountAdmin?.(router, env, ctx);

      // Health check (kept here too in case mount fails)
      router.add?.("GET", "/_health", () =>
        new Response("ok", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
      );

      const res = await runRouter(router, req, env, ctx);
      if (res) return res;

      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    } catch (err) {
      // Log full detail to Workers logs; return a clean 500 to the browser
      console.error("Top-level fetch error:", err && err.stack ? err.stack : err);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};
