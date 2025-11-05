// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

/* ---------------- small helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

function hasCookie(req, needle) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some((p) => p.toLowerCase().startsWith(needle.toLowerCase()));
}
function hostnameOnly(v = "") {
  try {
    const s = String(v || "").trim();
    return s ? (s.includes("://") ? new URL(s).host.toLowerCase() : s.toLowerCase()) : "";
  } catch {
    return String(v || "").toLowerCase();
  }
}
const shortId = () => Math.random().toString(36).slice(2, 8);

/* ---------------- PWA bits ---------------- */
function manifest(env) {
  const name = env?.PWA_NAME || "Vinet CRM Suite";
  const short_name = env?.PWA_SHORT || "VinetCRM";
  return {
    name,
    short_name,
    start_url: "/",
    display: "standalone",
    scope: "/",
    theme_color: "#ED1C24",
    background_color: "#ffffff",
    icons: [
      { src: "/favicon.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
const SW_JS = `self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});`;

/* ---------------- router mount ---------------- */
export function mount(router) {
  // PWA
  router.add("GET", "/manifest.webmanifest", (_req, env) =>
    new Response(JSON.stringify(manifest(env)), {
      headers: { "content-type": "application/manifest+json; charset=utf-8" },
    }),
  );
  router.add("GET", "/sw.js", () =>
    text(SW_JS, 200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    }),
  );

  // Root: host-aware behaviour
  router.add("GET", "/", (req, env) => {
    const host = new URL(req.url).host.toLowerCase();
    const publicHost = hostnameOnly(env.PUBLIC_HOST || "new.vinet.co.za");

    if (host.startsWith("crm.")) return Response.redirect("/admin", 302);
    if (host.startsWith("onboard.")) return Response.redirect("/onboard", 302);

    // Only the public host shows splash/turnstile
    if (publicHost && host !== publicHost) {
      return html(`<!doctype html><meta charset="utf-8"/>
<title>Vinet Onboarding</title>
<style>body{font-family:system-ui;margin:24px} .card{max-width:860px;margin:auto;padding:20px;border-radius:18px;box-shadow:0 10px 36px #0002}</style>
<div class="card">
  <img src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet" style="max-width:220px;display:block;margin:6px 0 12px 0"/>
  <hr style="border:0;height:6px;background:#ED1C24;border-radius:999px"/>
  <h1>Vinet Onboarding</h1>
  <p>Use the correct host:</p>
  <ul>
    <li><strong><a href="https://new.vinet.co.za">new.vinet.co.za</a></strong> — self sign up</li>
    <li><strong><a href="https://crm.vinet.co.za">crm.vinet.co.za</a></strong> — CRM intake dashboard</li>
    <li><strong><a href="https://onboard.vinet.co.za">onboard.vinet.co.za</a></strong> — Onboarding links/admin</li>
  </ul>
</div>`);
    }

    const siteKey = env?.TURNSTILE_SITE_KEY || "";
    const already = hasCookie(req, "vsplashed=");
    if (!already && siteKey) {
      return html(splashHTML({ siteKey }), 200, {
        "cache-control": "no-store",
        "set-cookie": `splashid=${shortId()}; Path=/; HttpOnly; SameSite=Lax`,
      });
    }
    return html(renderLandingHTML(), 200, { "cache-control": "no-store" });
  });

  /* ---------------- splash verify ---------------- */
  router.add("POST", "/splash/verify", async (req, env) => {
    try {
      const siteKey = env?.TURNSTILE_SITE_KEY || "";
      const secret = env?.TURNSTILE_SECRET || "";
      if (!siteKey || !secret) {
        // If Turnstile not configured, just set the cookie and proceed.
        return text("ok", 200, { "set-cookie": `vsplashed=1; Path=/; Max-Age=86400; SameSite=Lax` });
      }

      const body = await req.json().catch(() => ({}));
      const token = body?.token || "";
      if (!token) return json({ ok: false, error: "missing_token" }, 400);

      const ip = req.headers.get("CF-Connecting-IP") || "";
      const form = new FormData();
      form.append("secret", secret);
      form.append("response", token);
      if (ip) form.append("remoteip", ip);

      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      const v = await r.json().catch(() => ({}));
      if (!v?.success) return json({ ok: false, error: "verify_failed" }, 403);

      return json({ ok: true }, 200, { "set-cookie": `vsplashed=1; Path=/; Max-Age=86400; SameSite=Lax` });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  });

  /* ---------------- public lead form ---------------- */
  router.add("GET", "/lead", (_req, _env) => {
    return html(renderPublicLeadHTML(), 200, { "cache-control": "no-store" });
  });

  /* ---------------- ensure table helper ---------------- */
  async function ensureLeadQueue(env) {
    await env.DB.exec?.(`CREATE TABLE IF NOT EXISTS leads_queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    );`);
  }

  /* ---------------- submit lead -> leads_queue ---------------- */
  router.add("POST", "/lead/submit", async (req, env) => {
    try {
      await ensureLeadQueue(env);

      const ct = (req.headers.get("content-type") || "").toLowerCase();
      const body = ct.includes("application/json") ? await req.json() : Object.fromEntries(await req.formData());
      const now = Date.now();

      // Minimal validation
      const name = String(body?.name ?? "").trim();
      const phone = String(body?.phone ?? "").trim();
      const email = String(body?.email ?? "").trim();
      if (!name && !phone && !email) return json({ ok: false, error: "missing_contact" }, 400);

      const meta = {
        id: shortId(),
        ip: req.headers.get("CF-Connecting-IP") || undefined,
        ua: req.headers.get("user-agent") || undefined,
        host: new URL(req.url).host,
        ts: now,
      };

      const payload = { ...body, _meta: meta };
      const insert = await env.DB
        .prepare(`INSERT INTO leads_queue (created_at, payload, status) VALUES (?1, ?2, 'pending')`)
        .bind(now, JSON.stringify(payload))
        .run();

      return json({ ok: true, queue_id: insert.lastRowId ?? null, meta }, 201, {
        "cache-control": "no-store",
      });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  });

  /* ---------------- misc ---------------- */
  router.add("GET", "/health", () => json({ ok: true, ts: Date.now() }));
}
