// src/routes.js
import { ipAllowed } from "./branding.js";
import { LOGO_URL, DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "./constants.js";
import { renderMSAPdf } from "./pdf/msa.js";
import { renderDebitPdf } from "./pdf/debit.js";
import { renderAdminPage, renderAdminReviewHTML } from "./ui/admin.js";
import { fetchTextCached, getClientMeta } from "./helpers.js";
import {
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  splynxPUT,
  detectEntityKind,
  uploadAllSessionFilesToSplynx,
} from "./splynx.js";
import { deleteOnboardAll } from "./storage.js";
import { renderOnboardHTMLShell } from "./ui/onboard.js";

/* ------------------------- tiny helpers ------------------------- */
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });

function getIP(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    ""
  );
}
function getUA(req) {
  return req.headers.get("user-agent") || "";
}

/* Branded 403 page (Admin lock) */
function restrictedResponse(request, env) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const ua = request.headers.get("user-agent") || "";
  const path = new URL(request.url).pathname;

  console.warn("Admin access blocked", { ip, path, ua });

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Restricted Access • Vinet</title>
  <style>
    :root { --vinet:#e2001a; --ink:#222; --muted:#666; --card:#fff; --bg:#f7f8fb; }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif}
    .wrap{max-width:900px;margin:56px auto;padding:0 22px}
    .card{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #00000012,0 1px 2px #0001;padding:26px;text-align:center}
    .logo{display:block;margin:0 auto 16px;max-width:520px;width:100%;height:auto}
    h1{margin:10px 0 8px;font-size:26px;color:var(--vinet);font-weight:900}
    p{margin:8px 0;font-size:16px;color:#333}
    .muted{color:var(--muted);font-size:14px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <img class="logo" src="${LOGO_URL}" alt="Vinet Internet Solutions" />
      <h1>Restricted Access</h1>
      <p>Sorry, this page is only accessible from within the <b>Vinet Internet Solutions</b> network.</p>
      <p class="muted">If you have any questions please contact our office on <b>021&nbsp;007&nbsp;0200</b> or <a href="mailto:support@vinet.co.za">support@vinet.co.za</a>.</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/* ---------------------- WhatsApp helpers ---------------------- */
/**
 * sendWhatsAppTemplate:
 *  - ONLY uses a pre-approved WhatsApp template.
 *  - No fallback to freeform text.
 */
async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
  const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toMsisdn,
    type: "template",
    template: {
      name: templateName,
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code.slice(-6) }],
        },
      ],
    },
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WA template send failed ${r.status} ${body}`);
  }
}

/* ---------------------------- main router ---------------------------- */
export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  /* ---------------- Public + Admin UI routes ---------------- */

  // Dashboard home (admin list UI)
  if (path === "/" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);
    return new Response(renderAdminPage(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // EFT printable helper
  if (path === "/info/eft" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    const LOGO_URL_LOCAL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
    const escapeHtml = (s) =>
      String(s || "").replace(/[&<>"]/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[m]));

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7fa}
.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{color:#e2001a;font-size:34px;margin:8px 0 18px}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.grid .full{grid-column:1 / -1}
label{font-weight:700;color:#333;font-size:14px}
input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}
button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}
.note{font-size:13px;color:#555}
.logo{display:block;margin:0 auto 8px;height:68px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL_LOCAL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(
      id || ""
    )}"></div>
  </div>
  <p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Terms proxy (MSA + Debit)
  if (path === "/api/terms" && method === "GET") {
    const kind = (url.searchParams.get("kind") || "").toLowerCase();
    const svcUrl = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
    const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;

    async function getText(u) {
      try {
        const r = await fetch(u, {
          cf: { cacheEverything: true, cacheTtl: 300 },
        });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    }

    const esc = (s) =>
      s.replace(/[&<>"]/g, (t) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[t]));

    const service = esc((await getText(svcUrl)) || "");
    const debit = esc((await getText(debUrl)) || "");

    const body =
      kind === "debit"
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;

    return new Response(body || "<p>Terms unavailable.</p>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  /* ---------------- Admin APIs ---------------- */

  // Create onboarding link for a Splynx ID
  if (path === "/api/admin/genlink" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const { id } = await request.json().catch(() => ({}));
    if (!id) return json({ error: "Missing id" }, 400);

    const token = Math.random().toString(36).slice(2, 10);
    const linkid = `${id}_${token}`;

    const meta = getClientMeta(request);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        id,
        created: Date.now(),
        updated: Date.now(),
        progress: 0,
        status: "inprogress",
        audit_meta: meta,
        edits: {},
        uploads: [],
      }),
      { expirationTtl: 86400 }
    );

    return json({ url: `${url.origin}/onboard/${linkid}`, linkid });
  }

  // Generate one-time staff OTP
  if (path === "/api/staff/gen" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, {
      expirationTtl: 900,
    });

    return json({ ok: true, linkid, code });
  }

  // Admin list sessions
  if (path === "/api/admin/list" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const mode = url.searchParams.get("mode") || "pending";
    const m = mode === "completed" ? "pending" : mode; // alias

    const list = await env.ONBOARD_KV.list({
      prefix: "onboard/",
      limit: 1000,
    });

    const items = [];
    for (const k of list.keys || []) {
      const s = await env.ONBOARD_KV.get(k.name, "json");
      if (!s) continue;
      const linkid = k.name.split("/")[1];
      const updated = s.updated || s.last_time || s.created || 0;

      if (m === "inprog" && (s.status === "inprogress" || !s.agreement_signed))
        items.push({ linkid, id: s.id, updated });
      if (m === "pending" && s.status === "pending")
        items.push({ linkid, id: s.id, updated });
      if (m === "approved" && s.status === "approved")
        items.push({ linkid, id: s.id, updated });
    }

    items.sort((a, b) => b.updated - a.updated);
    return json({ ok: true, items });
  }

  // Admin review page
  if (path === "/admin/review" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return new Response("Missing linkid", { status: 400 });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Not found", { status: 404 });

    const r2PublicBase = env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";

    let original = null;
    try {
      const id = String(sess.id || "").trim();
      if (id) original = await fetchProfileForDisplay(env, id);
    } catch {
      original = null;
    }

    return new Response(
      renderAdminReviewHTML({
        linkid,
        sess,
        r2PublicBase,
        original,
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // Admin reject
  if (path === "/api/admin/reject" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const { linkid, reason } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "rejected",
        reject_reason: String(reason || "").slice(0, 300),
        rejected_at: Date.now(),
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true });
  }

  // Admin delete (deep cleanup)
  if (path === "/api/admin/delete" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    try {
      const res = await deleteOnboardAll(env, linkid);
      return json({ ok: true, ...res });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
  }

  // Admin diagnostics (list KV keys related to a session)
  if (path === "/api/admin/session/keys" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const prefixes = ["onboard/", "link:", "session:", "sess:", "inprogress:"];
    const keysOut = [];

    for (const p of prefixes) {
      const l = await env.ONBOARD_KV.list({ prefix: p });
      for (const k of l.keys) {
        if (k.name.includes(linkid)) {
          keysOut.push({
            key: k.name,
            bytes: k.size || k.metadata?.size || 0,
          });
        }
      }
    }

    const raw = await env.ONBOARD_KV.get(linkid);
    if (raw) keysOut.push({ key: linkid, bytes: raw.length });

    return json({ ok: true, linkid, keys: keysOut });
  }

  // Admin diagnostics (get whole session blob)
  if (path === "/api/admin/session/get" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    return json({
      ok: true,
      linkid,
      found: !!sess,
      session: sess || null,
    });
  }

  // Admin approve -> push to Splynx
  if (path === "/api/admin/approve" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse(request, env);

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);

    const id = String(sess.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing Splynx ID" }, 400);

    // Build payload (mapped to Splynx)
    const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
    const r2Base = env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";
    const publicFiles = uploads.map((u) => `${r2Base}/${u.key}`);

    const body = {
      name: sess.edits?.full_name || undefined,
      email: sess.edits?.email || undefined,
      phone_mobile: sess.edits?.phone || undefined,
      street_1: sess.edits?.street || undefined,
      city: sess.edits?.city || undefined,
      zip_code: sess.edits?.zip || undefined,
      attachments: publicFiles.length ? publicFiles : undefined,
      payment_method: sess.pay_method || undefined,
      debit: sess.debit || undefined,
    };

    // pick endpoint based on CRM entity type
    let kind = "unknown";
    try {
      kind = await detectEntityKind(env, id);
    } catch {
      // ignore
    }

    const attempts = [];
    const tryPut = async (endpoint) => {
      try {
        await splynxPUT(env, endpoint, body);
        attempts.push({ endpoint, ok: true });
      } catch (e) {
        console.warn(`approve: splynx PUT failed ${endpoint}: ${e && e.message}`);
        attempts.push({
          endpoint,
          ok: false,
          error: String(e && e.message),
        });
      }
    };

    if (kind === "customer") {
      await tryPut(`/admin/customers/customer/${id}`);
    } else if (kind === "lead") {
      await tryPut(`/admin/crm/leads/${id}`);
    } else {
      await tryPut(`/admin/customers/customer/${id}`);
      await tryPut(`/admin/crm/leads/${id}`);
    }

    // Upload docs (R2 uploads + generated PDFs) into Splynx documents
    let docUpload = null;
    try {
      docUpload = await uploadAllSessionFilesToSplynx(env, linkid);
    } catch (e) {
      docUpload = { ok: false, error: String(e && e.message) };
    }

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "approved",
        approved_at: Date.now(),
        updated: Date.now(),
        push_attempts: attempts,
        splynx_docs_result: docUpload,
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, kind, attempts, docs: docUpload });
  }

  /* ---------------- Public onboarding APIs ---------------- */

  // OTP send (WhatsApp only; no SMS/text fallback)
  if (path === "/api/otp/send" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) {
      return json(
        { ok: false, error: "WhatsApp credentials not configured" },
        500
      );
    }

    const splynxId = (linkid || "").split("_")[0];

    let msisdn = null;
    try {
      msisdn = await fetchCustomerMsisdn(env, splynxId);
    } catch {
      return json({ ok: false, error: "Splynx lookup failed" }, 502);
    }

    if (!msisdn) {
      return json({ ok: false, error: "No WhatsApp number on file" }, 404);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    // cache OTP + msisdn in KV for 10 mins
    await env.ONBOARD_KV.put(`otp/${linkid}`, code, {
      expirationTtl: 600,
    });
    await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, {
      expirationTtl: 600,
    });

    try {
      await sendWhatsAppTemplate(env, msisdn, code, "en");
      return json({ ok: true });
    } catch {
      return json({ ok: false, error: "WhatsApp send failed (template)" }, 502);
    }
  }

  // OTP verify
  if (path === "/api/otp/verify" && method === "POST") {
    const { linkid, otp, kind } = await request.json().catch(() => ({}));
    if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);

    const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
    const expected = await env.ONBOARD_KV.get(key);

    const ok = !!expected && expected === otp;

    if (ok) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({
            ...sess,
            otp_verified: true,
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
      if (kind === "staff") {
        await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
    }

    return json({ ok });
  }

  // Upload docs -> R2
  if (path === "/api/onboard/upload" && method === "POST") {
    const params = new URL(request.url).searchParams;
    const linkid = params.get("linkid");
    const fileName = params.get("filename") || "file.bin";
    const label = params.get("label") || "";

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Invalid link", { status: 404 });

    const bodyBuf = await request.arrayBuffer();
    const safeName = fileName.replace(/[^a-z0-9_.-]/gi, "_");
    const key = `uploads/${linkid}/${Date.now()}_${safeName}`;

    await env.R2_UPLOADS.put(key, bodyBuf);

    const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
    uploads.push({
      key,
      name: fileName,
      size: bodyBuf.byteLength,
      label,
    });

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        uploads,
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, key });
  }

  // Save progress
  if (path.startsWith("/api/progress/") && method === "POST") {
    const linkid = path.split("/")[3];
    const body = await request.json().catch(() => ({}));

    const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};

    const next = {
      ...existing,
      ...body,
      last_ip: getIP(request),
      last_ua: getUA(request),
      last_time: Date.now(),
      updated: Date.now(),
      audit_meta: existing.audit_meta || getClientMeta(request),
    };

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify(next),
      { expirationTtl: 86400 }
    );
    return json({ ok: true });
  }

  // Debit details save
  if (path === "/api/debit/save" && method === "POST") {
    // support JSON or formData fallback
    const b = await request.json().catch(async () => {
      const form = await request.formData().catch(() => null);
      if (!form) return {};
      const o = {};
      for (const [k, v] of form.entries()) o[k] = v;
      return o;
    });

    const reqd = [
      "account_holder",
      "id_number",
      "bank_name",
      "account_number",
      "account_type",
      "debit_day",
    ];
    for (const k of reqd) {
      if (!b[k] || String(b[k]).trim() === "") {
        return json({ ok: false, error: `Missing ${k}` }, 400);
      }
    }

    const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
    const ts = Date.now();
    const kvKey = `debit/${id}/${ts}`;

    const record = {
      ...b,
      splynx_id: id,
      created: ts,
      ip: getIP(request),
      ua: getUA(request),
    };

    // store 90 days
    await env.ONBOARD_KV.put(kvKey, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 90,
    });

    // also attach to the active session blob
    const linkidParam =
      (b.linkid && String(b.linkid)) ||
      url.searchParams.get("linkid") ||
      "";
    if (linkidParam) {
      const sess = await env.ONBOARD_KV.get(
        `onboard/${linkidParam}`,
        "json"
      );
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkidParam}`,
          JSON.stringify({
            ...sess,
            debit: { ...record },
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
    }

    return json({ ok: true, ref: kvKey });
  }

  // Debit signature upload
  if (path === "/api/debit/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
      return json({ ok: false, error: "Missing/invalid signature" }, 400);
    }

    const pngB64 = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));

    const sigKey = `debit_agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) {
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({
          ...sess,
          debit_signed: true,
          debit_sig_key: sigKey,
          updated: Date.now(),
        }),
        { expirationTtl: 86400 }
      );
    }

    return json({ ok: true, sigKey });
  }

  // Service agreement signature (MSA)
  if (path === "/api/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
      return json({ ok: false, error: "Missing/invalid signature" }, 400);
    }

    const pngB64 = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));

    const sigKey = `agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown session" }, 404);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        agreement_signed: true,
        agreement_sig_key: sigKey,
        status: "pending",
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, sigKey });
  }

  // Signature passthroughs
  if (path.startsWith("/agreements/sig/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });

    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });

    return new Response(obj.body, {
      headers: { "content-type": "image/png" },
    });
  }

  if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });

    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });

    return new Response(obj.body, {
      headers: { "content-type": "image/png" },
    });
  }

  // Agreement "view in browser" (terms-only view)
  if (path.startsWith("/agreements/") && method === "GET") {
    const [, , type, linkid] = path.split("/");
    if (!type || !linkid) return new Response("Bad request", { status: 400 });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_signed)
      return new Response("Agreement not available yet.", {
        status: 404,
      });

    const esc = (s) =>
      String(s || "").replace(/[&<>"]/g, (t) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[t]));

    if (type === "msa") {
      const src = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:msa:html")) || "Terms unavailable.";

      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Master Service Agreement</title><h2>Master Service Agreement</h2><pre style="white-space:pre-wrap">${esc(
          text
        )}</pre>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    if (type === "debit") {
      const src = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:debit:html")) || "Terms unavailable.";

      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Debit Order Instruction</title><h2>Debit Order Instruction</h2><pre style="white-space:pre-wrap">${esc(
          text
        )}</pre>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    return new Response("Unknown agreement type", { status: 400 });
  }

  // Cloudflare Turnstile verify
  if (path === "/api/turnstile/verify" && method === "POST") {
    const { token, linkid } = await request.json().catch(() => ({}));
    if (!token || !linkid) {
      return json({ ok: false, error: "Missing token/linkid" }, 400);
    }

    const form = new URLSearchParams();
    form.set("secret", env.TURNSTILE_SECRET_KEY || "");
    form.set("response", token);
    form.set("remoteip", request.headers.get("CF-Connecting-IP") || "");

    const ver = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    const data = await ver.json().catch(() => ({}));

    if (data.success) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({
            ...sess,
            human_ok: true,
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
    }

    return json({ ok: !!data.success, data });
  }

  // Splynx profile proxy for Personal Info step
  if (path === "/api/splynx/profile" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing id" }, 400);

    try {
      const prof = await fetchProfileForDisplay(env, id);
      return json(prof);
    } catch {
      return json({ error: "Lookup failed" }, 502);
    }
  }

  // PDF output
  if (path.startsWith("/pdf/msa/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderMSAPdf(env, linkid);
  }

  if (path.startsWith("/pdf/debit/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderDebitPdf(env, linkid);
  }

  // Serve the modular onboarding app JS from KV
  if (path === "/onboard-app.js" && method === "GET") {
    // You said you've uploaded the file to ONBOARD_KV already.
    // Let's expect the key "static/onboard-app.js".
    const js = await env.ONBOARD_KV.get("static/onboard-app.js");
    if (!js) {
      return new Response("// not found", {
        status: 404,
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }
    return new Response(js, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  }

  // Onboarding UI shell
  if (path.startsWith("/onboard/") && method === "GET") {
    const linkid = path.split("/")[2] || "";
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess)
      return new Response("Link expired or invalid", {
        status: 404,
      });

    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return new Response(renderOnboardHTMLShell({ linkid, siteKey }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not found", { status: 404 });
}
