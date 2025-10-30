// Public host (new.*): splash -> Turnstile -> landing -> /lead form + submit
import { html, json, hasCookie } from "../utils/http.js";
import { ensureLeadSchema } from "../db/schema.js";
import { renderSplashHTML } from "../ui/splash.js";
import { renderLandingHTML } from "../ui/landing.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";

function isNewHost(req) {
  const h = new URL(req.url).hostname;
  return /^new\./i.test(h);
}

export async function handlePublic(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Only own these routes on new.vinet.co.za
  if (!isNewHost(request)) return null;

  // 1) Splash page
  if (request.method === "GET" && (pathname === "/" || pathname === "/index" || pathname === "/index.html")) {
    const failed = url.searchParams.get("ts") === "fail";
    return html(renderSplashHTML({ failed, siteKey: env.TURNSTILE_SITE_KEY || "" }));
  }

  // 2) Turnstile verify (POST)
  if (request.method === "POST" && pathname === "/ts-verify") {
    try {
      const { token } = await request.json().catch(() => ({}));
      if (!token) return json({ ok: false, error: "missing token" }, 400);

      const secret = env.TURNSTILE_SECRET_KEY || "";
      let ok = false;

      if (secret && token !== "skip") {
        const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: new URLSearchParams({
            secret,
            response: token,
            remoteip: request.headers.get("CF-Connecting-IP") || ""
          }),
        });
        const res = await vr.json().catch(() => ({ success: false }));
        ok = !!res.success;
      }

      // Cookie notes:
      // ts_ok=1 -> secured; ts_ok=0 -> not secured but allowed.
      const val = ok ? "1" : "0";
      const cookie = `ts_ok=${val}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return json({ ok, proceed: true }, 200, { "set-cookie": cookie });
    } catch {
      const cookie = `ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return json({ ok: false, proceed: true }, 200, { "set-cookie": cookie });
    }
  }

  // 3) Landing (after splash)
  if (request.method === "GET" && pathname === "/landing") {
    const secured = hasCookie(request, "ts_ok", "1");
    const seen    = hasCookie(request, "ts_ok"); // either 0 or 1
    return html(renderLandingHTML({ secured, seen }));
  }

  // 4) Lead form & submit
  if (request.method === "GET" && pathname === "/lead") {
    return html(renderPublicLeadHTML());
  }

  if (request.method === "POST" && pathname === "/submit") {
    await ensureLeadSchema(env);

    const form = await request.json().catch(() => null);
    if (!form) return json({ error: "Bad payload" }, 400);

    const safe = (v) => String(v ?? "").trim();
    const normalizeMsisdn = (p) => {
      const d = ("" + p).replace(/\D+/g, "");
      if (d.startsWith("0")) return "27" + d.slice(1);
      if (d.startsWith("27")) return d;
      return d;
    };

    const payload = {
      name: safe(form.name),
      phone: normalizeMsisdn(form.phone),
      email: safe(form.email),
      source: safe(form.source || "web"),
      city: safe(form.city),
      street: safe(form.street),
      zip: safe(form.zip),
      billing_email: safe(form.email),
      score: 1,
      date_added: DATE_TODAY(),
      captured_by: "public",
      service_interested: safe(form.service || form.service_interested || ""),
      partner: safe(form.partner || "main"),
      location: safe(form.location || "main"),
      notes: safe(form.notes || ""),
      lat: form.lat ?? null,
      lng: form.lng ?? null,
    };

    if (!payload.name || !payload.phone || !payload.email) {
      return json({ error: "Missing name/phone/email" }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,service_interested,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',?10,?11)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added, payload.service_interested, nowSec()
    ).run();

    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    return json({ ok: true, ref });
  }

  // 5) Minimal service worker and manifest for the landing splash
  if (request.method === "GET" && pathname === "/sw.js") {
    return new Response(
      `self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>self.clients.claim());`,
      { headers: { "content-type": "application/javascript" } }
    );
  }

  if (request.method === "GET" && pathname === "/manifest.webmanifest") {
    return json({
      name: "Vinet – Get Connected",
      short_name: "Vinet",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ED1C24",
      icons: []
    });
  }

  return null;
}
