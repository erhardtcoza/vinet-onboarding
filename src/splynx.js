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

/**
 * Get the MSISDN (WhatsApp) for OTP delivery.
 * Returns an E.164-like string if possible, else raw value.
 */
export async function fetchCustomerMsisdn(env, id) {
  const cid = String(id).trim();
  let src = null;
  try {
    src = await splynxGET(env, `/admin/customers/customer/${cid}`);
  } catch {
    try { src = await splynxGET(env, `/admin/crm/leads/${cid}`); } catch { src = null; }
  }
  if (!src) return "";

  // Candidate fields by common naming
  let msisdn =
    src.whatsapp ||
    src.phone_mobile ||
    src.mobile ||
    src.phone ||
    src.contact_phone ||
    "";

  msisdn = String(msisdn || "").trim();

  // Simple normalization: keep digits + leading +
  if (msisdn) {
    const cleaned = msisdn.replace(/[^\d+]/g, "");
    // If it starts with 0 and you want to force ZA "27", uncomment below:
    // if (/^0\d{9}$/.test(cleaned)) msisdn = "27" + cleaned.slice(1);
    msisdn = cleaned;
  }

  return msisdn;
}

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
