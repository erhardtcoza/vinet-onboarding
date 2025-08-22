// src/splynx.js
const BASE_URL = "https://splynx.vinet.co.za/api/2.0";

function authHeader(env) {
  return {
    Authorization: `Basic ${env.SPLYNX_AUTH}`,
  };
}

export async function splynxGET(env, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...authHeader(env) },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function splynxPOST(env, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...authHeader(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function splynxPUT(env, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      ...authHeader(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * Map frontend edits into Splynx API payload
 * @param {object} edits - fields edited in onboarding admin
 * @returns {object} payload for Splynx PUT/POST
 */
export function mapEditsToSplynxPayload(edits) {
  const payload = {};

  if (edits.full_name) payload.name = edits.full_name;
  if (edits.email) payload.email = edits.email;
  if (edits.billing_email) payload.billing_email = edits.billing_email;
  if (edits.phone) payload.phone = edits.phone;
  if (edits.passport) payload.passport = edits.passport;

  if (edits.address || edits.city || edits.zip) {
    payload.street_1 = edits.address || "";
    payload.city = edits.city || "";
    payload.zip_code = edits.zip || "";
  }

  return payload;
}

/**
 * Upload file to Splynx for customer or lead
 * 
 * @param {Env} env
 * @param {"lead"|"customer"} type
 * @param {string|number} id
 * @param {File|Blob} file
 */
export async function splynxCreateAndUpload(env, type, id, file) {
  let endpoint;

  if (type === "lead") {
    // POST /admin/crm/lead-documents?lead_id={id}
    endpoint = `/admin/crm/lead-documents?lead_id=${id}`;
  } else if (type === "customer") {
    // POST /admin/customers/customer-documents?customer_id={id}
    endpoint = `/admin/customers/customer-documents?customer_id=${id}`;
  } else {
    throw new Error(`Invalid upload type: ${type}`);
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "upload.dat");

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { ...authHeader(env) },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fetch a clean mapped profile for display in onboarding
 */
export async function fetchProfileForDisplay(env, id) {
  const endpoints = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
  ];

  for (const ep of endpoints) {
    try {
      const data = await splynxGET(env, ep);

      return {
        id,
        full_name: data.name || data.full_name || "",
        email: data.email || "",
        billing_email: data.billing_email || data.email || "",
        phone: data.phone || (data.phones ? data.phones[0]?.phone : ""),
        passport: data.passport || data.additional_attributes?.social_id || "",
        address: data.street_1 || data.address || "",
        city: data.city || "",
        zip: data.zip_code || data.zip || "",
      };
    } catch (_) {}
  }
  return null;
}

/**
 * Try multiple endpoints to find customer/lead MSISDN info
 */
export async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try {
      const data = await splynxGET(env, ep);
      if (data) return data;
    } catch (_) {}
  }
  return null;
}