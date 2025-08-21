// src/splynx.js
// Splynx API helpers for onboarding + admin

// --------------------
// Core fetch wrapper
// --------------------
export async function splynxGET(env, endpoint) {
  const url = `${env.SPLYNX_URL}/api/2.0${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
    },
  });
  if (!res.ok) throw new Error(`Splynx GET failed: ${res.status}`);
  return res.json();
}

export async function splynxPUT(env, endpoint, payload) {
  const url = `${env.SPLYNX_URL}/api/2.0${endpoint}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
    },
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
    ...(payload instanceof FormData ? {} : { headers: { "Content-Type": "application/json", Authorization: `Basic ${env.SPLYNX_AUTH}` } }),
  });
  if (!res.ok) throw new Error(`Splynx PUT failed: ${res.status}`);
  return res.json();
}

export async function splynxPOST(env, endpoint, payload) {
  const url = `${env.SPLYNX_URL}/api/2.0${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
    },
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
    ...(payload instanceof FormData ? {} : { headers: { "Content-Type": "application/json", Authorization: `Basic ${env.SPLYNX_AUTH}` } }),
  });
  if (!res.ok) throw new Error(`Splynx POST failed: ${res.status}`);
  return res.json();
}

// --------------------
// Profile fetch + normalisation
// --------------------
export async function fetchProfileForDisplay(env, id) {
  // try customer endpoints first, then lead
  const endpoints = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
  ];

  let profile = null;
  for (const ep of endpoints) {
    try {
      profile = await splynxGET(env, ep);
      if (profile && profile.id) break;
    } catch {
      // ignore and continue
    }
  }

  if (!profile) return null;

  // also fetch passport from customer-info if available
  try {
    const info = await splynxGET(env, `/admin/customers/customer-info/${id}`);
    if (info && info.passport) {
      profile.passport = info.passport;
    }
  } catch {
    // not all leads/customers have info record
  }

  // fetch contacts if exist
  let contacts = [];
  try {
    const c = await splynxGET(env, `/admin/customers/${id}/contacts`);
    if (Array.isArray(c)) contacts = contacts.concat(c);
  } catch {}
  try {
    const c = await splynxGET(env, `/admin/crm/leads/${id}/contacts`);
    if (Array.isArray(c)) contacts = contacts.concat(c);
  } catch {}

  return {
    ...profile,
    normalised: normaliseProfile(profile, contacts),
  };
}

export function normaliseProfile(profile, contacts = []) {
  return {
    id: profile.id,
    type: profile.login ? "customer" : "lead",
    name: profile.name || "",
    email: profile.email || "",
    phone: profile.phone || "",
    street: profile.street_1 || "",
    city: profile.city || "",
    zip: profile.zip_code || "",
    passport: profile.passport || "",
    contacts,
  };
}

// --------------------
// Extra helpers for admin.js
// --------------------

// Map admin edits into Splynx API payload
export function mapEditsToSplynxPayload(edits) {
  const payload = {};
  if (!edits) return payload;

  if (edits.name) payload.name = edits.name;
  if (edits.email) payload.email = edits.email;
  if (edits.phone) payload.phone = edits.phone;
  if (edits.street) payload.street_1 = edits.street;
  if (edits.city) payload.city = edits.city;
  if (edits.zip) payload.zip_code = edits.zip;
  if (edits.passport) payload.passport = edits.passport;

  return payload;
}

// Upload a document into Splynx (lead or customer)
export async function splynxCreateAndUpload(env, type, id, file, filename) {
  const url =
    type === "lead"
      ? `/admin/crm/lead-documents/${id}`
      : `/admin/customers/customer-documents/${id}`;

  const formData = new FormData();
  formData.append("file", new Blob([file]), filename);

  return await splynxPOST(env, url, formData);
}
