// src/routes/onboard.js
import { renderOnboardUI } from "../ui/onboard.js";

export function match(path, method) {
  return path.startsWith("/onboard/") && method === "GET";
}

export async function handle(request, env) {
  const path = new URL(request.url).pathname;
  const linkid = path.split("/")[2] || "";
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Link expired or invalid", { status: 404 });
  return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
}
