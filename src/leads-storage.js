// /src/leads-storage.js
import { cryptoRandomUUID } from "./helpers.js";

/* ---------- helpers ---------- */
const toNull = (v) => (v === undefined ? null : v);
const trimOrNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
export function nowSec() { return Math.floor(Date.now() / 1000); }

/* ---------- schema ---------- */
export async function ensureLeadsTable(env) {
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
      billing_email TEXT,
      score INTEGER,
      date_added TEXT,
      captured_by TEXT,
      splynx_id INTEGER,
      synced INTEGER DEFAULT 0
    )
  `).run();
}

export async function ensureUndoTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS undo_buffer (
      token TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();
}

/* ---------- inserts/updates ---------- */
export async function insertLead(env, data) {
  await ensureLeadsTable(env);

  const today = new Date().toISOString().split("T")[0];

  const name         = trimOrNull(data?.name);
  const phone        = trimOrNull(data?.phone);
  const whatsapp     = trimOrNull(data?.whatsapp ?? data?.phone);
  const email        = trimOrNull(data?.email);
  const source       = trimOrNull(data?.source ?? "website");
  const city         = trimOrNull(data?.city);
  const street       = trimOrNull(data?.street);
  const zip          = trimOrNull(data?.zip);
  const service      = trimOrNull(data?.service ?? "unknown");
  const captured_by  = trimOrNull(data?.captured_by ?? "public");

  if (!name || !phone || !email) {
    throw new Error("Missing required fields (name, phone, email).");
  }

  const billing_email = email;
  const score         = 1;
  const date_added    = today;

  await env.DB.prepare(`
    INSERT INTO leads (
      name, phone, whatsapp, email, source, city, street, zip, service,
      billing_email, score, date_added, captured_by, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(
    toNull(name),
    toNull(phone),
    toNull(whatsapp),
    toNull(email),
    toNull(source),
    toNull(city),
    toNull(street),
    toNull(zip),
    toNull(service),
    toNull(billing_email),
    toNull(score),
    toNull(date_added),
    toNull(captured_by)
  ).run();
}

export async function getAllLeads(env) {
  await ensureLeadsTable(env);
  const res = await env.DB.prepare(`SELECT * FROM leads ORDER BY date_added DESC, id DESC`).all();
  return res.results || [];
}

export async function getLead(env, id) {
  return await env.DB.prepare(`SELECT * FROM leads WHERE id=?1`).bind(id).first();
}

export async function updateLead(env, id, data) {
  const keys = Object.keys(data || {});
  if (!keys.length) return;
  const vals = keys.map((k) => {
    const v = data[k];
    if (v === undefined || v === null) return null;
    return typeof v === "string" ? v.trim() : v;
  });
  const sets = keys.map((k) => `${k}=?`).join(", ");
  await env.DB.prepare(`UPDATE leads SET ${sets} WHERE id=?`).bind(...vals, id).run();
}

/* ---------- undo buffer ---------- */
export async function stageUndo(env, rows, ttl = 10) {
  await ensureUndoTable(env);
  const token = (typeof cryptoRandomUUID === "function" ? cryptoRandomUUID() : Math.random().toString(36).slice(2));
  const expires = nowSec() + ttl;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO undo_buffer (token, rows_json, expires_at) VALUES (?, ?, ?)`
  ).bind(token, JSON.stringify(rows || []), expires).run();
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
    if (!cols.length) continue;
    const placeholders = cols.map(() => "?").join(",");
    const updateCols = cols.map(c => `${c}=excluded.${c}`).join(",");
    await env.DB.prepare(`
      INSERT INTO leads (${cols.join(",")}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updateCols}
    `).bind(...cols.map((c) => (r[c] === undefined ? null : r[c]))).run();
  }
  await env.DB.prepare(`DELETE FROM undo_buffer WHERE token=?`).bind(token).run();
  return true;
}
