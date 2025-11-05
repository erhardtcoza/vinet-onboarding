// /src/routes/public.js
import { json } from "../utils/http.js";
import { ipAllowed } from "../branding.js";
import { splynxGET } from "../utils/splynx.js";
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";

function text(content, status = 200, headers = {}) {
  return new Response(content, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
}
function html(content, status = 200, headers = {}) {
  return new Response(content, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}
function jsonResp(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function hasCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  return c.split(/;\s*/).some((p) => p.toLowerCase().startsWith(name.toLowerCase() + "="));
}

/* ---------------- PWA ---------------- */
function manifest(env) {
  const name = env?.PWA_NAME || "Vinet CRM Suite";
  const short_name = env?.PWA_SHORT || "VinetCRM";
  const theme_color = "#ED1C24";
  const background_color = "#ffffff";
  return {
    name,
    short_name,
    start_url: "/",
    display: "standalone",
    scope: "/",
    theme_color,
    background_color,
    icons: [
      { src: "/favicon.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
const SW_JS = `self.addEventListener("install",e=>{self.skipWaiting()});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{ if(e.request.method!=="GET") return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))) });`;

/* ------------- EFT helpers ------------- */
function surnameFrom(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const parts = s.split(/\s+/);
  return parts.length ? parts[parts.length - 1] : null;
}
function composeEFTRef(id, fullname) {
  const idStr = String(id || "").trim();
  if (!idStr) return "";
  const sn = surnameFrom(fullname);
  return sn ? `${idStr}-${sn}` : idStr;
}

/* ---------------- ROUTES ---------------- */
export function mount(router) {
  // --- PWA endpoints ---
  router.add("GET", "/manifest.webmanifest", (_req, env) => jsonResp(manifest(env)));
  router.add("GET", "/sw.js", () =>
    text(SW_JS, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" })
  );

  // --- Splash (Turnstile) on root ---
  router.add("GET", "/", (req, env) => {
    const host = new URL(req.url).host;
    const publicHost = (env?.PUBLIC_HOST || "").toLowerCase();

    // If this isn't the public hostname, fall back to admin area gating
    if (publicHost && host.toLowerCase() !== publicHost) {
      if (!ipAllowed(req)) {
        return html(
          `<main style="font-family:system-ui;padding:2rem;text-align:center">
             <h1>Restricted</h1><p>This area is limited to Vinet admin network.</p>
           </main>`,
          403
        );
      }
      return new Response(null, { status: 204 }); // let admin router handle /admin, etc.
    }

    const siteKey = env.TURNSTILE_SITE_KEY || ""; // if empty, UI will show soft-fail but allow continue
    return html(splashHTML({ failed: !siteKey, siteKey }));
  });

  // --- Turnstile verify -> set cookie; always allow proceed (soft gate) ---
  router.add("POST", "/ts-verify", async (req, env) => {
    try {
      const body = await req.json().catch(() => ({}));
      const { token, skip } = body || {};

      // Explicit skip
      if (skip) {
        const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
        return jsonResp({ ok: true, skipped: true, proceed: true }, 200, { "set-cookie": cookie });
      }

      if (!token) {
        const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
        return jsonResp({ ok: true, success: false, proceed: true }, 200, { "set-cookie": cookie });
      }

      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY || "",
          response: token,
          remoteip: req.headers.get("CF-Connecting-IP") || "",
        }),
      });
      const result = await vr.json().catch(() => ({ success: false }));
      const cookie = `ts_ok=${result.success ? "1" : "0"}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return jsonResp({ ok: true, success: !!result.success, proceed: true }, 200, { "set-cookie": cookie });
    } catch {
      const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return jsonResp({ ok: true, success: false, proceed: true }, 200, { "set-cookie": cookie });
    }
  });

  // --- Landing after splash ---
  router.add("GET", "/landing", (req) => {
    const secured = hasCookie(req, "ts_ok=1");
    const seen = hasCookie(req, "ts_ok"); // any value means we went through splash
    return html(renderLandingHTML({ secured, seen }));
  });

  // EFT info page
  router.add("GET", "/info/eft", async (req, env) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const type = (url.searchParams.get("type") || "").toLowerCase();
    if (!id) {
      return html(`<main style="font-family:system-ui;padding:2rem">
        <h1>EFT Details</h1>
        <p>Missing id parameter.</p></main>`, 400);
    }

    let fullName = null;
    try {
      const tryCustomer = async () => {
        const r = await splynxGET(env, `/admin/customers/customer/${id}`);
        if (r && r.name) return r.name;
        const r2 = await splynxGET(env, `/admin/customers/${id}`);
        return r2?.name || null;
      };
      const tryLead = async () => {
        const r = await splynxGET(env, `/admin/crm/leads/${id}`);
        return r?.name || null;
      };
      if (type === "customer") fullName = (await tryCustomer()) || (await tryLead());
      else if (type === "lead") fullName = (await tryLead()) || (await tryCustomer());
      else fullName = (await tryCustomer()) || (await tryLead());
    } catch { fullName = null; }

    const eftRef = composeEFTRef(id, fullName);
    const bankName = env?.BANK_NAME || "Vinet Internet Solutions";
    const accName  = env?.BANK_ACCOUNT_NAME || "Vinet Internet Solutions";
    const accNo    = env?.BANK_ACCOUNT_NUMBER || "0000000000";
    const branch   = env?.BANK_BRANCH || "000000";
    const bank     = env?.BANK || "Your Bank";
    const logo     = env?.LOGO_URL || "https://static.vinet.co.za/logo.jpeg";

    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EFT Details</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ED1C24"/>
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
<style>
  :root { --red:#ED1C24; --ink:#0b1320; --muted:#6b7280; --card:#fff; --bg:#f7f7f8; }
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}
  .card{max-width:720px;margin:2rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.5rem 1.25rem}
  .head{display:flex;gap:.75rem;align-items:center;margin-bottom:1rem}
  .head img{width:40px;height:40px;border-radius:8px}
  h1{margin:.25rem 0 0;font-size:1.25rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  .row{display:flex;justify-content:space-between;padding:.75rem;border:1px solid #e5e7eb;border-radius:10px}
  .k{color:var(--muted)} .ref{font-weight:700;color:var(--red)}
</style></head><body>
<main class="card">
  <div class="head"><img src="${logo}" alt="Vinet"/><div><h1>EFT Details</h1>
  <div class="k">Use the reference exactly as shown</div></div></div>
  <section class="grid" style="margin-bottom:1rem">
    <div class="row"><span class="k">Bank</span><span>${bank}</span></div>
    <div class="row"><span class="k">Branch</span><span>${branch}</span></div>
    <div class="row"><span class="k">Account name</span><span>${accName}</span></div>
    <div class="row"><span class="k">Account number</span><span>${accNo}</span></div>
    <div class="row" style="grid-column:1 / -1">
      <span class="k">Payment reference</span><span class="ref">${eftRef}</span>
    </div>
  </section>
  <div class="k">Beneficiary: ${bankName}</div>
</main></body></html>`;
    return html(page);
  });
}
