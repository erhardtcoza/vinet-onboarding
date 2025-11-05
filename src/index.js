// src/index.js
import { Router } from "./router.js";
import { mountAll } from "./routes/index.js";

const HOST_REDIRECTS = {
  // host -> path you actually want as the default page on that host
  "crm.vinet.co.za": "/admin",
  "onboard.vinet.co.za": "/onboard",   // change to "/admin" if that’s your entry
  // leave new.vinet.co.za to show the simple landing (or set a path here too)
  // "new.vinet.co.za": "/onboard"     // <- uncomment if you want it to jump somewhere
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Host-based root redirect (fixes "same page on all subdomains")
    if (url.pathname === "/") {
      const target = HOST_REDIRECTS[url.hostname];
      if (target) {
        return Response.redirect(new URL(target, url.origin), 302);
      }
    }

    // Favicon shortcuts
    if (url.pathname === "/favicon.png" || url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Router
    const router = new Router();
    mountAll(router);

    const res = await router.handle(request, env, ctx);
    if (res) return res;

    // Only show the simple landing when nothing else matched AND we’re not on crm/onboard
    if (!HOST_REDIRECTS[url.hostname]) {
      const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Vinet Onboarding</title>
<link rel="icon" href="/favicon.ico"/>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
       background:#f7f7f8;color:#0b1320;margin:0;display:grid;place-items:center;min-height:100dvh}
  .card{background:#fff;max-width:780px;padding:28px 32px;border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,.06)}
  .bar{height:6px;background:#e10600;border-radius:4px;margin:12px 0 18px}
  .muted{color:#6b7280}
</style>
<div class="card">
  <img alt="Vinet" src="https://static.vinet.co.za/logo.jpeg" height="36"/>
  <div class="bar"></div>
  <h1 style="margin:0 0 6px">Vinet Onboarding</h1>
  <p class="muted">If you can see this page, the Worker is serving HTML correctly.</p>
  <p class="muted">Next: use the admin/onboarding links as usual.</p>
</div>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
