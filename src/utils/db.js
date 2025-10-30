export async function ensureSchema(DB) {
  await DB.batch([
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        email TEXT,
        source TEXT,
        city TEXT,
        street TEXT,
        zip TEXT,
        billing_email TEXT,
        score INTEGER,
        date_added TEXT,
        captured_by TEXT,
        synced INTEGER DEFAULT 0,
        lead_id INTEGER,
        splynx_id INTEGER
      )
    `),
    DB.prepare(`
      CREATE TABLE IF NOT EXISTS leads_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_user TEXT,
        created_at INTEGER,
        payload TEXT,
        uploaded_files TEXT,
        processed INTEGER DEFAULT 0,
        splynx_id INTEGER,
        synced TEXT
      )
    `)
  ]);

  const tryAlter = async (sql) => { try { await DB.prepare(sql).run(); } catch {} };
  await tryAlter(`ALTER TABLE leads ADD COLUMN lead_id INTEGER`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN synced TEXT`);
}

export const nowSec = () => Math.floor(Date.now()/1000);
export const DATE_TODAY = () => new Date().toISOString().slice(0,10);
export const json = (o,s=200)=> new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
export const safeStr = (v)=> (v==null ? "" : String(v)).trim();
