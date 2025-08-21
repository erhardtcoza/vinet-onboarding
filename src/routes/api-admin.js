// src/routes/api-admin.js
import { getClientMeta, deleteOnboardAll } from "../helpers.js";
import { splynxPUT, mapEditsToSplynxPayload } from "../splynx.js";
import { renderAdminReviewHTML } from "../ui/admin.js";

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
    try {
      await approveSession(env, id);
      return json({ ok: true, action: "approved", id });
    } catch (err) {
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
  }

  // --- Reject session ---
  if (path.startsWith("/reject/") && method === "POST") {
    const id = path.split("/")[2];
    try {
      await rejectSession(env, id);
      return json({ ok: true, action: "rejected", id });
    } catch (err) {
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
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
    if (data) {
      sessions.push({
        id: k.name.split(":")[1],
        status: section,
        ...data,
      });
    }
  }
  return sessions;
}

async function approveSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);

  // Use central mapping function
  const payload = mapEditsToSplynxPayload(raw);

  if (Object.keys(payload).length > 0) {
    try {
      await splynxPUT(env, `/admin/customers/${raw.id}`, payload);
    } catch (err) {
      console.error("Approve Splynx update failed", err);
      throw err;
    }
  }

  await kv.put("approved:" + id, JSON.stringify(raw));
  await kv.delete("pending:" + id);
}

async function rejectSession(env, id) {
  const kv = env.ONBOARD_KV;
  const raw = await kv.get("pending:" + id, { type: "json" });
  if (!raw) throw new Error(`No pending session found for ${id}`);
  await kv.delete("pending:" + id);
  await kv.put("rejected:" + id, JSON.stringify(raw));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}