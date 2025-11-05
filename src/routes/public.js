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

/* Convert every undefined to null, trim strings */
function sanitize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) { out[k] = null; continue; }
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/* ---------------- mount ---------------- */
export function mount(router) {
  // Root: Splash (if Turnstile enabled and cookie not present) → Landing
  router.add("GET", "/", (req, env) => {
    const turnstileOn = !!(env?.TURNSTILE_SITE_KEY && env?.TURNSTILE_SECRET);
    const ok = getCookie(req, "ts_ok") === "1";

    if (turnstileOn && !ok) {
      const sid = shortId();
      return html(splashHTML({ siteKey: env.TURNSTILE_SITE_KEY, sid }), 200, {
        "cache-control": "no-store",
        "set-cookie": setCookie("vsplashed", sid, "Max-Age=86400; SameSite=Lax; Secure"),
      });
    }

    return html(renderLandingHTML(), 200, { "cache-control": "no-store" });
  });

  // POST /splash/verify – soft gate
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

      return json({ ok }, 200, { "set-cookie": setCookie("ts_ok", ok ? "1" : "0", "Max-Age=86400; SameSite=Lax; Secure") });
    } catch {
      return json({ ok: false }, 200, { "set-cookie": setCookie("ts_ok", "0", "Max-Age=86400; SameSite=Lax; Secure") });
    }
  });

  // GET /lead – show form (self-heal cookie)
  router.add("GET", "/lead", (req, _env) => {
    const secured = getCookie(req, "ts_ok") === "1";
    const sid = shortId();
    const cookies = [
      !secured ? setCookie("ts_ok", "1", "Max-Age=86400; SameSite=Lax; Secure") : null,
      setCookie("ts_sid", sid, "Max-Age=86400; SameSite=Lax; Secure"),
    ].filter(Boolean).join(", ");
    return html(renderPublicLeadHTML({ secured, sessionId: sid }), 200, { "set-cookie": cookies });
  });

  // POST /lead/submit – accepts JSON, urlencoded, or multipart
  router.add("POST", "/lead/submit", async (req, env) => {
    const parseBody = async () => {
      const ct = (req.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        return await req.json().catch(() => null);
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        const t = await req.text().catch(() => "");
        return Object.fromEntries(new URLSearchParams(t));
      } else if (ct.includes("multipart/form-data")) {
        const fd = await req.formData();
        return Object.fromEntries(
          [...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : (v?.name || "")])
        );
      }
      return null;
    };

    try {
      const raw = await parseBody();
      if (!raw) {
        return json(
          { ok: false, error: "Unsupported Content-Type. Use JSON, x-www-form-urlencoded, or multipart/form-data." },
          415
        );
      }

      const get = (...keys) => {
        for (const k of keys) {
          const v = raw[k];
          if (v != null && String(v).trim() !== "") return String(v).trim();
        }
        return null;
      };

      const payloadRaw = {
        name:        get("full_name", "name"),
        phone:       get("phone", "whatsapp", "phone_number"),
        whatsapp:    get("whatsapp", "phone"),
        email:       get("email"),
        source:      get("source") || "website",
        city:        get("city", "town"),
        street:      get("street", "street_1", "street1", "street_address"),
        zip:         get("zip", "zip_code", "postal", "postal_code"),
        service:     get("service") || "unknown",
        captured_by: "public",
      };

      // Required fields
      for (const k of ["name", "phone", "email", "city", "street", "zip"]) {
        if (!payloadRaw[k]) {
          if (env?.DEBUG_LEADS) {
            return json({ ok:false, error:`Missing ${k}`, debug:{raw, payloadRaw} }, 400);
          }
          return json({ ok:false, error:`Missing ${k}` }, 400);
        }
      }

      const payload = sanitize(payloadRaw);

      // Save
      const { insertLead } = await import("../leads-storage.js");
      await insertLead(env, payload);

      // Reference id
      const row = await env.DB.prepare("SELECT last_insert_rowid() AS id").first().catch(() => null);
      return json({ ok: true, ref: row?.id ?? null });

    } catch (e) {
      if (env?.DEBUG_LEADS) {
        return json({ ok:false, error: String(e && e.message || e), stack: (e && e.stack) || "" }, 500);
      }
      return json({ ok:false, error:(e && e.message) || "Failed to save" }, 500);
    }
  });
}
