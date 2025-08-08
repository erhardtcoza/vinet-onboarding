// index.js — Vinet Onboarding Worker (targeted fixes)
// - EFT page: only "Print banking details", bold REF
// - Debit order: shows DEBIT TERMS + large checkbox
// - Personal info: Full name + ID/Passport + Email + Phone + Street + City + ZIP
// - Upload docs step restored (2 files, <=5MB each)
// - Service agreement renamed, big checkbox required + signature
// - Generate PDFs on sign; upload to R2: agreements/<linkid>/msa.pdf (+ do.pdf if debit)
// - Finish page shows download buttons
// - Admin: nicer Generate link output; review shows agreement links

// ---------- CONSTANTS ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const TERMS_SERVICE_URL_DEFAULT = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_URL_DEFAULT   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
const TEMPLATE_MSA_URL_DEFAULT  = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const TEMPLATE_DO_URL_DEFAULT   = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";
const PUBLIC_R2_BASE_DEFAULT    = "https://onboarding-uploads.vinethosting.org";

const ALLOWED_IPS = [
  "160.226.128.0/20"
];

function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

// ---------- SMALL HELPERS ----------
const json = (o, s=200) => new Response(JSON.stringify(o), {status:s, headers:{"content-type":"application/json"}});
const html = (s, code=200) => new Response(s, {status:code, headers:{"content-type":"text/html; charset=utf-8"}});
const text = (s, code=200) => new Response(s, {status:code, headers:{"content-type":"text/plain; charset=utf-8"}});
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

async function fetchText(url) {
  try {
    const r = await fetch(url, { cf:{ cacheEverything:true, cacheTtl:300 }});
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

function escapeHTML(s="") {
  return String(s).replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
}

// ---------- SPLYNX HELPERS ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
    obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();

  if (Array.isArray(obj)) {
    for (const it of obj) { const m=pickPhone(it); if(m) return m; }
  } else if (typeof obj==="object") {
    for (const k of Object.keys(obj)) { const m=pickPhone(obj[k]); if(m) return m; }
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
  let cust=null, lead=null, contacts=null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id: id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city: src.city || "",
    street: src.street || "",
    zip: src.zip_code || src.zip || "",
    passport: src.passport || "", // Splynx "passport" field (ID/Passport)
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- ADMIN UI ----------
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--brand:#e2001a;}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#222;margin:0}
  .card{max-width:1100px;margin:40px auto;background:#fff;border-radius:20px;box-shadow:0 6px 28px rgba(0,0,0,.08);padding:24px 28px}
  .logo{display:block;margin:0 auto 10px;max-width:130px}
  h1{margin:10px 0 18px;color:var(--brand);font-size:34px}
  .tabs{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 22px}
  .tab{padding:10px 14px;border-radius:999px;border:2px solid var(--brand);color:var(--brand);cursor:pointer;user-select:none}
  .tab.active{background:var(--brand);color:#fff}
  .btn{background:var(--brand);color:#fff;border:0;border-radius:12px;padding:10px 18px;font-weight:600;cursor:pointer}
  .btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:12px;padding:9px 16px;font-weight:600;cursor:pointer}
  .field{margin:14px 0}
  input{width:100%;padding:12px 12px;border:1px solid #e5e6ea;border-radius:12px;font-size:16px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row>*{flex:1}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{padding:10px;border-bottom:1px solid #f0f2f5;text-align:left;font-size:14px}
  .help{font-size:12px;color:#666}
  .linkpill{display:inline-block;margin-top:8px;padding:8px 12px;border-radius:12px;background:#f7f7fb}
  .linkpill a{color:#222;text-decoration:none}
</style>
</head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Admin Dashboard</h1>

  <div class="tabs">
    <div class="tab active" data-tab="gen">1) Generate onboarding link</div>
    <div class="tab" data-tab="staff">2) Generate staff verification code</div>
    <div class="tab" data-tab="inprog">3) Pending (in progress)</div>
    <div class="tab" data-tab="pending">4) Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">5) Approved</div>
  </div>

  <div id="content"></div>
</div>
<script>
(function(){
  const content=document.getElementById('content');
  const tabs=[...document.querySelectorAll('.tab')];
  tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.getAttribute('data-tab'));});
  load('gen');

  function el(s){const d=document.createElement('div');d.innerHTML=s;return d}

  async function load(which){
    if(which==='gen'){
      content.innerHTML='';
      const v = el(
        '<div class="field"><label>Splynx Lead/Customer ID</label>'+
        '<div class="row"><input id="id" placeholder="e.g. 319"><button class="btn" id="go">Generate</button></div>'+
        '<div id="out" class="field"></div></div>'
      );
      v.querySelector('#go').onclick=async()=>{
        const id=(v.querySelector('#id').value||'').trim();
        const out=v.querySelector('#out');
        if(!id){out.textContent='Please enter an ID.';return}
        out.textContent='Working…';
        try{
          const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
          const d=await r.json();
          if(d.url){
            out.innerHTML='<div class="linkpill">Onboarding link: <a target="_blank" href="'+d.url+'">'+d.url+'</a></div>';
          }else out.textContent='Failed to generate link.';
        }catch{ out.textContent='Network error.'}
      };
      content.appendChild(v);
      return;
    }

    if(which==='staff'){
      content.innerHTML='';
      const v = el(
        '<div class="field"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label>'+
        '<div class="row"><input id="linkid"><button class="btn" id="go">Generate staff code</button></div>'+
        '<div id="out" class="help"></div></div>'
      );
      v.querySelector('#go').onclick=async()=>{
        const linkid=(v.querySelector('#linkid').value||'').trim();
        const out=v.querySelector('#out');
        if(!linkid){out.textContent='Enter linkid';return}
        out.textContent='Working…';
        try{
          const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
          const d=await r.json();
          out.innerHTML=d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error||'Failed.');
        }catch{out.textContent='Network error.'}
      };
      content.appendChild(v);
      return;
    }

    if(['inprog','pending','approved'].includes(which)){
      content.innerHTML='Loading…';
      try{
        const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
        const rows=(d.items||[]).map(i=>{
          const open=which==='pending'
            ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
            : '<a class="btn-outline" target="_blank" href="/onboard/'+i.linkid+'">Open</a>';
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+open+'</td></tr>';
        }).join('') || '<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
      }catch{content.textContent='Failed to load.'}
      return;
    }
  }
})();
</script>
</body></html>`;
}

// ---------- ONSITE PAGES (EFT / DEBIT) ----------
async function renderEFTPage(id) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EFT Payment Details</title>
<style>
  :root{--brand:#e2001a}
  body{font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;background:#f7f7fa;margin:0}
  .card{max-width:980px;margin:32px auto;background:#fff;border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.08);padding:22px 26px}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  .row>*{flex:1}
  label{display:block;font-weight:600;margin:10px 0 6px}
  input{width:100%;padding:12px;border:1px solid #e5e6ea;border-radius:12px;background:#fafbfc}
  .logo{display:block;margin:0 auto 14px;max-height:68px}
  h1{color:var(--brand)}
  .btn{display:block;margin:16px auto 0;background:var(--brand);color:#fff;border:0;border-radius:12px;padding:12px 18px;font-weight:600;cursor:pointer;min-width:220px}
  .note{font-size:13px;color:#666;margin-top:8px}
  .ref{font-weight:800;color:#111}
</style>
</head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="row">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
  </div>
  <div class="row">
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
  </div>
  <div><label>Reference <span class="ref">(use this reference)</span></label><input class="ref" readonly value="${escapeHTML(id||'')}"></div>
  <div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>
  <button class="btn" onclick="window.print()">Print banking details</button>
</div>
</body></html>`;
}

async function renderDebitPage(id, env) {
  const terms = await fetchText(env.TERMS_DEBIT_URL || TERMS_DEBIT_URL_DEFAULT);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Debit Order Instruction</title>
<style>
  :root{--brand:#e2001a}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f7f7fa;margin:0}
  .card{max-width:980px;margin:32px auto;background:#fff;border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.08);padding:22px 26px}
  .row{display:flex;gap:14px;flex-wrap:wrap}.row>*{flex:1}
  label{display:block;font-weight:600;margin:10px 0 6px}
  input,select{width:100%;padding:12px;border:1px solid #e5e6ea;border-radius:12px;background:#fafbfc}
  .logo{display:block;margin:0 auto 14px;max-height:68px}
  h1{color:var(--brand)}
  .btn{background:var(--brand);color:#fff;border:0;border-radius:12px;padding:12px 18px;font-weight:600;cursor:pointer}
  .btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:12px;padding:10px 16px;font-weight:600;cursor:pointer}
  .terms{border:1px solid #e5e6ea;border-radius:12px;background:#fafbfc;padding:12px;max-height:240px;overflow:auto;margin:10px 0}
  .chk{transform:scale(1.35);margin-right:8px}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Debit Order Instruction</h1>
  <form method="POST" action="/api/debit/save" id="f">
    <input type="hidden" name="splynx_id" value="${escapeHTML(id||'')}">
    <div class="row">
      <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
      <div><label>Bank Account Holder ID No</label><input name="id_number" required></div>
    </div>
    <div class="row">
      <div><label>Bank</label><input name="bank_name" required></div>
      <div><label>Bank Account No</label><input name="account_number" required></div>
    </div>
    <div class="row">
      <div><label>Bank Account Type</label>
        <select name="account_type">
          <option value="cheque">Cheque / Current</option>
          <option value="savings">Savings</option>
          <option value="transmission">Transmission</option>
        </select>
      </div>
      <div><label>Debit Order Date</label>
        <select name="debit_day">
          <option>1</option><option>7</option><option>15</option><option>25</option><option>29</option><option>30</option>
        </select>
      </div>
    </div>

    <div class="terms" id="terms">${terms ? escapeHTML(terms) : "Terms unavailable."}</div>
    <div style="margin:10px 0"><label><input class="chk" type="checkbox" name="agree" required> I agree to the Debit Order terms</label></div>

    <div class="row">
      <div><button type="button" class="btn-outline" onclick="location.href='/info/eft?id=${encodeURIComponent(id||'')}'">Prefer EFT?</button></div>
      <div style="flex:0 0 auto"><button class="btn" type="submit">Submit</button></div>
    </div>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = Object.fromEntries(form.entries());
  try {
    const r = await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const d = await r.json();
    if(d.ok){ alert('Saved. We will include this with your onboarding.'); location.href='/'; }
    else alert(d.error || 'Failed');
  } catch { alert('Network error'); }
});
</script>
</body></html>`;
}

// ---------- ONBOARDING APP ----------
function onboardHTML(linkid, env) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--brand:#e2001a}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#222;margin:0}
  .card{max-width:760px;margin:26px auto;background:#fff;border-radius:20px;box-shadow:0 6px 28px rgba(0,0,0,.08);padding:22px 26px}
  .logo{display:block;margin:0 auto 8px;max-height:78px}
  .progressbar{height:8px;background:#eceef1;border-radius:8px;margin:8px 0 22px;overflow:hidden}
  .progress{height:100%;background:var(--brand);width:16%}
  h2{color:var(--brand);margin:12px 0 10px}
  label{display:block;font-weight:600;margin:10px 0 6px}
  input,select,textarea{width:100%;padding:12px;border:1px solid #e5e6ea;border-radius:12px;background:#fafbfc;font-size:16px}
  .row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1}
  .pillwrap{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0 4px}
  .pill{border:2px solid var(--brand);border-radius:999px;padding:10px 16px;color:var(--brand);cursor:pointer}
  .pill.active{background:var(--brand);color:#fff}
  .btn{background:var(--brand);color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:700;cursor:pointer}
  .btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:12px;padding:10px 16px;font-weight:700;cursor:pointer}
  .help{font-size:13px;color:#666}
  .terms{border:1px solid #e5e6ea;border-radius:12px;background:#fafbfc;padding:12px;max-height:260px;overflow:auto}
  .chk{transform:scale(1.4);margin-right:9px}
  canvas.signature{border:1px dashed #bdbdbd;border-radius:12px;width:100%;height:200px;touch-action:none;background:#fff}
  .center{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const publicBase = ${JSON.stringify(env.PUBLIC_R2_BASE || PUBLIC_R2_BASE_DEFAULT)};
  const svcTermsURL = ${JSON.stringify(env.TERMS_SERVICE_URL || TERMS_SERVICE_URL_DEFAULT)};
  const debitTermsURL = ${JSON.stringify(env.TERMS_DEBIT_URL || TERMS_DEBIT_URL_DEFAULT)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step=0;
  const state = { pay_method:'eft', edits:{}, uploads:[], otp_verified:false, debit:null, msa:{accepted:false}, links:{} };

  function setProg(){ progEl.style.width = Math.min(100, (step+1)/7*100) + '%'; }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{}); }

  // --- utilities ---
  function node(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }
  function bigChkHtml(id, text){ return '<label><input class="chk" id="'+id+'" type="checkbox"> '+text+'</label>'; }

  async function sendWA(){
    const m=document.getElementById('otpmsg');
    if(m) m.textContent='Code sent. Check WhatsApp.';
    try { await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})}); } catch {}
  }

  function sigPad(canvas){
    const ctx = canvas.getContext('2d');
    let drawing=false,last=null;
    function scale(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=r.width*s; canvas.height=r.height*s; ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    scale(); window.addEventListener('resize',scale);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ drawing=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  // --- steps ---
  function s0(){
    stepEl.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; setProg(); save(); s1(); };
  }

  function s1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pillwrap"><span class="pill active" id="wa">WhatsApp OTP</span><span class="pill" id="staff">I have a staff code</span></div>',
      '<div id="waBox" class="field"></div>',
      '<div id="staffBox" class="field" style="display:none"></div>'
    ].join('');
    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="help"></div><div class="row"><input id="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code"><button class="btn" id="v">Verify</button></div><div style="margin-top:10px"><button class="btn-outline" id="res">Resend code</button></div>';
    document.getElementById('res').onclick=e=>{e.preventDefault();sendWA()};
    document.getElementById('v').onclick=async()=>{
      const otp=(document.getElementById('otp').value||'').trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'wa'})}); const d=await r.json();
      if(d.ok){ state.otp_verified=true; step=2; setProg(); save(); s2(); } else document.getElementById('otpmsg').textContent='Invalid code.';
    };
    sendWA();

    const sb=document.getElementById('staffBox');
    sb.innerHTML='<div class="help">Ask Vinet for a one-time staff code.</div><div class="row"><input id="sc" maxlength="6" placeholder="6-digit code from Vinet"><button class="btn" id="sv">Verify</button></div>';
    document.getElementById('sv').onclick=async()=>{
      const otp=(document.getElementById('sc').value||'').trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'staff'})}); const d=await r.json();
      if(d.ok){ state.otp_verified=true; step=2; setProg(); save(); s2(); }
    };

    const pwa=document.getElementById('wa'), pst=document.getElementById('staff');
    pwa.onclick=()=>{pwa.classList.add('active');pst.classList.remove('active');wa.style.display='block';sb.style.display='none'};
    pst.onclick=()=>{pst.classList.add('active');pwa.classList.remove('active');wa.style.display='none';sb.style.display='block'};
  }

  function s2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="pillwrap"><span id="pEft" class="pill '+(pay==='eft'?'active':'')+'">EFT</span><span id="pDo" class="pill '+(pay==='debit'?'active':'')+'">Debit order</span></div>',
      '<div id="box"></div>',
      '<div class="center" style="margin-top:10px"><button class="btn-outline" id="back">Back</button><button class="btn" id="next">Continue</button></div>'
    ].join('');

    function renderEFT(){
      document.getElementById('box').innerHTML = [
        '<div class="row"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div></div>',
        '<div class="row"><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div></div>',
        '<div><label>Reference <b>(use this reference)</b></label><input readonly value="'+(linkid.split("_")[0])+'"></div>',
        '<div class="help">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div class="center" style="margin-top:10px"><a class="btn-outline" target="_blank" href="/info/eft?id='+(linkid.split("_")[0])+ '">Print banking details</a></div>'
      ].join('');
    }

    function renderDebit(){
      const d=state.debit||{};
      document.getElementById('box').innerHTML = [
        '<div class="row"><div><label>Bank Account Holder Name</label><input id="d_h" value="'+(d.account_holder||'')+'"></div><div><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'"></div></div>',
        '<div class="row"><div><label>Bank</label><input id="d_b" value="'+(d.bank_name||'')+'"></div><div><label>Bank Account No</label><input id="d_n" value="'+(d.account_number||'')+'"></div></div>',
        '<div class="row"><div><label>Bank Account Type</label><select id="d_t"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div><div><label>Debit Order Date</label><select id="d_day">'+[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+'>'+x+'</option>').join('')+'</select></div></div>',
        '<div class="terms" id="debitTerms">Loading terms…</div>',
        '${""}'
      ].join('');
      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; }})();
      // Big checkbox appended (inside page for consistent placement)
      const chk = document.createElement('div');
      chk.innerHTML = ${JSON.stringify(bigChkHtml('agreeDo','I agree to the Debit Order terms'))};
      document.getElementById('box').appendChild(chk);
      document.getElementById('agreeDo').checked = !!(state.debit && state.debit.agree);
    }

    if(pay==='eft') renderEFT(); else renderDebit();
    document.getElementById('pEft').onclick=()=>{state.pay_method='eft'; renderEFT(); save()};
    document.getElementById('pDo').onclick=()=>{state.pay_method='debit'; renderDebit(); save()};
    document.getElementById('back').onclick=()=>{ step=1; setProg(); save(); s1(); };
    document.getElementById('next').onclick=async()=>{
      if(state.pay_method==='debit'){
        const d={
          account_holder: document.getElementById('d_h').value.trim(),
          id_number: document.getElementById('d_id').value.trim(),
          bank_name: document.getElementById('d_b').value.trim(),
          account_number: document.getElementById('d_n').value.trim(),
          account_type: document.getElementById('d_t').value,
          debit_day: document.getElementById('d_day').value,
          agree: document.getElementById('agreeDo').checked
        };
        if(!d.account_holder || !d.id_number || !d.bank_name || !d.account_number || !d.agree){
          alert('Please complete debit order details and accept the terms.'); return;
        }
        state.debit = d;
        try {
          await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...d,splynx_id:linkid.split("_")[0]})});
        }catch{}
      }
      step=3; setProg(); save(); s3();
    };
  }

  function s3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="help">Loading…</div>';
    (async()=>{
      try{
        const id = linkid.split('_')[0];
        const r = await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p = await r.json();
        const curr = {
          full_name: state.edits.full_name ?? p.full_name ?? '',
          id:        state.edits.id ?? p.passport ?? '',
          email:     state.edits.email ?? p.email ?? '',
          phone:     state.edits.phone ?? p.phone ?? '',
          street:    state.edits.street ?? p.street ?? '',
          city:      state.edits.city ?? p.city ?? '',
          zip:       state.edits.zip ?? p.zip ?? ''
        };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div><label>Full name</label><input id="f_full" value="'+(curr.full_name||'')+'"></div><div><label>ID / Passport</label><input id="f_id" value="'+(curr.id||'')+'"></div></div>',
          '<div class="row"><div><label>Email</label><input id="f_email" value="'+(curr.email||'')+'"></div><div><label>Phone</label><input id="f_phone" value="'+(curr.phone||'')+'"></div></div>',
          '<div class="row"><div><label>Street</label><input id="f_street" value="'+(curr.street||'')+'"></div><div><label>City</label><input id="f_city" value="'+(curr.city||'')+'"></div></div>',
          '<div><label>ZIP Code</label><input id="f_zip" value="'+(curr.zip||'')+'"></div>',
          '<div class="center" style="margin-top:10px"><button class="btn-outline" id="back">Back</button><button class="btn" id="next">Continue</button></div>'
        ].join('');
        document.getElementById('back').onclick=()=>{ step=2; setProg(); save(); s2(); };
        document.getElementById('next').onclick=()=>{ 
          state.edits = {
            full_name:document.getElementById('f_full').value.trim(),
            id:document.getElementById('f_id').value.trim(),
            email:document.getElementById('f_email').value.trim(),
            phone:document.getElementById('f_phone').value.trim(),
            street:document.getElementById('f_street').value.trim(),
            city:document.getElementById('f_city').value.trim(),
            zip:document.getElementById('f_zip').value.trim()
          };
          step=4; setProg(); save(); s4();
        };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function s4(){
    stepEl.innerHTML = [
      '<h2>Upload documents</h2>',
      '<p class="help">Please upload your supporting documents.<br>ID or Passport and Proof of Address (as per RICA regulations). Max 2 files, 5 MB each.</p>',
      '<input id="u1" type="file" accept=".pdf,image/*" />',
      '<div style="height:8px"></div>',
      '<input id="u2" type="file" accept=".pdf,image/*" />',
      '<div class="center" style="margin-top:12px"><button class="btn-outline" id="back">Back</button><button class="btn" id="next">Continue</button></div>'
    ].join('');
    document.getElementById('back').onclick=()=>{ step=3; setProg(); save(); s3(); };
    document.getElementById('next').onclick=async()=>{
      async function up(f){
        if(!f) return null;
        if(f.size>5*1024*1024){ alert(f.name+': file too large (max 5MB)'); return null; }
        const buf = await f.arrayBuffer();
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(f.name), {method:'POST', body:buf});
        const d = await r.json().catch(()=>({}));
        if(d.ok){
          state.uploads.push({name:f.name,size:f.size,key:d.key});
          return d.key;
        }
        return null;
      }
      await up(document.getElementById('u1').files[0]);
      await up(document.getElementById('u2').files[0]);
      step=5; setProg(); save(); s5();
    };
  }

  function s5(){
    stepEl.innerHTML = [
      '<h2>Vinet Service Agreement</h2>',
      '<div id="terms" class="terms">Loading terms…</div>',
      '<div style="margin:12px 0">'+ ${JSON.stringify(bigChkHtml('agreeSvc','I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.'))} +'</div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="center"><button class="btn-outline" id="clr">Clear</button></div></div>',
      '<div class="center"><button class="btn-outline" id="back">Back</button><button class="btn" id="sign">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?pay='+encodeURIComponent('eft')); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clr').onclick=(e)=>{e.preventDefault();pad.clear()};
    document.getElementById('back').onclick=()=>{ step=4; setProg(); save(); s4(); };
    document.getElementById('sign').onclick=async()=>{
      if(!document.getElementById('agreeSvc').checked){ alert('Please confirm the agreement statement.'); return; }
      const sig = pad.dataURL();
      const payload = {
        linkid,
        dataUrl: sig,
        info: {
          ...state.edits,
          pay_method: state.pay_method,
          debit: state.debit || null,
          uploads: state.uploads || []
        }
      };
      const r = await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const d = await r.json().catch(()=>({}));
      if(d.ok){
        state.links = d.links || {};
        state.msa.accepted = true;
        step=6; setProg(); save(); s6();
      }else{
        alert(d.error || 'Failed to save signature.');
      }
    };
  }

  function s6(){
    const msa = state.links && state.links.msa;
    const dlink = state.links && state.links.do;
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      (msa||dlink ? '<div class="center" style="margin-top:10px">'+
       (msa ? '<a class="btn-outline" target="_blank" href="'+msa+'">Download Service Agreement (PDF)</a>' : '')+
       (dlink ? '<a class="btn-outline" target="_blank" href="'+dlink+'">Download Debit Order (PDF)</a>' : '')+
       '</div>' : '')
    ].join('');
  }

  // start
  setProg(); s0();
})();
</script>
</body></html>`;
}

// ---------- PDF GENERATION ----------
async function generatePDFs(env, linkid, info, signaturePngBytes) {
  // Try template first; else fallback to generated PDFs
  const publicBase = env.PUBLIC_R2_BASE || PUBLIC_R2_BASE_DEFAULT;
  const msaKey = `agreements/${linkid}/msa.pdf`;
  const doKey  = `agreements/${linkid}/do.pdf`;

  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  async function tryTemplate(url, fillFn) {
    try{
      const r = await fetch(url);
      if(!r.ok) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      const pdf = await PDFDocument.load(bytes);
      const form = pdf.getForm();
      try { await fillFn(pdf, form); form.flatten(); } catch {}
      return await pdf.save();
    }catch{ return null; }
  }

  function sastNow() {
    // South Africa is UTC+2 without DST
    const d = new Date(Date.now() + 2*3600*1000);
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} SAST`;
  }

  async function buildSimple(name, title, extraLines=[]) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    let y = height - 64;
    page.drawText("Vinet Internet Solutions (Pty) Ltd", { x:64, y, size:14, font });
    y -= 22;
    page.drawText(title, { x:64, y, size:18, font, color:rgb(0.89,0,0.10) });
    y -= 28;

    const lines = [
      `Customer: ${name || ""}`,
      `ID/Passport: ${info.id || ""}`,
      `Email: ${info.email || ""}`,
      `Phone: ${info.phone || ""}`,
      `Street: ${info.street || ""}`,
      `City: ${info.city || ""}`,
      `ZIP: ${info.zip || ""}`,
      `Splynx ID: ${linkid.split("_")[0]}`,
      `Signed at: ${sastNow()}`,
      `IP: ${info.ip || ""}`,
      `Device: ${info.ua || ""}`,
      ...extraLines
    ];
    for(const L of lines){
      page.drawText(String(L), { x:64, y, size:11, font }); y -= 16;
    }
    y -= 20;
    if(signaturePngBytes){
      const png = await pdf.embedPng(signaturePngBytes);
      const sw = 260, sh = sw * (png.height/png.width);
      page.drawText("Signature:", { x:64, y, size:12, font }); y -= (sh+8);
      page.drawImage(png, { x:64, y, width:sw, height:sh });
    }
    return await pdf.save();
  }

  // MSA
  let msaBytes =
    await tryTemplate(env.TEMPLATE_MSA_URL || TEMPLATE_MSA_URL_DEFAULT,
      async (pdf, form) => {
        const map = {
          full_name: info.full_name,
          name: info.full_name,
          customer_name: info.full_name,
          id_number: info.id,
          passport: info.id,
          customer_id: linkid.split("_")[0],
          date: new Date().toLocaleDateString("en-ZA")
        };
        for(const [k,v] of Object.entries(map)){
          try{ form.getTextField(k).setText(String(v||"")); }catch{}
        }
        // Put signature image somewhere reasonable (bottom of last page)
        if(signaturePngBytes){
          const pages = pdf.getPages();
          const last = pages[pages.length-1];
          const png = await pdf.embedPng(signaturePngBytes);
          const sw = 180, sh = sw*(png.height/png.width);
          last.drawImage(png, { x:64, y:100, width:sw, height:sh });
        }
      }
    );

  if(!msaBytes){
    msaBytes = await buildSimple(info.full_name, "Vinet Service Agreement");
  }

  // DO (if debit)
  let doBytes = null;
  if(info.pay_method === "debit" && info.debit){
    doBytes =
      await tryTemplate(env.TEMPLATE_DO_URL || TEMPLATE_DO_URL_DEFAULT,
        async (pdf, form) => {
          const map = {
            account_holder: info.debit.account_holder,
            id_number: info.debit.id_number,
            bank_name: info.debit.bank_name,
            account_number: info.debit.account_number,
            account_type: info.debit.account_type,
            debit_day: String(info.debit.debit_day||""),
            date: new Date().toLocaleDateString("en-ZA")
          };
          for(const [k,v] of Object.entries(map)){
            try{ form.getTextField(k).setText(String(v||"")); }catch{}
          }
          if(signaturePngBytes){
            const pages = pdf.getPages();
            const last = pages[pages.length-1];
            const png = await pdf.embedPng(signaturePngBytes);
            const sw = 180, sh = sw*(png.height/png.width);
            last.drawImage(png, { x:64, y:120, width:sw, height:sh });
          }
        }
      );
    if(!doBytes){
      const extra = [
        `Debit Day: ${info.debit.debit_day||""}`,
        `Bank: ${info.debit.bank_name||""}`,
        `Account No: ${info.debit.account_number||""}`,
        `Type: ${info.debit.account_type||""}`
      ];
      doBytes = await buildSimple(info.full_name, "Debit Order Instruction", extra);
    }
  }

  // Upload to R2
  const uploads = {};
  if(msaBytes){
    await env.R2_UPLOADS.put(msaKey, msaBytes, { httpMetadata:{ contentType:"application/pdf" } });
    uploads.msa = `${publicBase}/${msaKey}`;
  }
  if(doBytes){
    await env.R2_UPLOADS.put(doKey, doBytes, { httpMetadata:{ contentType:"application/pdf" } });
    uploads.do = `${publicBase}/${doKey}`;
  }
  return uploads;
}

// ---------- WORKER ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Home (admin)
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      return html(renderAdminPage());
    }
    if (path === "/static/admin.js" && method === "GET") {
      return text("// moved inline", 200);
    }

    // Info pages
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return html(await renderEFTPage(id));
    }
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return html(await renderDebitPage(id, env));
    }

    // Terms endpoint (service + optional debit)
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay")||"eft").toLowerCase();
      const svc = await fetchText(env.TERMS_SERVICE_URL || TERMS_SERVICE_URL_DEFAULT);
      const deb = pay === "debit" ? await fetchText(env.TERMS_DEBIT_URL || TERMS_DEBIT_URL_DEFAULT) : "";
      const body = '<h3>Service Terms</h3><pre style="white-space:pre-wrap">'+escapeHTML(svc)+'</pre>' +
                   (deb ? '<hr><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">'+escapeHTML(deb)+'</pre>' : '');
      return html(body || "<p>Terms unavailable.</p>");
    }

    // Onboarding shell
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Link expired or invalid", 404);
      return html(onboardHTML(linkid, env));
    }

    // Admin: generate link
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Admin list
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix:"onboard/" });
      const items=[];
      for(const k of list.keys){
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if(!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode==="inprog"   && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode==="pending"  && s.status==="pending") items.push({ linkid, id:s.id, updated });
        if (mode==="approved" && s.status==="approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // Admin review
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Not found", 404);
      const publicBase = env.PUBLIC_R2_BASE || PUBLIC_R2_BASE_DEFAULT;
      const msaUrl = `${publicBase}/agreements/${linkid}/msa.pdf`;
      const doUrl  = `${publicBase}/agreements/${linkid}/do.pdf`;
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      return html(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Review</title>
<style>
  :root{--brand:#e2001a}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#222;margin:0}
  .card{max-width:900px;margin:26px auto;background:#fff;border-radius:20px;box-shadow:0 6px 28px rgba(0,0,0,.08);padding:22px 26px}
  h1{color:var(--brand)}
  .btn{background:var(--brand);color:#fff;border:0;border-radius:12px;padding:10px 16px;font-weight:700;cursor:pointer}
  .btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:12px;padding:10px 16px;font-weight:700;cursor:pointer}
  .help{color:#666;font-size:13px}
  .list li{margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:10px}
</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="help">LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'n/a'}</b></div>
  <h3>Agreement files</h3>
  <div>
    <a class="btn-outline" target="_blank" href="${msaUrl}">Service Agreement (PDF)</a>
    <a class="btn-outline" target="_blank" href="${doUrl}">Debit Order (PDF)</a>
  </div>
  <h3 style="margin-top:16px">Uploads</h3>
  <ul class="list">${uploads.map(u=>`<li>${u.name} — ${Math.round((u.size||0)/1024)} KB</li>`).join("") || "<div class='help'>No files</div>"}</ul>
  <div style="margin-top:16px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="help" style="margin-top:8px"></div>
</div>
<script>
  const msg = document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{
    msg.textContent='Pushing…';
    try{
      const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d=await r.json(); msg.textContent=d.ok?'Approved.':'Failed: '+(d.error||'');
    }catch{ msg.textContent='Network error.'}
  };
  document.getElementById('reject').onclick=async()=>{
    const reason=prompt('Reason?')||''; msg.textContent='Rejecting…';
    try{
      const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
      const d=await r.json(); msg.textContent=d.ok?'Rejected.':'Failed: '+(d.error||'');
    }catch{ msg.textContent='Network error.'}
  };
</script>
</body></html>`);
    }

    // Staff code
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, code });
    }

    // WhatsApp OTP send/verify
    async function sendWhatsAppTemplate(env, toMsisdn, code) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "template",
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
          language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [
            { type: "body", parameters: [{ type:"text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type:"text", text: code }] }
          ]
        }
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if(!r.ok) throw new Error("WA template send failed "+r.status);
    }

    async function sendWhatsAppText(env, toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product: "whatsapp", to: toMsisdn, type:"text", text:{ body: bodyText } };
      const r = await fetch(endpoint, {
        method:"POST",
        headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      if(!r.ok) throw new Error("WA text send failed "+r.status);
    }

    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid||"").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return json({ ok:false, error:"Lookup failed" }, 502); }
      if(!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try { await sendWhatsAppTemplate(env, msisdn, code); }
      catch { try { await sendWhatsAppText(env, msisdn, `Your Vinet verification code is: ${code}`); } catch { return json({ ok:false, error:"WhatsApp send failed" }, 502); } }
      return json({ ok:true });
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === String(otp);
      if(ok){
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || {};
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true, last_time:Date.now() }), { expirationTtl: 86400 });
        if(kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Progress save
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=>({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_time: Date.now(), id: existing.id || (linkid||"").split("_")[0] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Debit save (from inline or /info/debit)
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const need = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for(const k of need) if(!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id||"").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, created:ts }), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref:key });
    }

    // File uploads
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid");
      const filename = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Invalid link", 404);
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 5*1024*1024) return text("Too large", 413);
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, buf);
      const next = { ...sess, uploads:[...(sess.uploads||[]), { name:filename, size:buf.byteLength, key }], last_time:Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl:86400 });
      return json({ ok:true, key });
    }

    // Signature => generate PDFs now
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl, info } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, png.buffer, { httpMetadata:{ contentType:"image/png" } });

      const ip = request.headers.get("CF-Connecting-IP") || "";
      const ua = request.headers.get("User-Agent") || "";
      const links = await generatePDFs(env, linkid, { ...(info||{}), ip, ua }, png);

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || {};
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        ...sess,
        agreement_signed:true,
        agreement_sig_key:sigKey,
        status:"pending",
        links,
        last_time: Date.now()
      }), { expirationTtl:86400 });

      return json({ ok:true, links });
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if(!id) return json({ error:"Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env,id); return json(prof); }
      catch { return json({ error:"Lookup failed" }, 502); }
    }

    // Admin approve/reject (stub for now: only sets status)
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid } = await request.json().catch(()=>({}));
      if(!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if(!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid, reason } = await request.json().catch(()=>({}));
      if(!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if(!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    return text("Not found", 404);
  }
};