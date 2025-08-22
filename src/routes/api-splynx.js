// src/routes/api-splynx.js
import { splynxGET } from "../splynx.js";

const json = (o, s=200) =>
  new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });

export function match(pathname, method) {
  return (
    (pathname.startsWith("/api/splynx/raw")     && method === "GET") ||
    (pathname.startsWith("/api/splynx/profile") && method === "GET")
  );
}

export async function handle(request, env) {
  const url  = new URL(request.url);
  const path = url.pathname;

  // ---- /api/splynx/raw?ep=/admin/... ----
  if (path.startsWith("/api/splynx/raw")) {
    const ep = url.searchParams.get("ep") || "";
    if (!ep || !ep.startsWith("/")) return json({ error:"Missing or invalid ep" }, 400);
    try {
      const data = await splynxGET(env, ep);
      return json(data);
    } catch (e) {
      return json({ error: (e && e.message) || "Splynx error" }, 500);
    }
  }

  // ---- /api/splynx/profile?id=123 ----
  if (path.startsWith("/api/splynx/profile")) {
    const id = url.searchParams.get("id");
    if (!id) return json({ error:"Missing id" }, 400);

    // Try customer then lead; also pull customer-info for passport
    let base = null;
    let kind = "customer";
    try {
      base = await splynxGET(env, `/admin/customers/customer/${id}`);
    } catch {
      try {
        base = await splynxGET(env, `/admin/crm/leads/${id}`);
        kind = "lead";
      } catch (e2) {
        return json({ error:"Not found" }, 404);
      }
    }

    let passport = "";
    if (kind === "customer") {
      try {
        const info = await splynxGET(env, `/admin/customers/customer-info/${id}`);
        if (info && info.passport) passport = String(info.passport);
      } catch {}
    }

    const normalized = {
      id: Number(id),
      type: kind,
      full_name: base.name || base.full_name || "",
      email: base.email || "",
      billing_email: base.billing_email || base.email || "",
      phone: base.phone || (base.phones && base.phones[0] && base.phones[0].phone) || "",
      passport: passport || base.passport || (base.additional_attributes && base.additional_attributes.social_id) || "",
      street: base.street_1 || base.address || "",
      city: base.city || "",
      zip: base.zip_code || base.zip || "",
    };

    return json({ ...base, passport: normalized.passport, normalised: normalized });
  }

  return new Response("Not found", { status: 404 });
}