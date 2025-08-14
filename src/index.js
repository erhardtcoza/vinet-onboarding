// --- Vinet Onboarding Worker (Cloudflare) ---
// Complete onboarding flow: Admin UI, OTP, uploads, PDF generation (no templates), and R2 storage.
//
// Wrangler bindings expected (from your wrangler.toml):
// [[d1_databases]] binding="DB"
// [[kv_namespaces]] binding="ONBOARD_KV"
// [[r2_buckets]] binding="R2_UPLOADS"
// [vars]
//   API_URL="https://onboard.vinet.co.za"
//   SPLYNX_API="https://splynx.vinet.co.za/api/2.0"
//   SPLYNX_AUTH="<Basic ...>"
//   TERMS_SERVICE_URL="https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt"
//   TERMS_DEBIT_URL  ="https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt"
//   WHATSAPP_TOKEN, PHONE_NUMBER_ID (optional)
//   ADMIN_IPS="160.226.143.254, 160.226.128.0/20"
//   LINK_TTL_HOURS="168"
//
// NOTE: This file is self-contained. Drop it into src/index.js.
//
// PDF rendering uses pdf-lib (Workers-compatible build). If you bundle, ensure pdf-lib is included.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const BRAND = { site: "www.vinet.co.za", phone: "021 007 0200" };

// ---------- Helpers ----------
const esc=(s="")=>String(s).replace(/[&<>"]/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[t]));
const rand=(n=6)=>{const cs="abcdefghjkmnpqrstuvwxyz23456789";let o="";for(let i=0;i<n;i++)o+=cs[Math.floor(Math.random()*cs.length)];return o;};
async function fetchText(url){ try{ const r=await fetch(url,{cf:{cacheEverything:true,cacheTtl:300}}); if(!r.ok) return ""; return await r.text(); }catch{ return ""; } }
async function fetchArrayBuffer(url){ const r=await fetch(url); if(!r.ok) throw new Error(`fetchArrayBuffer ${url} ${r.status}`); return await r.arrayBuffer(); }
const JSONRes=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
const now=()=>Date.now();

// ---------- IP gating (ADMIN_IPS supports single IPs and CIDR /20,/24) ----------
function parseAdminIPs(val){
  const items=String(val||"").split(",").map(s=>s.trim()).filter(Boolean);
  const out=[];
  for(const it of items){
    const m = it.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/);
    if(!m) continue;
    const a=+m[1],b=+m[2],c=+m[3],d=+m[4],mask=m[5]?+m[5]:32;
    if(mask===32){ out.push({a,b,cMin:c,cMax:c,dMin:d,dMax:d}); }
    else if(mask===24){ out.push({a,b,cMin:c,cMax:c,dMin:0,dMax:255}); }
    else if(mask===20){ // x.y.128.0/20 => c in [128..143], any d
      out.push({a,b,cMin:c,dMin:0,cMax:c+15,dMax:255});
    } else {
      // simple fallback: treat as /24
      out.push({a,b,cMin:c,cMax:c,dMin:0,dMax:255});
    }
  }
  return out;
}
function ipAllowed(request, ranges){
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if(!m) return false;
  const a=+m[1],b=+m[2],c=+m[3],d=+m[4];
  for(const r of ranges){ if(a===r.a && b===r.b && c>=r.cMin && c<=r.cMax && d>=r.dMin && d<=r.dMax) return true; }
  return false;
}

// ---------- Splynx minimal ----------
async function splynxGET(env, endpoint){ const r=await fetch(`${env.SPLYNX_API}${endpoint}`,{headers:{Authorization:`Basic ${env.SPLYNX_AUTH}`}}); if(!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`); return r.json(); }
async function splynxPOSTForm(env, endpoint, form){ const r=await fetch(`${env.SPLYNX_API}${endpoint}`,{method:"POST",headers:{Authorization:`Basic ${env.SPLYNX_AUTH}`},body:form}); if(!r.ok) throw new Error(`Splynx POST ${endpoint} ${r.status}`); return r.json().catch(()=>({})); }
function pickPhone(obj){ if(!obj) return null; const ok=s=>/^27\d{8,13}$/.test(String(s||"").trim()); const direct=[obj.phone_mobile,obj.mobile,obj.phone,obj.whatsapp,obj.msisdn,obj.primary_phone,obj.contact_number,obj.billing_phone]; for(const v of direct) if(ok(v)) return String(v).trim(); if(Array.isArray(obj)){ for(const it of obj){ const m=pickPhone(it); if(m) return m; } } else if(typeof obj==="object"){ for(const k of Object.keys(obj)){ const m=pickPhone(obj[k]); if(m) return m; } } return null; }
async function fetchProfileForDisplay(env, id){
  let cust=null, lead=null, contacts=null, info=null;
  try{ cust=await splynxGET(env, `/admin/customers/customer/${id}`);}catch{}
  if(!cust){ try{ lead=await splynxGET(env, `/crm/leads/${id}`);}catch{} }
  try{ contacts=await splynxGET(env, `/admin/customers/${id}/contacts`);}catch{}
  try{ info=await splynxGET(env, `/admin/customers/customer-info/${id}`);}catch{}
  const src=cust||lead||{}; const phone=pickPhone({...src,contacts});
  const street=src.street??src.address??src.address_1??src.street_1??(src.addresses&&(src.addresses.street||src.addresses.address_1))??"";
  const city=src.city??(src.addresses&&src.addresses.city)??"";
  const zip=src.zip_code??src.zip??(src.addresses&&(src.addresses.zip||src.addresses.zip_code))??"";
  const passport=(info&&(info.passport||info.id_number||info.identity_number))||src.passport||src.id_number||"";
  return { id, full_name:src.full_name||src.name||"", email:src.email||src.billing_email||"", phone:phone||"", street, city, zip, passport };
}

// ---------- KV keys ----------
const kvKey={ link:id=>`link:${id}`, otp:id=>`otp:${id}`, staff:id=>`staff:${id}` };

// ---------- D1 (optional) ----------
async function ensureTables(env){ if(!env.DB) return; await env.DB.exec(`CREATE TABLE IF NOT EXISTS onboard(id INTEGER PRIMARY KEY AUTOINCREMENT, splynx_id TEXT, linkid TEXT, status TEXT, updated INTEGER);`); }
async function markStatus(env, splynx_id, linkid, status){ if(!env.DB) return; await ensureTables(env); const ts=now(); await env.DB.prepare(`INSERT INTO onboard (splynx_id,linkid,status,updated) VALUES (?1,?2,?3,?4)`).bind(String(splynx_id),String(linkid),String(status),ts).run(); }
async function listByMode(env, mode){ if(!env.DB) return {items:[]}; await ensureTables(env); const stmt=env.DB.prepare(`SELECT splynx_id as id, linkid, updated FROM onboard WHERE status=?1 ORDER BY updated DESC LIMIT 100`).bind(mode); const {results}=await stmt.all(); return {items: results||[]}; }

// ---------- WhatsApp OTP (optional; supports simple text) ----------
async function sendWhatsAppOTP(env, msisdn, code){
  if(!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) return { ok:true, sent:false, note:"WA not configured", code };
  const url=`https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`;
  const body={ messaging_product:"whatsapp", to:msisdn, type:"text", text:{ body:`Your Vinet onboarding code is: ${code}` } };
  const r=await fetch(url,{method:"POST",headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${env.WHATSAPP_TOKEN}` }, body:JSON.stringify(body)});
  return { ok:r.ok, sent:r.ok, code };
}

// ---------- Admin UI ----------
function adminShell(activeTab="gen", urlObj){
  const tab = esc(urlObj.searchParams.get("tab") || activeTab);
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
:root{--red:#d90429;--bd:#eee}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fafafa;margin:0}
.wrap{max-width:1100px;margin:28px auto;padding:0 16px}
.card{background:#fff;border:1px solid var(--bd);border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.05);padding:24px}
h1{font-size:34px;margin:8px 0 20px;text-align:center;color:#b10015}
.logo{display:block;margin:0 auto 8px;height:64px}
.tabs{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin:8px 0 20px}
.tab{padding:10px 16px;border:2px solid var(--red);border-radius:999px;color:var(--red);cursor:pointer}
.tab.active{background:var(--red);color:#fff}
.row{display:grid;grid-template-columns:220px 1fr;gap:10px 16px;margin:10px 0}
input,button{font:inherit}input{border:1px solid #ddd;border-radius:10px;padding:10px;width:100%}
button{padding:12px 16px;border-radius:12px;border:0;background:var(--red);color:#fff;cursor:pointer}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #f0f0f0;padding:10px;text-align:left}
.btn{border:1px solid #ddd;background:#fff;color:#222}
.hint{color:#666;font-size:13px}
.link{color:#1a73e8}
</style></head><body>
<div class="wrap"><div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <h1>Admin Dashboard</h1>
  <div class="tabs">
    <div class="tab ${tab==='gen'?'active':''}" data-tab="gen">1. Generate onboarding link</div>
    <div class="tab ${tab==='staff'?'active':''}" data-tab="staff">2. Generate verification code</div>
    <div class="tab ${tab==='inprog'?'active':''}" data-tab="inprog">3. Pending (in-progress)</div>
    <div class="tab ${tab==='pending'?'active':''}" data-tab="pending">4. Completed (awaiting approval)</div>
    <div class="tab ${tab==='approved'?'active':''}" data-tab="approved">5. Approved</div>
  </div>
  <div id="content">Loading…</div>
</div></div>
<script>(()=>{
  const tabs=[...document.querySelectorAll('.tab')], content=document.getElementById('content');
  tabs.forEach(t=>t.onclick=()=>{const u=new URL(location.href);u.searchParams.set('tab',t.dataset.tab);history.replaceState(null,'',u.toString());tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.dataset.tab);});
  load("${tab}");
  function node(html){const d=document.createElement('div');d.innerHTML=html;return d;}
  async function load(which){
    if(which==='gen'){
      content.innerHTML='';
      const v=node('<div class="row"><div>Splynx Lead/Customer ID</div><div><input id="id" placeholder="e.g. 319"/></div></div><div style="display:flex;gap:12px;justify-content:center"><button id="go">Generate</button></div><div id="out" class="hint" style="margin-top:10px;text-align:center"></div>');
      v.querySelector('#go').onclick=async()=>{
        const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
        if(!id){ out.textContent='Please enter an ID.'; return; }
        out.textContent='Working…';
        try{
          let r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
          if(!r.ok) r=await fetch('/api/admin/genlink?id='+encodeURIComponent(id));
          const d=await r.json().catch(()=>({}));
          out.innerHTML = d.url ? ('Onboarding link: <a class="link" href="'+d.url+'" target="_blank" rel="noreferrer">'+d.url+'</a>') : 'Error generating link.';
        }catch{ out.textContent='Network error.'; }
      };
      content.appendChild(v); return;
    }
    if(which==='staff'){
      content.innerHTML='';
      const v=node('<div class="row"><div>Onboarding Link ID</div><div><input id="linkid" placeholder="e.g. 319_ab12cd"/></div></div><div style="text-align:center"><button id="go">Generate staff code</button></div><div id="out" class="hint" style="margin-top:10px;text-align:center"></div>');
      v.querySelector('#go').onclick=async()=>{
        const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
        if(!linkid){ out.textContent='Enter linkid'; return; }
        out.textContent='Working…';
        try{
          const r=await fetch('/api/admin/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
          const d=await r.json().catch(()=>({}));
          out.innerHTML = d.ok ? ('Staff code: <b>'+d.code+'</b> (valid 15 min)') : (d.error||'Failed');
        }catch{ out.textContent='Network error.'; }
      };
      content.appendChild(v); return;
    }
    if(['inprog','pending','approved'].includes(which)){
      content.innerHTML='Loading…';
      try{
        const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
        const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td><a class="link" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Open</a></td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table>';
      }catch{ content.innerHTML='Failed to load.'; }
      return;
    }
  }
})();</script>
</body></html>`;
}
function adminReviewPage(linkid){
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Review & Approve</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fafafa;margin:0}.wrap{max-width:900px;margin:28px auto;padding:0 16px}.card{background:#fff;border:1px solid #eee;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(0,0,0,.05)}h1{font-size:28px;margin:0 0 16px;color:#b10015}.sec{margin:16px 0}.pill{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:2px 8px;font-size:12px;background:#f9f9f9}.list a{display:inline-block;margin:4px 0}</style></head><body>
<div class="wrap"><div class="card">
<h1>Review & Approve</h1>
<div class="sec"><b>Link ID:</b> ${esc(linkid)}</div>
<div id="data" class="sec">Loading…</div>
</div></div>
<script>
(async()=>{
  const r=await fetch('/api/admin/review-data?linkid='+encodeURIComponent(${JSON.stringify(linkid)}));
  const d=await r.json().catch(()=>({}));
  const el=document.getElementById('data');
  if(!d.ok){ el.textContent = d.error||'Failed to load'; return; }
  const prof = d.profile||{};
  const uploads = d.uploads||[];
  const ag = d.agreements||{};
  el.innerHTML = \`
    <div class="sec"><b>Splynx ID:</b> \${prof.id||''} • <span class="pill">\${d.status||'pending'}</span></div>
    <div class="sec"><b>Customer</b><div class="list">
      full_name: \${prof.full_name||''}<br/>email: \${prof.email||''}<br/>phone: \${prof.phone||''}<br/>passport: \${prof.passport||''}<br/>street: \${prof.street||''}<br/>city: \${prof.city||''}<br/>zip: \${prof.zip||''}
    </div></div>
    <div class="sec"><b>Uploads</b><div class="list">\${
      uploads.length? uploads.map(u=>\`<a href="/api/admin/get?key=\${encodeURIComponent(u.key)}" target="_blank">\${u.name} — \${u.size_human}</a>\`).join('<br/>') : 'None'
    }</div></div>
    <div class="sec"><b>Agreements</b><div class="list">
      \${ag.msa? \`<a href="/api/admin/get?key=\${encodeURIComponent(ag.msa)}" target="_blank">MSA (PDF)</a>\` : '<span class="pill">MSA not generated</span>'}<br/>
      \${ag.debit? \`<a href="/api/admin/get?key=\${encodeURIComponent(ag.debit)}" target="_blank">Debit Order (PDF)</a>\` : '<span class="pill">Debit not generated</span>'}
    </div></div>
    <div class="sec">
      <button onclick="action('approve')">Approve & Push</button>
      <button style="background:#fff;color:#b10015;border:1px solid #b10015" onclick="action('reject')">Reject</button>
      <button style="background:#fff;color:#222;border:1px solid #ccc" onclick="action('delete')">Delete</button>
      <div id="msg" class="sec"></div>
    </div>\`;
  window.action = async (what)=>{
    const m=document.getElementById('msg'); m.textContent='Working…';
    const res=await fetch('/api/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}, action:what})});
    const j=await res.json().catch(()=>({}));
    m.textContent = j.ok ? 'Done' : ('Failed: '+(j.error||''));
  };
})();
</script></body></html>`;
}

// ---------- Onboarding UI ----------
function renderOnboardPage(linkid, env){
  const EFT = {
    bank: env.EFT_BANK_NAME || "First National Bank (FNB/RMB)",
    name: env.EFT_ACCOUNT_NAME || "Vinet Internet Solutions",
    no: env.EFT_ACCOUNT_NO || "62757054996",
    branch: env.EFT_BRANCH_CODE || "250655",
    ref: env.EFT_REFERENCE || "SPLYNX-ID",
    notes: env.EFT_NOTES || "Please remember that all accounts are payable on or before the 1st of every month."
  };
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Vinet Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>:root{--red:#d90429}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#fff}
header{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0 6px;border-bottom:1px solid #eee}
header img{height:64px;margin:6px 0}header h1{font-size:18px;margin:6px 0 0}
.wrap{max-width:880px;margin:0 auto;padding:12px 16px 32px}
.card{border:1px solid #eee;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-top:16px}
.row{display:grid;grid-template-columns:160px 1fr;gap:10px 16px;margin:8px 0}
input,select,button,textarea{font:inherit}input,select,textarea{border:1px solid #ddd;border-radius:10px;padding:8px 10px;width:100%}
button{padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer}button.primary{border-color:var(--red);background:var(--red);color:#fff}
.hint{color:#666;font-size:13px}.step{display:none}.step.active{display:block}canvas{border:1px dashed #ccc;border-radius:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.flex{display:flex;gap:10px;align-items:center}
.termsbox{border:1px solid #eee;border-radius:10px;padding:10px;max-height:240px;overflow:auto;background:#fafafa}
.sectionTitle{font-weight:700;margin:12px 0 6px}
</style></head><body>
<header><img src="${LOGO_URL}" alt="Vinet"/><h1>Client Onboarding</h1></header>
<div class="wrap">
  <div class="card"><div class="hint">Link ID: <code id="linkid">${esc(linkid)}</code></div><div id="status" class="hint" style="margin-top:6px"></div></div>

  <div class="card step active" id="s1">
    <h2>Step 1: Verify</h2>
    <p>Enter the 6-digit WhatsApp code or a staff code.</p>
    <div class="flex"><input id="otp" placeholder="Enter code"/><button id="btnSend">Resend</button><button id="btnVerify" class="primary">Verify</button></div>
    <div id="otpMsg" class="hint"></div>
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
      <button id="optEft" class="primary">EFT</button>
      <button id="optDebit">Debit order</button>
    </div>
    <div id="payBody" style="margin-top:12px"></div>
    <div style="margin-top:10px"><button id="to4" class="primary">Continue</button></div>
  </div>

  <div class="card step" id="s4">
    <h2>Step 4: Upload documents (optional)</h2>
    <div class="grid2">
      <div><div>ID Document (max 5MB)</div><input type="file" id="file_id"/></div>
      <div><div>Proof of Address (max 5MB)</div><input type="file" id="file_poa"/></div>
    </div>
    <div class="hint">You can come back later to upload these if needed.</div>
    <div style="margin-top:10px"><button id="to5" class="primary">Continue</button></div>
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
    <p>Your agreements have been recorded. You can download them above anytime.</p>
  </div>
</div>

<script>
const linkid = ${JSON.stringify(linkid)};
const $ = sel => document.querySelector(sel);
const S = n => ($('.step.active')?.classList.remove('active'), document.getElementById('s'+n).classList.add('active'));
function Sig(el){ const c=el, ctx=c.getContext('2d'); let down=false,last=null;
  c.addEventListener('pointerdown',e=>{down=true; last=[e.offsetX,e.offsetY]});
  c.addEventListener('pointerup',()=>{down=false; last=null});
  c.addEventListener('pointerleave',()=>{down=false; last=null});
  c.addEventListener('pointermove',e=>{ if(!down)return; ctx.lineWidth=2; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(last[0],last[1]); ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); last=[e.offsetX,e.offsetY]; });
  return { clear:()=>ctx.clearRect(0,0,c.width,c.height), data:()=>c.toDataURL('image/png'), isEmpty:()=>{ const a=ctx.getImageData(0,0,c.width,c.height).data; for(let i=3;i<a.length;i+=4){ if(a[i]) return false; } return true; } };
}
const sigMSA = Sig(document.getElementById('sig_msa'));
document.getElementById('clear_msa').onclick=()=>sigMSA.clear();
let payChoice='eft'; let sigDebit=null;
function renderEFT(){
  $('#payBody').innerHTML = \`
    <div class="row"><div>Bank</div><div>${esc(EFT.bank)}</div></div>
    <div class="row"><div>Account Name</div><div>${esc(EFT.name)}</div></div>
    <div class="row"><div>Account Number</div><div>${esc(EFT.no)}</div></div>
    <div class="row"><div>Branch Code</div><div>${esc(EFT.branch)}</div></div>
    <div class="row"><div>Reference</div><div>${esc(EFT.ref)}</div></div>
    <div class="hint" style="margin-top:6px">${esc(EFT.notes)}</div>
    <div style="margin-top:8px"><button onclick="window.print()">Print banking details</button></div>
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
  // load terms
  fetch('/api/terms?kind=debit').then(r=>r.text()).then(t=>$('#debit_terms').innerHTML=t).catch(()=>$('#debit_terms').textContent='Terms unavailable.');
}
$('#optEft').onclick=()=>{ payChoice='eft'; $('#optEft').classList.add('primary'); $('#optDebit').classList.remove('primary'); renderEFT(); };
$('#optDebit').onclick=()=>{ payChoice='debit'; $('#optDebit').classList.add('primary'); $('#optEft').classList.remove('primary'); renderDebit(); };
renderEFT();
// OTP
function ua(){ return navigator.userAgent || '' }
async function getJSON(url, opts){ const r=await fetch(url,opts); try{return await r.json()}catch{return{}}}
$('#btnSend').onclick = async () => { $('#otpMsg').textContent='Sending…'; const d = await getJSON('/api/otp/send', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})}); $('#otpMsg').textContent = d.ok ? 'Code sent.' : ('Failed: '+(d.error||'Check with staff for a code.')); };
$('#btnVerify').onclick = async () => {
  const code = ($('#otp').value||'').trim(); if(!code){ $('#otpMsg').textContent='Enter code'; return; }
  const d = await getJSON('/api/otp/verify', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, code})});
  if(d.ok){ $('#otpMsg').textContent='Verified.';
    const p = await getJSON('/api/profile?linkid='+encodeURIComponent(linkid));
    if(p && p.id){ $('#full_name').value=p.full_name||''; $('#id_number').value=p.passport||''; $('#customer_id').value=p.id||''; $('#email').value=p.email||''; $('#phone').value=p.phone||''; $('#street').value=p.street||''; $('#city').value=p.city||''; $('#zip').value=p.zip||''; $('#status').textContent='Verified at '+new Date().toLocaleString(); }
    S(2);
  } else { $('#otpMsg').textContent='Invalid code'; }
};
// Navigation
$('#to3').onclick = () => { S(3); };
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
$('#to5').onclick = async () => {
  const idf = document.getElementById('file_id').files[0]; const poa = document.getElementById('file_poa').files[0];
  const fd = new FormData(); if(idf) fd.append('id', idf); if(poa) fd.append('poa', poa); fd.append('linkid', linkid);
  const r = await fetch('/api/upload', { method:'POST', body: fd }); if(!r.ok) console.log('Upload failed (optional).');
  const msa = await fetch('/api/terms?kind=service').then(r=>r.text()).catch(()=>'');
  document.getElementById('msa_terms').innerHTML = msa || 'Terms unavailable.';
  S(5);
};
// Generate PDFs
$('#gen').onclick = async () => {
  if (!document.getElementById('agree_msa').checked) { alert('Please agree to the MSA terms.'); return; }
  if (sigMSA.isEmpty()) { alert('Please sign the MSA.'); return; }
  const common = {
    full_name: $('#full_name').value.trim(), id_number: $('#id_number').value.trim(), customer_id: $('#customer_id').value.trim(),
    email: $('#email').value.trim(), phone: $('#phone').value.trim(),
    street: $('#street').value.trim(), city: $('#city').value.trim(), zip: $('#zip').value.trim(),
    date: new Date().toISOString(), user_agent: ua(), linkid
  };
  let links='';
  let msa = await fetch('/api/pdf/msa', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...common, signature: sigMSA.data(), agree: true }) });
  if (msa.ok) { const blob = await msa.blob(); const url = URL.createObjectURL(blob); links += '<div><a download="MSA.pdf" href="'+url+'">Download MSA</a></div>'; }
  if (document.getElementById('optDebit').classList.contains('primary')) {
    const body = {
      ...common,
      account_holder: $('#account_holder').value.trim(),
      holder_id: $('#holder_id').value.trim(),
      bank: $('#bank').value.trim(),
      account_no: $('#account_no').value.trim(),
      account_type: $('#account_type').value.trim(),
      debit_day: $('#debit_day').value.trim(),
      signature: sigDebit.data(),
      agree: true
    };
    const deb = await fetch('/api/pdf/debit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    if (deb.ok) { const blob = await deb.blob(); const url = URL.createObjectURL(blob); links += '<div><a download="Debit_Order.pdf" href="'+url+'">Download Debit Order</a></div>'; }
  }
  document.getElementById('pdfLinks').innerHTML = links || 'No files.';
  S(6);
};
</script>
</body></html>`;
}

// ---------- Terms (HTML for on-page boxes) ----------
async function termsHandler(env, url){
  const kind = (url.searchParams.get("kind") || "").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL;
  const debUrl = env.TERMS_DEBIT_URL;
  const txt = (await fetchText(kind==="debit" ? debUrl : svcUrl)) || "";
  return new Response(`<pre style="white-space:pre-wrap;margin:0">${esc(txt)}</pre>`,{headers:{"content-type":"text/html; charset=utf-8"}});
}

// ---------- PDF helpers ----------
const A4 = { w: 595.28, h: 841.89 };
function ddmmyyyy(iso){ try{ const d=new Date(iso||Date.now()); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yy=d.getFullYear(); return `${dd}/${mm}/${yy}` }catch{ return "" } }
async function embedLogo(doc){ try{ const bytes=await fetchArrayBuffer(LOGO_URL); return await doc.embedJpg(bytes).catch(async()=>await doc.embedPng(bytes)); }catch{ return null; } }
function dashedLine(page,x,y,w,dash=6,gap=4,thickness=0.7){ let cur=x; while(cur<x+w){ const seg=Math.min(dash,x+w-cur); page.drawLine({ start:{x:cur,y}, end:{x:cur+seg,y}, thickness, color: rgb(0.7,0.7,0.7) }); cur+=dash+gap; } }
function drawHeader(page, fonts, logoImg, title){
  const { helv, helvBold } = fonts;
  page.drawText(title, { x: 40, y: A4.h-60, size: 16, font: helvBold, color: rgb(0,0,0) });
  let topY = A4.h-40;
  if (logoImg) {
    const scale = 0.18; const w = logoImg.width*scale, h = logoImg.height*scale;
    page.drawImage(logoImg, { x: A4.w-40-w, y: topY-h, width:w, height:h });
    topY = A4.h-46-h;
  }
  page.drawText(BRAND.site+" • "+BRAND.phone, { x: A4.w-220, y: topY-6, size: 10, font: helv, color: rgb(0.2,0.2,0.2) });
  dashedLine(page, 40, A4.h-70, A4.w-80);
}
function drawKV(page, fonts, x, y, kv, opts={colW:140, lineH:16, size:11}){
  const { helv, helvBold } = fonts;
  let yy=y;
  for (const [k,v] of kv) {
    page.drawText(String(k), { x, y: yy, size: opts.size, font: helvBold });
    page.drawText(String(v||""), { x: x+opts.colW, y: yy, size: opts.size, font: helv });
    yy -= opts.lineH;
  }
  return yy;
}
function drawTwoCols(page, fonts, xL, xR, y, leftItems, rightItems, opts={lineH:16, size:11}){
  const { helv, helvBold } = fonts; let yl=y, yr=y;
  for (const [k,v] of leftItems) { page.drawText(String(k),{x:xL,y:yl,size:opts.size,font:helvBold}); page.drawText(String(v||""),{x:xL+120,y:yl,size:opts.size,font:helv}); yl -= opts.lineH; }
  for (const [k,v] of rightItems) { page.drawText(String(k),{x:xR,y:yr,size:opts.size,font:helvBold}); page.drawText(String(v||""),{x:xR+120,y:yr,size:opts.size,font:helv}); yr -= opts.lineH; }
  return Math.min(yl, yr);
}
function flowTwoColumnText(doc, fonts, logo, title, rawText, size){
  const words = String(rawText||"").split(/\s+/);
  const colGap = 20, marginX = 40, marginTop = 100, marginBottom = 120;
  const colWidth = (A4.w - (marginX*2) - colGap) / 2;
  const lineH = size + 3;
  let page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title);
  let x = marginX, y = A4.h - marginTop, col = 0;
  const pages=[page];
  const { helv } = fonts;
  let line = "";
  function newPage(){ page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title); pages.push(page); x = marginX; y = A4.h - marginTop; col = 0; line=""; }
  function newColumn(){ col = 1; x = marginX + colWidth + colGap; y = A4.h - marginTop; line=""; }
  for(const w of words){
    const test = (line?line+" ":"")+w;
    const width = helv.widthOfTextAtSize(test, size);
    if (width > colWidth) {
      page.drawText(line, { x, y, size, font: helv });
      y -= lineH; line = w;
      if (y < marginBottom) { if (col === 0) newColumn(); else newPage(); }
    } else { line = test; }
  }
  if (line) { page.drawText(line, { x, y, size, font: helv }); y -= lineH; }
  return { pages, lastY: y, col, x, colWidth, marginBottom };
}
async function buildPDF(docType, data, env, request){
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { helv, helvBold };
  const logo = await embedLogo(doc);
  const title = docType==="debit" ? "Debit Order Instruction" : "Master Service Agreement";

  // First page
  let page = doc.addPage([A4.w, A4.h]);
  drawHeader(page, fonts, logo, title);
  let y = A4.h-100;

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
    y = drawKV(page, fonts, 40, y, clientKV, { colW:140, lineH:16, size:11 }) - 8;
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
    page.drawText("Debit Order Terms", { x:40, y, size:12, font: helvBold }); y -= 16;
    const flow = flowTwoColumnText(doc, fonts, logo, title, data.terms_debit || "", 9);
    page = flow.pages[flow.pages.length-1];
    y = flow.lastY;
  } else {
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
    y = drawTwoCols(page, fonts, 40, A4.w/2+20, y, left, right, { lineH:16, size:11 }) - 10;
    page.drawText("Service Terms", { x:40, y, size:12, font: helvBold }); y -= 16;
    const flow = flowTwoColumnText(doc, fonts, logo, title, data.terms_service || "", 11);
    page = flow.pages[flow.pages.length-1];
    y = flow.lastY;
  }

  // Signatures (bottom)
  if (y < 140) { page = doc.addPage([A4.w, A4.h]); drawHeader(page, fonts, logo, title); y = A4.h - 140; }
  dashedLine(page, 40, 120, A4.w-80, 4, 2, 0.5);
  const rowY = 110;
  page.drawText("Name", { x: 40, y: rowY, size: 11, font: helvBold });
  page.drawText(String(data.full_name||""), { x: 40, y: rowY-16, size: 11, font: helv });
  page.drawText("Signature", { x: A4.w/2-30, y: rowY, size: 11, font: helvBold });
  if (data.signature) {
    try {
      const png = await doc.embedPng(Uint8Array.from(atob(data.signature.split(",")[1]||""), c=>c.charCodeAt(0)));
      const w = Math.min(200, png.width*0.5), h = (png.height/png.width)*w;
      page.drawImage(png, { x: A4.w/2-60, y: rowY-16-h-2, width:w, height:h });
    } catch {}
  }
  page.drawText("Date (DD/MM/YYYY)", { x: A4.w-190, y: rowY, size: 11, font: helvBold });
  page.drawText(ddmmyyyy(data.date), { x: A4.w-190, y: rowY-16, size: 11, font: helv });

  // Security Audit page
  const audit = doc.addPage([A4.w, A4.h]);
  drawHeader(audit, fonts, logo, "VINET — Agreement Security Summary");
  let ay = A4.h-110;
  const headers = [
    ["Link ID:", data.linkid],
    ["Splynx ID:", data.customer_id],
    ["IP Address:", (request.headers.get("CF-Connecting-IP")||"")],
    ["Location:", request.headers.get("CF-IPCity") ? `${request.headers.get("CF-IPCity")}, ${request.headers.get("CF-IPCountry")||""}` : ""],
    ["Cloudflare PoP:", (request.headers.get("CF-Ray")||"").split("-").pop() || ""],
    ["User-Agent:", request.headers.get("User-Agent") || ""],
    ["Timestamp:", ddmmyyyy(data.date)]
  ];
  drawKV(audit, fonts, 40, ay, headers, { colW:120, lineH:18, size:11 });

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}

// ---------- Worker ----------
export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Admin IP gating
    const adminRanges = parseAdminIPs(env.ADMIN_IPS || "160.226.128.0/20");
    const isAdminRoute = (path==="/admin" || path.startsWith("/api/admin") || path.startsWith("/admin/"));
    if (isAdminRoute && !ipAllowed(request, adminRanges)) return new Response("Forbidden", { status: 403 });

    // Admin pages
    if (path === "/admin" && method === "GET") return new Response(adminShell("gen", url), { headers: { "content-type":"text/html; charset=utf-8" } });
    if (path === "/admin/review" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      return new Response(adminReviewPage(linkid), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // Admin APIs
    if (path === "/api/admin/genlink" && (method === "POST" || method === "GET")) {
      let id=null; if(method==="POST"){ try{ const b=await request.json(); id=b.id; }catch{} } if(!id) id=url.searchParams.get("id");
      if(!id) return JSONRes({ ok:false, error:"Missing id" },400);
      const base=env.API_URL || `${url.protocol}//${url.host}`;
      const linkid = `${String(id).trim()}_${rand(6)}`;
      const ttlH = parseInt(env.LINK_TTL_HOURS||"168",10); const ttl = Math.min(Math.max(ttlH,1),24*30)*3600;
      await env.ONBOARD_KV.put(kvKey.link(linkid), JSON.stringify({ id:String(id).trim(), created: now() }), { expirationTtl: ttl });
      await markStatus(env, String(id).trim(), linkid, "inprog");
      return JSONRes({ ok:true, url:`${base}/onboard/${linkid}`, linkid });
    }
    if (path === "/api/admin/staff/gen" && method === "POST") {
      const { linkid } = await request.json();
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(kvKey.staff(linkid), code, { expirationTtl: 60*15 });
      return JSONRes({ ok:true, code });
    }
    if (path === "/api/admin/list" && method === "GET") {
      const mode = url.searchParams.get("mode") || "inprog";
      const d = await listByMode(env, mode); return JSONRes(d);
    }

    // Admin review JSON for page
    if (path === "/api/admin/review-data" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const stored = await env.ONBOARD_KV.get(kvKey.link(linkid), { type:"json" });
      if (!stored?.id) return JSONRes({ ok:false, error:"Invalid link" }, 400);
      const profile = await fetchProfileForDisplay(env, stored.id);
      // uploads
      const uploads=[];
      if (env.R2_UPLOADS){
        const l = await env.R2_UPLOADS.list({ prefix: `uploads/${linkid}/` });
        for (const o of (l.objects||[])){ uploads.push({ key:o.key, name:o.key.split('/').pop(), size:o.size, size_human:(o.size/1024).toFixed(1)+' KB' }); }
      }
      // agreements
      const agreements={};
      if (env.R2_UPLOADS){
        if (await env.R2_UPLOADS.head(`agreements/${linkid}/MSA.pdf`).catch(()=>null)) agreements.msa=`agreements/${linkid}/MSA.pdf`;
        if (await env.R2_UPLOADS.head(`agreements/${linkid}/Debit.pdf`).catch(()=>null)) agreements.debit=`agreements/${linkid}/Debit.pdf`;
      }
      return JSONRes({ ok:true, profile, uploads, agreements, status:"pending" });
    }

    // Admin action (stub)
    if (path === "/api/admin/action" && method === "POST") { return JSONRes({ ok:true }); }

    // Admin: serve stored files from R2
    if (path === "/api/admin/get" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!key || !env.R2_UPLOADS) return new Response("Not found", { status: 404 });
      const o = await env.R2_UPLOADS.get(key);
      if (!o) return new Response("Not found", { status: 404 });
      return new Response(o.body, { headers: { "content-type": key.endsWith(".pdf") ? "application/pdf" : (o.httpMetadata?.contentType || "application/octet-stream"), "content-disposition": `inline; filename="${key.split('/').pop()}"` } });
    }

    // Public: onboarding
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = decodeURIComponent(path.split("/").pop() || "");
      const valid = await env.ONBOARD_KV.get(kvKey.link(linkid), { type:"json" });
      if (!valid?.id) return new Response("Invalid or expired link.", { status: 404 });
      return new Response(renderOnboardPage(linkid, env), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // OTP
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json();
      const stored = await env.ONBOARD_KV.get(kvKey.link(linkid), { type:"json" });
      if (!stored?.id) return JSONRes({ ok:false, error:"Invalid link" },400);
      const prof = await fetchProfileForDisplay(env, stored.id);
      const msisdn = prof.phone;
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(kvKey.otp(linkid), code, { expirationTtl: 60*10 });
      let sent = { ok:false, note:"no msisdn" }; if (msisdn) sent = await sendWhatsAppOTP(env, msisdn, code);
      return JSONRes({ ok:true, sent, msisdn: msisdn || null });
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, code } = await request.json();
      const otp = await env.ONBOARD_KV.get(kvKey.otp(linkid));
      const staff = await env.ONBOARD_KV.get(kvKey.staff(linkid));
      if (otp && code && code.trim()===otp) return JSONRes({ ok:true, kind:"otp" });
      if (staff && code && code.trim()===staff) return JSONRes({ ok:true, kind:"staff" });
      return JSONRes({ ok:false });
    }

    // Profile after OTP
    if (path === "/api/profile" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const stored = await env.ONBOARD_KV.get(kvKey.link(linkid), { type:"json" });
      if (!stored?.id) return JSONRes({});
      const prof = await fetchProfileForDisplay(env, stored.id);
      return JSONRes(prof || {});
    }

    // Uploads (optional) -> store to R2 and forward to Splynx
    if (path === "/api/upload" && method === "POST") {
      const form = await request.formData();
      const linkid = form.get("linkid");
      const stored = await env.ONBOARD_KV.get(kvKey.link(linkid), { type:"json" });
      const id = stored?.id;
      if (!id) return JSONRes({ ok:false, error:"Invalid link" }, 400);
      let okAny=false, saved=[];
      async function handleOne(field){
        const f=form.get(field); if(!f || typeof f==="string") return;
        if (f.size > 5*1024*1024) throw new Error(`${field} too large`);
        // R2 save
        if (env.R2_UPLOADS){
          const key = `uploads/${linkid}/${now()}_${f.name}`;
          await env.R2_UPLOADS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || "application/octet-stream" } });
          saved.push(key);
        }
        // Splynx forward (best-effort)
        try{ const fd=new FormData(); fd.append("file", f, f.name); await splynxPOSTForm(env, `/crm/lead-documents/upload-file?lead_id=${encodeURIComponent(id)}`, fd); }catch{}
        okAny=true;
      }
      try{ await handleOne("id"); await handleOne("poa"); return JSONRes({ ok:true, uploaded: okAny, saved }); }
      catch(e){ return JSONRes({ ok:false, error:String(e) }, 500); }
    }

    // Terms for UI boxes
    if (path === "/api/terms" && method === "GET") return termsHandler(env, url);

    // PDFs — require agree + signature
    if (path === "/api/pdf/msa" && method === "POST") {
      const body = await request.json();
      if (!body.agree) return new Response("Please agree to the MSA terms.", { status: 400 });
      if (!body.signature) return new Response("MSA signature required.", { status: 400 });
      const pdfBytes = await buildPDF("msa", { ...body, terms_service: await fetchText(env.TERMS_SERVICE_URL) }, env, request);
      if (env.R2_UPLOADS) await env.R2_UPLOADS.put(`agreements/${body.linkid}/MSA.pdf`, pdfBytes, { httpMetadata: { contentType: "application/pdf" } });
      await markStatus(env, body.customer_id || "unknown", body.linkid || "", "pending");
      return new Response(pdfBytes, { headers: { "content-type":"application/pdf" } });
    }
    if (path === "/api/pdf/debit" && method === "POST") {
      const b = await request.json();
      const required = ["account_holder","holder_id","bank","account_no","account_type","debit_day"];
      for (const k of required){ if(!b[k] || String(b[k]).trim()==="") return new Response(`Missing ${k}`,{status:400}); }
      if (!b.agree) return new Response("Please agree to the debit order terms.", { status: 400 });
      if (!b.signature) return new Response("Debit order signature required.", { status: 400 });
      const pdfBytes = await buildPDF("debit", { ...b, terms_debit: await fetchText(env.TERMS_DEBIT_URL) }, env, request);
      if (env.R2_UPLOADS) await env.R2_UPLOADS.put(`agreements/${b.linkid}/Debit.pdf`, pdfBytes, { httpMetadata: { contentType: "application/pdf" } });
      await markStatus(env, b.customer_id || "unknown", b.linkid || "", "pending");
      return new Response(pdfBytes, { headers: { "content-type":"application/pdf" } });
    }

    return new Response("Not Found", { status: 404 });
  }
};
