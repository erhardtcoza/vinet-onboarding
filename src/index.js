// ===========================
// Vinet: Single-Worker, 3 hosts
// - new.vinet.co.za     (public capture)
// - crm.vinet.co.za     (admin dashboard & actions)
// - onboard.vinet.co.za (your existing onboarding; paste router into routes/onboarding.js)
// ===========================

import { ensureSchema, nowSec, DATE_TODAY, json, safeStr } from "./utils/db.js";
import { adminHTML } from "./ui/crm_leads.js";
import { publicHTML } from "./ui/public_lead.js";
import { handleOnboarding } from "./routes/onboarding.js";
import { matchAndUpsertLead, splynxCreateOrOverwrite } from "./utils/splynx.js";
import { sendOnboardingWA, normalizeMsisdn } from "./utils/wa.js";

// ---------- Config ----------
const IP_OK = (request) => {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143; // 160.226.128.0/20
};

// ---------- PUBLIC API (new.*) ----------
async function handlePublic(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Serve inline page
  if (request.method === "GET" && (path === "/" || path === "/index" || path === "/index.html")) {
    return new Response(publicHTML(), { headers: { "content-type": "text/html; charset=utf-8" }});
  }

  // POST /submit — queue lead (no Splynx call here)
  if (request.method === "POST" && path === "/submit") {
    await ensureSchema(env.DB);

    const form = await request.formData().catch(()=>null);
    if (!form) return json({ error:"Bad form" }, 400);

    const full_name = safeStr(form.get("full_name"));
    const phone     = safeStr(form.get("phone"));
    const email     = safeStr(form.get("email"));
    const source    = safeStr(form.get("source"));
    const city      = safeStr(form.get("city"));
    const street    = safeStr(form.get("street"));
    const zip       = safeStr(form.get("zip"));
    const service   = safeStr(form.get("service"));
    const partner   = safeStr(form.get("partner") || "main");
    const location  = safeStr(form.get("location") || "main");
    const consent   = !!form.get("consent");

    if (!full_name || !phone || !email || !source || !city || !street || !zip || !service || !consent) {
      return json({ error:"Missing required fields" }, 400);
    }

    const payload = {
      name: full_name,
      phone,
      email,
      source,
      city,
      street,
      zip,
      billing_email: email,
      score: 1,
      date_added: DATE_TODAY(),
      captured_by: "public",
      service_interested: service,
      partner,
      location
    };

    try {
      await env.DB.prepare(`
        INSERT INTO leads (
          name, phone, email, source, city, street, zip, billing_email,
          score, date_added, captured_by, synced
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8, 1, ?9, 'public', 0)
      `).bind(
        payload.name, payload.phone, payload.email, payload.source, payload.city,
        payload.street, payload.zip, payload.billing_email, payload.date_added
      ).run();

      await env.DB.prepare(`
        INSERT INTO leads_queue (sales_user, created_at, payload, uploaded_files, processed, splynx_id, synced)
        VALUES ('public', ?1, ?2, '[]', 0, NULL, '0')
      `).bind(nowSec(), JSON.stringify(payload)).run();

      const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
      return json({ ok:true, ref });
    } catch (e) {
      return json({ error:"DB insert failed", detail:String(e) }, 500);
    }
  }

  return new Response("Not found", { status: 404 });
}

// ---------- ADMIN (crm.*) ----------
async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Gate by IP first
  if (!IP_OK(request)) {
    return new Response(
      "<!doctype html><h1 style='color:#e2001a;font-family:sans-serif'>Access Denied</h1><p>Your IP is not allowed.</p>",
      { status: 403, headers: { "content-type":"text/html" } }
    );
  }

  if (request.method === "GET" && (path === "/" || path === "/index" || path === "/index.html")) {
    return new Response(adminHTML(), { headers: { "content-type": "text/html; charset=utf-8" }});
  }

  if (request.method === "GET" && path === "/api/admin/queue") {
    await ensureSchema(env.DB);
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue WHERE processed=0 ORDER BY created_at DESC LIMIT 500"
    ).all();

    const parsed = (rows.results||[]).map(r => ({
      id: r.id,
      sales_user: r.sales_user,
      created_at: r.created_at,
      processed: r.processed,
      splynx_id: r.splynx_id,
      payload: (()=>{ try{return JSON.parse(r.payload||"{}")}catch{return{}} })()
    }));

    return json({ rows: parsed });
  }

  if (request.method === "POST" && path === "/api/admin/update") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id || !body.payload) return json({ error:"Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2")
      .bind(JSON.stringify(body.payload), body.id).run();
    return json({ ok:true });
  }

  // Pre-match endpoint: returns candidates based on email/phone/name
  if (request.method === "POST" && path === "/api/admin/match") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id) return json({ error:"Bad request" }, 400);

    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1")
      .bind(body.id).first();
    if (!row) return json({ error:"Not found" }, 404);

    const p = (()=>{ try{return JSON.parse(row.payload||"{}")}catch{return{}} })();
    const { candidates, error } = await matchAndUpsertLead(env, p, { onlyMatch: true });
    if (error) return json({ error:true, detail:error }, 500);
    return json({ ok:true, candidates });
  }

  // Submit: create or overwrite (mode: "create" | "overwrite"), target_id optional
  if (request.method === "POST" && path === "/api/admin/submit") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id || !body.mode) return json({ error:"Bad request" }, 400);

    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1")
      .bind(body.id).first();
    if (!row) return json({ error:"Not found" }, 404);

    const p = (()=>{ try{return JSON.parse(row.payload||"{}")}catch{return{}} })();
    const { resultId, error } = await splynxCreateOrOverwrite(env, p, body.mode, body.target_id);
    if (error) return json({ error:true, detail:error }, 500);

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2")
      .bind(resultId||null, body.id).run();

    // mirror to leads table
    if (resultId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3")
        .bind(resultId, p.email||"", p.phone||"").run();
    }

    return json({ ok:true, id: resultId });
  }

  // Send WA onboarding (uses two template text params: Name, URL)
  if (request.method === "POST" && path === "/api/admin/wa") {
    const body = await request.json().catch(()=>null);
    if (!body || !body.id) return json({ error:"Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload, splynx_id FROM leads_queue WHERE id=?1")
      .bind(body.id).first();
    if (!row) return json({ error:"Not found" }, 404);

    const p = (()=>{ try{return JSON.parse(row.payload||"{}")}catch{return{}} })();
    const name = p.name || "there";
    const msisdn = normalizeMsisdn(p.phone || "");
    const code = `${(p.name||'client').split(' ')[0].toLowerCase()}_${Math.random().toString(36).slice(2,8)}`;
    const onboardingUrl = `https://onboard.vinet.co.za/onboard/${code}`;

    const ok = await sendOnboardingWA(env, msisdn, name, onboardingUrl);
    return ok ? json({ ok:true, url: onboardingUrl }) : json({ error:true, detail:"WA send failed" }, 500);
  }

  return new Response("Not found", { status: 404 });
}

// ---------- MAIN ----------
export default {
  async fetch(request, env, ctx) {
    const host = (new URL(request.url)).host.toLowerCase();

    if (host === "new.vinet.co.za")    return handlePublic(request, env, ctx);
    if (host === "crm.vinet.co.za")    return handleAdmin(request, env, ctx);
    if (host === "onboard.vinet.co.za")return handleOnboarding(request, env, ctx);

    return new Response("Host not configured", { status: 400 });
  }
};
