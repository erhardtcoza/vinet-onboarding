// src/index.js
// Vinet Onboarding Worker — single-file deploy
// Requires wrangler.toml bindings you already provided (DB, ONBOARD_KV, R2_UPLOADS, vars)
//
// npm dep: pdf-lib (Wrangler bundles it)
//   npm i pdf-lib

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Brand / assets ----------
const BRAND = {
  site: "www.vinet.co.za",
  phone: "021 007 0200",
  redHex: "#ed1c24",
  blackHex: "#030303",
};
const LOGO_HIGHRES = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const LOGO_LOWRES  = "https://static.vinet.co.za/Vinet%20Logo%20jpg_Full%20Logo.jpg";
const LOGO_URL     = LOGO_LOWRES; // for HTML

// ---------- Helpers ----------
const esc = (s="") => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const now = () => Date.now();
const rand = (n=6) => { const cs="abcdefghjkmnpqrstuvwxyz23456789"; let o=""; for(let i=0;i<n;i++) o+=cs[Math.floor(Math.random()*cs.length)]; return o; };
const ddmmyyyy = (iso) => { try{ const d=new Date(iso||Date.now()); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yy=d.getFullYear(); return `${dd}/${mm}/${yy}` }catch{ return "" } };
async function fetchText(url){ try{ const r=await fetch(url,{cf:{cacheEverything:true,cacheTtl:300}}); return r.ok?await r.text():""; }catch{ return ""; } }
async function fetchArrayBuffer(url){ const r=await fetch(url); if(!r.ok) throw new Error(`fetch ${url} ${r.status}`); return r.arrayBuffer(); }

// Original simple admin IP gate: 160.226.128.0–160.226.143.255
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPOSTForm(env, endpoint, form) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { method:"POST", headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }, body: form });
  if (!r.ok) throw new Error(`Splynx POST ${endpoint} ${r.status}`);
  return r.json().catch(()=>({}));
}
function pickPhone(obj) {
  if (!obj) return null;
  const normalize = s => String(s||"").trim().replace(/^\+/, ""); // "+27" -> "27"
  const ok = s => /^27\d{8,13}$/.test(normalize(s));
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return normalize(v);
  if (Array.isArray(obj)) { for (const it of obj){ const m=pickPhone(it); if(m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)){ const m=pickPhone(obj[k]); if(m) return m; } }
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
  let cust=null, lead=null, contacts=null, info=null;
  try{ cust=await splynxGET(env, `/admin/customers/customer/${id}`);}catch{}
  if(!cust){ try{ lead=await splynxGET(env, `/crm/leads/${id}`);}catch{} }
  try{ contacts=await splynxGET(env, `/admin/customers/${id}/contacts`);}catch{}
  try{ info=await splynxGET(env, `/admin/customers/customer-info/${id}`);}catch{}
  const src=cust||lead||{};
  const phone=pickPhone({...src,contacts});
  const street=src.street??src.address??src.address_1??src.street_1??(src.addresses&&(src.addresses.street||src.addresses.address_1))??"";
  const city=src.city??(src.addresses&&src.addresses.city)??"";
  const zip=src.zip_code??src.zip??(src.addresses&&(src.addresses.zip||src.addresses.zip_code))??"";
  const passport=(info&&(info.passport||info.id_number||info.identity_number))||src.passport||src.id_number||pickFrom(src,['passport','id_number','idnumber','national_id','identity_number'])||"";
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

// ---------- Simple keys ----------
const kv = {
  onboard: id => `onboard/${id}`,           // session blob (progress, flags)
  otp: id => `otp/${id}`,                   // whatsapp otp
  staff: id => `staffotp/${id}`,            // staff code
};

// ---------- Admin UI (restore original look) ----------
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px}
h1,h2{color:#e2001a}
.tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
.tab{padding:.55em 1em;border-radius:.7em;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
.tab.active{background:#e2001a;color:#fff}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0}
input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
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
    const tabs=[...document.querySelectorAll('.tab')], content=document.getElementById('content');
    tabs.forEach(t=>t.onclick=()=>{ tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); load(t.dataset.tab); });
    load('gen');
    const node=html=>{const d=document.createElement('div'); d.innerHTML=html; return d;};

    async function load(which){
      if(which==='gen'){
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
      if(which==='staff'){
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Onboarding Link ID (e.g. 319_ab12cd)</label><div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
          if(!linkid){out.textContent='Enter linkid';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> (valid 15 min)':(d.error||'Failed');
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if(['inprog','pending','approved'].includes(which)){
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

// ---------- EFT Info Page ----------
async function renderEFTPage(id, env) {
  // env.EFT_REFERENCE === "SPLYNX-ID" -> show the id passed in query (?id=319)
  const reference = (env.EFT_REFERENCE === "SPLYNX-ID" && id) ? id : (env.EFT_REFERENCE || id || "");
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
    <div><label>Bank</label><input readonly value="${esc(env.EFT_BANK_NAME || 'First National Bank (FNB/RMB)')}"></div>
    <div><label>Account Name</label><input readonly value="${esc(env.EFT_ACCOUNT_NAME || 'Vinet Internet Solutions')}"></div>
    <div><label>Account Number</label><input readonly value="${esc(env.EFT_ACCOUNT_NO || '62757054996')}"></div>
    <div><label>Branch Code</label><input readonly value="${esc(env.EFT_BRANCH_CODE || '250655')}"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${esc(reference)}"></div>
  </div>
  <p class="note" style="margin-top:16px">${esc(env.EFT_NOTES || 'Please remember that all accounts are payable on or before the 1st of every month.')}</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// ---------- Onboarding UI ----------
function renderOnboardUI(linkid) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Vinet Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>:root{--red:#ed1c24;--bd:#eee}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#fff}
header{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0 6px;border-bottom:1px solid #eee}
header img{height:64px;margin:6px 0}header h1{font-size:18px;margin:6px 0 0}
.wrap{max-width:880px;margin:0 auto;padding:12px 16px 32px}
.card{border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-top:16px}
.row{display:grid;grid-template-columns:160px 1fr;gap:10px 16px;margin:8px 0}
@media (max-width:720px){ .row{grid-template-columns:1fr} }
label,input,select,button,textarea{font:inherit}input,select,textarea{border:1px solid #ddd;border-radius:10px;padding:10px;width:100%}
button{padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer}button.primary{border-color:var(--red);background:var(--red);color:#fff}
.hint{color:#666;font-size:13px}.step{display:none}.step.active{display:block}canvas{border:1px dashed #ccc;border-radius:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.flex{display:flex;gap:10px;align-items:center}
@media (max-width:720px){ .grid2{grid-template-columns:1fr} }
.termsbox{border:1px solid #eee;border-radius:10px;padding:10px;max-height:240px;overflow:auto;background:#fafafa}
.sectionTitle{font-weight:700;margin:12px 0 6px}
.tabbtn{border:1px solid var(--red);color:var(--red);background:#fff;border-radius:999px;padding:8px 14px}
.tabbtn.active{background:var(--red);color:#fff}
ul.links{margin:8px 0 0 18px}
</style></head><body>
<header><img src="${LOGO_URL}" alt="Vinet"/><h1>Client Onboarding</h1></header>
<div class="wrap">
  <div class="card"><div class="hint">Link ID: <code id="linkid">${esc(linkid)}</code></div><div id="status" class="hint" style="margin-top:6px"></div></div>

  <div class="card step active" id="s1">
    <h2>Step 1: Verify</h2>
    <p>Enter the 6‑digit WhatsApp code <b>or</b> a staff verification code.</p>
    <div class="flex"><input id="otp" placeholder="Enter code"/><button id="btnSend" class="tabbtn">Resend</button><button id="btnVerify" class="primary">Verify</button></div>
    <div id="otpMsg" class="hint"></div>
    <div class="hint" style="margin-top:6px">If you didn’t receive a WhatsApp code, please <b>ask Vinet to generate a staff code</b>.</div>
  </div>

  <div class="card step" id="s2">
    <h2>Step 2: Your details</h2>
    <div class="row"><div>Full name</div><div><input id="full_name" required/></div></div>
    <div class="row"><div>ID/Passport</div><div><input id="id_number" required/></div></div>
    <div class="row"><div>Customer ID</div><div><input id="customer_id" required/></div></div>
    <div class="row"><div>Email</div><div><input id="email" required/></div></div>
    <div class="row"><div>Phone</div><div><input id="phone" required/></div></div>
    <div class="row"><div>Street</div><div><input id="street" required/></div></div>
    <div class="row"><div>City</div><div><input id="city" required/></div></div>
    <div class="row"><div>ZIP</div><div><input id="zip" required/></div></div>
    <div style="margin-top:10px"><button id="to3" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s3">
    <h2>Step 3: Payment method</h2>
    <div class="flex" style="gap:8px">
      <button id="optEft" class="tabbtn active">EFT</button>
      <button id="optDebit" class="tabbtn">Debit order</button>
    </div>
    <div id="payBody" style="margin-top:12px"></div>
    <div style="margin-top:10px"><button id="to4" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s4">
    <h2>Step 4: Upload documents</h2>
    <div><label>ID Document (max 5MB)</label><input type="file" id="file_id"/></div>
    <div style="margin-top:10px"><label>Proof of Address (max 5MB)</label><input type="file" id="file_poa"/></div>
    <div class="hint" style="margin-top:6px">If you forget this page, contact us and we’ll resend your onboarding link.</div>
    <div class="flex" style="margin-top:12px"><button class="tabbtn" id="skipUploads">I’ll upload later</button><button id="to5" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s5">
    <h2>Step 5: Service Agreement</h2>
    <div class="grid2">
      <div><div>MSA Signature</div><canvas id="sig_msa" width="500" height="180"></canvas><div><button id="clear_msa">Clear</button></div></div>
      <div><div class="sectionTitle">Terms</div><div id="msa_terms" class="termsbox">Loading terms…</div><div class="flex" style="margin-top:6px"><input id="agree_msa" type="checkbox"/><label for="agree_msa"> I agree to the Master Service Agreement.</label></div></div>
    </div>
    <div style="margin-top:10px"><button id="gen" class="primary">Generate PDFs</button></div>
    <div id="pdfLinks" class="hint" style="margin-top:10px"></div>
  </div>

  <div class="card step" id="s6">
    <h2>All set!</h2>
    <p>Your agreements have been recorded. You can download them here:</p>
    <ul class="links" id="finalLinks"></ul>
  </div>
</div>

<script>
const linkid = ${JSON.stringify(linkid)};
const $ = s => document.querySelector(s);
const S = n => { document.querySelector('.step.active')?.classList.remove('active'); document.getElementById('s'+n).classList.add('active'); };
function Sig(el){ const c=el,ctx=c.getContext('2d'); let down=false,last=null;
  c.addEventListener('pointerdown',e=>{down=true;last=[e.offsetX,e.offsetY]});
  c.addEventListener('pointerup',()=>{down=false;last=null});
  c.addEventListener('pointerleave',()=>{down=false;last=null});
  c.addEventListener('pointermove',e=>{ if(!down) return; ctx.lineWidth=2; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(last[0],last[1]); ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); last=[e.offsetX,e.offsetY]; });
  return { clear:()=>ctx.clearRect(0,0,c.width,c.height), data:()=>c.toDataURL('image/png'), isEmpty:()=>{ const a=ctx.getImageData(0,0,c.width,c.height).data; for(let i=3;i<a.length;i+=4){ if(a[i]) return false; } return true; } };
}
const sigMSA = Sig(document.getElementById('sig_msa'));
document.getElementById('clear_msa').onclick=()=>sigMSA.clear();

let payChoice='eft'; let sigDebit=null;

function setIf(sel, v){ const el=document.querySelector(sel); if(el && v!=null) el.value= v; }

function renderEFT(){
  const custId = ($('#customer_id').value||'').trim();
  const refTpl = ${JSON.stringify("SPLYNX-ID")};
  const ref = (refTpl==='SPLYNX-ID' && custId) ? custId : (refTpl||custId||'');
  $('#payBody').innerHTML = \`
    <div class="row"><div>Bank</div><div>${esc("${BRAND.site}") && ''}</div></div>\`;
  // Fill from server /info/eft instead (better UX):
  $('#payBody').innerHTML = \`
    <div class="row"><div>Banking details</div><div><a href="/info/eft?id=\${encodeURIComponent(custId)}" target="_blank">Open EFT page</a></div></div>
    <div class="row"><div>Reference</div><div>\${esc(ref)}</div></div>
    <div class="hint">Print or save the EFT page for your records.</div>
  \`;
}
function renderDebit(){
  $('#payBody').innerHTML = \`
    <div class="row"><div>Account Holder</div><div><input id="account_holder" required/></div></div>
    <div class="row"><div>Holder ID/Passport</div><div><input id="holder_id" required/></div></div>
    <div class="row"><div>Bank</div><div><input id="bank" required/></div></div>
    <div class="row"><div>Account No</div><div><input id="account_no" required/></div></div>
    <div class="row"><div>Account Type</div><div><input id="account_type" required/></div></div>
    <div class="row"><div>Debit Day</div><div><input id="debit_day" placeholder="1-31" required/></div></div>
    <div class="sectionTitle">Debit Order Terms</div>
    <div id="debit_terms" class="termsbox">Loading terms…</div>
    <div class="grid2" style="margin-top:8px">
      <div><div>Signature</div><canvas id="sig_debit" width="500" height="180"></canvas><div><button id="clear_debit">Clear</button></div></div>
      <div class="flex" style="align-items:flex-start;margin-top:8px"><input id="agree_debit" type="checkbox"/><label for="agree_debit"> I agree to the debit order terms.</label></div>
    </div>
  \`;
  sigDebit = Sig(document.getElementById('sig_debit'));
  document.getElementById('clear_debit').onclick=()=>sigDebit.clear();
  fetch('/api/terms?kind=debit').then(r=>r.text()).then(t=>$('#debit_terms').innerHTML=t).catch(()=>$('#debit_terms').textContent='Terms unavailable.');
}
$('#optEft').onclick=()=>{ payChoice='eft'; $('#optEft').classList.add('active'); $('#optDebit').classList.remove('active'); renderEFT(); };
$('#optDebit').onclick=()=>{ payChoice='debit'; $('#optDebit').classList.add('active'); $('#optEft').classList.remove('active'); renderDebit(); };

// OTP send (template only; show staff-code message on failure)
$('#btnSend').onclick = async () => {
  $('#otpMsg').textContent='Sending WhatsApp code…';
  const r = await fetch('/api/otp/send', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid }) });
  const j = await r.json().catch(()=>({}));
  if (j.ok && j.sent) $('#otpMsg').textContent = 'Code sent via WhatsApp.';
  else $('#otpMsg').innerHTML = 'Couldn’t send via WhatsApp. Please <b>ask Vinet for a staff code</b> and enter it above.';
};

// Verify (accepts {otp} or {code})
$('#btnVerify').onclick = async () => {
  const value = ($('#otp').value||'').trim();
  if (!value) { $('#otpMsg').textContent='Enter code'; return; }
  const res = await fetch('/api/otp/verify', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ linkid, otp: value })
  });
  const j = await res.json().catch(()=>({}));
  if (j.ok) {
    $('#otpMsg').textContent='Verified.';
    try {
      const p = await (await fetch('/api/profile?linkid='+encodeURIComponent(linkid))).json();
      setIf('#full_name', p.full_name);
      setIf('#id_number', p.passport);
      setIf('#customer_id', p.id);
      setIf('#email', p.email);
      setIf('#phone', p.phone);
      setIf('#street', p.street);
      setIf('#city', p.city);
      setIf('#zip', p.zip);
      $('#status').textContent='Verified at '+new Date().toLocaleString();
    } catch {}
    renderEFT();
    S(2);
  } else {
    $('#otpMsg').textContent= j.error || 'Invalid code';
  }
};

// Step navigation
$('#to3').onclick = () => { S(3); renderEFT(); };
$('#to4').onclick = async () => {
  if (payChoice==='debit') {
    const need=['account_holder','holder_id','bank','account_no','account_type','debit_day'];
    for (const id of need) { const v=document.getElementById(id).value.trim(); if(!v){ alert('Please complete all debit order fields.'); return; } }
    if (!document.getElementById('agree_debit').checked) { alert('Please agree to the debit order terms.'); return; }
    if (sigDebit.isEmpty()) { alert('Please sign the debit order.'); return; }
  }
  S(4);
};

// Uploads
$('#skipUploads').onclick = async () => {
  await fetch('/api/flag-uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, pending:true})});
  S(5);
};
$('#to5').onclick = async () => {
  const idf = document.getElementById('file_id').files[0]; const poa = document.getElementById('file_poa').files[0];
  const fd = new FormData(); if(idf) fd.append('id', idf); if(poa) fd.append('poa', poa); fd.append('linkid', linkid);
  const r = await fetch('/api/upload', { method:'POST', body: fd }); if(!r.ok) console.log('Upload failed (optional).');
  await fetch('/api/flag-uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, pending:false})});
  const msa = await fetch('/api/terms?kind=service').then(r=>r.text()).catch(()=>'');
  document.getElementById('msa_terms').innerHTML = msa || 'Terms unavailable.';
  S(5);
};

// Generate PDFs
$('#gen').onclick = async () => {
  if (!document.getElementById('agree_msa').checked) { alert('Please agree to the MSA terms.'); return; }
  if (sigMSA.isEmpty()) { alert('Please sign the MSA.'); return; }

  const ua = navigator.userAgent || '';
  const common = {
    full_name: ($('#full_name').value||'').trim(),
    id_number: ($('#id_number').value||'').trim(),
    customer_id: ($('#customer_id').value||'').trim(),
    email: ($('#email').value||'').trim(),
    phone: ($('#phone').value||'').trim(),
    street: ($('#street').value||'').trim(),
    city: ($('#city').value||'').trim(),
    zip: ($('#zip').value||'').trim(),
    date: new Date().toISOString(), linkid, user_agent: ua
  };
  let msaLink='', doLink='';

  // MSA
  const msa = await fetch('/api/pdf/msa', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...common, signature: sigMSA.data(), agree: true }) });
  if (msa.ok) { msaLink = '/api/doc?linkid='+encodeURIComponent(linkid)+'&type=msa'; }

  // Debit (only if debit tab active)
  if (document.getElementById('optDebit').classList.contains('active')) {
    const body = {
      ...common,
      account_holder: ($('#account_holder')?.value||'').trim(),
      holder_id: ($('#holder_id')?.value||'').trim(),
      bank: ($('#bank')?.value||'').trim(),
      account_no: ($('#account_no')?.value||'').trim(),
      account_type: ($('#account_type')?.value||'').trim(),
      debit_day: ($('#debit_day')?.value||'').trim(),
      signature: sigDebit?.data(),
      agree: true
    };
    const deb = await fetch('/api/pdf/debit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    if (deb.ok) { doLink = '/api/doc?linkid='+encodeURIComponent(linkid)+'&type=debit'; }
  }

  const links = [];
  if (msaLink) links.push('<a href="'+msaLink+'" target="_blank">Master Service Agreement (PDF)</a>');
  if (doLink)  links.push('<a href="'+doLink+'" target="_blank">Debit Order Agreement (PDF)</a>');
  document.getElementById('pdfLinks').innerHTML = links.join('<br/>');
  document.getElementById('finalLinks').innerHTML = document.getElementById('pdfLinks').innerHTML;
  S(6);
};
</script>
</body></html>`;
}

// ---------- Terms for boxes ----------
async function termsHTML(env, kind) {
  const txt = await fetchText(kind==="debit" ? env.TERMS_DEBIT_URL : env.TERMS_SERVICE_URL);
  return `<pre style="white-space:pre-wrap;margin:0;font-size:${kind==='debit'?'13px':'12px'}">${esc(txt)}</pre>`;
}

// ---------- PDFs ----------
const A4 = { w: 595.28, h: 841.89 };
async function embedLogo(doc){ try{ const bytes=await fetchArrayBuffer(LOGO_HIGHRES); return await doc.embedPng(bytes).catch(async()=>await doc.embedJpg(bytes)); }catch{ return null; } }
function dashedLine(page,x,y,w,thickness=0.7){ const dash=6,gap=4; let cur=x; while(cur<x+w){ const seg=Math.min(dash,x+w-cur); page.drawLine({ start:{x:cur,y}, end:{x:cur+seg,y}, thickness, color: rgb(0.7,0.7,0.7) }); cur+=dash+gap; } }
function drawHeader(page, fonts, logoImg, title, redRGB){
  const { helv, helvBold } = fonts;
  page.drawText(title, { x: 40, y: A4.h-60, size: 16, font: helvBold, color: redRGB });
  if (logoImg) {
    const scale = 0.27; // ~50% bigger than typical small header logo
    const w = logoImg.width*scale, h = logoImg.height*scale;
    page.drawImage(logoImg, { x: A4.w-40-w, y: A4.h-40-h, width:w, height:h });
    page.drawText(`${BRAND.site} • ${BRAND.phone}`, { x: A4.w-40-w, y: A4.h-46-h-10, size: 10, font: helv, color: rgb(0.2,0.2,0.2) });
  } else {
    page.drawText(`${BRAND.site} • ${BRAND.phone}`, { x: A4.w-200, y: A4.h-60, size: 10, font: helv, color: rgb(0.2,0.2,0.2) });
  }
  dashedLine(page, 40, A4.h-70, A4.w-80, 0.7);
}
function drawKV(page, fonts, x, y, kv, opts={colW:140, lineH:16, size:11}){
  const { helv, helvBold } = fonts; let yy=y;
  for (const [k,v] of kv) {
    page.drawText(String(k), { x, y:yy, size:opts.size, font:helvBold, color:rgb(0,0,0) });
    page.drawText(String(v||""), { x:x+opts.colW, y:yy, size:opts.size, font:helv, color:rgb(0,0,0) });
    yy -= opts.lineH;
  }
  return yy;
}
function drawTwoCols(page, fonts, xL, xR, y, leftItems, rightItems, opts={lineH:16, size:11, leftColW:120, rightColW:120}){
  const { helv,helvBold } = fonts; let yl=y, yr=y;
  for (const [k,v] of leftItems) { page.drawText(String(k),{x:xL,y:yl,size:opts.size,font:helvBold}); page.drawText(String(v||""),{x:xL+opts.leftColW,y:yl,size:opts.size,font:helv}); yl -= opts.lineH; }
  for (const [k,v] of rightItems){ page.drawText(String(k),{x:xR,y:yr,size:opts.size,font:helvBold}); page.drawText(String(v||""),{x:xR+opts.rightColW,y:yr,size:opts.size,font:helv}); yr -= opts.lineH; }
  return Math.min(yl, yr);
}
function flowTwoColumnText(doc, fonts, logo, title, rawText, size){
  const words = String(rawText||"").split(/\s+/);
  const colGap = 20, marginX = 40, marginTop = 100, marginBottom = 120;
  const colWidth = (A4.w - (marginX*2) - colGap) / 2;
  const lineH = size + 3;
  let page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title, rgb(0.929,0.109,0.141));
  let x = marginX, y = A4.h - marginTop, col = 0;
  const { helv } = fonts;
  let line = "";
  function newPage(){ page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title, rgb(0.929,0.109,0.141)); x=marginX; y=A4.h-marginTop; col=0; line=""; }
  function newColumn(){ col=1; x=marginX+colWidth+colGap; y=A4.h-marginTop; line=""; }
  for(const w of words){
    const test=(line?line+" ":"")+w;
    const width=helv.widthOfTextAtSize(test, size);
    if(width>colWidth){
      page.drawText(line, { x, y, size, font: helv, color: rgb(0,0,0) });
      y -= lineH; line = w;
      if (y < marginBottom) { if (col===0) newColumn(); else newPage(); }
    } else { line = test; }
  }
  if (line) { page.drawText(line, { x, y, size, font: helv, color: rgb(0,0,0) }); y -= lineH; }
  return { page, y };
}
async function buildPDF(docType, data, env, request){
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { helv, helvBold };
  const logo = await embedLogo(doc);
  const redRGB = rgb(0.929,0.109,0.141);
  const title = docType==="debit" ? "Vinet Debit Order Instruction" : "Vinet Internet Solutions Service Agreement";

  // First page
  let page = doc.addPage([A4.w, A4.h]);
  drawHeader(page, fonts, logo, title, redRGB);
  let y = A4.h-100;

  if (docType==="debit"){
    // Left client, right debit details
    const left = [
      ["Client code:", data.customer_id],
      ["Full Name:", data.full_name],
      ["ID / Passport:", data.id_number],
      ["Email:", data.email],
      ["Phone:", data.phone],
      ["Street:", data.street],
      ["City:", data.city],
      ["ZIP:", data.zip],
    ];
    page.drawText("Debit Order Details", { x:A4.w/2+20, y, size:13, font:helvBold, color:rgb(0,0,0) }); y -= 18;
    const right = [
      ["Account Holder Name:", data.account_holder || "—"],
      ["Account Holder ID :", data.holder_id || "—"],
      ["Bank:", data.bank || "—"],
      ["Bank Account No:", data.account_no || "—"],
      ["Account Type:", data.account_type || "—"],
      ["Debit Order Date:", data.debit_day || "1"],
    ];
    const yL = drawKV(page, fonts, 40, A4.h-118, left, { colW:120, lineH:16, size:11 });
    const yR = drawKV(page, fonts, A4.w/2+20, y, right, { colW:150, lineH:16, size:11 });
    y = Math.min(yL, yR) - 10;
    dashedLine(page, 40, y, A4.w-80, 0.7); y -= 14;

    // Terms single column 8pt (still use the 2-col flow to paginate nicely, but it's fine)
    const flowed = flowTwoColumnText(doc, fonts, logo, title, data.terms_debit||"", 8);
    page = flowed.page; y = flowed.y;

  } else {
    // MSA: info left/right
    const left = [
      ["Client code:", data.customer_id],
      ["Full Name:", data.full_name],
      ["ID / Passport:", data.id_number],
      ["Email:", data.email],
    ];
    const right = [
      ["Phone:", data.phone],
      ["Street:", data.street],
      ["City:", data.city],
      ["ZIP:", data.zip],
    ];
    y = drawTwoCols(page, fonts, 40, A4.w/2+20, y, left, right, { lineH:16, size:11, leftColW:120, rightColW:120 }) - 8;
    dashedLine(page, 40, y, A4.w-80, 0.7); y -= 14;

    // Terms two columns 7pt
    const flowed = flowTwoColumnText(doc, fonts, logo, title, data.terms_service||"", 7);
    page = flowed.page; y = flowed.y;
  }

  // Signature block at bottom of last page
  if (y < 140) { page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title, redRGB); y = A4.h - 140; }
  dashedLine(page, 40, 120, A4.w-80, 0.5);
  const rowY = 110;
  page.drawText("Name", { x: 40, y: rowY, size: 11, font: helvBold });
  page.drawText(String(data.full_name||""), { x: 40, y: rowY-16, size: 11, font: helv });
  page.drawText("Signature", { x: A4.w/2-30, y: rowY, size: 11, font: helvBold });
  if (data.signature) {
    try {
      const png = await doc.embedPng(Uint8Array.from(atob(data.signature.split(",")[1]||""), c=>c.charCodeAt(0)));
      const w = Math.min(220, png.width*0.6), h = (png.height/png.width)*w;
      page.drawImage(png, { x: A4.w/2-60, y: rowY-16-h-2, width:w, height:h });
    } catch {}
  }
  page.drawText("Date (DD/MM/YYYY)", { x: A4.w-190, y: rowY, size: 11, font: helvBold });
  page.drawText(ddmmyyyy(data.date), { x: A4.w-190, y: rowY-16, size: 11, font: helv });

  // Security audit page with header
  const audit = doc.addPage([A4.w, A4.h]);
  drawHeader(audit, fonts, logo, "VINET — Agreement Security Summary", redRGB);
  const kvs = [
    ["Link ID:", data.linkid],
    ["Splynx ID:", data.customer_id],
    ["IP Address:", (data.ip||"")],
    ["User-Agent:", (data.user_agent||"")],
    ["Timestamp:", ddmmyyyy(data.date)],
  ];
  drawKV(audit, fonts, 40, A4.h-110, kvs, { colW:120, lineH:18, size:11 });

  return new Uint8Array(await doc.save());
}

// ---------- R2 public ----------
function r2Public(env, key){
  const base = (env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org").replace(/\/$/,"");
  return base + "/" + key.split("/").map(encodeURIComponent).join("/");
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = (o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
    const getIP = () => request.headers.get("CF-Connecting-IP") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Admin UI
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type":"text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type":"application/javascript; charset=utf-8" } });
    }

    // Admin: generate link
    if (path === "/api/admin/genlink" && method !== "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ ok:false, error:"Missing id" }, 400);
      const token = rand(6);
      const linkid = `${String(id).trim()}_${token}`;
      await env.ONBOARD_KV.put(kv.onboard(linkid), JSON.stringify({ id, created: now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ ok:true, url:`${env.API_URL || url.origin}/onboard/${linkid}`, linkid });
    }

    // Admin: staff code
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(kv.staff(linkid), code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // Admin: list
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items=[];
      for (const k of (list.keys||[])) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // Admin: review page (simple)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      if (!sess) return new Response("Not found", { status: 404 });

      // List public R2 files
      let uploads = [];
      if (env.R2_UPLOADS) {
        const l = await env.R2_UPLOADS.list({ prefix:`uploads/${linkid}/` });
        uploads = (l.objects||[]).map(o=>({ key:o.key, name:o.key.split('/').pop(), size:o.size }));
      }
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><a href="${r2Public(env,u.key)}" target="_blank">${esc(u.name)}</a> • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;

      // MSA/debit links
      let msaKey = `agreements/${linkid}/MSA.pdf`, debitKey = `agreements/${linkid}/Debit.pdf`;
      const msaHead = await env.R2_UPLOADS.head(msaKey).catch(()=>null);
      const debHead = await env.R2_UPLOADS.head(debitKey).catch(()=>null);
      const msaLink = msaHead ? r2Public(env, msaKey) : "";
      const debLink = debHead ? r2Public(env, debitKey) : "";
      const haveID = uploads.some(u=>/id/i.test(u.name));
      const havePOA = uploads.some(u=>/poa|address/i.test(u.name));

      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}.badge{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:2px 8px;background:#fafafa;font-size:12px;margin-left:6px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id||'')}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'n/a')}</b> • Uploads: <span class="badge">ID ${haveID?'✅':'❌'}</span> <span class="badge">POA ${havePOA?'✅':'❌'}</span></div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreements</h2>
  <div class="note">${msaLink?`<a href="${msaLink}" target="_blank">MSA (PDF)</a>`:'MSA not generated'}<br/>${debLink?`<a href="${debLink}" target="_blank">Debit Order (PDF)</a>`:'Debit not generated'}</div>
</div></body></html>`, { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // Info: EFT page
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id, env), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // Public onboarding
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = decodeURIComponent(path.split("/").pop()||"");
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // OTP send (template only)
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid.split("_")[0] || "").trim();
      let msisdn=null;
      try{ msisdn = await fetchCustomerMsisdn(env, splynxId); }catch{}
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(kv.otp(linkid), code, { expirationTtl: 600 });

      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product:"whatsapp",
        to: msisdn, // must be 27xxxxxxxxx
        type:"template",
        template:{
          name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
          language:{ code: env.WHATSAPP_TEMPLATE_LANG || "en_US" },
          components:[{ type:"body", parameters:[{ type:"text", text: code }]}]
        }
      };
      const r = await fetch(endpoint, {
        method:"POST",
        headers:{ "Authorization":`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> "");
        return json({ ok:false, error:"whatsapp_template_failed", details:t.slice(0,2000) });
      }
      return json({ ok:true, sent:true });
    }

    // OTP verify (accept both otp/code, advance to step 2)
    if (path === "/api/otp/verify" && method === "POST") {
      const body = await request.json().catch(()=>({}));
      const linkid = body.linkid || "";
      const code = (body.otp || body.code || "").toString().trim();
      const kind = (body.kind || "").toLowerCase(); // "staff" or ""

      if (!linkid || !code) return json({ ok:false, error:"Missing params" }, 400);
      const expected = await env.ONBOARD_KV.get(kind==="staff" ? kv.staff(linkid) : kv.otp(linkid));
      if (!(expected && expected === code)) return json({ ok:false, error:"Invalid code" }, 200);

      const sess = (await env.ONBOARD_KV.get(kv.onboard(linkid), "json")) || {};
      const next = { ...sess, otp_verified:true, progress: Math.max(sess.progress||0, 1), last_time: now() };
      await env.ONBOARD_KV.put(kv.onboard(linkid), JSON.stringify(next), { expirationTtl: 86400 });
      if (kind==="staff") await env.ONBOARD_KV.delete(kv.staff(linkid));
      return json({ ok:true });
    }

    // Profile (prefill)
    if (path === "/api/profile" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      const id = sess?.id || (linkid.split("_")[0] || "");
      if (!id) return json({});
      const prof = await fetchProfileForDisplay(env, id).catch(()=>null);
      return json(prof||{});
    }

    // Uploads to R2
    if (path === "/api/upload" && method === "POST") {
      const form = await request.formData();
      const linkid = form.get("linkid");
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      if (!sess) return json({ ok:false, error:"Invalid link" }, 400);

      async function putOne(field,label){
        const f = form.get(field);
        if (!f || typeof f === "string") return null;
        if (f.size > 5*1024*1024) throw new Error(`${label} too large`);
        const key = `uploads/${linkid}/${Date.now()}_${f.name}`;
        await env.R2_UPLOADS.put(key, await f.arrayBuffer(), { httpMetadata:{ contentType: f.type || "application/octet-stream" } });
        return { label, key, name:f.name, size:f.size, url: r2Public(env,key) };
      }
      const saved = [];
      try { const a=await putOne("id","ID"); if(a) saved.push(a); } catch(e){ return json({ ok:false, error:String(e) }, 400); }
      try { const b=await putOne("poa","POA"); if(b) saved.push(b); } catch(e){ return json({ ok:false, error:String(e) }, 400); }

      const next = { ...(sess||{}), uploads:[...(sess?.uploads||[]), ...saved], last_time: now() };
      await env.ONBOARD_KV.put(kv.onboard(linkid), JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, saved });
    }

    // Uploads status flag
    if (path === "/api/flag-uploads" && method === "POST") {
      const { linkid, pending } = await request.json().catch(()=>({}));
      const sess = await env.ONBOARD_KV.get(kv.onboard(linkid), "json");
      if (!sess) return json({ ok:false }, 400);
      await env.ONBOARD_KV.put(kv.onboard(linkid), JSON.stringify({ ...sess, uploads_pending: !!pending, last_time: now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Terms for boxes
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind")||"").toLowerCase();
      const html = await termsHTML(env, kind==="debit"?"debit":"service");
      return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // PDFs
    if (path === "/api/pdf/msa" && method === "POST") {
      try{
        const body = await request.json();
        if (!body.agree) return new Response("Please agree to the MSA terms.", { status: 400 });
        if (!body.signature) return new Response("MSA signature required.", { status: 400 });
        const bytes = await buildPDF("msa", { ...body, ip:getIP(), terms_service: await fetchText(env.TERMS_SERVICE_URL) }, env, request);
        await env.R2_UPLOADS.put(`agreements/${body.linkid}/MSA.pdf`, bytes, { httpMetadata:{ contentType:"application/pdf" } });
        const sess = await env.ONBOARD_KV.get(kv.onboard(body.linkid), "json");
        await env.ONBOARD_KV.put(kv.onboard(body.linkid), JSON.stringify({ ...(sess||{}), agreement_signed:true, status:"pending", last_time: now() }), { expirationTtl: 86400 });
        return new Response(bytes, { headers:{ "content-type":"application/pdf" } });
      }catch(e){ return new Response("MSA generation error", { status: 500 }); }
    }
    if (path === "/api/pdf/debit" && method === "POST") {
      try{
        const b = await request.json();
        const reqs = ["account_holder","holder_id","bank","account_no","account_type","debit_day"];
        for (const k of reqs) if (!b[k] || String(b[k]).trim()==="") return new Response(`Missing ${k}`, { status: 400 });
        if (!b.agree) return new Response("Please agree to the debit order terms.", { status: 400 });
        if (!b.signature) return new Response("Debit order signature required.", { status: 400 });
        const bytes = await buildPDF("debit", { ...b, ip:getIP(), terms_debit: await fetchText(env.TERMS_DEBIT_URL) }, env, request);
        await env.R2_UPLOADS.put(`agreements/${b.linkid}/Debit.pdf`, bytes, { httpMetadata:{ contentType:"application/pdf" } });
        const sess = await env.ONBOARD_KV.get(kv.onboard(b.linkid), "json");
        await env.ONBOARD_KV.put(kv.onboard(b.linkid), JSON.stringify({ ...(sess||{}), last_time: now() }), { expirationTtl: 86400 });
        return new Response(bytes, { headers:{ "content-type":"application/pdf" } });
      }catch(e){ return new Response("Debit generation error", { status: 500 }); }
    }

    // Public stream
    if (path === "/api/doc" && method === "GET") {
      const linkid = url.searchParams.get("linkid")||"";
      const type = (url.searchParams.get("type")||"").toLowerCase();
      const key = type==="msa" ? `agreements/${linkid}/MSA.pdf` : type==="debit" ? `agreements/${linkid}/Debit.pdf` : "";
      if (!key) return new Response("Not found", { status:404 });
      const o = await env.R2_UPLOADS.get(key);
      if (!o) return new Response("Not found", { status:404 });
      return new Response(o.body, { headers:{ "content-type":"application/pdf", "content-disposition":`inline; filename="${type.toUpperCase()}.pdf"` } });
    }

    return new Response("Not Found", { status: 404 });
  }
};
