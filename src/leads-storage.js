// /src/leads-storage.js
// One job: insert a public lead into D1 without ever binding `undefined`.

const toNull = (v) => (v === undefined ? null : v);
const trimOrNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

async function ensureLeadsTable(env) {
  // Safe to run every call (idempotent)
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      source TEXT,
      city TEXT,
      street TEXT,
      zip TEXT,
      service TEXT,
      message TEXT,
      captured_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      synced INTEGER DEFAULT 0
    );
  `);
}

export async function insertLead(env, data) {
  await ensureLeadsTable(env);

  // Normalize every field so nothing is ever `undefined`.
  const lead = {
    name:        trimOrNull(data?.name),
    phone:       trimOrNull(data?.phone),
    email:       trimOrNull(data?.email),
    source:      trimOrNull(data?.source ?? "website"),
    city:        trimOrNull(data?.city),
    street:      trimOrNull(data?.street),
    zip:         trimOrNull(data?.zip),
    service:     trimOrNull(data?.service ?? "unknown"),
    message:     trimOrNull(data?.message ?? ""),
    captured_by: trimOrNull(data?.captured_by ?? "public"),
    synced:      toNull(data?.synced ?? 0),
  };

  // Extra safety: minimal requireds
  if (!lead.name || !lead.phone || !lead.email) {
    throw new Error("Missing required fields (name, phone, email).");
  }

  const stmt = env.DB.prepare(`
    INSERT INTO leads (name, phone, email, source, city, street, zip, service, message, captured_by, synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    lead.name,
    lead.phone,
    lead.email,
    lead.source,
    lead.city,
    lead.street,
    lead.zip,
    lead.service,
    lead.message,
    lead.captured_by,
    lead.synced
  );

  await stmt.run();
}
