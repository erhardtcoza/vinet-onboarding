// /src/leads-storage.js

/* ---------- tiny utils ---------- */
function nowSec() { return Math.floor(Date.now() / 1000); }
function todayISO() { try { return new Date().toISOString().split("T")[0]; } catch { return null; } }
function toNullSafe(v) { return v === undefined ? null : (v ?? null); }
function trimAll(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = (typeof v === "string") ? v.trim() : (v ?? null);
  return out;
}

/* ---------- make sure table exists (safe if it already does) ---------- */
export async function ensureLeadsTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      splynx_id TEXT, full_name TEXT, email TEXT, phone TEXT,
      street TEXT, city TEXT, zip TEXT, passport TEXT,
      created_at INTEGER,
      lead_id INTEGER, name TEXT, whatsapp TEXT, message TEXT,
      partner TEXT, location TEXT, billing_type TEXT
    )
  `).run();
}

/* discover existing columns to avoid “no column named …” */
async function getLeadColumns(env) {
  const info = await env.DB.prepare(`PRAGMA table_info(leads)`).all().catch(() => ({ results: [] }));
  const cols = new Set();
  for (const r of (info?.results ?? [])) {
    const n = String(r.name || "").toLowerCase();
    if (n) cols.add(n);
  }
  return cols;
}

/* ---------- INSERT that auto-adapts to your schema ---------- */
export async function insertLead(env, raw) {
  await ensureLeadsTable(env);

  // Normalised payload. We fill BOTH name + full_name because your table has both.
  const data = trimAll({
    // ids and timing
    splynx_id: raw?.splynx_id ?? null,
    lead_id:   raw?.lead_id   ?? null,
    created_at: nowSec(),

    // person + contact
    full_name: raw?.full_name ?? raw?.name ?? null,
    name:      raw?.name      ?? raw?.full_name ?? null,
    email:     raw?.email ?? null,
    phone:     raw?.phone ?? null,
    whatsapp:  raw?.whatsapp ?? null,
    passport:  raw?.passport ?? null,

    // address
    street: raw?.street ?? null,
    city:   raw?.city ?? null,
    zip:    raw?.zip ?? null,

    // extras that exist in your schema
    message:     raw?.message ?? null,
    partner:     (raw?.partner ?? "Main"),
    location:    (raw?.location ?? "Main"),
    billing_type:(raw?.billing_type ?? "recurring")
  });

  const cols = await getLeadColumns(env);
  if (!cols.size) throw new Error("leads table unreadable");

  const names = [];
  const values = [];
  for (const [k, v] of Object.entries(data)) {
    if (cols.has(k.toLowerCase())) { names.push(k); values.push(toNullSafe(v)); }
  }
  if (!names.length) throw new Error("No matching columns for payload");

  const placeholders = names.map(() => "?").join(", ");

  // Prefer RETURNING id (works on D1); fallback to MAX(id)
  try {
    const sql = `INSERT INTO leads (${names.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const row = await env.DB.prepare(sql).bind(...values).first();
    return { id: row?.id ?? null };
  } catch {
    await env.DB.prepare(`INSERT INTO leads (${names.join(", ")}) VALUES (${placeholders})`).bind(...values).run();
    const row = await env.DB.prepare(`SELECT MAX(id) AS id FROM leads`).first().catch(() => null);
    return { id: row?.id ?? null };
  }
}

/* ---------- reads & updates ---------- */
export async function getAllLeads(env) {
  await ensureLeadsTable(env);
  const res = await env.DB.prepare(`SELECT * FROM leads ORDER BY created_at DESC, id DESC`).all();
  return res.results || [];
}

export async function getLead(env, id) {
  return await env.DB.prepare(`SELECT * FROM leads WHERE id=?1`).bind(id).first();
}

export async function updateLead(env, id, data) {
  const cols = await getLeadColumns(env);
  const pairs = []; const vals = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (cols.has(k.toLowerCase())) { pairs.push(`${k}=?`); vals.push(toNullSafe(v)); }
  }
  if (!pairs.length) return;
  await env.DB.prepare(`UPDATE leads SET ${pairs.join(", ")} WHERE id=?`).bind(...vals, id).run();
}
