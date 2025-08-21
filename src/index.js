// index.js — Vinet Onboarding Worker (full build, 2025-08)
// Includes:
// - Admin dashboard (inline JS) with: Generate Onboard + Staff Verify (line 1), Pending/Completed/Approved (line 2)
//   * URL popup after generation
//   * Delete entries (KV + R2 + optional DB) with Back button
//   * Review page: attachments clickable (R2 public URL)
//   * "Approve & Push" updates Splynx via PUT; also persists MSA/Debit PDFs to R2 for permanent links
// - Onboarding flow (Begin → Verify → Personal Info → RICA uploads → Payment → MSA → Final)
// - OTP via WhatsApp template + staff fallback
// - Uploads to R2
// - PDF generation (Debit + MSA) using Times fonts; improved layout; Security Audit page w/ ZA time/IP/ASN/UA
// - HTML agreement views mirroring look + Security Audit section
//
// Requires: pdf-lib
//   npm i pdf-lib
//
// Bindings (wrangler.toml):
//  - DB (D1, optional - delete cleanup uses if present)
//  - ONBOARD_KV (KV), R2_UPLOADS (R2)
//  - SPLYNX_API, SPLYNX_AUTH
//  - PHONE_NUMBER_ID, WHATSAPP_TOKEN, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG
//  - TERMS_SERVICE_URL, TERMS_DEBIT_URL
//  - HEADER_WEBSITE, HEADER_PHONE (optional)
//  - API_URL (optional)
//  - ADMIN_IPS not needed here; we keep built-in IP range check

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Constants ----------
const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MSA_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// Vinet brand colours
const VINET_RED = rgb(237 / 255, 28 / 255, 36 / 255); // #ed1c24
const VINET_BLACK = rgb(3 / 255, 3 / 255, 3 / 255);   // #030303

// Fallback header text
const HEADER_WEBSITE_DEFAULT = "www.vinet.co.za";
const HEADER_PHONE_DEFAULT = "021 007 0200";

// R2 public host for direct links
const R2_PUBLIC = "https://onboarding-uploads.vinethosting.org";

// ---------- Helpers ----------
function ipAllowed(request) {
  // VNET 160.226.128.0/20 (128..143)
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const escapeHtml = (s) =>
  String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
function localDateZA() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD
}
function formatDateTimeZA(ts) {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    const d = new Date(ts || Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
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
  } catch {
    return "";
  }
}
async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch {
    return null;
  }
}
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}
async function getCachedJson(env, key) {
  const t = await env.ONBOARD_KV.get(key);
  return t ? JSON.parse(t) : null;
}
async function setCachedJson(env, key, obj, ttl = PDF_CACHE_TTL) {
  await env.ONBOARD_KV.put(key, JSON.stringify(obj), { expirationTtl: ttl });
}
async function getLogoBytes(env) {
  const kvKey = "asset:logoBytes:v2";
  const hit = await env.ONBOARD_KV.get(kvKey, "arrayBuffer");
  if (hit) return hit;
  const r = await fetch(LOGO_URL, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!r.ok) return null;
  const bytes = await r.arrayBuffer();
  await env.ONBOARD_KV.put(kvKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return bytes;
}
async function embedLogo(pdf, env) {
  const bytes = await getLogoBytes(env);
  if (!bytes) return null;
  try {
    return await pdf.embedPng(bytes);
  } catch {
    return await pdf.embedJpg(bytes);
  }
}
function wrapToLines(text, font, size, maxWidth) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(w, size) > maxWidth) {
        let buf = "";
        for (const ch of w) {
          const t2 = buf + ch;
          if (font.widthOfTextAtSize(t2, size) > maxWidth) {
            if (buf) lines.push(buf);
            buf = ch;
          } else buf = t2;
        }
        line = buf;
      } else {
        line = w;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
async function getWrappedLinesCached(env, text, font, size, maxWidth, tag) {
  const key = `wrap:${tag}:${size}:${Math.round(maxWidth)}:${djb2(text)}`;
  const cached = await getCachedJson(env, key);
  if (cached) return cached;
  const lines = wrapToLines(text, font, size, maxWidth);
  await setCachedJson(env, key, lines);
  return lines;
}
function drawDashedLine(page, x1, y, x2, opts = {}) {
  const dash = opts.dash ?? 12;
  const gap = opts.gap ?? 7;
  const color = opts.color ?? VINET_BLACK;
  let x = x1;
  const dir = x2 >= x1 ? 1 : -1;
  while ((dir > 0 && x < x2) || (dir < 0 && x > x2)) {
    const xEnd = Math.min(x + dash * dir, x2);
    page.drawLine({ start: { x, y }, end: { x: xEnd, y }, thickness: 1, color });
    x = xEnd + gap * dir;
  }
}

// ---------- Security Audit page drawing (for PDFs) ----------
function drawAuditPage({ pdf, font, bold, VINET_RED, VINET_BLACK, W=595, H=842, M=40, website, phone, logoImg, sess }) {
  const page = pdf.addPage([W, H]);
  let y = H - 42;
  if (logoImg) {
    const targetH = 36;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    page.drawImage(logoImg, { x: W - M - lw, y: y - targetH, width: lw, height: targetH });
  }
  page.drawText("Security Audit", { x: M, y: y - 8, size: 16, font: bold, color: VINET_RED });
  y -= 26;
  drawDashedLine(page, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
  y -= 18;

  const ip = sess?.last_ip || "";
  const ua = sess?.last_ua || "";
  const when = sess?.last_time || Date.now();
  const cf = sess?.last_cf || {};
  const asn = cf.asn ? `AS${cf.asn}` : "Unknown ASN";
  const org = cf.asOrganization || "";
  const locBits = [cf.country, cf.region, cf.city].filter(Boolean).join(" / ");
  const proto = cf.httpProtocol || "";
  const tls = cf.tlsVersion || "";
  const tzDisp = "Africa/Johannesburg";

  const line = (label, value) => {
    page.drawText(label, { x: M, y, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(value || ""), { x: M + 160, y, size: 10, font, color: VINET_BLACK });
    y -= 14;
  };

  line("Timestamp:", `${formatDateTimeZA(when)} SAST (${tzDisp})`);
  line("Client IP:", ip);
  line("Network:", [asn, org].filter(Boolean).join(" — "));
  line("Location:", locBits || "Unknown");
  line("Protocol/TLS:", [proto, tls].filter(Boolean).join(" · "));
  line("Device (UA):", ua || "Unknown");

  y -= 6;
  drawDashedLine(page, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  // Footer
  const footer = "© Vinet Internet Solutions (Pty) Ltd";
  page.drawText(footer, { x: M, y: 40, size: 9, font, color: VINET_BLACK });
  const contact = `${website || HEADER_WEBSITE_DEFAULT}  |  ${phone || HEADER_PHONE_DEFAULT}`;
  const w = font.widthOfTextAtSize(contact, 9);
  page.drawText(contact, { x: W - M - w, y: 40, size: 9, font, color: VINET_BLACK });
}

// ---------- EFT Info Page ----------
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
// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPUT(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = (s) => /^27\d{8,13}$/.test(String(s || "").trim());
  if (typeof obj === "string") return ok(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const m = pickPhone(it);
      if (m) return m;
    }
    return null;
  }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile,
      obj.mobile,
      obj.phone,
      obj.whatsapp,
      obj.msisdn,
      obj.primary_phone,
      obj.contact_number,
      obj.billing_phone,
      obj.contact_number_2nd,
      obj.contact_number_3rd,
      obj.alt_phone,
      obj.alt_mobile,
    ];
    for (const v of direct) if (ok(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok(v)) return String(v).trim();
      if (v && typeof v === "object") {
        const m = pickPhone(v);
        if (m) return m;
      }
    }
  }
  return null;
}
function pickFrom(obj, keyNames) {
  if (!obj) return null;
  const wanted = keyNames.map((k) => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
      continue;
    }
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim();
          if (s) return s;
        }
        if (v && typeof v === "object") stack.push(v);
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
  let cust = null,
    lead = null,
    contacts = null,
    custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street ?? src.address ?? src.address_1 ?? src.street_1 ??
    (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";

  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";

  const zip =
    src.zip_code ?? src.zip ??
    (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","idnumber","national_id","id_card","identity","identity_number","document_number"]) || "";

  return {
    kind: cust ? "customer" : lead ? "lead" : "unknown",
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city,
    street,
    zip,
    passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- Admin Dashboard (HTML + JS) ----------
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1100px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:140px}
h1,h2{color:#e2001a}
.row{display:flex;gap:1em;flex-wrap:wrap}
.box{flex:1;min-width:320px;border:1px solid #eee;border-radius:.9em;padding:1em}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0} input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
.note{font-size:12px;color:#666} #out a{word-break:break-all}
.table{width:100%;border-collapse:collapse;margin-top:.6em}
th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
a.link{color:#e2001a;text-decoration:none}
a.link:hover{text-decoration:underline}
.back{margin:.5em 0 1em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>

  <div id="main">
    <div class="row">
      <div class="box">
        <h2 style="margin:.2em 0 .6em">Generate Onboard</h2>
        <div class="field"><label>Splynx Lead/Customer ID</label>
          <div class="row" style="gap:.5em">
            <input id="id" autocomplete="off" style="flex:2"/>
            <button class="btn" id="gen">Generate URL</button>
          </div>
        </div>
        <div class="field"><label>Generate Verification</label>
          <div class="row" style="gap:.5em">
            <input id="linkid" placeholder="Link ID (e.g. 319_ab12cd34)" autocomplete="off" style="flex:2"/>
            <button class="btn" id="genstaff">Generate staff code</button>
          </div>
        </div>
      </div>

      <div class="box">
        <h2 style="margin:.2em 0 .6em">Queues</h2>
        <div class="row" style="gap:.5em">
          <button class="btn-secondary" id="inprog">Pending (In‑progress)</button>
          <button class="btn-secondary" id="pending">Completed (Awaiting approval)</button>
          <button class="btn-secondary" id="approved">Approved</button>
        </div>
        <div class="note" style="margin-top:.6em">Click any queue to manage, review, or delete sessions.</div>
      </div>
    </div>
  </div>

  <div id="list" style="display:none"></div>
</div>
<script src="/static/admin.js"></script>
</body></html>`;
}

function adminJs() {
  return `(()=> {
    const main = document.getElementById('main');
    const list = document.getElementById('list');

    function showMain(){ main.style.display='block'; list.style.display='none'; }
    function showList(){ main.style.display='none'; list.style.display='block'; }

    // Home actions
    document.getElementById('gen').onclick = async () => {
      const id = (document.getElementById('id').value||'').trim();
      if (!id) { alert('Please enter a Splynx ID'); return; }
      try {
        const r = await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d = await r.json().catch(()=>({}));
        if (d.url) {
          // Big modal prompt
          const msg = 'Onboarding URL for ' + id + ':\\n\\n' + d.url + '\\n\\nOpen now?';
          if (confirm(msg)) window.open(d.url, '_blank');
        } else {
          alert('Error generating link.');
        }
      } catch { alert('Network error'); }
    };

    document.getElementById('genstaff').onclick = async () => {
      const linkid = (document.getElementById('linkid').value||'').trim();
      if (!linkid) { alert('Enter linkid'); return; }
      try {
        const r = await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
        const d = await r.json().catch(()=>({}));
        if (d.ok) {
          alert('Staff code for '+linkid+': '+d.code+' (valid 15 min)');
        } else {
          alert(d.error || 'Failed to generate staff code');
        }
      } catch { alert('Network error'); }
    };

    document.getElementById('inprog').onclick = () => loadQueue('inprog');
    document.getElementById('pending').onclick = () => loadQueue('pending');
    document.getElementById('approved').onclick = () => loadQueue('approved');

    function backButton(){
      const b = document.createElement('div');
      b.className = 'back';
      b.innerHTML = '<button class="btn" id="back">← Back to dashboard</button>';
      b.querySelector('#back').onclick = showMain;
      return b;
    }

    async function loadQueue(mode){
      list.innerHTML = '';
      list.appendChild(backButton());
      const title = mode==='inprog'?'Pending (In‑progress)':(mode==='pending'?'Completed (Awaiting approval)':'Approved');
      const h = document.createElement('h2'); h.textContent = title; h.style.color='#e2001a';
      list.appendChild(h);

      const wrap = document.createElement('div');
      wrap.className = 'box';
      wrap.innerHTML = '<div>Loading…</div>';
      list.appendChild(wrap);
      showList();

      try {
        const r = await fetch('/api/admin/list?mode='+mode);
        const d = await r.json();
        const items = d.items||[];
        if (!items.length) { wrap.innerHTML = '<div class="note">No records.</div>'; return; }
        const rows = items.map(i => {
          const viewBtn = (mode==='pending'
            ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
            : '<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>');
          const delBtn = '<button class="btn" data-del="'+i.linkid+'">Delete</button>';
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td style="display:flex;gap:.4em;align-items:center">'+viewBtn+' '+delBtn+'</td></tr>';
        }).join('');
        wrap.innerHTML = '<table class="table"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>';

        wrap.querySelectorAll('button[data-del]').forEach(btn=>{
          btn.onclick = async () => {
            const linkid = btn.getAttribute('data-del');
            if (!confirm('Delete all traces of session '+linkid+' ? This removes KV records and uploaded files.')) return;
            btn.disabled = true;
            try {
              const r = await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
              const d = await r.json().catch(()=>({}));
              if (d.ok) {
                alert('Deleted ' + linkid);
                loadQueue(mode);
              } else {
                alert(d.error||'Delete failed');
              }
            } catch { alert('Network error'); }
            btn.disabled = false;
          };
        });
      } catch {
        wrap.innerHTML = '<div class="note">Failed to load.</div>';
      }
    }
  })();`;
}
// ---------- Onboarding HTML renderer ----------
function renderOnboardUI(linkid) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:680px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.2em 0 1.8em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em;flex-wrap:wrap}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid #e2001a;color:#e2001a;padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:#e2001a;color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
  .accent { height:8px; background:#e2001a; border-radius:4px; width:60%; max-width:540px; margin:10px auto 18px; }
  .final p { margin:.35em 0 .65em; }
  .final ul { margin:.25em 0 0 1em; }
  .doclist { list-style:none; margin:.4em 0 0 0; padding:0; }
  .doclist .doc-item { display:flex; align-items:center; gap:.5em; margin:.45em 0; }
  .doclist .doc-ico { display:inline-flex; width:18px; height:18px; opacity:.9; }
  .doclist .doc-ico svg { width:18px; height:18px; }
  .doclist a { text-decoration:none; }
  .doclist a:hover { text-decoration:underline; }
  .error{color:#b00020;font-size:.95em;margin-top:.25em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  // Step order: 0 Begin, 1 Verify, 2 Personal, 3 Uploads, 4 Payment, 5 MSA, 6 Final
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  // Step 0: Begin
  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We’ll quickly verify you and capture the information required by RICA to activate your service.</p><button class="btn" id="start">Let’s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  // Step 1: Verify (WhatsApp OTP or Staff code)
  function step1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  // Step 2: Personal info (pulled from Splynx, editable)
  function step2(){
    stepEl.innerHTML='<h2>Confirm your details</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', passport: state.edits.passport ?? p.passport ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=3; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // Step 3: Uploads (RICA: ID + Proof of Address <= 3 months)
  function step3(){
    stepEl.innerHTML=[
      '<h2>Upload documents</h2>',
      '<div class="note">Per the South African RICA Act, please upload the following (clear photo or PDF):</div>',
      '<ul class="note" style="margin:.4em 0 0 1em">',
        '<li><b>ID Document</b> (required)</li>',
        '<li><b>Proof of Address</b> (required; not older than 3 months)</li>',
      '</ul>',
      '<div class="field"><label>ID Document</label><input type="file" id="file_id" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><label>Proof of Address (≤ 3 months)</label><input type="file" id="file_poa" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uErr" class="error"></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };

    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');
      const err = document.getElementById('uErr');
      err.textContent = '';
      const fId = document.getElementById('file_id').files[0];
      const fPoa = document.getElementById('file_poa').files[0];
      if (!fId || !fPoa) { err.textContent = 'Both documents are required.'; return; }
      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { err.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||label).replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }
      try {
        msg.textContent = 'Uploading...';
        const u1 = await up(fId, 'ID Document');
        const u2 = await up(fPoa, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        msg.textContent = 'Uploaded.';
        step=4; state.progress=step; setProg(); save(); render();
      } catch (e) {
        if (!err.textContent) err.textContent='Upload failed.';
      }
    };
  }

  // Step 4: Payment (EFT or Debit Order)
  function step4(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back4" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');

    function renderEft(){
      const id = (linkid||'').split('_')[0];
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML = [
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a></div>'
      ].join('');
    }

    let dPad = null;
    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('debitBox');
      box.style.display = 'block';
      box.innerHTML = [
        '<div class="row">',
          '<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required /></div>',
          '<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required /></div>',
          '<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick = (e)=>{ e.preventDefault(); dPad.clear(); };
    }

    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; dPad=null; }
    function hideEft(){ const box=document.getElementById('eftBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); renderEft(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; hideEft(); renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm(); else renderEft();

    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        const msg = document.getElementById('d_msg');
        if (!document.getElementById('d_agree').checked) { msg.textContent='Please confirm you agree to the Debit Order terms.'; return; }
        if (!dPad || dPad.isEmpty()) { msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed:         true
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id, linkid }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
      }
      step=5; state.progress=step; setProg(); save(); render();
    };
  }

  // Step 5: MSA
  function step5(){
    stepEl.innerHTML = [
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back5">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back5').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  // Step 6: Final
  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    const docIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5L18.5 8H14V3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zM8 9h4v1.5H8V9z"/></svg>';
    stepEl.innerHTML = [
      '<div class="final">',
        '<h2 style="color:#e2001a;margin:0 0 .2em">All set!</h2>',
        '<div class="accent"></div>',
        '<p>Thanks – we’ve recorded your information. Our team will be in contact shortly.</p>',
        '<p>If you have any questions, please contact our sales team:</p>',
        '<ul>',
          '<li><b>Phone:</b> <a href="tel:+27210070200">021 007 0200</a></li>',
          '<li><b>Email:</b> <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></li>',
        '</ul>',
        '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
        '<div class="field"><b>Your agreements</b> <span class="note">(links work after signing; PDFs generate instantly)</span></div>',
        '<ul class="doclist">',
          '<li class="doc-item"><span class="doc-ico">', docIcon, '</span>',
            '<a href="/pdf/msa/', linkid, '" target="_blank">Master Service Agreement (PDF)</a>',
            ' &nbsp;•&nbsp; <a href="/agreements/msa/', linkid, '" target="_blank">View in browser</a>',
          '</li>',
          (showDebit
            ? '<li class="doc-item"><span class="doc-ico">' + docIcon + '</span>' +
              '<a href="/pdf/debit/' + linkid + '" target="_blank">Debit Order Agreement (PDF)</a>' +
              ' &nbsp;•&nbsp; <a href="/agreements/debit/' + linkid + '" target="_blank">View in browser</a>' +
              '</li>'
            : ''),
        '</ul>',
      '</div>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}
// ---------- Text normalization (fix WinAnsi issues) ----------
function normalizeToAnsi(text) {
  if (!text) return "";
  return String(text)
    // smart quotes / dashes / bullets
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2022/g, "•")
    .replace(/\u00A0/g, " ")
    // uncommon spaces & controls
    .replace(/[\u2000-\u200B\u2028\u2029\uFEFF]/g, " ")
    // fallback: strip any remaining non-BMP oddities
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "");
}

// SA date/time helpers
function formatDateSA(d = new Date()) {
  // DD/MM/YYYY
  const tz = "Africa/Johannesburg";
  const dd = new Intl.DateTimeFormat("en-ZA", { timeZone: tz, day: "2-digit" }).format(d);
  const mm = new Intl.DateTimeFormat("en-ZA", { timeZone: tz, month: "2-digit" }).format(d);
  const yyyy = new Intl.DateTimeFormat("en-ZA", { timeZone: tz, year: "numeric" }).format(d);
  return `${dd}/${mm}/${yyyy}`;
}
function formatDateTimeSA(d = new Date()) {
  // 20 Aug 2025, 10:35 SAST
  const tz = "Africa/Johannesburg";
  const date = new Intl.DateTimeFormat("en-ZA", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric"
  }).format(d);
  const time = new Intl.DateTimeFormat("en-ZA", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
  return `${date}, ${time} SAST`;
}

// ---------- PDF RENDERERS ----------
async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;

  const rawTerms = (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";
  const terms = normalizeToAnsi(rawTerms);

  const pdf = await PDFDocument.create();

  // Use Times (handles more glyphs than Helvetica in pdf-lib standard set)
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // Page constants
  const W = 595, H = 842, M = 40;
  const website = env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT;
  const phone = env.HEADER_PHONE || HEADER_PHONE_DEFAULT;

  // Common header painter (title varies)
  const logoImg = await embedLogo(pdf, env);
  function paintHeader(pg, title, opts = {}) {
    let y = H - 40;
    if (logoImg) {
      // 25% bigger than before
      const targetH = (opts.bigLogo ? 52.5 : 42) * 1.25;
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const w = sc.width * ratio;
      pg.drawImage(logoImg, { x: W - M - w, y: y - targetH, width: w, height: targetH });
    }
    // Title (red)
    pg.drawText(title, { x: M, y: y - 8, size: 18, font: bold, color: VINET_RED });
    y -= 28;
    // Website + phone under title
    pg.drawText(`${website}  |  ${phone}`, { x: M, y, size: 10, font, color: VINET_BLACK });
    // Move dashed line slightly lower to better balance the page
    y -= 20;
    drawDashedLine(pg, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
    return y - 18;
  }

  // Page 1
  let page = pdf.addPage([W, H]);
  let y = paintHeader(page, "Vinet Internet Solutions Service Agreement", { bigLogo: true });

  // Subheadings in red for both columns
  const colW = (W - M * 2) / 2;
  const leftX = M;
  const rightX = M + colW + 12;

  // Left block heading
  page.drawText("Client Details", { x: leftX, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  // Two columns of key/value rows
  function kvRow(pg, x, yy, k, v) {
    v = normalizeToAnsi(v || "");
    pg.drawText(k, { x, y: yy, size: 10, font: bold, color: VINET_BLACK });
    pg.drawText(String(v), { x: x + 120, y: yy, size: 10, font, color: VINET_BLACK });
    return yy - 14;
  }

  let yL = y;
  yL = kvRow(page, leftX, yL, "Client code:", idOnly);
  yL = kvRow(page, leftX, yL, "Full Name:", edits.full_name);
  yL = kvRow(page, leftX, yL, "ID / Passport:", edits.passport);
  yL = kvRow(page, leftX, yL, "Email:", edits.email);

  let yR = y;
  // Right heading
  page.drawText("Contact Address", { x: rightX, y: yR, size: 12, font: bold, color: VINET_RED });
  yR -= 16;
  yR = kvRow(page, rightX, yR, "Phone:", edits.phone);
  yR = kvRow(page, rightX, yR, "Street:", edits.street);
  yR = kvRow(page, rightX, yR, "City:", edits.city);
  yR = kvRow(page, rightX, yR, "ZIP:", edits.zip);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  // Terms: 2 columns, 7pt, across pages (Times font + normalized text)
  const sizeT = 7;
  const colGap = 16;
  const colWidth = (W - M * 2 - colGap) / 2;
  const lineH = 9.6;
  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "msa-times");

  let xCol = M, yCol = infoBottom - 14, col = 0; // 0 left, 1 right

  function paintHeaderTerms(pg) {
    let ny = H - 40;
    if (logoImg) {
      const targetH = 40; // slightly smaller on subsequent pages
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      pg.drawImage(logoImg, { x: W - M - lw, y: ny - targetH, width: lw, height: targetH });
    }
    pg.drawText("Vinet Internet Solutions Service Agreement", {
      x: M, y: ny - 8, size: 16, font: bold, color: VINET_RED
    });
    ny -= 26;
    pg.drawText(`${website}  |  ${phone}`, { x: M, y: ny, size: 9, font, color: VINET_BLACK });
    ny -= 16;
    drawDashedLine(pg, M, ny, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
    return ny - 14;
  }

  for (let i = 0; i < lines.length; i++) {
    if (yCol < 110) {
      if (col === 0) {
        col = 1; xCol = M + colWidth + colGap; yCol = infoBottom - 14;
      } else {
        page = pdf.addPage([W, H]);
        const newTop = paintHeaderTerms(page);
        xCol = M; yCol = newTop; col = 0;
      }
    }
    page.drawText(lines[i], { x: xCol, y: yCol, size: sizeT, font, color: VINET_BLACK });
    yCol -= lineH;
  }

  // Footer/signature on last page — ensure no overlap, and label "Date" only
  const sigY = 90;
  page.drawText("Name:", { x: M, y: sigY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(normalizeToAnsi(edits.full_name || ""), {
    x: M + 45, y: sigY, size: 10, font, color: VINET_BLACK,
  });

  // Signature box & image placed above line to avoid overlap with date
  const sigLabelX = M + (W / 2 - 60);
  page.drawText("Signature:", { x: sigLabelX, y: sigY, size: 10, font: bold, color: VINET_BLACK });

  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const targetW = 160;
    const sc = sigImg.scale(1);
    const targetH = (sc.height / sc.width) * targetW;
    // draw image slightly above baseline to prevent overlapping "Date"
    page.drawImage(sigImg, { x: sigLabelX + 70, y: sigY - targetH + 10, width: targetW, height: targetH });
  }

  page.drawText("Date:", { x: W - M - 160, y: sigY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(formatDateSA(new Date()), {
    x: W - M - 100, y: sigY, size: 10, font, color: VINET_BLACK,
  });

  // Security Audit page
  const audit = pdf.addPage([W, H]);
  let ay = paintHeader(audit, "Security Audit", { bigLogo: false }); // header line not too high
  // Gather saved session info
  const lastIp = sess.last_ip || "N/A";
  const asn = sess.last_asn || "N/A";
  const org = sess.last_org || "N/A";
  const city = sess.last_city || "N/A";
  const country = sess.last_country || "N/A";
  const ua = sess.last_ua || "N/A";
  const when = sess.last_time ? formatDateTimeSA(new Date(sess.last_time)) : formatDateTimeSA();

  function line(pg, x, y, s, b=false) {
    pg.drawText(normalizeToAnsi(s), { x, y, size: 10, font: b ? bold : font, color: VINET_BLACK });
  }

  line(audit, M, ay, "Captured at:", true);     line(audit, M + 120, ay, when); ay -= 14;
  line(audit, M, ay, "Source IP:", true);       line(audit, M + 120, ay, lastIp); ay -= 14;
  line(audit, M, ay, "ASN / Org:", true);       line(audit, M + 120, ay, `${asn} / ${org}`); ay -= 14;
  line(audit, M, ay, "Geo:", true);             line(audit, M + 120, ay, `${city}, ${country}`); ay -= 14;
  line(audit, M, ay, "Device:", true);          line(audit, M + 120, ay, ua); ay -= 20;

  audit.drawText("© Vinet Internet Solutions (Pty) Ltd", {
    x: M, y: 40, size: 9, font, color: VINET_BLACK
  });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}

async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) {
    return new Response("Debit Order not available for this link.", { status: 409 });
  }

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;

  const rawTerms = (await fetchTextCached(termsUrl, env, "terms:debit")) || "Terms unavailable.";
  const terms = normalizeToAnsi(rawTerms);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const W = 595, H = 842, M = 40;
  const website = env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT;
  const phone = env.HEADER_PHONE || HEADER_PHONE_DEFAULT;

  const logoImg = await embedLogo(pdf, env);
  function paintHeader(pg) {
    let y = H - 40;
    if (logoImg) {
      // 25% bigger logo as requested
      const targetH = 52.5;
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const w = sc.width * ratio;
      pg.drawImage(logoImg, { x: W - M - w, y: y - targetH, width: w, height: targetH });
    }
    pg.drawText("Vinet Debit Order Instruction", { x: M, y: y - 8, size: 18, font: bold, color: VINET_RED });
    y -= 28;
    pg.drawText(`${website}  |  ${phone}`, { x: M, y, size: 10, font, color: VINET_BLACK });
    y -= 20; // line sits slightly lower
    drawDashedLine(pg, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
    return y - 20;
  }

  let page = pdf.addPage([W, H]);
  let y = paintHeader(page);

  // Two columns with red subheadings
  const colW = (W - M * 2) / 2;
  const leftX = M;
  const rightX = M + colW + 12;

  page.drawText("Client Details", { x: leftX, y, size: 12, font: bold, color: VINET_RED });
  page.drawText("Debit Order Details", { x: rightX, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  function kvRow(pg, x, yy, k, v) {
    v = normalizeToAnsi(v || "");
    pg.drawText(k, { x, y: yy, size: 10, font: bold, color: VINET_BLACK });
    pg.drawText(String(v), { x: x + 140, y: yy, size: 10, font, color: VINET_BLACK });
    return yy - 14;
  }

  // Left: client
  let yL = y;
  yL = kvRow(page, leftX, yL, "Client code:", idOnly);
  yL = kvRow(page, leftX, yL, "Full Name:", edits.full_name);
  yL = kvRow(page, leftX, yL, "ID / Passport:", edits.passport);
  yL = kvRow(page, leftX, yL, "Email:", edits.email);
  yL = kvRow(page, leftX, yL, "Phone:", edits.phone);
  yL = kvRow(page, leftX, yL, "Street:", edits.street);
  yL = kvRow(page, leftX, yL, "City:", edits.city);
  yL = kvRow(page, leftX, yL, "ZIP:", edits.zip);

  // Right: debit details
  let yR = y;
  yR = kvRow(page, rightX, yR, "Account Holder Name:", d.account_holder);
  yR = kvRow(page, rightX, yR, "Account Holder ID:", d.id_number);
  yR = kvRow(page, rightX, yR, "Bank:", d.bank_name);
  yR = kvRow(page, rightX, yR, "Bank Account No:", d.account_number);
  yR = kvRow(page, rightX, yR, "Account Type:", d.account_type);
  yR = kvRow(page, rightX, yR, "Debit Order Date:", d.debit_day);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  // Terms (8pt single column) with Times + normalized text
  let yT = infoBottom - 14;
  const sizeT = 8, lineH = 11.2, colWidth = W - M * 2;
  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "debit-times");

  for (const ln of lines) {
    if (yT < 120) break; // keep footer clear
    page.drawText(ln, { x: M, y: yT, size: sizeT, font, color: VINET_BLACK });
    yT -= lineH;
  }

  // Footer: Name | Signature | Date (Date label simplified)
  const footY = 90;
  page.drawText("Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(normalizeToAnsi(edits.full_name || ""), {
    x: M + 45, y: footY, size: 10, font, color: VINET_BLACK
  });

  const sigLabelX = M + (W / 2 - 60);
  page.drawText("Signature:", { x: sigLabelX, y: footY, size: 10, font: bold, color: VINET_BLACK });

  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const targetW = 160;
    const sc = sigImg.scale(1);
    const targetH = (sc.height / sc.width) * targetW;
    page.drawImage(sigImg, { x: sigLabelX + 70, y: footY - targetH + 10, width: targetW, height: targetH });
  }

  page.drawText("Date:", { x: W - M - 160, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(formatDateSA(new Date()), {
    x: W - M - 100, y: footY, size: 10, font, color: VINET_BLACK
  });

  // Page 2: Security Audit with proper header spacing and details
  let p2 = pdf.addPage([W, H]);
  let y2 = H - 40;
  if (logoImg) {
    const targetH = 40;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    p2.drawImage(logoImg, { x: W - M - lw, y: y2 - targetH, width: lw, height: targetH });
  }
  p2.drawText("Security Audit", { x: M, y: y2 - 8, size: 16, font: bold, color: VINET_RED });
  y2 -= 26;
  p2.drawText(`${website}  |  ${phone}`, { x: M, y: y2, size: 9, font, color: VINET_BLACK });
  y2 -= 16;
  drawDashedLine(p2, M, y2, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  y2 -= 14;
  const lastIp = sess.last_ip || "N/A";
  const asn = sess.last_asn || "N/A";
  const org = sess.last_org || "N/A";
  const city = sess.last_city || "N/A";
  const country = sess.last_country || "N/A";
  const ua = sess.last_ua || "N/A";
  const when = sess.last_time ? formatDateTimeSA(new Date(sess.last_time)) : formatDateTimeSA();

  function line2(pg, x, y, s, b=false) {
    pg.drawText(normalizeToAnsi(s), { x, y, size: 10, font: b ? bold : font, color: VINET_BLACK });
  }

  line2(p2, M, y2, "Captured at:", true);     line2(p2, M + 120, y2, when); y2 -= 14;
  line2(p2, M, y2, "Source IP:", true);       line2(p2, M + 120, y2, lastIp); y2 -= 14;
  line2(p2, M, y2, "ASN / Org:", true);       line2(p2, M + 120, y2, `${asn} / ${org}`); y2 -= 14;
  line2(p2, M, y2, "Geo:", true);             line2(p2, M + 120, y2, `${city}, ${country}`); y2 -= 14;
  line2(p2, M, y2, "Device:", true);          line2(p2, M + 120, y2, ua); y2 -= 20;

  p2.drawText("© Vinet Internet Solutions (Pty) Ltd", {
    x: M, y: 40, size: 9, font, color: VINET_BLACK
  });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
// ---------- Splynx helpers (PUT + mapping) ----------
async function splynxPUT(env, endpoint, payload) {
  const url = `${env.SPLYNX_API}${endpoint}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

// Map our edits to common Splynx fields (best-effort)
function mapEditsToSplynx(kind, edits) {
  // Keep keys conservative to avoid validation errors
  const out = {};
  if (edits.full_name) out.full_name = edits.full_name;
  if (edits.email) {
    out.email = edits.email;
    out.billing_email = edits.email;
  }
  if (edits.phone) {
    out.phone_mobile = edits.phone;
    out.mobile = edits.phone;
  }
  if (edits.street) out.address = edits.street;
  if (edits.city) out.city = edits.city;
  if (edits.zip) {
    out.zip = edits.zip;
    out.zip_code = edits.zip;
  }
  if (edits.passport) {
    out.id_number = edits.passport;
    out.identity_number = edits.passport;
  }
  return out;
}

// ---------- Deletion helpers ----------
async function deleteR2Prefix(env, prefix) {
  try {
    const list = await env.R2_UPLOADS.list({ prefix });
    if (list && list.objects) {
      for (const obj of list.objects) {
        await env.R2_UPLOADS.delete(obj.key).catch(() => {});
      }
    }
  } catch {}
}
async function deleteKVKeys(env, keys) {
  for (const k of keys) {
    try { await env.ONBOARD_KV.delete(k); } catch {}
  }
}
// best-effort D1 cleanup (wrapped to avoid breaking if tables differ)
async function tryD1Cleanup(env, linkid, splynxId) {
  if (!env.DB) return;
  const candidates = [
    { sql: "DELETE FROM onboard WHERE linkid = ?", args: [linkid] },
    { sql: "DELETE FROM debit WHERE splynx_id = ?", args: [splynxId] },
    { sql: "DELETE FROM uploads WHERE linkid = ?", args: [linkid] },
  ];
  for (const c of candidates) {
    try { await env.DB.prepare(c.sql).bind(...c.args).run(); } catch {}
  }
}
function r2PublicUrl(key) {
  const clean = String(key || "").replace(/^\/+/, "");
  return `https://onboarding-uploads.vinethosting.org/${clean}`;
}

async function deleteOnboardEverywhere(env, linkid, splynxId) {
  // remove R2 uploads/signatures
  await deleteR2Prefix(env, `uploads/${linkid}/`);
  await deleteR2Prefix(env, `agreements/${linkid}/`);
  await deleteR2Prefix(env, `debit_agreements/${linkid}/`);

  // remove KV session + otps + caches
  const kvList = await env.ONBOARD_KV.list({ prefix: "" });
  const doomed = [];
  const prefixes = [
    `onboard/${linkid}`,
    `otp/${linkid}`,
    `staffotp/${linkid}`,
    `wrap:`,
    `pdf:msa:${linkid}`,
    `pdf:debit:${linkid}`,
  ];
  for (const k of kvList.keys || []) {
    const name = k.name;
    if (name === `onboard/${linkid}` ||
        name === `otp/${linkid}` ||
        name === `staffotp/${linkid}` ||
        name === `pdf:msa:${linkid}` ||
        name === `pdf:debit:${linkid}` ||
        (name.startsWith("wrap:") && name.includes(linkid))) {
      doomed.push(name);
    }
  }
  await deleteKVKeys(env, doomed);

  // best-effort DB cleanup
  await tryD1Cleanup(env, linkid, splynxId);
}



    // ----- Admin UI -----
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }

    // ----- Info pages -----
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ----- Terms (for UI display) -----
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      async function getText(u) {
        try {
          const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } });
          return r.ok ? await r.text() : "";
        } catch { return ""; }
      }
      const esc = (s) => normalizeToAnsi(s || "").replace(/[&<>]/g, t => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[t]));
      const service = esc(await getText(svcUrl));
      const debit = esc(await getText(debUrl));
      const body = kind === "debit"
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ----- Debit details save -----
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(() => null);
        if (!form) return {};
        const o = {}; for (const [k, v] of form.entries()) o[k] = v;
        return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim() === "") {
        return json({ ok:false, error:`Missing ${k}` }, 400);
      }
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });

      // also persist minimal details on session (for HTML view)
      const linkidParam = url.searchParams.get("linkid") || "";
      if (linkidParam) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkidParam}`, "json");
        if (sess)
          await env.ONBOARD_KV.put(`onboard/${linkidParam}`,
            JSON.stringify({ ...sess, debit: { ...record } }),
            { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }

    // ----- Store debit-order signature -----
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok:false, error:"Missing/invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
        httpMetadata: { contentType:"image/png" },
      });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`,
          JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }),
          { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // ----- Admin: generate link -----
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`,
        JSON.stringify({ id, created:Date.now(), progress:0 }),
        { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}`, linkid });
    }

    // ----- Admin: staff OTP -----
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // ----- WhatsApp OTP send/verify -----
    async function sendWhatsAppTemplate(toMsisdn, code, lang="en") {
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
            { type:"button", sub_type:"url", index:"0", parameters:[{ type:"text", text: code.slice(-6) }]},
          ],
        },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`WA template send failed ${r.status} ${t}`);
      }
    }
    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"text", text:{ body: bodyText } };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`WA text send failed ${r.status} ${t}`);
      }
    }

    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); }
      catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try {
        await sendWhatsAppTemplate(msisdn, code, "en");
        return json({ ok:true });
      } catch {
        try {
          await sendWhatsAppTextIfSessionOpen(msisdn, `Your Vinet verification code is: ${code}`);
          return json({ ok:true, note:"sent-as-text" });
        } catch {
          return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502);
        }
      }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess)
          await env.ONBOARD_KV.put(`onboard/${linkid}`,
            JSON.stringify({ ...sess, otp_verified:true }),
            { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ----- Onboarding UI -----
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ----- Uploads (R2) -----
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const label = urlParams.get("label") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
      uploads.push({ key, name: fileName, size: body.byteLength, label });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok:true, key, publicUrl: r2PublicUrl(key) });
    }

    // ----- Save progress (capture CF telemetry too) -----
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = {
        ...existing, ...body,
        last_ip: getIP(),
        last_ua: getUA(),
        last_asn: cfASN || existing.last_asn || "",
        last_org: cfOrg || existing.last_org || "",
        last_city: cfCity || existing.last_city || "",
        last_country: cfCountry || existing.last_country || "",
        last_time: Date.now(),
      };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ----- Service agreement signature -----
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok:false, error:"Missing/invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType:"image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`,
        JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }),
        { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // ----- Admin list -----
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed)
          items.push({ linkid, id: s.id, updated });
        if (mode === "pending" && s.status === "pending")
          items.push({ linkid, id: s.id, updated });
        if (mode === "approved" && s.status === "approved")
          items.push({ linkid, id: s.id, updated });
      }
      items.sort((a, b) => b.updated - a.updated);
      return json({ items });
    }

    // ----- Admin review -----
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u => {
            const pu = r2PublicUrl(u.key);
            return `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
              <b>${escapeHtml(u.label || "File")}</b> — ${escapeHtml(u.name || "")} • ${Math.round((u.size || 0)/1024)} KB
              &nbsp; <a href="${pu}" target="_blank" rel="noreferrer">Open</a>
            </li>`;
          }).join("")}</ul>`
        : `<div class="note">No files</div>`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}
.note{color:#666;font-size:12px}
a.back{display:inline-block;margin-bottom:10px}
</style></head><body>
<div class="card">
  <a class="back btn-outline" href="/">← Back</a>
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id || "")}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status || "n/a")}</b></div>
  <h2>Edits</h2><div>${
    Object.entries(sess.edits || {}).map(([k,v]) => `<div><b>${escapeHtml(k)}</b>: ${v ? escapeHtml(String(v)) : ""}</div>`).join("") || "<div class='note'>None</div>"
  }</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>
  <div style="margin-top:12px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...';
    try{
      const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d=await r.json().catch(()=>({ok:false}));
      msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
  document.getElementById('reject').onclick=async()=>{
    const reason=prompt('Reason for rejection?')||'';
    msg.textContent='Rejecting...';
    try{
      const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
      const d=await r.json().catch(()=>({ok:false}));
      msg.textContent=d.ok?'Rejected.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`,
        JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }),
        { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ----- Admin approve (push to Splynx via PUT, mark approved) -----
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);

      // Determine kind (customer or lead) to choose endpoint
      let kind = "unknown";
      try {
        const prof = await fetchProfileForDisplay(env, sess.id);
        kind = prof.kind || "unknown";
      } catch {}

      const payload = mapEditsToSplynx(kind, sess.edits || {});
      try {
        if (kind === "customer") {
          await splynxPUT(env, `/admin/customers/customer/${sess.id}`, payload);
        } else if (kind === "lead") {
          await splynxPUT(env, `/admin/crm/leads/${sess.id}`, payload);
        } else {
          // try both (best-effort)
          try { await splynxPUT(env, `/admin/customers/customer/${sess.id}`, payload); } catch {}
          try { await splynxPUT(env, `/admin/crm/leads/${sess.id}`, payload); } catch {}
        }
      } catch (e) {
        return json({ ok:false, error:`Push failed: ${e.message}` }, 502);
      }

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", approved_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ----- Admin delete (remove everything) -----
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      const splynxId = (sess && sess.id) ? String(sess.id) : String(linkid).split("_")[0];
      await deleteOnboardEverywhere(env, linkid, splynxId);
      return json({ ok:true });
    }

    // ---------- Agreements assets (signature PNGs) ----------
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

    // ---------- Agreement HTML pages ----------
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_signed)
        return new Response("Agreement not available yet.", { status: 404 });

      const e = sess.edits || {};
      const today = formatDateSA(new Date());
      const name = escapeHtml(e.full_name || "");
      const email = escapeHtml(e.email || "");
      const phone = escapeHtml(e.phone || "");
      const street = escapeHtml(e.street || "");
      const city = escapeHtml(e.city || "");
      const zip = escapeHtml(e.zip || "");
      const passport = escapeHtml(e.passport || "");
      const debit = sess.debit || null;

      const msaTerms = await fetchTextCached(env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL, env, "terms:msa");
      const debitTerms = await fetchTextCached(env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL, env, "terms:debit");

      function page(title, body) {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
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
</div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

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
          <pre class="terms">${escapeHtml(normalizeToAnsi(msaTerms || "Terms unavailable."))}</pre>`;
        return page("Master Service Agreement", body);
      }

      if (type === "debit") {
        const hasDebit = !!(debit && debit.account_holder && debit.account_number);
        const debitHtml = hasDebit ? `
          <table>
            <tr><th class="b">Account Holder</th><td>${escapeHtml(debit.account_holder || "")}</td></tr>
            <tr><th class="b">ID Number</th><td>${escapeHtml(debit.id_number || "")}</td></tr>
            <tr><th class="b">Bank</th><td>${escapeHtml(debit.bank_name || "")}</td></tr>
            <tr><th class="b">Account No</th><td>${escapeHtml(debit.account_number || "")}</td></tr>
            <tr><th class="b">Account Type</th><td>${escapeHtml(debit.account_type || "")}</td></tr>
            <tr><th class="b">Debit Day</th><td>${escapeHtml(debit.debit_day || "")}</td></tr>
          </table>`
          : `<p class="muted">No debit order details on file for this onboarding.</p>`;
        const body = `
          <p>This document represents your Debit Order Instruction.</p>
          ${debitHtml}
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
          </div>
          <h2>Terms</h2>
          <pre class="terms">${escapeHtml(normalizeToAnsi(debitTerms || "Terms unavailable."))}</pre>`;
        return page("Debit Order Agreement", body);
      }

      return new Response("Unknown agreement type", { status: 404 });
    }

    // ----- Splynx profile passthrough -----
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error:"Missing id" }, 400);
      try {
        const prof = await fetchProfileForDisplay(env, id);
        return json(prof);
      } catch {
        return json({ error:"Lookup failed" }, 502);
      }
    }

    // ----- PDF endpoints -----
    if (path.startsWith("/pdf/msa/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderMSAPdf(env, linkid);
    }
    if (path.startsWith("/pdf/debit/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderDebitPdf(env, linkid);
    }

    return new Response("Not found", { status: 404 });
  },
};
// ---------- PDF RENDERERS (Times Roman + layout & audit info) ----------

function formatCapeTownDateTime(d = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return fmt.format(d).replace(",", "");
  } catch {
    // Fallback to localDateZA + HH:mm:ss
    const base = localDateZA();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${base} ${hh}:${mm}:${ss}`;
  }
}

async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached)
    return new Response(cached, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "public, max-age=86400",
      },
    });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key)
    return new Response("MSA not available for this link.", { status: 409 });

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  // sanitize to avoid WinAnsi issues (even though we use TimesRoman)
  const termsRaw = (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";
  const terms = normalizeToAnsi(termsRaw);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const W = 595, H = 842, M = 40; // A4
  let page = pdf.addPage([W, H]);

  // Header (logo 25% bigger than before; phone+web below logo/title; dashed divider a bit lower)
  const logoImg = await embedLogo(pdf, env);
  let yTop = H - 36; // slightly lower anchor
  if (logoImg) {
    const targetH = 52.5; // was 42 -> +25%
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    page.drawImage(logoImg, { x: W - M - lw, y: yTop - targetH, width: lw, height: targetH });
  }
  page.drawText("Vinet Internet Solutions Service Agreement", {
    x: M, y: yTop - 8, size: 18, font: bold, color: VINET_RED,
  });
  yTop -= 26;
  const website = env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT;
  const phone = env.HEADER_PHONE || HEADER_PHONE_DEFAULT;
  page.drawText(`${website}  |  ${phone}`, { x: M, y: yTop - 4, size: 10, font, color: VINET_BLACK });

  // dashed divider slightly lower than previous
  let y = yTop - 18;
  drawDashedLine(page, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
  y -= 20;

  // Two-column personal block with subheadings in red
  const colGap = 12;
  const colW = (W - M * 2 - colGap) / 2;

  // Left subheading
  page.drawText("Client Details", { x: M, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  let yL = y;
  const rowL = (k, v) => {
    page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: M + 120, y: yL, size: 10, font, color: VINET_BLACK });
    yL -= 14;
  };

  rowL("Client code:", idOnly);
  rowL("Full Name:", edits.full_name);
  rowL("ID / Passport:", edits.passport);
  rowL("Email:", edits.email);

  // Right block subheading
  let xR = M + colW + colGap;
  let yR = y;
  page.drawText("Debit Order Details", { x: xR, y: yR, size: 12, font: bold, color: VINET_RED });
  yR -= 16;

  const debit = sess.debit || {};
  const rowR = (k, v) => {
    page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: xR + 140, y: yR, size: 10, font, color: VINET_BLACK });
    yR -= 14;
  };
  // For MSA we show contact/address on right instead (to mirror previous)
  rowR("Phone:", edits.phone);
  rowR("Street:", edits.street);
  rowR("City:", edits.city);
  rowR("ZIP:", edits.zip);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  // Terms: 2 columns, 7pt, flowing across pages
  const sizeT = 7;
  const lineH = 9.6;
  const twoColGap = 16;
  const colWidth = (W - M * 2 - twoColGap) / 2;
  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "msa:v2");

  let xCol = M, yColTop = infoBottom - 14;
  let yCol = yColTop;
  let colIdx = 0;

  const paintHeader = (pg) => {
    let hy = H - 36;
    if (logoImg) {
      const targetH = 40; // header on later pages a tad smaller
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      pg.drawImage(logoImg, { x: W - M - lw, y: hy - targetH, width: lw, height: targetH });
    }
    pg.drawText("Vinet Internet Solutions Service Agreement", {
      x: M, y: hy - 8, size: 16, font: bold, color: VINET_RED,
    });
    hy -= 24;
    pg.drawText(`${website}  |  ${phone}`, { x: M, y: hy, size: 9, font, color: VINET_BLACK });
    hy -= 12;
    drawDashedLine(pg, M, hy, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
    return hy - 14;
  };

  for (let i = 0; i < lines.length; i++) {
    if (yCol < 95) { // leave space for footer on last page scenario
      if (colIdx === 0) {
        // move to right column
        colIdx = 1;
        xCol = M + colWidth + twoColGap;
        yCol = yColTop;
      } else {
        // new page
        page = pdf.addPage([W, H]);
        yColTop = paintHeader(page);
        xCol = M;
        yCol = yColTop;
        colIdx = 0;
      }
    }
    page.drawText(lines[i], { x: xCol, y: yCol, size: sizeT, font, color: VINET_BLACK });
    yCol -= lineH;
  }

  // Footer/signature on LAST page (use current 'page')
  const footY = 92; // keep clear of page margin
  // Name
  page.drawText("Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(String(edits.full_name || ""), { x: M + 45, y: footY, size: 10, font, color: VINET_BLACK });

  // Signature (ensure it does not overlap Date label)
  page.drawText("Signature:", { x: M + (W / 2 - 50), y: footY, size: 10, font: bold, color: VINET_BLACK });
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    // place signature ABOVE the baseline
    const sigImg = await pdf.embedPng(sigBytes);
    const wSig = 160;
    const sc = sigImg.scale(1);
    const hSig = (sc.height / sc.width) * wSig;
    page.drawImage(sigImg, {
      x: M + (W / 2 - 50) + 70,
      y: footY - hSig + 10, // +10 to lift a bit
      width: wSig,
      height: hSig,
    });
  }

  // Date label ONLY "Date" (no format text)
  page.drawText("Date:", { x: W - M - 160, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(formatCapeTownDateTime(), {
    x: W - M - 30 - 120,
    y: footY - 14,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // -------- Security Audit page --------
  const audit = pdf.addPage([W, H]);
  let ay = H - 40;
  if (logoImg) {
    const targetH = 40;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    audit.drawImage(logoImg, { x: W - M - lw, y: ay - targetH, width: lw, height: targetH });
  }
  audit.drawText("Security Audit", { x: M, y: ay - 8, size: 16, font: bold, color: VINET_RED });
  ay -= 26;
  drawDashedLine(audit, M, ay, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
  ay -= 16;

  const auditRow = (k, v) => {
    audit.drawText(k, { x: M, y: ay, size: 10, font: bold, color: VINET_BLACK });
    audit.drawText(String(v || ""), { x: M + 160, y: ay, size: 10, font, color: VINET_BLACK });
    ay -= 14;
  };
  auditRow("Date/Time (Cape Town):", formatCapeTownDateTime(new Date(sess.last_time || Date.now())));
  auditRow("Client IP:", sess.last_ip || "");
  auditRow("ASN:", sess.last_asn || "");
  auditRow("Network/Org:", sess.last_org || "");
  auditRow("Geo:", [sess.last_city, sess.last_country].filter(Boolean).join(", "));
  auditRow("Device/User-Agent:", (sess.last_ua || "").slice(0, 240));
  ay -= 10;
  audit.drawText("© Vinet Internet Solutions (Pty) Ltd", {
    x: M, y: ay, size: 9, font, color: VINET_BLACK,
  });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=86400",
    },
  });
}

async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached)
    return new Response(cached, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "public, max-age=86400",
      },
    });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key)
    return new Response("Debit Order not available for this link.", { status: 409 });

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const termsUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
  const termsRaw = (await fetchTextCached(termsUrl, env, "terms:debit")) || "Terms unavailable.";
  const terms = normalizeToAnsi(termsRaw);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 595, H = 842, M = 40;
  let page = pdf.addPage([W, H]);

  // Header (logo +25%, phone/web below, divider lower)
  const logoImg = await embedLogo(pdf, env);
  let yTop = H - 36;
  if (logoImg) {
    const targetH = 52.5; // +25%
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    page.drawImage(logoImg, { x: W - M - lw, y: yTop - targetH, width: lw, height: targetH });
  }
  page.drawText("Vinet Debit Order Instruction", {
    x: M, y: yTop - 8, size: 18, font: bold, color: VINET_RED,
  });
  yTop -= 26;
  const website = env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT;
  const phone = env.HEADER_PHONE || HEADER_PHONE_DEFAULT;
  page.drawText(`${website}  |  ${phone}`, { x: M, y: yTop - 4, size: 10, font, color: VINET_BLACK });

  let y = yTop - 18;
  drawDashedLine(page, M, y, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
  y -= 20;

  // Left column: Client Details (subheading in red)
  const colGap = 12;
  const colW = (W - M * 2 - colGap) / 2;
  page.drawText("Client Details", { x: M, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;
  let yL = y;
  const rowL = (k, v) => {
    page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: M + 120, y: yL, size: 10, font, color: VINET_BLACK });
    yL -= 14;
  };
  rowL("Client code:", idOnly);
  rowL("Full Name:", edits.full_name);
  rowL("ID / Passport:", edits.passport);
  rowL("Email:", edits.email);
  rowL("Phone:", edits.phone);
  rowL("Street:", edits.street);
  rowL("City:", edits.city);
  rowL("ZIP:", edits.zip);

  // Right column: Debit Order Details (subheading in red)
  const xR = M + colW + colGap;
  let yR = y;
  page.drawText("Debit Order Details", { x: xR, y: yR, size: 12, font: bold, color: VINET_RED });
  yR -= 16;
  const rowR = (k, v) => {
    page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: xR + 140, y: yR, size: 10, font, color: VINET_BLACK });
    yR -= 14;
  };
  rowR("Account Holder Name:", d.account_holder);
  rowR("Account Holder ID:", d.id_number);
  rowR("Bank:", d.bank_name);
  rowR("Bank Account No:", d.account_number);
  rowR("Account Type:", d.account_type);
  rowR("Debit Order Date:", d.debit_day);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M, { dash: 12, gap: 7, color: VINET_BLACK });

  // Terms (8pt, single column)
  let yT = infoBottom - 14;
  const sizeT = 8;
  const lineH = 11.2;
  const colWidth = W - M * 2;
  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "debit:v2");

  for (const ln of lines) {
    if (yT < 125) break; // keep footer area clear
    page.drawText(ln, { x: M, y: yT, size: sizeT, font, color: VINET_BLACK });
    yT -= lineH;
  }

  // Footer: Name | Signature | Date (label "Date" only & avoid overlap)
  const footY = 92;
  page.drawText("Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(String(edits.full_name || ""), { x: M + 45, y: footY, size: 10, font, color: VINET_BLACK });

  page.drawText("Signature:", { x: M + (W / 2 - 50), y: footY, size: 10, font: bold, color: VINET_BLACK });
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const wSig = 160;
    const sc = sigImg.scale(1);
    const hSig = (sc.height / sc.width) * wSig;
    page.drawImage(sigImg, {
      x: M + (W / 2 - 50) + 70,
      y: footY - hSig + 10, // lift to avoid date
      width: wSig,
      height: hSig,
    });
  }

  page.drawText("Date:", { x: W - M - 160, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(formatCapeTownDateTime(), {
    x: W - M - 30 - 120,
    y: footY - 14,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // Page 2: Security Audit
  let p2 = pdf.addPage([W, H]);
  let ay = H - 40;
  if (logoImg) {
    const targetH = 40;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    p2.drawImage(logoImg, { x: W - M - lw, y: ay - targetH, width: lw, height: targetH });
  }
  p2.drawText("Security Audit", { x: M, y: ay - 8, size: 16, font: bold, color: VINET_RED });
  ay -= 26;
  drawDashedLine(p2, M, ay, W - M, { dash: 12, gap: 7, color: VINET_BLACK });
  ay -= 16;

  const auditRow = (k, v) => {
    p2.drawText(k, { x: M, y: ay, size: 10, font: bold, color: VINET_BLACK });
    p2.drawText(String(v || ""), { x: M + 160, y: ay, size: 10, font, color: VINET_BLACK });
    ay -= 14;
  };
  auditRow("Date/Time (Cape Town):", formatCapeTownDateTime(new Date(sess.last_time || Date.now())));
  auditRow("Client IP:", sess.last_ip || "");
  auditRow("ASN:", sess.last_asn || "");
  auditRow("Network/Org:", sess.last_org || "");
  auditRow("Geo:", [sess.last_city, sess.last_country].filter(Boolean).join(", "));
  auditRow("Device/User-Agent:", (sess.last_ua || "").slice(0, 240));
  ay -= 10;
  p2.drawText("© Vinet Internet Solutions (Pty) Ltd", {
    x: M, y: ay, size: 9, font, color: VINET_BLACK,
  });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=86400",
    },
  });
}
// ---------- Admin Review (HTML) with public R2 links + Back button ----------
function renderReviewPage(linkid, sess, origin) {
  const e = sess.edits || {};
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const publicBase = "https://onboarding-uploads.vinethosting.org";
  const filesHTML = uploads.length
    ? `<ul style="list-style:none;padding:0">${uploads
        .map(
          (u) =>
            `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
               <b>${escapeHtml(u.label || "File")}</b>
               — ${escapeHtml(u.name || "")}
               • ${Math.round((u.size || 0) / 1024)} KB
               • <a href="${publicBase}/${encodeURI(u.key)}" target="_blank" rel="noopener">open</a>
             </li>`
        )
        .join("")}</ul>`
    : `<div class="note">No files</div>`;

  const msaLinkPdf = `${origin}/pdf/msa/${encodeURIComponent(linkid)}`;
  const debitLinkPdf = `${origin}/pdf/debit/${encodeURIComponent(linkid)}`;
  const msaHtml = `${origin}/agreements/msa/${encodeURIComponent(linkid)}`;
  const debitHtml = `${origin}/agreements/debit/${encodeURIComponent(linkid)}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
  .note{color:#666;font-size:12px}
  .row{display:flex;gap:.6em;flex-wrap:wrap}
</style></head><body>
<div class="card">
  <div class="row" style="justify-content:space-between;align-items:center">
    <h1 style="margin:.2em 0">Review & Approve</h1>
    <a class="btn-outline" href="/" title="Back">← Back</a>
  </div>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id || "")}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status || "n/a")}</b></div>

  <h2>Edits</h2>
  <div>${
    Object.entries(e)
      .map(([k, v]) => `<div><b>${escapeHtml(k)}</b>: ${v ? escapeHtml(String(v)) : ""}</div>`)
      .join("") || "<div class='note'>None</div>"
  }</div>

  <h2>Uploads</h2>
  ${filesHTML}

  <h2>Agreements</h2>
  <div>
    <div>MSA: <a href="${msaLinkPdf}" target="_blank" rel="noopener">PDF</a> • <a href="${msaHtml}" target="_blank" rel="noopener">HTML</a></div>
    <div>Debit order: <a href="${debitLinkPdf}" target="_blank" rel="noopener">PDF</a> • <a href="${debitHtml}" target="_blank" rel="noopener">HTML</a></div>
  </div>

  <div style="margin-top:12px" class="row">
    <button class="btn" id="approve">Approve & Push to Splynx</button>
    <button class="btn-outline" id="reject">Reject</button>
    <button class="btn-outline" id="delete">Delete session</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  const linkid=${JSON.stringify(linkid)};
  document.getElementById('approve').onclick=async()=>{
    msg.textContent='Pushing to Splynx...';
    try{
      const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({ok:false}));
      msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
  document.getElementById('reject').onclick=async()=>{
    const reason=prompt('Reason for rejection?')||'';
    msg.textContent='Rejecting...';
    try{
      const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,reason})});
      const d=await r.json().catch(()=>({ok:false}));
      msg.textContent=d.ok?'Rejected.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
  document.getElementById('delete').onclick=async()=>{
    if(!confirm('This will permanently delete the onboarding session and all related data. Continue?')) return;
    msg.textContent='Deleting...';
    try{
      const r=await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({ok:false}));
      msg.textContent=d.ok?'Deleted. You can go back now.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
</script>
</body></html>`;
}

// ---------- Splynx PUT helper & Approve Push ----------
async function splynxPUT(env, endpoint, payload) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Splynx PUT ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

function buildSplynxUpdatePayload(sess, origin) {
  const e = sess.edits || {};
  const d = sess.debit || {};
  const linkid = sess.linkid;
  const publicBase = "https://onboarding-uploads.vinethosting.org";

  // Construct notes with links to PDFs & uploaded docs
  const notes = [];
  if (sess.agreement_signed) notes.push(`MSA PDF: ${origin}/pdf/msa/${linkid}`);
  if (sess.debit_sig_key) notes.push(`Debit PDF: ${origin}/pdf/debit/${linkid}`);
  if (Array.isArray(sess.uploads)) {
    for (const u of sess.uploads) {
      notes.push(`${u.label || "File"}: ${publicBase}/${u.key}`);
    }
  }

  // Minimal field mapping (adjust to your Splynx schema if needed)
  const payload = {
    full_name: e.full_name || undefined,
    email: e.email || undefined,
    phone_mobile: e.phone || undefined,
    city: e.city || undefined,
    street_1: e.street || undefined,
    zip_code: e.zip || undefined,
    id_number: e.passport || undefined,
    // Custom block for finance (if your Splynx allows custom fields, adjust names)
    payment_method: sess.pay_method || undefined,
    // Put debit details into a free-form field or comment if no structured fields exist:
    comment: [
      e.comment,
      d && d.account_holder ? `Debit: ${d.account_holder}, ${d.bank_name}, ${d.account_number}, ${d.account_type}, day ${d.debit_day}` : null,
      notes.length ? `Docs:\n- ${notes.join("\n- ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
  return payload;
}

// ---------- Delete session & related content ----------
async function deleteOnboardSession(env, linkid) {
  // KV: main session
  await env.ONBOARD_KV.delete(`onboard/${linkid}`).catch(() => {});
  // KV: OTPs, staff codes, msisdn
  await env.ONBOARD_KV.delete(`otp/${linkid}`).catch(() => {});
  await env.ONBOARD_KV.delete(`staffotp/${linkid}`).catch(() => {});
  await env.ONBOARD_KV.delete(`otp_msisdn/${linkid}`).catch(() => {});
  // KV: PDF caches
  await env.ONBOARD_KV.delete(`pdf:msa:${linkid}`).catch(() => {});
  await env.ONBOARD_KV.delete(`pdf:debit:${linkid}`).catch(() => {});
  // R2: uploads and signatures
  const prefixes = [
    `uploads/${linkid}/`,
    `agreements/${linkid}/`,
    `debit_agreements/${linkid}/`,
  ];
  for (const prefix of prefixes) {
    try {
      let cursor = undefined;
      do {
        const list = await env.R2_UPLOADS.list({ prefix, cursor });
        for (const obj of list.objects || []) {
          await env.R2_UPLOADS.delete(obj.key).catch(() => {});
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    } catch {}
  }
  return true;
}

// ---------- IP/ASN/org enrichment from request.cf ----------
function cfMeta(request) {
  const cf = request.cf || {};
  return {
    ip: request.headers.get("CF-Connecting-IP") || "",
    asn: cf.asn || "",
    org: cf.asOrganization || "",
    city: cf.city || "",
    country: cf.country || "",
  };
}

// ---------- Worker entry (tail routes & handlers) ----------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      const json = (o, s = 200) =>
        new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

    const json = (o, s = 200) => new Response(JSON.stringify(o), {
      status: s, headers: { "content-type": "application/json" },
    });
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";
    const cf = request.cf || {};
    const cfASN = cf.asn || "";
    const cfOrg = cf.asOrganization || "";
    const cfCity = cf.city || "";
    const cfCountry = cf.country || "";

      // ----- Admin UI root (served earlier in Part 4) -----
      if (path === "/" && method === "GET") {
        if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
        return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (path === "/static/admin.js" && method === "GET") {
        return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
      }

      // ----- Review page -----
      if (path === "/admin/review" && method === "GET") {
        if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
        const linkid = url.searchParams.get("linkid") || "";
        if (!linkid) return new Response("Missing linkid", { status: 400 });
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (!sess) return new Response("Not found", { status: 404 });
        return new Response(renderReviewPage(linkid, sess, url.origin), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // ----- Admin: delete -----
      if (path === "/api/admin/delete" && method === "POST") {
        if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
        const { linkid } = await request.json().catch(() => ({}));
        if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
        await deleteOnboardSession(env, linkid);
        return json({ ok: true });
      }

      // ----- Admin: approve (push to Splynx via PUT) -----
      if (path === "/api/admin/approve" && method === "POST") {
        if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
        const { linkid } = await request.json().catch(() => ({}));
        if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (!sess) return json({ ok: false, error: "Not found" }, 404);

        const id = String(sess.id || "").trim();
        const payload = buildSplynxUpdatePayload({ ...sess, linkid }, url.origin);

        // Try update as customer first, then as lead if that fails
        let pushed = false, errorMsg = "";
        try {
          await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
          pushed = true;
        } catch (e1) {
          errorMsg = String(e1 && e1.message || e1);
          try {
            await splynxPUT(env, `/admin/crm/leads/${id}`, payload);
            pushed = true;
            errorMsg = "";
          } catch (e2) {
            errorMsg = `${errorMsg} | ${String(e2 && e2.message || e2)}`;
          }
        }

        // Mark status
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({ ...sess, status: pushed ? "approved" : (sess.status || "pending") }),
          { expirationTtl: 86400 }
        );

        return pushed ? json({ ok: true }) : json({ ok: false, error: errorMsg || "Push failed" }, 502);
      }

      // ----- Admin: reject (kept as-is) -----
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
          }),
          { expirationTtl: 86400 }
        );
        return json({ ok: true });
      }

      // ----- Save progress (capture CF/IP/ASN/ORG/Geo/UA) -----
      if (path.startsWith("/api/progress/") && method === "POST") {
        const linkid = path.split("/")[3];
        const body = await request.json().catch(() => ({}));
        const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
        const meta = cfMeta(request);
        const next = {
          ...existing,
          ...body,
          last_ip: meta.ip,
          last_ua: request.headers.get("user-agent") || "",
          last_time: Date.now(),
          last_asn: meta.asn,
          last_org: meta.org,
          last_city: meta.city,
          last_country: meta.country,
        };
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
        return json({ ok: true });
      }

      // ----- Agreement signature endpoints already defined earlier -----
      // ----- Terms endpoints, Splynx profile, uploads, OTP, link gen, EFT info, onboard UI -----
      // These were implemented in previous parts of this file.

      // ----- PDFs -----
      if (path.startsWith("/pdf/msa/") && method === "GET") {
        const linkid = path.split("/").pop();
        return await renderMSAPdf(env, linkid);
      }
      if (path.startsWith("/pdf/debit/") && method === "GET") {
        const linkid = path.split("/").pop();
        return await renderDebitPdf(env, linkid);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response(`Internal error: ${String(err && err.message || err)}`, { status: 500 });
    }
  },
};
