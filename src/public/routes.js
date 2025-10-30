// /src/public/routes.js
import { html, json, hasCookie, safeStr } from "../utils/http.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { splashHTML } from "../ui/splash.js";
import { renderLandingHTML } from "../ui/landing.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

function hdrSet(c){ return { "set-cookie": c }; }

export async function handlePublic(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Splash
  if (request.method === "GET" && (pathname === "/" || pathname === "/index" || pathname === "/index.html")) {
    return html(splashHTML(env.TURNSTILE_SITE_KEY || "dummy"));
  }

  // Turnstile verify
  if (request.method === "POST" && pathname === "/ts-verify") {
    let token = null; try { ({ token } = await request.json()); } catch {}
    if (!token) return json({ ok:false, error:"missing token" }, 400);

    const missing = !env.TURNSTILE_SECRET_KEY || (env.TURNSTILE_SITE_KEY||"dummy")==="dummy";
    const fail = token === "TURNSTILE-NOT-AVAILABLE" || missing;

    if (fail) {
      // mark fail, do NOT set ts_ok; still allow landing
      return json(
        { ok:false, status:"fail" },
        200,
        hdrSet("ts_status=fail; Max-Age=86400; Path=/; Secure; SameSite=Lax")
      );
    }

    try {
      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || ""
        })
      });
      const r = await vr.json().catch(() => ({ success: false }));
      if (!r.success) {
        return json(
          { ok:false, status:"fail" },
          200,
          hdrSet("ts_status=fail; Max-Age=86400; Path=/; Secure; SameSite=Lax")
        );
      }
      // success
      return json(
        { ok:true, status:"ok" },
        200,
        hdrSet([
          "ts_status=ok; Max-Age=86400; Path=/; Secure; SameSite=Lax",
          "ts_ok=1; Max-Age=86400; Path=/; Secure; SameSite=Lax"
        ].join(", "))
      );
    } catch {
      return json(
        { ok:false, status:"fail" },
        200,
        hdrSet("ts_status=fail; Max-Age=86400; Path=/; Secure; SameSite=Lax")
      );
    }
  }

  // Landing — always accessible; shows banner if failed
  if (request.method === "GET" && pathname === "/landing") {
    const cookies = (request.headers.get("cookie") || "");
    const status = /ts_status=ok/.test(cookies) ? "ok" : (/ts_status=fail/.test(cookies) ? "fail" : "unknown");
    return html(renderLandingHTML(status));
  }

  // Lead page — allow open even if Turnstile failed; submission remains protected
  if (request.method === "GET" && pathname === "/lead") {
    return html(renderPublicLeadHTML());
  }

  // Submit — still requires successful Turnstile (ts_ok)
  if (request.method === "POST" && pathname === "/submit") {
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
    const consent   = String(form.get("consent") || "") !== "";

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

    const ref = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
    return json({ ok: true, ref });
  }

  return null;
}
