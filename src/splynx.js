// src/splynx.js

// ---------- Helpers ----------
function getBaseUrl(env) {
  if (!env.SPLYNX_API_URL) {
    throw new Error("Missing SPLYNX_API_URL in environment");
  }
  return env.SPLYNX_API_URL.replace(/\/+$/, ""); // strip trailing slash
}

function getAuthHeader(env) {
  if (!env.SPLYNX_AUTH) {
    throw new Error("Missing SPLYNX_AUTH in environment");
  }
  return { Authorization: `Basic ${env.SPLYNX_AUTH}` };
}

// ---------- Core HTTP wrappers ----------
export async function splynxGET(env, endpoint) {
  const base = getBaseUrl(env);
  const res = await fetch(`${base}${endpoint}`, {
    headers: {
      ...getAuthHeader(env),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Splynx GET ${endpoint} failed: ${res.status}`);
  return res.json();
}

export async function splynxPOST(env, endpoint, data) {
  const base = getBaseUrl(env);
  const res = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: {
      ...getAuthHeader(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Splynx POST ${endpoint} failed: ${res.status}`);
  return res.json();
}

export async function splynxPUT(env, endpoint, data) {
  const base = getBaseUrl(env);
  const res = await fetch(`${base}${endpoint}`, {
    method: "PUT",
    headers: {
      ...getAuthHeader(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Splynx PUT ${endpoint} failed: ${res.status}`);
  return res.json();
}

// ---------- Profile helpers ----------
export async function fetchProfileForDisplay(env, id, type = "customer") {
  const endpoints = {
    customer: `/admin/customers/customer/${id}`,
    lead: `/admin/crm/leads/${id}`,
  };
  if (!endpoints[type]) throw new Error(`Unknown profile type: ${type}`);
  return splynxGET(env, endpoints[type]);
}

// ---------- MSISDN lookup ----------
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
      const res = await splynxGET(env, ep);

      // Check for phone in top-level fields
      if (res?.phone) return { source: ep, phone: res.phone };
      if (res?.main_phone) return { source: ep, phone: res.main_phone };

      // Check in contacts array
      if (Array.isArray(res)) {
        const c = res.find(r => r.phone || r.main_phone);
        if (c) return { source: ep, phone: c.phone || c.main_phone };
      }
    } catch (err) {
      // Ignore and try next endpoint
    }
  }

  return null;
}
