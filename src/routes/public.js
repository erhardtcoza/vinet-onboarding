// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

/* -------------------- helper responses -------------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

function hasCookie(req, needle) {
  const c = req.headers.get("cookie") || "";
  return c.includes(needle);
}

/* -------------------- main mount -------------------- */
export function mount(router) {
  /* ---------  splash / landing  --------- */
  router.add("GET", "/", async (req, env) => {
    // default splash / redirect
    if (!hasCookie(req, "visited")) {
      return html(await splashHTML(env));
    }
    return html(await renderLandingHTML(env));
  });

  /* ---------  splash confirm  --------- */
  router.add("POST", "/api/visited", async (_req, _env) => {
    const headers = new Headers({
      "Set-Cookie": "visited=1; path=/; max-age=86400",
      "content-type": "application/json",
    });
    return new Response(JSON.stringify({ ok: true }), { headers });
  });

  /* ---------  lead form  --------- */
  router.add("GET", "/lead", async (_req, env) => html(await renderPublicLeadHTML(env)));

  router.add("POST", "/api/public/lead", async (req, env) => {
    try {
      const payload = await req.json();
      const required = ["full_name", "email", "phone"];
      for (const k of required) {
        if (!payload[k]) return json({ ok: false, error: `Missing ${k}` }, 400);
      }

      // insert into leads_queue
      const now = Math.floor(Date.now() / 1000);
      const res = await env.DB.prepare(
        `INSERT INTO leads_queue (sales_user, created_at, payload, uploaded_files)
         VALUES (?, ?, ?, ?)`
      )
        .bind(payload.sales_user || "public", now, JSON.stringify(payload), "")
        .run();

      const queueId = res.meta.last_row_id;
      return json({ ok: true, ref: queueId });
    } catch (e) {
      return json({ ok: false, error: e.message || "invalid JSON" }, 500);
    }
  });

  /* ---------  fallback --------- */
  router.add("GET", "/favicon.ico", () => new Response(null, { status: 204 }));
  router.add("GET", "/robots.txt", () => text("User-agent: *\nAllow: /"));
}
