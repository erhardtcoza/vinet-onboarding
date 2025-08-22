// src/routes/api-admin.js

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });

const now = () => Date.now();

/** create a short random id */
function rand(n = 8) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** write the same session under all legacy/modern keys */
async function writeSessionAll(env, linkid, obj, opts = {}) {
  const kv = env.ONBOARD_KV;
  const payload = JSON.stringify(obj);

  // Primary (modern)
  await kv.put(`onboard/${linkid}`, payload, opts);

  // Legacy mirrors (for any older code paths)
  await Promise.allSettled([
    kv.put(`onboard:${linkid}`, payload, opts),
    kv.put(`sess:${linkid}`, payload, opts),
    kv.put(`session:${linkid}`, payload, opts),
    kv.put(`inprogress:${linkid}`, payload, opts),
    kv.put(`link:${linkid}`, "1", opts),
  ]);
}

/** read session, trying all known key shapes */
async function readSessionAny(env, linkid) {
  const kv = env.ONBOARD_KV;
  const tries = [
    `onboard/${linkid}`,
    `onboard:${linkid}`,
    `sess:${linkid}`,
    `session:${linkid}`,
    `inprogress:${linkid}`,
    linkid, // in case something wrote bare id
  ];
  for (const k of tries) {
    const val = await kv.get(k, "json");
    if (val) return val;
  }
  return null;
}

/** list sessions by bucket prefix */
async function listByPrefix(env, prefix) {
  const kv = env.ONBOARD_KV;
  const out = [];
  const l = await kv.list({ prefix });
  for (const { name } of l.keys) {
    const sess = await kv.get(name, "json");
    if (!sess) continue;
    out.push({
      id: String(sess.splynx_id || "").trim(),
      linkid: String(sess.id || "").trim(),
      updated: Number(sess.updated || 0),
      status: sess.status || "inprogress",
    });
  }
  // newest first
  out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return out;
}

export function match(pathname, method) {
  return pathname.startsWith("/api/admin/") || pathname.startsWith("/api/staff/");
}

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // -----------------------------
  // Create onboarding link
  // -----------------------------
  if (path === "/api/admin/genlink" && method === "POST") {
    const { id } = (await request.json().catch(() => ({}))) || {};
    const splynxId = String(id || "").trim();
    if (!splynxId) return json({ ok: false, error: "Missing id" }, 400);

    const linkid = `${splynxId}_${rand(8)}`;

    // 14 days validity window
    const created = now();
    const ttlDays = 14;
    const expiresMs = created + ttlDays * 24 * 60 * 60 * 1000;

    const session = {
      id: linkid,
      splynx_id: splynxId,
      status: "inprogress",
      status_alt: "in-progress",
      state: "open",
      active: true,
      enabled: true,
      valid: true,
      created,
      updated: created,
      expires_ms: expiresMs,
      expires: Math.floor(expiresMs / 1000),
      expiresAt: new Date(expiresMs).toISOString(),
      edits: {},
    };

    // keep the record for 14 days (matches expiresAt)
    await writeSessionAll(env, linkid, session, { expirationTtl: 14 * 24 * 60 * 60 });

    const base = env.API_URL || url.origin;
    const onboardUrl = `${base}/onboard/${linkid}`;
    return json({ ok: true, url: onboardUrl, linkid });
  }

  // -----------------------------
  // Generate staff code (either route)
  // -----------------------------
  if (
    (path === "/api/admin/staff/gen" || path === "/api/staff/gen") &&
    method === "POST"
  ) {
    const { linkid } = (await request.json().catch(() => ({}))) || {};
    const lid = String(linkid || "").trim();
    if (!lid) return json({ ok: false, error: "Missing linkid" }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    // 15 minutes
    await env.ONBOARD_KV.put(
      `staff_otp:${lid}`,
      JSON.stringify({ code, created: now(), ttlSec: 900 }),
      { expirationTtl: 900 }
    );
    return json({ ok: true, code });
  }

  // -----------------------------
  // Lists for dashboard
  // -----------------------------
  if (path === "/api/admin/list" && method === "GET") {
    const mode = url.searchParams.get("mode") || "inprog";
    let prefix = "inprogress:";
    if (mode === "pending") prefix = "pending:";
    else if (mode === "approved") prefix = "approved:";
    const items = await listByPrefix(env, prefix);
    return json({ ok: true, items });
  }

  // -----------------------------
  // Approve / Reject / Delete
  // -----------------------------
  if (path === "/api/admin/approve" && method === "POST") {
    const { linkid } = (await request.json().catch(() => ({}))) || {};
    const lid = String(linkid || "").trim();
    if (!lid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = (await readSessionAny(env, lid)) || { id: lid };
    const updated = { ...sess, status: "approved", updated: now() };

    await writeSessionAll(env, lid, updated);
    // also mirror in approved: bucket
    await env.ONBOARD_KV.put(`approved:${lid}`, JSON.stringify(updated));

    return json({ ok: true });
  }

  if (path === "/api/admin/reject" && method === "POST") {
    const { linkid, reason = "" } = (await request.json().catch(() => ({}))) || {};
    const lid = String(linkid || "").trim();
    if (!lid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = (await readSessionAny(env, lid)) || { id: lid };
    const updated = {
      ...sess,
      status: "rejected",
      reject_reason: String(reason || ""),
      updated: now(),
    };

    await writeSessionAll(env, lid, updated);
    await env.ONBOARD_KV.put(`pending:${lid}`, JSON.stringify(updated)); // keep visible in pending bucket

    return json({ ok: true });
  }

  if (path === "/api/admin/delete" && method === "POST") {
    const { linkid } = (await request.json().catch(() => ({}))) || {};
    const lid = String(linkid || "").trim();
    if (!lid) return json({ ok: false, error: "Missing linkid" }, 400);

    const kv = env.ONBOARD_KV;
    // delete every possible key shape
    const keys = [
      `onboard/${lid}`,
      `onboard:${lid}`,
      `sess:${lid}`,
      `session:${lid}`,
      `inprogress:${lid}`,
      `pending:${lid}`,
      `approved:${lid}`,
      `link:${lid}`,
      lid,
    ];
    await Promise.allSettled(keys.map((k) => kv.delete(k)));
    return json({ ok: true, deleted: true });
  }

  // -----------------------------
  // Debug helpers you used
  // -----------------------------
  if (path === "/api/admin/session/keys" && method === "GET") {
    const linkid = String(url.searchParams.get("linkid") || "").trim();
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const kv = env.ONBOARD_KV;
    const prefixes = [
      `onboard/${linkid}`,
      `onboard:${linkid}`,
      `sess:${linkid}`,
      `session:${linkid}`,
      `inprogress:${linkid}`,
      `pending:${linkid}`,
      `approved:${linkid}`,
      `link:${linkid}`,
      linkid,
    ];

    const keys = [];
    for (const name of prefixes) {
      const v = await kv.get(name, "arrayBuffer").catch(() => null);
      if (v) keys.push({ key: name, bytes: v.byteLength });
    }
    return json({ ok: true, linkid, keys });
  }

  if (path === "/api/admin/session/get" && method === "GET") {
    const linkid = String(url.searchParams.get("linkid") || "").trim();
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await readSessionAny(env, linkid);
    return json({ ok: true, linkid, found: !!sess, session: sess || null });
  }

  return json({ error: "Unknown admin endpoint" }, 404);
}