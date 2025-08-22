// src/routes/api-admin.js
import { splynxPUT, mapEditsToSplynxPayload } from "../splynx.js";
import { renderAdminReviewHTML } from "../ui/admin.js";

/**
 * Router for /api/admin/*
 */
export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = request.method;

  // ---------- Create Onboarding Link (used by the top card) ----------
  // POST /api/admin/genlink  { id: <splynxId> }
  if (path === "/genlink" && method === "POST") {
    try {
      const body = await safeJson(request);
      const splynxId = String(body?.id ?? "").trim();
      if (!splynxId) return json({ ok: false, error: "Missing id" }, 400);

      // linkid format: <splynxId>_<8char>
      const linkid = `${splynxId}_${rand8()}`;

      // seed a fresh "in progress" session in KV
      const now = Date.now();
      const session = {
        id: linkid,              // linkid as the primary session id
        splynx_id: splynxId,     // keep explicit reference
        status: "inprogress",
        created: now,
        updated: now,
        edits: {},               // customer edits will live here later
      };
      await env.ONBOARD_KV.put(`inprogress:${linkid}`, JSON.stringify(session));

      // base URL from ENV or request origin
      const base = env.API_URL || `${url.protocol}//${url.host}`;
      const onboardUrl = `${base}/onboard/${encodeURIComponent(linkid)}`;

      return json({ ok: true, url: onboardUrl, linkid });
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err) }, 500);
    }
  }

  // ---------- Lists ----------
  // GET /api/admin/list?section=inprogress|pending|approved
  if (path.startsWith("/list")) {
    const section = url.searchParams.get("section") || "inprogress";
    const sessions = await loadSessions(env, section);
    return new Response(renderAdminReviewHTML({ [section]: sessions }), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // ---------- Approve ----------
  // POST /api/admin/approve/:id   (id === linkid, we expect the KV source under pending:<id>)
  if (path.startsWith("/approve/") && method === "POST") {
    const id = path.split("/")[2];
    try {
      await approveSession(env, id);
      return json({ ok: true, action: "approved", id });
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err) }, 500);
    }
  }

  // ---------- Reject ----------
  // POST /api/admin/reject/:id
  if (path.startsWith("/reject/") && method === "POST") {
    const id = path.split("/")[2];
    try {
      await rejectSession(env, id);
      return json({ ok: true, action: "rejected", id });
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err) }, 500);
    }
  }

  // ---------- Delete ALL sessions (maintenance) ----------
  // POST /api/admin/delete
  if (path === "/delete" && method === "POST") {
    try {
      await deleteAllSessions(env);
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: err?.message || String(err) }, 500);
    }
  }

  return new Response(JSON.stringify({ error: "Unknown admin endpoint" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/* ===================== Helpers ===================== */

async function loadSessions(env, section) {
  const kv = env.ONBOARD_KV;
  const keys = await kv.list({ prefix: section + ":" });
  const sessions = [];
  for (const k of keys.keys) {
    const data = await kv.get(k.name, { type: "json" });
    if (data) {
      sessions.push({
        id: k.name.split(":")[1], // this is the linkid (e.g. 319_abcd1234)
        status: section,
        ...data,
      });
    }
  }
  // optional: newest first
  sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return sessions;
}

async function approveSession(env, id) {
  const kv = env.ONBOARD_KV;

  // When customers finish, your app should move their session into pending:<linkid>.
  // We approve from 'pending' and archive into 'approved'.
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);

  // Push edits to Splynx (update existing customer if we have one)
  const payload = mapEditsToSplynxPayload(raw?.edits || raw || {});
  const splynxId = raw.splynx_id || raw.id || "";

  if (splynxId && Object.keys(payload).length > 0) {
    // Update main customer record
    await splynxPUT(env, `/admin/customers/${splynxId}`, payload);
  }

  // Move KV: pending -> approved
  await kv.put("approved:" + id, JSON.stringify({ ...raw, status: "approved", updated: Date.now() }));
  await kv.delete("pending:" + id);
}

async function rejectSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);
  await kv.put("rejected:" + id, JSON.stringify({ ...raw, status: "rejected", updated: Date.now() }));
  await kv.delete("pending:" + id);
}

async function deleteAllSessions(env) {
  const kv = env.ONBOARD_KV;
  const prefixes = ["inprogress:", "pending:", "approved:", "rejected:"];

  for (const prefix of prefixes) {
    const list = await kv.list({ prefix });
    for (const { name } of list.keys) {
      await kv.delete(name);
    }
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function rand8() {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}