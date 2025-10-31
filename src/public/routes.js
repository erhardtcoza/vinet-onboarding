// Public host: splash → /ts-verify → landing → /lead → submit
import { html, json, safeStr, hasCookie } from "../utils/http.js";
import { DATE_TODAY, nowSec } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { renderLandingHTML } from "../ui/landing.js";
import { renderSplashHTML } from "../ui/splash.js";
import { renderPublicLeadHTML } from "../ui/public_lead.js";

function splitAddress(full) {
  const out = { street: "", city: "", zip: "" };
  if (!full) return out;
  const parts = String(full).split(",").map(s => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[0-9]{3,6}$/.test(parts[i])) { out.zip = parts[i]; parts.splice(i, 1); break; }
  }
  if (parts.length) { out.city = parts[parts.length - 1]; parts.pop(); }
  out.street = parts.join(", ").trim();
  return out;
}

export async function handlePublic(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Service worker + manifest
  if (request.method === "GET" && pathname === "/sw.js") {
    return new Response(`self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>self.clients.claim());`, {
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }
    });
  }
  if (request.method === "GET" && pathname === "/manifest.webmanifest") {
    return json({ name:"Vinet", short_name:"Vinet", start_url:"/", display:"standalone", background_color:"#ffffff", theme_color:"#ED1C24", icons:[] });
  }

  // Splash
  if (request.method === "GET" && (pathname === "/" || pathname === "/index" || pathname === "/index.html")) {
    return html(renderSplashHTML({ siteKey: env.TURNSTILE_SITE_KEY || "" }));
  }

  // Turnstile verify (also accepts {skip:true})
  if (request.method === "POST" && pathname === "/ts-verify") {
    try {
      const body = await request.json().catch(() => ({}));
      if (body.skip === true) {
        const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
        return json({ ok: true, proceed: true, skipped: true }, 200, { "set-cookie": cookie });
      }
      const token = body.token;
      if (!token) return json({ ok:false, error: "missing token" }, 400);

      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY || "",
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || ""
        })
      });
      const result = await vr.json().catch(() => ({ success:false }));
      const cookie = `ts_ok=${result.success ? "1" : "0"}; Max-Age=86400; Path=/; Secure; SameSite=Lax`;
      return json({ ok:true, proceed:true, success:!!result.success }, 200, { "set-cookie": cookie });
    } catch {
      const cookie = "ts_ok=0; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return json({ ok:true, proceed:true, success:false }, 200, { "set-cookie": cookie });
    }
  }

  // Landing
  if (request.method === "GET" && pathname === "/landing") {
    const secured = hasCookie(request, "ts_ok");
    return html(renderLandingHTML({ secured, seen:true }));
  }

  // Form UI
  if (request.method === "GET" && pathname === "/lead") {
    return html(renderPublicLeadHTML());
  }

  // Submit (accept JSON)
  if (request.method === "POST" && pathname === "/api/leads/submit") {
    if (!hasCookie(request, "ts_ok")) return json({ error: "Session not verified" }, 403);

    await ensureLeadSchema(env);
    let body = await request.json().catch(()=>null);
    if (!body) {
      // also allow FormData fallback
      const form = await request.formData().catch(()=>null);
      if (form) {
        body = Object.fromEntries([...form.entries()]);
      }
    }
    if (!body) return json({ error:"Bad request" }, 400);

    const name   = safeStr(body.name);
    const phone  = safeStr(body.phone);
    const email  = safeStr(body.email);
    const street = safeStr(body.street || body.address_line || body.full_line);
    let   city   = safeStr(body.city);
    let   zip    = safeStr(body.zip);
    const source = safeStr(body.source || "web");
    const service= safeStr(body.service_interested || body.service || "general");

    if (!name || !phone || !email) return json({ error:"Missing required fields" }, 400);
    if (!city || !zip) { const g = splitAddress(street); city = city || g.city; zip = zip || g.zip; }

    const payload = {
      name, phone, email, source,
      city, street, zip,
      billing_email: email,
      score: 1, date_added: DATE_TODAY(),
      captured_by: "public",
      service_interested: service,
      partner: "main", location: "main",
      notes: safeStr(body.notes)
    };

    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,synced,service_interested,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0,?10,?11)
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added, payload.service_interested, nowSec()
    ).run();

    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = \`\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2,6)}\`;
    return json({ ok:true, ref, message:"Thanks! We’ve received your details." });
  }

  return null;
}
