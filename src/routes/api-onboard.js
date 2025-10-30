// src/routes/api-onboard.js
import { getClientMeta } from "../helpers.js";

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}

export function match(path, method) {
  if (path.startsWith("/api/progress/") && method === "POST") return true;
  if (path === "/api/onboard/upload" && method === "POST") return true;
  return false;
}

// src/routes/api-onboard.js
// Minimal stub to satisfy `import { createOnboardingSession } ...`
// Returns a short onboarding code + full URL. You can wire persistence later if needed.

export async function createOnboardingSession(env, payload = {}) {
  const name = String((payload.name || "").trim() || "client");
  // use last token of name if possible, else first
  const parts = name.split(/\s+/).filter(Boolean);
  const base = (parts.length ? parts[parts.length - 1] : name).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const code = `${base || "client"}_${rand}`;

  const url = `https://onboard.vinet.co.za/onboard/${code}`;

  // If you want to persist later, create an `onboard_sessions` table and insert here.
  // For now we just return values expected by callers.
  return { code, url };
}

// (Optional) tiny HTTP endpoint if your router expects a handler here later.
// Not required by the current error, safe to keep.
/*
export async function handleCreateOnboardingSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const result = await createOnboardingSession(env, body || {});
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
*/
export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const getIP = () =>
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const getUA = () => request.headers.get("user-agent") || "";

  // Save progress (capture audit meta)
  if (path.startsWith("/api/progress/")) {
    const linkid = path.split("/")[3];
    const body = await request.json().catch(() => ({}));
    const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const next = {
      ...existing,
      ...body,
      last_ip: getIP(),
      last_ua: getUA(),
      last_time: Date.now(),
      audit_meta: existing.audit_meta || getClientMeta(request),
    };
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
    return json({ ok: true });
  }

  // Upload to R2
  if (path === "/api/onboard/upload") {
    const params = new URL(request.url).searchParams;
    const linkid = params.get("linkid");
    const fileName = params.get("filename") || "file.bin";
    const label = params.get("label") || "";
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Invalid link", { status: 404 });
    const body = await request.arrayBuffer();
    const key = `uploads/${linkid}/${Date.now()}_${fileName.replace(/[^a-z0-9_.-]/gi, "_")}`;
    await env.R2_UPLOADS.put(key, body);
    const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
    uploads.push({ key, name: fileName, size: body.byteLength, label });
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
    return json({ ok: true, key });
  }

  return new Response("Not found", { status: 404 });
}
