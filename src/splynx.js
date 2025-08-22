// src/splynx.js
import { escapeHtml } from "./helpers.js";

<<<<<<< HEAD
// ----------- Core HTTP helpers -----------
=======
/* ------------------------------
 * Low-level HTTP helpers
 * ------------------------------ */

// GET
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
export async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

// PUT
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
    const t = await r.text().catch(()=>"");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

<<<<<<< HEAD
export async function splynxPOST(env, endpoint, body) {
=======
// POST (new)
export async function splynxPOST(env, endpoint, body, headers = {}) {
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
<<<<<<< HEAD
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(()=>"");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

// Multipart upload (Blob/FormData)
export async function splynxPOSTMultipart(env, endpoint, formData) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      // DO NOT set Content-Type; let the runtime set multipart boundary
    },
    body: formData,
  });
  if (!r.ok) {
    const t = await r.text().catch(()=>"");
    throw new Error(`Splynx POST multipart ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

// ----------- Phone pickers (unchanged) -----------
function ok27(s){ return /^27\d{8,13}$/.test(String(s||"").trim()); }
export function pickPhone(obj){
  if (!obj) return null;
  if (typeof obj==="string") return ok27(obj)?String(obj).trim():null;
  if (Array.isArray(obj)) { for (const it of obj){ const m=pickPhone(it); if(m) return m; } return null; }
  if (typeof obj==="object"){
    const direct=[obj.phone_mobile,obj.mobile,obj.phone,obj.whatsapp,obj.msisdn,obj.primary_phone,obj.contact_number,obj.billing_phone,obj.contact_number_2nd,obj.contact_number_3rd,obj.alt_phone,obj.alt_mobile];
    for (const v of direct) if (ok27(v)) return String(v).trim();
    for (const [,v] of Object.entries(obj)){
      if (typeof v==="string" && ok27(v)) return String(v).trim();
      if (v && typeof v==="object"){ const m=pickPhone(v); if (m) return m; }
=======
      ...(body instanceof FormData
        ? {} // fetch will set proper multipart boundary
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body instanceof FormData ? body : JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

/* ------------------------------
 * Phone + generic pickers
 * ------------------------------ */

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
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
    }
  }
  return null;
}
<<<<<<< HEAD
export function pickFrom(obj, keys){
  if (!obj) return null;
  const wanted = keys.map(k=>String(k).toLowerCase());
  const stack=[obj];
  while (stack.length){
    const cur=stack.pop();
    if (Array.isArray(cur)){ for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur==="object"){
      for (const [k,v] of Object.entries(cur)){
        if (wanted.includes(String(k).toLowerCase())){
          const s=String(v??"").trim(); if (s) return s;
        }
        if (v && typeof v==="object") stack.push(v);
=======
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
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
      }
    }
  }
  return null;
}

<<<<<<< HEAD
export async function fetchCustomerMsisdn(env, id) {
  const eps=[
=======
/* ------------------------------
 * Profile helpers you already had
 * ------------------------------ */

export async function fetchCustomerMsisdn(env, id) {
  const eps = [
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
<<<<<<< HEAD
    try { const data=await splynxGET(env, ep); const m=pickPhone(data); if(m) return m; } catch {}
=======
    try {
      const data = await splynxGET(env, ep);
      const m = pickPhone(data);
      if (m) return m;
    } catch {}
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
  }
  return null;
}

export async function fetchProfileForDisplay(env, id) {
<<<<<<< HEAD
  let cust=null,lead=null,contacts=null,custInfo=null;
  try { cust=await splynxGET(env, `/admin/customers/customer/${id}`);} catch {}
  if (!cust){ try {lead=await splynxGET(env, `/admin/crm/leads/${id}`);} catch {} }
  try { contacts=await splynxGET(env, `/admin/customers/${id}/contacts`);} catch {}
  try { custInfo=await splynxGET(env, `/admin/customers/customer-info/${id}`);} catch {}
  const src=cust||lead||{};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street ?? src.address ?? src.address_1 ?? src.street_1 ?? (src.addresses&&(src.addresses.street||src.addresses.address_1)) ?? "";
  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip  = src.zip_code ?? src.zip ?? (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";

=======
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street ?? src.address ?? src.address_1 ?? src.street_1 ?? (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";
  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip  = src.zip_code ?? src.zip ?? (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";

>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    (pickFrom(src, ["passport","id_number","idnumber","national_id","id_card","identity","identity_number","document_number"]) || "");

  return {
    kind: cust ? "customer" : lead ? "lead" : "unknown",
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

<<<<<<< HEAD
// ----------- Documents (create + upload) -----------
/**
 * Create a document placeholder in Splynx.
 * kind: "customer" | "lead"
 * Returns { id: <docId> } or throws.
 */
export async function splynxCreateDocument(env, kind, entityId, title, description="") {
  const base = kind === "lead"
    ? `/admin/crm/leads/${entityId}/documents`
    : `/admin/customers/${entityId}/documents`;
  const payload = { title: title || "Onboarding Document", description };
  return await splynxPOST(env, base, payload);
}

/**
 * Upload a file for a document in Splynx (multipart).
 * bytes: ArrayBuffer|Uint8Array
 */
export async function splynxUploadDocumentFile(env, kind, entityId, docId, bytes, filename, contentType="application/octet-stream") {
  const base = kind === "lead"
    ? `/admin/crm/leads/${entityId}/documents/${docId}/file`
    : `/admin/customers/${entityId}/documents/${docId}/file`;
  const form = new FormData();
  const blob = bytes instanceof ArrayBuffer ? new Blob([bytes], { type: contentType }) :
               bytes instanceof Uint8Array ? new Blob([bytes.buffer], { type: contentType }) :
               bytes; // last resort if already Blob
  form.append("file", blob, filename || "file.bin");
  return await splynxPOSTMultipart(env, base, form);
}

/**
 * Try upload to Customer; on failure, try Lead. Returns { kind, docId } or null on total failure.
 */
export async function splynxCreateAndUploadDocFallback(env, entityId, title, bytes, filename, contentType) {
  // 1) Customer
  try {
    const doc = await splynxCreateDocument(env, "customer", entityId, title);
    const docId = doc?.id ?? doc?.data?.id ?? doc?.result?.id;
    if (!docId) throw new Error("No doc id");
    await splynxUploadDocumentFile(env, "customer", entityId, docId, bytes, filename, contentType);
    return { kind: "customer", docId };
  } catch (e1) {
    // 2) Lead
    try {
      const doc = await splynxCreateDocument(env, "lead", entityId, title);
      const docId = doc?.id ?? doc?.data?.id ?? doc?.result?.id;
      if (!docId) throw new Error("No doc id");
      await splynxUploadDocumentFile(env, "lead", entityId, docId, bytes, filename, contentType);
      return { kind: "lead", docId };
    } catch (e2) {
      return null;
    }
  }
=======
/* ------------------------------
 * NEW: build update bodies (map full_name → name)
 * ------------------------------ */

export function buildUpdateBody({ edits = {}, pay_method, debit, attachments } = {}) {
  // Splynx expects "name" for the display name. We also include full_name for back-compat.
  const name = (edits.full_name || edits.name || "").toString().trim() || undefined;

  const body = {
    // Names
    name,                             // ✅ what Splynx actually uses
    full_name: name,                  // keep for back-compat just in case

    // Contacts
    email: edits.email || undefined,
    phone_mobile: edits.phone || undefined,

    // Address
    street_1: edits.street || undefined,
    city: edits.city || undefined,
    zip_code: edits.zip || undefined,

    // Payment
    payment_method: pay_method || undefined,

    // Optional structures you already store
    debit: debit || undefined,
    attachments: attachments || undefined, // e.g. array of public URLs if you use them
  };

  // Remove undefined to avoid overwriting with null-ish
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/* ------------------------------
 * NEW: Update helpers for Customer/Lead
 * ------------------------------ */

export async function updateCustomer(env, id, body) {
  // As per your API doc link: customers update
  // https://splynx.docs.apiary.io/#reference/customers/customer/update-a-customer
  return splynxPUT(env, `/admin/customers/customer/${id}`, body);
}

export async function updateLead(env, id, body) {
  // Leads update
  // https://splynx.docs.apiary.io/#reference/crm/lead/update-a-lead
  return splynxPUT(env, `/admin/crm/leads/${id}`, body);
}

/* ------------------------------
 * NEW: Documents — create + upload (customer & lead)
 * ------------------------------ */

// Splynx docs show: create document first, then upload the file to that document.
// We'll try common path variants to be robust across versions.

/** Create a CUSTOMER document (returns { id, ... } of the document) */
export async function createCustomerDocument(env, customerId, meta = {}) {
  const payload = {
    name: meta.name || "Document",
    description: meta.description || "",
    // You can add more fields if your Splynx uses them: type, tags, etc.
  };

  const candidates = [
    `/admin/customers/${customerId}/documents`,
    `/admin/customers/customer/${customerId}/documents`,
    `/admin/customers/customer-documents/${customerId}`,
  ];

  for (const ep of candidates) {
    try { return await splynxPOST(env, ep, payload); } catch { /* try next */ }
  }
  throw new Error("Splynx: unable to create customer document (all endpoints failed)");
>>>>>>> 8729788e874bb2c7ef78fcc919fbd5f88de1f53a
}

/** Create a LEAD document (returns { id, ... } of the document) */
export async function createLeadDocument(env, leadId, meta = {}) {
  const payload = {
    name: meta.name || "Document",
    description: meta.description || "",
  };

  const candidates = [
    `/admin/crm/leads/${leadId}/documents`,
    `/admin/crm/lead-documents/${leadId}`,
  ];

  for (const ep of candidates) {
    try { return await splynxPOST(env, ep, payload); } catch {}
  }
  throw new Error("Splynx: unable to create lead document (all endpoints failed)");
}

/** Upload BYTES to an existing CUSTOMER document */
export async function uploadCustomerDocumentFile(env, customerId, documentId, filename, bytes, contentType = "application/octet-stream") {
  // As per "Upload file for customer document"
  // https://splynx.docs.apiary.io/#reference/customers/customer-documents-upload-file/upload-file-for-customer-document
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: contentType }), filename);

  const candidates = [
    `/admin/customers/${customerId}/documents/${documentId}/upload`,
    `/admin/customers/customer/${customerId}/documents/${documentId}/upload`,
    `/admin/customers/customer-documents/${customerId}/${documentId}/upload`,
  ];

  for (const ep of candidates) {
    try { return await splynxPOST(env, ep, fd); } catch {}
  }
  throw new Error("Splynx: unable to upload file to customer document (all endpoints failed)");
}

/** Upload BYTES to an existing LEAD document */
export async function uploadLeadDocumentFile(env, leadId, documentId, filename, bytes, contentType = "application/octet-stream") {
  // https://splynx.docs.apiary.io/#reference/crm/lead-documents-upload-file/upload-file-for-lead-document
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: contentType }), filename);

  const candidates = [
    `/admin/crm/leads/${leadId}/documents/${documentId}/upload`,
    `/admin/crm/lead-documents/${leadId}/${documentId}/upload`,
  ];

  for (const ep of candidates) {
    try { return await splynxPOST(env, ep, fd); } catch {}
  }
  throw new Error("Splynx: unable to upload file to lead document (all endpoints failed)");
}

/* ------------------------------
 * NEW: Convenience – fetch a URL then create+upload
 * ------------------------------ */

/**
 * Fetch a file (e.g., your generated PDF) from `fileUrl` and upload it
 * into Splynx as a CUSTOMER document.
 */
export async function createAndUploadCustomerDocFromUrl(env, customerId, { title, description, fileUrl, filename, contentType = "application/pdf" }) {
  const fr = await fetch(fileUrl);
  if (!fr.ok) throw new Error(`Fetch fileUrl failed ${fr.status}`);
  const bytes = new Uint8Array(await fr.arrayBuffer());

  const doc = await createCustomerDocument(env, customerId, { name: title, description });
  const docId = doc?.id || doc?.document_id || doc?.data?.id;
  if (!docId) throw new Error("Splynx: created customer document but no id found in response");

  await uploadCustomerDocumentFile(env, customerId, docId, filename, bytes, contentType);
  return { ok: true, documentId: docId };
}

/**
 * Same, but for LEADS.
 */
export async function createAndUploadLeadDocFromUrl(env, leadId, { title, description, fileUrl, filename, contentType = "application/pdf" }) {
  const fr = await fetch(fileUrl);
  if (!fr.ok) throw new Error(`Fetch fileUrl failed ${fr.status}`);
  const bytes = new Uint8Array(await fr.arrayBuffer());

  const doc = await createLeadDocument(env, leadId, { name: title, description });
  const docId = doc?.id || doc?.document_id || doc?.data?.id;
  if (!docId) throw new Error("Splynx: created lead document but no id found in response");

  await uploadLeadDocumentFile(env, leadId, docId, filename, bytes, contentType);
  return { ok: true, documentId: docId };
}