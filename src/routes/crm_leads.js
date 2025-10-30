// src/routes/crm_leads.js
import { ensureLeadSchema, json, safeParseJSON, nowSec, todayISO } from "../utils/db.js";
import { splynxFetchLeads, splynxFetchCustomers, findCandidates, buildLeadPayload, createLead, updateLead, findReuseLead } from "../utils/splynx.js";
import { sendOnboardingTemplate } from "../utils/wa.js";
import { renderCRMHTML } from "../ui/crm_leads.js";
import { listLeads, updateLeadFields, bulkSanitizeLeads } from "../splynx.js";

function isAllowedIP(request){
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

export async function mountCRMLeads(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!isAllowedIP(request)) {
    return new Response("<h1 style='color:#e2001a;font-family:sans-serif'>Access Denied</h1>", { status:403, headers:{ "content-type":"text/html" }});
  }

  if (request.method === "GET" && (path === "/" || path === "/index")) {
    return new Response(renderCRMHTML(), { headers: { "content-type":"text/html" } });
  }

  if (path === "/api/admin/queue" && request.method === "GET") {
    await ensureLeadSchema(env);
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue ORDER BY created_at DESC LIMIT 500"
    ).all();
    const res = (rows.results||[]).map(r => ({
      id: r.id,
      sales_user: r.sales_user,
      created_at: r.created_at,
      processed: r.processed,
      splynx_id: r.splynx_id,
      payload: safeParseJSON(r.payload)
    }));
    return json({ rows: res });
  }

  if (path === "/api/admin/get" && request.method === "GET") {
    const id = Number(url.searchParams.get("id")||"0");
    if (!id) return json({ error:"Bad id" }, 400);
    const row = await env.DB.prepare("SELECT id, payload, processed, splynx_id FROM leads_queue WHERE id=?1").bind(id).first();
    if (!row) return json({ error:"Not found" }, 404);
    return json({ id: row.id, payload: safeParseJSON(row.payload), processed: row.processed, splynx_id: row.splynx_id });
  }

  if (path === "/api/admin/update" && request.method === "POST") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id || !body.payload) return json({ error:"Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2").bind(JSON.stringify(body.payload), body.id).run();
    return json({ ok:true });
  }

  // Check matches across Splynx Leads & Customers
  if (path === "/api/admin/match" && request.method === "POST") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id) return json({ error:"Bad request" }, 400);
    const r = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!r) return json({ error:"Not found" }, 404);
    const p = safeParseJSON(r.payload);

    const [leads, customers] = await Promise.all([splynxFetchLeads(), splynxFetchCustomers()]);
    const { leadHits, custHits } = findCandidates({ name:p.name, email:p.email, phone:p.phone }, leads, customers);
    return json({ leads: leadHits, customers: custHits });
  }

 // Pull a page of leads from Splynx (e.g., status=lost) for cleanup
if (path === "/api/admin/splynx/fetch" && request.method === "GET") {
  const status = (url.searchParams.get("status") || "").trim(); // e.g. "lost"
  const limit  = Number(url.searchParams.get("limit") || "50");
  const offset = Number(url.searchParams.get("offset") || "0");
  const rows = await listLeads(env, { status, limit, offset });
  // project a light row for the UI
  const light = rows.map(x => ({
    id: x.id,
    status: x.status || "",
    name: x.name || x.full_name || "",
    email: x.email || x.billing_email || "",
    phone: x.phone || x.phone_mobile || "",
    city: x.city || "",
    last_contacted: x.last_contacted || x.last_activity || x.updated || x.date_add || ""
  }));
  return json({ ok: true, rows: light });
}

// Update one lead quickly (rename, tweak status, etc.)
if (path === "/api/admin/splynx/update" && request.method === "POST") {
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.fields) return json({ error: "Bad request" }, 400);
  const res = await updateLeadFields(env, Number(body.id), body.fields);
  return json(res);
}

// Bulk sanitize (rename to "re-use" + wipe PII)
if (path === "/api/admin/splynx/bulk-sanitize" && request.method === "POST") {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return json({ error: "No ids" }, 400);
  const res = await bulkSanitizeLeads(env, ids);
  return json(res);
}
  
  // Create/overwrite in Splynx:
  // - If overwrite_id provided, PUT that ID.
  // - Else: check for existing exact email/phone OR use RE-USE lead. If none, POST new.
  if (path === "/api/admin/submit" && request.method === "POST") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id) return json({ error:"Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return json({ error:"Not found" }, 404);
    const p = safeParseJSON(row.payload);
    const payload = buildLeadPayload(p, "public");

    const allLeads = await splynxFetchLeads();

    let splynxId = null;
    if (body.overwrite_id) {
      await updateLead(Number(body.overwrite_id), payload);
      splynxId = Number(body.overwrite_id);
    } else {
      // try exact hit
      const exact = (allLeads||[]).find(l =>
        (String(l.email||"").toLowerCase() === String(p.email||"").toLowerCase()) ||
        (String(l.phone||"") === String(p.phone||""))
      );
      if (exact) {
        await updateLead(exact.id, payload);
        splynxId = exact.id;
      } else {
        // Try RE-USE lead
        const reuse = await findReuseLead(allLeads);
        if (reuse) {
          await updateLead(reuse.id, payload);
          splynxId = reuse.id;
        } else {
          // Create new
          const created = await createLead(payload);
          splynxId = created?.id || null;
        }
      }
    }

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2").bind(splynxId, body.id).run();
    // Mirror to leads table too
    if (splynxId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3").bind(splynxId, p.email||"", p.phone||"").run();
    }
    return json({ ok:true, id: splynxId });
  }

  // Send WA onboarding (uses 2 placeholders: name, onboarding_url)
  if (path === "/api/admin/wa" && request.method === "POST") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id) return json({ error:"Bad request" }, 400);
    const row = await env.DB.prepare("SELECT payload, splynx_id FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return json({ error:"Not found" }, 404);
    const p = safeParseJSON(row.payload);

    // Build onboarding URL: keep your existing onboarding logic – here a simple code:
    const code = `${(p.name||'client').split(' ')[0].toLowerCase()}_${Math.random().toString(36).slice(2,8)}`;
    const onboardingUrl = `https://onboard.vinet.co.za/onboard/${code}`;

    try {
      await sendOnboardingTemplate(env, p.phone, p.name, onboardingUrl, "en_US");
      return json({ ok:true, url: onboardingUrl });
    } catch (e) {
      return json({ error:true, detail:String(e) }, 500);
    }
  }

  return null;
}
