// src/leads-splynx.js
import { SPYLNX_URL, AUTH_HEADER } from "./constants.js";

export async function pushLeadToSplynx(env, lead) {
  const headers = {
    Authorization: AUTH_HEADER,
    "Content-Type": "application/json",
  };

  // fetch all leads from Splynx
  const res = await fetch(`${SPYLNX_URL}/api/2.0/admin/crm/leads`, { headers });
  const all = await res.json().catch(() => []);
  let match = Array.isArray(all)
    ? all.find(
        (l) =>
          l.email === lead.email ||
          l.phone === lead.phone ||
          l.name === lead.name
      )
    : null;

  if (!match) {
    match = Array.isArray(all) && all.find((l) => (l.name || "").toLowerCase() === "re-use");
  }

  const payload = {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    street_1: lead.street,
    zip_code: lead.zip,
    source: lead.source,
    billing_email: lead.email,
    score: lead.score || 1,
    status: "New enquiry",
    date_add: lead.date_added || new Date().toISOString().split("T")[0],
    owner: lead.captured_by || "unknown",
  };

  let method = "POST";
  let endpoint = `${SPYLNX_URL}/api/2.0/admin/crm/leads`;

  if (match && (match.name || "").toLowerCase() === "re-use") {
    method = "PUT";
    endpoint = `${SPYLNX_URL}/api/2.0/admin/crm/leads/${match.id}`;
  }

  const save = await fetch(endpoint, {
    method,
    headers,
    body: JSON.stringify(payload),
  });

  if (!save.ok) {
    const err = await save.text();
    throw new Error(`Splynx save failed: ${err}`);
  }

  const json = await save.json().catch(() => ({}));
  const id = json.id || (match && match.id);
  const link = `${SPYLNX_URL}/admin/crm/leads/view/?id=${id}`;
  return { id, link };
}
