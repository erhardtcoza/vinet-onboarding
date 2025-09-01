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
  mapEditsToSplynxPayload, // kept for future use
  detectEntityKind,
  uploadAllSessionFilesToSplynx, // kept for future use
} from "./splynx.js";
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "./constants.js";
import { deleteOnboardAll } from "./storage.js";
import { renderOnboardUI } from "./ui/onboard.js";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

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
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
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
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
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
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
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
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
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

  // ----- Admin review -----
  if (path === "/admin/review" && method === "GET") {
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
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
    if (!ipAllowed(request, env)) return new Response("Forbidden", { status: 403 });
    const { linkid, reason } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "rejected",
        reject_reason: String(reason || "").slice(