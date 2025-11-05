// /src/utils/db.js
// Single place to ensure all tables used by the CRM lead flow exist.

export async function ensureLeadsTables(env) {
  // leads (canonical)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      splynx_id TEXT,
      full_name TEXT,  -- optional (kept for compatibility)
      email TEXT,
      phone TEXT,
      street TEXT,
      city TEXT,
      zip TEXT,
      passport TEXT,
      created_at INTEGER,
      -- extra public/CRM fields (kept for compatibility)
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

  // queue used by admin dashboard
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT,
      created_at INTEGER,
      payload TEXT,            -- JSON
      uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER,
      synced TEXT
    )
  `).run();

  // tiny undo buffer (optional)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS undo_buffer (
      token TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();
}
