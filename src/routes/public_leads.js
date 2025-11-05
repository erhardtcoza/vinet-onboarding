// /src/routes/public_leads.js
import { ensureLeadSchema, nowSec, todayISO, safeStr, json } from "../utils/db.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

async function insertLead(env, payload) {
  await ensureLeadSchema(env);

  for (const k of ["name","phone","email","source","city","street","zip","service_interested"]) {
    if (!payload[k]) return { ok:false, error:`Missing ${k}` };
  }

  await env.DB.prepare(`
    INSERT INTO leads (
      name, phone, email, source, city, street, zip, billing_email,
      score, date_added, captured_by, synced, service_interested, created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0,?10,?11)
  `).bind(
    payload.name, payload.phone, payload.email, payload.source,
    payload.city, payload.street, payload.zip, payload.billing_email,
    payload.date_added, payload.service_interested, nowSec()
  ).run();

  await env.DB.prepare(`
    INSERT INTO leads_queue (sales_user, created_at, payload, uploaded_files, processed, splynx_id, synced)
    VALUES ('public', ?1, ?2, '[]', 0, NULL, '0')
  `).bind(nowSec(), JSON.stringify(payload)).run();

  const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
  return { ok:true, ref };
}

export function mount(router) {
  // UI (also available at /lead for compatibility)
  router.add("GET", "/lead", () =>
    new Response(renderPublicLeadHTML(), { headers: { "content-type": "text/html; charset=utf-8" } })
  );

  // JSON API (preferred)
  router.add("POST", "/api/leads/submit", async (req, env) => {
    let body = await req.json().catch(() => null);
    if (!body) {
      const form = await req.formData().catch(() => null);
      if (form) {
        body = {
          name: safeStr(form.get("name") || form.get("full_name")),
          phone: safeStr(form.get("phone")),
          email: safeStr(form.get("email")),
          source: safeStr(form.get("source") || "web"),
          city: safeStr(form.get("city")),
          street: safeStr(form.get("street")),
          zip: safeStr(form.get("zip")),
          service_interested: safeStr(form.get("service") || form.get("service_interested")),
          partner: safeStr(form.get("partner") || "main"),
          location: safeStr(form.get("location") || "main"),
          notes: safeStr(form.get("notes")),
        };
      }
    }
    if (!body) return json({ error: "Bad request" }, 400);

    const payload = {
      name: safeStr(body.name), phone: safeStr(body.phone), email: safeStr(body.email),
      source: safeStr(body.source || "web"), city: safeStr(body.city), street: safeStr(body.street), zip: safeStr(body.zip),
      billing_email: safeStr(body.email), score: 1, date_added: todayISO(),
      captured_by: "public", service_interested: safeStr(body.service_interested || body.service),
      partner: safeStr(body.partner || "main"), location: safeStr(body.location || "main"),
      notes: safeStr(body.notes),
      location_meta: body.location && typeof body.location === "object" ? body.location : undefined,
    };

    const res = await insertLead(env, payload);
    if (!res.ok) return json({ error: res.error }, 400);
    return json({ ok: true, ref: res.ref, message: "Thanks! We’ve received your details." });
  });

  // Legacy /submit form handler
  router.add("POST", "/submit", async (req, env) => {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: "Bad form" }, 400);

    const payload = {
      name: safeStr(form.get("full_name") || form.get("name")),
      phone: safeStr(form.get("phone")),
      email: safeStr(form.get("email")),
      source: safeStr(form.get("source") || "web"),
      city: safeStr(form.get("city")),
      street: safeStr(form.get("street")),
      zip: safeStr(form.get("zip")),
      billing_email: safeStr(form.get("email")),
      score: 1,
      date_added: todayISO(),
      captured_by: "public",
      service_interested: safeStr(form.get("service") || form.get("service_interested")),
      partner: safeStr(form.get("partner") || "main"),
      location: safeStr(form.get("location") || "main"),
      notes: safeStr(form.get("notes")),
    };

    const res = await insertLead(env, payload);
    if (!res.ok) return json({ error: res.error }, 400);
    return json({ ok: true, ref: res.ref, message: "Thanks! We’ve received your details." });
  });
}
