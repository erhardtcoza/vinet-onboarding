// src/splynx.js

// ---------- Low-level HTTP helpers ----------
async function splynxFetch(env, endpoint, init = {}) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Basic ${env.SPLYNX_AUTH}`);
  const r = await fetch(url, { ...init, headers });
  return r;
}

export async function splynxGET(env, endpoint) {
  const r = await splynxFetch(env, endpoint);
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
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

// ---------- Phone (for OTP) ----------
export async function fetchCustomerMsisdn(env, id) {
  // Lead first
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const phone = lead?.phone ?? null;
    if (phone) return String(phone).trim();
  } catch {}

  // Then customer
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);
    const phone = cust?.phone ?? cust?.phone_mobile ?? null;
    if (phone) return String(phone).trim();
  } catch {}

  return null;
}

// ---------- Profile for onboarding (lead first, then customer) ----------
export async function fetchProfileForDisplay(env, id) {
  // Try LEAD
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    const street = lead.street ?? lead.address ?? lead.address_1 ?? lead.street_1 ?? "";
    const city   = lead.city   ?? "";
    const zip    = lead.zip_code ?? lead.zip ?? "";
    const passport =
      lead.passport || lead.id_number || lead.identity_number || "";

    return {
      kind: "lead",
      id,
      full_name: lead.full_name || lead.name || "",
      email: lead.email || lead.billing_email || "",
      phone: lead.phone || "",
      street, city, zip, passport,
      payment_method: lead.payment_method || "",
    };
  } catch {}

  // Fallback: CUSTOMER
  let cust = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) {
    // give a minimal object to avoid hard failure
    return {
      kind: "unknown",
      id,
      full_name: "",
      email: "",
      phone: "",
      street: "", city: "", zip: "", passport: "",
      payment_method: "",
    };
  }

  // Try to enrich with customer-info (passport/ID lives here often)
  let custInfo = null;
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const street = cust.street ?? cust.address ?? cust.address_1 ?? cust.street_1 ?? "";
  const city   = cust.city ?? "";
  const zip    = cust.zip_code ?? cust.zip ?? "";
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    cust.passport || cust.id_number || "";

  return {
    kind: "customer",
    id,
    full_name: cust.full_name || cust.name || "",
    email: cust.email || cust.billing_email || "",
    phone: cust.phone || cust.phone_mobile || "",
    street, city, zip, passport,
    payment_method: cust.payment_method || "",
  };
}

// ---------- Map edits to Splynx payload (email + billing_email updated) ----------
export function mapEditsToSplynxPayload(edits = {}, payMethod, debit, attachments = []) {
  const body = {};

  // Splynx wants "name" (not full_name). Use edits.full_name if provided.
  if (edits.full_name) body.name = edits.full_name;

  if (edits.email) {
    body.email = edits.email;
    body.billing_email = edits.email; // keep billing email in sync as requested
  }
  if (edits.phone) body.phone = edits.phone;

  // Address
  if (edits.street) body.street_1 = edits.street;
  if (edits.city) body.city = edits.city;
  if (edits.zip) body.zip_code = edits.zip;

  // Payment
  if (payMethod) body.payment_method = payMethod;
  if (debit) body.debit = debit;

  // Any public file URLs you also want to drop onto the entity
  if (attachments && attachments.length) body.attachments = attachments;

  return body;
}

// ---------- Create + upload a document (works for lead and customer) ----------
/**
 * entity: "lead" | "customer"
 * id:     numeric id as string or number
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
  const baseCreate  = isLead ? `/admin/crm/leads-documents` : `/admin/customers/customer-documents`;
  const baseUpload  = isLead ? `/admin/crm/leads-documents` : `/admin/customers/customer-documents`;

  // 1) Create a document shell (type must be "uploaded")
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

  // 2) Upload the file bytes to the …/{id}--upload endpoint
  //    This is the variant that worked in your cURL tests.
  const uploadEndpoint = `${baseUpload}/${document_id}--upload`;

  const fd = new FormData();
  // IMPORTANT: do NOT set Content-Type header; the runtime will set the boundary for multipart.
  const fileName = opts.filename || "document.bin";
  const blob = new Blob([opts.bytes], { type: opts.mime || "application/octet-stream" });
  fd.append("file", blob, fileName);

  const uploadRes = await splynxFetch(env, uploadEndpoint, { method: "POST", body: fd });
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    throw new Error(`Upload doc failed ${uploadRes.status}: ${t}`);
  }

  // Done
  return { id: document_id };
}
