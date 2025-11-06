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
 * Public routes:
 *   /           → Landing
 *   /landing    → Landing (alias)
 *   /splash     → Splash card
 *   /_health    → Health probe
 *   /robots.txt → Allow all
 */
export function mount(router) {
  router.add("GET", "/_health", () => text("ok"));
  router.add("GET", "/robots.txt", () => text("User-agent: *\nAllow: /\n"));

  // IMPORTANT: await async template fns to avoid "[object Promise]"
  router.add("GET", "/",        async () => html(await renderLandingHTML()));
  router.add("GET", "/landing", async () => html(await renderLandingHTML()));
  router.add("GET", "/splash",  async () => html(await splashHTML()));
}
