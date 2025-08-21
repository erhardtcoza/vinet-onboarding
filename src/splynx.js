// src/splynx.js

// ---------- Low-level HTTP helpers ----------
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
    const t = await r.text().catch(()=>"");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json();
}

// ---------- Field helpers ----------
function nz(v){ const s = (v==null?"":String(v)).trim(); return s || undefined; }

// Build an update payload for both customers & leads.
// - Use `name` (Splynx’ primary name field).
// - Update both `email` and `billing_email`.
export function mapEditsToSplynxPayload(edits={}, payMethod, debit, attachments=[]) {
  const out = {
    name: nz(edits.full_name || edits.name),
    email: nz(edits.email),
    billing_email: nz(edits.email),
    phone: nz(edits.phone) || nz(edits.phone_mobile) || nz(edits.msisdn),
    street_1: nz(edits.street || edits.address || edits.address_1),
    city: nz(edits.city),
    zip_code: nz(edits.zip || edits.zip_code),
    payment_method: nz(payMethod),
  };

  // Splynx ignores unknowns, so it’s safe to include these when present.
  if (attachments && attachments.length) out.attachments = attachments;
  if (debit) out.debit = debit;

  return out;
}

// ---------- Profile fetch (LEAD first, then CUSTOMER) ----------
export async function fetchProfileForDisplay(env, id) {
  const sid = String(id||"").trim();

  // Try LEAD first
  let lead=null, cust=null, custInfo=null;
  try { lead = await splynxGET(env, `/admin/crm/leads/${sid}`); } catch {}

  if (!lead) {
    // Try CUSTOMER if not a lead
    try { cust = await splynxGET(env, `/admin/customers/customer/${sid}`); } catch {}
    if (cust) {
      try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${sid}`); } catch {}
    }
  }

  const src = lead || cust || {};

  // Basic fields
  const name = src.name || src.full_name || "";
  const email = src.email || src.billing_email || "";
  const phone = src.phone || src.phone_mobile || src.msisdn || "";
  const street = src.street_1 || src.street || src.address || src.address_1 || "";
  const city   = src.city || "";
  const zip    = src.zip_code || src.zip || "";

  // Passport / ID number
  let passport = "";
  if (lead) {
    passport = nz(lead.id_number) || nz(lead.passport) || "";
  } else if (cust) {
    passport = (custInfo && (custInfo.id_number || custInfo.identity_number || custInfo.passport)) || "";
  }

  return {
    kind: lead ? "lead" : cust ? "customer" : "unknown",
    id: sid,
    full_name: name,
    email,
    phone,
    city, street, zip,
    passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || ""
  };
}

// Still used by OTP flow; keep simple and deterministic
export async function fetchCustomerMsisdn(env, id) {
  const sid = String(id||"").trim();
  // Try lead, then customer
  try {
    const l = await splynxGET(env, `/admin/crm/leads/${sid}`);
    if (l && (l.phone || l.msisdn)) return String(l.phone || l.msisdn);
  } catch {}
  try {
    const c = await splynxGET(env, `/admin/customers/customer/${sid}`);
    if (c && (c.phone || c.phone_mobile)) return String(c.phone || c.phone_mobile);
  } catch {}
  return null;
}

// ---------- Create & Upload a document (customers & leads) ----------
/*
  splynxCreateAndUpload(env, entity, id, {
    title, description, filename, mime, bytes
  })

  - entity: "lead" | "customer"
  - id: numeric string id
  - creates doc with type:"uploaded" then uploads file via {docId}--upload
*/
export async function splynxCreateAndUpload(env, entity, id, file) {
  const isLead = entity === "lead";
  const sid = String(id||"").trim();

  // 1) Create the document shell
  async function createDoc(payload) {
    const ep = isLead
      ? `/admin/crm/leads-documents`
      : `/admin/customers/customer-documents`;
    return await splynxPOST(env, ep, payload);
  }

  // Some installations want `lead_id` for leads, some (buggy samples) accept `customer_id`.
  // We’ll try lead_id first, fall back to customer_id once.
  let created = null;
  if (isLead) {
    try {
      created = await createDoc({
        lead_id: Number(sid),
        type: "uploaded",
        title: file.title || "Document",
        description: file.description || "",
        visible_by_customer: "0"
      });
    } catch {
      // fallback
      created = await createDoc({
        customer_id: Number(sid),
        type: "uploaded",
        title: file.title || "Document",
        description: file.description || "",
        visible_by_customer: "0"
      });
    }
  } else {
    created = await createDoc({
      customer_id: Number(sid),
      type: "uploaded",
      title: file.title || "Document",
      description: file.description || "",
      visible_by_customer: "0"
    });
  }

  const docId = String(created && (created.id || created.result || created.document_id || created.data && created.data.id) || "").trim();
  if (!docId) throw new Error("splynxCreateAndUpload: no document id returned");

  // 2) Upload file bytes via {id}--upload
  const uploadPath = isLead
    ? `/admin/crm/leads-documents/${docId}--upload`
    : `/admin/customers/customer-documents/${docId}--upload`;

  const fd = new FormData();
  const blob = new Blob([file.bytes], { type: file.mime || "application/octet-stream" });
  // filename is important; Splynx shows this in UI
  fd.append("file", blob, (file.filename || "document.bin"));

  const up = await fetch(`${env.SPLYNX_API}${uploadPath}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: fd
  });
  if (!up.ok) {
    const t = await up.text().catch(()=> "");
    throw new Error(`Upload ${uploadPath} ${up.status} ${t}`);
  }
  return true;
}
