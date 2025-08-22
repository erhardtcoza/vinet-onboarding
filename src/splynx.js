// src/splynx.js
import { fetchR2Bytes } from "./helpers.js";

/* ───────────────────────────────────────────────────────────
   Low-level HTTP helpers
   ─────────────────────────────────────────────────────────── */
async function splynxFetch(env, endpoint, init = {}) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Basic ${env.SPLYNX_AUTH}`);
  return fetch(url, { ...init, headers });
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

export async function splynxPOSTMultipart(env, endpoint, formData) {
  // Do NOT set Content-Type; runtime sets the multipart boundary
  const r = await splynxFetch(env, endpoint, { method: "POST", body: formData });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx POST multipart ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

/* ───────────────────────────────────────────────────────────
   Phone helpers
   ─────────────────────────────────────────────────────────── */
function ok27(s) { return /^27\d{8,13}$/.test(String(s || "").trim()); }

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
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile
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
          const s = String(v ?? "").trim();
          if (s) return s;
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return null;
}

/* ───────────────────────────────────────────────────────────
   Entity detector (customer vs lead)
   ─────────────────────────────────────────────────────────── */
export async function detectEntityKind(env, id) {
  const num = Number(id);
  try { await splynxGET(env, `/admin/customers/customer/${num}`); return "customer"; } catch {}
  try { await splynxGET(env, `/admin/crm/leads/${num}`); return "lead"; } catch {}
  return "unknown";
}

/* ───────────────────────────────────────────────────────────
   Profile for onboarding (customer first, then lead)
   ─────────────────────────────────────────────────────────── */
export async function fetchProfileForDisplay(env, id) {
  const num = Number(id);
  let cust = null, custInfo = null, contacts = null;

  try { cust = await splynxGET(env, `/admin/customers/customer/${num}`); } catch {}
  if (cust) {
    try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${num}`); } catch {}
    try { contacts = await splynxGET(env, `/admin/customers/${num}/contacts`); } catch {}
    const phone = pickPhone({ ...cust, contacts });

    const street = cust.street ?? cust.address ?? cust.address_1 ?? cust.street_1 ?? "";
    const city   = cust.city ?? "";
    const zip    = cust.zip_code ?? cust.zip ?? "";

    const passport =
      (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
      cust.passport || cust.id_number ||
      (pickFrom(cust, ["passport","id_number","idnumber","national_id","id_card","identity","identity_number","document_number"]) || "");

    return {
      kind: "customer",
      id: String(id),
      full_name: cust.full_name || cust.name || "",
      email: cust.email || cust.billing_email || "",
      phone: phone || "",
      street, city, zip, passport,
      payment_method: cust.payment_method || "",
    };
  }

  // Lead fallback
  let lead = null;
  try { lead = await splynxGET(env, `/admin/crm/leads/${num}`); } catch {}
  if (lead) {
    const street = lead.street ?? lead.address ?? lead.address_1 ?? lead.street_1 ?? "";
    const city   = lead.city ?? "";
    const zip    = lead.zip_code ?? lead.zip ?? "";
    return {
      kind: "lead",
      id: String(id),
      full_name: lead.full_name || lead.name || "",
      email: lead.email || lead.billing_email || "",
      phone: lead.phone || "",
      street, city, zip,
      passport: "", // per your instance, passport lives on customer-info only
      payment_method: lead.payment_method || "",
    };
  }

  // Unknown fallback
  return {
    kind: "unknown",
    id: String(id),
    full_name: "", email: "", phone: "",
    street: "", city: "", zip: "", passport: "",
    payment_method: "",
  };
}

/* ───────────────────────────────────────────────────────────
   Map edits to Splynx payload
   (keeps billing_email in sync with email)
   ─────────────────────────────────────────────────────────── */
export function mapEditsToSplynxPayload(edits = {}, payMethod, debit, attachments = []) {
  const body = {};
  if (edits.full_name) body.name = edits.full_name;
  if (edits.email) { body.email = edits.email; body.billing_email = edits.email; }
  if (edits.phone) body.phone = edits.phone;
  if (edits.street) body.street_1 = edits.street;
  if (edits.city) body.city = edits.city;
  if (edits.zip) body.zip_code = edits.zip;
  if (payMethod) body.payment_method = payMethod;
  if (debit) body.debit = debit;
  if (attachments && attachments.length) body.attachments = attachments;
  return body;
}

/* ───────────────────────────────────────────────────────────
   Document create + upload (tries nested first, then legacy)
   ─────────────────────────────────────────────────────────── */
function guessContentType(filename = "") {
  const f = filename.toLowerCase();
  if (f.endsWith(".pdf")) return "application/pdf";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

// Nested API style
async function createDoc_nested(env, kind, id, title, description = "", visible = "0") {
  const base = kind === "lead"
    ? `/admin/crm/leads/${id}/documents`
    : `/admin/customers/${id}/documents`;
  return splynxPOST(env, base, { title: title || "Onboarding Document", description, visible_by_customer: String(visible) });
}

async function uploadDocFile_nested(env, kind, id, docId, bytes, filename, contentType) {
  const base = kind === "lead"
    ? `/admin/crm/leads/${id}/documents/${docId}/file`
    : `/admin/customers/${id}/documents/${docId}/file`;
  const fd = new FormData();
  const blob =
    bytes instanceof ArrayBuffer ? new Blob([bytes], { type: contentType }) :
    bytes instanceof Uint8Array ? new Blob([bytes.buffer], { type: contentType }) :
    bytes; // already a Blob
  fd.append("file", blob, filename || "upload.bin");
  return splynxPOSTMultipart(env, base, fd);
}

// Legacy API style
async function createDoc_legacy(env, kind, id, title, description = "", visible = "0") {
  const base = kind === "lead"
    ? `/admin/crm/leads-documents`
    : `/admin/customers/customer-documents`;
  const body = {
    type: "uploaded",
    title: title || "Onboarding Document",
    description,
    visible_by_customer: String(visible),
    ...(kind === "lead" ? { lead_id: Number(id) } : { customer_id: Number(id) }),
  };
  return splynxPOST(env, base, body);
}

async function uploadDocFile_legacy(env, kind, _id, docId, bytes, filename, contentType) {
  const base = kind === "lead"
    ? `/admin/crm/leads-documents/${docId}--upload`
    : `/admin/customers/customer-documents/${docId}--upload`;
  const fd = new FormData();
  const blob =
    bytes instanceof ArrayBuffer ? new Blob([bytes], { type: contentType }) :
    bytes instanceof Uint8Array ? new Blob([bytes.buffer], { type: contentType }) :
    bytes;
  fd.append("file", blob, filename || "upload.bin");
  return splynxPOSTMultipart(env, base, fd);
}

/**
 * Public: Create + upload one file (tries nested first, then legacy).
 * Returns { ok, kind, docId, strategy } or { ok:false, error }.
 */
export async function splynxCreateAndUploadOne(env, kind, id, opts) {
  const title = opts.title || opts.label || opts.filename || "Onboarding Document";
  const filename = opts.filename || "upload.bin";
  const mime = opts.mime || guessContentType(filename);
  const bytes = opts.bytes; // ArrayBuffer | Uint8Array | Blob
  const description = opts.description || "";
  const visible = opts.visible_by_customer ?? "0";

  // Strategy A: nested
  try {
    const created = await createDoc_nested(env, kind, id, title, description, visible);
    const docId = created?.id ?? created?.data?.id ?? created?.result?.id;
    if (!docId) throw new Error("nested: missing id");
    await uploadDocFile_nested(env, kind, id, docId, bytes, filename, mime);
    return { ok: true, kind, docId, strategy: "nested" };
  } catch (_eA) {
    // Strategy B: legacy
    try {
      const created = await createDoc_legacy(env, kind, id, title, description, visible);
      const docId = created?.id ?? created?.data?.id ?? created?.result?.id;
      if (!docId) throw new Error("legacy: missing id");
      await uploadDocFile_legacy(env, kind, id, docId, bytes, filename, mime);
      return { ok: true, kind, docId, strategy: "legacy" };
    } catch (eB) {
      return { ok: false, kind, error: String(eB?.message || eB || "upload failed") };
    }
  }
}

/* ───────────────────────────────────────────────────────────
   Helpers to fetch our own generated PDFs over HTTP (robust)
   ─────────────────────────────────────────────────────────── */
function getPublicOrigin(env) {
  if (env.API_URL && /^https?:\/\//i.test(env.API_URL)) return env.API_URL.replace(/\/+$/, "");
  if (env.FALLBACK_ORIGIN && /^https?:\/\//i.test(env.FALLBACK_ORIGIN)) return env.FALLBACK_ORIGIN.replace(/\/+$/, "");
  return "https://onboard.vinet.co.za";
}

async function fetchUrlBytes(url) {
  async function once() {
    const r = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!r.ok) return { ok: false };
    const bytes = await r.arrayBuffer();
    const ct = r.headers.get("content-type") || "application/pdf";
    return { ok: true, bytes, ct };
  }
  let res = await once();
  if (!res.ok) res = await once(); // simple retry
  return res.ok ? { bytes: res.bytes, contentType: res.ct } : null;
}

/* ───────────────────────────────────────────────────────────
   Push ALL files from an onboarding session (R2 → Splynx),
   and also attach generated PDFs (MSA and, if chosen, Debit).
   ─────────────────────────────────────────────────────────── */
export async function uploadAllSessionFilesToSplynx(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return { ok: false, error: "unknown-session" };

  const id = (String(linkid).split("_")[0] || String(sess.splynx_id || sess.id || "")).trim();
  if (!id) return { ok: false, error: "missing-id" };

  const kind = await detectEntityKind(env, id);
  if (kind === "unknown") return { ok: false, error: "unknown-entity" };

  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const out = [];

  // 1) RICA uploads from R2
  for (const u of uploads) {
    try {
      const bytes = await fetchR2Bytes(env, u.key);
      if (!bytes) { out.push({ ok: false, name: u.name, error: "r2-miss" }); continue; }
      const res = await splynxCreateAndUploadOne(env, kind, id, {
        title: u.label || u.name || "Onboarding Document",
        description: `Uploaded via onboarding (${linkid})`,
        filename: u.name || "upload.bin",
        mime: guessContentType(u.name || ""),
        bytes,
        visible_by_customer: "0"
      });
      out.push({ ...res, name: u.name || null, label: u.label || null });
    } catch (e) {
      out.push({ ok: false, name: u?.name || null, error: String(e?.message || e || "failed") });
    }
  }

  // 2) Generated MSA PDF
  try {
    const publicOrigin = getPublicOrigin(env);
    const msaUrl = `${publicOrigin}/pdf/msa/${encodeURIComponent(linkid)}`;
    const msa = await fetchUrlBytes(msaUrl);
    if (msa?.bytes) {
      const res = await splynxCreateAndUploadOne(env, kind, id, {
        title: "Master Service Agreement",
        description: `Onboarding MSA (${linkid})`,
        filename: `MSA_${id}.pdf`,
        mime: "application/pdf",
        bytes: msa.bytes,
        visible_by_customer: "0"
      });
      out.push({ ...res, name: "MSA.pdf" });
    } else {
      out.push({ ok: false, name: "MSA.pdf", error: "pdf-miss" });
    }
  } catch (e) {
    out.push({ ok: false, name: "MSA.pdf", error: String(e?.message || e) });
  }

  // 3) Debit Order PDF (only if debit flow selected/signed)
  const wantsDebit = (sess.pay_method === "debit") || !!sess.debit_signed;
  if (wantsDebit) {
    try {
      const publicOrigin = getPublicOrigin(env);
      const doUrl = `${publicOrigin}/pdf/debit/${encodeURIComponent(linkid)}`;
      const dopdf = await fetchUrlBytes(doUrl);
      if (dopdf?.bytes) {
        const res = await splynxCreateAndUploadOne(env, kind, id, {
          title: "Debit Order Agreement",
          description: `Onboarding Debit Order (${linkid})`,
          filename: `Debit_Order_${id}.pdf`,
          mime: "application/pdf",
          bytes: dopdf.bytes,
          visible_by_customer: "0"
        });
        out.push({ ...res, name: "Debit_Order.pdf" });
      } else {
        out.push({ ok: false, name: "Debit_Order.pdf", error: "pdf-miss" });
      }
    } catch (e) {
      out.push({ ok: false, name: "Debit_Order.pdf", error: String(e?.message || e) });
    }
  }

  return { ok: true, kind, id, items: out };
}