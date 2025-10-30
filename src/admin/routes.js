// src/admin/routes.js
import { html, json } from "../utils/http.js";
import { isAllowedIP, DATE_TODAY, nowSec, normalizeMsisdn } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js"; // <-- fix: schema.js
import { splynx } from "../integrations/splynx.js";
import { sendWATemplate } from "../integrations/whatsapp.js";
import { adminHTML } from "../admin/ui.js";

/* ... rest of file unchanged ... */
const WA_TEMPLATE_NAME = "wa_onboarding";
const WA_TEMPLATE_LANG = "en";

export async function handleAdmin(request, env) {
  if (!isAllowedIP(request)) return html("<h1 style='color:#e2001a'>Access Denied</h1>", 403);
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index")) {
    return html(adminHTML());
  }

  await ensureLeadSchema(env);

  if (url.pathname === "/api/admin/queue" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue ORDER BY created_at DESC LIMIT 500"
    ).all();
    const parsed = (rows.results || []).map((r) => ({
      id: r.id,
      sales_user: r.sales_user,
      created_at: r.created_at,
      processed: r.processed,
      splynx_id: r.splynx_id,
      payload: (()=>{ try { return JSON.parse(r.payload||"{}"); } catch { return {}; } })()
    }));
    return json({ rows: parsed });
  }

  if (url.pathname === "/api/admin/update" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.payload) return json({ error: "Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2").bind(JSON.stringify(body.payload), body.id).run();
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/match" && request.method === "POST") {
    const { payload } = await request.json().catch(() => ({}));
    const candidates = [];

    try {
      const rc = await splynx("GET", "/api/2.0/admin/customers/customer");
      const customers = await rc.json().catch(() => []);
      (Array.isArray(customers) ? customers : []).forEach((c) => {
        if (!c) return;
        const hit =
          (payload.email && c.email === payload.email) ||
          (payload.phone && c.phone === payload.phone) ||
          (payload.name && (c.name || "").toLowerCase() === (payload.name||"").toLowerCase());
        if (hit) candidates.push({ id: c.id, name: c.name, email: c.email, phone: c.phone, type: "customer" });
      });
    } catch {}

    try {
      const rl = await splynx("GET", "/api/2.0/admin/crm/leads");
      const leads = await rl.json().catch(() => []);
      (Array.isArray(leads) ? leads : []).forEach((l) => {
        if (!l) return;
        const hit =
          (payload.email && l.email === payload.email) ||
          (payload.phone && l.phone === payload.phone) ||
          (payload.name && (l.name || "").toLowerCase() === (payload.name||"").toLowerCase());
        if (hit) candidates.push({ id: l.id, name: l.name, email: l.email, phone: l.phone, type: "lead" });
      });
    } catch {}

    return json({ matches: candidates });
  }

  if (url.pathname === "/api/admin/submit" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = (()=>{ try { return JSON.parse(row.payload||"{}"); } catch { return {}; } })();

    const leadPayload = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      city: p.city,
      street_1: p.street,
      zip_code: p.zip,
      source: p.source,
      billing_email: p.email,
      score: 1,
      status: "New enquiry",
      date_add: DATE_TODAY(),
      owner: "public"
    };

    let r, splynxId = null;
    if (body.mode === "overwrite" && body.targetId && body.targetType) {
      const path = body.targetType === "customer"
        ? `/api/2.0/admin/customers/customer/${body.targetId}`
        : `/api/2.0/admin/crm/leads/${body.targetId}`;
      r = await splynx("PUT", path, leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      splynxId = body.targetId;
    } else if (body.mode === "reuse") {
      const rl = await splynx("GET", "/api/2.0/admin/crm/leads");
      const leads = await rl.json().catch(() => []);
      const reuse = (Array.isArray(leads) ? leads : []).find((l) => (l.name || "").toLowerCase() === "re-use");
      if (!reuse) return json({ error: true, detail: "No 're-use' lead found" }, 500);
      r = await splynx("PUT", `/api/2.0/admin/crm/leads/${reuse.id}`, leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      splynxId = reuse.id;
    } else {
      r = await splynx("POST", "/api/2.0/admin/crm/leads", leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      const created = await r.json().catch(() => ({}));
      splynxId = created.id || null;
    }

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2")
      .bind(splynxId, body.id).run();
    if (splynxId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3")
        .bind(splynxId, p.email||"", p.phone||"").run();
    }
    return json({ ok: true, id: splynxId });
  }

  if (url.pathname === "/api/admin/wa" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = (()=>{ try { return JSON.parse(row.payload||"{}"); } catch { return {}; } })();

    const name = p.name || "there";
    const phone = normalizeMsisdn(p.phone || "");
    const code = `${(name.split(' ')[0]||'client').toLowerCase()}_${Math.random().toString(36).slice(2,8)}`;
    const urlText = `https://onboard.vinet.co.za/onboard/${code}`;

    const ok = await sendWATemplate(env, phone, WA_TEMPLATE_NAME, WA_TEMPLATE_LANG, name, urlText);
    return ok ? json({ ok: true, url: urlText }) : json({ error: true, detail: "WA send failed" }, 500);
  }

  return null;
}
