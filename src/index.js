// --- Vinet Onboarding Worker ---
// Admin dashboard (classic), onboarding flow, OTP, uploads, and PDF generation (no templates)
//
// This build follows your specs exactly:
// 1) Admin page UI/behavior as in the older working code
// 2) PDFs are fully rendered with pdf-lib (no external templates):
//    - Header: Title (top-left), Vinet logo (top-right), and under the logo: website + phone
//    - Thin dashed rule under the header
//    - Debit Order: client info block + debit details + terms (reduced font size by ~4pt)
//    - MSA: same look; client info (left), address (right)
//    - Signatures row at the bottom: Name (left) • Signature (center) • Date DD/MM/YYYY (right)
//    - Security Audit page as the last page
//
// Required bindings & vars (wrangler.toml):
// [[kv_namespaces]] binding="LINK_KV" id="..."
// [[d1_databases]] binding="DB" database_name="..." database_id="..."
// [vars]
// SPLYNX_API="https://splynx.vinet.co.za/api/2.0"
// SPLYNX_AUTH="<Basic ...>"
// BASE_URL="https://onboard.vinet.co.za"
// TERMS_SERVICE_URL="https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt"
// TERMS_DEBIT_URL="https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt"
// WHATSAPP_TOKEN="<optional>"  PHONE_NUMBER_ID="<optional>"
//
// Access control: "/" locked to 160.226.128.0/20.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const ALLOWED_IPS = ["160.226.128.0/20"];
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const BRAND = { site: "www.vinet.co.za", phone: "021 007 0200" };

// ---------- Helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const esc = (s="") => String(s).replace(/[&<>"]/g, t => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[t]));
const rand = (n=6) => { const cs="abcdefghjkmnpqrstuvwxyz23456789"; let o=""; for(let i=0;i<n;i++)o+=cs[Math.floor(Math.random()*cs.length)]; return o; };
const nowISO = () => new Date().toISOString();

async function fetchText(url) {
  try { const res = await fetch(url, { cf: { cacheEverything:true, cacheTtl:300 } }); if (!res.ok) return ""; return await res.text(); } catch { return ""; }
}
async function fetchArrayBuffer(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`fetchArrayBuffer: ${url} ${r.status}`); return await r.arrayBuffer();
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` } });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPOSTForm(env, endpoint, form) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { method: "POST", headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }, body: form });
  if (!r.ok) throw new Error(`Splynx POST ${endpoint} ${r.status}`);
  return r.json().catch(()=>({}));
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile,obj.mobile,obj.phone,obj.whatsapp,obj.msisdn,obj.primary_phone,obj.contact_number,obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m=pickPhone(it); if(m) return m; } }
  else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) { const m=pickPhone(obj[k]); if(m) return m; }
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
      for (const [k,v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) { const s=String(v??"").trim(); if (s) return s; }
        if (v && typeof v === "object") stack.push(v);
      }
    }
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
  const street = src.street ?? src.address ?? src.address_1 ?? src.street_1 ?? (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? "";
  const city   = src.city   ?? (src.addresses && src.addresses.city) ?? "";
  const zip    = src.zip_code ?? src.zip ?? (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? "";
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","idnumber","national_id","id_card","identity","identity_number","document_number"]) || "";
  return { kind: cust ? "customer" : (lead ? "lead" : "unknown"), id, full_name: src.full_name || src.name || "", email: src.email || src.billing_email || "", phone: phone || "", city, street, zip, passport };
}

// ---------- KV keys ----------
const kvKey = {
  link:  id => `link:${id}`,
  otp:   id => `otp:${id}`,
  staff: id => `staff:${id}`,
};

// ---------- D1 (optional) ----------
async function ensureTables(env){ if(!env.DB) return; await env.DB.exec(`CREATE TABLE IF NOT EXISTS onboard(id INTEGER PRIMARY KEY AUTOINCREMENT, splynx_id TEXT, linkid TEXT, status TEXT, updated INTEGER);`); }
async function markStatus(env, splynx_id, linkid, status){ if(!env.DB) return; await ensureTables(env); const ts=Date.now(); await env.DB.prepare(`INSERT INTO onboard (splynx_id,linkid,status,updated) VALUES (?1,?2,?3,?4)`).bind(String(splynx_id),String(linkid),String(status),ts).run(); }
async function listByMode(env, mode){ if(!env.DB) return {items:[]}; await ensureTables(env); const stmt=env.DB.prepare(`SELECT splynx_id as id, linkid, updated FROM onboard WHERE status=?1 ORDER BY updated DESC LIMIT 100`).bind(mode); const {results}=await stmt.all(); return {items: results||[]}; }

// ---------- WhatsApp OTP ----------
async function sendWhatsAppOTP(env, msisdn, code){
  if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) return { ok:true, sent:false, note:"WA not configured", code };
  const url = `https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`;
  const body = { messaging_product:"whatsapp", to: msisdn, type:"text", text:{ body:`Your Vinet onboarding code is: ${code}` } };
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${env.WHATSAPP_TOKEN}` }, body: JSON.stringify(body) });
  return { ok:r.ok, sent:r.ok, code };
}

// ---------- EFT Info Page (unchanged visual skeleton) ----------
async function renderEFTPage(id){
  return `<!doctype html><html><head><meta charset="utf-8"/><title>EFT Payment Details</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0 0 16px}.card{border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.row{display:grid;grid-template-columns:180px 1fr;gap:8px 16px;padding:8px 0;border-bottom:1px solid #f2f2f2}.row:last-child{border-bottom:0}.muted{color:#666;font-size:13px;margin-top:8px}.print{margin-top:12px}button{padding:8px 12px;border-radius:8px;border:1px solid #ddd;cursor:pointer}</style>
</head><body>
<h1>EFT Payment Details</h1>
<div class="card">
  <div class="row"><div>Bank</div><div>First National Bank (FNB)</div></div>
  <div class="row"><div>Account Name</div><div>Vinet Internet Solutions</div></div>
  <div class="row"><div>Account Number</div><div>xxxxxxxxxx</div></div>
  <div class="row"><div>Branch Code</div><div>250 655</div></div>
  <div class="row"><div>Reference</div><div>${esc(id||"")}</div></div>
</div>
<p class="muted">Please remember that all accounts are payable on or before the 1st of every month.</p>
<div class="print"><button onclick="window.print()">Print</button></div>
</body></html>`;
}

// ---------- Admin Dashboard (keep classic) ----------
function renderAdminPage(){
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>:root{--red:#d90429}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#fafafa}header{display:flex;gap:12px;align-items:center;padding:12px 16px;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:10}header img{height:38px}h1{font-size:18px;margin:0}.wrap{max-width:1100px;margin:24px auto;padding:0 16px}.tabs{display:flex;gap:8px;margin:12px 0}.tab{border:1px solid #ddd;padding:8px 12px;border-radius:10px;background:#fff;cursor:pointer}.tab.active{border-color:var(--red);color:var(--red);font-weight:600}#content{background:#fff;border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);min-height:320px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #f3f3f3;padding:8px 10px;text-align:left}tr:last-child td{border-bottom:0}input,button{font:inherit}button{padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}button.primary{border-color:var(--red);background:var(--red);color:#fff}.row{display:grid;grid-template-columns:200px 1fr;gap:8px 16px;margin:8px 0}.muted{color:#666;font-size:13px;margin-top:6px}code{background:#f6f6f6;padding:2px 6px;border-radius:6px}</style>
</head><body>
<header><img src="${LOGO_URL}" alt="Vinet"/><h1>Admin Dashboard</h1></header>
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
</body></html>`;
}
function adminJs(){
  return `(()=>{
const tabs=[...document.querySelectorAll('.tab')]; const content=document.getElementById('content');
tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); load(t.getAttribute('data-tab'));});
load('gen');
const node=html=>{const d=document.createElement('div'); d.innerHTML=html; return d;};

async function load(which){
  if(which==='gen'){
    content.innerHTML='';
    const v=node('<div class="row"><label>Splynx Lead/Customer ID</label><input id="id" type="text" placeholder="e.g. 319"/></div><button id="go" class="primary">Generate</button><div id="out" class="muted" style="margin-top:10px"></div>');
    v.querySelector('#go').onclick=async()=>{
      const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
      if(!id){ out.textContent='Please enter an ID.'; return; }
      out.textContent='Working...';
      try{
        const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML = d.url ? ('Onboarding link: <a href="'+d.url+'" target="_blank" rel="noreferrer">'+d.url+'</a>') : 'Error generating link.';
      }catch{ out.textContent='Network error.'; }
    };
    content.appendChild(v); return;
  }
  if(which==='staff'){
    content.innerHTML='';
    const v=node('<div class="row"><label>Onboarding Link ID (e.g. 319_ab12cd)</label><input id="linkid" type="text" placeholder="319_ab12cd"/></div><button id="go" class="primary">Generate staff code</button><div id="out" class="muted" style="margin-top:10px"></div>');
    v.querySelector('#go').onclick=async()=>{
      const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
      if(!linkid){ out.textContent='Enter linkid'; return; }
      out.textContent='Working...';
      try{
        const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML = d.ok ? ('Staff code: <b>'+d.code+'</b> (valid 15 min)') : (d.error||'Failed');
      }catch{ out.textContent='Network error.'; }
    };
    content.appendChild(v); return;
  }
  if(['inprog','pending','approved'].includes(which)){
    content.innerHTML='Loading...';
    try{
      const r=await fetch('/api/admin/list?mode='+which);
      const d=await r.json();
      const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td><code>'+i.linkid+'</code></td><td>'+new Date(i.updated).toLocaleString()+'</td><td><a href="/onboard/'+i.linkid+'" target="_blank">Open</a></td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
      content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }catch{ content.innerHTML='Failed to load.'; }
    return;
  }
}
})();`;
}

// ---------- Onboarding UI (steps kept minimal; OTP first) ----------
function renderOnboardPage(linkid){
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Vinet Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>:root{--red:#d90429}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#fff}header{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0 6px;border-bottom:1px solid #eee}header img{height:64px;margin:6px 0}header h1{font-size:18px;margin:6px 0 0}.wrap{max-width:880px;margin:0 auto;padding:12px 16px 32px}.card{border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-top:16px}.row{display:grid;grid-template-columns:160px 1fr;gap:10px 16px;margin:8px 0}input,select,button,textarea{font:inherit}input,select,textarea{border:1px solid #ddd;border-radius:10px;padding:8px 10px;width:100%}button{padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer}button.primary{border-color:var(--red);background:var(--red);color:#fff}.hint{color:#666;font-size:13px}.step{display:none}.step.active{display:block}canvas{border:1px dashed #ccc;border-radius:8px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.flex{display:flex;gap:10px;align-items:center}</style>
</head><body>
<header><img src="${LOGO_URL}" alt="Vinet"/><h1>Client Onboarding</h1></header>
<div class="wrap">
  <div class="card"><div class="hint">Link ID: <code id="linkid">${esc(linkid)}</code></div><div id="status" class="hint" style="margin-top:6px"></div></div>

  <div class="card step active" id="s1">
    <h2>Step 1: Verify</h2>
    <p>We sent a 6-digit code to your WhatsApp. Enter it below. A staff member may also give you a verification code.</p>
    <div class="flex"><input id="otp" placeholder="Enter code"/><button id="btnSend">Resend</button><button id="btnVerify" class="primary">Verify</button></div>
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
    <div class="row"><div>Choose</div><div><select id="pay"><option value="eft">EFT</option><option value="debit">Debit Order</option></select></div></div>
    <div id="payInfo" class="hint"></div>
    <div style="margin-top:10px"><button id="to4" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s4">
    <h2>Step 4: Upload documents</h2>
    <div class="grid2">
      <div><div>ID Document (max 5MB)</div><input type="file" id="file_id"/></div>
      <div><div>Proof of Address (optional, max 5MB)</div><input type="file" id="file_poa"/></div>
    </div>
    <div class="hint">JPEG/PNG/PDF accepted.</div>
    <div style="margin-top:10px"><button id="to5" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s5">
    <h2>Step 5: Sign agreements</h2>
    <div class="grid2">
      <div><div>MSA Signature</div><canvas id="sig1" width="500" height="180"></canvas><div class="hint">Draw with your mouse or finger.</div><button id="clear1">Clear</button></div>
      <div><div>Debit Order (if selected)</div><canvas id="sig2" width="500" height="180"></canvas><div class="flex"><input id="agreeDebit" type="checkbox"/><label for="agreeDebit"> I authorize debit orders from my bank account.</label></div><button id="clear2">Clear</button></div>
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

function Sig(el){ const c=el, ctx=c.getContext('2d'); let down=false,last=null;
  c.addEventListener('pointerdown',e=>{down=true; last=[e.offsetX,e.offsetY]});
  c.addEventListener('pointerup',()=>{down=false; last=null});
  c.addEventListener('pointerleave',()=>{down=false; last=null});
  c.addEventListener('pointermove',e=>{ if(!down)return; ctx.lineWidth=2; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(last[0],last[1]); ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); last=[e.offsetX,e.offsetY]; });
  return { clear:()=>ctx.clearRect(0,0,c.width,c.height), data:()=>c.toDataURL('image/png') };
}
const sig1 = Sig(document.getElementById('sig1'));
const sig2 = Sig(document.getElementById('sig2'));
document.getElementById('clear1').onclick=()=>sig1.clear();
document.getElementById('clear2').onclick=()=>sig2.clear();

async function getJSON(url, opts){ const r=await fetch(url,opts); try{ return await r.json() }catch{ return {} } }
function ua(){ return navigator.userAgent || '' }

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

$('#to3').onclick = () => { S(3); $('#payInfo').innerHTML=''; };
$('#to4').onclick = async () => {
  const v = $('#pay').value;
  const q = new URLSearchParams({kind: v==='debit'?'debit':'service', pay: v});
  const terms = await fetch('/api/terms?'+q.toString()).then(r=>r.text()).catch(()=>'');
  $('#payInfo').innerHTML = terms || 'Terms unavailable.';
  S(4);
};
$('#to5').onclick = async () => {
  const idf = document.getElementById('file_id').files[0];
  const poa = document.getElementById('file_poa').files[0];
  const fd = new FormData(); if(idf) fd.append('id', idf); if(poa) fd.append('poa', poa); fd.append('linkid', linkid);
  const r = await fetch('/api/upload', { method:'POST', body: fd }); if(!r.ok) alert('Upload failed (continuing anyway).'); S(5);
};
$('#to6').onclick = async () => {
  const common = {
    full_name: $('#full_name').value.trim(),
    id_number: $('#id_number').value.trim(),
    customer_id: $('#customer_id').value.trim(),
    email: $('#email').value.trim(),
    phone: $('#phone').value.trim(),
    street: $('#street').value.trim(),
    city: $('#city').value.trim(),
    zip: $('#zip').value.trim(),
    date: new Date().toISOString(),
    user_agent: ua(),
    linkid
  };
  const msa = await fetch('/api/pdf/msa', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...common, signature: sig1.data() }) });
  let links = '';
  if (msa.ok) { const blob = await msa.blob(); const url = URL.createObjectURL(blob); links += '<div><a download="MSA.pdf" href="'+url+'">Download MSA</a></div>'; }
  const pay = $('#pay').value;
  if (pay==='debit' && $('#agreeDebit').checked) {
    const deb = await fetch('/api/pdf/debit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...common, signature: sig2.data(), agree: true }) });
    if (deb.ok) { const blob = await deb.blob(); const url = URL.createObjectURL(blob); links += '<div><a download="Debit_Order.pdf" href="'+url+'">Download Debit Order</a></div>'; }
  }
  document.getElementById('pdfLinks').innerHTML = links || 'No files.';
  document.getElementById('eftLink').href = '/info/eft?id='+encodeURIComponent($('#customer_id').value.trim());
  S(6);
};
</script>
</body></html>`;
}

// ---------- Terms ----------
async function termsHandler(env, url){
  const kind = (url.searchParams.get("kind") || "").toLowerCase();
  const pay  = (url.searchParams.get("pay")  || "").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const service = esc(await fetchText(svcUrl) || "");
  const debit   = esc(await fetchText(debUrl) || "");
  let body="";
  if (kind === "debit" || pay === "debit") {
    body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
  } else {
    body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
  }
  return new Response(body||"<em>Terms unavailable.</em>", { headers: { "content-type":"text/html; charset=utf-8" } });
}

// ---------- PDF RENDERING (no templates) ----------
const A4 = { w: 595.28, h: 841.89 }; // points
function ddmmyyyy(iso){ try{ const d=new Date(iso||Date.now()); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yy=d.getFullYear(); return `${dd}/${mm}/${yy}` }catch{ return "" } }
async function embedLogo(doc){
  try { const bytes = await fetchArrayBuffer(LOGO_URL); return await doc.embedJpg(bytes).catch(async()=>await doc.embedPng(bytes)); }
  catch { return null; }
}
function dashedLine(page, x, y, w, dash=6, gap=4, thickness=0.7){
  let cur=x; while(cur < x+w){ const seg=Math.min(dash, x+w-cur); page.drawLine({ start:{x:cur,y}, end:{x:cur+seg,y}, thickness, color: rgb(0.7,0.7,0.7) }); cur+=dash+gap; }
}
function drawHeader(page, fonts, logoImg, title){
  const { helv, helvBold } = fonts;
  // Title left
  page.drawText(title, { x: 40, y: A4.h-60, size: 16, font: helvBold, color: rgb(0,0,0) });
  // Logo right + contact lines
  let topY = A4.h-40;
  if (logoImg) {
    const scale = 0.18; // keep it neat
    const w = logoImg.width * scale, h = logoImg.height * scale;
    page.drawImage(logoImg, { x: A4.w-40-w, y: topY-h, width: w, height: h });
    topY = A4.h-46-h;
  }
  page.drawText(BRAND.site+" • "+BRAND.phone, { x: A4.w-220, y: topY-6, size: 10, font: helv, color: rgb(0.2,0.2,0.2) });
  dashedLine(page, 40, A4.h-70, A4.w-80);
}
function drawKV(page, fonts, x, y, kv, opts={colW:140, lineH:16, size:11}){
  const { helv, helvBold } = fonts;
  const colW = opts.colW, lineH = opts.lineH, size = opts.size;
  let yy = y;
  for (const [k,v] of kv) {
    page.drawText(String(k), { x, y: yy, size, font: helvBold });
    page.drawText(String(v||""), { x: x+colW, y: yy, size, font: helv });
    yy -= lineH;
  }
  return yy;
}
function drawTwoCols(page, fonts, xL, xR, y, leftItems, rightItems, opts={lineH:16, size:11}){
  const { helv, helvBold } = fonts;
  const size = opts.size, lineH = opts.lineH;
  let yl=y, yr=y;
  for (const [k,v] of leftItems) {
    page.drawText(String(k), { x: xL, y: yl, size, font: helvBold });
    page.drawText(String(v||""), { x: xL+120, y: yl, size, font: helv });
    yl -= lineH;
  }
  for (const [k,v] of rightItems) {
    page.drawText(String(k), { x: xR, y: yr, size, font: helvBold });
    page.drawText(String(v||""), { x: xR+120, y: yr, size, font: helv });
    yr -= lineH;
  }
  return Math.min(yl, yr);
}
function drawParagraph(page, text, fonts, x, y, maxW, size=9){
  const { helv } = fonts;
  const words = String(text||"").split(/\s+/);
  let line="", yy=y;
  for (const w of words) {
    const test = (line?line+" ":"")+w;
    const width = helv.widthOfTextAtSize(test, size);
    if (x+width > x+maxW) {
      page.drawText(line, { x, y: yy, size, font: helv });
      yy -= size+3; line = w;
    } else line = test;
  }
  if (line) { page.drawText(line, { x, y: yy, size, font: helv }); yy -= size+6; }
  return yy;
}
async function buildPDF(docType, data, request){
  // data: full_name, id_number, customer_id, email, phone, street, city, zip, signature, date, linkid
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { helv, helvBold };
  const logo = await embedLogo(doc);

  const page = doc.addPage([A4.w, A4.h]);
  drawHeader(page, fonts, logo, docType==="debit" ? "Debit Order Instruction" : "Master Service Agreement");
  let y = A4.h-100;

  // Blocks
  const clientKV = [
    ["Full Name:", data.full_name],
    ["Email:", data.email],
    ["Phone:", data.phone],
    ["Street:", data.street],
    ["City:", data.city],
    ["ZIP:", data.zip],
    ["ID / Passport:", data.id_number],
    ["Client Code:", data.customer_id]
  ];

  if (docType === "debit") {
    // Client info
    y = drawKV(page, fonts, 40, y, clientKV, { colW:140, lineH:16, size:11 }) - 8;

    // Debit details section
    page.drawText("Debit Order Details", { x:40, y, size:12, font: helvBold }); y -= 18;
    const details = [
      ["Account Holder Name:", data.account_holder || "—"],
      ["Account Holder ID / Passport:", data.holder_id || "—"],
      ["Bank:", data.bank || "—"],
      ["Bank Account No:", data.account_no || "—"],
      ["Account Type:", data.account_type || "—"],
      ["Debit Order Date:", data.debit_day || "1"]
    ];
    y = drawKV(page, fonts, 40, y, details, { colW:200, lineH:16, size:11 }) - 10;

    // Terms (smaller by ~4pt → 9pt)
    page.drawText("Debit Order Terms", { x:40, y, size:12, font: helvBold }); y -= 16;
    const termsTxt = data.terms_debit || "";
    y = drawParagraph(page, termsTxt, fonts, 40, y, A4.w-80, 9);

  } else {
    // MSA two columns: client info (left), address (right)
    page.drawText("Client Information", { x:40, y, size:12, font: helvBold });
    page.drawText("Address", { x:A4.w/2+20, y, size:12, font: helvBold }); y -= 18;
    const left = [
      ["Full Name:", data.full_name],
      ["Client Code:", data.customer_id],
      ["ID / Passport:", data.id_number],
      ["Email:", data.email],
      ["Phone:", data.phone]
    ];
    const right = [
      ["Street:", data.street],
      ["City:", data.city],
      ["ZIP:", data.zip]
    ];
    y = drawTwoCols(page, fonts, 40, A4.w/2+20, y, left, right, { lineH:16, size:11 }) - 8;

    // Body terms (service)
    page.drawText("Service Terms", { x:40, y, size:12, font: helvBold }); y -= 16;
    const serviceTxt = data.terms_service || "";
    y = drawParagraph(page, serviceTxt, fonts, 40, y, A4.w-80, 11);
  }

  // Signatures row at bottom
  y = Math.max(y, 140);
  dashedLine(page, 40, 120, A4.w-80, 4, 2, 0.5);
  const rowY = 110;
  page.drawText("Name", { x: 40, y: rowY, size: 11, font: helvBold });
  page.drawText(String(data.full_name||""), { x: 40, y: rowY-16, size: 11, font: helv });
  // Signature center
  page.drawText("Signature", { x: A4.w/2-30, y: rowY, size: 11, font: helvBold });
  if (data.signature) {
    try {
      const png = await doc.embedPng(Uint8Array.from(atob(data.signature.split(",")[1]||""), c=>c.charCodeAt(0)));
      const scale = 0.5; const w = png.width*scale, h = png.height*scale;
      page.drawImage(png, { x: A4.w/2-60, y: rowY-16-h-2, width: w, height: h });
    } catch {}
  }
  // Date right
  page.drawText("Date (DD/MM/YYYY)", { x: A4.w-190, y: rowY, size: 11, font: helvBold });
  page.drawText(ddmmyyyy(data.date), { x: A4.w-190, y: rowY-16, size: 11, font: helv });

  // Security audit page
  const audit = doc.addPage([A4.w, A4.h]);
  drawHeader(audit, fonts, logo, "VINET — Agreement Security Summary");
  let ay = A4.h-110;
  const headers = [
    ["Link ID:", data.linkid],
    ["Splynx ID:", data.customer_id],
    ["IP Address:", (request.headers.get("CF-Connecting-IP")||"")],
    ["Location:", request.headers.get("CF-IPCity") ? `${request.headers.get("CF-IPCity")}, ${request.headers.get("CF-IPCountry")||""}` : ""],
    ["Coordinates:", ""],
    ["ASN / Org:", ""],
    ["Cloudflare PoP:", (request.headers.get("CF-Ray")||"").split("-").pop() || ""],
    ["User-Agent:", request.headers.get("User-Agent") || ""],
    ["Device ID:", ""],
    ["Timestamp:", ddmmyyyy(data.date)]
  ];
  ay = drawKV(audit, fonts, 40, ay, headers, { colW:120, lineH:18, size:11 });

  const bytes = await doc.save();
  return new Response(bytes, { headers: { "content-type":"application/pdf" } });
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = (o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});

    // Basic helpers to read headers cleanly
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // ----- Admin UI (classic) -----
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type":"text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type":"application/javascript; charset=utf-8" } });
    }

    // ----- Info pages -----
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // ----- Admin: generate onboarding link (unchanged behavior) -----
    if (path === "/api/admin/genlink" && method === "POST") {
      try {
        const { id } = await request.json();
        const base = env.BASE_URL || `${url.protocol}//${url.host}`;
        const linkid = `${String(id).trim()}_${rand(6)}`;
        await env.LINK_KV.put(kvKey.link(linkid), JSON.stringify({ id: String(id).trim(), created: Date.now() }), { expirationTtl: 60*60*24 });
        await markStatus(env, String(id).trim(), linkid, "inprog");
        return json({ ok:true, url: `${base}/onboard/${linkid}`, linkid });
      } catch (e) { return json({ ok:false, error:String(e) }, 500); }
    }

    // ----- Admin: list views -----
    if (path === "/api/admin/list" && method === "GET") {
      const mode = url.searchParams.get("mode") || "inprog";
      try { const d = await listByMode(env, mode); return json(d); } catch (e) { return json({ items: [], error:String(e) }, 200); }
    }

    // ----- Staff code -----
    if (path === "/api/staff/gen" && method === "POST") {
      try {
        const { linkid } = await request.json();
        const code = String(Math.floor(100000 + Math.random()*900000));
        await env.LINK_KV.put(kvKey.staff(linkid), code, { expirationTtl: 60*15 });
        return json({ ok:true, code });
      } catch (e) { return json({ ok:false, error:String(e) }, 500); }
    }

    // ----- OTP send/verify -----
    if (path === "/api/otp/send" && method === "POST") {
      try {
        const { linkid } = await request.json();
        const stored = await env.LINK_KV.get(kvKey.link(linkid), { type:"json" });
        if (!stored?.id) return json({ ok:false, error:"Invalid link" }, 400);
        const prof = await fetchProfileForDisplay(env, stored.id);
        const msisdn = prof.phone;
        const code = String(Math.floor(100000 + Math.random()*900000));
        await env.LINK_KV.put(kvKey.otp(linkid), code, { expirationTtl: 60*10 });
        let sent = { ok:false, note:"no msisdn" };
        if (msisdn) sent = await sendWhatsAppOTP(env, msisdn, code);
        return json({ ok:true, sent, msisdn: msisdn || null });
      } catch (e) { return json({ ok:false, error:String(e) }, 500); }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      try {
        const { linkid, code } = await request.json();
        const otp = await env.LINK_KV.get(kvKey.otp(linkid));
        const staff = await env.LINK_KV.get(kvKey.staff(linkid));
        if (otp && code && code.trim()===otp) return json({ ok:true, kind:"otp" });
        if (staff && code && code.trim()===staff) return json({ ok:true, kind:"staff" });
        return json({ ok:false });
      } catch (e) { return json({ ok:false, error:String(e) }, 500); }
    }

    // ----- Profile (after OTP) -----
    if (path === "/api/profile" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const stored = await env.LINK_KV.get(kvKey.link(linkid), { type:"json" });
      if (!stored?.id) return json({});
      const prof = await fetchProfileForDisplay(env, stored.id);
      return json(prof || {});
    }

    // ----- Upload documents -> Splynx (lead docs) -----
    if (path === "/api/upload" && method === "POST") {
      const form = await request.formData();
      const linkid = form.get("linkid");
      const stored = await env.LINK_KV.get(kvKey.link(linkid), { type:"json" });
      const id = stored?.id;
      if (!id) return json({ ok:false, error:"Invalid link" }, 400);
      let okAny=false;
      async function sendOne(field){
        const f=form.get(field); if(!f || typeof f==="string") return;
        if (f.size > 5*1024*1024) throw new Error(`${field} too large`);
        const fd = new FormData(); fd.append("file", f, f.name);
        await splynxPOSTForm(env, `/crm/lead-documents/upload-file?lead_id=${encodeURIComponent(id)}`, fd);
        okAny=true;
      }
      try { await sendOne("id"); await sendOne("poa"); return json({ ok:true, uploaded: okAny }); }
      catch(e){ return json({ ok:false, error:String(e) }, 500); }
    }

    // ----- Terms -----
    if (path === "/api/terms" && method === "GET") return termsHandler(env, url);

    // ----- PDF: MSA (generated) -----
    if (path === "/api/pdf/msa" && method === "POST") {
      try {
        const body = await request.json();
        const resp = await buildPDF("msa", {
          ...body,
          terms_service: await fetchText(env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt")
        }, request);
        await markStatus(env, body.customer_id || "unknown", body.linkid || "", "pending");
        return resp;
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }

    // ----- PDF: Debit (generated) -----
    if (path === "/api/pdf/debit" && method === "POST") {
      try {
        const body = await request.json();
        if (!body.agree) return new Response("Agreement checkbox not ticked", { status: 400 });
        const resp = await buildPDF("debit", {
          ...body,
          terms_debit: await fetchText(env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt")
        }, request);
        await markStatus(env, body.customer_id || "unknown", body.linkid || "", "pending");
        return resp;
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }

    // ----- Onboarding landing -----
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = decodeURIComponent(path.split("/").pop() || "");
      const valid = await env.LINK_KV.get(kvKey.link(linkid), { type:"json" });
      if (!valid?.id) return new Response("Invalid or expired link.", { status: 404 });
      return new Response(renderOnboardPage(linkid), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  }
};
