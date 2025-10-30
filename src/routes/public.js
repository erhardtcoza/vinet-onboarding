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

// Small helper to derive Surname (last token) from full name
function surnameFrom(fullName) {
  const s = String(fullName || "").trim();
  if (!s) return null;
  const parts = s.split(/\s+/);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}

// Build EFT reference: "ID-SURNAME" if possible, else "ID"
function composeEFTRef(id, fullname) {
  const idStr = String(id || "").trim();
  if (!idStr) return "";
  const sn = surnameFrom(fullname);
  return sn ? `${idStr}-${sn}` : idStr;
}

// Simple inlined manifest for PWA
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

// Inlined service worker for basic shell caching
const SW_JS = `
// very small SW: cache-first for HTML shell + assets
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open("vinet-crm-v1").then((c) =>
      c.addAll([
        "/",
        "/lead",
        "/crm",
      ].filter(Boolean))
    )
  );
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // simple strategy: try cache, then network
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
`;

export function mount(router) {
  // Root is the Admin landing (kept as-is, gated by ASN/IP)
  router.add("GET", "/", async (req, env) => {
    if (!ipAllowed(req)) {
      return html(
        `<main style="font-family:system-ui;padding:2rem;text-align:center">
           <h1>Restricted</h1><p>This area is limited to Vinet admin network.</p>
         </main>`,
        403
      );
    }
    // Your existing admin index page is served elsewhere (e.g., src/ui/admin.js in admin routes)
    return new Response(null, { status: 204 }); // pass-through (admin.js handles GET /)
  });

  // --- PWA endpoints ---
  router.add("GET", "/manifest.webmanifest", (_req, env) =>
    jsonResp(manifest(env))
  );

  router.add("GET", "/sw.js", () =>
    new Response(SW_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } })
  );

  // --- EFT info page with updated reference logic ---
  // Expected query: ?type=customer|lead&id=1234  (we try both if type missing)
  router.add("GET", "/info/eft", async (req, env) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const type = (url.searchParams.get("type") || "").toLowerCase(); // "customer"|"lead"|"" (unknown)
    if (!id) {
      return html(`<main style="font-family:system-ui;padding:2rem">
        <h1>EFT Details</h1>
        <p>Missing id parameter.</p></main>`, 400);
    }

    // Try to fetch name (surname) for ID-SURNAME ref
    let fullName = null;

    try {
      // Lookup order: explicit type → fallback to customer → lead
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
        fullName = await tryCustomer();
        if (!fullName) fullName = await tryLead();
      } else if (type === "lead") {
        fullName = await tryLead();
        if (!fullName) fullName = await tryCustomer();
      } else {
        // unknown → try both
        fullName = (await tryCustomer()) || (await tryLead());
      }
    } catch (_e) {
      // Ignore lookup failures → fallback later
      fullName = null;
    }

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
    body{margin:0;background:var(--bg);font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;color:var(--ink)}
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
