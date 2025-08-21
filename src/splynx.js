// src/splynx.js
//
// Splynx helpers: GET/PUT/POST, profile lookup, OTP phone picking,
// push updates, and document create+upload (customers & leads).
//
// NOTE: All requests use Basic auth from env.SPLYNX_AUTH against env.SPLYNX_API

// ---------- low-level HTTP helpers ----------
async function splynxFetch(env, endpoint, init = {}) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx ${init.method || "GET"} ${endpoint} ${r.status} ${t}`);
  }
  // Many Splynx endpoints reply 204; guard json() accordingly
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  return r.json().catch(() => ({}));
}

export async function splynxGET(env, endpoint) {
  return splynxFetch(env, endpoint, { method: "GET" });
}

export async function splynxPUT(env, endpoint, body) {
  return splynxFetch(env, endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

export async function splynxPOST(env, endpoint, body) {
  return splynxFetch(env, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

// ---------- phone & field pickers ----------
function ok27(s) {
  return /^27\d{8,13}$/.test(String(s || "").trim());
}
export function pickPhone(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return ok27(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const m = pickPhone(it);
      if (m) return m;
    }
    return null;
  }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn,
      obj.primary_phone, obj.contact_number, obj.billing_phone,
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile
    ];
    for (const v of direct) if (ok27(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok27(v)) return String(v).trim();
      if (v && typeof v === "object") {
        const m = pickPhone(v);
        if (m) return m;
      }
    }
  }
  return null;
}
export function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map(k => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim(); if (s) return s;
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return null;
}

// ---------- profile helpers used by UI ----------
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
      const m = pickPhone(data);
      if (m) return m;
    } catch {}
  }
  return null;
}

export async function fetchProfileForDisplay(env, id) {
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street ?? src.address ?? src.address_1 ?? src.street_1 ??
    (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";

  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip  =
    src.zip_code ?? src.zip ??
    (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    (pickFrom(src, ["passport","id_number","idnumber","national_id","id_card","identity","identity_number","document_number"]) || "");

  return {
    kind: cust ? "customer" : lead ? "lead" : "unknown",
    id,
    // Prefer "name", fall back to "full_name"
    full_name: src.name || src.full_name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- mapping for approvals (routes can use this) ----------
export function mapEditsToSplynxPayload(edits = {}, pay_method, debit, attachments) {
  // Splynx updates accept "name" (primary), some installs also expose "full_name";
  // we send both to be safe. Empty values are omitted.
  const o = {};
  const set = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== "") o[k] = v; };

  set("name", edits.full_name);
  set("full_name", edits.full_name);
  set("email", edits.email);
  set("phone_mobile", edits.phone);
  set("street_1", edits.street);
  set("city", edits.city);
  set("zip_code", edits.zip);
  set("payment_method", pay_method);
  if (attachments && attachments.length) set("attachments", attachments);
  if (debit && typeof debit === "object") set("debit", debit);
  return o;
}

// ---------- document create + upload (customers & leads) ----------
//
// Endpoints verified against your instance:
//   Create (customers): POST /admin/customers/customer-documents
//   Upload:            POST /admin/customers/customer-documents/{id}--upload
//
//   Create (leads):    POST /admin/crm/lead-documents
//   Upload:            POST /admin/crm/lead-documents/{id}--upload
//
// "type" MUST be "uploaded" when we intend to attach a file.

function docCreateEndpoint(entity) {
  return entity === "lead"
    ? "/admin/crm/lead-documents"
    : "/admin/customers/customer-documents";
}
function docUploadEndpoint(entity, docId) {
  const base = entity === "lead"
    ? "/admin/crm/lead-documents"
    : "/admin/customers/customer-documents";
  return `${base}/${docId}--upload`;
}

/**
 * Create a document shell (returns document id).
 * @param {'customer'|'lead'} entity
 */
export async function splynxCreateDocument(env, entity, entityId, { title, description = "", type = "uploaded" } = {}) {
  const payload = {
    // API expects *customer_id* or *lead_id* depending on entity
    ...(entity === "lead" ? { lead_id: Number(entityId) } : { customer_id: Number(entityId) }),
    title: String(title || "Uploaded document"),
    description: String(description || ""),
    type: "uploaded",
  };
  return splynxPOST(env, docCreateEndpoint(entity), payload);
}

/**
 * Upload file bytes to an existing document (FormData multipart).
 * @param {'customer'|'lead'} entity
 */
export async function splynxUploadDocumentFile(env, entity, entityId, documentId, fileBytes, filename, mime = "application/octet-stream") {
  // In Workers, use FormData + Blob so CF sets Content-Type with boundary automatically.
  const fd = new FormData();
  fd.append(entity === "lead" ? "lead_id" : "customer_id", String(entityId));
  fd.append("document_id", String(documentId));
  fd.append("file", new Blob([fileBytes], { type: mime }), filename || "upload.bin");

  const r = await fetch(`${env.SPLYNX_API}${docUploadEndpoint(entity, documentId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx UPLOAD ${docUploadEndpoint(entity, documentId)} ${r.status} ${t}`);
  }
  // Response may be empty JSON
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  return r.json().catch(() => ({}));
}

/**
 * Convenience: create doc then upload bytes in one call.
 * Returns { id, upload } where id is document id.
 * @param {'customer'|'lead'} entity
 */
export async function splynxCreateAndUpload(env, entity, entityId, {
  title, description, filename, mime = "application/octet-stream", bytes
}) {
  if (!(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) {
    throw new Error("bytes must be ArrayBuffer or a typed array");
  }
  const { id } = await splynxCreateDocument(env, entity, entityId, { title, description, type: "uploaded" });
  const fileBytes = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const upload = await splynxUploadDocumentFile(env, entity, entityId, id, fileBytes, filename, mime);
  return { id, upload };
}
