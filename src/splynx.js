// /src/splynx.js
//
// Minimal Splynx client + a consolidated "push onboarding to Splynx" helper.
//
// Expects these env vars to be set in your Worker:
// - SPLYNX_BASE (e.g. "https://splynx.example.com")
// - SPLYNX_TOKEN  (Bearer token)  OR  SPLYNX_BASIC (e.g. "Basic xxx")
// If both are set, TOKEN is used.
//
// Endpoints we will PUT to (best-effort; failures are swallowed but logged):
//   /admin/customers/customer/{id}
//   /admin/customers/{id}
//   /admin/crm/leads/{id}
//   /admin/customers/{id}/contacts
//   /admin/crm/leads/{id}/contacts
//
// NOTE: Because Splynx instances can differ (custom fields), we:
//  1) Map the obvious standard fields (name, email, phone, address).
//  2) Add a durable "comments" note with all file/PDF URLs, so info is never lost.
//  3) Try to update both customer and lead “sides”, safely ignoring 404/405.
//

const pickAuthHeader = (env) => {
  if (env.SPLYNX_TOKEN) return { Authorization: `Bearer ${env.SPLYNX_TOKEN}` };
  if (env.SPLYNX_BASIC) return { Authorization: env.SPLYNX_BASIC }; // "Basic {base64}"
  // Fall back to none; requests will fail clearly.
  return {};
};

export async function splynxPUT(env, path, body) {
  const base = (env.SPLYNX_BASE || "").replace(/\/+$/, "");
  if (!base) throw new Error("SPLYNX_BASE not configured");
  const url = `${base}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...pickAuthHeader(env),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PUT ${path} -> ${res.status} ${t.slice(0,300)}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Best-effort push of onboarding session to Splynx.
 * - Writes obvious fields to customer and lead resources via PUT.
 * - Adds doc links (uploads + MSA/DO PDFs) into a "comments" / notes blob so staff can see everything.
 * - Tries to update basic contact info via /contacts endpoints too (if permitted by instance).
 */
export async function pushOnboardToSplynx(env, sess, linkid) {
  if (!sess) throw new Error("Missing session");
  const id = String(sess.id || String(linkid || "").split("_")[0] || "").trim();
  if (!id) throw new Error("Cannot infer Splynx ID");

  const r2Base = (env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org").replace(/\/+$/,"");
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const uploadUrls = uploads.map(u => `${r2Base}/${u.key}`);

  // Agreement PDFs (MSA always; Debit if they used that method)
  const origin = env.PUBLIC_ORIGIN || "https://onboard.vinet.co.za";
  const msaPdf = `${origin}/pdf/msa/${linkid}`;
  const debitPdf = sess.pay_method === "debit" ? `${origin}/pdf/debit/${linkid}` : null;

  // Compose a readable note staff can find easily in Splynx UI.
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

  // Field mapping (common)
  const edits = sess.edits || {};
  const common = {
    // Adjust to your exact Splynx schema if needed:
    full_name: edits.full_name || undefined,
    email: edits.email || undefined,
    phone_mobile: edits.phone || undefined,
    // Address (common Splynx keys)
    street_1: edits.street || undefined,
    city: edits.city || undefined,
    zip_code: edits.zip || undefined,
    // Payment
    payment_method: sess.pay_method || undefined,
    // OPTIONAL: add what the customer entered for debit to help staff (will be ignored if Splynx doesn’t allow it)
    debit: sess.debit || undefined,
    // Append a comments/note string so staff can find file links regardless of strict schema
    comments: commentsBlob,
  };

  // Some Splynx instances prefer "comment" or "additional_information".
  // We'll provide several fallbacks in the payload to maximize the chance something is shown.
  const withNoteVariants = {
    ...common,
    comment: commentsBlob,
    additional_information: commentsBlob,
  };

  // Contacts payload (best-effort)
  const contactBasic = {
    first_name: (edits.full_name || "").split(" ").slice(0,-1).join(" ") || edits.full_name || undefined,
    last_name: (edits.full_name || "").split(" ").slice(-1).join(" ") || undefined,
    email: edits.email || undefined,
    phone: edits.phone || undefined,
  };

  // Push to all five endpoints, best-effort
  const tasks = [
    // Customers
    splynxPUT(env, `/admin/customers/customer/${id}`, withNoteVariants).catch(e => ({__err: e.message})),
    splynxPUT(env, `/admin/customers/${id}`, withNoteVariants).catch(e => ({__err: e.message})),
    // Leads
    splynxPUT(env, `/admin/crm/leads/${id}`, withNoteVariants).catch(e => ({__err: e.message})),
    // Contacts (not all Splynx setups accept PUT here; swallow errors)
    splynxPUT(env, `/admin/customers/${id}/contacts`, contactBasic).catch(e => ({__err: e.message})),
    splynxPUT(env, `/admin/crm/leads/${id}/contacts`, contactBasic).catch(e => ({__err: e.message})),
  ];

  const results = await Promise.all(tasks);

  // Return a compact summary for logging/diagnostics.
  const summary = {
    id,
    attempted: [
      "/admin/customers/customer/{id}",
      "/admin/customers/{id}",
      "/admin/crm/leads/{id}",
      "/admin/customers/{id}/contacts",
      "/admin/crm/leads/{id}/contacts",
    ],
    results,
  };

  return summary;
}
