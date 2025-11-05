// /src/routes/public.js
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML as splashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

/* ---------------- helpers ---------------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });

function getCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(/;\s*/)) {
    const [k, v] = part.split("=");
    if ((k || "").trim().toLowerCase() === name.toLowerCase()) return decodeURIComponent(v || "");
  }
  return null;
}
const setCookie = (k, v, opts = "") => `${k}=${encodeURIComponent(v)}; Path=/; ${opts}`;
const shortId = () => Math.random().toString(36).slice(2, 8);

/* ---------------- mount ---------------- */
export function mount(router) {
  // Root: Splash (if Turnstile enabled and cookie not present) → Landing
  router.add("GET", "/", (req, env) => {
    const turnstileOn = !!(env?.TURNSTILE_SITE_KEY && env?.TURNSTILE_SECRET);
    const ok = getCookie(req, "ts_ok") === "1";

    // If Turnstile is enabled and not yet passed, show splash
    if (turnstileOn && !ok) {
      const sid = shortId();
      return html(splashHTML({ siteKey: env.TURNSTILE_SITE_KEY, sid }), 200, {
        "cache-control": "no-store",
        "set-cookie": [
          setCookie("vsplashed", sid, "Max-Age=86400; SameSite=Lax; Secure"),
        ].join(", "),
      });
    }

    // Landing
    return html(renderLandingHTML(), 200, { "cache-control": "no-store" });
  });

  // POST /splash/verify – verify token (if configured) and set ts_ok=1
  router.add("POST", "/splash/verify", async (req, env) => {
    try {
      const turnstileOn = !!(env?.TURNSTILE_SITE_KEY && env?.TURNSTILE_SECRET);
      let ok = true;

      if (turnstileOn) {
        const body = await req.json().catch(() => ({}));
        const token = body?.token || "";
        if (!token) ok = false;
        else {
          const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }),
            headers: { "content-type": "application/x-www-form-urlencoded" },
          }).then(r => r.json()).catch(() => ({ success: false }));
          ok = !!r?.success;
        }
      }

      // Always set a cookie (if Turnstile off we allow; if on & failed, we still allow preview of lead form)
      const cookies = [
        setCookie("ts_ok", ok ? "1" : "0", "Max-Age=86400; SameSite=Lax; Secure"),
      ].join(", ");

      return json({ ok }, 200, { "set-cookie": cookies });
    } catch {
      return json({ ok: false }, 200, { "set-cookie": setCookie("ts_ok", "0", "Max-Age=86400; SameSite=Lax; Secure") });
    }
  });

  // GET /lead – show form (self-heal cookie if someone bypassed splash)
  router.add("GET", "/lead", (req, _env) => {
    const secured = getCookie(req, "ts_ok") === "1";
    const sid = shortId();

    const headers = {
      // If there is no cookie yet, set a permissive one so the green banner disappears next navigate
      "set-cookie": [
        !secured ? setCookie("ts_ok", "1", "Max-Age=86400; SameSite=Lax; Secure") : null,
        setCookie("ts_sid", sid, "Max-Age=86400; SameSite=Lax; Secure"),
      ].filter(Boolean).join(", "),
    };

    return html(renderPublicLeadHTML({ secured, sessionId: sid }), 200, headers);
  });

  // POST /lead/submit – accept the form (kept lean; your storage logic stays in leads-storage.js)
  router.add("POST", "/lead/submit", async (req, env) => {
    try {
      const fd = await req.formData();
      const payload = {
        name: (fd.get("full_name") || "").toString().trim(),
        phone: (fd.get("phone") || "").toString().trim(),
        email: (fd.get("email") || "").toString().trim(),
        source: (fd.get("source") || "").toString().trim(),
        city: (fd.get("city") || "").toString().trim(),
        street: (fd.get("street") || "").toString().trim(),
        zip: (fd.get("zip") || "").toString().trim(),
        service: (fd.get("service") || "").toString().trim(),
        captured_by: "public",
      };
      // Basic requireds (match your previous)
      for (const k of ["name", "phone", "email", "city", "street", "zip"]) {
        if (!payload[k]) return json({ ok: false, error: `Missing ${k}` }, 400);
      }

      // Defer to your insertLead util (unchanged)
      const { insertLead } = await import("../leads-storage.js");
      await insertLead(env, payload);

      // Fetch last row id as reference
      const row = await env.DB.prepare("SELECT last_insert_rowid() AS id").first();
      return json({ ok: true, ref: row?.id ?? null });
    } catch (e) {
      return json({ ok: false, error: (e && e.message) || "Failed to save" }, 500);
    }
  });
}
