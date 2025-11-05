// /src/routes/public_leads.js
import { renderPublicLeadHTML } from "../ui/public_lead.js";
import { insertLead } from "../leads-storage.js";

/* tiny helpers */
const json = (obj, c=200, h={}) =>
  new Response(JSON.stringify(obj), { status:c, headers:{ "content-type":"application/json; charset=utf-8", ...h }});
const html = (s, c=200, h={}) =>
  new Response(s, { status:c, headers:{ "content-type":"text/html; charset=utf-8", ...h }});

function hasCookie(req, name, val) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some(p => {
    if(val == null) return p.toLowerCase().startsWith(name.toLowerCase()+"=");
    return p.trim().toLowerCase() === (name.toLowerCase()+"="+String(val).toLowerCase());
  });
}
const shortId = () => Math.random().toString(36).slice(2,8);

/* mount */
export function mountPublicLeads(router){
  // GET /lead – render form, seed a short session id cookie for display
  router.add("GET", "/lead", (_req, _env) => {
    const sid = shortId();
    const headers = { "set-cookie": `ts_sid=${sid}; Max-Age=86400; Path=/; Secure; SameSite=Lax` };
    // secured if ts_ok=1 present
    const secured = hasCookie(_req, "ts_ok", "1");
    return html(renderPublicLeadHTML({ secured, sessionId: sid }), 200, headers);
  });

  // POST /submit – save to D1
  router.add("POST", "/submit", async (req, env) => {
    try{
      const fd = await req.formData();
      // Soft-require: if not secured, still accept but mark unsynced (adjust if you want hard block)
      const secured = hasCookie(req, "ts_ok", "1");

      const data = {
        name: (fd.get("full_name") || "").toString().trim(),
        phone: (fd.get("phone") || "").toString().trim(),
        whatsapp: (fd.get("phone") || "").toString().trim(),
        email: (fd.get("email") || "").toString().trim(),
        source: (fd.get("source") || "").toString().trim(),
        city: (fd.get("city") || "").toString().trim(),
        street: (fd.get("street") || "").toString().trim(),
        zip: (fd.get("zip") || "").toString().trim(),
        service: (fd.get("service") || "").toString().trim(),
        captured_by: "public", // or derive from session later
      };

      // Basic validation
      if(!data.name || !data.phone || !data.email || !data.city || !data.street || !data.zip || !data.service){
        return json({ ok:false, error:"Missing required fields." }, 400);
      }

      await insertLead(env, data);
      // fetch last row id for ref
      const row = await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first();
      const ref = row?.id ?? null;

      // Optionally, flag non-secured submissions
      if(!secured){
        // You could set synced=0 already in insertLead; optional: add a light cookie flag
      }
      return json({ ok:true, ref });
    }catch(err){
      return json({ ok:false, error: (err && err.message) || "Could not save." }, 500);
    }
  });
}
