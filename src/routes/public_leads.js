// src/routes/public_leads.js
import { ensureLeadSchema, nowSec, todayISO, safeStr, json } from "../utils/db.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

export async function mountPublicLeads(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && (path === "/" || path === "/index" || path === "/index.html")) {
    return new Response(renderPublicLeadHTML(), { headers: { "content-type":"text/html" } });
  }

  if (path === "/submit" && request.method === "POST") {
    await ensureLeadSchema(env);

    const form = await request.formData().catch(()=>null);
    if (!form) return json({ error:"Bad form" }, 400);

    const payload = {
      name: safeStr(form.get("full_name")),
      phone: safeStr(form.get("phone")),
      email: safeStr(form.get("email")),
      source: safeStr(form.get("source")),
      city: safeStr(form.get("city")),
      street: safeStr(form.get("street")),
      zip: safeStr(form.get("zip")),
      billing_email: safeStr(form.get("email")),
      score: 1,
      date_added: todayISO(),
      captured_by: "public",
      service_interested: safeStr(form.get("service")),
      partner: safeStr(form.get("partner")||"main"),
      location: safeStr(form.get("location")||"main")
    };

    // Basic required check
    for (const k of ["name","phone","email","source","city","street","zip","service_interested"]) {
      if (!payload[k]) return json({ error:`Missing ${k}` }, 400);
    }

    // Insert copy in leads (synced=0)
    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,synced,service_interested,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0,?10,?11)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source, payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added, payload.service_interested, nowSec()
    ).run();

    // Queue for admin review/push
    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user, created_at, payload, uploaded_files, processed, splynx_id, synced)
      VALUES ('public', ?1, ?2, '[]', 0, NULL, '0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    return json({ ok:true, ref });
  }

  return null;
}
