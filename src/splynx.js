// src/splynx.js

// ---------- Auth helpers ----------
function buildAuthHeaders(env) {
  const h = { "Content-Type": "application/json" };
  if (env.SPLYNX_TOKEN) {
    // Token / API key auth
    // Common patterns:
    //  - Authorization: Bearer <token>
    //  - X-API-Key: <token>
    // If you know which your Splynx needs, use that one. We'll send both safely.
    h["Authorization"] = `Bearer ${env.SPLYNX_TOKEN}`;
    h["X-API-Key"] = env.SPLYNX_TOKEN;
  } else if (env.SPLYNX_LOGIN && env.SPLYNX_PASSWORD) {
    // Basic auth as fallback
    const b64 = btoa(`${env.SPLYNX_LOGIN}:${env.SPLYNX_PASSWORD}`);
    h["Authorization"] = `Basic ${b64}`;
  }
  return h;
}

function baseUrl(env) {
  // e.g. https://splynx.example.com/api
  // Accept SPLYNX_BASE with or without trailing slash
  let b = String(env.SPLYNX_BASE || "").trim();
  if (!b) throw new Error("Missing SPLYNX_BASE");
  if (b.endsWith("/")) b = b.slice(0, -1);
  return b;
}

// ---------- Low-level REST wrappers ----------
export async function splynxGET(env, path) {
  const url = `${baseUrl(env)}${path.startsWith("/") ? "" : "/"}${path}`;
  const r = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(env),
    // cache a little to reduce load; disable if you need freshest
    cf: { cacheTtl: 30, cacheEverything: false },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Splynx GET ${path} -> ${r.status} ${txt}`);
  }
  // Some Splynx endpoints wrap payloads; many return plain JSON
  const data = await r.json().catch(() => null);
  return data;
}

export async function splynxPUT(env, path, body) {
  const url = `${baseUrl(env)}${path.startsWith("/") ? "" : "/"}${path}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: buildAuthHeaders(env),
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${path} -> ${r.status} ${txt}`);
  }
  // Some PUTs return the saved object, some return {}
  try { return await r.json(); } catch { return {}; }
}

// ---------- Phone normalization ----------
function normalizeMsisdn(raw, defaultCountry = "27") {
  let s = String(raw || "").trim();
  if (!s) return "";

  // remove any non-digits
  s = s.replace(/\D+/g, "");

  // If ZA local (0XXXXXXXXX), convert to 27XXXXXXXXX
  if (defaultCountry === "27" && /^0\d{9}$/.test(s)) {
    s = "27" + s.slice(1);
  }
  // Leave other international formats as-is (e.g., 44..., 1..., 353...)
  return s;
}
export { normalizeMsisdn };

// ---------- High-level helpers ----------

/**
 * Try to fetch a friendly profile for display/edit.
 * Looks up Customer first, then Lead.
 * Maps to the fields your UI expects.
 */
export async function fetchProfileForDisplay(env, id) {
  const cid = String(id).trim();
  let obj = null;
  try {
    obj = await splynxGET(env, `/admin/customers/customer/${cid}`);
  } catch {
    try { obj = await splynxGET(env, `/admin/crm/leads/${cid}`); } catch { obj = null; }
  }
  if (!obj) return {};

  // Splynx installations vary; map common fields into your expected shape.
  const profile = {
    full_name:
      obj.full_name ||
      [obj.first_name, obj.last_name].filter(Boolean).join(" ") ||
      obj.name ||
      "",
    email: obj.email || obj.email_address || "",
    phone:
      normalizeMsisdn(obj.whatsapp || obj.phone_mobile || obj.mobile || obj.phone || ""),
    passport: obj.passport || obj.id_number || obj.identity || "",
    street: obj.street_1 || obj.street || obj.address || "",
    city: obj.city || "",
    zip: obj.zip_code || obj.post_code || obj.zip || "",
  };

  // If object contains nested contact-like entries, prefer a mobile/whatsapp from there
  if (Array.isArray(obj.contacts)) {
    for (const c of obj.contacts) {
      const cand =
        c?.whatsapp || c?.phone_mobile || c?.mobile || c?.phone || c?.contact_phone;
      const n = normalizeMsisdn(cand);
      if (n) { profile.phone = n; break; }
    }
  }

  return profile;
}

/**
 * Aggressive MSISDN fetch: customer -> lead -> contacts endpoints.
 * Returns E.164-like digits string (no +), e.g. 27731234567, or "".
 */
export async function fetchCustomerMsisdn(env, id) {
  const cid = String(id).trim();
  let primary = null;

  // Try Customer then Lead
  try { primary = await splynxGET(env, `/admin/customers/customer/${cid}`); } catch {}
  if (!primary) { try { primary = await splynxGET(env, `/admin/crm/leads/${cid}`); } catch {} }
  const candidates = [];
  if (primary) {
    candidates.push(
      primary.whatsapp,
      primary.phone_mobile,
      primary.mobile,
      primary.phone,
      primary.contact_phone,
      primary.msisdn
    );
    if (Array.isArray(primary.contacts)) {
      for (const c of primary.contacts) {
        candidates.push(c?.whatsapp, c?.phone, c?.mobile, c?.contact_phone);
      }
    }
  }

  // Hit contacts endpoints explicitly
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

  for (const raw of candidates) {
    const n = normalizeMsisdn(raw, "27");
    if (n) return n;
  }
  return "";
}
