// /src/routes/admin.js
import { html, json } from "../utils/http.js";
import { isAllowedIP } from "../utils/misc.js";
import { ensureLeadSchema } from "../utils/db.js";
import { splynx } from "../integrations/splynx.js"; // thin wrapper (constants-based)
import { adminHTML } from "../admin/ui.js";          // your existing admin UI (dashboard)

export function mount(router) {
  // Admin shell (hosted at /admin). Gate by IP to avoid public access.
  router.add("GET", "/admin", (req) => {
    if (!isAllowedIP(req)) return html("<h1 style='color:#e2001a'>Access Denied</h1>", 403);
    return html(adminHTML());
  });

  // In case you land on "/"
  router.add("GET", "/", (req) => {
    if (!isAllowedIP(req)) return html("<h1 style='color:#e2001a'>Access Denied</h1>", 403);
    return html(adminHTML());
  });

  // (Optional) tiny health
  router.add("GET", "/api/admin/ping", (req) => {
    if (!isAllowedIP(req)) return json({ ok:false, error:"forbidden" }, 403);
    return json({ ok: true, at: Date.now() });
  });

  // Minimal example admin action: list raw Splynx leads (handy while testing)
  router.add("GET", "/api/admin/splynx/leads", async (req) => {
    if (!isAllowedIP(req)) return json({ ok:false, error:"forbidden" }, 403);
    const r = await splynx("GET", "/api/2.0/admin/crm/leads");
    const data = await r.json().catch(() => []);
    return json({ ok: true, items: Array.isArray(data) ? data.slice(0, 200) : [] });
  });

  // Ensure DB ready when you load admin
  router.add("GET", "/api/admin/ensure-db", async (req, env) => {
    if (!isAllowedIP(req)) return json({ ok:false, error:"forbidden" }, 403);
    await ensureLeadSchema(env);
    return json({ ok: true });
  });
}
