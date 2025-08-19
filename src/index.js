// index.js — Vinet Onboarding Worker (merged & fixed)
// - Admin dashboard & review
// - Onboarding flow with OTP (WhatsApp + staff code)
// - Payment method (EFT or Debit Order) with signature & required checkbox
// - Uploads (ID + Proof of Address) -> R2
// - MSA signing + final screen with downloadable PDF agreements (MSA + Debit)
// - Printable HTML agreement pages (+ terms under each agreement)
// - PDF generation for MSA & Debit (pdf-lib), with terms embedded & signature images
// - Fix: avoid string interpolation inside quoted HTML (build error), inject CFG to client
// - Fix: PDF colors via pdf-lib rgb(); sanitize smart quotes for WinAnsi fonts

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Constants ----------
const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const DEFAULTS = {
  TERMS_SERVICE_URL: "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt",
  TERMS_DEBIT_URL:   "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt",
};
const BRAND = {
  red: rgb(237 / 255, 28 / 255, 36 / 255), // #ed1c24
  black: rgb(3 / 255, 3 / 255, 3 / 255),   // #030303
};
const A4W = 595, A4H = 842, MARGIN = 40;

// ---------- Helpers ----------
function ipAllowed(request) {
  // Restrict admin access to 160.226.128.0/20 (and includes specific .254 also)
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const escapeHtml = (s) => String(s || "").replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
function todayZA() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function toDDMMYYYY(iso) {
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
async function fetchTextCached(url, env, cachePrefix = "terms") {
  const key = `${cachePrefix}:${btoa(url).slice(0, 40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!r.ok) return "";
    const t = await r.text();
    await env.ONBOARD_KV.put(key, t, { expirationTtl: 60*60*24*7 });
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

// ---------- EFT Info Page ----------
async function renderEFTPage(id, env) {
  const bank   = env.EFT_BANK_NAME    || "First National Bank (FNB/RMB)";
  const name   = env.EFT_ACCOUNT_NAME || "Vinet Internet Solutions";
  const acc    = env.EFT_ACCOUNT_NO   || "62757054996";
  const branch = env.EFT_BRANCH_CODE  || "250655";
  const notes  = env.EFT_NOTES || "Please remember that all accounts are payable on or before the 1st of every month.";

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
    <div><label>Bank</label><input readonly value="${escapeHtml(bank)}"></div>
    <div><label>Account Name</label><input readonly value="${escapeHtml(name)}"></div>
    <div><label>Account Number</label><input readonly value="${escapeHtml(acc)}"></div>
    <div><label>Branch Code</label><input readonly value="${escapeHtml(branch)}"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(id||"")}"></div>
  </div>
  <p class="note" style="margin-top:16px">${escapeHtml(notes)}</p>
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
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
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
// ---------- Onboarding HTML renderer (inject CFG to client) ----------
function renderOnboardUI(linkid, CFG) {
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
  // Expose config to client (avoids build-time string interpolation)
  window.__VINET_CFG__ = ${JSON.stringify(CFG)};
</script>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); } // 0..6
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
      const cfg = (window.__VINET_CFG__ && window.__VINET_CFG__.eft) ? window.__VINET_CFG__.eft : {
        bank: 'First National Bank (FNB/RMB)',
        name: 'Vinet Internet Solutions',
        acc: '62757054996',
        branch: '250655',
        notes: 'Please remember that all accounts are payable on or before the 1st of every month.',
        refLbl: 'SPLYNX-ID'
      };
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML =
        '<div class="row">' +
          '<div class="field"><label>Bank</label><input readonly value="'+ cfg.bank +'"/></div>' +
          '<div class="field"><label>Account Name</label><input readonly value="'+ cfg.name +'"/></div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="field"><label>Account Number</label><input readonly value="'+ cfg.acc +'"/></div>' +
          '<div class="field"><label>Branch Code</label><input readonly value="'+ cfg.branch +'"/></div>' +
        '</div>' +
        '<div class="field"><label><b>Reference ('+ cfg.refLbl +')</b></label><input readonly style="font-weight:900" value="'+ id +'"/></div>' +
        '<div class="note">'+ cfg.notes +'</div>' +
        '<div style="display:flex;justify-content:center;margin-top:.6em">' +
          '<a class="btn-outline" href="/info/eft?id='+ id +'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a>' +
        '</div>';
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

// ---------- Terms (for UI display) ----------
async function handleTerms(request, env, url) {
  const kind = (url.searchParams.get("kind") || "").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL || DEFAULTS.TERMS_SERVICE_URL;
  const debUrl = env.TERMS_DEBIT_URL || DEFAULTS.TERMS_DEBIT_URL;
  async function getText(u) { try { const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } }); return r.ok ? await r.text() : ""; } catch { return ""; } }
  const esc = s => s.replace(/[&<>]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[t]));
  const service = esc(await getText(svcUrl) || "");
  const debit = esc(await getText(debUrl) || "");
  let body = "";
  if (kind === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
  else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
  return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- OTP & Staff ----------
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
        { type: "body", parameters: [{ type: "text", text: code }] }
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`WA template send failed ${r.status} ${t}`); }
}
async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"text", text:{ body:bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`WA text send failed ${r.status} ${t}`); }
}
// ---------- API ROUTES (core JSON endpoints) ----------
async function handleOtpSend(env, linkid) {
  const splynxId = (linkid || "").split("_")[0];
  let msisdn = null;
  try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return new Response(JSON.stringify({ ok:false, error:"Splynx lookup failed" }), { status: 502, headers: { "content-type": "application/json" } }); }
  if (!msisdn) return new Response(JSON.stringify({ ok:false, error:"No WhatsApp number on file" }), { status: 404, headers: { "content-type": "application/json" } });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
  await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
  try { await sendWhatsAppTemplate(env, msisdn, code, "en"); return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } }); }
  catch(e){ try { await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`); return new Response(JSON.stringify({ ok:true, note:"sent-as-text" }), { headers: { "content-type":"application/json" } }); }
    catch { return new Response(JSON.stringify({ ok:false, error:"WhatsApp send failed (template+text)" }), { status: 502, headers: { "content-type": "application/json" } }); } }
}
async function handleOtpVerify(env, linkid, otp, kind) {
  const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
  const expected = await env.ONBOARD_KV.get(key);
  const ok = !!expected && expected === otp;
  if (ok) {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified: true }), { expirationTtl: 86400 });
    if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
  }
  return new Response(JSON.stringify({ ok }), { headers: { "content-type": "application/json" } });
}

async function handleDebitSave(request, env, url) {
  const b = await request.json().catch(async () => {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    const o = {}; for (const [k, v] of form.entries()) o[k] = v; return o;
  });
  const required = ["account_holder", "id_number", "bank_name", "account_number", "account_type", "debit_day"];
  for (const k of required) if (!b[k] || String(b[k]).trim() === "") return new Response(JSON.stringify({ ok:false, error:`Missing ${k}` }), { status:400, headers:{ "content-type":"application/json" } });
  const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
  const ts = Date.now();
  const key = `debit/${id}/${ts}`;
  const record = { ...b, splynx_id: id, created: ts };
  await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 90 });
  // persist minimal copy on session
  const linkid = url.searchParams.get("linkid") || "";
  if (linkid) {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit: { ...record } }), { expirationTtl: 86400 });
  }
  return new Response(JSON.stringify({ ok:true, ref:key }), { headers: { "content-type":"application/json" } });
}
async function handleDebitSign(request, env) {
  const { linkid, dataUrl } = await request.json().catch(() => ({}));
  if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return new Response(JSON.stringify({ ok:false, error:"Missing/invalid signature" }), { status:400, headers:{ "content-type":"application/json" } });
  const png = dataUrl.split(",")[1];
  const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
  const sigKey = `debit_agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
  return new Response(JSON.stringify({ ok:true, sigKey }), { headers: { "content-type":"application/json" } });
}
async function handleMSASign(request, env) {
  const { linkid, dataUrl } = await request.json().catch(() => ({}));
  if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return new Response(JSON.stringify({ ok:false, error:"Missing/invalid signature" }), { status:400, headers:{ "content-type":"application/json" } });
  const png = dataUrl.split(",")[1];
  const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response(JSON.stringify({ ok:false, error:"Unknown session" }), { status:404, headers:{ "content-type":"application/json" } });
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
  return new Response(JSON.stringify({ ok:true, sigKey }), { headers: { "content-type":"application/json" } });
}

async function handleUpload(request, env, url) {
  const linkid = url.searchParams.get("linkid");
  const fileName = url.searchParams.get("filename") || "file.bin";
  const label = url.searchParams.get("label") || "";
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Invalid link", { status: 404 });
  const body = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
  await env.R2_UPLOADS.put(key, body);
  const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
  uploads.push({ key, name: fileName, size: body.byteLength, label });
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
  return new Response(JSON.stringify({ ok:true, key }), { headers: { "content-type":"application/json" } });
}

async function handleAdminList(env, mode) {
  const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
  const items = [];
  for (const k of list.keys || []) {
    const s = await env.ONBOARD_KV.get(k.name, "json");
    if (!s) continue;
    const linkid = k.name.split("/")[1];
    const updated = s.last_time || s.created || 0;
    if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
    if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
    if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
  }
  items.sort((a,b)=>b.updated-a.updated);
  return new Response(JSON.stringify({ items }), { headers: { "content-type":"application/json" } });
}

async function renderReview(env, url) {
  const linkid = url.searchParams.get("linkid") || "";
  if (!linkid) return new Response("Missing linkid", { status: 400 });
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const filesHTML = uploads.length
    ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${escapeHtml(u.label||'File')}</b> — ${escapeHtml(u.name||'')} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
    : `<div class="note">No files</div>`;
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id||'')}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${escapeHtml(k)}</b>: ${v?escapeHtml(String(v)):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
// ---------- Agreement signature PNG serving ----------
async function serveSig(env, linkid, type) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status:404 });
  const key = type === "debit" ? sess.debit_sig_key : sess.agreement_sig_key;
  if (!key) return new Response("Not found", { status:404 });
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status:404 });
  return new Response(obj.body, { headers: { "content-type": "image/png" } });
}

// ---------- Agreement HTML pages (with terms underneath) ----------
async function renderAgreementHtml(env, type, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status:404 });

  const e = sess.edits || {};
  const today = todayZA();
  const name  = escapeHtml(e.full_name||'');
  const email = escapeHtml(e.email||'');
  const phone = escapeHtml(e.phone||'');
  const street= escapeHtml(e.street||'');
  const city  = escapeHtml(e.city||'');
  const zip   = escapeHtml(e.zip||'');
  const passport = escapeHtml(e.passport||'');
  const debit = sess.debit || null;

  const msaTerms = await fetchTextCached(env.TERMS_SERVICE_URL || DEFAULTS.TERMS_SERVICE_URL, env, "terms:msa");
  const debitTerms = await fetchTextCached(env.TERMS_DEBIT_URL || DEFAULTS.TERMS_DEBIT_URL, env, "terms:debit");

  function page(title, body){ return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
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
  </div></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});}

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
    return page("Debit Order Agreement", body);
  }

  return new Response("Unknown agreement type", { status: 404 });
}

// ---------- PDF helpers ----------
function sanitizeAnsi(input = "") {
  if (!input) return "";
  return String(input)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033\u201F\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2212/g, "-")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}
function wrapToLines(text, font, size, maxWidth) {
  const t = sanitizeAnsi(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of t) {
    const tryLine = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = tryLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function drawDashedLine(page, x1, y, x2, dash = 6, gap = 4, color = BRAND.black, thickness = 1) {
  page.setLineWidth(thickness);
  page.setDash(dash, { phase: 0, dashArray: [dash, gap] });
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color });
  page.setDash(0);
}
async function drawHeader(env, pdf, page, opts) {
  const { title = "Document", tel = "021 007 0200", web = "www.vinet.co.za" } = opts || {};
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const LOGO = env.LOGO_URL || LOGO_URL;
  let y = A4H - 40;

  try {
    const resp = await fetch(LOGO);
    if (resp.ok) {
      const bytes = await resp.arrayBuffer();
      let img, w, h;
      if (resp.headers.get("content-type")?.includes("png") || /\.png(?:\?|$)/i.test(LOGO)) {
        img = await pdf.embedPng(bytes);
      } else {
        img = await pdf.embedJpg(bytes);
      }
      w = 180;
      const scale = img.scale(1);
      h = (scale.height / scale.width) * w;
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 6;
    }
  } catch {
    page.drawText("VINET", { x: MARGIN, y: y - 20, size: 24, font: bold, color: BRAND.black });
    y -= 28;
  }
  // website + tel
  page.drawText(sanitizeAnsi(web), { x: MARGIN, y, size: 10, font, color: BRAND.black });
  page.drawText(sanitizeAnsi(tel), { x: MARGIN + 180, y, size: 10, font, color: BRAND.black });

  const titleY = y - 18;
  page.drawText(sanitizeAnsi(title), { x: MARGIN, y: titleY, size: 18, font: bold, color: BRAND.red });

  drawDashedLine(page, MARGIN, titleY - 10, A4W - MARGIN, 5, 3, BRAND.black, 1);
  return titleY - 24;
}
async function drawMultiColumnText(env, pdf, text, opts = {}) {
  const { startPage, startY, font, fontSize = 7, lineGap = 9, columns = 2, margin = MARGIN } = opts;
  let page = startPage;
  const bottomY = 70;
  const colGap = 24;
  const totalWidth = A4W - margin * 2;
  const colWidth = Math.floor((totalWidth - (columns - 1) * colGap) / columns);
  let x = margin, y = startY;
  const lines = wrapToLines(text, font, fontSize, colWidth);

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (y < bottomY) {
      if (x + colWidth + colGap <= A4W - margin - 1) {
        x += colWidth + colGap;
        y = startY;
      } else {
        page = pdf.addPage([A4W, A4H]);
        page.drawText("Vinet Internet Solutions", { x: margin, y: A4H - 28, size: 10, font, color: BRAND.black });
        drawDashedLine(page, margin, A4H - 36, A4W - margin, 4, 3, BRAND.black, 1);
        x = margin;
        y = A4H - 54;
      }
    }
    page.drawText(L, { x, y, size: fontSize, font, color: BRAND.black });
    y -= lineGap;
  }
  return { page, x, y };
}

// ---------- PDF: Debit Order ----------
async function renderDebitPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) return new Response("Debit Order not available for this link.", { status: 409 });

  const e = sess.edits || {};
  const d = sess.debit || {};
  const terms = (await fetchTextCached(env.TERMS_DEBIT_URL || DEFAULTS.TERMS_DEBIT_URL, env, "terms:debit")) || "Terms unavailable.";

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4W, A4H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = await drawHeader(env, pdf, page, { title: "Vinet Debit Order Instruction" });

  const colW = (A4W - MARGIN * 2 - 24) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 24;

  function drawRow(label, value, x, y0) {
    const L = sanitizeAnsi(label);
    const V = sanitizeAnsi(value || "");
    page.drawText(L, { x, y: y0, size: 10, font: bold, color: BRAND.black });
    page.drawText(V, { x: x + 135, y: y0, size: 10, font, color: BRAND.black });
    return y0 - 14;
  }

  let yL = y;
  yL = drawRow("Client code:", linkid.split("_")[0], leftX, yL);
  yL = drawRow("Full Name:", e.full_name, leftX, yL);
  yL = drawRow("ID / Passport:", e.passport, leftX, yL);
  yL = drawRow("Email:", e.email, leftX, yL);
  yL = drawRow("Phone:", e.phone, leftX, yL);
  yL = drawRow("Street:", e.street, leftX, yL);
  yL = drawRow("City:", e.city, leftX, yL);
  yL = drawRow("ZIP:", e.zip, leftX, yL);

  let yR = y;
  page.drawText("Debit Order Details", { x: rightX, y: yR, size: 12, font: bold, color: BRAND.black });
  yR -= 16;
  yR = drawRow("Account Holder Name:", d.account_holder, rightX, yR);
  yR = drawRow("Account Holder ID:", d.id_number, rightX, yR);
  yR = drawRow("Bank:", d.bank_name, rightX, yR);
  yR = drawRow("Bank Account No:", d.account_number, rightX, yR);
  yR = drawRow("Account Type:", d.account_type, rightX, yR);
  yR = drawRow("Debit Order Date:", d.debit_day, rightX, yR);

  const barY = Math.min(yL, yR) - 6;
  drawDashedLine(page, MARGIN, barY, A4W - MARGIN, 5, 3, BRAND.black, 1);

  let termsY = barY - 12;
  const lines = wrapToLines(terms, font, 8, A4W - MARGIN * 2);
  for (const L of lines) {
    if (termsY < 110) break;
    page.drawText(L, { x: MARGIN, y: termsY, size: 8, font, color: BRAND.black });
    termsY -= 10;
  }

  const sigTop = 90;
  const third = (A4W - MARGIN * 2) / 3;

  page.drawText("Name:", { x: MARGIN, y: sigTop, size: 10, font: bold, color: BRAND.black });
  page.drawText(sanitizeAnsi(e.full_name || ""), { x: MARGIN + 50, y: sigTop, size: 10, font, color: BRAND.black });
  page.drawLine({ start: { x: MARGIN + 50, y: sigTop - 4 }, end: { x: MARGIN + third - 10, y: sigTop - 4 }, color: BRAND.black });

  page.drawText("Signature:", { x: MARGIN + third + 10, y: sigTop, size: 10, font: bold, color: BRAND.black });
  try {
    const bytes = await fetchR2Bytes(env, sess.debit_sig_key);
    if (bytes) {
      const sigImg = await pdf.embedPng(bytes);
      const sigBoxW = third - 70;
      const sigW = Math.min(sigBoxW, 220);
      const scale = sigImg.scale(1);
      const sigH = (scale.height / scale.width) * sigW;
      page.drawImage(sigImg, { x: MARGIN + third + 80, y: sigTop - 2, width: sigW, height: sigH });
    }
  } catch {}
  page.drawLine({ start: { x: MARGIN + third + 80, y: sigTop - 4 }, end: { x: MARGIN + third * 2 - 10, y: sigTop - 4 }, color: BRAND.black });

  const today = todayZA();
  page.drawText("Date (DD/MM/YYYY):", { x: MARGIN + third * 2 + 10, y: sigTop, size: 10, font: bold, color: BRAND.black });
  const ddmmyyyy = toDDMMYYYY(today);
  page.drawText(ddmmyyyy, { x: MARGIN + third * 2 + 10, y: sigTop - 16, size: 10, font, color: BRAND.black });
  page.drawLine({ start: { x: MARGIN + third * 2 + 10, y: sigTop - 4 }, end: { x: A4W - MARGIN, y: sigTop - 4 }, color: BRAND.black });

  const page2 = pdf.addPage([A4W, A4H]);
  const font2 = font;
  const y2 = await drawHeader(env, pdf, page2, { title: "Security Audit" });
  page2.drawText("— (Intentionally left for audit trail) —", { x: MARGIN, y: y2, size: 10, font: font2, color: BRAND.black });

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}

// ---------- PDF: MSA ----------
async function renderMSAPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const e = sess.edits || {};
  const terms = (await fetchTextCached(env.TERMS_SERVICE_URL || DEFAULTS.TERMS_SERVICE_URL, env, "terms:msa")) || "Terms unavailable.";

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([A4W, A4H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = await drawHeader(env, pdf, page, { title: "Vinet Internet Solutions Service Agreement" });

  const colW = (A4W - MARGIN * 2 - 24) / 2;
  const leftX = MARGIN, rightX = MARGIN + colW + 24;

  function drawRow(label, value, x, y0) {
    const L = sanitizeAnsi(label);
    const V = sanitizeAnsi(value || "");
    page.drawText(L, { x, y: y0, size: 10, font: bold, color: BRAND.black });
    page.drawText(V, { x: x + 135, y: y0, size: 10, font, color: BRAND.black });
    return y0 - 14;
  }

  let yL = y;
  yL = drawRow("Client code:", linkid.split("_")[0], leftX, yL);
  yL = drawRow("Full Name:", e.full_name, leftX, yL);
  yL = drawRow("ID / Passport:", e.passport, leftX, yL);
  yL = drawRow("Email:", e.email, leftX, yL);

  let yR = y;
  yR = drawRow("Phone:", e.phone, rightX, yR);
  yR = drawRow("Street:", e.street, rightX, yR);
  yR = drawRow("City:", e.city, rightX, yR);
  yR = drawRow("ZIP:", e.zip, rightX, yR);

  const afterInfoY = Math.min(yL, yR) - 6;
  drawDashedLine(page, MARGIN, afterInfoY, A4W - MARGIN, 5, 3, BRAND.black, 1);

  const flow = await drawMultiColumnText(env, pdf, terms, {
    startPage: page,
    startY: afterInfoY - 14,
    font,
    fontSize: 7,
    lineGap: 9,
    columns: 2,
    margin: MARGIN,
  });
  page = flow.page;

  const sigBaseY = 80;
  const third = (A4W - MARGIN * 2) / 3;

  page.drawText("Name:", { x: MARGIN, y: sigBaseY, size: 10, font: bold, color: BRAND.black });
  page.drawText(sanitizeAnsi(e.full_name || ""), { x: MARGIN + 50, y: sigBaseY, size: 10, font, color: BRAND.black });
  page.drawLine({ start: { x: MARGIN + 50, y: sigBaseY - 4 }, end: { x: MARGIN + third - 10, y: sigBaseY - 4 }, color: BRAND.black });

  page.drawText("Signature:", { x: MARGIN + third + 10, y: sigBaseY, size: 10, font: bold, color: BRAND.black });
  try {
    const bytes = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (bytes) {
      const sigImg = await pdf.embedPng(bytes);
      const sigBoxW = third - 70;
      const sigW = Math.min(sigBoxW, 220);
      const scale = sigImg.scale(1);
      const sigH = (scale.height / scale.width) * sigW;
      page.drawImage(sigImg, { x: MARGIN + third + 80, y: sigBaseY - 2, width: sigW, height: sigH });
    }
  } catch {}
  page.drawLine({ start: { x: MARGIN + third + 80, y: sigBaseY - 4 }, end: { x: MARGIN + third * 2 - 10, y: sigBaseY - 4 }, color: BRAND.black });

  const today = todayZA();
  page.drawText("Date (DD/MM/YYYY):", { x: MARGIN + third * 2 + 10, y: sigBaseY, size: 10, font: bold, color: BRAND.black });
  const ddmmyyyy = toDDMMYYYY(today);
  page.drawText(ddmmyyyy, { x: MARGIN + third * 2 + 10, y: sigBaseY - 16, size: 10, font, color: BRAND.black });
  page.drawLine({ start: { x: MARGIN + third * 2 + 10, y: sigBaseY - 4 }, end: { x: A4W - MARGIN, y: sigBaseY - 4 }, color: BRAND.black });

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
// ---------- Router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Admin UI (protected by IP)
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // Info page (EFT)
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id, env), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Terms (for UI display)
    if (path === "/api/terms" && method === "GET") {
      return handleTerms(request, env, url);
    }

    // Admin: generate link
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return new Response(JSON.stringify({ error:"Missing id" }), { status:400, headers:{ "content-type":"application/json" }});
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ url: `${url.origin}/onboard/${linkid}` }), { headers:{ "content-type":"application/json" }});
    }

    // Admin: staff OTP
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return new Response(JSON.stringify({ ok:false, error:"Missing linkid" }), { status:400, headers:{ "content-type":"application/json" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response(JSON.stringify({ ok:false, error:"Unknown linkid" }), { status:404, headers:{ "content-type":"application/json" }});
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return new Response(JSON.stringify({ ok:true, linkid, code }), { headers:{ "content-type":"application/json" }});
    }

    // OTP send/verify
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return new Response(JSON.stringify({ ok:false, error:"Missing linkid" }), { status:400, headers:{ "content-type":"application/json" }});
      return handleOtpSend(env, linkid);
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return new Response(JSON.stringify({ ok:false, error:"Missing params" }), { status:400, headers:{ "content-type":"application/json" }});
      return handleOtpVerify(env, linkid, otp, kind);
    }

    // Onboarding UI route (inject CFG values for EFT etc.)
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      const cfg = {
        logoUrl: env.LOGO_URL || LOGO_URL,
        eft: {
          bank:   env.EFT_BANK_NAME    || "First National Bank (FNB/RMB)",
          name:   env.EFT_ACCOUNT_NAME || "Vinet Internet Solutions",
          acc:    env.EFT_ACCOUNT_NO   || "62757054996",
          branch: env.EFT_BRANCH_CODE  || "250655",
          notes:  env.EFT_NOTES || "Please remember that all accounts are payable on or before the 1st of every month.",
          refLbl: env.EFT_REFERENCE || "SPLYNX-ID"
        }
      };
      return new Response(renderOnboardUI(linkid, cfg), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Uploads (R2)
    if (path === "/api/onboard/upload" && method === "POST") {
      return handleUpload(request, env, url);
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
    }

    // Service agreement signature
    if (path === "/api/sign" && method === "POST") {
      return handleMSASign(request, env);
    }

    // Debit save & sign
    if (path === "/api/debit/save" && method === "POST") {
      return handleDebitSave(request, env, url);
    }
    if (path === "/api/debit/sign" && method === "POST") {
      return handleDebitSign(request, env);
    }

    // Admin list/review/approve/reject
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      return handleAdminList(env, mode);
    }
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return renderReview(env, url);
    }
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return new Response(JSON.stringify({ ok:false, error:"Missing linkid" }), { status:400, headers:{ "content-type":"application/json" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response(JSON.stringify({ ok:false, error:"Not found" }), { status:404, headers:{ "content-type":"application/json" }});
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl:86400 });
      return new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" }});
    }
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      // Placeholder (push to Splynx, etc.)
      return new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" }});
    }

    // Agreement images
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      return serveSig(env, linkid, "msa");
    }
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      return serveSig(env, linkid, "debit");
    }

    // Agreement HTML views
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });
      return renderAgreementHtml(env, type, linkid);
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error:"Missing id" }), { status:400, headers:{ "content-type":"application/json" }});
      try { const prof = await fetchProfileForDisplay(env, id); return new Response(JSON.stringify(prof), { headers:{ "content-type":"application/json" }}); }
      catch { return new Response(JSON.stringify({ error:"Lookup failed" }), { status:502, headers:{ "content-type":"application/json" }}); }
    }

    // PDFs
    if (path.startsWith("/pdf/debit/") && method === "GET") {
      const linkid = path.split("/")[3];
      return renderDebitPdf(env, linkid);
    }
    if (path.startsWith("/pdf/msa/") && method === "GET") {
      const linkid = path.split("/")[3];
      return renderMSAPdf(env, linkid);
    }

    return new Response("Not found", { status: 404 });
  }
};
