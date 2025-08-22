// src/routes.js
import { ipAllowed } from "./branding.js";
import { renderMSAPdf } from "./pdf/msa.js";
import { renderDebitPdf } from "./pdf/debit.js";
import { renderAdminPage, renderAdminReviewHTML } from "./ui/admin.js";
import { fetchTextCached, getClientMeta } from "./helpers.js";
import {
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  splynxPUT,
  mapEditsToSplynxPayload,
  detectEntityKind,
  uploadAllSessionFilesToSplynx,
} from "./splynx.js";
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "./constants.js";
import { deleteOnboardAll } from "./storage.js";
import { renderOnboardUI } from "./ui/onboard.js";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });

// --- WhatsApp helpers ---
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
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] },
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template send failed ${r.status} ${await r.text().catch(() => "")}`);
}

async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to: toMsisdn, type: "text", text: { body: bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text send failed ${r.status} ${await r.text().catch(() => "")}`);
}

// --- Main router ---
export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const getIP = () =>
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const getUA = () => request.headers.get("user-agent") || "";

  // ----- Admin dashboard -----
  if (path === "/" && method === "GET") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // ----- EFT info page -----
  if (path === "/info/eft" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
    const escapeHtml = (s) =>
      String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>body{font-family:Arial,sans-serif;background:#f7f7fa}.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}h1{color:#e2001a;font-size:34px;margin:8px 0 18px}.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}.grid .full{grid-column:1 / -1}label{font-weight:700;color:#333;font-size:14px}input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
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
</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // ----- Terms (for UI preview panes) -----
  if (path === "/api/terms" && method === "GET") {
    const kind = (url.searchParams.get("kind") || "").toLowerCase();
    const svcUrl = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
    const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
    async function getText(u) {
      try {
        const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    }
    const esc = (s) => s.replace(/[&<>]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
    const service = esc((await getText(svcUrl)) || "");
    const debit = esc((await getText(debUrl)) || "");
    const body =
      kind === "debit"
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
    return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // ----- Admin: generate onboarding link -----
  if (path === "/api/admin/genlink" && method === "POST") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
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

  // ----- Admin: generate staff OTP -----
  if (path === "/api/staff/gen" && method === "POST") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
    return json({ ok: true, linkid, code });
  }

  // ----- Admin: list sessions -----
  if (path === "/api/admin/list" && method === "GET") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const mode = url.searchParams.get("mode") || "pending";
    const m = mode === "completed" ? "pending" : mode; // alias
    const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
    const items = [];
    for (const k of list.keys || []) {
      const s = await env.ONBOARD_KV.get(k.name, "json");
      if (!s) continue;
      const linkid = k.name.split("/")[1];
      const updated = s.updated || s.last_time || s.created || 0;
      if (m === "inprog" && (s.status === "inprogress" || !s.agreement_signed)) items.push({ linkid, id: s.id, updated });
      if (m === "pending" && s.status === "pending") items.push({ linkid, id: s.id, updated });
      if (m === "approved" && s.status === "approved") items.push({ linkid, id: s.id, updated });
    }
    items.sort((a, b) => b.updated - a.updated);
    return json({ ok: true, items });
  }

  // ----- Admin review (passes original Splynx profile) -----
  if (path === "/admin/review" && method === "GET") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
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
      renderAdminReviewHTML({ linkid, sess, r2PublicBase, original }),
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // ----- Admin: reject -----
  if (path === "/api/admin/reject" && method === "POST") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
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

  // ----- Admin: delete (full cleanup) -----
  if (path === "/api/admin/delete" && method === "POST") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    try {
      const res = await deleteOnboardAll(env, linkid);
      return json({ ok: true, ...res });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
  }

  // ----- Admin: approve (push to Splynx + upload docs + mark approved) -----
  if (path === "/api/admin/approve" && method === "POST") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);

    const splynxId = String(sess.id || "").trim() || String(linkid).split("_")[0];

    // 1) push edits
    let entityKind = "unknown";
    try {
      entityKind = await detectEntityKind(env, splynxId); // "customer" | "lead"
      const payload = mapEditsToSplynxPayload(sess.edits || {}, sess.pay_method || "", sess.debit || null, []);
      if (entityKind === "customer") {
        await splynxPUT(env, `/admin/customers/${splynxId}`, payload);
      } else if (entityKind === "lead") {
        await splynxPUT(env, `/admin/crm/leads/${splynxId}`, payload);
      }
    } catch (e) {
      // Non-fatal
      console.error("approve: splynx update error", e);
    }

    // 2) upload all docs (RICA uploads + generated PDFs)
    let uploadResult = null;
    try {
      uploadResult = await uploadAllSessionFilesToSplynx(env, linkid);
    } catch (e) {
      console.error("approve: uploadAllSessionFilesToSplynx error", e);
    }

    // 3) mark approved
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, status: "approved", approved_at: Date.now(), updated: Date.now(), uploadResult }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true, linkid, entityKind, uploadResult });
  }

  // ----- Diagnostics (optional helpers you used) -----
  if (path === "/api/admin/session/keys" && method === "GET") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const prefixes = ["onboard/", "link:", "session:", "sess:", "inprogress:"];
    const keysOut = [];
    for (const p of prefixes) {
      const l = await env.ONBOARD_KV.list({ prefix: p });
      for (const k of l.keys) {
        if (k.name.includes(linkid)) keysOut.push({ key: k.name, bytes: k.size || k.metadata?.size || 0 });
      }
    }
    const raw = await env.ONBOARD_KV.get(linkid);
    if (raw) keysOut.push({ key: linkid, bytes: raw.length });
    return json({ ok: true, linkid, keys: keysOut });
  }

  if (path === "/api/admin/session/get" && method === "GET") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    return json({ ok: true, linkid, found: !!sess, session: sess || null });
  }

  // ----- OTP: send -----
  if (path === "/api/otp/send" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) {
      return json({ ok: false, error: "WhatsApp credentials not configured" }, 500);
    }
    const splynxId = (linkid || "").split("_")[0];
    let msisdn = null;
    try {
      msisdn = await fetchCustomerMsisdn(env, splynxId);
    } catch {
      return json({ ok: false, error: "Splynx lookup failed" }, 502);
    }
    if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
    await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
    try {
      await sendWhatsAppTemplate(env, msisdn, code, "en");
      return json({ ok: true });
    } catch {
      try {
        await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`);
        return json({ ok: true, note: "sent-as-text" });
      } catch {
        return json({ ok: false, error: "WhatsApp send failed (template+text)" }, 502);
      }
    }
  }

  // ----- OTP: verify -----
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
          JSON.stringify({ ...sess, otp_verified: true, updated: Date.now() }),
          { expirationTtl: 86400 }
        );
      }
      if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
    }
    return json({ ok });
  }

  // ----- Uploads to R2 -----
  if (path === "/api/onboard/upload" && method === "POST") {
    const params = new URL(request.url).searchParams;
    const linkid = params.get("linkid");
    const fileName = params.get("filename") || "file.bin";
    const label = params.get("label") || "";
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Invalid link", { status: 404 });
    const body = await request.arrayBuffer();
    const key = `uploads/${linkid}/${Date.now()}_${fileName.replace(/[^a-z0-9_.-]/gi, "_")}`;
    await env.R2_UPLOADS.put(key, body);
    const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
    uploads.push({ key, name: fileName, size: body.byteLength, label });
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, uploads, updated: Date.now() }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true, key });
  }

  // ----- Save progress (capture audit meta) -----
  if (path.startsWith("/api/progress/") && method === "POST") {
    const linkid = path.split("/")[3];
    const body = await request.json().catch(() => ({}));
    const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const next = {
      ...existing,
      ...body,
      last_ip: getIP(),
      last_ua: getUA(),
      last_time: Date.now(),
      updated: Date.now(),
      audit_meta: existing.audit_meta || getClientMeta(request),
    };
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
    return json({ ok: true });
  }

  // ----- Debit save -----
  if (path === "/api/debit/save" && method === "POST") {
    const b = await request.json().catch(async () => {
      const form = await request.formData().catch(() => null);
      if (!form) return {};
      const o = {};
      for (const [k, v] of form.entries()) o[k] = v;
      return o;
    });
    const reqd = ["account_holder", "id_number", "bank_name", "account_number", "account_type", "debit_day"];
    for (const k of reqd) if (!b[k] || String(b[k]).trim() === "") return json({ ok: false, error: `Missing ${k}` }, 400);

    const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
    const ts = Date.now();
    const kvKey = `debit/${id}/${ts}`;
    const record = { ...b, splynx_id: id, created: ts, ip: getIP(), ua: getUA() };
    await env.ONBOARD_KV.put(kvKey, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 90 });

    const linkidParam = (b.linkid && String(b.linkid)) || url.searchParams.get("linkid") || "";
    if (linkidParam) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkidParam}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkidParam}`,
          JSON.stringify({ ...sess, debit: { ...record }, updated: Date.now() }),
          { expirationTtl: 86400 }
        );
      }
    }
    return json({ ok: true, ref: kvKey });
  }

  // ----- Debit signature -----
  if (path === "/api/debit/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
      return json({ ok: false, error: "Missing/invalid signature" }, 400);
    const png = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const sigKey = `debit_agreements/${linkid}/signature.png`;
    await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) {
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ ...sess, debit_signed: true, debit_sig_key: sigKey, updated: Date.now() }),
        { expirationTtl: 86400 }
      );
    }
    return json({ ok: true, sigKey });
  }

  // ----- Service agreement signature -----
  if (path === "/api/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
      return json({ ok: false, error: "Missing/invalid signature" }, 400);
    const png = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const sigKey = `agreements/${linkid}/signature.png`;
    await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown session" }, 404);
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, agreement_signed: true, agreement_sig_key: sigKey, status: "pending", updated: Date.now() }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true, sigKey });
  }

  // ----- Agreement signatures passthrough -----
  if (path.startsWith("/agreements/sig/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  }
  if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  }

  // ----- Agreement HTML (simple; terms-only view) -----
  if (path.startsWith("/agreements/") && method === "GET") {
    const [, , type, linkid] = path.split("/");
    if (!type || !linkid) return new Response("Bad request", { status: 400 });
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status: 404 });

    const esc = (s) => String(s || "").replace(/[&<>]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
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

  // ----- Splynx profile (for Personal Info step) -----
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

  // ----- PDF generators -----
  if (path.startsWith("/pdf/msa/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderMSAPdf(env, linkid);
  }
  if (path.startsWith("/pdf/debit/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderDebitPdf(env, linkid);
  }

  // ----- Onboarding UI -----
  if (path.startsWith("/onboard/") && method === "GET") {
    const linkid = path.split("/")[2] || "";
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Link expired or invalid", { status: 404 });
    return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return new Response("Not found", { status: 404 });
}
