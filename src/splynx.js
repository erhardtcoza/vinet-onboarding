// src/splynx.js

// ---------- Basic HTTP helpers ----------
export async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

export async function splynxPUT(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// ---------- Entity-kind detection (prefer LEAD; else CUSTOMER) ----------
export async function detectEntityKind(env, id) {
  try {
    const lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    if (lead && lead.id) return { kind: "lead", data: lead };
  } catch {}
  try {
    const cust = await splynxGET(env, `/admin/customers/customer/${id}`);
    if (cust && cust.id) return { kind: "customer", data: cust };
  } catch {}
  return { kind: "unknown", data: null };
}

// ---------- Profile fetch for UI (simple fields only) ----------
export async function fetchProfileForDisplay(env, id) {
  let lead = null, cust = null, custInfo = null;

  try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {}
  if (!lead) { try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {} }
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = lead || cust || {};
  const phone = typeof src.phone === "string" ? src.phone.trim() : "";

  const street = src.street_1 ?? src.street ?? src.address ?? "";
  const city   = src.city ?? "";
  const zip    = src.zip_code ?? src.zip ?? "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number || "";

  return {
    kind: lead ? "lead" : cust ? "customer" : "unknown",
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone,
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- WhatsApp MSISDN fetch (single canonical field) ----------
export async function fetchCustomerMsisdn(env, id) {
  // Prefer lead, then customer – and only the canonical `phone` field.
  try {
    const d = await splynxGET(env, `/admin/crm/leads/${id}`);
    const msisdn = d && typeof d.phone === "string" ? d.phone.trim() : null;
    if (msisdn) return msisdn;
  } catch {}
  try {
    const d = await splynxGET(env, `/admin/customers/customer/${id}`);
    const msisdn = d && typeof d.phone === "string" ? d.phone.trim() : null;
    if (msisdn) return msisdn;
  } catch {}
  return null;
}

// ---------- Map onboarding edits to Splynx payload ----------
// Ensures:
//  - name updates (Splynx expects `name`; we also set `full_name` for safety)
//  - both `email` and `billing_email` are kept in sync
export function mapEditsToSplynxPayload(edits = {}, extra = {}) {
  const name = (edits.full_name || "").trim();
  const email = (edits.email || "").trim();
  const phone = (edits.phone || "").trim();

  const body = {
    // name fields
    ...(name ? { name } : {}),
    ...(name ? { full_name: name } : {}),

    // emails (both)
    ...(email ? { email } : {}),
    ...(email ? { billing_email: email } : {}),

    // phone
    ...(phone ? { phone } : {}),         // canonical
    ...(phone ? { phone_mobile: phone } : {}), // some installs also use this

    // address
    ...(edits.street ? { street_1: edits.street } : {}),
    ...(edits.city ?   { city: edits.city } : {}),
    ...(edits.zip ?    { zip_code: edits.zip } : {}),
    ...extra,
  };

  return body;
}

// ---------- MIME guessing (lightweight) ----------
function guessMime(fileName = "", fallback = "application/octet-stream") {
  const n = String(fileName).toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return fallback;
}

// ---------- Create doc + upload file (customer or lead) ----------
/**
 * splynxCreateAndUpload(env, {
 *   entityId: "319",
 *   entityKind: "lead" | "customer" | "auto",  // "auto" -> try lead then customer
 *   title: "ID Document",
 *   description: "RICA ID upload",
 *   fileBytes: <Uint8Array|ArrayBuffer>,
 *   fileName: "id.pdf",
 *   mime: "application/pdf"
 * }) -> { ok: true, docId }
 */
export async function splynxCreateAndUpload(env, opts) {
  const {
    entityId,
    title = "Uploaded file",
    description = "",
    fileBytes,
    fileName = "file.bin",
    mime,
  } = opts || {};
  let { entityKind = "auto" } = opts || {};

  if (!entityId) throw new Error("splynxCreateAndUpload: missing entityId");
  if (!fileBytes) throw new Error("splynxCreateAndUpload: missing fileBytes");

  // Resolve kind when "auto"
  if (entityKind === "auto") {
    const det = await detectEntityKind(env, entityId);
    entityKind = det.kind;
  }
  if (entityKind !== "lead" && entityKind !== "customer") {
    throw new Error("splynxCreateAndUpload: unknown entity kind");
  }

  // Endpoints per kind
  const cfg = (kind) => kind === "lead"
    ? {
        create:  `/admin/crm/leads-documents`,
        uploadA: (docId) => `/admin/crm/leads-documents/${docId}/upload-file`,
        uploadB: `/admin/crm/leads-documents-upload-file`,
        idField: "customer_id", // API expects "customer_id" in payload even for leads-docs
      }
    : {
        create:  `/admin/customers/customer-documents`,
        uploadA: (docId) => `/admin/customers/customer-documents/${docId}/upload-file`,
        uploadB: `/admin/customers/customer-documents-upload-file`,
        idField: "customer_id",
      };

  const c = cfg(entityKind);

  // 1) Create the document shell (type must be "uploaded")
  const createBody = {
    [c.idField]: Number(entityId),
    type: "uploaded",
    title,
    description,
    visible_by_customer: "0",
  };
  const created = await fetch(`${env.SPLYNX_API}${c.create}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });
  if (!created.ok) {
    const t = await created.text().catch(() => "");
    throw new Error(`Splynx create-doc ${c.create} ${created.status} ${t}`);
  }
  const createdJson = await created.json().catch(() => ({}));
  const docId = createdJson && (createdJson.id || createdJson.document_id);
  if (!docId) throw new Error("Splynx create-doc: no id returned");

  // 2) Upload the file
  const mimeType = mime || guessMime(fileName);
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const blob = new Blob([bytes], { type: mimeType });
  const form = new FormData();
  // Some installs require both; harmless to include:
  form.append("customer_id", String(entityId));
  form.append("document_id", String(docId));
  form.append("file", new File([blob], fileName, { type: mimeType }));

  // Try canonical path first: /{docId}/upload-file
  let uploadedOK = false;
  try {
    const upA = await fetch(`${env.SPLYNX_API}${c.uploadA(docId)}`, {
      method: "POST",
      headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      body: form,
    });
    if (upA.ok) uploadedOK = true;
  } catch {}

  // Fallback: flat upload endpoint with IDs in form
  if (!uploadedOK) {
    const upB = await fetch(`${env.SPLYNX_API}${c.uploadB}`, {
      method: "POST",
      headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      body: form,
    });
    if (!upB.ok) {
      const t = await upB.text().catch(() => "");
      throw new Error(`Splynx upload ${c.uploadB} ${upB.status} ${t}`);
    }
  }

  return { ok: true, docId, kind: entityKind };
}

export default {
  splynxGET,
  splynxPUT,
  detectEntityKind,
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  mapEditsToSplynxPayload,
  splynxCreateAndUpload,
};
