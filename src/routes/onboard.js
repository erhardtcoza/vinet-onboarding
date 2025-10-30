// src/routes/onboard.js
import { renderOnboardUI } from "../ui/onboard.js";

export function match(path, method) {
  return path.startsWith("/onboard/") && method === "GET";
}

// Onboarding host router stub.
// Your current onboarding worker was “working fine”. Paste your existing
// routes here (e.g., /onboard/*, /agreements/*, /api/otp, /api/terms, etc.)
// so nothing else needs to change.

export async function handleOnboarding(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // TEMP landing so you can verify host switch works:
  if (request.method === "GET" && (path === "/" || path === "/index" || path === "/index.html")) {
    return new Response(`<!doctype html><meta charset="utf-8"/>
<title>Onboarding</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:32px;color:#0b1320}</style>
<h1 style="color:#e2001a">Onboarding</h1>
<p>This endpoint is wired. Paste your stable onboarding routes into <code>src/routes/onboarding.js</code>.</p>`, { headers: { "content-type":"text/html" }});
  }

  // TODO: paste/port your full onboarding router here.
  // For now return 404 for other paths.
  return new Response("Not found", { status: 404 });
}

export async function handle(request, env) {
  const path = new URL(request.url).pathname;
  const linkid = path.split("/")[2] || "";
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Link expired or invalid", { status: 404 });
  return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
}
