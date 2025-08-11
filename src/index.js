// src/index.js
// Cloudflare Worker for VINET Onboarding
// - Lead/Customer OTP via WhatsApp (template → plain text fallback)
// - Onboarding steps (EFT / Debit, details, uploads, agreements)
// - Admin dashboard (generate, pending/completed, review/approve/delete)
// - PDF generation (MSA & Debit Order) + final "Security audit" page (auto)
// - Splynx updates for both leads and customers, including billing_email
//
// Requires:
//  KV binding   : ONBOARD_KV
//  Env vars     : SPLYNX_API, SPLYNX_AUTH (Basic <base64>)
//                  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (optional)
//  npm deps     : pdf-lib

import { PDFDocument } from "pdf-lib";

// ---------- small utils ----------
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const nowIso = () => new Date().toISOString();

function rid(n = 6) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

async function kvGetJson(kv, key, def = null) {
  const s = await kv.get(key);
  if (!s) return def;
  try { return JSON.parse(s); } catch { return def; }
}
async function kvPutJson(kv, key, val, opts) {
  return kv.put(key, JSON.stringify(val), opts);
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPOST(env, endpoint, body, isForm = false) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  if (!isForm) headers["content-type"] = "application/json";
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers,
    body: isForm ? body : JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = await r.text().catch(() => "");
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${msg}`);
  }
  return r.json().catch(() => ({}));
}
async function splynxPUT(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${msg}`);
  }
  return r.json().catch(() => ({}));
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  const fields = [
    "phone_mobile",
    "mobile",
    "phone",
    "whatsapp",
    "msisdn",
    "primary_phone",
    "contact_number",
    "billing_phone",
  ];
  for (const f of fields) if (ok(obj[f])) return String(obj[f]).trim();

  if (Array.isArray(obj)) for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  if (typeof obj === "object" && obj) for (const k in obj) { const m = pickPhone(obj[k]); if (m) return m; }
  return null;
}

async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,               // ensure LEADS via admin endpoint
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try {
      const data = await splynxGET(env, ep);
      const m = pickPhone(data);
      if (m) return m;
    } catch {}
  }
  return null;
}

async function fetchProfileForDisplay(env, id) {
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street || src.street_1 || src.address || src.address_1 || "";
  const city = src.city || "";
  const zip = src.zip_code || src.zip || "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport ||
    src.id_number ||
    "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || "",
    billing_email: src.billing_email || "",
    phone: phone || "",
    city,
    street,
    zip,
    passport,
  };
}

// ---------- WhatsApp ----------
async function sendWhatsAppTemplate(env, msisdn, code) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID || !env.WHATSAPP_TEMPLATE)
    throw new Error("WA template not configured");
  const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: msisdn,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE,
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: code }] }],
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`WA template ${r.status}`);
  return true;
}
async function sendWhatsAppTextIfSessionOpen(env, msisdn, text) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID)
    throw new Error("WA text not configured");
  const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`;
  const body = { messaging_product: "whatsapp", to: msisdn, type: "text", text: { body: text } };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`WA text ${r.status}`);
  return true;
}

// ---------- PDF helpers ----------
const MSA_FIELDS = {
  full_name_p1: { page: 0, x: 125, y: 180, size: 11, w: 220 },
  passport_p1:  { page: 0, x: 125, y: 215, size: 11, w: 220 },
  client_code:  { page: 0, x: 145, y: 245, size: 11, w: 120 },
  sig_p1:       { page: 0, x: 400, y: 700, w: 120, h: 40 },

  full_name_p4: { page: 3, x: 400, y: 640, size: 11, w: 220 },
  sig_p4:       { page: 3, x: 400, y: 670, w: 120, h: 40 },
  date_p4:      { page: 3, x: 360, y: 700, size: 11, w: 120 },
};

const DEBIT_FIELDS = {
  account_holder: { page: 0, x:  60, y: 145, size: 11, w: 220 },
  id_number:      { page: 0, x:  65, y: 200, size: 11, w: 220 },
  bank_name:      { page: 0, x: 100, y: 245, size: 11, w: 220 },
  account_number: { page: 0, x:  95, y: 290, size: 11, w: 220 },
  account_type:   { page: 0, x:  80, y: 340, size: 11, w: 160 },
  debit_day:      { page: 0, x: 150, y: 395, size: 11, w: 50  },
  signature:      { page: 0, x: 110, y: 440, w: 120, h: 40 },
  date:           { page: 0, x: 100, y: 480, size: 11, w: 120 },
  client_code:    { page: 0, x: 170, y: 535, size: 11, w: 120 },
};

// In this sample we generate blank A4s and draw text/signature at coords.
// In your existing project, you probably have template PDFs in KV/R2 —
// you can swap the "create blank" with "load template bytes".
async function renderMSA(env, session, linkid) {
  const pdf = await PDFDocument.create();
  // Create 4 pages (to match coords)
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);

  const pages = pdf.getPages();
  const p1 = pages[0];
  const p4 = pages[3];

  const drawText = (page, t, x, y, size = 11) =>
    page.drawText(t || "", { x, y, size });

  drawText(p1, session.full_name || "", MSA_FIELDS.full_name_p1.x, MSA_FIELDS.full_name_p1.y, MSA_FIELDS.full_name_p1.size);
  drawText(p1, session.passport || "", MSA_FIELDS.passport_p1.x, MSA_FIELDS.passport_p1.y, MSA_FIELDS.passport_p1.size);
  drawText(p1, String(session.splynx_id || ""), MSA_FIELDS.client_code.x, MSA_FIELDS.client_code.y, MSA_FIELDS.client_code.size);

  // Signature boxes as a thin rectangle; if you store strokes as PNG, embed & draw here.
  p1.drawRectangle({ x: MSA_FIELDS.sig_p1.x, y: MSA_FIELDS.sig_p1.y, width: MSA_FIELDS.sig_p1.w, height: MSA_FIELDS.sig_p1.h, borderWidth: 0.5 });

  drawText(p4, session.full_name || "", MSA_FIELDS.full_name_p4.x, MSA_FIELDS.full_name_p4.y, MSA_FIELDS.full_name_p4.size);
  p4.drawRectangle({ x: MSA_FIELDS.sig_p4.x, y: MSA_FIELDS.sig_p4.y, width: MSA_FIELDS.sig_p4.w, height: MSA_FIELDS.sig_p4.h, borderWidth: 0.5 });
  drawText(p4, new Date().toLocaleDateString(), MSA_FIELDS.date_p4.x, MSA_FIELDS.date_p4.y, MSA_FIELDS.date_p4.size);

  // Append audit page
  addAuditPage(pdf, {
    ip: session.last_ip || "",
    ua: session.last_ua || "",
    platform: session.audit?.platform || "",
    tz: session.audit?.tz || "",
    locale: session.audit?.locale || "",
    linkid,
  });

  return await pdf.save();
}

async function renderDebit(env, session, linkid) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const p = pdf.getPages()[0];

  const drawText = (page, t, x, y, size = 11) =>
    page.drawText(t || "", { x, y, size });

  drawText(p, session.bank_account_holder || session.full_name || "", DEBIT_FIELDS.account_holder.x, DEBIT_FIELDS.account_holder.y, DEBIT_FIELDS.account_holder.size);
  drawText(p, session.passport || "", DEBIT_FIELDS.id_number.x, DEBIT_FIELDS.id_number.y, DEBIT_FIELDS.id_number.size);
  drawText(p, session.bank_name || "", DEBIT_FIELDS.bank_name.x, DEBIT_FIELDS.bank_name.y, DEBIT_FIELDS.bank_name.size);
  drawText(p, session.bank_account_number || "", DEBIT_FIELDS.account_number.x, DEBIT_FIELDS.account_number.y, DEBIT_FIELDS.account_number.size);
  drawText(p, session.bank_account_type || "", DEBIT_FIELDS.account_type.x, DEBIT_FIELDS.account_type.y, DEBIT_FIELDS.account_type.size);
  drawText(p, session.debit_day ? String(session.debit_day) : "", DEBIT_FIELDS.debit_day.x, DEBIT_FIELDS.debit_day.y, DEBIT_FIELDS.debit_day.size);
  p.drawRectangle({ x: DEBIT_FIELDS.signature.x, y: DEBIT_FIELDS.signature.y, width: DEBIT_FIELDS.signature.w, height: DEBIT_FIELDS.signature.h, borderWidth: 0.5 });
  drawText(p, new Date().toLocaleDateString(), DEBIT_FIELDS.date.x, DEBIT_FIELDS.date.y, DEBIT_FIELDS.date.size);
  drawText(p, String(session.splynx_id || ""), DEBIT_FIELDS.client_code.x, DEBIT_FIELDS.client_code.y, DEBIT_FIELDS.client_code.size);

  addAuditPage(pdf, {
    ip: session.last_ip || "",
    ua: session.last_ua || "",
    platform: session.audit?.platform || "",
    tz: session.audit?.tz || "",
    locale: session.audit?.locale || "",
    linkid,
  });

  return await pdf.save();
}

function addAuditPage(pdf, info) {
  const page = pdf.addPage([595, 842]);
  const left = 54, top = 780, lh = 18, size = 12;
  const lines = [
    "Security audit",
    "---------------------------",
    `Timestamp: ${new Date().toLocaleString()}`,
    `IP address: ${info.ip || "n/a"}`,
    `User-Agent: ${info.ua || "n/a"}`,
    `Platform: ${info.platform || "n/a"}`,
    `Time zone: ${info.tz || "n/a"}`,
    `Locale: ${info.locale || "n/a"}`,
    `Link ID: ${info.linkid || "n/a"}`,
  ];
  lines.forEach((t, i) => page.drawText(t, { x: left, y: top - i * lh, size }));
}

// ---------- Admin HTML ----------
function adminLayout(body, active = 1) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard</title>
<style>
:root{--red:#e2001a;}
body{font:16px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafafa;margin:0;color:#111}
.wrap{max-width:1000px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 6px 18px rgba(0,0,0,.06);padding:28px 28px 36px}
h1{display:flex;gap:.6em;align-items:center;justify-content:center;margin:10px 0 26px}
.badges{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin:10px 0 24px}
.badge{padding:12px 18px;border:2px solid var(--red);border-radius:18px;color:var(--red);font-weight:700}
.badge.active{background:var(--red);color:#fff}
.row{display:grid;grid-template-columns:140px 1fr 200px 160px;gap:10px;padding:10px 0;border-top:1px solid #eee;align-items:center}
.head{color:#666;font-size:.9em}
.btn{background:var(--red);color:#fff;border:none;padding:10px 16px;border-radius:10px;font-weight:700;cursor:pointer}
.btn-sm{padding:6px 12px;font-size:.9em}
.btn-outline{background:#fff;border:2px solid var(--red);color:var(--red);border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
.input{border:1px solid #ddd;border-radius:10px;padding:10px 12px;width:100%}
.note{color:#666;font-size:.85em}
a{color:var(--red);text-decoration:none}
.actions{display:flex;gap:8px;justify-content:flex-end}
</style>
<div class="wrap">
  <h1><img src="https://onboard.vinet.co.za/logo.svg" height="44" alt=""> Admin Dashboard</h1>
  <div class="badges">
    <a class="badge ${active===1?"active":""}" href="/admin">1. Generate onboarding link</a>
    <a class="badge ${active===2?"active":""}" href="/admin?tab=otp">2. Generate verification code</a>
    <a class="badge ${active===3?"active":""}" href="/admin?tab=pending">3. Pending (in-progress)</a>
    <a class="badge ${active===4?"active":""}" href="/admin?tab=completed">4. Completed (awaiting approval)</a>
    <a class="badge ${active===5?"active":""}" href="/admin?tab=approved">5. Approved</a>
  </div>
  ${body}
</div>`;
}

async function adminHome(env) {
  return adminLayout(`
  <form class="row" onsubmit="return go(event)">
    <div></div>
    <input class="input" id="id" placeholder="Splynx Lead/Customer ID">
    <button class="btn">Generate</button>
  </form>
  <script>
  async function go(e){
    e.preventDefault();
    const id = document.querySelector('#id').value.trim();
    if(!id) return;
    const r = await fetch('/api/admin/generate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    const j = await r.json();
    if(!j.ok) return alert(j.error||'Failed');
    prompt('Share this onboarding link', j.link);
  }
  </script>
  `, 1);
}

async function adminList(env, statusTab) {
  const tabIndex = { pending:3, completed:4, approved:5 }[statusTab] || 3;
  const keys = await env.ONBOARD_KV.list({ prefix: "session/" });
  let rows = [];
  for (const k of keys.keys) {
    const linkid = k.name.split("/")[1];
    const sess = await kvGetJson(env.ONBOARD_KV, k.name);
    if (!sess) continue;
    const status = sess.status || "pending";
    if ((statusTab === "pending"  && status !== "pending") ||
        (statusTab === "completed" && status !== "completed") ||
        (statusTab === "approved"  && status !== "approved")) continue;
    rows.push({ linkid, sess });
  }
  rows.sort((a,b)=> (b.sess.updated_at||"").localeCompare(a.sess.updated_at||""));

  return adminLayout(`
  <div class="row head"><div>Splynx ID</div><div>Link ID</div><div>Updated</div><div></div></div>
  ${rows.map(r => `
    <div class="row">
      <div>${r.sess.splynx_id}</div>
      <div>${r.linkid}</div>
      <div>${r.sess.updated_at || ""}</div>
      <div class="actions">
        <a class="btn-outline btn-sm" href="/admin/review?linkid=${encodeURIComponent(r.linkid)}">Open</a>
        <button class="btn-outline btn-sm" onclick="del('${r.linkid}')">Delete</button>
      </div>
    </div>`).join("") || `<p class="note">No records.</p>`}
  <script>
  async function del(linkid){
    if(!confirm('Delete '+linkid+' ? This revokes the link.')) return;
    const r = await fetch('/api/admin/delete', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
    const j = await r.json(); if(!j.ok) return alert(j.error||'Failed'); location.reload();
  }
  </script>
  `, tabIndex);
}

async function adminReview(env, linkid) {
  const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
  if (!sess) return html(adminLayout(`<p>Session not found.</p>`));
  const uploads = sess.uploads || {};
  const docRows = Object.keys(uploads).map(k => {
    const u = uploads[k];
    const title = (k === "id_doc" ? "ID Document" : (k === "proof_address" ? "Proof of Address" : k));
    return `<div class="row" style="grid-template-columns:1fr 180px;">
      <div><b>${title}</b> — ${u.name || ""} · ${u.size? (Math.round(u.size/1024)+' KB') : ''}</div>
      <div class="actions">
        <a class="btn-outline btn-sm" target="_blank" href="/api/admin/file/${encodeURIComponent(linkid)}/${encodeURIComponent(k)}">Download</a>
      </div>
    </div>`;
  }).join("");

  const agreements = sess.agreements || {};
  return html(adminLayout(`
  <div class="row" style="grid-template-columns:160px 1fr"><div><b>Edits</b></div><div></div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>full_name:</div><div>${sess.full_name||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>email:</div><div>${sess.email||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>billing_email:</div><div>${sess.billing_email||sess.email||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>phone:</div><div>${sess.phone||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>passport:</div><div>${sess.passport||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>street:</div><div>${sess.street||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>city:</div><div>${sess.city||""}</div></div>
  <div class="row" style="grid-template-columns:160px 1fr">
    <div>zip:</div><div>${sess.zip||""}</div></div>

  <div class="row" style="grid-template-columns:160px 1fr;margin-top:10px;"><div><b>Uploads</b></div><div></div></div>
  ${docRows || `<p class="note" style="margin-left:10px">No files uploaded.</p>`}

  <div class="row" style="grid-template-columns:160px 1fr;margin-top:14px;"><div><b>Agreements</b></div><div></div></div>
  <div class="row" style="grid-template-columns:1fr 180px;">
    <div><a target="_blank" href="/agreements/pdf/msa/${encodeURIComponent(linkid)}">MSA (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/msa/${encodeURIComponent(linkid)}?bbox=1">debug</a></div>
    <div class="actions"></div>
  </div>
  ${(sess.pay_method==='debit')?`
    <div class="row" style="grid-template-columns:1fr 180px;">
      <div><a target="_blank" href="/agreements/pdf/debit/${encodeURIComponent(linkid)}">Debit Order (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/debit/${encodeURIComponent(linkid)}?bbox=1">debug</a></div>
      <div class="actions"></div>
    </div>`:''}

  <div class="actions" style="margin-top:14px;">
    <button class="btn" onclick="approve()">Approve & Push</button>
    <button class="btn-outline" onclick="reject()">Reject</button>
    <button class="btn-outline" onclick="del()">Delete</button>
  </div>

  <div class="note" id="resp" style="margin-top:8px"></div>

  <script>
  async function approve(){
    const r = await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:'${linkid}'})});
    const j = await r.json(); document.querySelector('#resp').textContent = j.ok?'Approved/pushed.':(j.error||'Failed');
  }
  async function reject(){
    const r = await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:'${linkid}'})});
    const j = await r.json(); document.querySelector('#resp').textContent = j.ok?'Rejected.':(j.error||'Failed');
  }
  async function del(){
    if(!confirm('Delete session and revoke link?')) return;
    const r = await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:'${linkid}'})});
    const j = await r.json(); if(j.ok) location.href='/admin?tab=pending'; else document.querySelector('#resp').textContent=j.error||'Failed';
  }
  </script>
  `));
}

// ---------- Onboard HTML ----------
function pageStyle() {
  return `
  <style>
  :root{--red:#e2001a;}
  *{box-sizing:border-box}
  body{background:#fafafa;margin:0;font:16px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111}
  .wrap{max-width:820px;margin:40px auto;background:#fff;border-radius:16px;box-shadow:0 6px 18px rgba(0,0,0,.06);padding:26px}
  h1{margin:0 0 4px;display:flex;gap:.6em;align-items:center;justify-content:center}
  h2{margin:10px 0 16px}
  .bar{height:8px;background:#eee;border-radius:8px;margin:10px 0 18px;overflow:hidden}
  .bar > i{display:block;height:100%;width:30%;background:var(--red)}
  .field{margin:10px 0}
  label{display:block;margin:2px 0 6px;font-weight:700}
  input,select,textarea{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px}
  .btn{background:var(--red);color:#fff;border:none;padding:12px 16px;border-radius:10px;font-weight:700;cursor:pointer}
  .btn-outline{background:#fff;border:2px solid var(--red);color:var(--red);border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}
  .row{display:flex;gap:10px;align-items:center}
  .col2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .note{color:#666;font-size:.9em}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700;margin:8px 0}
  .bigchk input[type=checkbox]{width:22px;height:22px;accent-color:var(--red)}
  #otpForm .row{display:flex;gap:.6em;align-items:center}
  #otpForm input[name=otp]{flex:1;min-width:160px}
  #resend{display:inline-block;margin-top:.6em}
  canvas.sig{border:1px dashed #ccc;border-radius:10px;width:100%;height:160px}
  </style>`;
}

function onboardLayout(inner, step = 1) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VINET Onboarding</title>${pageStyle()}
<div class="wrap">
  <h1><img src="https://onboard.vinet.co.za/logo.svg" height="44" alt=""> </h1>
  <div class="bar"><i style="width:${Math.min(100, step*16)}%"></i></div>
  ${inner}
</div>`;
}

// Step 1 – OTP
function renderStep1(linkid, msg = "") {
  return onboardLayout(`
  <h2>Verify your identity</h2>
  <div id="wa">
    <div id="otpmsg" class="note" style="margin:.4em 0 1em;">${msg}</div>
    <form id="otpForm" autocomplete="off" class="field">
      <div class="row">
        <input name="otp" maxlength="6" pattern="\\d{6}" placeholder="6-digit code" required />
        <button class="btn" type="submit">Verify</button>
      </div>
    </form>
    <a class="btn-outline" id="resend" href="#">Resend code</a>
  </div>
  <script>
  const linkid=${JSON.stringify(linkid)};
  // kick off auto-capture of tz/platform/locale (stored with session)
  try{
    const audit={ tz:Intl.DateTimeFormat().resolvedOptions().timeZone||'', locale:navigator.language||'', platform:(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||'' };
    fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify({ audit })});
  }catch{}

  document.querySelector('#resend').addEventListener('click', async (e)=>{
    e.preventDefault();
    const r=await fetch('/api/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
    const j=await r.json(); document.querySelector('#otpmsg').textContent=j.ok?('Code sent'+(j.note?' ('+j.note+')':'')):(j.error||'Send failed');
  });
  document.querySelector('#otpForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const code=e.target.otp.value.trim();
    const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,code})});
    const j=await r.json(); if(!j.ok) return alert(j.error||'Invalid code');
    location.href='/onboard/'+encodeURIComponent(linkid)+'?s=2';
  });
  </script>
  `, 1);
}

// Step 2 – Payment method
function renderStep2(linkid, sess) {
  return onboardLayout(`
  <h2>Payment Method</h2>
  <div class="row" style="gap:8px;margin-bottom:10px">
    <button id="eft" class="btn" ${sess.pay_method==='eft'?'style="opacity:.9"':''}>EFT</button>
    <button id="debit" class="btn-outline" ${sess.pay_method==='debit'?'style="border-width:3px"':''}>Debit order</button>
  </div>

  <div id="debitForm" style="display:${sess.pay_method==='debit'?'block':'none'}">
    <div class="col2">
      <div class="field"><label>Bank Account Holder Name</label><input id="bank_account_holder"></div>
      <div class="field"><label>Bank Account Holder ID no</label><input id="bank_id"></div>
      <div class="field"><label>Bank</label><input id="bank_name"></div>
      <div class="field"><label>Bank account no</label><input id="bank_acc"></div>
      <div class="field"><label>Bank account type</label><input id="bank_type"></div>
      <div class="field"><label>Debit order date</label><select id="debit_day">${[...Array(28)].map((_,i)=>`<option ${i+1===1?'selected':''}>${i+1}</option>`).join('')}</select></div>
    </div>
    <div class="bigchk"><label><input type="checkbox" id="d_agree"> I agree to the Debit Order terms</label></div>
    <div class="field"><canvas id="sigD" class="sig"></canvas></div>
  </div>

  <div id="eftForm" style="display:${sess.pay_method!=='debit'?'block':'none'}">
    <div class="note">Please EFT to: First National Bank (FNB/RMB) · Account: Vinet Internet Solutions · Acc#: 62757054996 · Branch: 250655<br>
    Use your reference: <b>${sess.splynx_id}</b></div>
  </div>

  <div class="row" style="margin-top:12px">
    <a class="btn-outline" href="/onboard/${encodeURIComponent(linkid)}?s=1">Back</a>
    <div style="flex:1"></div>
    <button class="btn" id="next">Continue</button>
  </div>

  <script>
  const linkid=${JSON.stringify(linkid)};
  const state=${JSON.stringify({ pay_method:sess.pay_method||'eft' })};
  const el=(id)=>document.getElementById(id);
  el('eft').onclick=()=>{state.pay_method='eft';save();};
  el('debit').onclick=()=>{state.pay_method='debit';save();};
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).then(()=>location.reload()); }
  el('next').onclick=()=>location.href='/onboard/'+encodeURIComponent(linkid)+'?s=3';
  </script>
  `, 2);
}

// Step 3 – Verify details
function renderStep3(linkid, profile) {
  return onboardLayout(`
  <h2>Please verify your details and change if you see any errors</h2>
  <div class="col2">
    <div class="field"><label>Full name</label><input id="full_name" value="${escapeHtml(profile.full_name||"")}"></div>
    <div class="field"><label>ID / Passport</label><input id="passport" value="${escapeHtml(profile.passport||"")}"></div>
    <div class="field"><label>Email</label><input id="email" value="${escapeHtml(profile.email||"")}"></div>
    <div class="field"><label>Phone</label><input id="phone" value="${escapeHtml(profile.phone||"")}"></div>
    <div class="field"><label>Billing email</label><input id="billing_email" value="${escapeHtml(profile.billing_email||profile.email||"")}"></div>
    <div class="field"><label>City</label><input id="city" value="${escapeHtml(profile.city||"")}"></div>
    <div class="field"><label>Street</label><input id="street" value="${escapeHtml(profile.street||"")}"></div>
    <div class="field"><label>ZIP Code</label><input id="zip" value="${escapeHtml(profile.zip||"")}"></div>
  </div>

  <div class="row" style="margin-top:12px">
    <a class="btn-outline" href="/onboard/${encodeURIComponent(linkid)}?s=2">Back</a>
    <div style="flex:1"></div>
    <button class="btn" id="next">Continue</button>
  </div>

  <script>
  const linkid=${JSON.stringify(linkid)};
  document.getElementById('next').onclick=async()=>{
    const body={
      full_name:el('full_name').value,
      passport:el('passport').value,
      email:el('email').value,
      billing_email:el('billing_email').value,
      phone:el('phone').value,
      street:el('street').value,
      city:el('city').value,
      zip:el('zip').value
    };
    await fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(body)});
    location.href='/onboard/'+encodeURIComponent(linkid)+'?s=4';
  };
  function el(id){return document.getElementById(id)}
  </script>
  `, 3);
}

// Step 4 – Uploads
function renderStep4(linkid, sess) {
  return onboardLayout(`
  <h2>Upload supporting documents</h2>
  <div class="field">
    <label>ID Document</label>
    <input type="file" id="id_doc" accept="image/*,application/pdf">
  </div>
  <div class="field">
    <label>Proof of Address</label>
    <input type="file" id="proof" accept="image/*,application/pdf">
  </div>
  <div class="row" style="margin-top:12px">
    <a class="btn-outline" href="/onboard/${encodeURIComponent(linkid)}?s=3">Back</a>
    <div style="flex:1"></div>
    <button class="btn" id="next">Continue</button>
  </div>
  <script>
  const linkid=${JSON.stringify(linkid)};
  async function up(id,key){
    const f=document.getElementById(id).files[0]; if(!f) return;
    const b=await f.arrayBuffer();
    const r=await fetch('/api/upload/'+linkid+'/'+key,{method:'POST',headers:{'content-type':f.type||'application/octet-stream','x-filename':encodeURIComponent(f.name)},body:b});
    const j=await r.json(); if(!j.ok) alert(j.error||'Upload failed');
  }
  document.getElementById('next').onclick=async()=>{
    await up('id_doc','id_doc'); await up('proof','proof_address');
    location.href='/onboard/'+encodeURIComponent(linkid)+'?s=5';
  };
  </script>
  `, 4);
}

// Step 5 – Agreements (MSA; Debit optional)
function renderStep5(linkid, sess) {
  return onboardLayout(`
  <h2>Master Service Agreement</h2>
  <div class="bigchk"><label><input type="checkbox" id="agreeChk"> I agree to the terms of service as below.</label></div>
  <div class="field"><textarea rows="10" readonly>The Master Service agreement text...</textarea></div>
  <div class="field"><canvas id="sig" class="sig"></canvas></div>
  <div class="row" style="margin-top:12px">
    <a class="btn-outline" href="/onboard/${encodeURIComponent(linkid)}?s=4">Back</a>
    <div style="flex:1"></div>
    <button class="btn" id="next">Agree & Sign</button>
  </div>

  <script>
  const linkid=${JSON.stringify(linkid)};
  const c=document.getElementById('sig'); const ctx=c.getContext('2d');
  let d=false,prev=null;
  c.addEventListener('pointerdown',e=>{d=true;prev=[e.offsetX,e.offsetY]});
  c.addEventListener('pointerup',()=>d=false);
  c.addEventListener('pointermove',e=>{ if(!d) return; ctx.beginPath(); ctx.moveTo(prev[0],prev[1]); ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); prev=[e.offsetX,e.offsetY]; });

  document.getElementById('next').onclick=async()=>{
    if(!document.getElementById('agreeChk').checked) return alert('Please tick the agreement checkbox.');
    const sig = c.toDataURL('image/png');
    await fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify({ msa_signed:true, msa_signature:sig })});
    location.href='/onboard/'+encodeURIComponent(linkid)+'?s=6';
  };
  </script>
  `, 5);
}

// Step 6 – Done
function renderDone(linkid, sess) {
  return onboardLayout(`
  <h2>All set!</h2>
  <p>Thanks — we’ve recorded your information. Our team will be in contact shortly.
  If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>
  <hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">

  <div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>
  <ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">
    <li><a href="/agreements/pdf/msa/${encodeURIComponent(linkid)}" target="_blank">Master Service Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/msa/${encodeURIComponent(linkid)}?bbox=1">debug</a></li>
    ${(sess.pay_method==='debit')?`<li><a href="/agreements/pdf/debit/${encodeURIComponent(linkid)}" target="_blank">Debit Order Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/debit/${encodeURIComponent(linkid)}?bbox=1">debug</a></li>`:''}
  </ul>
  `, 6);
}

// ---------- escape helper ----------
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// ---------- API routes ----------
async function apiGenerate(env, body) {
  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing ID" }, 400);
  const linkid = `${id}_${rid(8)}`;
  const profile = await fetchProfileForDisplay(env, id);
  const sess = {
    linkid,
    splynx_id: id,
    splynx_kind: profile.kind,
    status: "pending",
    updated_at: nowIso(),
    pay_method: "eft",
    ...profile,
  };
  await kvPutJson(env.ONBOARD_KV, `session/${linkid}`, sess);
  await env.ONBOARD_KV.put(`link/${linkid}`, "1", { expirationTtl: 60 * 60 * 24 * 14 }); // revoke if deleted
  return json({ ok: true, link: `https://onboard.vinet.co.za/onboard/${encodeURIComponent(linkid)}` });
}

async function apiDelete(env, { linkid }) {
  if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
  await env.ONBOARD_KV.delete(`session/${linkid}`);
  await env.ONBOARD_KV.delete(`link/${linkid}`);
  await env.ONBOARD_KV.delete(`otp/${linkid}`);
  await env.ONBOARD_KV.delete(`otp_msisdn/${linkid}`);
  return json({ ok: true });
}

async function apiApprove(env, { linkid }) {
  const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
  if (!sess) return json({ ok: false, error: "Not found" }, 404);
  const id = sess.splynx_id;

  // Update fields (lead or customer). Include billing_email.
  if (sess.splynx_kind === "lead") {
    const updates = {
      name: sess.full_name || undefined,
      email: sess.email || undefined,
      billing_email: sess.billing_email || undefined,
      phone: sess.phone || undefined,
      street_1: sess.street || undefined,
      city: sess.city || undefined,
      zip_code: sess.zip || undefined,
    };
    await splynxPUT(env, `/admin/crm/leads/${id}`, updates);
  } else {
    const updates = {
      full_name: sess.full_name || undefined,
      email: sess.email || undefined,
      billing_email: sess.billing_email || undefined,
      phone: sess.phone || undefined,
      street: sess.street || undefined,
      city: sess.city || undefined,
      zip_code: sess.zip || undefined,
    };
    await splynxPUT(env, `/admin/customers/customer/${id}`, updates);
  }

  // Update passport in customer-info (works for customers; for leads it’s ignored)
  try {
    if (sess.passport)
      await splynxPUT(env, `/admin/customers/customer-info/${id}`, { passport: sess.passport });
  } catch {}

  // Upload documents (try both lead & customer endpoints with retries for "type")
  const docs = [];
  const uploads = sess.uploads || {};
  if (uploads.id_doc) docs.push({ key: "id_doc", title: "ID Document" });
  if (uploads.proof_address) docs.push({ key: "proof_address", title: "Proof of Address" });

  for (const d of docs) {
    const u = uploads[d.key];
    if (!u || !u.data) continue;
    const bin = Uint8Array.from(atob(u.data.split(",")[1] || ""), c => c.charCodeAt(0));
    const tryUpload = async (endpoint) => {
      const form = new FormData();
      form.append("title", d.title);
      // Splynx is picky here; provide both source & type variants and let server accept whichever it knows.
      form.append("type", "other");
      form.append("source", "manual");
      form.append("visible_by_customer", "0");
      form.append("file", new File([bin], u.name || `${d.title}.bin`, { type: u.type || "application/octet-stream" }));
      try { await splynxPOST(env, endpoint, form, true); return true; } catch (e) {
        // Retry with alternate "type" values if server complains
        try {
          const form2 = new FormData();
          form2.append("title", d.title);
          form2.append("type", "document");
          form2.append("visible_by_customer", "0");
          form2.append("file", new File([bin], u.name || `${d.title}.bin`, { type: u.type || "application/octet-stream" }));
          await splynxPOST(env, endpoint, form2, true);
          return true;
        } catch {}
      }
      return false;
    };

    let ok = false;
    // lead first if it is a lead, otherwise customer first
    if (sess.splynx_kind === "lead") {
      ok = (await tryUpload(`/admin/crm/leads/${id}/documents`)) || (await tryUpload(`/admin/customers/customer/${id}/documents`));
    } else {
      ok = (await tryUpload(`/admin/customers/customer/${id}/documents`)) || (await tryUpload(`/admin/crm/leads/${id}/documents`));
    }
    if (!ok) console.warn("Upload failed for", id, d.key);
  }

  sess.status = "approved";
  sess.updated_at = nowIso();
  await kvPutJson(env.ONBOARD_KV, `session/${linkid}`, sess);
  return json({ ok: true });
}

async function saveUpload(env, linkid, key, request) {
  const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
  if (!sess) return json({ ok: false, error: "Not found" }, 404);
  const ctype = request.headers.get("content-type") || "application/octet-stream";
  const fname = decodeURIComponent(request.headers.get("x-filename") || "") || `${key}.bin`;
  const buf = new Uint8Array(await request.arrayBuffer());
  const b64 = `data:${ctype};base64,${btoa(String.fromCharCode(...buf))}`;
  sess.uploads = sess.uploads || {};
  sess.uploads[key] = { name: fname, type: ctype, size: buf.byteLength, data: b64 };
  sess.updated_at = nowIso();
  await kvPutJson(env.ONBOARD_KV, `session/${linkid}`, sess);
  return json({ ok: true });
}

// ---------- Router ----------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // revoke if link deleted
      if (path.startsWith("/onboard/")) {
        const linkid = decodeURIComponent(path.split("/")[2] || "");
        const exists = await env.ONBOARD_KV.get(`link/${linkid}`);
        if (!exists) return html("<pre>Link expired or invalid</pre>", 404);

        // write last seen ip/ua
        if (request.method === "GET") {
          const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
          if (sess) {
            sess.last_ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
            sess.last_ua = request.headers.get("User-Agent") || "";
            sess.updated_at = nowIso();
            await kvPutJson(env.ONBOARD_KV, `session/${linkid}`, sess);
          }
        }

        // router within onboarding steps
        const s = Number(url.searchParams.get("s") || "1");
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
        if (!sess) return html("<pre>Link expired or invalid</pre>", 404);

        if (s === 1) return html(renderStep1(linkid, "Use WhatsApp OTP or ask staff for a code."));
        if (s === 2) return html(renderStep2(linkid, sess));
        if (s === 3) {
          const profile = await fetchProfileForDisplay(env, sess.splynx_id);
          // merge already edited values so the form shows the latest
          const merged = { ...profile, ...sess };
          return html(renderStep3(linkid, merged));
        }
        if (s === 4) return html(renderStep4(linkid, sess));
        if (s === 5) return html(renderStep5(linkid, sess));
        if (s === 6) return html(renderDone(linkid, sess));
        return html(renderStep1(linkid));
      }

      // Admin pages
      if (path === "/admin" && request.method === "GET") {
        const tab = (new URL(request.url)).searchParams.get("tab") || "generate";
        if (tab === "generate") return html(await adminHome(env));
        if (tab === "otp") return html(await adminHome(env)); // simple
        if (tab === "pending") return html(await adminList(env, "pending"));
        if (tab === "completed") return html(await adminList(env, "completed"));
        if (tab === "approved") return html(await adminList(env, "approved"));
        return html(await adminHome(env));
      }
      if (path === "/admin/review" && request.method === "GET") {
        const linkid = url.searchParams.get("linkid");
        if (!linkid) return html(adminLayout("<p>Missing linkid</p>"));
        return await adminReview(env, linkid);
      }

      // Admin APIs
      if (path === "/api/admin/generate" && request.method === "POST") {
        const body = await request.json().catch(()=> ({}));
        return await apiGenerate(env, body);
      }
      if (path === "/api/admin/delete" && request.method === "POST") {
        const body = await request.json().catch(()=> ({}));
        return await apiDelete(env, body);
      }
      if (path === "/api/admin/approve" && request.method === "POST") {
        const body = await request.json().catch(()=> ({}));
        return await apiApprove(env, body);
      }
      if (path === "/api/admin/reject" && request.method === "POST") {
        const body = await request.json().catch(()=> ({}));
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${body.linkid}`);
        if (!sess) return json({ ok:false, error:"Not found" }, 404);
        sess.status = "pending";
        await kvPutJson(env.ONBOARD_KV, `session/${body.linkid}`, sess);
        return json({ ok:true });
      }
      if (path.startsWith("/api/admin/file/") && request.method === "GET") {
        const [, , , linkid, key] = path.split("/");
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
        if (!sess || !sess.uploads || !sess.uploads[key]) return new Response("Not found", { status:404 });
        const u = sess.uploads[key];
        const bstr = atob(String(u.data).split(",")[1] || "");
        const bin = new Uint8Array([...bstr].map(c=>c.charCodeAt(0)));
        return new Response(bin, { headers:{ "content-type":u.type || "application/octet-stream", "content-disposition":`attachment; filename="${u.name || key}"` }});
      }

      // OTP APIs
      if (path === "/api/otp/send" && request.method === "POST") {
        const { linkid } = await request.json().catch(()=> ({}));
        if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
        if (!sess) return json({ ok:false, error:"Not found" }, 404);
        const msisdn = await fetchCustomerMsisdn(env, sess.splynx_id);
        if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

        const code = String(Math.floor(100000 + Math.random()*900000));
        await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
        await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
        try { await sendWhatsAppTemplate(env, msisdn, code); return json({ ok:true }); }
        catch { try { await sendWhatsAppTextIfSessionOpen(env, msisdn, 'Your Vinet verification code is: ' + code); return json({ ok:true, note:'sent-as-text' }); }
          catch { return json({ ok:false, error:'WhatsApp send failed (template+text)' }, 502); } }
      }
      if (path === "/api/otp/verify" && request.method === "POST") {
        const { linkid, code } = await request.json().catch(()=> ({}));
        const exp = await env.ONBOARD_KV.get(`otp/${linkid}`);
        if (exp && exp === code) return json({ ok:true });
        return json({ ok:false, error:"Invalid code" }, 400);
      }

      // Save progress / audit
      if (path.startsWith("/api/progress/") && request.method === "POST") {
        const linkid = decodeURIComponent(path.split("/")[3] || "");
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
        if (!sess) return json({ ok:false, error:"Not found" }, 404);
        const patch = await request.json().catch(()=> ({}));
        const merged = { ...sess, ...patch, updated_at: nowIso() };
        if (patch.audit) merged.audit = { ...(sess.audit||{}), ...patch.audit };
        await kvPutJson(env.ONBOARD_KV, `session/${linkid}`, merged);
        return json({ ok:true });
      }

      // Uploads
      if (path.startsWith("/api/upload/") && request.method === "POST") {
        const [, , , linkid, key] = path.split("/");
        return await saveUpload(env, linkid, key, request);
      }

      // PDFs
      if (path.startsWith("/agreements/pdf/") && request.method === "GET") {
        const [, , , kind, linkid] = path.split("/");
        const sess = await kvGetJson(env.ONBOARD_KV, `session/${linkid}`);
        if (!sess) return new Response("Not found", { status: 404 });
        const bytes = (kind === "msa") ? await renderMSA(env, sess, linkid) : await renderDebit(env, sess, linkid);
        return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${kind.toUpperCase()}_${sess.splynx_id}_${rid(6)}.pdf"` } });
      }

      // fallback
      if (path === "/" || path === "/index.html") return html(await adminHome(env));

      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500);
    }
  },
};
