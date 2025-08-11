// --- Vinet Onboarding Worker ---
// Build: Stamped PDFs from templates + Security/Audit page for each PDF

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// Default templates (can override with wrangler vars SERVICE_PDF_KEY / DEBIT_PDF_KEY)
const DEFAULT_MSA_PDF   = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DEFAULT_DEBIT_PDF = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";

// --- Network allow-list (admin UI) ---
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  // 160.226.128.0/20
  return (a===160 && b===226 && c>=128 && c<=143);
}

function catTime(ts) {
  try {
    const d = new Date(ts || Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

async function fetchBytesFromUrl(url) {
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(`Fetch ${url} failed ${r.status}`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}
function drawText(page, text, x, y, opts) {
  const { font, size = 10, color = rgb(0,0,0), maxWidth = null, lineHeight = 1.2 } = opts || {};
  if (!text) return;
  const words = String(text).split(/\s+/);
  if (!maxWidth) { page.drawText(String(text), { x, y, size, font, color }); return; }
  let line = "", cy = y;
  for (const w of words) {
    const tryLine = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width <= maxWidth) { line = tryLine; continue; }
    if (line) page.drawText(line, { x, y: cy, size, font, color });
    line = w; cy -= size * lineHeight;
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color });
}
function drawBBox(page, x, y, w, h) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(1,0,0), borderWidth: 0.75, color: rgb(1,0,0), opacity: 0.06 });
}

// --- Device id (deterministic, non-PII) ---
async function deviceIdFromParts(parts) {
  const s = parts.join("|");
  const enc = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", enc);
  const b = Array.from(new Uint8Array(h)).slice(0, 12); // 12 bytes -> 24 hex chars
  return b.map(x => x.toString(16).padStart(2, "0")).join("");
}

// --- Splynx helpers ---
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPATCH(env, endpoint, data) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}`, 'content-type': 'application/json' },
    body: JSON.stringify(data || {})
  });
  if (!r.ok) throw new Error(`Splynx PATCH ${endpoint} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}
async function splynxUploadDoc(env, type, id, filename, bytes, contentType) {
  const fd = new FormData();
  fd.set('file', new Blob([bytes], { type: contentType || 'application/octet-stream' }), filename);
  const ep = (type === 'lead')
    ? `/admin/crm/leads/${id}/documents`
    : `/admin/customers/customer/${id}/documents`;
  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: fd
  });
  if (!r.ok) throw new Error(`Splynx upload ${ep} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.wirelessmsisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; } }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map(k => String(k).toLowerCase());
  const stack=[obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k,v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim(); if (s) return s;
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
    `/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
  }
  return null;
}
async function fetchProfileForDisplay(env, id) {
  let cust=null, lead=null, contacts=null, custInfo=null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street ?? src.address ?? src.address_1 ?? (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";
  const city   = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip    = src.zip_code ?? src.zip ?? (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","idnumber","national_id","identity","identity_number","document","id_card","identity","identity_number","document_number"]) || "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id, full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// --- Field positions (you can fine-tune as needed; ?bbox=1 shows the red boxes) ---
// Coordinates assume A4 ~ 595x842pt (origin bottom-left).

const MSA_FIELDS = {
  // Page 1 (index 0)
  full_name_p1: { page: 0, x: 125, y: 180, size: 12, w: 260 },
  passport_p1:  { page: 0, x: 125, y: 215, size: 12, w: 260 },  // ID / Passport
  id_p1:        { page: 0, x: 145, y: 245, size: 12, w: 240 },  // Vinet Client Code
  sig_box_p1:   { page: 0, x: 400, y: 700, w: 180, h: 45 },      // Signature image (added)

  // Page 4 (index 3)
  full_name_p4: { page: 3, x: 400, y: 640, size: 12, w: 200 },
  sig_box_p4:   { page: 3, x: 400, y: 670, w: 180, h: 45 },      // Signature image
  date_p4:      { page: 3, x: 360, y: 700, size: 12, w: 140 },
};

// Debit Order: single page (index 0) + ID + signature/date
const DEBIT_FIELDS = {
  // All on page 1 (index 0)
  account_holder: { page: 0, x:  60, y: 145, size: 12, w: 260 },
  id_number:      { page: 0, x:  65, y: 200, size: 12, w: 260 },
  bank_name:      { page: 0, x: 100, y: 245, size: 12, w: 220 },
  account_number: { page: 0, x:  95, y: 290, size: 12, w: 220 },
  account_type:   { page: 0, x:  80, y: 340, size: 12, w: 200 },
  debit_day:      { page: 0, x: 150, y: 395, size: 12, w: 120 },
  sig_box:        { page: 0, x: 110, y: 440,       w: 160, h: 40 }, // Signature image
  date_field:     { page: 0, x: 100, y: 480, size: 12, w: 160 },
  id_field:       { page: 0, x: 170, y: 535, size: 12, w: 180 },     // Vinet Client Code
};

// --- PDF renderers (with audit page) ---
async function renderMsaPdf(env, linkid, bbox) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status: 404 });

  const e = sess.edits || {};
  const idOnly = (linkid || "").split("_")[0];
  const tplUrl = env.SERVICE_PDF_KEY || DEFAULT_MSA_PDF;
  const tplBytes = await fetchBytesFromUrl(tplUrl);
  const pdf = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const pages = pdf.getPages();

  const p1 = pages[MSA_FIELDS.full_name_p1.page];
  if (bbox) drawBBox(p1, MSA_FIELDS.full_name_p1.x, MSA_FIELDS.full_name_p1.y - 10, MSA_FIELDS.full_name_p1.w, 14);
  drawText(p1, e.full_name || "", MSA_FIELDS.full_name_p1.x, MSA_FIELDS.full_name_p1.y, { font, size: MSA_FIELDS.full_name_p1.size, maxWidth: MSA_FIELDS.full_name_p1.w });

  if (bbox) drawBBox(p1, MSA_FIELDS.passport_p1.x, MSA_FIELDS.passport_p1.y - 10, MSA_FIELDS.passport_p1.w, 14);
  drawText(p1, e.passport || "", MSA_FIELDS.passport_p1.x, MSA_FIELDS.passport_p1.y, { font, size: MSA_FIELDS.passport_p1.size, maxWidth: MSA_FIELDS.passport_p1.w });

  if (bbox) drawBBox(p1, MSA_FIELDS.id_p1.x, MSA_FIELDS.id_p1.y - 10, MSA_FIELDS.id_p1.w, 14);
  drawText(p1, idOnly, MSA_FIELDS.id_p1.x, MSA_FIELDS.id_p1.y, { font, size: MSA_FIELDS.id_p1.size, maxWidth: MSA_FIELDS.id_p1.w });

  // Page 1: signature image (duplicate the final signature on page 1 as requested)
  if (sess.agreement_sig_key && MSA_FIELDS.sig_box_p1) {
    const sigBytes1 = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sigBytes1) {
      const png1 = await pdf.embedPng(sigBytes1);
      const f1 = MSA_FIELDS.sig_box_p1;
      const { width: iw1, height: ih1 } = png1.scale(1);
      let w1 = f1.w, h1 = (ih1/iw1)*w1;
      if (h1 > f1.h) { h1 = f1.h; w1 = (iw1/ih1)*h1; }
      if (bbox) drawBBox(p1, f1.x, f1.y, f1.w, f1.h);
      p1.drawImage(png1, { x: f1.x, y: f1.y, width: w1, height: h1 });
    }
  }

  // Page 4: full name, date, signature image
  const p4 = pages[MSA_FIELDS.full_name_p4.page];
  if (bbox) drawBBox(p4, MSA_FIELDS.full_name_p4.x, MSA_FIELDS.full_name_p4.y - 10, MSA_FIELDS.full_name_p4.w, 14);
  drawText(p4, e.full_name || "", MSA_FIELDS.full_name_p4.x, MSA_FIELDS.full_name_p4.y, { font, size: MSA_FIELDS.full_name_p4.size, maxWidth: MSA_FIELDS.full_name_p4.w });

  if (bbox) drawBBox(p4, MSA_FIELDS.date_p4.x, MSA_FIELDS.date_p4.y - 10, MSA_FIELDS.date_p4.w, 14);
  drawText(p4, catTime(sess.last_time || Date.now()), MSA_FIELDS.date_p4.x, MSA_FIELDS.date_p4.y, { font, size: MSA_FIELDS.date_p4.size, maxWidth: MSA_FIELDS.date_p4.w });

  if (sess.agreement_sig_key) {
    const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sigBytes) {
      const png = await pdf.embedPng(sigBytes);
      const f = MSA_FIELDS.sig_box_p4;
      const { width, height } = png.scale(1);
      let w = f.w, h = (height/width)*w;
      if (h > f.h) { h = f.h; w = (width/height)*h; }
      if (bbox) drawBBox(p4, f.x, f.y, f.w, f.h);
      p4.drawImage(png, { x: f.x, y: f.y, width: w, height: h });
    }
  }

  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

async function renderDebitPdf(env, linkid, bbox) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });

  const idOnly = (linkid || "").split("_")[0];
  const d = sess.debit || {};
  const tplUrl = env.DEBIT_PDF_KEY || DEFAULT_DEBIT_PDF;
  const tplBytes = await fetchBytesFromUrl(tplUrl);
  const pdf = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const p = pdf.getPages()[0];

  const T = DEBIT_FIELDS;
  const box = (f) => bbox && drawBBox(p, f.x, f.y - 10, f.w || 80, 14);
  box(T.account_holder); drawText(p, d.account_holder || "", T.account_holder.x, T.account_holder.y, { font, size: T.account_holder.size, maxWidth: T.account_holder.w });
  box(T.id_number);      drawText(p, d.id_number || "",      T.id_number.x,      T.id_number.y,      { font, size: T.id_number.size,      maxWidth: T.id_number.w });
  box(T.bank_name);      drawText(p, d.bank_name || "",      T.bank_name.x,      T.bank_name.y,      { font, size: T.bank_name.size,      maxWidth: T.bank_name.w });
  box(T.account_number); drawText(p, d.account_number || "", T.account_number.x, T.account_number.y, { font, size: T.account_number.size, maxWidth: T.account_number.w });
  box(T.account_type);   drawText(p, d.account_type || "",   T.account_type.x,   T.account_type.y,   { font, size: T.account_type.size,   maxWidth: T.account_type.w });
  box(T.debit_day);      drawText(p, d.debit_day || "",      T.debit_day.x,      T.debit_day.y,      { font, size: T.debit_day.size,      maxWidth: T.debit_day.w });

  if (bbox) drawBBox(p, T.id_field.x, T.id_field.y - 10, T.id_field.w, 14);
  drawText(p, idOnly, T.id_field.x, T.id_field.y, { font, size: T.id_field.size, maxWidth: T.id_field.w });

  if (bbox) drawBBox(p, T.date_field.x, T.date_field.y - 10, T.date_field.w, 14);
  drawText(p, catTime(sess.last_time || Date.now()), T.date_field.x, T.date_field.y, { font, size: T.date_field.size, maxWidth: T.date_field.w });

  if (sess.debit_sig_key) {
    const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sigBytes) {
      const png = await pdf.embedPng(sigBytes);
      const f = T.sig_box;
      const { width, height } = png.scale(1);
      let w = f.w, h = (height/width)*w;
      if (h > f.h) { h = f.h; w = (width/height)*h; }
      if (bbox) drawBBox(p, f.x, f.y, f.w, f.h);
      p.drawImage(png, { x: f.x, y: f.y, width: w, height: h });
    }
  }

  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// Security/Audit Page appended to PDFs
async function appendSecurityPage(pdf, sess, linkid) {
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sizeTitle = 18;
  const margin = 36;

  page.drawText("VINET — Agreement Security Summary", { x: margin, y: 842 - margin - sizeTitle, size: sizeTitle, font, color: rgb(0.88, 0.0, 0.10) });

  const t = catTime(sess.last_time || Date.now());
  const devId = sess.device_id || "n/a";
  const ua = sess.last_ua || "n/a";
  const loc = sess.last_loc || {};

  const lines = [
    [`Link ID`, linkid],
    [`Splynx ID`, (linkid || "").split("_")[0]],
    [`IP Address`, sess.last_ip || "n/a"],
    [`Location`, [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "n/a"],
    [`Coordinates`, (loc.latitude!=null && loc.longitude!=null) ? `${loc.latitude}, ${loc.longitude}` : "n/a"],
    [`ASN / Org`, [loc.asn, loc.asOrganization].filter(Boolean).join(" • ") || "n/a"],
    [`Cloudflare PoP`, loc.colo || "n/a"],
    [`User-Agent`, ua || "n/a"],
    [`Device ID`, devId],
    [`Timestamp`, t],
  ];

  let y = 842 - margin - 36;
  const keyW = 140;
  const size = 11;

  lines.forEach(([k, v]) => {
    page.drawText(k + ":", { x: margin, y, size, font, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(v||""), { x: margin + keyW, y, size, font, color: rgb(0,0,0) });
    y -= 18;
  });

  page.drawText("This page is appended for audit purposes and should accompany the agreement.", { x: margin, y: margin, size: 10, font, color: rgb(0.4,0.4,0.4) });
}

// --- Admin UI (minimal) ---
function renderAdminUI() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .row{display:flex;gap:.6em;align-items:center}
  .note{font-size:12px;color:#666}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Admin Dashboard</h1>
  <div style="max-width:640px;margin:0 auto">
    <label>Splynx Lead/Customer ID</label>
    <div class="row"><input id="id" autocomplete="off"><button class="btn" id="go">Generate onboarding link</button></div>
    <div id="out" class="note" style="margin-top:.6em"></div>
    <hr style="margin:1.2em 0;border:none;border-top:1px solid #eee">
    <label>Onboarding link ID (e.g. 319_ab12cd34)</label>
    <div class="row"><input id="linkid" autocomplete="off"><button class="btn" id="gen">Generate staff code</button></div>
    <div id="out2" class="note" style="margin-top:.6em"></div>
  </div>
</div>
<script>
document.getElementById('go').onclick=async()=>{
  const id=document.getElementById('id').value.trim(); const out=document.getElementById('out');
  if(!id){out.textContent='Please enter an ID.';return;}
  out.textContent='Working...';
  try{
    const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    out.innerHTML=d.url?('<b>Link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'):'Error.';
  }catch{out.textContent='Network error.';}
};
document.getElementById('gen').onclick=async()=>{
  const linkid=document.getElementById('linkid').value.trim(); const out=document.getElementById('out2');
  if(!linkid){out.textContent='Enter linkid';return;}
  out.textContent='Working...';
  try{
    const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
    const d=await r.json().catch(()=>({}));
    out.innerHTML=d.ok?('Staff code: <b>'+d.code+'</b> (valid 15 min)'):(d.error||'Failed');
  }catch{out.textContent='Network error.';}
};
</script></body></html>`;
}

// --- Onboarding UI (unchanged visuals) ---
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
</style></head><body>
<div class="card" id="wrap">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Vinet Client Onboarding</h1>
  <div id="content"></div>
</div>
<script>
(function(){
  const linkid = location.pathname.split('/').pop();

  function qs(id){return document.getElementById(id)}
  function esc(s){return String(s||'').replace(/[&<>]/g,t=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[t]))}

  let step = 0;
  let state = null;

  async function load(){
    const r = await fetch('/api/session/'+linkid);
    if (!r.ok) { qs('content').innerHTML='<p>Invalid or expired link.</p>'; return; }
    state = await r.json().catch(()=>null);
    state = state || {};
    step = Math.max(0, Math.min(6, state.progress || 0));
    render();
  }

  function save(){
    fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state||{})});
  }

  function setProg(){
    const p = Math.round((step/6)*100);
    qs('wrap').style.setProperty('--prog', p+'%');
  }

  function step0(){
    const el = qs('content');
    el.innerHTML=[
      '<p>Welcome! We\'ll guide you through a few quick steps to complete your onboarding.</p>',
      '<div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>',
      '<div class="field"><label>Phone</label><input id="phone" type="tel" autocomplete="tel"></div>',
      '<div class="row"><button class="btn" id="next">Continue</button></div>'
    ].join('');
    qs('next').onclick=(e)=>{e.preventDefault(); state=state||{}; state.email=qs('email').value.trim(); state.phone=qs('phone').value.trim(); step=1; state.progress=step; setProg(); save(); render();};
  }

  function step1(){
    const el = qs('content');
    el.innerHTML=[
      '<h2>Your details</h2>',
      '<div class="field"><label>Full name</label><input id="full" autocomplete="name"></div>',
      '<div class="field"><label>ID / Passport</label><input id="idp"></div>',
      '<div class="field"><label>Street</label><input id="street" autocomplete="address-line1"></div>',
      '<div class="field"><label>City</label><input id="city" autocomplete="address-level2"></div>',
      '<div class="field"><label>ZIP</label><input id="zip" autocomplete="postal-code"></div>',
      '<div class="row"><a class="btn-outline" id="back">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');
    qs('back').onclick=(e)=>{e.preventDefault(); step=0; state.progress=step; setProg(); save(); render();};
    qs('next').onclick=(e)=>{e.preventDefault(); state=state||{}; state.edits=state.edits||{}; state.edits.full_name=qs('full').value.trim(); state.edits.passport=qs('idp').value.trim(); state.edits.street=qs('street').value.trim(); state.edits.city=qs('city').value.trim(); state.edits.zip=qs('zip').value.trim(); step=2; state.progress=step; setProg(); save(); render();};
  }

  function step2(){
    const el = qs('content');
    el.innerHTML=[
      '<h2>Choose products</h2>',
      '<div class="field"><label>Product selection</label><textarea id="products" rows="3" placeholder="e.g., FTTH 50/50, Router, Installation"></textarea></div>',
      '<div class="row"><a class="btn-outline" id="back">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');
    qs('back').onclick=(e)=>{e.preventDefault(); step=1; state.progress=step; setProg(); save(); render();};
    qs('next').onclick=(e)=>{e.preventDefault(); state=state||{}; state.products=qs('products').value.trim(); step=3; state.progress=step; setProg(); save(); render();};
  }

  function step3(){
    const el = qs('content');
    el.innerHTML=[
      '<h2>Uploads</h2>',
      '<div class="field"><label>ID Document</label><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><label>Proof of Address</label><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    qs('back3').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
    qs('next').onclick=async(e)=>{
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
        return { key:d.key, label };
      }
      try {
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
    const el = qs('content');
    el.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" width="600" height="160" style="border:1px solid #ddd;border-radius:.5em;background:#fff"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=(function(canvas){const ctx=canvas.getContext('2d');let drawing=false,x;
      canvas.onmousedown=e=>{drawing=true;x=true;ctx.beginPath();ctx.moveTo(e.offsetX,e.offsetY)};
      canvas.onmousemove=e=>{if(drawing){ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineTo(e.offsetX,e.offsetY);ctx.stroke()}};
      window.onmouseup=()=>{drawing=false};
      return { clear(){ctx.clearRect(0,0,canvas.width,canvas.height);x=false;}, dataURL(){return canvas.toDataURL('image/png');}, isEmpty(){return !x;} }
    })(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault();
      const msg=document.getElementById('sigMsg');
      if (!document.getElementById('agreeChk').checked) { msg.textContent='Please accept the agreement.'; return; }
      if (pad.isEmpty()) { msg.textContent='Please draw your signature.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({}));
        if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent='Could not save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    const el = qs('content');
    el.innerHTML=[
      '<h2>Done!</h2>',
      '<p>Thanks — your onboarding is submitted. Our team will review and finalize.</p>',
      '<p>If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">',
        '<li><a href="/agreements/pdf/msa/'+linkid+'" target="_blank">MSA (PDF)</a> <a href="/agreements/pdf/msa/'+linkid+'?bbox=1" target="_blank" class="note">debug</a></li>',
        (showDebit ? '<li><a href="/agreements/pdf/debit/'+linkid+'" target="_blank">Debit Order (PDF)</a> <a href="/agreements/pdf/debit/'+linkid+'?bbox=1" target="_blank" class="note">debug</a></li>' : ''),
      '</ul>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// --- Worker entry ---
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};
    const json = (obj, status=200) => new Response(JSON.stringify(obj), { status, headers: { "content-type":"application/json" } });

    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Admin page
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminUI(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const id = path.split("/").pop();
      return new Response(renderOnboardUI(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Admin: generate onboarding link
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ splynx_id:id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Admin: staff OTP
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

    // Terms (HTML)
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      const getText = async (u)=>{ try{ const r=await fetch(u,{cf:{cacheTtl:300, cacheEverything:true}}); return r.ok?await r.text():""; }catch{return "";} };
      const esc = s => s.replace(/[&<>]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[t]));
      const body = (kind==="debit")
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(await getText(debUrl))}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(await getText(svcUrl))}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Session fetch
    if (path.startsWith("/api/session/") && method === "GET") {
      const linkid = path.split("/")[3];
      const data = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!data) return json({ error:"Invalid link" }, 404);
      return json(data);
    }

    // Save progress (capture audit info here)
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      // Build last_loc from CF
      const last_loc = {
        city: cf.city || "", region: cf.region || "", country: cf.country || "",
        latitude: cf.latitude || "", longitude: cf.longitude || "",
        timezone: cf.timezone || "", postalCode: cf.postalCode || "",
        asn: cf.asn || "", asOrganization: cf.asOrganization || "", colo: cf.colo || ""
      };
      const last_ip = getIP();
      const last_ua = getUA();
      const baseForDev = [last_ua, last_ip, cf.asn || "", cf.colo || "", (linkid || "").slice(0,8)];
      const device_id = existing.device_id || await deviceIdFromParts(baseForDev);
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads (R2)
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      return json({ ok:true, key });
    }

    // Debit save + signature
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(()=>null);
        if (!form) return {};
        const o = {}; for (const [k,v] of form.entries()) o[k]=v; return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // MSA signature (PNG in R2) + mark as pending
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // Serve signature images (legacy HTML printouts still reference these)
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

    // PDFs (stamped) + bbox debug
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      const showBBox = url.searchParams.get("bbox") === "1";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      try {
        if (type === "msa")   return await renderMsaPdf(env, linkid, showBBox);
        if (type === "debit") return await renderDebitPdf(env, linkid, showBBox);
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    // Info (EFT printable)
    if (path === "/info/eft" && method === "GET") {
      const body = `<!doctype html><meta charset="utf-8"><title>Vinet EFT Details</title>
      <style>body{font-family:system-ui,sans-serif;margin:2em;color:#232} h1{color:#e2001a}</style>
      <h1>Electronic Funds Transfer (EFT)</h1>
      <p><b>Account:</b> Vinet Internet Solutions</p>
      <p><b>Bank:</b> First National Bank (FNB)</p>
      <p><b>Account No:</b> 123456789</p>
      <p><b>Branch Code:</b> 250655</p>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // Admin: list onboarding sessions
    if (path === "/api/admin/sessions" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "50")));
      const cursor = url.searchParams.get("cursor") || undefined;
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", cursor, limit });
      const sessions = [];
      for (const k of list.keys) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (s) {
          sessions.push({
            linkid: k.name.split("/").pop(),
            splynx_id: s.splynx_id || (k.name.split("/").pop() || "").split("_")[0],
            status: s.status || (s.agreement_signed ? "completed" : "pending"),
            progress: s.progress || 0,
            created: s.created || 0,
            last_time: s.last_time || 0
          });
        }
      }
      return json({ ok:true, items: sessions, cursor: list.cursor, list_complete: list.list_complete });
    }

    // Admin: get a single session
    if (path.startsWith("/api/admin/session/") && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"not_found" }, 404);
      const uploads = await env.R2_UPLOADS.list({ prefix: `uploads/${linkid}/` });
      return json({ ok:true, session: sess, uploads: uploads.objects?.map(o => ({ key:o.key, size:o.size, uploaded:o.uploaded })) || [] });
    }

    // Admin: update (merge) edits for a session
    if (path.startsWith("/api/admin/session/") && method === "PATCH") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const patch = await request.json().catch(()=>({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"not_found" }, 404);
      const edits = { ...(sess.edits || {}), ...(patch.edits || patch) };
      const next = { ...sess, edits, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin: delete (soft) a session
    if (path.startsWith("/api/admin/session/") && method === "DELETE") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"not_found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"deleted", last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin: push to Splynx (update fields + upload documents)
    if (path.startsWith("/api/admin/push/") && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"not_found" }, 404);
      const idOnly = (linkid || "").split("_")[0];

      // Detect lead vs customer
      let type = "lead";
      try { await splynxGET(env, `/crm/leads/${idOnly}`); type = "lead"; } 
      catch { try { await splynxGET(env, `/admin/customers/customer/${idOnly}`); type = "customer"; } catch { return json({ ok:false, error:"id_unknown" }, 404); } }

      // Patch core data
      const data = { ...(sess.edits || {}) };
      try {
        if (type === "lead") await splynxPATCH(env, `/admin/crm/leads/${idOnly}`, data);
        else await splynxPATCH(env, `/admin/customers/customer/${idOnly}`, data);
      } catch (e) {
        return json({ ok:false, error:`patch_failed:${e.message}` }, 502);
      }

      // Upload agreements (MSA / Debit if present)
      try {
        const msaResp = await renderMsaPdf(env, linkid, false);
        const msaBytes = await msaResp.arrayBuffer();
        await splynxUploadDoc(env, type, idOnly, "msa.pdf", msaBytes, "application/pdf");
      } catch (e) { /* ignore single doc failure */ }

      try {
        if (sess.debit_sig_key) {
          const debResp = await renderDebitPdf(env, linkid, false);
          const debBytes = await debResp.arrayBuffer();
          await splynxUploadDoc(env, type, idOnly, "debit-order.pdf", debBytes, "application/pdf");
        }
      } catch (e) { /* ignore */ }

      // Upload any extra files from R2 uploads
      try {
        const files = await env.R2_UPLOADS.list({ prefix: `uploads/${linkid}/` });
        for (const o of (files.objects || [])) {
          const obj = await env.R2_UPLOADS.get(o.key);
          if (!obj) continue;
          const arr = await obj.arrayBuffer();
          const name = o.key.split("/").pop() || "upload.bin";
          await splynxUploadDoc(env, type, idOnly, name, arr, obj.httpMetadata?.contentType || "application/octet-stream");
        }
      } catch (e) { /* ignore */ }

      // Mark pushed
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"pushed", pushed_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true, type, id: idOnly });
    }

    // Splynx lookup (normalized)
    if (path === "/api/splynx/lookup" && method === "POST") {
      const { id, type } = await request.json().catch(()=>({}));
      if (!id) return json({ ok:false, error:"missing_id" }, 400);

      async function tryJson(ep) {
        const r = await fetch(`${env.SPLYNX_API}${ep}`, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }});
        const t = await r.text();
        if (!r.ok) throw new Error(`${r.status}`);
        try { return JSON.parse(t); } catch { throw new Error("parse"); }
      }

      let out=null;
      if (type==="lead" || type==="auto" || !type) {
        try { const j = await tryJson(`/crm/leads/${id}`); out = { type:"lead", id:j.id, email:j.email, phone:j.phone, name:j.name || j.full_name || "", address:j.address || j.street || "", additional_attributes: j.additional_attributes || {} }; } catch {}
      }
      if (!out && (type==="customer" || type==="auto" || !type)) {
        try { const j = await tryJson(`/admin/customers/customer/${id}`); out = { type:"customer", id:j.id, email:j.email || j.billing_email || "", phone:j.phone || "", name: [j.first_name||"", j.last_name||""].join(" ").trim(), address:j.address || j.street || "", additional_attributes: j.additional_attributes || {} }; } catch {}
      }
      if (!out) return json({ ok:false, error:"not_found" }, 404);
      return json({ ok:true, ...out });
    }

    return new Response("Not found", { status: 404 });
  }
};
