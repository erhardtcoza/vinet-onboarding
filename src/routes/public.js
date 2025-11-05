// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

/* ---------------- small helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

function hasCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some(p => p.toLowerCase().startsWith(`${name.toLowerCase()}=`));
}
function hostnameOnly(v = "") {
  try {
    const s = String(v || "").trim();
    return s ? (s.includes("://") ? new URL(s).host.toLowerCase() : s.toLowerCase()) : "";
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
const SW_JS =
`self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});`;

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

  // Root: host-aware behaviour
  router.add("GET", "/", (req, env) => {
    const host = new URL(req.url).host.toLowerCase();
    const publicHost = hostnameOnly(env.PUBLIC_HOST || "new.vinet.co.za");

    // convenience redirects for other subdomains
    if (host.startsWith("crm."))     return Response.redirect("/admin", 302);
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

    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return html(splashHTML({ failed: !siteKey, siteKey }));
  });

  // Turnstile verify (soft gate — always allows proceed)
  router.add("POST", "/ts-verify", async (req, env) => {
    const body = await req.json().catch(() => ({}));
    const { token, skip } = body || {};
    let ok = 0;

    if (!skip && token) {
      try {
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
      } catch { ok = 0; }
    }

    const cookie = `ts_ok=${skip ? "0" : String(ok)}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
    return new Response(JSON.stringify({ ok: true, proceed: true }), {
      headers: { "content-type": "application/json; charset=utf-8", "set-cookie": cookie },
    });
  });

  // Landing page after splash
  router.add("GET", "/landing", (req) => {
    const secured = hasCookie(req, "ts_ok=1");
    const seen = hasCookie(req, "ts_ok");
    return html(renderLandingHTML({ secured, seen }));
  });

  // Public lead form
  router.add("GET", "/lead", (req) => {
    const secured = hasCookie(req, "ts_ok=1");
    return html(renderPublicLeadHTML({ secured }));
  });
}
