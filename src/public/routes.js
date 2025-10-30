// Public host (new.*): splash with Turnstile preclear + secure form + submit

import { html, json, safeStr, hasCookie } from "../utils/http.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { splashHTML } from "../ui/splash.js";
import { publicFormHTML } from "../ui/form.js";

export async function handlePublic(request, env) {
  const url = new URL(request.url);

  // Splash (invisible Turnstile)
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index" || url.pathname === "/index.html")) {
    return html(splashHTML(env.TURNSTILE_SITE_KEY || "0x4AAAAAABxWz1R1NnIj1POM"));
  }

  // Turnstile verify → mint cookie
  if (request.method === "POST" && url.pathname === "/ts-verify") {
    try {
      const { token } = await request.json().catch(() => ({}));
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
      if (!result.success) return json({ error: true, detail: "turnstile failed" }, 403);

      // 24h session cookie proving splash preclear
      const cookie = "ts_ok=1; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return json({ ok: true }, 200, { "set-cookie": cookie });
    } catch {
      return json({ error: true, detail: "verify exception" }, 500);
    }
  }

  // Secure form page (shows “Protected & Secure” banner)
  if (request.method === "GET" && url.pathname === "/form") {
    return html(publicFormHTML());
  }

  // Form submit — require cookie from splash
  if (url.pathname === "/submit" && request.method === "POST") {
    if (!hasCookie(request, "ts_ok", "1")) return json({ error: "Session not verified" }, 403);

    await ensureLeadSchema(env);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "Bad form" }, 400);

    const full_name = safeStr(form.get("full_name") || form.get("name"));
    const phone     = safeStr(form.get("phone"));
    const email     = safeStr(form.get("email"));
    const source    = safeStr(form.get("source") || "web");
    const city      = safeStr(form.get("city"));
    const street    = safeStr(form.get("street"));
    const zip       = safeStr(form.get("zip"));
    const service   = safeStr(form.get("service") || form.get("service_interested"));
    const partner   = safeStr(form.get("partner") || "main");
    const location  = safeStr(form.get("location") || "main");
    const consent   = !!form.get("consent");

    if (!full_name || !phone || !email || !source || !city || !street || !zip || !service || !consent) {
      return json({ error: "Missing required fields" }, 400);
    }

    const payload = {
      name: full_name,
      phone, email, source, city, street, zip,
      billing_email: email, score: 1, date_added: DATE_TODAY(),
      captured_by: "public", service_interested: service, partner, location
    };

    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,synced)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added
    ).run();

    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return json({ ok: true, ref });
  }

  return null;
}
