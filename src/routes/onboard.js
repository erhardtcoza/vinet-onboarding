// src/routes/onboard.js
import { renderOnboardUI } from "../ui/onboard.js";

export function match(path, method) {
  return path.startsWith("/onboard/") && method === "GET";
}

export async function handle(request, env) {
  const path = new URL(request.url).pathname;
  const linkid = path.split("/")[2] || "";

  // Try the canonical key first (slash), then fallbacks.
  const sess =
    (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) ||
    (await env.ONBOARD_KV.get(`onboard:${linkid}`, "json")) ||
    (await firstFound(env, linkid, [
      `inprogress:${linkid}`,
      `pending:${linkid}`,
      `approved:${linkid}`,
      `rejected:${linkid}`,
      `sess:${linkid}`,
      `session:${linkid}`,
      linkid, // bare key
    ]));

  if (!sess) {
    return new Response("Link expired or invalid", { status: 404 });
  }

  // (Optional) light validity check; be permissive
  if (sess.valid === false) {
    return new Response("Link expired or invalid", { status: 403 });
  }

  return new Response(renderOnboardUI(linkid), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function firstFound(env, linkid, keys) {
  for (const k of keys) {
    const v = await env.ONBOARD_KV.get(k, "json");
    if (v) return v;
  }
  return null;
}