// /src/index.js
import { Router } from "./router.js";
import { mount as mountPublic } from "./routes/public.js";
import { mount as mountAdmin } from "./routes/admin.js";
import { mount as mountCRM } from "./routes/crm_leads.js";

// Optional utilities
function text(msg, status = 200, headers = {}) {
  return new Response(msg, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const router = new Router();

    // Mount routes
    mountPublic(router);
    mountAdmin(router);
    mountCRM(router);

    // Health / root check
    router.add("GET", "/ok", () => text("OK"));
    router.add("GET", "/health", () => text("healthy"));
    router.add("GET", "/", async () => {
      // redirect to landing (splash + form)
      return Response.redirect("/lead", 302);
    });

    // Dispatch
    const res = await router.route(request, env, ctx);
    if (res) return res;

    // Default 404 fallback
    return new Response(
      `<h1 style="font-family:system-ui;text-align:center;margin-top:20vh;color:#e2001a">
        404 · Page Not Found
      </h1>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  },
};
