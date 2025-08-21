// src/splynx.js

const BASE = "https://splynx.vinet.co.za/api/2.0";

/**
 * Make a GET request to Splynx API
 */
export async function splynxGET(env, ep) {
  const url = `${BASE}${ep}`;
  const res = await fetch(url, {
    headers: {
      Authorization: env.SPLYNX_AUTH,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Splynx fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Make a PUT request to Splynx API
 */
export async function splynxPUT(env, ep, body) {
  const url = `${BASE}${ep}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: env.SPLYNX_AUTH,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Splynx PUT failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Fetch a customer or lead by ID and normalise fields
 */
export async function fetchProfileForDisplay(env, id) {
  // try customer first
  const endpoints = [
    `/admin/customers/customer/${id}`,
    `/admin/crm/leads/${id}`,
  ];

  for (const ep of endpoints) {
    try {
      const data = await splynxGET(env, ep);

      if (data && data.id) {
        let type = ep.includes("/leads/") ? "lead" : "customer";

        // If it's a customer, fetch customer-info as well (passport, birthday, etc)
        let passport = "";
        if (type === "customer") {
          try {
            const extra = await splynxGET(env, `/admin/customers/customer-info/${id}`);
            passport = extra.passport || "";
          } catch (e) {
            console.warn("Failed to fetch customer-info:", e.message);
          }
        }

        // Build normalised object
        data.normalised = {
          id: data.id,
          type,
          name: data.name || "",
          email: data.email || "",
          phone: data.phone || "",
          street: data.street_1 || "",
          city: data.city || "",
          zip: data.zip_code || "",
          passport,
          contacts: data.contacts || [],
        };

        return data;
      }
    } catch (err) {
      // ignore and try next endpoint
    }
  }

  return null;
}

/**
 * Fetch customer MSISDN (phone numbers)
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
      if (data && (data.phone || (data.contacts && data.contacts.length))) {
        return {
          phone: data.phone || "",
          contacts: data.contacts || [],
        };
      }
    } catch (err) {
      // try next
    }
  }
  return null;
}
