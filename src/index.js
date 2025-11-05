// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

const HTML = `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet Onboarding</title>
<link rel="icon" href="data:,">
<style>
  :root{--red:#E10600;--ink:#0b1320;}
  body{margin:0;background:#f7f7f8;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}
  .card{max-width:640px;margin:8vh auto;padding:32px;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
  h1{margin:0 0 8px;font-size:28px}
  p{color:#475467;margin:0 0 16px}
  .bar{height:4px;background:var(--red);border-radius:999px;margin:16px 0 24px}
</style>
<div class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" style="height:42px"/>
  <div class="bar"></div>
  <h1>Vinet Onboarding</h1>
  <p>If you can see this page, the Worker is serving HTML correctly.</p>
  <p>Next: use the admin/onboarding links as usual.</p>
</div>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Quick healthcheck
    if (url.pathname === "/__ping") {
      return new Response("pong", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    // Favicon/ico shortcuts
    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Router
    const router = new Router();
    mountAll(router);

    // TEMP root fallback so "/" never renders blank
    if (url.pathname === "/") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Route with error surface
    try {
      const res = await router.handle(request, env, ctx);
      if (res) return res;
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (err) {
      // Surface the error so we don’t get a blank page
      console.error("Router error:", err);
      return new Response(
        `Internal error:\n${(err && err.stack) || String(err)}`,
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }
  },
};
