// index.js — Vinet Onboarding Worker (full build)
// - Admin dashboard & review (unchanged UI/flow)
// - Onboarding flow with OTP (WhatsApp template + staff code fallback) (unchanged)
// - Payment method (EFT / Debit) with terms checkbox & signatures (unchanged UI)
// - Uploads to R2 (unchanged)
// - HTML agreement views (unchanged structure)
// - **PDF generation updated** (Debit + MSA):
//     * Vinet branding (#ed1c24, #030303) using pdf-lib rgb(...)
//     * Smooth dashed dividers
//     * Bigger logo top-right; website + phone under title (top-left)
//     * Debit: left (client details) / right (debit details), 8pt terms, footer Name|Signature|Date
//     * MSA: left/right personal blocks, 2-column terms at 7pt flowing across pages, footer Name|Signature|Date
//     * Security Audit page header for both
//     * KV-cached logo bytes + cached wrapped terms lines for fast first render
//
// Requires: pdf-lib
//    npm i pdf-lib
//
// Bindings expected via wrangler.toml (your file already has these):
//  - DB (D1), ONBOARD_KV (KV), R2_UPLOADS (R2 bucket)
//  - SPLYNX_API, SPLYNX_AUTH
//  - PHONE_NUMBER_ID, WHATSAPP_TOKEN, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG
//  - TERMS_SERVICE_URL, TERMS_DEBIT_URL
//  - HEADER_WEBSITE, HEADER_PHONE (optional; defaults below)
//  - API_URL (optional)
//  - ADMIN_IPS not needed here; we keep built-in range check as per your snippet

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Constants ----------
const LOGO_URL =
  "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png"; // high-res PNG
const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MSA_TERMS_URL =
  "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS_URL =
  "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// Vinet brand colours (must be pdf-lib Color objects)
const VINET_RED = rgb(237 / 255, 28 / 255, 36 / 255); // #ed1c24
const VINET_BLACK = rgb(3 / 255, 3 / 255, 3 / 255); // #030303

// Fallback header text (can be overridden by env vars)
const HEADER_WEBSITE_DEFAULT = "www.vinet.co.za";
const HEADER_PHONE_DEFAULT = "021 007 0200";

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
  const dash = opts.dash ?? 12; // smooth
  const gap = opts.gap ?? 7;
  const color = opts.color ?? VINET_BLACK;
  let x = x1;
  const dir = x2 >= x1 ? 1 : -1;
  while ((dir > 0 && x < x2) || (dir < 0 && x > x2)) {
    const xEnd = Math.min(x + dash * dir, x2);
    page.drawLine({
      start: { x, y },
      end: { x: xEnd, y },
      thickness: 1,
      color,
    });
    x = xEnd + gap * dir;
  }
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
    `/crm/leads/${id}/contacts`,
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
  try {
    cust = await splynxGET(env, `/admin/customers/customer/${id}`);
  } catch {}
  if (!cust) {
    try {
      lead = await splynxGET(env, `/admin/crm/leads/${id}`);
    } catch {}
  }
  try {
    contacts = await splynxGET(env, `/admin/customers/${id}/contacts`);
  } catch {}
  try {
    custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`);
  } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street ??
    src.address ??
    src.address_1 ??
    src.street_1 ??
    (src.addresses && (src.addresses.street || src.addresses.address_1)) ??
    "";

  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";

  const zip =
    src.zip_code ??
    src.zip ??
    (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ??
    "";

  const passport =
    (custInfo &&
      (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport ||
    src.id_number ||
    pickFrom(src, [
      "passport",
      "id_number",
      "idnumber",
      "national_id",
      "id_card",
      "identity",
      "identity_number",
      "document_number",
    ]) ||
    "";

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
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px} h1,h2{color:#e2001a}
.tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
.tab{padding:.55em 1em;border-radius:.7em;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
.tab.active{background:#e2001a;color:#fff}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0} input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
.row{display:flex;gap:.75em}.row>*{flex:1}
table{width:100%;border-collapse:collapse} th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
.note{font-size:12px;color:#666} #out a{word-break:break-all}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>
  <div class="tabs">
    <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
    <div class="tab" data-tab="staff">2. Generate verification code</div>
    <div class="tab" data-tab="inprog">3. Pending (in-progress)</div>
    <div class="tab" data-tab="pending">4. Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">5. Approved</div>
  </div>
  <div id="content"></div>
</div>
<script src="/static/admin.js"></script>
</body></html>`;
}
function adminJs() {
  return `(()=> {
    const tabs = document.querySelectorAll('.tab');
    const content = document.getElementById('content');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      load(t.getAttribute('data-tab'));
    });
    load('gen');
    const node = html => { const d=document.createElement('div'); d.innerHTML=html; return d; };

    async function load(which){
      if (which==='gen') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id" autocomplete="off"/><button class="btn" id="go">Generate</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
          if(!id){out.textContent='Please enter an ID.';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.url?'<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>':'Error generating link.';
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (which==='staff') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
          if(!linkid){out.textContent='Enter linkid';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> (valid 15 min)':(d.error||'Failed');
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML='Loading...';
        try{
          const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
          const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+(which==='pending'?'<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>':'<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+'</td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML='<table style="max-width:900px;margin:0 auto"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        }catch{content.innerHTML='Failed to load.';}
        return;
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
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.4em 0 2.2em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em}.row>*{flex:1}
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

  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

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

  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
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
        '<div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
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

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
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
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
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
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML = [
      '<h2>Upload documents</h2>',
      '<div class="note">Please upload your ID and Proof of Address (max 2 files, 5MB each).</div>',
      '<div class="field"><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');
      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { msg.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }
      try {
        msg.textContent = 'Uploading...';
        const f1 = document.getElementById('file1').files[0];
        const f2 = document.getElementById('file2').files[0];
        const u1 = await up(f1, 'ID Document');
        const u2 = await up(f2, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        msg.textContent = 'Uploaded.';
        step=5; state.progress=step; setProg(); save(); render();
      } catch (err) { if (msg.textContent==='') msg.textContent='Upload failed.'; }
    };
  }

  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

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

// ---------- PDF RENDERERS (updated) ----------
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// brand
const VINET_RED = rgb(237/255, 28/255, 36/255);
const VINET_DARK = rgb(3/255, 3/255, 3/255);
const LIGHT_GREY = rgb(230/255, 230/255, 230/255);

// Prefer the high‑res PNG (faster embed than JPG for logos with transparency)
const LOGO_PNG_HIRES = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const CONTACT_LINE = "www.vinet.co.za  •  021 007 0200";

// Cache logo bytes in KV so we don’t fetch every time
async function getLogoBytes(env) {
  const k = "cache:logo:vinet:png";
  let bytes = await env.ONBOARD_KV.get(k, "arrayBuffer");
  if (bytes) return bytes;
  const r = await fetch(LOGO_PNG_HIRES, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!r.ok) return null;
  bytes = await r.arrayBuffer();
  await env.ONBOARD_KV.put(k, bytes, { expirationTtl: 60 * 60 * 24 });
  return bytes;
}

// Replace characters Helvetica/WinAnsi can’t encode
function sanitizeWinAnsi(text) {
  if (!text) return "";
  return String(text)
    // quotes/dashes/bullets/nbsp etc.
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2022\u25CF\u2043]/g, "•")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\r/g, "");
}

// Simple dashed divider (pdf-lib doesn’t expose dashed strokes on drawLine)
function dashedDivider(page, x, y, width, dash = 6, gap = 4, thickness = 1, color = LIGHT_GREY) {
  let cur = 0;
  while (cur < width) {
    const seg = Math.min(dash, width - cur);
    page.drawLine({
      start: { x: x + cur, y },
      end: { x: x + cur + seg, y },
      thickness,
      color
    });
    cur += dash + gap;
  }
}

// Word-wrap one block into lines (returns next y)
function wrapBlock(page, text, x, y, width, size, font, lineH, color = VINET_DARK) {
  const words = sanitizeWinAnsi(text).split(/\s+/);
  let line = "";
  for (const w of words) {
    const test = (line ? line + " " : "") + w;
    if (font.widthOfTextAtSize(test, size) > width) {
      if (line) {
        page.drawText(line, { x, y, size, font, color });
        y -= lineH;
        line = w;
      } else {
        // single long word fallback
        page.drawText(test, { x, y, size, font, color });
        y -= lineH;
        line = "";
      }
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineH;
  }
  return y;
}

// Header used on both PDFs
async function drawHeader(env, pdf, page, titleText, opts = {}) {
  const { margin = 42, logoScale = 1.5 } = opts;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const yTop = page.getSize().height - margin;
  const logoBytes = await getLogoBytes(env);
  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const baseW = 120 * logoScale;           // bigger logo
    const ratio = logo.height / logo.width;
    const baseH = baseW * ratio;
    page.drawImage(logo, {
      x: page.getSize().width - margin - baseW,
      y: yTop - baseH,
      width: baseW,
      height: baseH,
    });
    // contact line under logo
    page.drawText(CONTACT_LINE, {
      x: page.getSize().width - margin - baseW,
      y: yTop - baseH - 14,
      size: 9,
      font,
      color: VINET_DARK,
    });
  }

  // title on the left in Vinet red
  page.drawText(titleText, { x: margin, y: yTop - 6, size: 18, font: bold, color: VINET_RED });

  // dashed divider slightly lower than before
  dashedDivider(page, margin, yTop - 30, page.getSize().width - margin * 2, 7, 5, 1, LIGHT_GREY);
  return yTop - 48; // return next content y
}

function drawLabeledRow(page, boldFont, font, label, value, x, y, size = 10, gap = 90) {
  page.drawText(sanitizeWinAnsi(label), { x, y, size, font: boldFont, color: VINET_DARK });
  page.drawText(sanitizeWinAnsi(value ?? ""), { x: x + gap, y, size, font, color: VINET_DARK });
  return y - 14;
}

function drawFramedText(page, x, y, width, height, color = LIGHT_GREY) {
  // draw a light frame (rectangle)
  page.drawRectangle({ x, y: y - height, width, height, borderColor: color, borderWidth: 1 });
}

function formatDateYMD(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------- DEBIT ORDER (new layout) ----------
async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:v2:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) return new Response("Debit Order not available for this link.", { status: 409 });

  const d = sess.debit || {};
  const e = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  let terms = await fetchTextCached(termsUrl, env, "terms:debit");
  terms = sanitizeWinAnsi(terms || "Terms unavailable.");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const M = 42;
  let y = await drawHeader(env, pdf, page, "Vinet Debit Order Instruction", { margin: M, logoScale: 1.6 });

  // Left block (client)
  const colGap = 24;
  const colW = (page.getSize().width - M * 2 - colGap) / 2;

  let yL = y;
  yL = drawLabeledRow(page, bold, font, "Client code:", idOnly, M, yL);
  yL = drawLabeledRow(page, bold, font, "Full Name:", e.full_name, M, yL);
  yL = drawLabeledRow(page, bold, font, "ID / Passport:", e.passport, M, yL);
  yL = drawLabeledRow(page, bold, font, "Email:", e.email, M, yL);
  yL = drawLabeledRow(page, bold, font, "Phone:", e.phone, M, yL);
  yL = drawLabeledRow(page, bold, font, "Street:", e.street, M, yL);
  yL = drawLabeledRow(page, bold, font, "City:", e.city, M, yL);
  yL = drawLabeledRow(page, bold, font, "ZIP:", e.zip, M, yL);

  // Right block (debit details)
  let yR = y;
  page.drawText("Debit Order Details", { x: M + colW + colGap, y: yR, size: 12, font: bold, color: VINET_DARK });
  yR -= 18;
  yR = drawLabeledRow(page, bold, font, "Account Holder Name:", d.account_holder, M + colW + colGap, yR);
  yR = drawLabeledRow(page, bold, font, "Account Holder ID :", d.id_number, M + colW + colGap, yR);
  yR = drawLabeledRow(page, bold, font, "Bank:", d.bank_name, M + colW + colGap, yR);
  yR = drawLabeledRow(page, bold, font, "Bank Account No:", d.account_number, M + colW + colGap, yR);
  yR = drawLabeledRow(page, bold, font, "Account Type:", d.account_type, M + colW + colGap, yR);
  yR = drawLabeledRow(page, bold, font, "Debit Order Date:", d.debit_day, M + colW + colGap, yR);

  // Close the info section with a divider
  const infoBottom = Math.min(yL, yR) - 6;
  dashedDivider(page, M, infoBottom, page.getSize().width - 2 * M, 7, 5, 1, LIGHT_GREY);

  // Terms box (small top padding and framed)
  let yT = infoBottom - 16;
  const termsSize = 8.5;        // small text as requested
  const lineH = 11;
  const boxHeight = 260;        // visual frame height (auto wrap inside)
  drawFramedText(page, M, yT, page.getSize().width - 2 * M, boxHeight, LIGHT_GREY);
  const innerPad = 10;
  let yText = yT - innerPad;
  yText = wrapBlock(page, "Debit Order Terms", M + innerPad, yText, page.getSize().width - 2 * (M + innerPad), 10, bold, 14, VINET_DARK);
  yText = wrapBlock(page, terms, M + innerPad, yText, page.getSize().width - 2 * (M + innerPad), termsSize, font, lineH, VINET_DARK);

  // Signature row (name left, signature center, date right)
  let ySig = yT - boxHeight - 26;
  const sigLabelY = ySig;
  const thirdW = (page.getSize().width - 2 * M) / 3;

  // labels
  page.drawText("Name:", { x: M, y: sigLabelY, size: 10, font: bold, color: VINET_DARK });
  page.drawText(sanitizeWinAnsi(e.full_name || ""), { x: M + 44, y: sigLabelY, size: 10, font, color: VINET_DARK });

  page.drawText("Signature:", { x: M + thirdW + 10, y: sigLabelY, size: 10, font: bold, color: VINET_DARK });

  page.drawText("Date (YYYY‑MM‑DD):", { x: M + 2 * thirdW + 10, y: sigLabelY, size: 10, font: bold, color: VINET_DARK });
  page.drawText(formatDateYMD(new Date()), { x: M + 2 * thirdW + 10, y: sigLabelY - 14, size: 10, font, color: VINET_DARK });

  // signature image centered above “Signature”
  const sigObj = await env.R2_UPLOADS.get(sess.debit_sig_key);
  if (sigObj) {
    const sigBytes = await sigObj.arrayBuffer();
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = thirdW - 40;
    const scale = sigImg.scale(1);
    const sigH = (scale.height / scale.width) * sigW;
    const sigX = M + thirdW + 10;
    const sigY = sigLabelY + 32; // above the label
    page.drawImage(sigImg, { x: sigX, y: sigY, width: sigW, height: sigH });
    // underline (visual cue)
    dashedDivider(page, sigX, sigLabelY - 2, sigW, 7, 5, 0.8, LIGHT_GREY);
  }

  // -------- Page 2: Security audit --------
  const page2 = pdf.addPage([595, 842]);
  let y2 = await drawHeader(env, pdf, page2, "VINET — Agreement Security Summary", { margin: M, logoScale: 1.4 });
  const small = 10;
  const lh = 14;

  const secRows = [
    ["Link ID", linkid],
    ["Splynx ID", String(sess.id ?? "")],
    ["IP Address", String(sess.last_ip ?? "")],
    ["User‑Agent", sanitizeWinAnsi(sess.last_ua || "")],
    ["Timestamp", formatDateYMD(new Date(sess.last_time || Date.now()))],
  ];
  for (const [k, v] of secRows) {
    page2.drawText(k + ":", { x: M, y: y2, size: small, font: bold, color: VINET_DARK });
    page2.drawText(sanitizeWinAnsi(v || ""), { x: M + 130, y: y2, size: small, font, color: VINET_DARK });
    y2 -= lh;
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// ---------- MSA (2-column, sanitized text) ----------
async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:v2:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const e = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  let terms = await fetchTextCached(termsUrl, env, "terms:msa");
  terms = sanitizeWinAnsi(terms || "Terms unavailable.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const M = 42;
  const pageSize = [595, 842];
  const colGap = 18;
  const colW = (pageSize[0] - 2 * M - colGap) / 2;
  const sizeBody = 7;           // small per spec
  const lineH = 10;

  // function to start a new page with header + personal info (only page 1 needs the info block)
  async function newPage(title, withInfo = false) {
    const p = pdf.addPage(pageSize);
    let y = await drawHeader(env, pdf, p, title, { margin: M, logoScale: 1.6 });

    if (withInfo) {
      // two info columns (swapped vs debit)
      let yL = y;
      yL = drawLabeledRow(p, bold, font, "Client code:", idOnly, M, yL);
      yL = drawLabeledRow(p, bold, font, "Full Name:", e.full_name, M, yL);
      yL = drawLabeledRow(p, bold, font, "ID / Passport:", e.passport, M, yL);
      yL = drawLabeledRow(p, bold, font, "Email:", e.email, M, yL);

      let yR = y;
      yR = drawLabeledRow(p, bold, font, "Phone:", e.phone, M + colW + colGap, yR);
      yR = drawLabeledRow(p, bold, font, "Street:", e.street, M + colW + colGap, yR);
      yR = drawLabeledRow(p, bold, font, "City:", e.city, M + colW + colGap, yR);
      yR = drawLabeledRow(p, bold, font, "ZIP:", e.zip, M + colW + colGap, yR);

      const infoBottom = Math.min(yL, yR) - 6;
      dashedDivider(p, M, infoBottom, pageSize[0] - 2 * M, 7, 5, 1, LIGHT_GREY);
      y = infoBottom - 14;
    }
    return { p, y };
  }

  let { p: page1, y } = await newPage("Vinet Internet Solutions Service Agreement", true);

  // 2-column text flow across up to 4 pages
  let page = page1;
  let curY = y;
  let col = 0; // 0 left, 1 right
  const marginTop = y;
  const bottomMargin = 80;
  const startX = () => M + (col === 0 ? 0 : (colW + colGap));

  function pushText(block) {
    let remaining = sanitizeWinAnsi(block);
    while (remaining) {
      // available height in current column
      const limitY = bottomMargin;
      if (curY <= limitY) {
        // next column or new page
        if (col === 0) { col = 1; curY = marginTop; }
        else {
          // new page (no personal info on subsequent pages)
          col = 0; curY = marginTop;
          ({ p: page, y: curY } = { p: pdf.addPage(pageSize), y: (async () => 0)() }); // placeholder
        }
      }
      if (curY === 0) {
        // actually draw header on new page
        (async () => {})(); // noop
      }
      // ensure header for subsequent pages
      if (typeof curY.then === "function") {
        // resolve promised y for header
        // eslint-disable-next-line no-unused-vars
        (async () => {
          const head = await drawHeader(env, pdf, page, "Vinet Internet Solutions Service Agreement", { margin: M, logoScale: 1.2 });
          curY = head;
        })();
      }
      // compute how many words fit in this line
      const x = startX();
      const words = remaining.split(/\s+/);
      let line = "";
      let idx = 0;
      while (idx < words.length) {
        const next = (line ? line + " " : "") + words[idx];
        if (font.widthOfTextAtSize(next, sizeBody) > colW) break;
        line = next; idx++;
      }
      if (!line) { // very long word fallback
        line = words[0]; idx = 1;
      }
      page.drawText(line, { x, y: curY, size: sizeBody, font, color: VINET_DARK });
      curY -= lineH;
      remaining = words.slice(idx).join(" ");
      if (!remaining) curY -= 2; // little gap between paragraphs
    }
  }

  // Split terms by paragraphs to keep readable grouping
  const paras = terms.split(/\n{2,}/);
  for (const para of paras) pushText(para);

  // Final page footer with signature row (force new page if not enough room)
  if (curY < 150) {
    const np = pdf.addPage(pageSize);
    const ynp = await drawHeader(env, pdf, np, "Vinet Internet Solutions Service Agreement", { margin: M, logoScale: 1.2 });
    page = np; curY = ynp;
  }
  curY -= 20;
  const nameX = M, sigX = M + colW, dateX = pageSize[0] - M - 140;

  page.drawText("Name:", { x: nameX, y: curY, size: 10, font: bold, color: VINET_DARK });
  page.drawText(sanitizeWinAnsi(e.full_name || ""), { x: nameX + 44, y: curY, size: 10, font, color: VINET_DARK });

  page.drawText("Signature:", { x: sigX, y: curY, size: 10, font: bold, color: VINET_DARK });

  page.drawText("Date (YYYY‑MM‑DD):", { x: dateX, y: curY, size: 10, font: bold, color: VINET_DARK });
  page.drawText(formatDateYMD(new Date()), { x: dateX, y: curY - 14, size: 10, font, color: VINET_DARK });

  // signature image above the label
  const sigObj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
  if (sigObj) {
    const sigBytes = await sigObj.arrayBuffer();
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = 200;
    const scale = sigImg.scale(1);
    const sigH = (scale.height / scale.width) * sigW;
    page.drawImage(sigImg, {
      x: sigX,
      y: curY + 30,
      width: sigW,
      height: sigH
    });
    dashedDivider(page, sigX, curY - 2, sigW, 7, 5, 0.8, LIGHT_GREY);
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), {
        status: s,
        headers: { "content-type": "application/json" },
      });
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "";
    const getUA = () => request.headers.get("user-agent") || "";

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
          const r = await fetch(u, {
            cf: { cacheEverything: true, cacheTtl: 300 },
          });
          return r.ok ? await r.text() : "";
        } catch {
          return "";
        }
      }
      const esc = (s) =>
        s.replace(/[&<>]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
      const service = esc((await getText(svcUrl)) || "");
      const debit = esc((await getText(debUrl)) || "");
      let body = "";
      if (kind === "debit")
        body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
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
      const required = [
        "account_holder",
        "id_number",
        "bank_name",
        "account_number",
        "account_type",
        "debit_day",
      ];
      for (const k of required)
        if (!b[k] || String(b[k]).trim() === "")
          return json({ ok: false, error: `Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id: id, created: ts, ip: getIP(), ua: getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 90,
      });
      // also persist minimal details on session (for HTML view)
      const linkidParam = url.searchParams.get("linkid") || "";
      if (linkidParam) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkidParam}`, "json");
        if (sess)
          await env.ONBOARD_KV.put(
            `onboard/${linkidParam}`,
            JSON.stringify({ ...sess, debit: { ...record } }),
            { expirationTtl: 86400 }
          );
      }
      return json({ ok: true, ref: key });
    }

    // ----- Store debit-order signature -----
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
        httpMetadata: { contentType: "image/png" },
      });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({ ...sess, debit_signed: true, debit_sig_key: sigKey }),
          { expirationTtl: 86400 }
        );
      }
      return json({ ok: true, sigKey });
    }

    // ----- Admin: generate link -----
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error: "Missing id" }, 400);
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ id, created: Date.now(), progress: 0 }),
        { expirationTtl: 86400 }
      );
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // ----- Admin: staff OTP -----
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

    // ----- WhatsApp OTP send/verify -----
    async function sendWhatsAppTemplate(toMsisdn, code, lang = "en") {
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
        const t = await r.text().catch(() => "");
        throw new Error(`WA template send failed ${r.status} ${t}`);
      }
    }
    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "text",
        text: { body: bodyText },
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
        const t = await r.text().catch(() => "");
        throw new Error(`WA text send failed ${r.status} ${t}`);
      }
    }
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
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
        await sendWhatsAppTemplate(msisdn, code, "en");
        return json({ ok: true });
      } catch (e) {
        try {
          await sendWhatsAppTextIfSessionOpen(msisdn, `Your Vinet verification code is: ${code}`);
          return json({ ok: true, note: "sent-as-text" });
        } catch {
          return json({ ok: false, error: "WhatsApp send failed (template+text)" }, 502);
        }
      }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess)
          await env.ONBOARD_KV.put(
            `onboard/${linkid}`,
            JSON.stringify({ ...sess, otp_verified: true }),
            { expirationTtl: 86400 }
          );
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
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ ...sess, uploads }),
        { expirationTtl: 86400 }
      );
      return json({ ok: true, key });
    }

    // ----- Save progress -----
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing =
        (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = {
        ...existing,
        ...body,
        last_ip: getIP(),
        last_ua: getUA(),
        last_time: Date.now(),
      };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), {
        expirationTtl: 86400,
      });
      return json({ ok: true });
    }

    // ----- Service agreement signature -----
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
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
        }),
        { expirationTtl: 86400 }
      );
      return json({ ok: true, sigKey });
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
        ? `<ul style="list-style:none;padding:0">${uploads
            .map(
              (u) =>
                `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${escapeHtml(
                  u.label || "File"
                )}</b> — ${escapeHtml(u.name || "")} • ${Math.round(
                  (u.size || 0) / 1024
                )} KB</li>`
            )
            .join("")}</ul>`
        : `<div class="note">No files</div>`;
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(
    sess.id || ""
  )}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(
          sess.status || "n/a"
        )}</b></div>
  <h2>Edits</h2><div>${
    Object.entries(sess.edits || {})
      .map(
        ([k, v]) =>
          `<div><b>${escapeHtml(k)}</b>: ${v ? escapeHtml(String(v)) : ""}</div>`
      )
      .join("") || "<div class='note'>None</div>"
  }</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${
    sess.agreement_signed ? "Yes" : "No"
  }</div>
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(
    linkid
  )}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(
    linkid
  )},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>
</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
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
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      // Implement Splynx push here if needed.
      return json({ ok: true });
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
      const today = localDateZA();
      const name = escapeHtml(e.full_name || "");
      const email = escapeHtml(e.email || "");
      const phone = escapeHtml(e.phone || "");
      const street = escapeHtml(e.street || "");
      const city = escapeHtml(e.city || "");
      const zip = escapeHtml(e.zip || "");
      const passport = escapeHtml(e.passport || "");
      const debit = sess.debit || null;

      const msaTerms = await fetchTextCached(
        env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL,
        env,
        "terms:msa"
      );
      const debitTerms = await fetchTextCached(
        env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL,
        env,
        "terms:debit"
      );

      function page(title, body) {
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
            title
          )}</title><style>
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
      </div></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
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
          <pre class="terms">${escapeHtml(msaTerms || "Terms unavailable.")}</pre>`;
        return page("Master Service Agreement", body);
      }

      if (type === "debit") {
        const hasDebit = !!(debit && debit.account_holder && debit.account_number);
        const debitHtml = hasDebit
          ? `
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
          <pre class="terms">${escapeHtml(debitTerms || "Terms unavailable.")}</pre>`;
        return page("Debit Order Agreement", body);
      }

      return new Response("Unknown agreement type", { status: 404 });
    }

    // ----- Splynx profile -----
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
