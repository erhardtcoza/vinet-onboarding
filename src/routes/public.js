// src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";

/* small helpers */
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });

export function mount(router) {
  // Root landing page
  router.add("GET", "/", async () => {
    try {
      return html(renderLandingHTML());
    } catch (e) {
      console.error("Landing render failed:", e && (e.stack || e.message || e));
      return text("Internal Server Error", 500);
    }
  });

  // Lightweight health probe for quick verification after deploys
  router.add("GET", "/_health", () => text("ok"));
}
