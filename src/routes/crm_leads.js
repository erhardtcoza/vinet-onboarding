// /src/routes/crm_leads.js
import { ensureLeadSchema, json, safeParseJSON, nowSec, todayISO } from "../utils/db.js";
import {
  splynxFetchLeads, splynxFetchCustomers, findCandidates,
  buildLeadPayload, createLead, updateLead, findReuseLead,
  listLeads, updateLeadFields, bulkSanitizeLeads
} from "../utils/splynx.js";
import { sendOnboardingTemplate } from "../utils/wa.js";
import { renderCRMHTML } from "../ui/crm_leads.js";

const J = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });
const isAllowed = (req) => {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
};

export function mount(router) {
  // UI shell
  router.add("GET", "/crm", (req) => isAllowed(req) ? new Response(renderCRMHTML(), { headers:{ "content-type":"text/html" } }) : new Response("<h1 style='color:#e2001a'>Access Denied</h1>", { status:403, headers:{ "content-type":"text/html" } }));

  // Queue list
  router.add("GET", "/api/admin/queue", async (req, env) => {
    if (!isAllowed(req)) return J({ error:"forbidden" }, 403);
    await ensureLeadSchema(env);
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue ORDER BY created_at DESC LIMIT 500"
    ).all();
    const res = (rows.results||[]).map(r => ({
      id: r.id, sales_user: r.sales_user, created_at: r.created_at, processed: r.processed,
      splynx_id: r.splynx_id, payload: safeParseJSON(r.payload)
    }));
    return J({ rows: res });
  });

  router.add("GET", "/api/admin/get", async (req, env) => {
    if (!isAllowed(req)) return J({ error:"forbidden" }, 403);
    const id = Number(new URL(req.url).searchParams.get("id")||"0");
    if (!id) return J({ error:"Bad id" }, 400);
    const row = await env.DB.prepare("SELECT id, payload, processed, splynx_id FROM leads_queue WHERE id=?1").bind(id).first();
    if (!row) return J({ error:"Not found" }, 404);
    return J({ id: row.id, payload: safeParseJSON(row.payload), processed: row.processed, splynx_id: row.splynx_id });
  });

  router.add("POST", "/api/admin/update", async (req, env) => {
    if (!isAllowed(req)) return J({ error:"forbidden" }, 403);
    const body = await req.json().catch(()=>null);
    if (!body?.id || !body?.payload) return J({ error:"Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2").bind(JSON.stringify(body.payload), body.id).run();
    return J({ ok:true });
  });

  // Match against Splynx
  router.add("POST", "/api/admin/match", async (req) => {
    const body = await req.json().catch(()=>null);
    if (!body?.payload) return J({ error:"Bad request" }, 400);
    const [leads, customers] = await Promise.all([
      splynxFetchLeads(body.payload),
      splynxFetchCustomers(body.payload),
    ]);
    const { leadHits, custHits } = findCandidates(body.payload, leads, customers);
    return J({ leads: leadHits, customers: custHits });
  });

  // Pull a page of leads (for cleanup)
  router.add("GET", "/api/admin/splynx/fetch", async (req) => {
    const u = new URL(req.url);
    const status = (u.searchParams.get("status") || "").trim();
    const limit  = Number(u.searchParams.get("limit") || "50");
    const offset = Number(u.searchParams.get("offset") || "0");
    const rows = await listLeads({ status, limit, offset });
    return J({ ok: true, rows });
  });

  // Update one lead quickly
  router.add("POST", "/api/admin/splynx/update", async (req) => {
    const body = await req.json().catch(() => null);
    if (!body?.id || !body?.fields) return J({ error:"Bad request" }, 400);
    const res = await updateLeadFields(Number(body.id), body.fields);
    return J(res);
  });

  // Bulk sanitize
  router.add("POST", "/api/admin/splynx/bulk-sanitize", async (req) => {
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return J({ error:"No ids" }, 400);
    const res = await bulkSanitizeLeads(ids);
    return J(res);
  });

  // Submit to Splynx (overwrite/exact/re-use/new)
  router.add("POST", "/api/admin/submit", async (req, env) => {
    const body = await req.json().catch(()=>null);
    if (!body?.id) return J({ error:"Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return J({ error:"Not found" }, 404);
    const p = safeParseJSON(row.payload);
    const payload = buildLeadPayload(p);

    const allLeads = await splynxFetchLeads({});
    let splynxId = null;

    if (body.overwrite_id) {
      await updateLead("lead", Number(body.overwrite_id), payload);
      splynxId = Number(body.overwrite_id);
    } else {
      const exact = (Array.isArray(allLeads)?allLeads:[]).find(l =>
        (String(l.email||"").toLowerCase() === String(p.email||"").toLowerCase()) ||
        (String(l.phone||"") === String(p.phone||""))
      );
      if (exact) {
        await updateLead("lead", exact.id, payload);
        splynxId = exact.id;
      } else {
        const reuse = await findReuseLead();
        if (reuse) {
          await updateLead("lead", reuse.id, payload);
          splynxId = reuse.id;
        } else {
          const created = await createLead(payload);
          splynxId = created?.id || null;
        }
      }
    }

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2").bind(splynxId, body.id).run();
    if (splynxId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3").bind(splynxId, p.email||"", p.phone||"").run();
    }
    return J({ ok:true, id: splynxId });
  });

  // Send WA onboarding
  router.add("POST", "/api/admin/wa", async (req, env) => {
    const body = await req.json().catch(()=>null);
    if (!body?.id) return J({ error:"Bad request" }, 400);
    const row = await env.DB.prepare("SELECT payload, splynx_id FROM leads_queue WHERE id=?1").bind(body.id).first();
    if (!row) return J({ error:"Not found" }, 404);
    const p = safeParseJSON(row.payload);
    const code = `${(p.name||'client').split(' ')[0].toLowerCase()}_${Math.random().toString(36).slice(2,8)}`;
    const url = `https://onboard.vinet.co.za/onboard/${code}`;
    await sendOnboardingTemplate(env, p.phone, p.name || "there", url, "en_US");
    return J({ ok:true, url });
  });
}
