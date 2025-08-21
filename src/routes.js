// src/routes.js
// Thin compatibility shim so the rest of your app can keep importing { route } from "src/routes.js"
export { route } from "./routes/index.js";
// ----- Splynx profile (used by Personal Info step) -----
if (path === "/api/splynx/profile" && method === "GET") {
  const id = url.searchParams.get("id");
  const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });
  if (!id) return json({ error: "Missing id" }, 400);

  async function splynxGET(ep) {
    const r = await fetch(`${env.SPLYNX_API}${ep}`, {
      headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
    });
    if (!r.ok) throw new Error(`GET ${ep} ${r.status}`);
    return r.json();
  }

  // Try LEAD first, then CUSTOMER
  let src = null;
  let kind = "lead";
  try {
    src = await splynxGET(`/admin/crm/leads/${id}`);
  } catch {
    try {
      src = await splynxGET(`/admin/customers/customer/${id}`);
      kind = "customer";
    } catch {
      return json({ error: "Lookup failed" }, 502);
    }
  }

  // Minimal, tolerant mapping for the UI
  const out = {
    kind,
    id,
    full_name: src.name || src.full_name || "",
    email: src.email || src.billing_email || "",
    phone: src.phone || src.phone_mobile || "",
    street: src.street_1 || src.street || src.address || "",
    city: src.city || "",
    zip: src.zip_code || src.zip || "",
    passport: src.id_number || src.passport || ""
  };

  return json(out);
}
