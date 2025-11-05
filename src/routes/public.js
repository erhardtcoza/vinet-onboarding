// /src/routes/public.js
import { json as J } from "../utils/db.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";  // self-signup page
import { renderLandingHTML } from "../ui/landing.js";        // keep for /landing if you still want it

const html = (c, s=200) => new Response(c, { status:s, headers:{ "content-type":"text/html; charset=utf-8" } });

/** Public site:
 *  - Root (/) shows the self-signup page (per your latest requirement)
 *  - /landing keeps the old landing, if linked elsewhere
 *  - PWA manifest + service worker
 */
export function mount(router) {
  // PWA
  router.add("GET", "/manifest.webmanifest", () => new Response(JSON.stringify({
    name: "Vinet CRM Suite",
    short_name: "VinetCRM",
    start_url: "/",
    display: "standalone",
    theme_color: "#ED1C24",
    background_color: "#ffffff",
    icons: [{ src: "/favicon.png", sizes: "192x192", type: "image/png" }, { src: "/favicon.png", sizes: "512x512", type: "image/png" }]
  }), { headers: { "content-type": "application/manifest+json" } }));

  router.add("GET", "/sw.js", () => new Response(
    `self.addEventListener("install",e=>self.skipWaiting());
     self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
     self.addEventListener("fetch",e=>{ if(e.request.method!=="GET") return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))) });`,
    { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }
  ));

  // New requirement: show the Self-Sign-Up page at root
  router.add("GET", "/", () => html(renderPublicLeadHTML()));

  // Keep old landing (if anything links to it)
  router.add("GET", "/landing", () => html(renderLandingHTML({ secured:true, seen:true })));
}
