// /src/routes/onboard.js
import { renderOnboardUI } from "../ui/onboard.js";

const html = (s, c = 200) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });

export function mount(router) {
  // Root page for onboard.vinet.co.za (serve HTML always)
  router.add("GET", "/", (req) => {
    const host = new URL(req.url).host.toLowerCase();
    if (host !== "onboard.vinet.co.za") return null;
    return html(`<!doctype html><meta charset="utf-8"/>
<title>Vinet · Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui;margin:24px}</style>
<h2>Onboarding Links</h2>
<p>Paste your existing list UI here. For per-link, open <code>/onboard/&lt;code&gt;</code>.</p>`);
  });

  // Per-link onboarding UI
  router.add("GET", "/onboard/:linkid", async (_req, env, _ctx, { linkid }) => {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return html("<h1>Link expired or invalid</h1>", 404);
    return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
}
