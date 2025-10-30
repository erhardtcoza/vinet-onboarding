// /src/routes/public.js
import { json } from "../utils/http.js";
import { ipAllowed } from "../branding.js";
import { splynxGET } from "../utils/splynx.js"; // present in your repo

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

// ---------- Helpers ----------
function surnameFrom(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const parts = s.split(/\s+/);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}
function composeEFTRef(id, fullname) {
  const idStr = String(id || "").trim();
  if (!idStr) return "";
  const sn = surnameFrom(fullname);
  return sn ? `${idStr}-${sn}` : idStr;
}

// ---------- PWA ----------
function manifest(env) {
  const name = env?.PWA_NAME || "Vinet CRM Suite";
  const short_name = env?.PWA_SHORT || "VinetCRM";
  const theme_color = "#ED1C24"; // Vinet red
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
const SW_JS = `
// cache-first shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open("vinet-crm-v1").then((c) =>
      c.addAll(["/","/lead","/crm"].filter(Boolean))
    )
  );
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
`;

// ---------- Landing (public) ----------
function landingHTML(env) {
  const logo = env?.LOGO_URL || "https://static.vinet.co.za/logo.jpeg";
  const splynxURL = "https://splynx.vinet.co.za";
  return /*html*/`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Get Connected · Vinet</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#ED1C24"/>
  <script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
  <style>
    :root{
      --red:#ED1C24; --ink:#0b1320; --muted:#6b7280;
      --bg:#f5f6f8; --card:#fff; --ring:#e5e7eb;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink)}
    .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:2rem}
    .card{width:100%;max-width:720px;background:var(--card);border-radius:20px;box-shadow:0 8px 30px #0002;padding:1.25rem}
    .hero{display:flex;flex-direction:column;align-items:center;padding:1.25rem 1rem 0}
    .logo{width:84px;height:84px;border-radius:14px;object-fit:cover;box-shadow:0 2px 10px #0001}
    h1{margin:.75rem 0 0;font-size:2rem;letter-spacing:.2px}
    .sub{color:var(--muted);margin:.25rem 0 1.25rem}
    .loading{width:100%;height:6px;background:#f1f5f9;border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px #eef2f5}
    .bar{height:100%;width:0;background:var(--red);border-radius:inherit;transition:width .8s ease}
    .content{display:none; padding:1.25rem 0 1rem}
    .big{font-weight:800;font-size:1.8rem;text-align:center;margin:.25rem 0 1rem}
    .ctas{display:grid;grid-template-columns:1fr;gap:.75rem;max-width:520px;margin:0 auto}
    .btn{display:block;text-align:center;padding:1rem 1.25rem;border-radius:14px;font-weight:700;text-decoration:none}
    .btn-primary{background:var(--red);color:#fff}
    .btn-secondary{background:#111;color:#fff}
    .small{font-size:.85rem;opacity:.92}
    footer{padding:.25rem 1rem 1rem;text-align:center;color:var(--muted)}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <div class="hero">
        <img class="logo" src="${logo}" alt="Vinet"/>
        <div class="loading" aria-label="Loading">
          <div class="bar" id="bar"></div>
        </div>
      </div>

      <div class="content" id="content">
        <div style="display:flex;align-items:center;justify-content:center;gap:.75rem;margin-top:.25rem">
          <img class="logo" src="${logo}" alt="Vinet" style="width:52px;height:52px"/>
          <div style="font-weight:700">Vinet Internet Solutions</div>
        </div>
        <div class="big">Get Connected</div>

        <div class="ctas">
          <a class="btn btn-primary" href="/lead">I want to know more <span class="small">(or sign-up)</span></a>
          <a class="btn btn-secondary" href="${splynxURL}" target="_blank" rel="noopener">I am already Connected <span class="small">(let’s login)</span></a>
        </div>
      </div>

      <footer>Support: 021 007 0200</footer>
    </section>
  </main>

  <script>
    // quick splash animation, then show content
    const bar = document.getElementById('bar');
    const content = document.getElementById('content');
    requestAnimationFrame(()=>{ bar.style.width = '85%'; });
    setTimeout(()=>{ bar.style.width = '100%'; }, 500);
    setTimeout(()=>{ content.style.display = 'block'; }, 800);
  </script>
</body>
</html>`;
}

// ---------- Routes ----------
export function mount(router) {
  // Root:
  // - If Host matches env.PUBLIC_HOST (e.g. new.vinet.co.za) -> public landing
  // - Else -> admin landing (ASN/IP restricted; admin.js renders page)
  router.add("GET", "/", async (req, env) => {
    const host = new URL(req.url).host;
    const publicHost = (env?.PUBLIC_HOST || "").toLowerCase();
    if (publicHost && host.toLowerCase() === publicHost) {
      return html(landingHTML(env));
    }
    if (!ipAllowed(req)) {
      return html(
        `<main style="font-family:system-ui;padding:2rem;text-align:center">
           <h1>Restricted</h1><p>This area is limited to Vinet admin network.</p>
         </main>`,
        403
      );
    }
    // Hand off to admin routes (existing behaviour)
    return new Response(null, { status: 204 });
  });

  // --- PWA endpoints ---
  router.add("GET", "/manifest.webmanifest", (_req, env) =>
    jsonResp(manifest(env))
  );
  router.add("GET", "/sw.js", () =>
    new Response(SW_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } })
  );

  // --- EFT info page with updated reference logic ---
  // Expected query: ?type=customer|lead&id=1234
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

      if (type === "customer") {
        fullName = await tryCustomer() || await tryLead();
      } else if (type === "lead") {
        fullName = await tryLead() || await tryCustomer();
      } else {
        fullName = (await tryCustomer()) || (await tryLead());
      }
    } catch(_e) { fullName = null; }

    const eftRef = composeEFTRef(id, fullName);

    const bankName = env?.BANK_NAME || "Vinet Internet Solutions";
    const accName  = env?.BANK_ACCOUNT_NAME || "Vinet Internet Solutions";
    const accNo    = env?.BANK_ACCOUNT_NUMBER || "0000000000";
    const branch   = env?.BANK_BRANCH || "000000";
    const bank     = env?.BANK || "Your Bank";
    const logo     = env?.LOGO_URL || "https://static.vinet.co.za/logo.jpeg";

    const page = /*html*/`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
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
    .k{color:var(--muted)}
    .ref{font-weight:700;color:var(--red)}
  </style>
</head>
<body>
  <main class="card">
    <div class="head">
      <img src="${logo}" alt="Vinet"/>
      <div>
        <h1>EFT Details</h1>
        <div class="k">Use the reference exactly as shown</div>
      </div>
    </div>
    <section class="grid" style="margin-bottom:1rem">
      <div class="row"><span class="k">Bank</span><span>${bank}</span></div>
      <div class="row"><span class="k">Branch</span><span>${branch}</span></div>
      <div class="row"><span class="k">Account name</span><span>${accName}</span></div>
      <div class="row"><span class="k">Account number</span><span>${accNo}</span></div>
      <div class="row" style="grid-column:1 / -1">
        <span class="k">Payment reference</span>
        <span class="ref">${eftRef}</span>
      </div>
    </section>
    <div class="k">Beneficiary: ${bankName}</div>
  </main>
</body>
</html>`;
    return html(page);
  });
}
