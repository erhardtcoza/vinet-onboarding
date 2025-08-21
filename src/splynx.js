// /src/splynx.js
//
// Splynx client utilities used by routes.js
// Exports:
//   - fetchProfileForDisplay(env, id)
//   - fetchCustomerMsisdn(env, id)
//   - splynxPUT(env, path, body)
//   - pushOnboardToSplynx(env, sess, linkid)
//
// ENV expected:
//   SPLYNX_BASE:   e.g. "https://splynx.example.com"
//   SPLYNX_TOKEN:  "Bearer ..." (preferred)  OR
//   SPLYNX_BASIC:  "Basic base64(user:pass)"
//   R2_PUBLIC_BASE (optional, defaults to onboarding-uploads.vinethosting.org)
//   PUBLIC_ORIGIN  (optional, defaults to https://onboard.vinet.co.za)

const pickAuthHeader = (env) => {
  if (env.SPLYNX_TOKEN) return { Authorization: `Bearer ${env.SPLYNX_TOKEN}` };
  if (env.SPLYNX_BASIC) return { Authorization: env.SPLYNX_BASIC };
  return {};
};

const baseUrl = (env) => {
  const b = (env.SPLYNX_BASE || "").replace(/\/+$/, "");
  if (!b) throw new Error("SPLYNX_BASE not configured");
  return b;
};

async function splynxGET(env, path) {
  const url = `${baseUrl(env)}${path}`;
  const res = await fetch(url, { headers: { ...pickAuthHeader(env) } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GET ${path} -> ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export async function splynxPUT(env, path, body) {
  const url = `${baseUrl(env)}${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...pickAuthHeader(env) },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PUT ${path} -> ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Try to fetch a customer, else a lead, then map to the simple shape your UI expects.
 * Returns:
 *   { full_name, email, phone, passport, street, city, zip }
 */
export async function fetchProfileForDisplay(env, id) {
  const cid = String(id).trim();
  // Try Customer API first
  let src = null;
  try {
    src = await splynxGET(env, `/admin/customers/customer/${cid}`);
  } catch {
    // Try Lead API
    try { src = await splynxGET(env, `/admin/crm/leads/${cid}`); } catch { src = null; }
  }
  if (!src || typeof src !== "object") return {};

  // Splynx field names can vary a bit by version. Try common ones.
  const fullName =
    src.full_name ||
    [src.first_name, src.last_name].filter(Boolean).join(" ") ||
    src.name ||
    "";

  const email = src.email || src.email_1 || src.email_primary || "";
  const phone =
    src.phone_mobile || src.phone || src.mobile || src.whatsapp || "";
  const passport =
    src.passport || src.id_number || src.national_id || src.identity_no || "";

  const street =
    src.street_1 || src.address_1 || src.street || src.address || "";
  const city = src.city || src.town || "";
  const zip = src.zip_code || src.postal_code || src.zip || "";

  return { full_name: fullName, email, phone, passport, street, city, zip };
}

// Helper: normalize to international digits (ZA default)
function normalizeMsisdn(raw, defaultCountry = "27") {
  let s = String(raw || "").trim();
  if (!s) return "";

  // Keep only digits
  s = s.replace(/\D+/g, "");

  // If local ZA starting with 0 and 10 digits, promote to 27xxxxxxxxx
  if (/^0\d{9}$/.test(s) && defaultCountry === "27") {
    s = "27" + s.slice(1);
  }

  // If already has a country code (e.g. 27..., 44..., 1...), leave as-is
  return s;
}

/**
 * Get the MSISDN (WhatsApp) for OTP delivery.
 * Looks in customer, lead, and their contacts.
 * Returns a digits-only international number (e.g. "27731234567") or "".
 */
export async function fetchCustomerMsisdn(env, id) {
  const cid = String(id).trim();

  // Prefer Customer; fall back to Lead
  let entity = null;
  try {
    entity = await splynxGET(env, `/admin/customers/customer/${cid}`);
  } catch {
    try { entity = await splynxGET(env, `/admin/crm/leads/${cid}`); } catch { entity = null; }
  }
  if (!entity) entity = {};

  // 1) Try common fields on main entity
  const candidates = [
    entity.whatsapp,
    entity.phone_mobile,
    entity.mobile,
    entity.phone,
    entity.contact_phone,
    entity.msisdn,
  ];

  // 2) Try nested contact arrays if present on the object
  if (Array.isArray(entity.contacts)) {
    for (const c of entity.contacts) {
      candidates.push(c?.whatsapp, c?.phone, c?.mobile, c?.contact_phone);
    }
  }

  // 3) If still nothing, try contacts endpoints explicitly
  try {
    const custContacts = await splynxGET(env, `/admin/customers/${cid}/contacts`);
    if (Array.isArray(custContacts)) {
      for (const c of custContacts) {
        candidates.push(c?.whatsapp, c?.phone, c?.mobile, c?.contact_phone);
      }
    }
  } catch {}
  try {
    const leadContacts = await splynxGET(env, `/admin/crm/leads/${cid}/contacts`);
    if (Array.isArray(leadContacts)) {
      for (const c of leadContacts) {
        candidates.push(c?.whatsapp, c?.phone, c?.mobile, c?.contact_phone);
      }
    }
  } catch {}

  // Pick the first that normalizes to something usable
  for (const raw of candidates) {
    const msisdn = normalizeMsisdn(raw, "27");
    if (msisdn) return msisdn;
  }
  return "";
}

// (optionally) export normalize if you want to reuse it elsewhere
export { normalizeMsisdn };

/**
 * Best-effort push of onboarding session to Splynx.
 * - Writes obvious fields to customer and lead resources via PUT.
 * - Adds doc links (uploads + MSA/DO PDFs) into a "comments" / note field.
 * - Tries contact endpoints too; errors are swallowed but included in summary.
 */
export async function pushOnboardToSplynx(env, sess, linkid) {
  if (!sess) throw new Error("Missing session");
  const id = String(sess.id || String(linkid || "").split("_")[0] || "").trim();
  if (!id) throw new Error("Cannot infer Splynx ID");

  const r2Base = (env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org").replace(/\/+$/,"");
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const uploadUrls = uploads.map(u => `${r2Base}/${u.key}`);

  const origin = env.PUBLIC_ORIGIN || "https://onboard.vinet.co.za";
  const msaPdf = `${origin}/pdf/msa/${linkid}`;
  const debitPdf = sess.pay_method === "debit" ? `${origin}/pdf/debit/${linkid}` : null;

  const stamp = new Date().toISOString().replace("T"," ").replace("Z","");
  const lines = [
    `Vinet Onboarding pushed: ${stamp}`,
    `Link: ${origin}/onboard/${linkid}`,
    `MSA PDF: ${msaPdf}`,
    debitPdf ? `Debit Order PDF: ${debitPdf}` : null,
    uploadUrls.length ? "Uploads:" : null,
    ...uploadUrls.map(u => ` - ${u}`),
  ].filter(Boolean);
  const commentsBlob = lines.join("\n");

  const e = sess.edits || {};
  const common = {
    full_name: e.full_name || undefined,
    email: e.email || undefined,
    phone_mobile: e.phone || undefined,
    street_1: e.street || undefined,
    city: e.city || undefined,
    zip_code: e.zip || undefined,
    payment_method: sess.pay_method || undefined,
    debit: sess.debit || undefined, // harmless if ignored
    comments: commentsBlob,
    comment: commentsBlob,
    additional_information: commentsBlob,
  };

  const contactBasic = {
    first_name: (e.full_name || "").split(" ").slice(0, -1).join(" ") || e.full_name || undefined,
    last_name: (e.full_name || "").split(" ").slice(-1).join(" ") || undefined,
    email: e.email || undefined,
    phone: e.phone || undefined,
  };

  const attempts = [
    splynxPUT(env, `/admin/customers/customer/${id}`, common).catch(err => ({ __err: err.message })),
    splynxPUT(env, `/admin/customers/${id}`, common).catch(err => ({ __err: err.message })),
    splynxPUT(env, `/admin/crm/leads/${id}`, common).catch(err => ({ __err: err.message })),
    splynxPUT(env, `/admin/customers/${id}/contacts`, contactBasic).catch(err => ({ __err: err.message })),
    splynxPUT(env, `/admin/crm/leads/${id}/contacts`, contactBasic).catch(err => ({ __err: err.message })),
  ];

  const results = await Promise.all(attempts);

  return {
    id,
    results,
    posted: {
      uploads: uploadUrls,
      msaPdf,
      debitPdf: debitPdf || undefined,
      fields: common,
    },
  };
}
