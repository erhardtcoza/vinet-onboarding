// src/splynx.js

// ---------- Small util ----------
const pick = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
};

// ---------- Base URL + low-level HTTP helpers ----------
function baseUrl(env) {
  // Support either SPLYNX_API or SPLYNX_API_URL; default to your domain if unset
  return env.SPLYNX_API || env.SPLYNX_API_URL || "https://splynx.vinet.co.za/api/2.0";
}

async function splynxFetch(env, endpoint, init = {}) {
  const url = `${baseUrl(env)}${endpoint}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Basic ${env.SPLYNX_AUTH}`);
  return fetch(url, { ...init, headers });
}

export async function splynxGET(env, endpoint) {
  const r = await splynxFetch(env, endpoint);
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

export async function splynxPOST(env, endpoint, body) {
  const r = await splynxFetch(env, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

export async function splynxPUT(env, endpoint, body) {
  const r = await splynxFetch(env, endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// ---------- Exact customer-info fetch (passport lives here in your setup) ----------
async function getCustomerInfoExact(env, id) {
  try {
    const info = await splynxGET(env, `/admin/customers/customer-info/${id}`);
    // Expect { customer_id, passport, ... }
    if (info && typeof info === "object" && String(info.customer_id) === String(id)) {
      return info;
    }
  } catch {}
  // If your instance ever changes shape, add fallbacks here (query/list).
  return null;
}

// ---------- Phone (for OTP) ----------
export async function fetchCustomerMsisdn(env, id) {
  // Try lead first
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const phone = pick(lead?.phone, lead?.phone_mobile, lead?.mobile);
    if (phone) return phone;
  } catch {}

  // Then customer
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);
    const phone = pick(cust?.phone, cust?.phone_mobile);
    if (phone) return phone;
  } catch {}

  return null;
}

// ---------- Profile for onboarding (lead first, then customer) ----------
export async function fetchProfileForDisplay(env, id) {
  // LEAD
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const street = pick(lead.street, lead.address, lead.address_1, lead.street_1);
    const city   = pick(lead.city);
    const zip    = pick(lead.zip_code, lead.zip);
    // In your setup passport is not on leads → keep empty
    return {
      kind: "lead",
      id,
      full_name: pick(lead.full_name, lead.name),
      email: pick(lead.email, lead.billing_email),
      phone: pick(lead.phone, lead.phone_mobile, lead.mobile),
      street, city, zip,
      passport: "",
      payment_method: pick(lead.payment_method),
    };
  } catch {}

  // CUSTOMER
  let cust = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) {
    return {
      kind: "unknown",
      id,
      full_name: "", email: "", phone: "",
      street: "", city: "", zip: "",
      passport: "", payment_method: "",
    };
  }

  // Pull passport ONLY from customer-info (per your instance)
  const info = await getCustomerInfoExact(env, id);

  const street = pick(cust.street, cust.address, cust.address_1, cust.street_1);
  const city   = pick(cust.city);
  const zip    = pick(cust.zip_code, cust.zip);
  const passport = pick(info?.passport); // <- key piece

  return {
    kind: "customer",
    id,
    full_name: pick(cust.full_name, cust.name),
    email: pick(cust.email, cust.billing_email),
    phone: pick(cust.phone, cust.phone_mobile),
    street, city, zip, passport,
    payment_method: pick(cust.payment_method),
  };
}

// ---------- Map edits to Splynx payload ----------
export function mapEditsToSplynxPayload(edits = {}, payMethod, debit, attachments = []) {
  const body = {};
  if (edits.full_name) body.name = edits.full_name;

  if (edits.email) {
    body.email = edits.email;
    body.billing_email = edits.email; // keep billing email in sync
  }
  if (edits.phone) body.phone = edits.phone;

  // Address
  if (edits.street) body.street_1 = edits.street;
  if (edits.city) body.city = edits.city;
  if (edits.zip) body.zip_code = edits.zip;

  // Payment
  if (payMethod) body.payment_method = payMethod;
  if (debit) body.debit = debit;

  // Optional attachments array of public URLs (if you use it)
  if (attachments && attachments.length) body.attachments = attachments;

  // Note: We are NOT setting passport here because your instance stores it in customer-info.
  // If later you add a dedicated write-path for customer-info, handle that separately.

  return body;
}

// ---------- Create + upload a document (lead or customer) ----------
/**
 * entity: "lead" | "customer"
 * id:     number | string
 * opts: {
 *   title: string,
 *   description?: string,
 *   visible_by_customer?: "0" | "1",
 *   filename: string,
 *   mime: string,
 *   bytes: ArrayBuffer
 * }
 */
export async function splynxCreateAndUpload(env, entity, id, opts) {
  const isLead = String(entity).toLowerCase() === "lead";
  const baseCreate = isLead ? `/admin/crm/leads-documents` : `/admin/customers/customer-documents`;
  const baseUpload = baseCreate;

  // 1) Create "uploaded" document shell
  const createBody = {
    type: "uploaded",
    title: opts.title,
    description: opts.description || "",
    visible_by_customer: opts.visible_by_customer ?? "0",
    ...(isLead ? { lead_id: Number(id) } : { customer_id: Number(id) }),
  };

  const createRes = await splynxFetch(env, baseCreate, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Create doc failed ${createRes.status}: ${t}`);
  }
  const created = await createRes.json().catch(() => ({}));
  const document_id = created?.id;
  if (!document_id) throw new Error("Create doc: missing id in response");

  // 2) Upload the file bytes to …/{id}--upload
  const uploadEndpoint = `${baseUpload}/${document_id}--upload`;
  const fd = new FormData(); // do NOT set Content-Type; runtime adds boundary
  const fileName = opts.filename || "document.bin";
  const blob = new Blob([opts.bytes], { type: opts.mime || "application/octet-stream" });
  fd.append("file", blob, fileName);

  const uploadRes = await splynxFetch(env, uploadEndpoint, { method: "POST", body: fd });
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    throw new Error(`Upload doc failed ${uploadRes.status}: ${t}`);
  }

  return { id: document_id };
}