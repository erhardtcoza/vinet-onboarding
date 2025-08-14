// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, EFT & Debit Order pages, Splynx push
// Restored features:
// • OTP (WhatsApp + staff code) with 10–15 min expiry
// • Debit Order step: signature canvas + required checkbox
// • MSA & Debit PDFs via pdf-lib with security block (IP, time, device)
// • Uploads step (ID + Proof of Address) -> Splynx document endpoints
// • Admin dashboard (classic look) + link generator + review lists
// • KV-backed onboarding links (24h), OTP & staff codes
// • D1-backed tracking for in-progress / pending / approved (optional)
// • Terms endpoint for service & debit order (remote text files)
// • Multi-source Splynx contact/ID extraction robustness
//
// Notes:
// - Keep your secrets in wrangler.toml [vars]/[env] bindings (do NOT hardcode).
// - Required bindings (create these in wrangler): 
//     KV: LINK_KV
//     D1: DB  (optional; features auto-noop if missing)
//     R2: (optional) UPLOADS_R2 for local file holding — we push to Splynx directly anyway.
// - Required vars:
//     SPLYNX_API (e.g. "https://splynx.vinet.co.za/api/2.0")
//     SPLYNX_AUTH (Basic ... string)
//     BASE_URL (e.g. "https://onboard.vinet.co.za")  // used for admin link output
//     TERMS_SERVICE_URL (txt file) default: https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt
//     TERMS_DEBIT_URL   (txt file) default: https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt
//     MSA_TEMPLATE_URL  (PDF) default: https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf
//     DEBIT_TEMPLATE_URL(PDF) default: https://onboarding-uploads.vinethosting.org/templates/VINET_DEBIT.pdf
//     WHATSAPP_TOKEN, PHONE_NUMBER_ID (optional; OTP SMS/WA send)
// - Access control: "/" (admin) locked to VNET ASN range 160.226.128.0/20

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const ALLOWED_IPS = ["160.226.128.0/20"]; // VNET ASN range
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

const DEFAULTS = {
  TERMS_SERVICE_URL: "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt",
  TERMS_DEBIT_URL: "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt",
  MSA_TEMPLATE_URL: "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf",
  DEBIT_TEMPLATE_URL: "https://onboarding-uploads.vinethosting.org/templates/VINET_DEBIT.pdf",
};

// ---------- Helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  // Only allow 160.226.128.0/20 => 160.226.128.0 - 160.226.143.255
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

function esc(s = "") {
  return String(s).replace(/[&<>"]/g, t => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[t]);
}

function rand(n = 6) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function nowISO() { return new Date().toISOString(); }

async function fetchText(url) {
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
    if (!res.ok) return "";
    return await res.text();
  } catch { return ""; }
}

async function fetchArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetchArrayBuffer: ${url} ${r.status}`);
  return await r.arrayBuffer();
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

async function splynxPUT(env, endpoint, payload) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Splynx PUT ${endpoint} ${r.status}`);
  return r.json().catch(() => ({}));
}

async function splynxPOSTForm(env, endpoint, form) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Splynx POST ${endpoint} ${r.status}`);
  return r.json().catch(() => ({}));
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn,
    obj.primary_phone, obj.contact_number, obj.billing_phone
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const m = pickPhone(it);
      if (m) return m;
    }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const m = pickPhone(obj[k]);
      if (m) return m;
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

async function fetchProfileForDisplay(env, id) {
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}
  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });
  const street = src.street ?? src.address ?? src.address_1 ?? src.street_1
    ?? (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";
  const city = src.city ?? (src.addresses && src.addresses.city) ?? "";
  const zip = src.zip_code ?? src.zip ?? (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport", "id_number", "idnumber", "national_id", "id_card", "identity", "identity_number", "document_number"]) ||
    "";
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

// ---------- KV helpers ----------
const kvKey = {
  link: (linkid) => `link:${linkid}`,
  staff: (linkid) => `staff:${linkid}`,
  otp: (linkid) => `otp:${linkid}`,
  state: (linkid) => `state:${linkid}`, // JSON snapshot of progress
};

// ---------- D1 helpers ----------
async function ensureTables(env) {
  if (!env.DB) return;
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS onboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      splynx_id TEXT,
      linkid TEXT,
      status TEXT, -- inprog | pending | approved
      updated INTEGER
    );
  `);
}

async function markStatus(env, splynx_id, linkid, status) {
  if (!env.DB) return;
  await ensureTables(env);
  const ts = Date.now();
  await env.DB.prepare(
    `INSERT INTO onboard (splynx_id, linkid, status, updated) VALUES (?1, ?2, ?3, ?4)`
  ).bind(String(splynx_id), String(linkid), String(status), ts).run();
}

async function listByMode(env, mode) {
  if (!env.DB) return { items: [] };
  await ensureTables(env);
  const stmt = env.DB.prepare(`
    SELECT splynx_id as id, linkid, updated FROM onboard
    WHERE status = ?1 ORDER BY updated DESC LIMIT 100
  `).bind(mode);
  const { results } = await stmt.all();
  return { items: results || [] };
}

// ---------- WhatsApp OTP ----------
async function sendWhatsAppOTP(env, msisdn, code) {
  // if WA not configured, pretend success and return the code
  if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) {
    return { ok: true, sent: false, note: "WA not configured", code };
  }
  const url = `https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: msisdn,
    type: "text",
    text: { body: `Your Vinet onboarding code is: ${code}` }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  const ok = r.ok;
  return { ok, sent: ok, code };
}

// ---------- EFT Info Page (simple) ----------
async function renderEFTPage(id) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>EFT Payment Details</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 820px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  .card { border: 1px solid #eee; border-radius: 12px; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .row { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; padding: 8px 0; border-bottom: 1px solid #f2f2f2; }
  .row:last-child { border-bottom: 0; }
  .muted { color: #666; font-size: 13px; margin-top: 8px; }
  .print { margin-top: 12px; }
  button { padding: 8px 12px; border-radius: 8px; border: 1px solid #ddd; cursor: pointer; }
</style>
</head>
<body>
  <h1>EFT Payment Details</h1>
  <div class="card">
    <div class="row"><div>Bank</div><div>First National Bank (FNB)</div></div>
    <div class="row"><div>Account Name</div><div>Vinet Internet Solutions</div></div>
    <div class="row"><div>Account Number</div><div>xxxxxxxxxx</div></div>
    <div class="row"><div>Branch Code</div><div>250 655</div></div>
    <div class="row"><div>Reference</div><div>${esc(id || "")}</div></div>
  </div>
  <p class="muted">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div class="print"><button onclick="window.print()">Print</button></div>
</body>
</html>`;
}

// ---------- Admin Dashboard (classic) ----------
function renderAdminPage() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{ --red:#d90429; }
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:0; background:#fafafa;}
  header{display:flex;gap:12px;align-items:center;padding:12px 16px;background:white;border-bottom:1px solid #eee; position:sticky; top:0; z-index:10;}
  header img{height:38px;}
  h1{font-size:18px;margin:0;}
  .wrap{max-width:1100px;margin:24px auto;padding:0 16px;}
  .tabs{display:flex;gap:8px;margin:12px 0;}
  .tab{border:1px solid #ddd;padding:8px 12px;border-radius:10px;background:white;cursor:pointer}
  .tab.active{border-color:var(--red);color:var(--red);font-weight:600}
  #content{background:white;border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);min-height:320px}
  table{border-collapse:collapse;width:100%}
  th,td{border-bottom:1px solid #f3f3f3;padding:8px 10px;text-align:left}
  tr:last-child td{border-bottom:0}
  input,button{font:inherit}
  button{padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer}
  button.primary{border-color:var(--red);background:var(--red);color:white}
  .row{display:grid;grid-template-columns:200px 1fr;gap:8px 16px;margin:8px 0}
  .muted{color:#666;font-size:13px;margin-top:6px}
  code{background:#f6f6f6;padding:2px 6px;border-radius:6px}
</style>
</head>
<body>
<header>
  <img src="${LOGO_URL}" alt="Vinet"/>
  <h1>Admin Dashboard</h1>
</header>
<div class="wrap">
  <div class="tabs">
    <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
    <div class="tab" data-tab="staff">2. Generate verification code</div>
    <div class="tab" data-tab="inprog">3. Pending (in-progress)</div>
    <div class="tab" data-tab="pending">4. Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">5. Approved</div>
  </div>
  <div id="content">Loading…</div>
</div>
<script src="/static/admin.js"></script>
</body>
</html>`;
}

function adminJs() {
  return `(()=>{
const tabs = document.querySelectorAll('.tab');
const content = document.getElementById('content');
tabs.forEach(t => t.onclick = () => {
  tabs.forEach(x => x.classList.remove('active')); t.classList.add('active');
  load(t.getAttribute('data-tab'));
});
load('gen');

const node = (html) => { const d=document.createElement('div'); d.innerHTML=html; return d; };

async function load(which){
  if (which==='gen') {
    content.innerHTML='';
    const v=node(\`
      <div class="row">
        <label>Splynx Lead/Customer ID</label>
        <input id="id" type="text" placeholder="e.g. 319"/>
      </div>
      <button id="go" class="primary">Generate</button>
      <div id="out" class="muted" style="margin-top:10px"></div>
    \`);
    v.querySelector('#go').onclick=async()=>{
      const id=v.querySelector('#id').value.trim();
      const out=v.querySelector('#out');
      if(!id){out.textContent='Please enter an ID.';return;}
      out.textContent='Working...';
      try{
        const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML=d.url?('Onboarding link: <a href="'+d.url+'" target="_blank" rel="noreferrer">'+d.url+'</a>'):'Error generating link.';
      }catch{out.textContent='Network error.';}
    };
    content.appendChild(v);
    return;
  }
  if (which==='staff') {
    content.innerHTML='';
    const v=node(\`
      <div class="row">
        <label>Onboarding Link ID (e.g. 319_ab12cd)</label>
        <input id="linkid" type="text" placeholder="319_ab12cd"/>
      </div>
      <button id="go" class="primary">Generate staff code</button>
      <div id="out" class="muted" style="margin-top:10px"></div>
    \`);
    v.querySelector('#go').onclick=async()=>{
      const linkid=v.querySelector('#linkid').value.trim();
      const out=v.querySelector('#out');
      if(!linkid){out.textContent='Enter linkid';return;}
      out.textContent='Working...';
      try{
        const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML=d.ok?('Staff code: <b>'+d.code+'</b> (valid 15 min)'):(d.error||'Failed');
      }catch{out.textContent='Network error.';}
    };
    content.appendChild(v);
    return;
  }
  if (['inprog','pending','approved'].includes(which)) {
    content.innerHTML='Loading...';
    try{
      const r=await fetch('/api/admin/list?mode='+which);
      const d=await r.json();
      const rows=(d.items||[]).map(i=>\`<tr>
        <td>\${i.id}</td>
        <td><code>\${i.linkid}</code></td>
        <td>\${new Date(i.updated).toLocaleString()}</td>
        <td>\${which==='pending'?'<a href="/onboard/'+i.linkid+'" target="_blank">Review</a>':'<a href="/onboard/'+i.linkid+'" target="_blank">Open</a>'}</td>
      </tr>\`).join('')||'<tr><td colspan="4">No records.</td></tr>';
      content.innerHTML=\`<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Action</th></tr></thead><tbody>\${rows}</tbody></table>\`;
    }catch{content.innerHTML='Failed to load.';}
    return;
  }
}
})();`;
}

// ---------- Onboarding Page ----------
function renderOnboardPage(linkid) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Vinet Onboarding</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{ --red:#d90429; }
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:0; background:#fff;}
  header{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0 6px;border-bottom:1px solid #eee}
  header img{height:64px;margin:6px 0}
  header h1{font-size:18px;margin:6px 0 0}
  .wrap{max-width:880px;margin:0 auto;padding:12px 16px 32px}
  .card{border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-top:16px}
  .row{display:grid;grid-template-columns:160px 1fr;gap:10px 16px;margin:8px 0}
  input,select,button,textarea{font:inherit}
  input,select,textarea{border:1px solid #ddd;border-radius:10px;padding:8px 10px;width:100%}
  button{padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:white;cursor:pointer}
  button.primary{border-color:var(--red);background:var(--red);color:white}
  .hint{color:#666;font-size:13px}
  .step{display:none}
  .step.active{display:block}
  canvas{border:1px dashed #ccc;border-radius:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .flex{display:flex;gap:10px;align-items:center}
</style>
</head>
<body>
<header>
  <img src="${LOGO_URL}" alt="Vinet"/>
  <h1>Client Onboarding</h1>
</header>
<div class="wrap">
  <div class="card">
    <div class="hint">Link ID: <code id="linkid">${esc(linkid)}</code></div>
    <div id="status" class="hint" style="margin-top:6px"></div>
  </div>

  <div class="card step active" id="s1">
    <h2>Step 1: Verify</h2>
    <p>We sent a 6-digit code to your WhatsApp. Enter it below. A staff member may also give you a verification code.</p>
    <div class="flex">
      <input id="otp" placeholder="Enter code"/>
      <button id="btnSend">Resend</button>
      <button id="btnVerify" class="primary">Verify</button>
    </div>
    <div id="otpMsg" class="hint"></div>
  </div>

  <div class="card step" id="s2">
    <h2>Step 2: Confirm details</h2>
    <div class="row"><div>Full name</div><div><input id="full_name"/></div></div>
    <div class="row"><div>ID/Passport</div><div><input id="id_number"/></div></div>
    <div class="row"><div>Customer ID</div><div><input id="customer_id"/></div></div>
    <div class="row"><div>Email</div><div><input id="email"/></div></div>
    <div class="row"><div>Phone</div><div><input id="phone"/></div></div>
    <div class="row"><div>Street</div><div><input id="street"/></div></div>
    <div class="row"><div>City</div><div><input id="city"/></div></div>
    <div class="row"><div>ZIP</div><div><input id="zip"/></div></div>
    <div class="hint">These details are used for your service agreement and billing.</div>
    <div style="margin-top:10px"><button id="to3" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s3">
    <h2>Step 3: Payment method</h2>
    <div class="row">
      <div>Choose</div>
      <div>
        <select id="pay">
          <option value="eft">EFT</option>
          <option value="debit">Debit Order</option>
        </select>
      </div>
    </div>
    <div id="payInfo" class="hint"></div>
    <div style="margin-top:10px"><button id="to4" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s4">
    <h2>Step 4: Upload documents</h2>
    <div class="grid2">
      <div>
        <div>ID Document (max 5MB)</div>
        <input type="file" id="file_id"/>
      </div>
      <div>
        <div>Proof of Address (optional, max 5MB)</div>
        <input type="file" id="file_poa"/>
      </div>
    </div>
    <div class="hint">JPEG/PNG/PDF accepted.</div>
    <div style="margin-top:10px"><button id="to5" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s5">
    <h2>Step 5: Sign agreements</h2>
    <div class="grid2">
      <div>
        <div>MSA Signature</div>
        <canvas id="sig1" width="500" height="180"></canvas>
        <div class="hint">Draw with your mouse or finger.</div>
        <button id="clear1">Clear</button>
      </div>
      <div>
        <div>Debit Order (if selected)</div>
        <canvas id="sig2" width="500" height="180"></canvas>
        <div class="flex"><input id="agreeDebit" type="checkbox"/><label for="agreeDebit"> I authorize debit orders from my bank account.</label></div>
        <button id="clear2">Clear</button>
      </div>
    </div>
    <div style="margin-top:10px"><button id="to6" class="primary">Generate PDFs</button></div>
    <div id="pdfLinks" class="hint" style="margin-top:10px"></div>
  </div>

  <div class="card step" id="s6">
    <h2>All done</h2>
    <p>You can download your agreements above. Our team will review and activate your service.</p>
    <a id="eftLink" target="_blank" rel="noreferrer">View EFT details</a>
  </div>
</div>

<script>
const linkid = ${JSON.stringify(linkid)};
const $ = sel => document.querySelector(sel);
const S = n => $('.step.active')?.classList.remove('active'), document.getElementById('s'+n).classList.add('active');

// Simple canvas signature helper
function Sig(el){
  const c=el, ctx=c.getContext('2d');
  let down=false, last=null;
  c.addEventListener('pointerdown',e=>{down=true; last=[e.offsetX,e.offsetY]});
  c.addEventListener('pointerup',()=>{down=false; last=null});
  c.addEventListener('pointerleave',()=>{down=false; last=null});
  c.addEventListener('pointermove',e=>{
    if(!down)return;
    ctx.lineWidth=2; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke();
    last=[e.offsetX,e.offsetY];
  });
  return { clear:()=>ctx.clearRect(0,0,c.width,c.height), data:()=>c.toDataURL('image/png') };
}

const sig1 = Sig(document.getElementById('sig1'));
const sig2 = Sig(document.getElementById('sig2'));
document.getElementById('clear1').onclick=()=>sig1.clear();
document.getElementById('clear2').onclick=()=>sig2.clear();

async function getJSON(url, opts){ const r=await fetch(url,opts); try{return await r.json()}catch{return {}} }
function ua(){ return navigator.userAgent || '' }

// Step 1: OTP
$('#btnSend').onclick = async () => {
  $('#otpMsg').textContent='Sending...';
  const d = await getJSON('/api/otp/send', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
  $('#otpMsg').textContent = d.ok ? 'Code sent.' : ('Failed: '+(d.error||'Check with staff for a code.'));
};
$('#btnVerify').onclick = async () => {
  const code = ($('#otp').value||'').trim();
  if(!code){ $('#otpMsg').textContent='Enter code'; return; }
  const d = await getJSON('/api/otp/verify', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, code})});
  if(d.ok){
    $('#otpMsg').textContent='Verified.';
    // Preload profile:
    const prof = await getJSON('/api/profile?linkid='+encodeURIComponent(linkid));
    if(prof && prof.id){
      $('#full_name').value = prof.full_name||'';
      $('#id_number').value = prof.passport||'';
      $('#customer_id').value = prof.id||'';
      $('#email').value = prof.email||'';
      $('#phone').value = prof.phone||'';
      $('#street').value = prof.street||'';
      $('#city').value = prof.city||'';
      $('#zip').value = prof.zip||'';
      $('#status').textContent='Verified at '+new Date().toLocaleString();
    }
    S(2);
  } else {
    $('#otpMsg').textContent='Invalid code';
  }
};

// Step 2
$('#to3').onclick = () => { S(3); $('#payInfo').innerHTML=''; };

// Step 3
$('#to4').onclick = async () => {
  const v = $('#pay').value;
  const q = new URLSearchParams({kind: v==='debit'?'debit':'service', pay: v});
  const terms = await fetch('/api/terms?'+q.toString()).then(r=>r.text()).catch(()=>'');
  $('#payInfo').innerHTML = terms || 'Terms unavailable.';
  S(4);
};

// Step 4
$('#to5').onclick = async () => {
  const idf = document.getElementById('file_id').files[0];
  const poa = document.getElementById('file_poa').files[0];
  const fd = new FormData();
  if (idf) fd.append('id', idf);
  if (poa) fd.append('poa', poa);
  fd.append('linkid', linkid);
  const r = await fetch('/api/upload', { method:'POST', body: fd });
  const ok = r.ok;
  if (!ok) alert('Upload failed (continuing anyway).');
  S(5);
};

// Step 5
$('#to6').onclick = async () => {
  const common = {
    full_name: $('#full_name').value.trim(),
    id_number: $('#id_number').value.trim(),
    customer_id: $('#customer_id').value.trim(),
    address: ($('#street').value+' '+$('#city').value+' '+$('#zip').value).trim(),
    date: new Date().toISOString(),
    ip: '',
    user_agent: ua()
  };
  // fetch IP (server computes in endpoint anyway)
  const msaBody = { ...common, signature: sig1.data(), linkid };
  const debitBody = { ...common, agree: $('#agreeDebit').checked, signature: sig2.data(), linkid };
  const pay = $('#pay').value;

  const msa = await fetch('/api/pdf/msa', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(msaBody) });
  let links = '';
  if (msa.ok) {
    const blob = await msa.blob(); const url = URL.createObjectURL(blob);
    links += '<div><a download="MSA.pdf" href="'+url+'">Download MSA</a></div>';
  } else { links += '<div>MSA failed</div>'; }

  if (pay==='debit' && $('#agreeDebit').checked) {
    const deb = await fetch('/api/pdf/debit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(debitBody) });
    if (deb.ok) { const blob = await deb.blob(); const url = URL.createObjectURL(blob); links += '<div><a download="Debit_Order.pdf" href="'+url+'">Download Debit Order</a></div>'; }
    else { links += '<div>Debit Order failed</div>'; }
  }

  document.getElementById('pdfLinks').innerHTML = links || 'No files.';
  document.getElementById('eftLink').href = '/info/eft?id='+encodeURIComponent($('#customer_id').value.trim());
  S(6);
};
</script>
</body>
</html>`;
}

// ---------- Terms ----------
async function termsHandler(env, url) {
  const kind = (url.searchParams.get("kind") || "").toLowerCase();
  const pay = (url.searchParams.get("pay") || "").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL || DEFAULTS.TERMS_SERVICE_URL;
  const debUrl = env.TERMS_DEBIT_URL || DEFAULTS.TERMS_DEBIT_URL;
  const service = esc(await fetchText(svcUrl) || "");
  const debit = esc(await fetchText(debUrl) || "");
  let body = "";
  if (kind === "debit" || pay === "debit") {
    body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
  } else {
    body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
  }
  return new Response(body || "<em>Terms unavailable.</em>", {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

// ---------- PDF helpers ----------
async function renderPdfFromTemplate(templateBytes, opts) {
  const {
    full_name = "", id_number = "", customer_id = "",
    address = "", date = "", ip = "", user_agent = "",
    signatureDataURL = null, heading = "Agreement"
  } = opts;

  const doc = await PDFDocument.load(templateBytes).catch(async () => {
    // fallback: blank PDF with basic text
    const d = await PDFDocument.create();
    const p = d.addPage([595, 842]);
    const font = await d.embedFont(StandardFonts.Helvetica);
    const draw = (txt, x, y, size = 12) => p.drawText(txt, { x, y, size, font, color: rgb(0,0,0) });
    draw(heading, 40, 800, 18);
    draw(`Name: ${full_name}`, 40, 760);
    draw(`ID/Passport: ${id_number}`, 40, 740);
    draw(`Customer ID: ${customer_id}`, 40, 720);
    draw(`Address: ${address}`, 40, 700);
    draw(`Date: ${date}`, 40, 680);
    draw(`IP: ${ip}`, 40, 660);
    draw(`UA: ${user_agent}`, 40, 640);
    return d;
  });

  // If template successfully loaded, append a sign-off page with security.
  if (doc.getPageCount() > 0) {
    const p = doc.addPage([595, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const draw = (txt, x, y, size = 11) => p.drawText(txt, { x, y, size, font, color: rgb(0,0,0) });
    draw("Signature & Security", 40, 170, 13);
    draw(`Signed by: ${full_name}`, 40, 150);
    draw(`ID/Passport: ${id_number}`, 40, 135);
    draw(`Customer ID: ${customer_id}`, 40, 120);
    draw(`On: ${date}`, 40, 105);
    draw(`IP: ${ip}`, 40, 90);
    draw(`Device: ${user_agent}`, 40, 75);
    if (signatureDataURL) {
      try {
        const pngBytes = Uint8Array.from(atob(signatureDataURL.split(",")[1]||""), c=>c.charCodeAt(0));
        const png = await doc.embedPng(pngBytes);
        const { width, height } = png.scale(0.6);
        p.drawImage(png, { x: 380, y: 70, width, height });
      } catch {}
    }
  }

  const out = await doc.save();
  return new Response(out, { headers: { "content-type": "application/pdf" } });
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

    // ----- Admin UI -----
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

    // ----- Admin: generate onboarding link -----
    if (path === "/api/admin/genlink" && method === "POST") {
      try {
        const { id } = await request.json();
        const base = env.BASE_URL || `${url.protocol}//${url.host}`;
        const linkid = `${String(id).trim()}_${rand(6)}`;
        await env.LINK_KV.put(kvKey.link(linkid), JSON.stringify({ id: String(id).trim(), created: Date.now() }), { expirationTtl: 60 * 60 * 24 });
        await markStatus(env, String(id).trim(), linkid, "inprog");
        return json({ ok: true, url: `${base}/onboard/${linkid}`, linkid });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    // ----- Admin: list by mode -----
    if (path === "/api/admin/list" && method === "GET") {
      const mode = url.searchParams.get("mode") || "inprog";
      try {
        const d = await listByMode(env, mode);
        return json(d);
      } catch (e) { return json({ items: [], error: String(e) }, 200); }
    }

    // ----- Staff code -----
    if (path === "/api/staff/gen" && method === "POST") {
      try {
        const { linkid } = await request.json();
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await env.LINK_KV.put(kvKey.staff(linkid), code, { expirationTtl: 60 * 15 });
        return json({ ok: true, code });
      } catch (e) { return json({ ok: false, error: String(e) }, 500); }
    }

    // ----- OTP send/verify -----
    if (path === "/api/otp/send" && method === "POST") {
      try {
        const { linkid } = await request.json();
        const stored = await env.LINK_KV.get(kvKey.link(linkid), { type: "json" });
        if (!stored?.id) return json({ ok: false, error: "Invalid link" }, 400);
        const prof = await fetchProfileForDisplay(env, stored.id);
        const msisdn = prof.phone; // must be 27...
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await env.LINK_KV.put(kvKey.otp(linkid), code, { expirationTtl: 60 * 10 });
        let sent = { ok: false, note: "no msisdn" };
        if (msisdn) sent = await sendWhatsAppOTP(env, msisdn, code);
        return json({ ok: true, sent, msisdn: msisdn || null });
      } catch (e) { return json({ ok: false, error: String(e) }, 500); }
    }

    if (path === "/api/otp/verify" && method === "POST") {
      try {
        const { linkid, code } = await request.json();
        if (!linkid || !code) return json({ ok: false, error: "Missing" }, 400);
        const otp = await env.LINK_KV.get(kvKey.otp(linkid));
        const staff = await env.LINK_KV.get(kvKey.staff(linkid));
        if (otp && code.trim() === otp) return json({ ok: true, kind: "otp" });
        if (staff && code.trim() === staff) return json({ ok: true, kind: "staff" });
        return json({ ok: false });
      } catch (e) { return json({ ok: false, error: String(e) }, 500); }
    }

    // ----- Profile (preload after OTP) -----
    if (path === "/api/profile" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const stored = await env.LINK_KV.get(kvKey.link(linkid), { type: "json" });
      if (!stored?.id) return json({});
      const prof = await fetchProfileForDisplay(env, stored.id);
      return json(prof || {});
    }

    // ----- Upload docs -> Splynx -----
    if (path === "/api/upload" && method === "POST") {
      const form = await request.formData();
      const linkid = form.get("linkid");
      const stored = await env.LINK_KV.get(kvKey.link(linkid), { type: "json" });
      const id = stored?.id;
      if (!id) return json({ ok: false, error: "Invalid link" }, 400);
      let okAny = false;
      async function sendOne(field, endpoint) {
        const f = form.get(field);
        if (!f) return;
        if (typeof f === "string") return;
        if (f.size > 5 * 1024 * 1024) throw new Error(`${field} too large`);
        const fd = new FormData();
        fd.append("file", f, f.name);
        await splynxPOSTForm(env, endpoint, fd);
        okAny = true;
      }
      try {
        // Leads documents endpoint (works for both leads/customers on many Splynx installs; adjust if needed)
        await sendOne("id", `/crm/lead-documents/upload-file?lead_id=${encodeURIComponent(id)}`);
        await sendOne("poa", `/crm/lead-documents/upload-file?lead_id=${encodeURIComponent(id)}`);
        return json({ ok: true, uploaded: okAny });
      } catch (e) { return json({ ok: false, error: String(e) }, 500); }
    }

    // ----- Terms -----
    if (path === "/api/terms" && method === "GET") {
      return await termsHandler(env, url);
    }

    // ----- PDF: MSA -----
    if (path === "/api/pdf/msa" && method === "POST") {
      try {
        const body = await request.json();
        const { signature, full_name, id_number, customer_id, address, date, linkid } = body || {};
        const templateUrl = env.MSA_TEMPLATE_URL || DEFAULTS.MSA_TEMPLATE_URL;
        const templateBytes = await fetchArrayBuffer(templateUrl).catch(() => null);
        await markStatus(env, customer_id || "unknown", linkid || "", "pending");
        const resp = await renderPdfFromTemplate(templateBytes, {
          full_name, id_number, customer_id, address, date,
          ip: getIP(), user_agent: getUA(), signatureDataURL: signature, heading: "Master Service Agreement"
        });
        return resp;
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }

    // ----- PDF: Debit Order -----
    if (path === "/api/pdf/debit" && method === "POST") {
      try {
        const body = await request.json();
        const { signature, full_name, id_number, customer_id, address, date, linkid, agree } = body || {};
        if (!agree) return new Response("Agreement checkbox not ticked", { status: 400 });
        const templateUrl = env.DEBIT_TEMPLATE_URL || DEFAULTS.DEBIT_TEMPLATE_URL;
        const templateBytes = await fetchArrayBuffer(templateUrl).catch(() => null);
        await markStatus(env, customer_id || "unknown", linkid || "", "pending");
        const resp = await renderPdfFromTemplate(templateBytes, {
          full_name, id_number, customer_id, address, date,
          ip: getIP(), user_agent: getUA(), signatureDataURL: signature, heading: "Debit Order Instruction"
        });
        return resp;
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }

    // ----- Onboarding landing -----
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = decodeURIComponent(path.split("/").pop() || "");
      const valid = await env.LINK_KV.get(kvKey.link(linkid), { type: "json" });
      if (!valid?.id) return new Response("Invalid or expired link.", { status: 404 });
      return new Response(renderOnboardPage(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Catch-all: 404
    return new Response("Not found", { status: 404 });
  }
};
