// src/splynx.js
/**
 * Splynx API Helpers
 */

function buildHeaders(env) {
  if (!env.SPLYNX_API_URL || !env.SPLYNX_AUTH) {
    throw new Error("Missing SPLYNX_API_URL or SPLYNX_AUTH in environment");
  }
  return {
    "Authorization": env.SPLYNX_AUTH,
    "Content-Type": "application/json"
  };
}

export async function splynxGET(env, endpoint) {
  const headers = buildHeaders(env);
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
  return res.json();
}

export async function splynxPUT(env, endpoint, payload) {
  const headers = buildHeaders(env);
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PUT ${endpoint} failed: ${res.status}`);
  return res.json();
}

export async function fetchProfileForDisplay(env, id) {
  const endpoints = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`
  ];
  for (const ep of endpoints) {
    try {
      return await splynxGET(env, ep);
    } catch (_) {}
  }
  throw new Error(`No profile found for ID ${id}`);
}

export async function fetchCustomerMsisdn(env, id) {
  const endpoints = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`
  ];

  let msisdn = null;
  let passport = null;

  for (const ep of endpoints) {
    try {
      const data = await splynxGET(env, ep);

      if (!data) continue;

      if (!msisdn && data.phone) msisdn = data.phone;
      if (!passport && data.passport) passport = data.passport;

      if (Array.isArray(data)) {
        for (const c of data) {
          if (!msisdn && c.phone) msisdn = c.phone;
          if (!passport && c.passport) passport = c.passport;
        }
      }
    } catch (_) {}
  }

  return { msisdn, passport };
}

/**
 * Map edits from admin UI into Splynx payload shape
 */
export function mapEditsToSplynxPayload(edits) {
  const payload = {};
  if (edits.email) payload.email = edits.email;
  if (edits.billing_email) payload.billing_email = edits.billing_email;
  if (edits.passport) payload.passport = edits.passport;
  if (edits.phone) payload.phone = edits.phone;
  if (edits.address) payload.address = edits.address;
  return payload;
}

/**
 * Upload a file (ID, POA, MSA, DO) to Splynx
 */
export async function splynxCreateAndUpload(env, type, id, file) {
  const headers = {
    "Authorization": env.SPLYNX_AUTH,
  };

  const form = new FormData();
  form.append("file", file);

  let url;
  if (type === "lead") {
    url = `${env.SPLYNX_API_URL}/admin/crm/lead-documents?lead_id=${id}`;
  } else if (type === "customer") {
    url = `${env.SPLYNX_API_URL}/admin/customers/customer-documents?customer_id=${id}`;
  } else {
    throw new Error("Invalid upload type: must be 'lead' or 'customer'");
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}
