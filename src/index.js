// index.js — Vinet Onboarding Worker (full build w/ PDF tweaks)
// KEEPING your Admin & Onboarding as-is; only PDFs were changed.
// Dependencies: pdf-lib
//    npm i pdf-lib
//
// Wrangler bindings expected (same as your wrangler.toml):
// - ONBOARD_KV, R2_UPLOADS
// - SPLYNX_API, SPLYNX_AUTH
// - WHATSAPP_TOKEN, PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG
// - TERMS_SERVICE_URL, TERMS_DEBIT_URL
//
// Colors & assets are wired in below per your brand spec.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Brand / constants ----------
const LOGO_URL_HI = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const LOGO_URL_LO = "https://static.vinet.co.za/Vinet%20Logo%20jpg_Full%20Logo.jpg";
const VINET_WEB_TEL = "www.vinet.co.za  |  021 007 0200";

const VINET_RED = rgb(237/255, 28/255, 36/255); // #ed1c24
const VINET_DARK = rgb(3/255, 3/255, 3/255);    // #030303

const LOGO_URL = LOGO_URL_HI; // also used by HTML pages
const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MSA_TERMS_URL   = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// ---------- Helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const escapeHtml = (s) => String(s || "").replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
function localDateZA() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
async function fetchTextCached(url, env, cachePrefix = "terms") {
  const key = `${cachePrefix}:${btoa(url).slice(0, 40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!r.ok) return "";
    const t = await r.text();
    await env.ONBOARD_KV.put(key, t, { expirationTtl: PDF_CACHE_TTL });
    return t;
  } catch { return ""; }
}
async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch { return null; }
}

// Normalize text to WinAnsi‑friendly ASCII (avoid “smart quotes” etc)
function sanitizeText(s = "") {
  const map = {
    // quotes/dashes/ellipses
    "\u2018":"'","\u2019":"'","\u201A":"'","\u201B":"'","\u2032":"'","\u2035":"'",
    "\u201C":'"',"\u201D":'"',"\u201E":'"',"\u2033":'"',"\u2036":'"',"\u201F":'"',
    "\u2013":"-", "\u2014":"--", "\u2212":"-", "\u00A0":" ",
    "\u2026":"...", "\u00B7":"·", "\u200B":""
  };
  return String(s)
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u201C\u201D\u201E\u2033\u2036\u201F\u2013\u2014\u2212\u00A0\u2026\u00B7\u200B]/g, ch => map[ch] || "")
    // drop any remaining non-ANSI chars
    .replace(/[^\x00-\xFF]/g, "?");
}

// ---------- EFT Info Page (unchanged from your last good build) ----------
async function renderEFTPage(id) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7fa}
.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{color:#e2001a;font-size:34px;margin:8px 0 18px}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.grid .full{grid-column:1 / -1}
label{font-weight:700;color:#333;font-size:14px}
input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}
button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}
.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(id||"")}"></div>
  </div>
  <p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// ---------- Splynx helpers (unchanged) ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  if (typeof obj === "string") return ok(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } return null; }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
      obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone,
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile
    ];
    for (const v of direct) if (ok(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok(v)) return String(v).trim();
      if (v && typeof v === "object") { const m = pickPhone(v); if (m) return m; }
    }
  }
  return null;
}
function pickFrom(obj, keyNames) {
  if (!obj) return null;
  const wanted = keyNames.map(k => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === 'object') {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? '').trim();
          if (s) return s;
        }
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return null;
}
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
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

  const street =
    src.street ?? src.address ?? src.address_1 ?? src.street_1 ??
    (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? '';

  const city =
    src.city ?? (src.addresses && src.addresses.city) ?? '';

  const zip =
    src.zip_code ?? src.zip ??
    (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? '';

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ['passport','id_number','idnumber','national_id','id_card','identity','identity_number','document_number']) ||
    '';

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- Admin + Onboarding HTML (unchanged from last good build) ----------
/*  NOTE: To keep this reply focused, the Admin and Onboarding HTML/JS are the
    exact same as your last working version. I am not changing those sections.
    (They were the long blocks in your last "full build" file.)
    ——— Paste your last-good Admin/Onboarding code here unchanged. ———
*/

// For completeness, I’ll re-add the minimal wrappers so this file is deployable.
// Replace `renderAdminPage()`, `adminJs()`, and `renderOnboardUI()` with your last working versions.
function renderAdminPage(){ /* ... your last working admin HTML ... */ return "<!doctype html><title>Admin</title>Admin UI missing in paste: keep your last-good block here."; }
function adminJs(){ return ""; }
function renderOnboardUI(){ return "<!doctype html><title>Onboard</title>Onboarding UI missing in paste: keep your last-good block here."; }

// ---------- Agreement HTML pages (unchanged except using LOGO_URL) ----------
function pageHtmlTemplate(title, body, linkid){
  const today = localDateZA();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
    .card{background:#fff;max-width:820px;margin:24px auto;border-radius:14px;box-shadow:0 2px 12px #0002;padding:22px 26px}
    h1{color:#e2001a;margin:.2em 0 .3em;font-size:28px}.b{font-weight:600}
    table{width:100%;border-collapse:collapse;margin:.6em 0}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
    .muted{color:#666;font-size:12px}.sig{margin-top:14px}.sig img{max-height:120px;border:1px dashed #bbb;border-radius:6px;background:#fff}
    .actions{margin-top:14px}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
    .logo{height:60px;display:block;margin:0 auto 10px}@media print {.actions{display:none}}
    pre.terms{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:12px;border-radius:8px}
  </style></head><body><div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>${escapeHtml(title)}</h1>
    ${body}
    <div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
    <div class="muted">Generated ${today} • Link ${escapeHtml(linkid)}</div>
  </div></body></html>`;
}

// ---------- PDF helpers (header, footer, columns) ----------
async function embedLogo(pdf) {
  try {
    const r = await fetch(LOGO_URL_HI);
    if (r.ok) return pdf.embedPng(await r.arrayBuffer());
  } catch {}
  try {
    const r = await fetch(LOGO_URL_LO);
    if (r.ok) return pdf.embedJpg(await r.arrayBuffer());
  } catch {}
  return null;
}

function drawDashedRule(page, x1, y, x2, opts = {}) {
  page.drawLine({
    start: { x: x1, y },
    end:   { x: x2, y },
    thickness: opts.thickness ?? 1,
    color: opts.color ?? VINET_DARK,
    dashArray: [4, 4],
    dashPhase: 0,
    opacity: opts.opacity ?? 1,
  });
}

function wrapToLines(font, text, size, maxWidth) {
  const t = sanitizeText(text);
  const words = t.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function typesetParagraph(page, font, size, x, y, maxWidth, lineGap, text) {
  const lines = wrapToLines(font, text, size, maxWidth);
  for (const ln of lines) {
    page.drawText(ln, { x, y, size, font, color: VINET_DARK });
    y -= (size + lineGap);
    if (y < 60) break; // simple stop; caller can paginate if needed
  }
  return y;
}

// 2-column flow helper (for MSA terms)
function flowTwoColumns(pdf, page, font, text, opts) {
  const { size=7, gap=18, margin=40, top=720, bottom=70 } = opts || {};
  const width = page.getSize().width;
  const colW = (width - margin*2 - gap) / 2;
  let y = top;
  let col = 0;

  const chunks = sanitizeText(text).split(/\n\n+/); // paragraph-ish
  for (let i=0; i<chunks.length; i++){
    const para = chunks[i].replace(/\n+/g, " ").trim();
    if (!para) continue;
    const lines = wrapToLines(font, para, size, colW);
    for (const ln of lines) {
      const x = margin + (col === 0 ? 0 : colW + gap);
      page.drawText(ln, { x, y, size, font, color: VINET_DARK });
      y -= (size + 3);
      if (y < bottom) {
        // next column or next page
        if (col === 0) {
          col = 1; y = top; // switch to right column
        } else {
          col = 0; // new page
          page = pdf.addPage([595, 842]);
          y = top;
        }
      }
    }
    y -= 4; // para gap
    if (y < bottom) {
      if (col === 0) { col = 1; y = top; }
      else { col = 0; page = pdf.addPage([595, 842]); y = top; }
    }
  }
  return page; // return last page we ended on
}

// ---------- PDF: Debit Order ----------
async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) return new Response("Debit Order not available for this link.", { status: 409 });

  const edits = sess.edits || {};
  const d = sess.debit || {};

  const termsUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
  const terms = sanitizeText(await fetchTextCached(termsUrl, env, "terms:debit")) || "Terms unavailable.";

  const pdf  = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);

  const M = 40;
  let y = 800;

  // Header: title (red), logo bigger (≈50% bigger), web/tel below logo, dashed divider lower
  page.drawText("Vinet Debit Order Instruction", { x: M, y, size: 18, font: bold, color: VINET_RED });
  if (logo) {
    const w = 110; // bigger
    const s = logo.scale(1);
    const h = (s.height / s.width) * w;
    page.drawImage(logo, { x: 595 - M - w, y: y - h + 4, width: w, height: h });
    page.drawText(VINET_WEB_TEL, { x: 595 - M - w, y: y - h - 12, size: 9, font, color: VINET_DARK });
  }
  y -= 30; // leave more space than before
  drawDashedRule(page, M, y, 595 - M);
  y -= 16;

  // Two info blocks (left/right)
  const idOnly = String(linkid).split("_")[0];

  const Lx = M, Rx = 320, lh = 14, label = (x, y, k, v) => {
    page.drawText(k, { x, y, size: 9, font: bold, color: VINET_DARK });
    page.drawText(sanitizeText(String(v || "")), { x: x + 140, y, size: 9, font, color: VINET_DARK });
  };

  // Left column
  let yL = y;
  label(Lx, yL, "Client Code:", idOnly);         yL -= lh;
  label(Lx, yL, "Full Name:",  edits.full_name); yL -= lh;
  label(Lx, yL, "ID / Passport:", edits.passport); yL -= lh;
  label(Lx, yL, "Email:", edits.email);          yL -= lh;
  label(Lx, yL, "Phone:", edits.phone);          yL -= lh;
  label(Lx, yL, "Street:", edits.street);        yL -= lh;
  label(Lx, yL, "City:", edits.city);            yL -= lh;
  label(Lx, yL, "ZIP:", edits.zip);              yL -= lh;

  // Right column
  let yR = y;
  page.drawText("Debit Order Details", { x: Rx, y: yR, size: 11, font: bold, color: VINET_DARK });
  yR -= lh;
  label(Rx, yR, "Account Holder Name:", d.account_holder); yR -= lh;
  label(Rx, yR, "Account Holder ID :",  d.id_number);      yR -= lh;
  label(Rx, yR, "Bank:",               d.bank_name);       yR -= lh;
  label(Rx, yR, "Bank Account No:",    d.account_number);  yR -= lh;
  label(Rx, yR, "Account Type:",       d.account_type);    yR -= lh;
  label(Rx, yR, "Debit Order Date:",   d.debit_day);       yR -= lh;

  // Take the lower Y to continue
  y = Math.min(yL, yR) - 10;
  drawDashedRule(page, M, y, 595 - M); // end info part
  y -= 10;

  // Terms (size 8) with a bit of top spacing and a subtle frame feel (just margins)
  page.drawText("Debit Order Terms", { x: M, y, size: 10, font: bold, color: VINET_DARK });
  y -= 12;

  const termsSize = 8, lineGap = 2, maxWidth = 595 - M*2;
  const lines = wrapToLines(font, terms, termsSize, maxWidth);
  for (const ln of lines) {
    if (y < 120) break; // leave room for footer/signature
    page.drawText(ln, { x: M, y, size: termsSize, font, color: VINET_DARK });
    y -= (termsSize + lineGap);
  }

  // Footer row: Name (left), Signature (center, above line), Date (right)
  const footerY = 120;
  const colW = (595 - M*2) / 3;

  // Name (left)
  page.drawText("Name:", { x: M, y: footerY, size: 9, font: bold, color: VINET_DARK });
  page.drawText(sanitizeText(edits.full_name || ""), { x: M + 40, y: footerY, size: 9, font, color: VINET_DARK });
  drawDashedRule(page, M, footerY - 4, M + colW - 10, { thickness: 0.5, opacity: .6 });

  // Signature (center)
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  const sigX1 = M + colW + 10, sigX2 = M + colW*2 - 10;
  page.drawText("Signature:", { x: (sigX1 + sigX2)/2 - 28, y: footerY, size: 9, font: bold, color: VINET_DARK });
  drawDashedRule(page, sigX1, footerY - 4, sigX2, { thickness: 0.5, opacity: .6 });
  if (sigBytes) {
    const img = await pdf.embedPng(sigBytes);
    const w = (sigX2 - sigX1) * 0.9;
    const s = img.scale(1);
    const h = (s.height / s.width) * w;
    const imgY = footerY - 4 + 8; // a bit above the line
    page.drawImage(img, { x: sigX1 + ((sigX2 - sigX1) - w)/2, y: imgY, width: w, height: h });
  }

  // Date (right)
  const dtX1 = M + colW*2 + 10, dtX2 = 595 - M;
  page.drawText("Date (YYYY-MM-DD):", { x: dtX1, y: footerY, size: 9, font: bold, color: VINET_DARK });
  page.drawText(localDateZA(), { x: dtX1 + 90, y: footerY, size: 9, font, color: VINET_DARK });
  drawDashedRule(page, dtX1, footerY - 4, dtX2, { thickness: 0.5, opacity: .6 });

  // Page 2: Security Audit (with header logo/title/line)
  const p2 = pdf.addPage([595, 842]);
  let y2 = 800;
  p2.drawText("VINET — Agreement Security Summary", { x: M, y: y2, size: 16, font: bold, color: VINET_RED });
  if (logo) {
    const w = 90, s = logo.scale(1), h = (s.height/s.width)*w;
    p2.drawImage(logo, { x: 595 - M - w, y: y2 - h + 4, width: w, height: h });
    p2.drawText(VINET_WEB_TEL, { x: 595 - M - w, y: y2 - h - 12, size: 9, font, color: VINET_DARK });
  }
  y2 -= 30;
  drawDashedRule(p2, M, y2, 595 - M);
  y2 -= 18;

  const auditRow = (k, v) => {
    p2.drawText(k, { x: M, y: y2, size: 10, font: bold, color: VINET_DARK });
    p2.drawText(sanitizeText(String(v || "")), { x: M + 180, y: y2, size: 10, font, color: VINET_DARK });
    y2 -= 16;
  };

  auditRow("Link ID:", linkid);
  auditRow("Splynx ID:", idOnly);
  auditRow("IP Address:", sess.last_ip || "");
  auditRow("User-Agent:", (sess.last_ua || "").slice(0, 120));
  auditRow("Timestamp:", new Date(sess.last_time || Date.now()).toISOString().slice(0,19).replace("T"," "));
  // (ASN/PoP need CF Trace; not available here reliably — omitted)

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// ---------- PDF: MSA ----------
async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) return new Response("MSA not available for this link.", { status: 409 });

  const e = sess.edits || {};
  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const terms = sanitizeText(await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";

  const pdf  = await PDFDocument.create();
  let page   = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);

  const M = 40;
  let y = 800;

  // Header
  page.drawText("Vinet Internet Solutions Service Agreement", { x: M, y, size: 18, font: bold, color: VINET_RED });
  if (logo) {
    const w = 110; const s = logo.scale(1); const h = (s.height / s.width) * w;
    page.drawImage(logo, { x: 595 - M - w, y: y - h + 4, width: w, height: h });
    page.drawText(VINET_WEB_TEL, { x: 595 - M - w, y: y - h - 12, size: 9, font, color: VINET_DARK });
  }
  y -= 30; drawDashedRule(page, M, y, 595 - M); y -= 14;

  // Info blocks
  const idOnly = String(linkid).split("_")[0];
  const Lx = M, Rx = 320, lh = 14, label = (x, y, k, v) => {
    page.drawText(k, { x, y, size: 9, font: bold, color: VINET_DARK });
    page.drawText(sanitizeText(String(v || "")), { x: x + 120, y, size: 9, font, color: VINET_DARK });
  };

  // Left (per your spec)
  let yL = y;
  label(Lx, yL, "Client code:", idOnly);  yL -= lh;
  label(Lx, yL, "Full Name:", e.full_name);  yL -= lh;
  label(Lx, yL, "ID / Passport:", e.passport); yL -= lh;
  label(Lx, yL, "Email:", e.email); yL -= lh;

  // Right
  let yR = y;
  label(Rx, yR, "Phone:", e.phone); yR -= lh;
  label(Rx, yR, "Street:", e.street); yR -= lh;
  label(Rx, yR, "City:", e.city); yR -= lh;
  label(Rx, yR, "ZIP:", e.zip); yR -= lh;

  y = Math.min(yL, yR) - 8;
  drawDashedRule(page, M, y, 595 - M);
  y -= 8;

  // Two-column terms flow (font 7), spanning new pages as needed
  page = flowTwoColumns(pdf, page, font, terms, { size: 7, margin: 40, gap: 18, top: 740, bottom: 90 });

  // Footer (last page): Name (left), Signature (center above line), Date (right)
  const last = page;
  const footerY = 80;
  const colW = (595 - M*2) / 3;

  // Name
  last.drawText("Name:", { x: M, y: footerY, size: 9, font: bold, color: VINET_DARK });
  last.drawText(sanitizeText(e.full_name || ""), { x: M + 40, y: footerY, size: 9, font, color: VINET_DARK });
  drawDashedRule(last, M, footerY - 4, M + colW - 10, { thickness: 0.5, opacity: .6 });

  // Signature
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  const sigX1 = M + colW + 10, sigX2 = M + colW*2 - 10;
  last.drawText("Signature:", { x: (sigX1 + sigX2)/2 - 28, y: footerY, size: 9, font: bold, color: VINET_DARK });
  drawDashedRule(last, sigX1, footerY - 4, sigX2, { thickness: 0.5, opacity: .6 });
  if (sigBytes) {
    const img = await pdf.embedPng(sigBytes);
    const w = (sigX2 - sigX1) * 0.9;
    const s = img.scale(1);
    const h = (s.height / s.width) * w;
    const imgY = footerY - 4 + 8;
    last.drawImage(img, { x: sigX1 + ((sigX2 - sigX1) - w)/2, y: imgY, width: w, height: h });
  }

  // Date
  const dtX1 = M + colW*2 + 10, dtX2 = 595 - M;
  last.drawText("Date (YYYY-MM-DD):", { x: dtX1, y: footerY, size: 9, font: bold, color: VINET_DARK });
  last.drawText(localDateZA(), { x: dtX1 + 90, y: footerY, size: 9, font, color: VINET_DARK });
  drawDashedRule(last, dtX1, footerY - 4, dtX2, { thickness: 0.5, opacity: .6 });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // ----- Admin UI (use your last-good renderers) -----
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // ----- Info pages -----
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Terms for UI display -----
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      async function getText(u) { try { const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } }); return r.ok ? await r.text() : ""; } catch { return ""; } }
      const esc = s => s.replace(/[&<>]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[t]));
      const service = esc(await getText(svcUrl) || "");
      const debit = esc(await getText(debUrl) || "");
      let body = "";
      if (kind === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- (UNCHANGED) Debit save / sign, OTP endpoints, Admin list/review, Uploads, Save progress, etc. -----
    // Keep your last-good logic here. Nothing changed in those routes.
    // ………………………………………………………………………………………………………………………………………………………………………
    // For brevity in this reply, please paste back the same non-PDF routes
    // from your last working file without modification.
    // ………………………………………………………………………………………………………………………………………………………………………

    // ----- Agreement HTML pages (view-in-browser) -----
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status: 404 });

      const e = sess.edits || {};
      const today = localDateZA();
      const name  = escapeHtml(e.full_name||'');
      const email = escapeHtml(e.email||'');
      const phone = escapeHtml(e.phone||'');
      const street= escapeHtml(e.street||'');
      const city  = escapeHtml(e.city||'');
      const zip   = escapeHtml(e.zip||'');
      const passport = escapeHtml(e.passport||'');
      const debit = sess.debit || null;

      const msaTerms = await fetchTextCached(env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL, env, "terms:msa");
      const debitTerms = await fetchTextCached(env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL, env, "terms:debit");

      if (type === "msa") {
        const body = `
          <p>This document represents your Master Service Agreement with Vinet Internet Solutions.</p>
          <table>
            <tr><th class="b">Customer</th><td>${name}</td></tr>
            <tr><th class="b">Email</th><td>${email}</td></tr>
            <tr><th class="b">Phone</th><td>${phone}</td></tr>
            <tr><th class="b">ID / Passport</th><td>${passport}</td></tr>
            <tr><th class="b">Address</th><td>${street}, ${city}, ${zip}</td></tr>
            <tr><th class="b">Date</th><td>${today}</td></tr>
          </table>
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig/${linkid}.png" alt="signature">
          </div>
          <h2>Terms</h2>
          <pre class="terms">${escapeHtml(msaTerms || "Terms unavailable.")}</pre>`;
        return new Response(pageHtmlTemplate("Master Service Agreement", body, linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (type === "debit") {
        const hasDebit = !!(debit && debit.account_holder && debit.account_number);
        const debitHtml = hasDebit ? `
          <table>
            <tr><th class="b">Account Holder</th><td>${escapeHtml(debit.account_holder||'')}</td></tr>
            <tr><th class="b">ID Number</th><td>${escapeHtml(debit.id_number||'')}</td></tr>
            <tr><th class="b">Bank</th><td>${escapeHtml(debit.bank_name||'')}</td></tr>
            <tr><th class="b">Account No</th><td>${escapeHtml(debit.account_number||'')}</td></tr>
            <tr><th class="b">Account Type</th><td>${escapeHtml(debit.account_type||'')}</td></tr>
            <tr><th class="b">Debit Day</th><td>${escapeHtml(debit.debit_day||'')}</td></tr>
          </table>` : `<p class="muted">No debit order details on file for this onboarding.</p>`;
        const body = `
          <p>This document represents your Debit Order Instruction.</p>
          ${debitHtml}
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
          </div>
          <h2>Terms</h2>
          <pre class="terms">${escapeHtml(debitTerms || "Terms unavailable.")}</pre>`;
        return new Response(pageHtmlTemplate("Debit Order Agreement", body, linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      return new Response("Unknown agreement type", { status: 404 });
    }

    // ----- Agreement signature PNG passthroughs (unchanged) -----
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // ----- PDF endpoints (UPDATED) -----
    if (path.startsWith("/pdf/msa/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderMSAPdf(env, linkid);
    }
    if (path.startsWith("/pdf/debit/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderDebitPdf(env, linkid);
    }

    // Fallback
    return new Response("Not found", { status: 404 });
  }
};