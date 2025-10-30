// src/utils/splynx.js
import { SPYLNX_URL, AUTH_HEADER } from "../constants.js";

async function splynxGET(path) {
  const r = await fetch(`${SPYLNX_URL}${path}`, { headers: { Authorization: AUTH_HEADER } });
  if (!r.ok) throw new Error(`Splynx GET ${path} -> ${r.status}`);
  return r.json().catch(() => ({}));
}
async function splynxPOST(path, body) {
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`Splynx POST ${path} -> ${r.status} ${await r.text().catch(()=> "")}`);
  return r.json().catch(() => ({}));
}
async function splynxPUT(path, body) {
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`Splynx PUT ${path} -> ${r.status} ${await r.text().catch(()=> "")}`);
  return r.json().catch(() => ({}));
}

// Basic fetchers
export async function splynxFetchLeads({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  // Narrow search via CRM leads
  return splynxGET(`/api/2.0/admin/crm/leads?${qs.toString()}`);
}
export async function splynxFetchCustomers({ email, phone, name }) {
  const qs = new URLSearchParams();
  if (email) qs.set("email", email);
  if (phone) qs.set("phone", phone);
  if (name)  qs.set("name", name);
  return splynxGET(`/api/2.0/admin/customers/customer?${qs.toString()}`);
}

// Candidate builder
export function findCandidates(leadsRes = {}, custRes = {}) {
  const out = [];
  const ls = Array.isArray(leadsRes.items) ? leadsRes.items : (leadsRes || []);
  const cs = Array.isArray(custRes.items) ? custRes.items : (custRes || []);
  for (const x of ls) out.push({ id: x.id, type: "lead", name: x.name, email: x.email, phone: x.phone });
  for (const x of cs) out.push({ id: x.id, type: "customer", name: x.name, email: x.email, phone: x.phone });
  return out;
}

// Build a lead payload for Splynx
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

// Create / Update
export async function createLead(payload) {
  return splynxPOST(`/api/2.0/admin/crm/leads`, payload);
}
export async function updateLead(targetType, targetId, payload) {
  if (targetType === "lead") {
    return splynxPUT(`/api/2.0/admin/crm/leads/${targetId}`, payload);
  } else if (targetType === "customer") {
    // For customers, decide whether you want to update customer or convert to lead
    // Here we append a new lead linked by email/phone (safer)
    return createLead(payload);
  }
  throw new Error("Unknown targetType");
}

// "re-use" lead finder
export async function findReuseLead() {
  const res = await splynxGET(`/api/2.0/admin/crm/leads?name=re-use`);
  const arr = Array.isArray(res.items) ? res.items : (res || []);
  return arr.find(x => (x.name || "").toLowerCase() === "re-use") || null;
}
