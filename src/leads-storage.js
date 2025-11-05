// /src/leads-storage.js

/* ---------- small utils ---------- */
function todayISO() {
  try {
    return new Date().toISOString().split("T")[0];
  } catch { return null; }
}
function toNullSafe(v) {
  if (v === undefined) return null;
  if (v === "") return "";
  return v ?? null;
}
function trimAll(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) { out[k] = null; continue; }
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/* ---------- schema helpers ---------- */
export async function ensureLeadsTable(env) {
  // A generous superset – harmless if table already exists with a subset
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      whatsapp TEXT,
      email TEXT,
      source TEXT,
      city TEXT,
      street TEXT,
      zip TEXT,
      service TEXT,
      message TEXT,
      partner TEXT,
      location TEXT,
      billing_type TEXT,
      billing_email TEXT,
      score INTEGER,
      date_added TEXT,
      captured_by TEXT,
      splynx_id INTEGER,
      synced INTEGER DEFAULT 0
    )
  `).run();
}

async function getLeadColumns(env) {
  // Returns a Set of existing column names (lowercased)
  const info = await env.DB.prepare(`PRAGMA table_info(leads)`).all().catch(() => ({ results: [] }));
  const cols = new Set();
  for (const r of (info?.results ?? [])) {
    const name = (r.name || r.cid || "").toString().toLowerCase();
    if (name) cols.add(name);
  }
  return cols;
}

/* ---------- main insert that adapts to actual DB columns ---------- */
export async function insertLead(env, raw) {
  await ensureLeadsTable(env);

  // Normalise & defaults
  const data = trimAll({
    name: raw?.name,
    phone: raw?.phone,
    whatsapp: raw?.whatsapp,                   // optional; will be dropped if no col
    email: raw?.email,
    source: raw?.source ?? "website",
    city: raw?.city,
    street: raw?.street,
    zip: raw?.zip,
    service: raw?.service ?? "unknown",
    message: raw?.message,                     // optional; will be dropped if no col
    partner: raw?.partner ?? "Main",           // optional; will be dropped if no col
    location: raw?.location ?? "Main",         // optional; will be dropped if no col
    billing_type: raw?.billing_type ?? "recurring", // optional; will be dropped if no col
    billing_email: raw?.billing_email ?? raw?.email ?? null,
    score: raw?.score != null ? Number(raw.score) : 1,
    date_added: todayISO(),
    captured_by: raw?.captured_by ?? "public",
    splynx_id: raw?.splynx_id ?? null,
    synced: raw?.synced != null ? Number(raw.synced) : 0,
  });

  // Intersect payload with real columns in whichever DB we're bound to
  const cols = await getLeadColumns(env);
  if (!cols.size) throw new Error("leads table appears empty or unreadable");

  const names = [];
  const values = [];

  for (const [k, v] of Object.entries(data)) {
    if (cols.has(k.toLowerCase())) {
      names.push(k);
      values.push(toNullSafe(v));
    }
  }

  if (!names.length) throw new Error("No matching columns in leads for payload");

  const placeholders = names.map(() => "?").join(", ");
  const sql = `INSERT INTO leads (${names.join(", ")}) VALUES (${placeholders})`;

  await env.DB.prepare(sql).bind(...values).run();
}

/* ---------- reads & misc ---------- */
export async function getAllLeads(env) {
  await ensureLeadsTable(env);
  const res = await env.DB.prepare(`SELECT * FROM leads ORDER BY date_added DESC, id DESC`).all();
  return res.results || [];
}

export async function getLead(env, id) {
  return await env.DB.prepare(`SELECT * FROM leads WHERE id=?1`).bind(id).first();
}

export async function updateLead(env, id, data) {
  // Only update columns that exist
  const cols = await getLeadColumns(env);
  const pairs = [];
  const vals = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (cols.has(k.toLowerCase())) {
      pairs.push(`${k}=?`);
      vals.push(toNullSafe(v));
    }
  }
  if (!pairs.length) return;
  await env.DB.prepare(`UPDATE leads SET ${pairs.join(", ")} WHERE id=?`).bind(...vals, id).run();
}

export async function deleteLeads(env, ids = []) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).bind(...ids).run();
}

export function nowSec() { return Math.floor(Date.now() / 1000); }

/* simple undo buffer (unchanged) */
export async function ensureUndoTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS undo_buffer (
      token TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();
}

export async function stageUndo(env, rows, ttl = 10) {
  await ensureUndoTable(env);
  const token = Math.random().toString(36).slice(2);
  const expires = nowSec() + ttl;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO undo_buffer (token, rows_json, expires_at) VALUES (?, ?, ?)`
  ).bind(token, JSON.stringify(rows), expires).run();
  return { token, ttl };
}

export async function undoByToken(env, token) {
  await ensureUndoTable(env);
  const rec = await env.DB.prepare(`SELECT * FROM undo_buffer WHERE token=?`).bind(token).first();
  if (!rec) return false;
  if (rec.expires_at < nowSec()) {
    await env.DB.prepare(`DELETE FROM undo_buffer WHERE token=?`).bind(token).run();
    return false;
  }
  const rows = JSON.parse(rec.rows_json || "[]");
  for (const r of rows) {
    const cols = Object.keys(r);
    const placeholders = cols.map(() => "?").join(",");
    const updateCols = cols.map(c => `${c}=excluded.${c}`).join(",");
    await env.DB.prepare(`
      INSERT INTO leads (${cols.join(",")}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updateCols}
    `).bind(...cols.map(c => r[c])).run();
  }
  await env.DB.prepare(`DELETE FROM undo_buffer WHERE token=?`).bind(token).run();
  return true;
}
