// src/splynx.js
// Splynx helper functions for Vinet Onboarding Worker

// ---------------------
// Generic GET
// ---------------------
export async function splynxGET(env, endpoint) {
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  console.log(`[Splynx] GET ${url}`);
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

// ---------------------
// Generic PUT
// ---------------------
export async function splynxPUT(env, endpoint, body) {
  const url = `${env.SPLYNX_API_URL}${endpoint}`;
  console.log(`[Splynx] PUT ${url}`, body);
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

// ---------------------
// Map edits into Splynx payload format
// ---------------------
export function mapEditsToSplynxPayload(edits) {
  console.log("[Splynx] Mapping edits", edits);
  return edits;
}

// ---------------------
// Upload file to Splynx (lead or customer)
// ---------------------
export async function splynxCreateAndUpload(env, type, id, file) {
  const endpoint =
    type === "lead"
      ? `/admin/crm/lead-documents/${id}`
      : `/admin/customers/customer-documents/${id}`;

  console.log(`[Splynx] Uploading file to ${endpoint}`);
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

// ---------------------
// Fetch and merge profile for onboarding
// ---------------------
export async function fetchProfileForDisplay(env, id) {
  const customerEndpoints = {
    main: `/admin/customers/customer/${id}`,
    contacts: `/admin/customers/${id}/contacts`,
  };

  const leadEndpoints = {
    main: `/admin/crm/leads/${id}`,
    contacts: `/admin/crm/leads/${id}/contacts`,
  };

  let profile = null;

  // --- Try customer ---
  try {
    console.log(`[Splynx] Trying customer ${id}`);
    profile = await splynxGET(env, customerEndpoints.main);
    console.log(`[Splynx] Customer profile success`);
    try {
      const contacts = await splynxGET(env, customerEndpoints.contacts);
      if (contacts && contacts.length > 0) {
        profile.contacts = contacts;
      }
    } catch (err) {
      console.log(`[Splynx] No customer contacts: ${err.message}`);
    }
  } catch (err) {
    console.log(`[Splynx] No customer profile: ${err.message}`);
  }

  // --- If not found, try lead ---
  if (!profile) {
    try {
      console.log(`[Splynx] Trying lead ${id}`);
      profile = await splynxGET(env, leadEndpoints.main);
      console.log(`[Splynx] Lead profile success`);
      try {
        const contacts = await splynxGET(env, leadEndpoints.contacts);
        if (contacts && contacts.length > 0) {
          profile.contacts = contacts;
        }
      } catch (err) {
        console.log(`[Splynx] No lead contacts: ${err.message}`);
      }
    } catch (err) {
      console.log(`[Splynx] No lead profile: ${err.message}`);
    }
  }

  if (!profile) {
    console.log(`[Splynx] No profile found for id=${id}`);
    return null;
  }

  // --- Ensure passport always present ---
  if (!profile.passport) {
    profile.passport = "";
  }

  // --- Build normalised profile alongside raw ---
  profile.normalised = {
    id: profile.id,
    type: profile.category === "lead" ? "lead" : "customer",
    name: profile.name || "",
    email: profile.email || profile.billing_email || "",
    phone: profile.phone || "",
    street: profile.street_1 || "",
    city: profile.city || "",
    zip: profile.zip_code || "",
    passport: profile.passport || "",
    contacts: profile.contacts || [],
  };

  console.log(`[Splynx] Returning merged+normalised profile for id=${id}`);
  return profile; // raw + normalised
}

// ---------------------
// Fetch customer MSISDN info
// ---------------------
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
