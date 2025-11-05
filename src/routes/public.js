// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";

/* ------------ helpers ------------ */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

const cookieHas = (req, nameEqVal) => {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some(p => p.trim().toLowerCase() === nameEqVal.toLowerCase());
};
const hostOf = (req) => new URL(req.url).host.toLowerCase();

/* ------------ PWA (only for public host) ------------ */
function manifest(env) {
  const name = env?.PWA_NAME || "Vinet";
  const short_name = env?.PWA_SHORT || "Vinet";
  return {
    name, short_name, start_url: "/", display: "standalone", scope: "/",
    theme_color: "#ED1C24", background_color: "#ffffff",
    icons: [{ src: "/favicon.png", sizes: "192x192", type: "image/png" },
            { src: "/favicon.png", sizes: "512x512", type: "image/png" }],
  };
}
const SW_JS = `
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});`;

/* ------------ host gates ------------ */
function isPublicHost(req, env) {
  const want = String(env.PUBLIC_HOST || "new.vinet.co.za").toLowerCase();
  return hostOf(req) === want;
}

/* ------------ mount ------------ */
export function mount(router) {
  // PWA bits
  router.add("GET", "/manifest.webmanifest", (req, env) =>
    isPublicHost(req, env)
      ? json(manifest(env))
      : text("Not public host", 404)
  );
  router.add("GET", "/sw.js", (req, env) =>
    isPublicHost(req, env)
      ? text(SW_JS, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" })
      : text("Not public host", 404)
  );

  // Root:
  // - public host -> splash (Turnstile)
  // - crm./onboard. -> send to /admin and /onboard respectively (no splash)
  router.add("GET", "/", (req, env) => {
    const h = hostOf(req);
    if (h.startsWith("crm."))      return Response.redirect("/admin", 302);
    if (h.startsWith("onboard."))  return Response.redirect("/onboard", 302);
    if (!isPublicHost(req, env))   return html(hostInfoCard());
    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return html(splashHTML({ failed: !siteKey, siteKey }));
  });

  // Turnstile verify (soft gate; never blocks)
  router.add("POST", "/ts-verify", async (req, env) => {
    if (!isPublicHost(req, env)) return json({ ok: true }); // ignore on non-public hosts

    const { token, skip } = await req.json().catch(() => ({}));
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
    return json({ ok: true, proceed: true }, 200, { "set-cookie": cookie });
  });

  // Landing (public host only)
  router.add("GET", "/landing", (req, env) => {
    if (!isPublicHost(req, env)) return html(hostInfoCard(), 404);
    const secured = cookieHas(req, "ts_ok=1");
    const seen    = cookieHas(req, "ts_ok=0") || secured;
    return html(renderLandingHTML({ secured, seen }));
  });
}

/* ------------ small host card ------------ */
function hostInfoCard() {
  return `<!doctype html><meta charset="utf-8"/>
<title>Vinet Onboarding</title>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--bg:#f7f7f8;--card:#fff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:system-ui}
  main{max-width:860px;margin:8vh auto;padding:16px}
  .card{background:var(--card);border-radius:20px;box-shadow:0 12px 36px #0002;padding:22px}
  h1{margin:6px 0 12px} .logo{height:42px}
  ul{line-height:1.9}
  a{color:#111;text-decoration:none;font-weight:700}
  a:hover{color:var(--red)}
</style>
<main>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
    <hr style="border:0;height:6px;background:var(--red);border-radius:999px;margin:10px 0 16px"/>
    <h1>Vinet Onboarding</h1>
    <p>Use the correct host:</p>
    <ul>
      <li><a href="https://new.vinet.co.za/">new.vinet.co.za</a> — self sign up</li>
      <li><a href="https://crm.vinet.co.za/admin">crm.vinet.co.za</a> — CRM intake dashboard</li>
      <li><a href="https://onboard.vinet.co.za/">onboard.vinet.co.za</a> — Onboarding links/admin</li>
    </ul>
  </div>
</main>`;
}
