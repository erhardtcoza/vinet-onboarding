// src/utils/splynx.js
import { todayISO } from "./db.js";

const SPYLNX_URL = "https://splynx.vinet.co.za";
const AUTH_HEADER =
  "Basic NTcxMDRhNGJjNjhhY2Y2MjRkMDliMmYwOTQ1ZTI1M2E6N2UyOTNmY2QyNzBjODJmOTdjNWQzODUwZjdhM2I1MTE=";

function headersJSON(){ return { Authorization: AUTH_HEADER, "content-type":"application/json" }; }

export async function splynxFetchLeads() {
  const r = await fetch(`${SPYLNX_URL}/api/2.0/admin/crm/leads`, { headers: { Authorization: AUTH_HEADER }});
  return r.ok ? r.json() : [];
}
export async function splynxFetchCustomers() {
  const r = await fetch(`${SPYLNX_URL}/api/2.0/admin/customers/customers`, { headers: { Authorization: AUTH_HEADER }});
  return r.ok ? r.json() : [];
}

export function findCandidates({ name, email, phone }, leads, customers) {
  const key = (x) => String(x||"").trim().toLowerCase();
  const n = key(name), e = key(email), p = key(phone);

  const leadHits = (Array.isArray(leads)?leads:[]).filter(l => {
    const ln = key(l.name), le = key(l.email), lp = key(l.phone);
    return (n && ln.includes(n)) || (e && le===e) || (p && lp===p);
  });

  const custHits = (Array.isArray(customers)?customers:[]).filter(c => {
    const cn = key(c.name), ce = key(c.email), cp = key(c.phone);
    return (n && cn.includes(n)) || (e && ce===e) || (p && cp===p);
  });

  return { leadHits, custHits };
}

export function buildLeadPayload(p, owner="public") {
  return {
    name: p.name, email: p.email, phone: p.phone,
    city: p.city, street_1: p.street, zip_code: p.zip,
    source: p.source, billing_email: p.email,
    score: 1, status: "New enquiry",
    date_add: todayISO(), owner
  };
}

export async function createLead(payload) {
  const r = await fetch(`${SPYLNX_URL}/api/2.0/admin/crm/leads`, {
    method:"POST", headers: headersJSON(), body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Splynx create ${r.status}: ${await r.text()}`);
  try { return await r.json(); } catch { return {}; }
}

export async function updateLead(id, payload) {
  const r = await fetch(`${SPYLNX_URL}/api/2.0/admin/crm/leads/${id}`, {
    method:"PUT", headers: headersJSON(), body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Splynx update ${r.status}: ${await r.text()}`);
  try { return await r.json(); } catch { return {}; }
}

export async function findReuseLead(leads) {
  return (Array.isArray(leads)?leads:[]).find(l => String(l.name||"").toLowerCase()==="re-use") || null;
}
