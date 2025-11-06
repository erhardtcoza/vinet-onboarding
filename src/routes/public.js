// src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";

/* ---------------- small helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

/**
 * Mount public routes
 *  - /             → landing
 *  - /landing      → landing (alias)
 *  - /splash       → splash card
 *  - /_health      → health probe
 *  - /robots.txt   → allow all
 */
export function mount(router) {
  // Health
  router.add("GET", "/_health", () => text("ok"));

  // Robots
  router.add("GET", "/robots.txt", () =>
    text("User-agent: *\nAllow: /\n", 200, { "content-type": "text/plain" })
  );

  // Landing (root)
  router.add("GET", "/", () => html(renderLandingHTML()));

  // Explicit aliases so direct deep-links don’t 404
  router.add("GET", "/landing", () => html(renderLandingHTML()));
  router.add("GET", "/splash", () => html(splashHTML()));
}
