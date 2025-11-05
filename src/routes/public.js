// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";

const txt = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

function hasCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some((p) => p.toLowerCase().startsWith(name.toLowerCase() + "="));
}

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
const SW_JS = `self.addEventListener("install",e=>{self.skipWaiting()});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{ if(e.request.method!=="GET") return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))) });`;

export function mount(router) {
  // PWA
  router.add("GET", "/manifest.webmanifest", (_req, env) => new Response(JSON.stringify(manifest(env)), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  }));
  router.add("GET", "/sw.js", () => txt(SW_JS, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }));

  // Root splash only on new.vinet.co.za; otherwise show tiny HTML (no 204!)
  router.add("GET", "/", (req, env) => {
    const host = new URL(req.url).host.toLowerCase();
    if (host !== (env.PUBLIC_HOST || "new.vinet.co.za").toLowerCase()) {
      // Non-public hosts get a tiny HTML shim to avoid Safari “download”
      return html(`<!doctype html><meta charset="utf-8"/><title>Vinet</title>
<style>body{font-family:system-ui;margin:24px}</style>
<h2>Area</h2><p>This host is not the public site.</p>`);
    }
    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return html(splashHTML({ failed: !siteKey, siteKey }));
  });

  // Turnstile verify (soft gate)
  router.add("POST", "/ts-verify", async (req, env) => {
    try {
      const body = await req.json().catch(() => ({}));
      const { token, skip } = body || {};
      let ok = 0;
      if (!skip && token) {
        const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET_KEY || "",
            response: token,
            remoteip: req.headers.get("CF-Connecting-IP") || "",
          }),
        });
        const r = await vr.json().catch(() => ({ success: false }));
        ok = r.success ? 1 : 0;
      }
      const cookie = `ts_ok=${skip ? "0" : String(ok)}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return new Response(JSON.stringify({ ok: true, proceed: true }), {
        headers: { "content-type": "application/json", "set-cookie": cookie },
      });
    } catch {
      const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return new Response(JSON.stringify({ ok: true, proceed: true }), {
        headers: { "content-type": "application/json", "set-cookie": cookie },
      });
    }
  });

  // Landing after splash
  router.add("GET", "/landing", (req) => {
    const secured = hasCookie(req, "ts_ok=1");
    const seen = hasCookie(req, "ts_ok");
    return html(renderLandingHTML({ secured, seen }));
  });
}
