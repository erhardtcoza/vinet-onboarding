// src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";

/* ---------------- small helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });

const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });

const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

/**
 * Public routes: landing, health, robots.
 * NOTE: renderLandingHTML may be async, so we always await it.
 */
export function mount(router) {
  // Landing page
  router.add("GET", "/", async (_req) => {
    try {
      const markup = await renderLandingHTML(); // <-- important
      return html(markup);
    } catch (e) {
      console.error("Landing render failed:", e && (e.stack || e.message || e));
      return text("Internal Server Error", 500);
    }
  });

  // Healthcheck for quick probes
  router.add("GET", "/_health", () => text("ok"));

  // Basic robots
  router.add("GET", "/robots.txt", () =>
    text(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /api/",
        "",
      ].join("\n"),
      200,
      { "content-type": "text/plain; charset=utf-8" }
    )
  );

  // Optional: lightweight favicon handler (avoids 404 noise)
  router.add("GET", "/favicon.ico", () => new Response(null, { status: 204 }));
}

export default { mount };
