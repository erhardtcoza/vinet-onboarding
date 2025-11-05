// /src/routes/admin.js
import { ensureLeadsTables } from "../utils/db.js";            // make sure DB exists
import { adminHTML } from "../admin/ui.js";                    // the real UI (SPA)
import { handleAdmin } from "../admin/routes.js";              // the real API handlers

const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

export function mount(router) {
  // Home card (optional)
  router.add("GET", "/", async (_req, env) => {
    await ensureLeadsTables(env).catch(() => {});
    return html(`<!doctype html><meta charset="utf-8"/>
<title>Vinet CRM · Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--card:#fff;--bg:#f7f7f8}
  body{margin:0;background:var(--bg);font-family:system-ui}
  .card{max-width:880px;margin:4rem auto;background:var(--card);border-radius:16px;box-shadow:0 10px 30px #0002;padding:24px}
  h1{margin:0 0 8px;font-size:24px}
  .btn{display:inline-block;background:var(--red);color:#fff;border-radius:10px;padding:12px 16px;text-decoration:none}
</style>
<main class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" style="height:42px;border-radius:8px"/>
  <h1>CRM Admin</h1>
  <p>Queue review, Splynx sync, onboarding links & WhatsApp.</p>
  <p><a class="btn" href="/admin/queue">Open dashboard</a></p>
</main>`);
  });

  // The dashboard itself should render the SPA, not the stub text
  router.add("GET", "/admin", async (_req, env) => {
    await ensureLeadsTables(env).catch(() => {});
    return html(adminHTML());
  });
  router.add("GET", "/admin/queue", async (_req, env) => {
    await ensureLeadsTables(env).catch(() => {});
    return html(adminHTML(), 200, { "cache-control": "no-store" });
  });

  // Delegate ALL /api/admin/* to the real handlers
  router.add("ALL", "/api/admin/*", (req, env, ctx) => handleAdmin(req, env, ctx));
}
