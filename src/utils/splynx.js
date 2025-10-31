// src/utils/splynx.js
import { SPLYNX_URL, AUTH_HEADER } from "../constants.js";

/* ---------------- Path + HTTP helpers (compatible signatures) ---------------- */
function normalizePath(p) {
  const s = String(p || "");
  if (s.startsWith("/api/")) return s;                 // already absolute API path
  if (s.startsWith("/admin/") || s.startsWith("/crm/")) return `/api/2.0${s}`;
  // allow callers to pass either style:
  return s.startsWith("/") ? `/api/2.0${s}` : `/api/2.0/${s}`;
}
function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
const arrFrom = (res) =>
  Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);

async function _do(method, path, body) {
  const url = `${SPLYNX_URL}${normalizePath(path)}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH_HEADER,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx ${method} ${path} -> ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// Accept (path) or (env, path)
function unpackArgs(a1, a2) {
  return typeof a2 === "string" ? a2 : a1;
}

export async function splynxGET(a1, a2)  { return _do("GET",  unpackArgs(a1, a2)); }
export async function splynxPOST(a1, a2, a3) { return _do("POST", unpackArgs(a1, a2), a3 ?? (typeof a2 === "object" ? a2 : undefined)); }
export async function splynxPUT(a1, a2, a3)  { return _do("PUT",  unpackArgs(a1, a2), a3 ?? (typeof a2 === "object" ? a2 : undefined)); }

/* ---------------- Small utils ---------------- */
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
    last_contacted: extractLastContacted(x),
  };
}

/* ---------------- Basic fetchers (backwards compatible) ---------------- */
export async function splynxFetchLeads({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  return splynxGET(`/admin/crm/leads?${qs.toString()}`);
}
export async function splynxFetchCustomers({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  return splynxGET(`/admin/customers/customer?${qs.toString()}`);
}

export function findCandidates(leadsRes = {}, custRes = {}) {
  const out = [];
  for (const x of arrFrom(leadsRes)) out.push({ id: x.id, type: "lead", name: x.name, email: x.email, phone: x.phone });
  for (const x of arrFrom(custRes)) out.push({ id: x.id, type: "customer", name: x.name, email: x.email, phone: x.phone });
  return out;
}

/* ---------------- Lead payload builders ---------------- */
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
    owner: "public",
  };
}

export async function createLead(payload) {
  return splynxPOST(`/admin/crm/leads`, payload);
}
export async function updateLead(targetType, targetId, payload) {
  if (targetType === "lead") {
    return splynxPUT(`/admin/crm/leads/${targetId}`, payload);
  } else if (targetType === "customer") {
    // Safer: create a new lead rather than mutating customer directly
    return createLead(payload);
  }
  throw new Error("Unknown targetType");
}

export async function findReuseLead() {
  const res = await splynxGET(`/admin/crm/leads?name=re-use`);
  const arr = arrFrom(res);
  return arr.find((x) => (x.name || "").toLowerCase() === "re-use") || null;
}

/* ---------------- List + update + bulk sanitize (single set) ---------------- */

/**
 * List a page of leads with optional status filter.
 * We filter/sort client-side to handle Splynx variance.
 */
export async function listLeads({ status = "", limit = 50, offset = 0 } = {}) {
  let raw;
  try {
    raw = await splynxGET(`/admin/crm/leads`);
  } catch {
    raw = [];
  }
  let rows = arrFrom(raw).map(toLeadRow);

  if (status) {
    const s = status.toLowerCase();
    rows = rows.filter((x) => (x.status || "").toLowerCase() === s);
  }
  rows.sort((a, b) => (b.last_contacted || 0) - (a.last_contacted || 0));

  if (offset) rows = rows.slice(offset);
  return rows.slice(0, Math.max(1, Math.min(limit, 500)));
}

/** Safely update a single lead with a whitelisted set of fields. */
export async function updateLeadFields(id, fields = {}) {
  const allowed = [
    "name", "email", "billing_email",
    "phone", "phone_mobile",
    "street_1", "city", "zip_code",
    "status", "source", "owner",
  ];
  const payload = pick(fields, allowed);
  if (!Object.keys(payload).length) return { ok: true, skipped: true };
  await splynxPUT(`/admin/crm/leads/${id}`, payload);
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
    street_1: "", city: "", zip_code: "",
  };
  let updated = 0, failed = 0;
  const results = [];
  for (const id of ids) {
    try {
      await splynxPUT(`/admin/crm/leads/${id}`, payload);
      updated++; results.push({ id, ok: true });
    } catch (e) {
      failed++; results.push({ id, ok: false, error: String(e?.message || e) });
    }
  }
  return { ok: true, updated, failed, results };
}
