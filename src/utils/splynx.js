// src/utils/splynx.js
import { SPYLNX_URL, AUTH_HEADER } from "../constants.js";

/* ---------------- Core HTTP helpers ---------------- */
async function splynxGET(path) {
  const r = await fetch(`${SPYLNX_URL}${path}`, { headers: { Authorization: AUTH_HEADER } });
  if (!r.ok) throw new Error(`Splynx GET ${path} -> ${r.status}`);
  // Some Splynx endpoints return arrays, others {items:[...]}
  return r.json().catch(() => ({}));
}
async function splynxPOST(path, body) {
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`Splynx POST ${path} -> ${r.status} ${await r.text().catch(()=>"")}`);
  return r.json().catch(() => ({}));
}
async function splynxPUT(path, body) {
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`Splynx PUT ${path} -> ${r.status} ${await r.text().catch(()=>"")}`);
  return r.json().catch(() => ({}));
}

/* ---------------- Small utils ---------------- */
const arrFrom = (res) => (Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []));
const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
const getField = (o, names, d = null) => {
  for (const n of names) {
    if (o && o[n] !== undefined && o[n] !== "") return o[n];
  }
  return d;
};
const parseTs = (v) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
};

// Best-effort “last contacted”
export function extractLastContacted(lead) {
  // common fields we’ve seen on Splynx
  const lc = getField(lead, ["last_contacted", "last_contact", "last_contact_date"]);
  if (lc) return parseTs(lc);
  const la = getField(lead, ["last_activity", "updated"]);
  if (la) return parseTs(la);
  const da = getField(lead, ["date_add", "date_added"]);
  return parseTs(da);
}

export function toLeadRow(x = {}) {
  return {
    id: x.id,
    status: String(getField(x, ["status"], "") || ""),
    name: getField(x, ["name", "full_name"], "") || "",
    email: getField(x, ["email", "billing_email"], "") || "",
    phone: getField(x, ["phone", "phone_mobile", "msisdn"], "") || "",
    city: x.city || "",
    last_contacted: extractLastContacted(x)
  };
}

/* ---------------- Basic fetchers (existing) ---------------- */
export async function splynxFetchLeads({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  return splynxGET(`/api/2.0/admin/crm/leads?${qs.toString()}`);
}
export async function splynxFetchCustomers({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  return splynxGET(`/api/2.0/admin/customers/customer?${qs.toString()}`);
}

export function findCandidates(leadsRes = {}, custRes = {}) {
  const out = [];
  for (const x of arrFrom(leadsRes)) out.push({ id: x.id, type: "lead", name: x.name, email: x.email, phone: x.phone });
  for (const x of arrFrom(custRes)) out.push({ id: x.id, type: "customer", name: x.name, email: x.email, phone: x.phone });
  return out;
}

/* ---------------- Lead payload builders (existing) ---------------- */
export function buildLeadPayload(p) {
  return {
    name: p.name,
    email: p.email,
    phone: p.phone,
    city: p.city,
    street_1: p.street,
    zip_code: p.zip,
    source: p.source,
    billing_email: p.email,
    score: 1,
    status: "New enquiry",
    date_add: new Date().toISOString().slice(0, 10),
    owner: "public"
  };
}

export async function createLead(payload) {
  return splynxPOST(`/api/2.0/admin/crm/leads`, payload);
}
export async function updateLead(targetType, targetId, payload) {
  if (targetType === "lead") {
    return splynxPUT(`/api/2.0/admin/crm/leads/${targetId}`, payload);
  } else if (targetType === "customer") {
    // safer: create a new lead rather than mutating the customer record directly
    return createLead(payload);
  }
  throw new Error("Unknown targetType");
}

export async function findReuseLead() {
  const res = await splynxGET(`/api/2.0/admin/crm/leads?name=re-use`);
  const arr = arrFrom(res);
  return arr.find(x => (x.name || "").toLowerCase() === "re-use") || null;
}

/* ---------------- New: list + update + bulk sanitize ---------------- */

/**
 * List a page of leads with optional status filter.
 * Splynx’s API varies; we filter & sort client-side for consistency.
 */
export async function listLeads({ status = "", limit = 50, offset = 0 } = {}) {
  let raw;
  try {
    // Try passing status to Splynx if it supports it (harmless if ignored)
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    raw = await splynxGET(`/api/2.0/admin/crm/leads${qs.toString() ? `?${qs}` : ""}`);
  } catch {
    raw = [];
  }
  let rows = arrFrom(raw).map(toLeadRow);

  if (status) rows = rows.filter(x => (x.status || "").toLowerCase() === status.toLowerCase());
  rows.sort((a, b) => (b.last_contacted || 0) - (a.last_contacted || 0));

  if (offset) rows = rows.slice(offset);
  return rows.slice(0, Math.max(1, Math.min(limit, 500)));
}

/**
 * Update a single lead with a safe subset of fields.
 */
export async function updateLeadFields(id, fields = {}) {
  const allowed = [
    "name", "email", "billing_email",
    "phone", "phone_mobile",
    "street_1", "city", "zip_code",
    "status", "source"
  ];
  const payload = pick(fields, allowed);
  if (!Object.keys(payload).length) return { ok: true, skipped: true };
  await splynxPUT(`/api/2.0/admin/crm/leads/${id}`, payload);
  return { ok: true };
}

/**
 * Bulk sanitize leads: rename to "re-use" and wipe PII.
 */
export async function bulkSanitizeLeads(ids = []) {
  const payload = {
    name: "re-use",
    email: "", billing_email: "",
    phone: "", phone_mobile: "",
    street_1: "", city: "", zip_code: ""
  };
  let updated = 0, failed = 0;
  const results = [];
  for (const id of ids) {
    try {
      await splynxPUT(`/api/2.0/admin/crm/leads/${id}`, payload);
      updated++; results.push({ id, ok: true });
    } catch (e) {
      failed++; results.push({ id, ok: false, error: String(e?.message || e) });
    }
  }
  return { ok: true, updated, failed, results };
}
