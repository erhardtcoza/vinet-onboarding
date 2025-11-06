// /src/utils/db.js
// DB helpers + schema for the CRM lead flow

/* ---------------- HTTP helpers used by routes ---------------- */
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
export function safeParseJSON(s, fallback = {}) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* ---------------- Schema ---------------- */
export async function ensureLeadsTables(env) {
  // canonical leads table (kept superset for compatibility)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
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
      -- public/CRM extras
      name TEXT,
      whatsapp TEXT,
      message TEXT,
      partner TEXT,
      location TEXT,
      billing_type TEXT,
      source TEXT,
      service TEXT,
      billing_email TEXT,
      score INTEGER,
      date_added TEXT,
      captured_by TEXT,
      synced INTEGER DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT,
      created_at INTEGER,
      payload TEXT,            -- JSON blob of the lead
      uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER,
      synced TEXT
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS undo_buffer (
      token TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();
}

// Back-compat alias (crm_leads.js and admin.js import this name)
export const ensureLeadSchema = ensureLeadsTables;
