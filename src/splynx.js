// src/splynx.js

const pick = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
};

// ---------- Base URL + low-level HTTP ----------
function baseUrl(env) {
  // supports either SPLYNX_API or SPLYNX_API_URL
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

// ---------- Exact customer-info (passport lives here) ----------
async function getCustomerInfoExact(env, id) {
  try {
    const info = await splynxGET(env, `/admin/customers/customer-info/${id}`);
    if (info && String(info.customer_id) === String(id)) return info;
  } catch {}
  return null;
}

// ---------- MSISDN (prefer CUSTOMER first) ----------
export async function fetchCustomerMsisdn(env, id) {
  // Customer first
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);
    const phone = pick(cust?.phone, cust?.phone_mobile);
    if (phone) return phone;
  } catch {}

  // Fallback to lead
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const phone = pick(lead?.phone, lead?.phone_mobile, lead?.mobile);
    if (phone) return phone;
  } catch {}

  return null;
}

// ---------- Profile for onboarding (CUSTOMER first, then LEAD) ----------
export async function fetchProfileForDisplay(env, id) {
  // CUSTOMER (first)
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);

    // Pull passport ONLY from customer-info (your instance)
    const info = await getCustomerInfoExact(env, id);

    const street = pick(cust.street, cust.address, cust.address_1, cust.street_1);
    const city   = pick(cust.city);
    const zip    = pick(cust.zip_code, cust.zip);
    const passport = pick(info?.passport); // <- key

    return {
      kind: "customer",
      id: String(id),
      full_name: pick(cust.full_name, cust.name),
      email: pick(cust.email, cust.billing_email),
      phone: pick(cust.phone, cust.phone_mobile),
      street, city, zip, passport,
      payment_method: pick(cust.payment_method),
    };
  } catch {}

  // LEAD (fallback)
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const street = pick(lead.street, lead.address, lead.address_1, lead.street_1);
    const city   = pick(lead.city);
    const zip    = pick(lead.zip_code, lead.zip);

    // Typically not present for leads in your setup
    const passport = "";

    return {
      kind: "lead",
      id: String(id),
      full_name: pick(lead.full_name, lead.name),
      email: pick(lead.email, lead.billing_email),
      phone: pick(lead.phone, lead.phone_mobile, lead.mobile),
      street, city, zip, passport,
      payment_method: pick(lead.payment_method),
    };
  } catch {}

  // Minimal fallback
  return {
    kind: "unknown",
    id: String(id),
    full_name: "", email: "", phone: "",
    street: "", city: "", zip: "", passport: "",
    payment_method: "",
  };
}

// ---------- Map edits to Splynx payload (no passport write here) ----------
export function mapEditsToSplynxPayload(edits = {}, payMethod, debit, attachments = []) {
  const body = {};
  if (edits.full_name) body.name = edits.full_name;

  if (edits.email) {
    body.email = edits.email;
    body.billing_email = edits.email; // keep in sync
  }
  if (edits.phone) body.phone = edits.phone;

  if (edits.street) body.street_1 = edits.street;
  if (edits.city) body.city = edits.city;
  if (edits.zip) body.zip_code = edits.zip;

  if (payMethod) body.payment_method = payMethod;
  if (debit) body.debit = debit;

  if (attachments && attachments.length) body.attachments = attachments;

  // Note: passport is stored in customer-info; update via a separate endpoint if needed.
  return body;
}

// ---------- Create + upload a document (lead or customer) ----------
export async function splynxCreateAndUpload(env, entity, id, opts) {
  const isLead = String(entity).toLowerCase() === "lead";
  const base = isLead ? `/admin/crm/leads-documents` : `/admin/customers/customer-documents`;

  // 1) Create shell
  const createBody = {
    type: "uploaded",
    title: opts.title,
    description: opts.description || "",
    visible_by_customer: opts.visible_by_customer ?? "0",
    ...(isLead ? { lead_id: Number(id) } : { customer_id: Number(id) }),
  };
  const createRes = await splynxPOST(env, base, createBody);
  const document_id = createRes?.id;
  if (!document_id) throw new Error("Create doc: missing id in response");

  // 2) Upload bytes to …/{id}--upload
  const fd = new FormData();
  const fileName = opts.filename || "document.bin";
  const blob = new Blob([opts.bytes], { type: opts.mime || "application/octet-stream" });
  fd.append("file", blob, fileName);

  const uploadEndpoint = `${base}/${document_id}--upload`;
  const upRes = await splynxFetch(env, uploadEndpoint, { method: "POST", body: fd });
  if (!upRes.ok) {
    const t = await upRes.text().catch(() => "");
    throw new Error(`Upload doc failed ${upRes.status}: ${t}`);
  }

  return { id: document_id };
}