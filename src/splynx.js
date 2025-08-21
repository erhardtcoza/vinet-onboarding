// src/splynx.js
// Splynx helpers: GET/PUT, profile fetch, phone pickers, payload mapping,
// and document create+upload for both LEADS and CUSTOMERS (lead-first).

// ---------- Core HTTP ----------
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
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// ---------- Entity detection (lead-first) ----------
export async function detectEntityKind(env, id) {
  try {
    await splynxGET(env, `/admin/crm/leads/${id}`);
    return "lead";
  } catch {}
  try {
    await splynxGET(env, `/admin/customers/customer/${id}`);
    return "customer";
  } catch {}
  return null;
}

// ---------- Utilities to extract phones/fields ----------
function ok27(s) {
  return /^27\d{8,13}$/.test(String(s || "").trim());
}
export function pickPhone(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return ok27(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
    return null;
  }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn,
      obj.primary_phone, obj.contact_number, obj.billing_phone,
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile,
    ];
    for (const v of direct) if (ok27(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok27(v)) return String(v).trim();
      if (v && typeof v === "object") { const m = pickPhone(v); if (m) return m; }
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

// ---------- Display profile (used by onboarding UI & admin review) ----------
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
  const city   = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip    = src.zip_code ?? src.zip ??
                 (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";

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

// ---------- Map onboarding edits -> Splynx payload ----------
// IMPORTANT: Splynx expects "name" (not "full_name"). Also update BOTH email & billing_email.
export function mapEditsToSplynxPayload(edits = {}, pay_method, debit) {
  const name = (edits.full_name || "").trim() || undefined;
  const email = (edits.email || "").trim() || undefined;
  const phone_mobile = (edits.phone || "").trim() || undefined;
  const street_1 = (edits.street || "").trim() || undefined;
  const city = (edits.city || "").trim() || undefined;
  const zip_code = (edits.zip || "").trim() || undefined;

  const body = {
    name,
    email,
    billing_email: email,   // keep in sync
    phone_mobile,
    street_1,
    city,
    zip_code,
  };

  if (pay_method) body.payment_method = pay_method;
  if (debit && typeof debit === "object") body.debit = debit;

  return body;
}

// ---------- Document Create + Upload (lead-first) ----------
// Accepts bytes (ArrayBuffer/Uint8Array) OR fileUrl to fetch.
// Returns { kind, docId }.
export async function splynxCreateAndUpload(env, {
  id,                   // numeric id
  preferKind,           // 'lead' | 'customer' | null (if provided, try first)
  title,
  description = "",
  contentType = "application/octet-stream",
  filename = "document.bin",
  bytes,                // ArrayBuffer | Uint8Array (optional)
  fileUrl,              // string (optional)
}) {
  if (!id) throw new Error("splynxCreateAndUpload: missing id");
  if (!title) throw new Error("splynxCreateAndUpload: missing title");

  // Choose entity kind (lead-first or forced)
  let kind = preferKind || null;
  if (!kind) kind = await detectEntityKind(env, id) || "customer";

  // Prepare file data
  let fileBytes = bytes;
  let ct = contentType;
  let fname = filename;

  if (!fileBytes && fileUrl) {
    const rf = await fetch(fileUrl);
    if (!rf.ok) throw new Error(`fetch fileUrl failed ${rf.status}`);
    const ab = await rf.arrayBuffer();
    fileBytes = ab;
    const hdrCT = rf.headers.get("content-type");
    if (hdrCT) ct = hdrCT;
    // try to infer filename from URL
    try {
      const u = new URL(fileUrl);
      const last = u.pathname.split("/").pop();
      if (last) fname = last;
    } catch {}
  }
  if (!fileBytes) throw new Error("splynxCreateAndUpload: missing bytes/fileUrl");

  const createEndpoint =
    kind === "lead" ? "/admin/crm/leads-documents" : "/admin/customers/customer-documents";
  const uploadEndpointPrefix =
    kind === "lead" ? "/admin/crm/leads-documents" : "/admin/customers/customer-documents";

  // Create metadata
  const meta = {
    customer_id: Number(id),   // APIary shows "customer_id" even for leads; include both to be safe
    lead_id:     Number(id),
    type: "uploaded",
    title,
    description,
    visible_by_customer: "0",
  };
  const createRes = await fetch(`${env.SPLYNX_API}${createEndpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meta),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`Create document failed (${kind}) ${createRes.status} ${t}`);
  }
  const created = await createRes.json().catch(() => ({}));
  const docId = created && (created.id || created.document_id || created.data?.id);

  if (!docId) throw new Error("Create document returned no id");

  // Upload file to .../{docId}--upload
  const fd = new FormData();
  fd.append("file", new Blob([fileBytes], { type: ct }), fname);

  const uploadRes = await fetch(
    `${env.SPLYNX_API}${uploadEndpointPrefix}/${docId}--upload`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      body: fd,
    }
  );
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => "");
    throw new Error(`Upload document failed (${kind}) ${docId} ${uploadRes.status} ${t}`);
  }

  return { kind, docId };
}
