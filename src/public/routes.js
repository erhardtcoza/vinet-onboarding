// src/public/routes.js
// Splash at "/" (Turnstile) → sets cookie → redirect to /home (landing)
// Landing + Form require the cookie (else redirect to "/")

import { html, safeStr, hasCookie } from "../utils/http.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { renderLandingHTML } from "../ui/landing.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";
import { splashHTML } from "../ui/splash.js";

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function text(content, status = 200, headers = {}) {
  return new Response(content, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
}

// ---------- PWA ----------
function manifest(env) {
  const name = (env && env.PWA_NAME) || "Vinet CRM Suite";
  const short_name = (env && env.PWA_SHORT) || "VinetCRM";
  const theme_color = "#ED1C24";
  const background_color = "#ffffff";
  return {
    name, short_name, start_url: "/", display: "standalone", scope: "/",
    theme_color, background_color,
    icons: [
      { src: "/favicon.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

const SW_JS = `self.addEventListener("install",(e)=>{
  e.waitUntil(caches.open("vinet-crm-v1").then((c)=>c.addAll(["/","/home","/lead","/form"])));
  self.skipWaiting();
});
self.addEventListener("activate",(e)=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",(e)=>{
  if(e.request.method!=="GET") return;
  e.respondWith(caches.match(e.request).then((r)=>r||fetch(e.request)));
});`;

// ---------- Routes ----------
export async function handlePublic(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1) Splash (Turnstile) at "/"
  if (request.method === "GET" && (pathname === "/" || pathname === "/index" || pathname === "/index.html")) {
    return html(splashHTML(env && env.TURNSTILE_SITE_KEY));
  }

  // 2) Turnstile verify → set cookie
  if (request.method === "POST" && pathname === "/ts-verify") {
    try {
      const body = await request.json().catch(() => ({}));
      const token = body && body.token;
      if (!token) return json({ error: "missing token" }, 400);

      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: (env && env.TURNSTILE_SECRET_KEY) || "",
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || ""
        }),
      });
      const result = await vr.json().catch(() => ({ success: false }));
      if (!result.success) return json({ error: true, detail: "turnstile failed" }, 403);

      const cookie = "ts_ok=1; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return json({ ok: true }, 200, { "set-cookie": cookie });
    } catch {
      return json({ error: true, detail: "verify exception" }, 500);
    }
  }

  // Helper guard (redirect to splash if no cookie)
  const requireTS = (req) => hasCookie(req, "ts_ok", "1");

  // 3) Landing (requires cookie) at "/home"
  if (request.method === "GET" && pathname === "/home") {
    if (!requireTS(request)) return new Response(null, { status: 302, headers: { Location: "/" } });
    return html(renderLandingHTML());
  }

  // 4) Lead capture UI (requires cookie) — keep /form as alias
  if (request.method === "GET" && (pathname === "/lead" || pathname === "/form")) {
    if (!requireTS(request)) return new Response(null, { status: 302, headers: { Location: "/" } });
    return html(renderPublicLeadHTML());
  }

  // 5) PWA endpoints
  if (request.method === "GET" && pathname === "/manifest.webmanifest") {
    return json(manifest(env));
  }
  if (request.method === "GET" && pathname === "/sw.js") {
    return text(SW_JS, 200, { "content-type": "application/javascript; charset=utf-8" });
  }

  // 6) Lead submit API (JSON or FormData) — also requires cookie
  if (request.method === "POST" && pathname === "/api/leads/submit") {
    if (!requireTS(request)) return json({ error: "Session not verified" }, 403);

    await ensureLeadSchema(env);

    let body = null;
    try {
      body = await request.json();
    } catch {
      const form = await request.formData().catch(() => null);
      if (form) body = Object.fromEntries(form.entries());
    }
    if (!body) return json({ error: "Bad request" }, 400);

    const payload = {
      name: safeStr(body.name || body.full_name),
      phone: safeStr(body.phone),
      email: safeStr(body.email),
      source: safeStr(body.source || "web"),
      city: safeStr(body.city),
      street: safeStr(body.street),
      zip: safeStr(body.zip),
      billing_email: safeStr(body.email),
      score: 1,
      date_added: DATE_TODAY(),
      captured_by: "public",
      service_interested: safeStr(body.service || body.service_interested),
      partner: safeStr(body.partner || "main"),
      location: safeStr(body.location || "main"),
      notes: safeStr(body.notes),
    };

    // Required fields
    var required = ["name","phone","email","city","street","zip"];
    for (var i=0;i<required.length;i++){
      var k = required[i];
      if (!payload[k]) return json({ error: "Missing " + k }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO leads (
        name, phone, email, source, city, street, zip, billing_email,
        score, date_added, captured_by, synced, service_interested, created_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0,?10,?11)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added, payload.service_interested, nowSec()
    ).run();

    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user, created_at, payload, uploaded_files, processed, splynx_id, synced)
      VALUES ('public', ?1, ?2, '[]', 0, NULL, '0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    return json({ ok: true, ref, message: "Thanks! We’ve received your details." });
  }

  return null;
}
