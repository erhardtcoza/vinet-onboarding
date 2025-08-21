// src/splynx.js

// ---------- Low-level HTTP helpers ----------
export async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

export async function splynxPOST(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

export async function splynxPUT(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// ---------- Entity detection (lead first, then customer) ----------
export async function detectEntityKind(env, id) {
  // Try LEAD first
  try { await splynxGET(env, `/admin/crm/leads/${id}`); return "lead"; } catch {}
  // Then CUSTOMER
  try { await splynxGET(env, `/admin/customers/customer/${id}`); return "customer"; } catch {}
  return "unknown";
}

// ---------- Simple MSISDN getter (you said .phone is correct on your instance) ----------
export async function fetchCustomerMsisdn(env, id) {
  // Lead first
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    if (lead && lead.phone) return String(lead.phone).trim();
  } catch {}
  // Customer next
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);
    if (cust && (cust.phone || cust.phone_mobile)) {
      return String(cust.phone || cust.phone_mobile).trim();
    }
  } catch {}
  return null;
}

// ---------- ID / Passport picker (customer-info is common) ----------
function pickPassportLike(o) {
  if (!o || typeof o !== "object") return "";
  const keys = [
    "identity_number", "id_number", "idnumber",
    "passport", "document_number", "identity"
  ];
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim();
  }
  if (o.customer_info) {
    const v = pickPassportLike(o.customer_info);
    if (v) return v;
  }
  if (o.extra) {
    const v = pickPassportLike(o.extra);
    if (v) return v;
  }
  return "";
}

// ---------- Profile fetch for UI (lead first, then customer + customer-info) ----------
export async function fetchProfileForDisplay(env, id) {
  let lead = null, cust = null, custInfo = null;

  try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {}
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (cust) {
    try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}
  }

  const src = lead || cust || {};

  const phone =
    src.phone ||
    src.phone_mobile ||
    "";

  const street = src.street || src.street_1 || src.address || "";
  const city   = src.city || (src.addresses && src.addresses.city) || "";
  const zip    = src.zip || src.zip_code || (src.addresses && (src.addresses.zip || src.addresses.zip_code)) || "";

  const passport =
    pickPassportLike(custInfo) ||
    pickPassportLike(cust)     ||
    pickPassportLike(lead)     ||
    "";

  return {
    kind: lead ? "lead" : (cust ? "customer" : "unknown"),
    id,
    full_name: src.name || src.full_name || "",
    email: src.email || src.billing_email || "",
    phone,
    street, city, zip,
    passport,
    payment_method: src.payment_method || "",
    partner: src.partner || src.location || ""
  };
}

// ---------- Payload mapping for updates ----------
export function mapEditsToSplynxPayload(edits = {}, pay_method, debit, attachments = []) {
  // Map our UI edits into fields Splynx accepts on both lead & customer.
  // Important: set BOTH email & billing_email.
  const name = (edits.full_name || edits.name || "").trim();
  const email = (edits.email || "").trim();

  const base = {
    // Name
    name: name || undefined,          // Splynx "name" is the canonical field
    full_name: name || undefined,     // harmless for customer setups that still show full_name

    // Emails
    email: email || undefined,
    billing_email: email || undefined,

    // Phone
    phone: (edits.phone || undefined),
    phone_mobile: (edits.phone || undefined),

    // Address
    street_1: (edits.street || undefined),
    street:   (edits.street || undefined),
    city:     (edits.city || undefined),
    zip_code: (edits.zip || undefined),
    zip:      (edits.zip || undefined),

    // Payment
    payment_method: (pay_method || undefined),

    // Extras (we keep these for completeness; Splynx ignores unknown props)
    attachments, // not a real Splynx field—kept for your own reference if you log the payload
    debit: debit || undefined
  };

  // Remove empty/undefined keys
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && v !== null && String(v) !== "") out[k] = v;
  }
  return out;
}

// ---------- Create + upload a document for CUSTOMER or LEAD ----------
/**
 * entity: "customer" | "lead"
 * id: customer_id or lead_id
 * opts: { title, description, filename, mime, bytes, visible_by_customer? }
 */
export async function splynxCreateAndUpload(env, entity, id, opts) {
  const { title, description, filename, mime, bytes } = opts;
  const visible = opts.visible_by_customer ? "1" : "0";

  if (!bytes || !filename) throw new Error("Missing file data for upload");

  // 1) Create the document "shell"
  let docId = null;
  if (entity === "lead") {
    const created = await splynxPOST(env, `/admin/crm/leads-documents`, {
      customer_id: Number(id),              // Splynx uses 'customer_id' field even for leads-documents
      type: "uploaded",
      title: title || "Upload",
      description: description || "",
      visible_by_customer: visible
    });
    docId = created && created.id;
  } else {
    const created = await splynxPOST(env, `/admin/customers/customer-documents`, {
      customer_id: Number(id),
      type: "uploaded",
      title: title || "Upload",
      description: description || "",
      visible_by_customer: visible
    });
    docId = created && created.id;
  }
  if (!docId) throw new Error("Failed to create document in Splynx");

  // 2) Upload the file to the special --upload endpoint
  const form = new FormData();
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  form.append("file", blob, filename);

  const uploadPath =
    entity === "lead"
      ? `/admin/crm/leads-documents/${docId}--upload`
      : `/admin/customers/customer-documents/${docId}--upload`;

  const r = await fetch(`${env.SPLYNX_API}${uploadPath}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: form, // let the runtime set multipart boundary
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx UPLOAD ${uploadPath} ${r.status} ${t}`);
  }
  return true;
}
