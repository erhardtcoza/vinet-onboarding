// Splynx helper functions

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
