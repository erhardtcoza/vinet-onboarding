// /src/routes/public_leads.js
import { renderPublicLeadHTML } from "../ui/public_lead.js";
import { insertLead } from "../leads-storage.js";

const html = (s, c = 200) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });

function hasTsOk(req) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some(p => p.trim() === "ts_ok=1");
}

export function mountPublicLeads(router) {
  // Page
  router.add("GET", "/lead", (_req) => html(renderPublicLeadHTML()));

  // Submit
  router.add("POST", "/submit", async (req, env) => {
    if (!hasTsOk(req)) {
      return json({ ok: false, error: "Security check required (Turnstile)" }, 400);
    }

    const fd = await req.formData();
    const data = {
      name: (fd.get("full_name") || "").toString().trim(),
      phone: (fd.get("phone") || "").toString().trim(),
      whatsapp: (fd.get("phone") || "").toString().trim(),
      email: (fd.get("email") || "").toString().trim(),
      source: (fd.get("source") || "Website").toString(),
      city: (fd.get("city") || "").toString(),
      street: (fd.get("street") || "").toString(),
      zip: (fd.get("zip") || "").toString(),
      service: (fd.get("service") || "").toString(),
      captured_by: "public",
    };

    try {
      await insertLead(env, data);
      // lightweight ref
      const ref = Math.floor(Date.now()/1000).toString(36);
      return json({ ok: true, ref });
    } catch (e) {
      return json({ ok: false, error: "DB insert failed" }, 500);
    }
  });
}
