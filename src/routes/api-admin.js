// src/routes/api-admin.js
import { getClientMeta, deleteOnboardAll } from "../helpers.js";
import { fetchProfileForDisplay, splynxPUT } from "../splynx.js";
import { renderAdminReviewHTML } from "../ui/admin-review.js";

/**
 * Router for /api/admin/*
 */
export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, "");
  const method = request.method;

  // --- List sessions by section ---
  if (path.startsWith("/list")) {
    const section = url.searchParams.get("section") || "inprogress";
    const sessions = await loadSessions(env, section);
    return new Response(renderAdminReviewHTML({ [section]: sessions }), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // --- Approve session ---
  if (path.startsWith("/approve/") && method === "POST") {
    const id = path.split("/")[2];
    await approveSession(env, id);
    return json({ ok: true, action: "approved", id });
  }

  // --- Reject session ---
  if (path.startsWith("/reject/") && method === "POST") {
    const id = path.split("/")[2];
    await rejectSession(env, id);
    return json({ ok: true, action: "rejected", id });
  }

  // --- Delete all onboarding (reset) ---
  if (path === "/delete" && method === "POST") {
    await deleteOnboardAll(env);
    return json({ ok: true });
  }

  return new Response(JSON.stringify({ error: "Unknown admin endpoint" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Helpers
 */
async function loadSessions(env, section) {
  const kv = env.ONBOARD_KV;
  const keys = await kv.list({ prefix: section + ":" });
  const sessions = [];
  for (const k of keys.keys) {
    const data = await kv.get(k.name, { type: "json" });
    if (data) sessions.push({ id: k.name.split(":")[1], ...data });
  }
  return sessions;
}

async function approveSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) return;

  // Push edits to Splynx (example: update customer info)
  const payload = {};
  if (raw.full_name) payload.name = raw.full_name;
  if (raw.email) payload.email = raw.email;
  if (raw.passport) payload.passport = raw.passport;
  if (raw.address) payload.street_1 = raw.address;
  if (raw.city) payload.city = raw.city;
  if (raw.zip) payload.zip_code = raw.zip;

  try {
    await splynxPUT(env, `/admin/customers/${raw.id}`, payload);
  } catch (err) {
    console.error("Approve Splynx update failed", err);
  }

  await kv.put("approved:" + id, JSON.stringify(raw));
  await kv.delete("pending:" + id);
}

async function rejectSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) return;
  await kv.delete("pending:" + id);
  await kv.put("rejected:" + id, JSON.stringify(raw));
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" },
  });
}
