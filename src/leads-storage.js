// /src/leads-storage.js
export async function ensureLeadsTables(env) {
  // Minimal superset of your pasted schema
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      splynx_id TEXT,
      full_name TEXT,
      email TEXT,
      phone TEXT,
      street TEXT,
      city TEXT,
      zip TEXT,
      passport TEXT,
      created_at INTEGER,
      message TEXT,
      partner TEXT,
      location TEXT,
      billing_type TEXT,
      service TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT,
      created_at INTEGER,
      payload TEXT,
      uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER,
      synced TEXT
    )`)
  ]);
}

function nowSec(){ return Math.floor(Date.now()/1000); }

// Normalize South African MSISDN → "27XXXXXXXXX"
export function normalizeMsisdn(s){
  let v = String(s||"").replace(/\D/g,"");
  if (!v) return "";
  if (v.startsWith("27")) return v;
  if (v.startsWith("0")) return "27"+v.slice(1);
  if (v.startsWith("0027")) return v.slice(2);
  return v; // leave as-is if already numeric
}

export async function savePublicLead(env, p){
  await ensureLeadsTables(env);

  const full_name   = (p.name||p.full_name||"").trim();
  const email       = (p.email||"").trim();
  const phone       = normalizeMsisdn(p.phone||p.whatsapp||"");
  const street      = (p.street||p.street_1||"").trim();
  const city        = (p.city||"").trim();
  const zip         = (p.zip||p.zip_code||"").trim();
  const message     = (p.message||p.notes||"").trim();
  const service     = (p.service||p.service_interested||"unknown").trim();

  // Hidden/defaults you requested
  const partner     = "Main";
  const location    = "Main";
  const billingType = "Recurring payments";

  // 1) Insert a simple row for reporting
  await env.DB.prepare(
    `INSERT INTO leads (full_name,email,phone,street,city,zip,message,partner,location,billing_type,service,created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
  ).bind(full_name,email,phone,street,city,zip,message,partner,location,billingType,service,nowSec()).run();

  // 2) Queue JSON payload for the admin UI + Splynx submit flow
  const payload = {
    name: full_name, email, phone, street, city, zip,
    source: (p.source||"website").trim(),
    message, service_interested: service,
    partner, location, billing_type: billingType
  };
  await env.DB.prepare(
    `INSERT INTO leads_queue (sales_user, created_at, payload, processed, synced)
     VALUES ('public', ?1, ?2, 0, '0')`
  ).bind(nowSec(), JSON.stringify(payload)).run();

  const row = await env.DB.prepare("SELECT last_insert_rowid() AS id").first();
  return { queueId: row?.id ?? null };
}
