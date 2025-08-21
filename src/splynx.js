// src/splynx.js

// Generic GET request
export async function splynxGET(env, path) {
  const url = `${env.SPLYNX_API_URL}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return await res.json();
}

// Generic POST request
export async function splynxPOST(env, path, body) {
  const url = `${env.SPLYNX_API_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return await res.json();
}

// Generic PUT request
export async function splynxPUT(env, path, body) {
  const url = `${env.SPLYNX_API_URL}${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return await res.json();
}

// Fetch profile (lead or customer) for review
export async function fetchProfileForDisplay(env, id) {
  try {
    return await splynxGET(env, `/admin/customers/customer/${id}`);
  } catch {
    return await splynxGET(env, `/admin/crm/leads/${id}`);
  }
}

// Fetch msisdn & passport (checks multiple endpoints)
export async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`
  ];
  for (const ep of eps) {
    try {
      const res = await splynxGET(env, ep);
      if (res) return res;
    } catch {
      continue;
    }
  }
  throw new Error("Customer/lead not found");
}

// Map admin edits into Splynx payload
export function mapEditsToSplynxPayload(edits) {
  const payload = {};
  if (edits.name) payload.name = edits.name;
  if (edits.email) payload.email = edits.email;
  if (edits.phone) payload.phone = edits.phone;
  if (edits.passport) payload.passport = edits.passport;
  if (edits.billing_email) payload.billing_email = edits.billing_email;
  return payload;
}

// Upload a document (lead or customer)
export async function splynxCreateAndUpload(env, type, id, file) {
  const url =
    type === "lead"
      ? `${env.SPLYNX_API_URL}/admin/crm/lead-documents`
      : `${env.SPLYNX_API_URL}/admin/customers/customer-documents`;

  const form = new FormData();
  if (type === "lead") form.append("lead_id", id);
  else form.append("customer_id", id);
  form.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: form
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return await res.json();
}
