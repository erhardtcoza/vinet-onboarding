// src/public/routes.js
// Public host: splash (Turnstile preclear) → landing (CTA) → /lead form → /submit
import { html, json, safeStr, hasCookie } from "../utils/http.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { renderLandingHTML } from "../ui/landing.js";
// NOTE: file exports renderSplashHTML; import & alias it to splashHTML
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

// Tiny server-side address splitter as a safety net
function splitAddress(full) {
  const out = { street: "", city: "", zip: "" };
  if (!full) return out;
  const parts = String(full).split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length) {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[0-9]{3,6}$/.test(parts[i])) { out.zip = parts[i]; parts.splice(i, 1); break; }
    }
    if (parts.length) { out.city = parts[parts.length - 1]; parts.pop(); }
    out.street = parts.join(", ").trim();
  }
  return out;
}

export async function handlePublic(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Service worker & manifest (lightweight helpers)
  if (request.method === "GET" && pathname === "/sw.js") {
    return new Response(
      'self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>self.clients.claim());',
      { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  if (request.method === "GET" && pathname === "/manifest.webmanifest") {
    return json({
      name: "Vinet",
      short_name: "Vinet",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ED1C24",
      icons: []
    });
  }

  // Splash (Turnstile)
  if (request.method === "GET" && (pathname === "/" || pathname === "/index" || pathname === "/index.html")) {
    return html(splashHTML(env.TURNSTILE_SITE_KEY || "0x4AAAAAABxWz1R1NnIj1POM"));
  }

  // Turnstile verify → mint cookie
  if (request.method === "POST" && pathname === "/ts-verify") {
    try {
      const body = await request.json().catch(() => ({}));
      const { token, skip } = body || {};

      // Allow explicit skip (user tapped Skip)
      if (skip === true) {
        const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
        return json({ ok: true, skipped: true, proceed: true }, 200, { "set-cookie": cookie });
      }

      if (!token) return json({ error: "missing token" }, 400);

      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY || "0x4AAAAAABxWz9bB2HqidAUtWOweMHAaLxk",
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || ""
        })
      });
      const result = await vr.json().catch(() => ({ success: false }));

      const cookie = `ts_ok=${result.success ? "1" : "0"}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return json({ ok: true, success: !!result.success, proceed: true }, 200, { "set-cookie": cookie });
    } catch {
      const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return json({ ok: true, success: false, proceed: true }, 200, { "set-cookie": cookie });
    }
  }

  // Landing (CTA buttons)
  if (request.method === "GET" && pathname === "/landing") {
    return html(renderLandingHTML());
  }

  // Lead form
  if (request.method === "GET" && pathname === "/lead") {
    return html(renderPublicLeadHTML());
  }

  // Form submit — require cookie (either secured=1 OR allowed to proceed=0)
  if (request.method === "POST" && pathname === "/submit") {
    if (!hasCookie(request, "ts_ok")) return json({ error: "Session not verified" }, 403);

    await ensureLeadSchema(env);
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Bad JSON" }, 400);

    const full_name = safeStr(body.name);
    const phone     = safeStr(body.phone);
    const email     = safeStr(body.email);
    const streetIn  = safeStr(body.street || body.address_line);
    let   city      = safeStr(body.city);
    let   zip       = safeStr(body.zip);
    const source    = safeStr(body.source || "web");
    const service   = safeStr(body.service || "general");

    if (!full_name || !phone || !email) {
      return json({ error: "Missing required fields" }, 400);
    }

    if (!city || !zip) {
      const g = splitAddress(streetIn);
      city = city || g.city;
      zip  = zip  || g.zip;
    }

    const payload = {
      name: full_name,
      phone, email, source,
      city, street: streetIn, zip,
      billing_email: email,
      score: 1,
      date_added: DATE_TODAY(),
      captured_by: "public",
      service_interested: service,
      partner: "main",
      location: "main",
    };

    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,synced,service_interested,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0,?10,?11)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added, payload.service_interested, nowSec()
    ).run();

    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    // Avoid template literals to sidestep bundler backtick parsing hiccups
    const ref = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    return json({ ok: true, ref });
  }

  return null;
}
