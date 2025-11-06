// /src/routes/admin.js
import { ensureLeadSchema } from "../utils/db.js";
import { handleAdmin } from "../admin/routes.js"; // backend API logic
import { adminHTML } from "../admin/ui.js";

/* ---------------- Helper: return HTML ---------------- */
const html = (s, c = 200) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });

/* ---------------- Mount Admin Routes ---------------- */
export function mount(router) {
  // Default admin dashboard home
  router.add("GET", "/", async () => {
    return html(await renderSplashPage());
  });

  router.add("GET", "/admin", async () => {
    await ensureLeadSchema();
    return html(adminHTML());
  });

  // CRM Admin path (/crm and /admin/queue both show UI)
  router.add("GET", "/crm", async () => {
    await ensureLeadSchema();
    return html(adminHTML());
  });

  router.add("GET", "/admin/queue", async () => {
    await ensureLeadSchema();
    return html(adminHTML());
  });

  // Handle API calls under /api/admin/*
  router.add("ALL", "/api/admin/*", async (req, env, ctx) => {
    return handleAdmin(req, env, ctx);
  });

  return router;
}

/* ---------------- Optional splash for CRM root ---------------- */
function renderSplashPage() {
  return `<!doctype html>
  <meta charset="utf-8"/>
  <title>Vinet CRM</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#fafafa;color:#0b1320;margin:0;display:flex;align-items:center;justify-content:center;height:100vh}
    .card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 10px 40px rgba(0,0,0,.1);text-align:center;max-width:420px}
    h1{color:#e2001a;margin:0 0 12px}
    a.btn{display:inline-block;margin-top:20px;background:#e2001a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none}
  </style>
  <div class="card">
    <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" style="height:60px;border-radius:8px;margin-bottom:12px"/>
    <h1>Vinet CRM Admin</h1>
    <p>Manage your captured leads, Splynx sync, and onboarding workflow.</p>
    <a class="btn" href="/admin/queue">Open Dashboard</a>
  </div>`;
}
