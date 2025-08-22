// src/splynx.js
import { escapeHtml } from "./helpers.js";

// ----------- Core HTTP helpers -----------
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
    const t = await r.text().catch(()=>"");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

export async function splynxPOST(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
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
    }
  }
  return null;
}
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
      }
    }
  }
  return null;
}

export async function fetchCustomerMsisdn(env, id) {
  const eps=[
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data=await splynxGET(env, ep); const m=pickPhone(data); if(m) return m; } catch {}
  }
  return null;
}

export async function fetchProfileForDisplay(env, id) {
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
}
