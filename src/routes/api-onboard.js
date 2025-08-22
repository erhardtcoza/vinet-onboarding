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
