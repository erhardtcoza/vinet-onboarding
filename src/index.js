// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Favicon quick wins
    if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.png") {
      return new Response(null, { status: 204 });
    }

    const router = new Router();
    mountAll(router); // mounts per-host route groups

    const res = await router.handle(request, env, ctx);
    if (res) return res;

    // Friendly default for unknown paths (HTML, not a "download")
    const html = `<!doctype html><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet Onboarding</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f7f7f8;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .card{background:#fff;max-width:780px;padding:28px 32px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.06)}
  .bar{height:6px;background:#e10600;border-radius:4px;margin:12px 0 18px}
  .muted{color:#6b7280}
</style>
<div class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" height="40"/>
  <div class="bar"></div>
  <h1 style="margin:0 0 6px">Vinet Onboarding</h1>
  <p class="muted">Use the correct host:</p>
  <ul class="muted">
    <li><b>new.vinet.co.za</b> — self sign up</li>
    <li><b>crm.vinet.co.za</b> — CRM intake dashboard</li>
    <li><b>onboard.vinet.co.za</b> — Onboarding links/admin</li>
  </ul>
</div>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
