// /src/routes/public.js
import { renderPublicLeadHTML } from "../ui/public_lead.js";
import { savePublicLead, ensureLeadsTables } from "../leads-storage.js";

/* ---------------- small helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

/* -------------- tiny sanitizers --------------- */
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function mount(router) {
  // Lead form
  router.add("GET", "/lead", async (_req, env) => {
    // optional: show a mini “secured” banner if you have a session id elsewhere
    return html(renderPublicLeadHTML({ secured: true, sessionId: "" }));
  });

  // Lead submit
  router.add("POST", "/lead/submit", async (req, env) => {
    try {
      await ensureLeadsTables(env);

      const body = await req.json().catch(() => ({}));

      // Build payload from form keys (accepts a few aliases)
      const payload = {
        name:    pick(body, "full_name", "name"),
        phone:   pick(body, "phone", "whatsapp", "phone_number"),
        email:   pick(body, "email"),
        city:    pick(body, "city", "town"),
        zip:     pick(body, "zip", "zip_code", "postal", "postal_code"),
        street:  pick(body, "street", "street_1", "street1", "street_address"),
        source:  pick(body, "source") || "website",
        service: pick(body, "service", "service_interested") || "unknown",
        message: pick(body, "message", "notes", "msg"),
        // hidden/defaults you wanted
        partner:      "Main",
        location:     "Main",
        score:        1,
        billing_type: "Recurring payments",
      };

      // Required-field check
      for (const k of ["name", "phone", "email", "city", "zip", "street"]) {
        if (!payload[k]) {
          return json({ ok: false, error: `Missing ${k}` }, 400);
        }
      }

      const { queueId } = await savePublicLead(env, payload);
      return json({ ok: true, ref: queueId ?? null });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  });

  // Plain landing (optional)
  router.add("GET", "/", () => text("OK", 200));
}
