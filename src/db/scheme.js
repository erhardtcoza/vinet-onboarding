export async function ensureLeadSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, phone TEXT, email TEXT, source TEXT,
      city TEXT, street TEXT, zip TEXT, billing_email TEXT,
      score INTEGER, date_added TEXT, captured_by TEXT,
      synced INTEGER DEFAULT 0,
      lead_id INTEGER, splynx_id INTEGER
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT, created_at INTEGER,
      payload TEXT, uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER, synced TEXT
    )`)
  ]);

  const tryAlter = async (sql) => { try { await env.DB.prepare(sql).run(); } catch {} };
  await tryAlter(`ALTER TABLE leads ADD COLUMN name TEXT`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN lead_id INTEGER`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN synced TEXT`);
}
