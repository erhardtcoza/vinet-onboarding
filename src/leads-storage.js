// src/leads-storage.js
import { cryptoRandomUUID } from "./helpers.js"; // optional helper if you already have one

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

export async function insertLead(env, data) {
  await ensureLeadsTable(env);
  const today = new Date().toISOString().split("T")[0];
  const { name, phone, whatsapp, email, source, city, street, zip, service, captured_by } = data;
  const score = 1;
  await env.DB.prepare(`
    INSERT INTO leads (name, phone, whatsapp, email, source, city, street, zip, service, billing_email, score, date_added, captured_by, synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(name, phone, whatsapp, email, source, city, street, zip, service, email, score, today, captured_by).run();
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
  const keys = Object.keys(data);
  const vals = Object.values(data);
  const sets = keys.map(k => `${k}=?`).join(", ");
  await env.DB.prepare(`UPDATE leads SET ${sets} WHERE id=?`).bind(...vals, id).run();
}

export async function deleteLeads(env, ids = []) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).bind(...ids).run();
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export async function stageUndo(env, rows, ttl = 10) {
  await ensureUndoTable(env);
  const token = cryptoRandomUUID ? cryptoRandomUUID() : Math.random().toString(36).slice(2);
  const expires = nowSec() + ttl;
  await env.DB.prepare(`INSERT OR REPLACE INTO undo_buffer (token, rows_json, expires_at) VALUES (?, ?, ?)`)
    .bind(token, JSON.stringify(rows), expires).run();
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
