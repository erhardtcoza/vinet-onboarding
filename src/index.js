// src/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // ---------- helpers ----------
    const json = (obj, status = 200, headers = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });

    const text = (str, status = 200, headers = {}) =>
      new Response(str, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", ...headers },
      });

    const html = (body, title = "Vinet") =>
      new Response(
        `<!doctype html><html lang="en"><head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>${title}</title>
          <link rel="preload" href="/static/styles.css?v=20250808b" as="style">
          <link rel="stylesheet" href="/static/styles.css?v=20250808b">
          <style>body{opacity:.001}body.ready{opacity:1;transition:opacity .15s}</style>
        </head>
        <body class="ready"><div id="app"></div>
          <script>window.__VINET__=${JSON.stringify({
            apiBase: env.API_URL || "",
            staticBase: `${env.API_URL || ""}/static`,
            props: {},
          })}</script>
          <script src="/static/onboard.js?v=20250808b" defer></script>
        </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );

    const htmlAdmin = (body, title = "Admin") =>
      new Response(
        `<!doctype html><html lang="en"><head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>${title}</title>
          <link rel="stylesheet" href="/static/styles.css?v=20250808b">
        </head>
        <body>
          <div id="app"></div>
          <script>window.__VINET__=${JSON.stringify({
            apiBase: env.API_URL || "",
          })}</script>
          <script src="/static/admin.js?v=20250808b" defer></script>
        </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );

    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    const parseJSON = async (req) => {
      try {
        return await req.json();
      } catch {
        return {};
      }
    };

    const ok = (d = {}) => json({ ok: true, ...d });
    const fail = (m = "Error", code = 400) => json({ ok: false, error: m }, code);

    const kv = env.ONBOARD_KV;

    // ---------- static and R2 ----------
    if (path.startsWith("/static/") && method === "GET") {
      // Serve from R2 bucket at key "static/..."
      const key = path.slice(1); // remove leading slash
      const obj = await env.R2_UPLOADS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const type =
        key.endsWith(".css") ? "text/css" :
        key.endsWith(".js") ? "application/javascript" :
        "application/octet-stream";
      return new Response(obj.body, {
        headers: {
          "content-type": type,
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (path.startsWith("/r2/") && method === "GET") {
      const key = path.replace(/^\/r2\//, "");
      const obj = await env.R2_UPLOADS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type":
            obj.httpMetadata?.contentType || "application/octet-stream",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    // ---------- ADMIN: IP allowlist ----------
    function adminAllowed() {
      const allow = (env.ADMIN_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!allow.length) return true; // fallback if not configured
      const ip = getIP();
      return allow.includes(ip);
    }

    // ---------- PAGES ----------
    // Admin dashboard at /
    if (path === "/" && method === "GET") {
      if (!adminAllowed()) return new Response("Forbidden", { status: 403 });
      return htmlAdmin("", "Admin Dashboard");
    }

    // Onboarding page
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const session = await kv.get(`onboard/${linkid}`, "json");
      if (!session) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/static/styles.css?v=20250808b"><div class="card narrow"><img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"><h2 class="err">Invalid or expired link</h2><p>Please contact support to request a new onboarding link.</p></div>`,
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      const boot = {
        apiBase: env.API_URL || "",
        staticBase: `${env.API_URL || ""}/static`,
        props: { linkid },
      };
      return new Response(
        `<!doctype html><html lang="en"><head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Onboarding</title>
          <link rel="stylesheet" href="/static/styles.css?v=20250808b">
        </head>
        <body><div id="app"></div>
          <script>window.__VINET__=${JSON.stringify(boot)}</script>
          <script src="/static/onboard.js?v=20250808b" defer></script>
        </body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    // Info pages rendered by JS (EFT / Debit) with props
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const boot = {
        apiBase: env.API_URL || "",
        staticBase: `${env.API_URL || ""}/static`,
        props: { infoPage: "eft", id },
      };
      return new Response(
        `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/static/styles.css?v=20250808b"><div id="app"></div>
         <script>window.__VINET__=${JSON.stringify(boot)}</script>
         <script src="/static/onboard.js?v=20250808b" defer></script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const boot = {
        apiBase: env.API_URL || "",
        staticBase: `${env.API_URL || ""}/static`,
        props: { infoPage: "debit", id },
      };
      return new Response(
        `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/static/styles.css?v=20250808b"><div id="app"></div>
         <script>window.__VINET__=${JSON.stringify(boot)}</script>
         <script src="/static/onboard.js?v=20250808b" defer></script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    // ---------- ADMIN API ----------
    // POST /admin/gen  {id}
    if (path === "/admin/gen" && method === "POST") {
      if (!adminAllowed()) return fail("Forbidden", 403);
      const { id } = await parseJSON(request);
      if (!id) return fail("Missing id");
      const linkid = `${id}_${Math.random().toString(36).slice(2, 10)}`;
      const created = Date.now();
      await kv.put(
        `onboard/${linkid}`,
        JSON.stringify({
          id,
          created,
          progress: 0,
          status: "inprog",
        }),
        { expirationTtl: 7 * 24 * 3600 }
      );
      return ok({ url: `${env.API_URL || ""}/onboard/${linkid}` });
    }

    // POST /admin/otp  {id} -> generate staff OTP for that id (valid 15 min)
    if (path === "/admin/otp" && method === "POST") {
      if (!adminAllowed()) return fail("Forbidden", 403);
      const { id } = await parseJSON(request);
      if (!id) return fail("Missing id");
      const code = ("" + Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
      await kv.put(`otp_staff/${id}`, code, { expirationTtl: 15 * 60 });
      return ok({ code });
    }

    // POST /admin/list {scope: 'pending'|'completed'|'approved'}
    if (path === "/admin/list" && method === "POST") {
      if (!adminAllowed()) return fail("Forbidden", 403);
      const { scope } = await parseJSON(request);
      const list = await kv.list({ prefix: "onboard/" });
      const items = [];
      for (const k of list.keys) {
        const v = await kv.get(k.name, "json");
        if (!v) continue;
        const match =
          (scope === "inprog" || scope === "pending")
            ? v.status === "inprog"
            : scope === "completed" || scope === "pending"
            ? v.status === "completed"
            : scope === "approved"
            ? v.status === "approved"
            : true;
        if (match)
          items.push({
            id: v.id,
            linkid: k.name.replace("onboard/", ""),
            created: v.created,
            completedAt: v.completedAt,
            method: v.payment_method || v.method,
            pdfs: v.pdfs || {},
          });
      }
      return ok({ items });
    }

    // POST /admin/approve {linkid}
    if (path === "/admin/approve" && method === "POST") {
      if (!adminAllowed()) return fail("Forbidden", 403);
      const { linkid } = await parseJSON(request);
      if (!linkid) return fail("Missing linkid");
      const key = `onboard/${linkid}`;
      const v = await kv.get(key, "json");
      if (!v) return fail("Not found", 404);
      v.status = "approved";
      v.approvedAt = Date.now();
      await kv.put(key, JSON.stringify(v), { expirationTtl: 7 * 24 * 3600 });
      return ok();
    }

    // ---------- ONBOARD API ----------
    // POST /api/otp/send {linkid}
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await parseJSON(request);
      if (!linkid) return fail("Missing linkid");

      const sess = await kv.get(`onboard/${linkid}`, "json");
      if (!sess) return fail("Invalid session", 404);

      const id = sess.id;

      // Fetch phone from Splynx (E.164 without '+')
      const phone = await getSplynxPhone(id, env).catch(() => null);
      if (!phone) return ok({ ok: false, error: "No valid phone on file" });

      const code = ("" + Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
      await kv.put(`otp/${linkid}`, code, { expirationTtl: 10 * 60 });

      // send WhatsApp template 'vinetotp' with body param = code
      const waOk = await sendWhatsappTemplate({
        env,
        to: phone,
        template: env.WA_TEMPLATE || "vinetotp",
        lang: "en_US",
        bodyParams: [code],
      });

      if (!waOk.ok) {
        // surface the Meta error on the page
        return ok({ ok: false, error: waOk.error || "WhatsApp send failed" });
      }
      return ok({ ok: true });
    }

    // POST /api/otp/verify {linkid, otp}
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await parseJSON(request);
      if (!linkid || !otp) return fail("Missing params");
      const sess = await kv.get(`onboard/${linkid}`, "json");
      if (!sess) return fail("Invalid session", 404);

      // Accept either link OTP or staff OTP for this ID
      const one = await kv.get(`otp/${linkid}`);
      const two = await kv.get(`otp_staff/${sess.id}`);

      const okOTP = (one && otp === one) || (two && otp === two);
      if (!okOTP) return ok({ ok: false });

      // Clear user OTP (staff code stays until TTL)
      await kv.delete(`otp/${linkid}`);
      return ok({ ok: true });
    }

    // POST /api/progress/:linkid
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3] || "";
      const body = await parseJSON(request);
      const ip = getIP();
      const key = `onboard/${linkid}`;
      const sess = (await kv.get(key, "json")) || {};
      const merged = {
        ...sess,
        ...body,
        last_ip: ip,
        last_time: Date.now(),
        status:
          body.progress >= 5
            ? "completed"
            : sess.status || "inprog",
      };
      await kv.put(key, JSON.stringify(merged), { expirationTtl: 7 * 24 * 3600 });
      return ok();
    }

    // POST /api/splynx/profile {id}
    if (path === "/api/splynx/profile" && method === "POST") {
      const { id } = await parseJSON(request);
      if (!id) return fail("Missing id");
      const profile = await fetchSplynxProfile(id, env).catch(() => ({}));
      return ok({ profile });
    }

    // GET /api/terms/debit
    if (path === "/api/terms/debit" && method === "GET") {
      const u = env.TERMS_DEBIT_URL;
      if (!u) return text("Missing TERMS_DEBIT_URL", 500);
      try {
        const r = await fetch(u);
        const t = await r.text();
        return text(t, 200, {
          "cache-control": "public, max-age=3600",
        });
      } catch (e) {
        return text("Failed to fetch terms", 500);
      }
    }

    // GET /api/terms/service
    if (path === "/api/terms/service" && method === "GET") {
      const u = env.TERMS_SERVICE_URL || env.TERMS_MSA_URL;
      if (!u) return text("Missing TERMS_SERVICE_URL", 500);
      try {
        const r = await fetch(u);
        const t = await r.text();
        return text(t, 200, {
          "cache-control": "public, max-age=3600",
        });
      } catch (e) {
        return text("Failed to fetch terms", 500);
      }
    }

    // POST /api/debit/save  {id, details, accept:true}
    if (path === "/api/debit/save" && method === "POST") {
      const { id, details, accept } = await parseJSON(request);
      if (!id || !details) return fail("Missing params");
      await kv.put(
        `debit/${id}`,
        JSON.stringify({
          id,
          details,
          accept: !!accept,
          at: Date.now(),
        }),
        { expirationTtl: 30 * 24 * 3600 }
      );
      return ok();
    }

    // POST /api/upload/:linkid?type=id|poa
    if (path.startsWith("/api/upload/") && method === "POST") {
      const linkid = path.split("/")[3] || "";
      const type = url.searchParams.get("type");
      if (!linkid || !type) return fail("Missing params");

      const contentType =
        request.headers.get("content-type") || "application/octet-stream";

      // 5 MB cap
      const body = await request.arrayBuffer();
      if (body.byteLength > 5 * 1024 * 1024) return fail("File too large (max 5MB)");

      const key = `uploads/${linkid}/${type}-${Date.now()}`;
      await env.R2_UPLOADS.put(key, body, {
        httpMetadata: { contentType },
      });

      const fileUrl = `${env.API_URL || ""}/r2/${key}`;
      return ok({ url: fileUrl });
    }

    // POST /api/agreement/sign
    // { linkid, fullName, email, phone, street, city, zip, payment_method, debit?, signaturePng }
    // PDF generation can be added later; for now store signature and return ok.
    if (path === "/api/agreement/sign" && method === "POST") {
      const body = await parseJSON(request);
      const { linkid, signaturePng } = body;
      if (!linkid || !signaturePng) return fail("Missing params");

      // save signature PNG (data URL)
      const b64 = signaturePng.split(",")[1] || "";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const sigKey = `sign/${linkid}/${Date.now()}.png`;
      await env.R2_UPLOADS.put(sigKey, bytes, {
        httpMetadata: { contentType: "image/png" },
      });

      const key = `onboard/${linkid}`;
      const sess = (await kv.get(key, "json")) || {};
      sess.status = "completed";
      sess.completedAt = Date.now();
      sess.payment_method = body.payment_method;
      if (body.debit) sess.debit = body.debit;
      sess.edits = {
        full_name: body.fullName,
        email: body.email,
        phone: body.phone,
        street: body.street,
        city: body.city,
        zip: body.zip,
      };
      // placeholder for future PDF links
      sess.pdfs = sess.pdfs || {};
      await kv.put(key, JSON.stringify(sess), { expirationTtl: 30 * 24 * 3600 });

      return ok({ pdfs: sess.pdfs });
    }

    // ---------- default ----------
    return new Response("Not found", { status: 404 });

    // ---------- helpers (bottom) ----------
    async function getSplynxPhone(id, env) {
      // Try customer, then lead
      const auth = env.SPLYNX_AUTH || "";
      const base = env.SPLYNX_API?.replace(/\/+$/, "") || "";
      async function tryPath(p) {
        const r = await fetch(`${base}${p}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!r.ok) return null;
        const d = await r.json();
        return d;
      }
      let phone = null;

      // Customer
      const c = await tryPath(`/admin/customers/customer/${id}`);
      if (c && (c.phone || c.main_phone)) phone = (c.phone || c.main_phone) + "";

      // Lead
      if (!phone) {
        const l = await tryPath(`/admin/crm/leads/${id}`);
        if (l && (l.phone || l.main_phone)) phone = (l.phone || l.main_phone) + "";
      }

      // Normalize to digits only; expect 27XXXXXXXXX
      if (!phone) return null;
      const digits = (phone + "").replace(/[^\d]/g, "");
      if (!/^27\d{9}$/.test(digits)) return null;
      return digits;
    }

    async function fetchSplynxProfile(id, env) {
      const auth = env.SPLYNX_AUTH || "";
      const base = env.SPLYNX_API?.replace(/\/+$/, "") || "";
      async function tryPath(p) {
        const r = await fetch(`${base}${p}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!r.ok) return null;
        return r.json();
      }
      // Try customer then lead
      let p =
        (await tryPath(`/admin/customers/customer/${id}`)) ||
        (await tryPath(`/admin/crm/leads/${id}`)) ||
        {};
      return {
        id,
        full_name: p.full_name || p.name || "",
        email: p.email || "",
        phone: (p.phone || p.main_phone || "") + "",
        street: p.street || p.address || "",
        city: p.city || "",
        zip: p.zip_code || p.zip || "",
      };
    }

    async function sendWhatsappTemplate({ env, to, template, lang, bodyParams }) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to,
              type: "template",
              template: {
                name: template,
                language: { code: lang || "en_US" },
                components: bodyParams?.length
                  ? [
                      {
                        type: "body",
                        parameters: bodyParams.map((t) => ({
                          type: "text",
                          text: String(t),
                        })),
                      },
                    ]
                  : [],
              },
            }),
          }
        );
        if (!res.ok) {
          const t = await res.text();
          return { ok: false, error: t };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    // atob polyfill for workers if needed
    function atob(b64) {
      if (globalThis.atob) return globalThis.atob(b64);
      const bin = Uint8Array.from(Buffer.from(b64, "base64"));
      let out = "";
      for (const c of bin) out += String.fromCharCode(c);
      return out;
    }
  },
};
