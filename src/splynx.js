// src/splynx.js
// Splynx API helpers

// --- Generic GET ---
async function splynxGET(env, endpoint) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) throw new Error(`Splynx GET failed: ${res.status} ${endpoint}`);
  return res.json();
}

// --- Generic PUT ---
async function splynxPUT(env, endpoint, body) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Splynx PUT failed: ${res.status} ${endpoint}`);
  return res.json();
}

// --- Generic POST ---
async function splynxPOST(env, endpoint, body) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Splynx POST failed: ${res.status} ${endpoint}`);
  return res.json();
}

// --- Upload a file for customer or lead ---
async function splynxCreateAndUpload(env, type, id, file, field = "file") {
  let endpoint;
  if (type === "customer") {
    endpoint = `/admin/customers/customer-documents/${id}`;
  } else if (type === "lead") {
    endpoint = `/admin/crm/lead-documents/${id}`;
  } else {
    throw new Error("Invalid type for upload");
  }

  const url = `${env.SPLYNX_API}${endpoint}`;
  const form = new FormData();
  form.append(field, file, file.name || "upload.dat");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${env.SPLYNX_AUTH}`
    },
    body: form
  });

  if (!res.ok) throw new Error(`Splynx upload failed: ${res.status} ${endpoint}`);
  return res.json();
}

// --- Fetch profile for display ---
async function fetchProfileForDisplay(env, id, type = "customer") {
  let endpoint;
  if (type === "customer") {
    endpoint = `/admin/customers/customer/${id}`;
  } else if (type === "lead") {
    endpoint = `/admin/crm/leads/${id}`;
  } else {
    throw new Error("Invalid type for profile fetch");
  }

  const data = await splynxGET(env, endpoint);

  return {
    id: data.id,
    name: data.name || `${data.firstname || ""} ${data.lastname || ""}`.trim(),
    email: data.email || data.billing_email || null,
    phone: data.phone || data.mobile || null,
    passport: data.passport || null,
    street: data.street || null,
    city: data.city || null,
    status: data.status || null
  };
}

// --- Fetch customer MSISDN across endpoints ---
async function fetchCustomerMsisdn(env, id) {
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
      if (res && (res.phone || res.msisdn || res.email)) {
        return {
          phone: res.phone || res.msisdn || null,
          email: res.email || null
        };
      }
    } catch {
      // ignore failed endpoint
    }
  }

  return { phone: null, email: null };
}

// --- Map edits to Splynx payload ---
function mapEditsToSplynxPayload(edits) {
  const payload = {};
  if (edits.name) {
    const parts = edits.name.split(" ");
    payload.firstname = parts[0];
    payload.lastname = parts.slice(1).join(" ") || "";
  }
  if (edits.email) payload.email = edits.email;
  if (edits.phone) payload.phone = edits.phone;
  if (edits.passport) payload.passport = edits.passport;
  if (edits.street) payload.street = edits.street;
  if (edits.city) payload.city = edits.city;
  return payload;
}

// --- Exports ---
export {
  splynxGET,
  splynxPUT,
  splynxPOST,
  splynxCreateAndUpload,
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  mapEditsToSplynxPayload
};
