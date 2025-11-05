// /src/routes/crm_leads.js
import { ensureLeadSchema, json, safeParseJSON, nowSec, todayISO } from "../utils/db.js";
import {
  splynxFetchLeads, splynxFetchCustomers, findCandidates,
  buildLeadPayload, createLead, updateLead, findReuseLead,
  listLeads, updateLeadFields, bulkSanitizeLeads
} from "../utils/splynx.js";
import { sendOnboardingTemplate } from "../utils/wa.js";

export function mount(router) {
  const html = (s, c = 200) => new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });
  const isAllowedIP = (req) => {
    const ip = req.headers.get("CF-Connecting-IP") || "";
    const [a, b, c] = ip.split(".").map(Number);
    return a === 160 && b === 226 && c >= 128 && c <= 143;
  };

  // Simple CRM landing (HTML) so Safari won’t “download”
  router.add("GET", "/crm", (req) => {
    if (!isAllowedIP(req)) return html("<h1 style='color:#e2001a;font-family:system-ui'>Access Denied</h1>", 403);
    return html(`<meta charset="utf-8"><title>CRM</title><style>body{font-family:system-ui;margin:24px}</style>
<h2>CRM</h2><p>Use the /api/admin/* endpoints from your dashboard app.</p>`);
  });

  // ---- API
  router.add("GET", "/api/admin/queue", async (_req, env) => {
    await ensureLeadSchema(env);
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue ORDER BY created_at DESC LIMIT 500"
    ).all();
    const res = (rows.results || []).map((r) => ({
      id: r.id, sales_user: r.sales_user, created_at: r.created_at, processed: r.processed, splynx_id: r.splynx_id,
      payload: safeParseJSON(r.payload),
    }));
    return json({ rows: res });
  });

  router.add("GET", "/api/admin/get", async (req, env) => {
    const id = Number(new URL(req.url).searchParams.get("id") || "0");
    if (!id) return json({ error: "Bad id" }, 400);
    const row = await env.DB.prepare("SELECT id, payload, processed, splynx_id FROM leads_queue WHERE id=?1").bind(id).first();
    if (!row) return json({ error: "Not found" }, 404);
    return json({ id: row.id, payload: safeParseJSON(row.payload), processed: row.processed, splynx_id: row.splynx_id });
  });

  router.add("POST", "/api/admin/update", async (req, env) => {
    const body = await req.json().catch(() => null);
    if (!body || !body.id || !body.payload) return json({ error: "Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2").bind(JSON.stringify(body.payload), body.id).run();
    return json({ ok: true });
  });

  router.add("POST", "/api/admin/match", async (req) => {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);
    const r = await req.env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!r) return json({ error: "Not found" }, 404);
    const p = safeParseJSON(r.payload);
    const [leads, customers] = await Promise.all([splynxFetchLeads({}), splynxFetchCustomers({})]);
    const { leadHits, custHits } = findCandidates({ name: p.name, email: p.email, phone: p.phone }, leads, customers);
    return json({ leads: leadHits, customers: custHits });
  });

  router.add("GET", "/api/admin/splynx/fetch", async (req) => {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "").trim();
    const limit = Number(url.searchParams.get("limit") || "50");
    const offset = Number(url.searchParams.get("offset") || "0");
    const rows = await listLeads({ status, limit, offset });
    const light = rows.map((x) => ({
      id: x.id, status: x.status || "", name: x.name || "", email: x.email || "", phone: x.phone || "",
      city: x.city || "", last_contacted: x.last_contacted || "",
    }));
    return json({ ok: true, rows: light });
  });

  router.add("POST", "/api/admin/splynx/update", async (req) => {
    const body = await req.json().catch(() => null);
    if (!body || !body.id || !body.fields) return json({ error: "Bad request" }, 400);
    const res = await updateLeadFields(Number(body.id), body.fields);
    return json(res);
  });

  router.add("POST", "/api/admin/splynx/bulk-sanitize", async (req) => {
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return json({ error: "No ids" }, 400);
    const res = await bulkSanitizeLeads(ids);
    return json(res);
  });

  router.add("POST", "/api/admin/submit", async (req, env) => {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);
    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = safeParseJSON(row.payload);
    const payload = buildLeadPayload(p);

    const allLeads = await splynxFetchLeads({});
    let splynxId = null;

    if (body.overwrite_id) {
      await updateLead("lead", Number(body.overwrite_id), payload);
      splynxId = Number(body.overwrite_id);
    } else {
      const exact = (Array.isArray(allLeads) ? allLeads : []).find(
        (l) => (String(l.email || "").toLowerCase() === String(p.email || "").toLowerCase()) || (String(l.phone || "") === String(p.phone || ""))
      );
      if (exact) {
        await updateLead("lead", exact.id, payload);
        splynxId = exact.id;
      } else {
        const reuse = await findReuseLead();
        if (reuse) { await updateLead("lead", reuse.id, payload); splynxId = reuse.id; }
        else { const created = await createLead(payload); splynxId = created?.id || null; }
      }
    }

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2").bind(splynxId, body.id).run();
    if (splynxId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3").bind(splynxId, p.email || "", p.phone || "").run();
    }
    return json({ ok: true, id: splynxId });
  });

  router.add("POST", "/api/admin/wa", async (req, env) => {
    const body = await req.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);
    const row = await env.DB.prepare("SELECT payload, splynx_id FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = safeParseJSON(row.payload);
    const code = `${(p.name || "client").split(" ")[0].toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
    const onboardingUrl = `https://onboard.vinet.co.za/onboard/${code}`;
    try { await sendOnboardingTemplate(env, p.phone, p.name, onboardingUrl, "en_US"); return json({ ok: true, url: onboardingUrl }); }
    catch (e) { return json({ error: true, detail: String(e) }, 500); }
  });
}

// Export a consolidated handler so admin.js can route /api/admin/* here
export async function handle(req, env, ctx) {
  // This file is mounted via router in admin.js (above).
  return new Response("Not found", { status: 404 });
}
