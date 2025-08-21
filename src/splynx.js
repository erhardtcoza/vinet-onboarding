// src/splynx.js
import { escapeHtml } from "./helpers.js";

// ---------- Core HTTP helpers ----------
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
    const t = await r.text().catch(()=> "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

async function splynxPOST(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}

// ---------- Phone + profile helpers (your originals) ----------
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

// ---------- NEW: Documents create + upload ----------
export async function splynxCreateCustomerDocument(env, customerId, { title, description="Uploaded by onboarding", type="uploaded" }){
  // Docs say "type" should be "uploaded" for file uploads
  const payload = { customer_id: Number(customerId), title, description, type };
  const out = await splynxPOST(env, `/admin/customers/customer-documents`, payload);
  // expected: { id: <doc_id> }
  return out && out.id ? out.id : null;
}

async function uploadVariant(env, variantPath, fileBlob){
  const form = new FormData();
  form.append("file", fileBlob);
  const r = await fetch(`${env.SPLYNX_API}${variantPath}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Upload ${variantPath} ${r.status} ${await r.text().catch(()=> "")}`);
  return true;
}

// Try multiple upload endpoints (your instance accepted the "--upload" variant)
export async function splynxUploadCustomerDocumentFile(env, { documentId, customerId, bytes, filename="document.pdf", mime="application/pdf" }){
  const blob = new Blob([bytes], { type: mime });

  const tries = [
    // Official documented:
    `/admin/customers/customer-documents/${documentId}/upload-file`,
    `/admin/customers/customer-documents-upload-file/${documentId}`,
    // Body variant (some installs):
    null, // placeholder for body variant (needs customer_id + document_id)
    // Your working variant from curl:
    `/admin/customers/customer-documents/${documentId}--upload`,
  ];

  // Try path variants first
  for (const p of tries) {
    if (!p) continue;
    try {
      return await uploadVariant(env, p, blob);
    } catch (e) {
      // try next
    }
  }

  // Fallback: POST with customer_id + document_id as form fields
  const form = new FormData();
  form.append("customer_id", String(customerId));
  form.append("document_id", String(documentId));
  form.append("file", blob, filename);
  const r = await fetch(`${env.SPLYNX_API}/admin/customers/customer-documents-upload-file`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Upload fallback ${r.status} ${await r.text().catch(()=> "")}`);
  return true;
}

// Convenience: create a doc and upload a file fetched from a URL
export async function splynxCreateAndUploadFromUrl(env, { customerId, title, description, fileUrl, filename, mime="application/pdf" }){
  // 1) Create doc (type "uploaded")
  const docId = await splynxCreateCustomerDocument(env, customerId, { title, description, type:"uploaded" });
  if (!docId) throw new Error("Failed to create customer document");

  // 2) Fetch file
  const res = await fetch(fileUrl, { cf:{ cacheTtl: 0, cacheEverything: false } });
  if (!res.ok) throw new Error(`Fetch file ${fileUrl} ${res.status}`);
  const bytes = await res.arrayBuffer();

  // 3) Upload file to that doc
  await splynxUploadCustomerDocumentFile(env, { documentId: docId, customerId, bytes, filename, mime });
  return { document_id: docId };
}
