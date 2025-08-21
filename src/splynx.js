// src/splynx.js
// Splynx helper functions for Vinet Onboarding Worker

// --- Generic GET ---
export async function splynxGET(env, endpoint) {
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GET ${endpoint} failed (${res.status})`);
  }

  return await res.json();
}

// --- Generic PUT ---
export async function splynxPUT(env, endpoint, body) {
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`PUT ${endpoint} failed (${res.status})`);
  }

  return await res.json();
}

// --- Map edits into Splynx payload format ---
export function mapEditsToSplynxPayload(edits) {
  // TODO: adapt mapping rules as needed for Splynx schema
  return edits;
}

// --- Upload file to Splynx (lead or customer) ---
export async function splynxCreateAndUpload(env, type, id, file) {
  const endpoint =
    type === "lead"
      ? `/admin/crm/lead-documents/${id}`
      : `/admin/customers/customer-documents/${id}`;

  const res = await fetch(`${env.SPLYNX_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
    },
    body: file, // expects FormData
  });

  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }

  return await res.json();
}

// --- Fetch profile for onboarding display ---
export async function fetchProfileForDisplay(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];

  for (const ep of eps) {
    try {
      console.log(`[Splynx] Trying ${ep}`);
      const data = await splynxGET(env, ep);
      if (data && Object.keys(data).length > 0) {
        console.log(`[Splynx] Success: ${ep}`);
        return data;
      }
    } catch (err) {
      console.log(`[Splynx] Failed: ${ep} → ${err.message}`);
    }
  }

  console.log(`[Splynx] No profile found for id=${id}`);
  return null;
}

// --- Fetch customer MSISDN info ---
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
      console.log(`[Splynx] Trying MSISDN ${ep}`);
      const data = await splynxGET(env, ep);
      if (data && Object.keys(data).length > 0) {
        console.log(`[Splynx] Found MSISDN in ${ep}`);
        return data;
      }
    } catch (err) {
      console.log(`[Splynx] Failed MSISDN ${ep}: ${err.message}`);
    }
  }

  console.log(`[Splynx] No MSISDN found for id=${id}`);
  return null;
}
