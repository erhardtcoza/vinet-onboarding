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

  // ---------- Create Onboarding Link ----------
  // POST /api/admin/genlink  { id: <splynxId> }
  if (path === "/genlink" && method === "POST") {
    try {
      const body = await safeJson(request);
      const splynxId = String(body?.id ?? "").trim();
      if (!splynxId) return json({ ok: false, error: "Missing id" }, 400);

      const linkid = `${splynxId}_${rand8()}`;
      const now = Date.now();
      const ttlDays = 14;
      const ttlSeconds = ttlDays * 24 * 60 * 60;

      // expiry in multiple formats (to satisfy strict validators)
      const expires_ms = now + ttlSeconds * 1000;
      const expires = Math.floor(expires_ms / 1000);
      const expiresAt = new Date(expires_ms).toISOString();

      // super‑compatible session shape
      const session = {
        id: linkid,
        splynx_id: splynxId,

        // multiple status/state flags
        status: "inprogress",
        status_alt: "in-progress",
        state: "open",
        active: true,
        enabled: true,
        valid: true,

        created: now,
        updated: now,
        expires_ms,
        expires,      // unix seconds
        expiresAt,    // ISO datetime

        edits: {},
      };

      const kv = env.ONBOARD_KV;

      // Write under several common prefixes + a bare key; give TTL to primary keys
      await Promise.all([
        kv.put(`inprogress:${linkid}`, JSON.stringify(session)),
        kv.put(`sess:${linkid}`, JSON.stringify(session)),
        kv.put(`session:${linkid}`, JSON.stringify(session)),
        kv.put(`onboard:${linkid}`, JSON.stringify(session), { expirationTtl: ttlSeconds }),
        kv.put(`link:${linkid}`, "1", { expirationTtl: ttlSeconds }),
        kv.put(linkid, JSON.stringify(session), { expirationTtl: ttlSeconds }), // bare key (no prefix)
      ]);

      const base = env.API_URL || `${url.protocol}//${url.host}`;
      const onboardUrl = `${base}/onboard/${encodeURIComponent(linkid)}`;

      console.log(`[admin] genlink OK linkid=${linkid}`);
      return json({ ok: true, url: onboardUrl, linkid, expires, expires_ms, expiresAt });
    } catch (err) {
      console.error("[admin] genlink error", err);
      return json({ ok: false, error: err?.message || String(err) }, 500);
    }
  }

  // ---------- Staff Code (under admin) ----------
  // POST /api/admin/staff/gen   { linkid }
  if (path === "/staff/gen" && method === "POST") {
    const body = await safeJson(request);
    const linkid = String(body?.linkid ?? "").trim();
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const code = genCode6();
    const created = Date.now();
    const ttlMinutes = 15;

    await env.ONBOARD_KV.put(
      `staffcode:${linkid}`,
      JSON.stringify({ code, linkid, created, expires: created + ttlMinutes * 60 * 1000 }),
      { expirationTtl: ttlMinutes * 60 }
    );

    console.log(`[staff] Issued code for ${linkid}: ${code}`);
    return json({ ok: true, code, linkid, expires_in: ttlMinutes * 60 });
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
  // POST /api/admin/approve/:id  (id is the linkid; source KV is pending:<id>)
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

  // ---------- DEBUG: inspect KV for a linkid ----------
  // GET /api/admin/session/get?linkid=...
  if (path.startsWith("/session/get")) {
    const linkid = url.searchParams.get("linkid") || "";
    const merged = await loadAnySessionByLinkid(env, linkid);
    return json({ ok: true, linkid, found: !!merged, session: merged });
  }

  // GET /api/admin/session/keys?linkid=...
  if (path.startsWith("/session/keys")) {
    const linkid = url.searchParams.get("linkid") || "";
    const kv = env.ONBOARD_KV;
    const prefixes = ["inprogress:", "pending:", "approved:", "rejected:", "sess:", "session:", "onboard:", "link:"];
    const keys = [];
    for (const p of prefixes) {
      const name = p + linkid;
      const val = await kv.get(name);
      if (val !== null) {
        keys.push({ key: name, bytes: val.length });
      }
    }
    // bare key too
    const bareVal = await kv.get(linkid);
    if (bareVal !== null) keys.push({ key: linkid, bytes: bareVal.length });

    return json({ ok: true, linkid, keys });
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
        id: k.name.split(":")[1], // linkid (e.g., 319_abcd1234)
        status: section,
        ...data,
      });
    }
  }
  sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return sessions;
}

async function loadAnySessionByLinkid(env, linkid) {
  if (!linkid) return null;
  const kv = env.ONBOARD_KV;
  const prefixes = ["inprogress:", "pending:", "approved:", "rejected:", "sess:", "session:", "onboard:"];
  for (const p of prefixes) {
    const raw = await kv.get(p + linkid, { type: "json" });
    if (raw) return raw;
  }
  // bare key as last attempt
  const bare = await kv.get(linkid, { type: "json" });
  if (bare) return bare;
  return null;
}

async function approveSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);

  const payload = mapEditsToSplynxPayload(raw?.edits || raw || {});
  const splynxId = raw.splynx_id || raw.id || "";

  if (splynxId && Object.keys(payload).length > 0) {
    await splynxPUT(env, `/admin/customers/${splynxId}`, payload);
  }

  const approved = { ...raw, status: "approved", status_alt: "approved", updated: Date.now(), valid: true };
  await Promise.all([
    kv.put("approved:" + id, JSON.stringify(approved)),
    kv.delete("pending:" + id),
    kv.put("sess:" + id, JSON.stringify(approved)),
    kv.put("session:" + id, JSON.stringify(approved)),
    kv.put("onboard:" + id, JSON.stringify(approved)),
    kv.put(id, JSON.stringify(approved)), // bare key mirror
  ]);
}

async function rejectSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);
  const rejected = { ...raw, status: "rejected", status_alt: "rejected", updated: Date.now(), valid: false };
  await Promise.all([
    kv.put("rejected:" + id, JSON.stringify(rejected)),
    kv.delete("pending:" + id),
    kv.put("sess:" + id, JSON.stringify(rejected)),
    kv.put("session:" + id, JSON.stringify(rejected)),
    kv.put("onboard:" + id, JSON.stringify(rejected)),
    kv.put(id, JSON.stringify(rejected)), // bare key mirror
  ]);
}

async function deleteAllSessions(env) {
  const kv = env.ONBOARD_KV;
  const prefixes = ["inprogress:", "pending:", "approved:", "rejected:", "sess:", "session:", "onboard:", "link:"];
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
  try { return await request.json(); } catch { return {}; }
}
function rand8() {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function genCode6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}