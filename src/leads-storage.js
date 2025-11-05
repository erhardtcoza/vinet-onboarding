// /src/leads-storage.js
import { ensureLeadsTables } from "./utils/db.js";

/* ---------- helpers ---------- */
const nowSec = () => Math.floor(Date.now() / 1000);
const todayStr = () => new Date().toISOString().split("T")[0];

// Normalize to South African 27… format
export function normalizeMsisdn(raw) {
  const s = String(raw || "").replace(/[^\d]/g, "");
  if (!s) return "";
  if (s.startsWith("27")) return s;
  if (s.startsWith("0")) return "27" + s.slice(1);
  return s; // if caller already sent 27xxx
}

/* ---------- PUBLIC API ---------- */

// no-op wrapper so other modules can import the same name
export { ensureLeadsTables };

/**
 * Insert a lead into `leads` and stage it in `leads_queue`.
 * Returns { leadId, queueId }.
 */
export async function savePublicLead(env, data) {
  await ensureLeadsTables(env);

  // defaults you asked for
  const partner = data.partner || "Main";
  const location = data.location || "Main";
  const score = Number(data.score || 1);
  const billing_type = data.billing_type || "Recurring payments";
  const phone = normalizeMsisdn(data.phone);
  const billing_email = data.billing_email || data.email || "";
  const date_added = data.date_added || todayStr();

  // Insert into leads (keeps older columns for compatibility)
  await env.DB.prepare(
    `INSERT INTO leads
      (name, email, phone, street, city, zip, message,
       partner, location, billing_type, source, service,
       billing_email, score, date_added, captured_by, created_at, synced)
     VALUES (?1,  ?2,   ?3,   ?4,    ?5,  ?6, ?7,
             ?8,     ?9,       ?10,        ?11,   ?12,
             ?13,          ?14,   ?15,       ?16,        ?17,        0)`
  ).bind(
    data.name || data.full_name || "",
    data.email || "",
    phone,
    data.street || "",
    data.city || "",
    data.zip || "",
    data.message || "",
    partner,
    location,
    billing_type,
    data.source || "website",
    data.service || data.service_interested || "unknown",
    billing_email,
    score,
    date_added,
    data.captured_by || "public",
    nowSec()
  ).run();

  const leadRow = await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first();
  const leadId = leadRow?.id ?? null;

  // Stage in queue for the CRM admin
  const payload = {
    id: leadId,
    name: data.name || data.full_name || "",
    email: data.email || "",
    phone,
    street: data.street || "",
    city: data.city || "",
    zip: data.zip || "",
    source: data.source || "website",
    service_interested: data.service || data.service_interested || "unknown",
    message: data.message || ""
  };

  await env.DB.prepare(
    `INSERT INTO leads_queue (sales_user, created_at, payload, processed, synced)
     VALUES (?1, ?2, ?3, 0, '0')`
  ).bind(
    data.captured_by || "public",
    nowSec(),
    JSON.stringify(payload)
  ).run();

  const qRow = await env.DB.prepare(`SELECT last_insert_rowid() AS id`).first();
  const queueId = qRow?.id ?? null;

  return { leadId, queueId };
}

/* ---------- extra helpers kept for compatibility (optional) ---------- */

export async function getAllLeads(env) {
  await ensureLeadsTables(env);
  const res = await env.DB.prepare(`SELECT * FROM leads ORDER BY date_added DESC, id DESC`).all();
  return res.results || [];
}

export async function updateLead(env, id, data) {
  const keys = Object.keys(data || {});
  if (!keys.length) return;
  const vals = keys.map(k => data[k]);
  const sets = keys.map(k => `${k}=?`).join(", ");
  await env.DB.prepare(`UPDATE leads SET ${sets} WHERE id=?`).bind(...vals, id).run();
}
