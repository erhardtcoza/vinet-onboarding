// src/routes/api-admin.js
import { getClientMeta } from "../helpers.js";
import { fetchProfileForDisplay, splynxPUT } from "../splynx.js";

// Small JSON helper
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });

// Creates a linkid and initial KV records
async function createSession(env, splynxId) {
  const id = String(splynxId).trim();
  if (!/^\d+$/.test(id)) throw new Error("Invalid Splynx ID");

  const rand = Math.random().toString(36).slice(2, 10);
  const linkid = `${id}_${rand}`;
  const now = Date.now();

  const base = {
    id,
    linkid,
    status: "inprogress",
    status_alt: "in-progress",
    state: "open",
    active: true,
    enabled: true,
    valid: true,
    created: now,
    updated: now,
    // a 14-day window by default
    expires_ms: now + 14 * 24 * 60 * 60 * 1000,
  };

  // Back-compat keys (old UI looked for these)
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(base), {
    expirationTtl: 14 * 24 * 60 * 60,
  });
  await env.ONBOARD_KV.put(`sess:${linkid}`, JSON.stringify(base), {
    expirationTtl: 14 * 24 * 60 * 60,
  });
  await env.ONBOARD_KV.put(`session:${linkid}`, JSON.stringify(base), {
    expirationTtl: 14 * 24 * 60 * 60,
  });
  await env.ONBOARD_KV.put(`inprogress:${linkid}`, JSON.stringify(base), {
    expirationTtl: 14 * 24 * 60 * 60,
  });

  // quick existence marker (used by some debug tools)
  await env.ONBOARD_KV.put(`link:${linkid}`, "1", {
    expirationTtl: 14 * 24 * 60 * 60,
  });

  return { linkid, ...base };
}

// Compact list loader with verification info folded in
async function loadList(env, section) {
  // valid sections in our dashboard
  const prefix =
    section === "approved"
      ? "approved:"
      : section === "pending"
      ? "pending:"
      : "inprogress:";

  const keys = await env.ONBOARD_KV.list({ prefix, limit: 1000 });
  const items = [];

  for (const { name } of keys.keys) {
    const linkid = name.split(":")[1];
    const data =
      (await env.ONBOARD_KV.get(name, "json")) ||
      (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) ||
      {};

    // Try enrich from main onboard blob (for verified info)
    const onboard = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    const ver = onboard && onboard.verified ? onboard.verified : null;

    items.push({
      id: data.id || (linkid || "").split("_")[0] || "",
      linkid,
      updated: data.updated || data.last_time || Date.now(),
      status: data.status || section,
      // verification surface
      verified_ok: !!(ver && (ver.ok || ver.valid)),
      verified_kind: ver?.kind || null, // "wa" | "staff" | null
      verified_phone: ver?.phone || null,
      verified_time: ver?.when || ver?.ts || null,
    });
  }

  // newest first
  items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return items;
}

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = request.method;

  // --- Create onboarding link from Splynx ID ---
  if (path === "/genlink" && method === "POST") {
    const { id } = await request.json().catch(() => ({}));
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const sess = await createSession(env, id);
    const base = env.API_URL || url.origin;
    const linkUrl = `${base}/onboard/${sess.linkid}`;
    return json({ ok: true, url: linkUrl, linkid: sess.linkid });
  }

  // --- Generate one-time staff code for a linkid ---
  if (path === "/staff/gen" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const rec = {
      code,
      kind: "staff",
      ts: Date.now(),
      by: "admin",
      valid: true,
    };

    // store on the onboard session object
    const sess =
      (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const codes = Array.isArray(sess.staff_codes) ? sess.staff_codes : [];
    codes.push(rec);
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, staff_codes: codes, updated: Date.now() }),
      { expirationTtl: 14 * 24 * 60 * 60 }
    );

    return json({ ok: true, code });
  }

  // --- Lists for the dashboard (JSON, consumed by UI) ---
  if (path === "/list") {
    const section =
      url.searchParams.get("section") ||
      url.searchParams.get("mode") ||
      "inprogress";

    const items = await loadList(env, section);
    return json({ ok: true, items });
  }

  // --- Approve (moves from pending->approved and pushes edits to Splynx) ---
  if (path === "/approve" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    // pull pending edits (saved by the UI flow under onboard/${linkid})
    const sess =
      (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const id = sess.id || (linkid || "").split("_")[0];

    // build minimal payload
    const e = sess.edits || {};
    const payload = {};
    if (e.full_name) payload.name = e.full_name;
    if (e.email) payload.email = e.email;
    if (e.phone) payload.phone = e.phone;
    if (e.passport) payload.passport = e.passport;
    if (e.street || e.city || e.zip) {
      payload.street_1 = e.street || "";
      payload.city = e.city || "";
      payload.zip_code = e.zip || "";
    }

    // best-effort push
    try {
      if (Object.keys(payload).length) {
        await splynxPUT(env, `/admin/customers/${id}`, payload);
      }
    } catch (err) {
      console.log("[admin] approve push failed", err?.message || err);
    }

    // move markers
    await env.ONBOARD_KV.put(
      `approved:${linkid}`,
      JSON.stringify({ ...sess, status: "approved", updated: Date.now() }),
      { expirationTtl: 14 * 24 * 60 * 60 }
    );
    await env.ONBOARD_KV.delete(`pending:${linkid}`);

    // keep onboard blob but mark approved
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, status: "approved", updated: Date.now() }),
      { expirationTtl: 14 * 24 * 60 * 60 }
    );

    return json({ ok: true });
  }

  // --- Reject (move to pending->inprogress or just tag rejected) ---
  if (path === "/reject" && method === "POST") {
    const { linkid, reason } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess =
      (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    await env.ONBOARD_KV.put(
      `inprogress:${linkid}`,
      JSON.stringify({
        ...sess,
        status: "inprogress",
        status_alt: "in-progress",
        updated: Date.now(),
        reject_reason: reason || "",
      }),
      { expirationTtl: 14 * 24 * 60 * 60 }
    );
    await env.ONBOARD_KV.delete(`pending:${linkid}`);

    // also mark onboard blob
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "inprogress",
        status_alt: "in-progress",
        updated: Date.now(),
      }),
      { expirationTtl: 14 * 24 * 60 * 60 }
    );

    return json({ ok: true });
  }

  // --- Delete a session (all common keys) ---
  if (path === "/delete" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const prefixes = [
      "inprogress:",
      "pending:",
      "approved:",
      "sess:",
      "session:",
      "link:",
    ];
    await Promise.all([
      env.ONBOARD_KV.delete(`onboard/${linkid}`),
      ...prefixes.map((p) => env.ONBOARD_KV.delete(`${p}${linkid}`)),
    ]);
    return json({ ok: true });
  }

  // --- Debug helpers used earlier (kept) ---
  if (path === "/session/keys") {
    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const prefixes = [
      "",
      "onboard/",
      "inprogress:",
      "pending:",
      "approved:",
      "sess:",
      "session:",
      "link:",
    ];
    const keysFound = [];
    for (const p of prefixes) {
      const key = p.endsWith("/") ? `${p}${linkid}` : `${p}${linkid}`;
      const val = await env.ONBOARD_KV.get(key, "text");
      if (val !== null) keysFound.push({ key, bytes: (val || "").length });
    }
    return json({ ok: true, linkid, keys: keysFound });
  }

  if (path === "/session/get") {
    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    return json({ ok: true, linkid, found: !!sess, session: sess || null });
  }

  return json({ error: "Unknown admin endpoint" }, 404);
}