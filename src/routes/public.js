// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { publicLeadHTML } from "../ui/public_lead.js";

/* ---------------- tiny helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.split(/;\s*/).find(x => x.toLowerCase().startsWith(name.toLowerCase() + "="));
  return m ? decodeURIComponent(m.split("=")[1]) : "";
}
function hostnameOnly(v = "") {
  try {
    const s = String(v || "").trim();
    return s.includes("://") ? new URL(s).host.toLowerCase() : s.toLowerCase();
  } catch { return String(v || "").toLowerCase(); }
}

/* ---------------- PWA bits ---------------- */
function manifest(env) {
  const name = env?.PWA_NAME || "Vinet CRM Suite";
  const short_name = env?.PWA_SHORT || "VinetCRM";
  return {
    name, short_name, start_url: "/", display: "standalone", scope: "/",
    theme_color: "#ED1C24", background_color: "#ffffff",
    icons: [
      { src: "/favicon.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

/* ---- Service Worker (network-first for HTML; cache-first for assets) ---- */
const SW_JS = `
const VERSION = "v7";
const ASSET_CACHE = "vinet-assets-" + VERSION;

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== ASSET_CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const accept = req.headers.get("accept") || "";
  const isHTML = accept.includes("text/html") && url.origin === location.origin;

  if (isHTML) {
    event.respondWith((async () => {
      try {
        return await fetch(req, { cache: "no-store" });
      } catch {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match("/offline.html");
        return hit || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && url.origin === location.origin) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response("Network error", { status: 502 });
    }
  })());
});
`;

/* ---------------- router mount ---------------- */
export function mount(router) {
  // PWA endpoints
  router.add("GET", "/manifest.webmanifest", (_req, env) =>
    new Response(JSON.stringify(manifest(env)), {
      headers: { "content-type": "application/manifest+json; charset=utf-8" },
    })
  );
  router.add("GET", "/sw.js", () =>
    text(SW_JS, 200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    })
  );

  // Root → Splash with Turnstile
  router.add("GET", "/", (req, env) => {
    const url = new URL(req.url);
    const host = url.host.toLowerCase();
    const publicHost = hostnameOnly(env.PUBLIC_HOST || "new.vinet.co.za");

    // Convenience redirects for other subdomains
    if (host.startsWith("crm."))     return Response.redirect("/admin", 302);
    if (host.startsWith("onboard.")) return Response.redirect("/onboard", 302);

    if (publicHost && host !== publicHost) {
      return html(`<!doctype html><meta charset="utf-8"/>
<title>Vinet</title>
<style>body{font-family:system-ui;margin:24px}</style>
<h2>Area</h2><p>This host is not the public site.</p>`);
    }

    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return html(splashHTML({ failed: !siteKey, siteKey }));
  });

  // Turnstile verify (sets ts_seen + ts_ok)
  router.add("POST", "/ts-verify", async (req, env) => {
    const body = await req.json().catch(() => ({}));
    const { token, skip } = body || {};
    let ok = 0;

    if (!skip && token) {
      try {
        const form = new URLSearchParams();
        const secret = env.TURNSTILE_SECRET || env.TURNSTILE_SECRET_KEY || "";
        form.set("secret", secret);
        form.set("response", token);
        form.set("remoteip", req.headers.get("CF-Connecting-IP") || "");
        const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
        const r = await vr.json().catch(() => ({ success: false }));
        ok = r.success ? 1 : 0;
      } catch { ok = 0; }
    }

    const h = new Headers({ "content-type": "application/json; charset=utf-8" });
    // Always mark that the check was presented
    h.append("set-cookie", `ts_seen=1; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax`);
    // If solved, set ts_ok=1 else clear/zero
    const v = skip ? "0" : String(ok);
    h.append("set-cookie", `ts_ok=${v}; Path=/; Max-Age=1800; Secure; HttpOnly; SameSite=Lax`);

    return new Response(JSON.stringify({ ok: true, secured: v === "1" }), { headers: h });
  });

  // Landing page (uses cookies to show bottom ribbon)
  router.add("GET", "/landing", (req) => {
    const seen = getCookie(req, "ts_seen") === "1" || !!getCookie(req, "ts_ok");
    const secured = getCookie(req, "ts_ok") === "1";
    return html(renderLandingHTML({ secured, seen }));
  });

  // Public lead capture (mobile-friendly)
  router.add("GET", "/lead", (_req) => html(publicLeadHTML()));
}
