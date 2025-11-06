// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

/* ---------------- Small helper shortcuts ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

/* ---------------- Route Mount ---------------- */
export function mount(router) {
  // Root: splash
  router.add("GET", "/", async () => {
    return html(await renderSplashHTML());
  });

  // Landing page
  router.add("GET", "/landing", async () => {
    return html(await renderLandingHTML());
  });

  // Public lead capture page
  router.add("GET", "/lead", async () => {
    return html(await renderPublicLeadHTML());
  });

  // Example POST endpoint (you can connect to your DB or Splynx here)
  router.add("POST", "/api/public/lead", async (req, env) => {
    const payload = await req.json().catch(() => ({}));
    const required = ["name", "email", "phone"];
    for (const k of required) {
      if (!payload[k]) {
        return json({ ok: false, error: `Missing ${k}` }, 400);
      }
    }

    // Store lead (example stub)
    const queueId = Math.floor(Math.random() * 100000);
    console.log("Received public lead:", payload);

    return json({ ok: true, ref: queueId });
  });

  return router;
}
