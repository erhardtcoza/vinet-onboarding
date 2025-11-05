// /src/routes/admin.js
import { json } from "../utils/http.js";
import { ensureLeadSchema } from "../utils/db.js";
import { isAllowedIP } from "../branding.js";
import { handle } from "./crm_leads.js"; // reuse all existing /api/admin/* handlers

const html = (s, c = 200) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });

function adminHomeHTML() {
  return `<!doctype html><meta charset="utf-8"/>
<title>Vinet CRM · Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--card:#fff;--bg:#f7f7f8}
  body{margin:0;background:var(--bg);font-family:system-ui}
  .card{max-width:880px;margin:4rem auto;background:var(--card);border-radius:16px;box-shadow:0 10px 30px #0002;padding:24px}
  h1{margin:0 0 8px;font-size:24px}
  .btn{display:inline-block;background:#000;color:#fff;border-radius:10px;padding:12px 16px;text-decoration:none}
  .btn.red{background:var(--red)}
</style>
<main class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" style="height:42px;border-radius:8px"/>
  <h1>CRM Admin</h1>
  <p>Queue review, Splynx sync, onboarding links & WhatsApp.</p>
  <p><a class="btn red" href="/admin/queue">Open dashboard</a></p>
</main>`;
}

export function mount(router) {
  // Root for crm.vinet.co.za (serve HTML, never a 204)
  router.add("GET", "/", (req) => {
    const host = new URL(req.url).host.toLowerCase();
    if (host !== "crm.vinet.co.za") return null; // let others handle
    if (!isAllowedIP(req)) {
      return html("<h1 style='color:#e2001a;font-family:system-ui'>Access Denied</h1>", 403);
    }
    return html(adminHomeHTML());
  });

  // Lightweight alias so you have a linkable path
  router.add("GET", "/admin/queue", async (req, env) => {
    if (!isAllowedIP(req)) return html("<h1 style='color:#e2001a;font-family:system-ui'>Access Denied</h1>", 403);
    await ensureLeadSchema(env);
    // Deliver your React/vanilla app shell or a simple placeholder
    return html(`<meta charset="utf-8"><title>Queue</title>
<style>body{font-family:system-ui;margin:24px}</style>
<h2>Leads Queue</h2>
<p>Use your existing JS app to call <code>/api/admin/*</code> endpoints.</p>`);
  });

  // Reuse crm_leads API handlers (so we don’t duplicate)
  router.add("ALL", "/api/admin/*", (req, env, ctx) => handle(req, env, ctx));
}
