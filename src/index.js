// --- Vinet Onboarding Worker (Updated) ---
// Admin dashboard, onboarding flow, EFT & Debit Order pages, WhatsApp OTP

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const TERMS_SERVICE_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_URL   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
const R2_PUBLIC_BASE    = "https://onboarding-uploads.vinethosting.org";

// ====== IP allow-list (admin) ======
const ALLOWED_IPS = ["160.226.128.0/20"]; // 160.226.128.0 - 160.226.143.255

function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

// ====== Utilities ======
function json(o, s=200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" }
  });
}
function getIP(req) {
  return req.headers.get("CF-Connecting-IP")
      || req.headers.get("x-forwarded-for")
      || req.headers.get("x-real-ip")
      || "";
}
function getUA(req) { return req.headers.get("user-agent") || ""; }

async function fetchText(url) {
  try { const r = await fetch(url); return r.ok ? await r.text() : ""; }
  catch { return ""; }
}

// ====== Splynx helpers ======
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
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
  return r.json().catch(()=>({}));
}

// pick 27xxxxxxxxx from messy objects
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
    obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();

  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; }
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
    street: src.street || "", // ensure street is included
    zip: src.zip_code || src.zip || "",
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ====== Admin page (/) ======
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { --brand:#e2001a; }
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
  .card { background:#fff; max-width:1100px; margin:2.0em auto; border-radius:1.25em;
          box-shadow:0 2px 12px #0002; padding:1.4em 1.6em; }
  .logo { display:block; margin:0 auto 1em; max-width:150px; height:auto; }
  h1, h2 { color: var(--brand); text-align:center; }
  .menu { display:flex; flex-direction:column; gap:14px; align-items:center; margin: 1em 0 1.4em; }
  .row { display:flex; gap:.6em; flex-wrap:wrap; justify-content:center; }
  .tabbtn { padding:.65em 1.2em; border-radius:.8em; border:2px solid var(--brand);
            color:var(--brand); background:#fff; cursor:pointer; min-width:220px; text-align:center; }
  .tabbtn.active { background: var(--brand); color:#fff; }
  .btn { background: var(--brand); color:#fff; border:0; border-radius:.7em; padding:.55em 1.0em; font-size:1em; cursor:pointer; }
  .btn-secondary { background:#eee; color:#222; border:0; border-radius:.7em; padding:.5em 1.0em; text-decoration:none; display:inline-block; }
  .field { margin:.9em 0; }
  input, select { width:100%; padding:.6em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
  table { width:100%; border-collapse: collapse; }
  th, td { padding:.6em .5em; border-bottom:1px solid #eee; text-align:left; }
  @media (max-width: 720px) {
    .card { padding: 1em; }
    .tabbtn { min-width: 45%; }
    table { display:block; overflow-x:auto; white-space:nowrap; }
  }
</style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
    <h1>Admin Dashboard</h1>
    <div class="menu">
      <div class="row">
        <div class="tabbtn active" data-tab="gen">1) Generate onboarding link</div>
        <div class="tabbtn" data-tab="staff">2) Generate staff verification code</div>
      </div>
      <div class="row">
        <div class="tabbtn" data-tab="inprog">3) Pending (in progress)</div>
        <div class="tabbtn" data-tab="pending">4) Completed (awaiting approval)</div>
        <div class="tabbtn" data-tab="approved">5) Approved</div>
      </div>
    </div>
    <div id="content"></div>
  </div>
  <script src="/static/admin.js"></script>
</body></html>`;
}

function adminJs() {
  return `(()=> {
    const tabs = document.querySelectorAll('[data-tab]');
    const content = document.getElementById('content');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      load(t.getAttribute('data-tab'));
    });
    load('gen');

    function node(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }

    async function load(which){
      if (which==='gen') {
        content.innerHTML = '';
        const v = node(
          '<div class="field" style="max-width:540px;margin:0 auto;">'+
          '<label>Splynx Lead/Customer ID</label>'+
          '<div style="display:flex; gap:.6em;"><input id="id" autocomplete="off" style="flex:1" />'+
          '<button class="btn" id="go">Generate</button></div></div>'+
          '<div id="out" class="field" style="text-align:center;"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const id = v.querySelector('#id').value.trim();
          const out = v.querySelector('#out');
          if (!id) { out.textContent = 'Please enter an ID.'; return; }
          out.textContent = 'Working...';
          try {
            const r = await fetch('/api/admin/genlink', {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ id })
            });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.url
              ? '<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'
              : 'Error generating link.';
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (which==='staff') {
        content.innerHTML='';
        const v = node(
          '<div class="field" style="max-width:540px;margin:0 auto;">'+
          '<label>Onboarding Link ID (e.g. 319_ab12cd34)</label>'+
          '<div style="display:flex; gap:.6em;"><input id="linkid" autocomplete="off" style="flex:1" />'+
          '<button class="btn" id="go">Generate staff code</button></div></div>'+
          '<div id="out" class="field note" style="text-align:center;"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const linkid = v.querySelector('#linkid').value.trim();
          const out = v.querySelector('#out');
          if (!linkid) { out.textContent='Enter linkid'; return; }
          out.textContent='Working...';
          try {
            const r = await fetch('/api/staff/gen', { method:'POST', body: JSON.stringify({ linkid }) });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error || 'Failed');
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML = 'Loading...';
        try {
          const r = await fetch('/api/admin/list?mode='+which);
          const d = await r.json();
          const rows = (d.items||[]).map(i =>
            '<tr>'+
              '<td>'+i.id+'</td>'+
              '<td>'+i.linkid+'</td>'+
              '<td>'+new Date(i.updated).toLocaleString()+'</td>'+
              '<td>'+(which==='pending'
                 ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
                 : '<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+
              '</td></tr>'
          ).join('') || '<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML = '<div style="overflow-x:auto"><table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
        } catch {
          content.innerHTML = 'Failed to load.';
        }
        return;
      }
    }
  })();`;
}

// ====== EFT info page (/info/eft) ======
async function renderEFTPage(id) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body { font-family: Arial, sans-serif; background: #f7f7fa; }
.container { max-width: 760px; margin: 28px auto; background: #fff; padding: 22px; border-radius: 12px; }
h1 { color: #e2001a; }
.grid { display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
.grid .item { background:#fafafa; border:1px solid #e9e9e9; border-radius:10px; padding:12px 14px; }
.label { font-weight:600; color:#555; font-size:14px; }
.value { font-size:16px; margin-top:4px; }
@media (max-width: 640px) { .grid{ grid-template-columns: 1fr; } .container{ padding:16px; } }
.btn { background:#e2001a; color:#fff; border:0; border-radius:8px; padding:10px 16px; cursor:pointer; }
.note { font-size: 13px; color: #555; margin-top: 10px; }
.logo { display:block; max-width:150px; height:auto; }
</style></head><body>
<div class="container">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div class="item"><div class="label">Bank</div><div class="value">First National Bank (FNB)</div></div>
    <div class="item"><div class="label">Account Name</div><div class="value">Vinet Internet Solutions</div></div>
    <div class="item"><div class="label">Account Number</div><div class="value">62757054996</div></div>
    <div class="item"><div class="label">Branch Code</div><div class="value">250655</div></div>
    <div class="item"><div class="label">Reference</div><div class="value">${id || ""}</div></div>
  </div>
  <p class="note">Please remember all accounts are payable before the 1st of each month.</p>
  <button class="btn" onclick="window.print()">Print</button>
</div>
</body></html>`;
}

// ====== Debit info page (/info/debit) ======
async function renderDebitPage(id) {
  const terms = await fetchText(TERMS_DEBIT_URL);
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Debit Order Instruction</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body { font-family: Arial, sans-serif; background: #f7f7fa; }
.container { max-width: 820px; margin: 28px auto; background: #fff; padding: 22px; border-radius: 12px; }
h1 { color: #e2001a; }
.row { display:flex; gap:12px; }
.row > .col { flex:1; }
label { font-weight: 600; margin-top: 10px; display:block; }
input, select { width: 100%; padding: 9px; margin: 4px 0 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 16px; }
.terms { max-height: 250px; overflow-y: auto; background: #fafafa; padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 14px; white-space:pre-wrap; }
.btn { background:#e2001a; color:#fff; border:0; border-radius:8px; padding:10px 16px; cursor:pointer; }
.btn2 { background:#777; color:#fff; border:0; border-radius:8px; padding:10px 16px; cursor:pointer; }
.cb { transform: scale(1.3); margin-right:8px; vertical-align: middle; }
.logo { display:block; max-width:150px; height:auto; }
@media (max-width: 720px) { .row { flex-direction: column; } .container{ padding:16px; } }
</style></head><body>
<div class="container">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1>Debit Order Instruction</h1>
  <form method="POST" action="/submit-debit">
    <input type="hidden" name="client_id" value="${id || ''}">
    <div class="row">
      <div class="col">
        <label>Account Holder Name</label>
        <input name="account_holder" required>
      </div>
      <div class="col">
        <label>Account Holder ID No</label>
        <input name="id_number" required>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Bank</label>
        <input name="bank" required>
      </div>
      <div class="col">
        <label>Account Number</label>
        <input name="account_number" required>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Account Type</label>
        <select name="account_type">
          <option value="cheque">Cheque / Current</option>
          <option value="savings">Savings</option>
          <option value="transmission">Transmission</option>
        </select>
      </div>
      <div class="col">
        <label>Debit Order Date</label>
        <select name="debit_date">
          <option value="1">1st</option>
          <option value="7">7th</option>
          <option value="15">15th</option>
          <option value="25">25th</option>
          <option value="29">29th</option>
          <option value="30">30th</option>
        </select>
      </div>
    </div>
    <label>Debit Order Terms</label>
    <div class="terms">${(terms||"").replace(/[&<>]/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[s])) || "Terms unavailable."}</div>
    <label style="display:block;margin-top:12px;">
      <input class="cb" type="checkbox" name="agree" required> I agree to the Debit Order terms
    </label>
    <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
      <button type="submit" class="btn">Submit</button>
      <button type="button" class="btn2" onclick="location.href='/info/eft?id=${id||''}'">Prefer EFT?</button>
    </div>
  </form>
</div>
</body></html>`;
}

// ====== Onboarding UI renderer ======
function renderOnboardUI(linkid) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { --brand:#e2001a; }
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
  .card { background:#fff; max-width:700px; margin:2.2em auto; border-radius:1.25em;
          box-shadow:0 2px 12px #0002; padding:1.4em; }
  .logo { display:block; margin:0 auto .8em; max-width:150px; height:auto; }
  h1, h2 { color: var(--brand); }
  .btn { background: var(--brand); color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1.02em; cursor:pointer; margin:.6em 0 0; }
  .btn-outline { background:#fff; color:var(--brand); border:2px solid var(--brand); border-radius:.7em; padding:.6em 1.4em; }
  .field { margin:1em 0; }
  input, select, textarea { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
  .note { font-size:13px; color:#666; }
  .progressbar { height:8px; background:#eee; border-radius:5px; margin:1.2em 0 1.6em; overflow:hidden; }
  .progress { height:100%; background: var(--brand); transition:width .4s; }
  .row { display:flex; gap:.75em; flex-wrap:wrap; }
  .row > * { flex:1; }
  .pill-wrap { display:flex; gap:.6em; flex-wrap:wrap; margin:.6em 0 0; }
  .pill { border:2px solid var(--brand); color:var(--brand); padding:.6em 1.2em; border-radius:999px; cursor:pointer; user-select:none; }
  .pill.active { background: var(--brand); color:#fff; }
  .termsbox { max-height: 300px; overflow:auto; padding:1em; border:1px solid #ddd; border-radius:.6em; background:#fafafa; white-space: pre-wrap; }
  canvas.signature { border:1px dashed #bbb; border-radius:.6em; width:100%; height:180px; touch-action:none; background:#fff; }
  .cb { transform: scale(1.3); margin-right:8px; vertical-align: middle; }
  .eftgrid { display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
  .eftgrid .item { background:#fafafa; border:1px solid #e9e9e9; border-radius:10px; padding:12px 14px; }
  .label { font-weight:600; color:#555; font-size:14px; }
  .value { font-size:16px; margin-top:4px; }
  @media (max-width: 720px) { .card { padding: 1em; } .eftgrid{ grid-template-columns: 1fr; } }
</style>
</head>
<body>
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
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft', debit_signed:false, msa_signed:false };

  function pct(){ return Math.min(100, Math.round(((step+1)/(7+1))*100)); }
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
    const ctx=canvas.getContext('2d'); let draw=false,last=null;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  // --- Step 0: Welcome ---
  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  // --- Step 1: OTP (WA or Staff) ---
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

  // --- Step 2: Payment method (EFT inline OR Debit terms+sig here) ---
  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div>',
      '<div id="eftBox" class="field" style="margin-top:12px; display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="margin-top:12px; display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>'
    ].join('');

    function renderEFTInline(){
      const id=(linkid||'').split('_')[0];
      document.getElementById('eftBox').innerHTML = [
        '<div class="eftgrid">',
          '<div class="item"><div class="label">Bank</div><div class="value">First National Bank (FNB)</div></div>',
          '<div class="item"><div class="label">Account Name</div><div class="value">Vinet Internet Solutions</div></div>',
          '<div class="item"><div class="label">Account Number</div><div class="value">62757054996</div></div>',
          '<div class="item"><div class="label">Branch Code</div><div class="value">250655</div></div>',
          '<div class="item"><div class="label">Reference</div><div class="value">'+id+'</div></div>',
        '</div>',
        '<div class="note" style="margin-top:8px;">You can also view a printable page.</div>',
        '<a class="btn-outline" target="_blank" href="/info/eft?id='+encodeURIComponent(id)+'">View EFT page</a>'
      ].join('');
    }

    function renderDebitForm(){
      const d = state.debit || {};
      document.getElementById('debitBox').innerHTML = [
        '<div class="row">',
          '<div class="field"><label>Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required></div>',
          '<div class="field"><label>Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required></div>',
          '<div class="field"><label>Account Number</label><input id="d_acc" value="'+(d.account_number||'')+'" required></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading debit order terms...</div>',
        '<div class="field"><label><input class="cb" type="checkbox" id="debitAgree"> I have read and accept the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="sigDebit" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSigDebit">Clear</a><span class="note" id="sigDebitMsg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      const pad=sigPad(document.getElementById('sigDebit'));
      document.getElementById('clearSigDebit').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
      // store pad on state for submit
      state._sigDebitPad = pad;
    }

    if (pay==='eft') renderEFTInline(); else renderDebitForm();

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; document.getElementById('debitBox').style.display='none'; document.getElementById('eftBox').style.display='block'; renderEFTInline(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; document.getElementById('eftBox').style.display='none'; document.getElementById('debitBox').style.display='block'; renderDebitForm(); save(); };

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        // validate fields + checkbox + signature
        const msg = document.getElementById('sigDebitMsg');
        const d = {
          account_holder: (document.getElementById('d_holder')||{}).value?.trim() || "",
          id_number:      (document.getElementById('d_id')||{}).value?.trim() || "",
          bank_name:      (document.getElementById('d_bank')||{}).value?.trim() || "",
          account_number: (document.getElementById('d_acc')||{}).value?.trim() || "",
          account_type:   (document.getElementById('d_type')||{}).value || "",
          debit_day:      (document.getElementById('d_day')||{}).value || "",
        };
        const agree = document.getElementById('debitAgree')?.checked;
        if (!d.account_holder || !d.id_number || !d.bank_name || !d.account_number) { msg.textContent='Please complete all fields.'; return; }
        if (!agree) { msg.textContent='Please accept the Debit Order terms.'; return; }
        try {
          const id = (linkid||'').split('_')[0];
          // save DO details
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...d, splynx_id: id }) });
          // save signature image
          const dataUrl = (state._sigDebitPad && state._sigDebitPad.dataURL()) || "";
          if (!/^data:image\\/png;base64,/.test(dataUrl)) { msg.textContent='Please add your signature for Debit Order.'; return; }
          await fetch('/api/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl, type: "debit" }) });
          state.debit = d;
          state.debit_signed = true;
        } catch { msg.textContent='Could not save debit order. Please try again.'; return; }
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  // --- Step 3: Client Info ---
  function step3(){
    stepEl.innerHTML='<h2>Your details</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'" /></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'" /></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'" /></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'" /></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'" /></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'" /></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault();
          state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() };
          step=4; state.progress=step; setProg(); save(); render();
        };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // --- Step 4: Uploads (ID & Proof of Address) ---
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
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), {
          method:'POST', body: buf
        });
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

  // --- Step 5: MSA terms + signature ---
  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field"><label><input class="cb" type="checkbox" id="agreeChk"/> I have read and accept the terms</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?pay=eft'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl,type:"msa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ state.msa_signed=true; step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  // --- Step 6: Completion ---
  function step6(){
    const linkidEsc = encodeURIComponent(linkid);
    const msaUrl = '${R2_PUBLIC_BASE}/agreements/'+linkidEsc+'/msa.pdf';
    const doUrl  = '${R2_PUBLIC_BASE}/agreements/'+linkidEsc+'/do.pdf';
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks – we\\u2019ve recorded your information. Our team will be in contact shortly.</p>',
      '<p>If you have any questions, please contact our sales team:</p>',
      '<ul style="padding-left: 1.2em; line-height: 1.6em;">',
        '<li><b>Phone:</b> 021 007 0200</li>',
        '<li><b>Email:</b> <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></li>',
      '</ul>',
      '<hr>',
      '<p><b>Your agreements</b> (links will work once approved):</p>',
      '<p><a href="'+msaUrl+'" target="_blank">📄 Master Service Agreement (PDF)</a></p>',
      '<p><a href="'+doUrl+'" target="_blank">📄 Debit Order Agreement (PDF)</a></p>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// ====== Worker entry ======
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ------- Static admin UI -------
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // ------- Info pages -------
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderDebitPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Handle /submit-debit (HTML form) -> save via API then confirm
    if (path === "/submit-debit" && method === "POST") {
      const form = await request.formData();
      const b = {
        splynx_id: (form.get("client_id") || "").toString().trim(),
        account_holder: (form.get("account_holder") || "").toString().trim(),
        id_number: (form.get("id_number") || "").toString().trim(),
        bank_name: (form.get("bank") || "").toString().trim(),
        account_number: (form.get("account_number") || "").toString().trim(),
        account_type: (form.get("account_type") || "").toString().trim(),
        debit_day: (form.get("debit_date") || "").toString().trim(),
        agreed: !!form.get("agree"),
      };
      // Save via the same JSON handler
      const resp = await this._saveDebit(env, b, getIP(request), getUA(request));
      if (!resp.ok) return new Response("Failed to save", { status: 500 });
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Saved</title>
      <meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:680px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}</style></head>
      <body><div class="card"><h2>Thank you</h2><p>We have recorded your debit order details. Our team will review them.</p>
      <a class="btn" href="/">Back to Admin</a></div></body></html>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ------- Terms (service + debit) -------
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay") || "eft").toLowerCase();
      const service = await fetchText(TERMS_SERVICE_URL);
      const debit = pay === "debit" ? await fetchText(TERMS_DEBIT_URL) : "";
      const escape = s => s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const body = `
        <h3>Service Terms</h3>
        <pre style="white-space:pre-wrap">${escape(service||"")}</pre>
        ${debit ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${escape(debit)}</pre>` : ""}
      `;
      return new Response(body || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ------- Debit save (JSON) -------
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const res = await this._saveDebit(env, b, getIP(request), getUA(request));
      return json(res.ok ? { ok:true, ref: res.key } : { ok:false, error: res.error || "failed" }, res.ok ? 200 : 400);
    }

    // ------- Admin: generate link -------
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

    // ------- Admin: staff OTP code -------
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

    // ------- WhatsApp OTP send / verify -------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];

      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); }
      catch { return json({ ok: false, error: "Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      try {
        await sendWhatsAppTemplate(env, msisdn, code, "en");
        return json({ ok: true });
      } catch (e) {
        try {
          await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`);
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
        if (sess) {
          await env.ONBOARD_KV.put(
            `onboard/${linkid}`,
            JSON.stringify({ ...sess, otp_verified: true }),
            { expirationTtl: 86400 }
          );
        }
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ------- Onboarding UI -------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ------- Onboarding: uploads to R2 (limit 5MB each, 2 files client-side enforced) -------
    if (path === "/api/onboard/upload" && method === "POST") {
      const sp = new URL(request.url).searchParams;
      const linkid = sp.get("linkid");
      const filename = sp.get("filename") || "file.bin";
      const label = sp.get("label") || "";

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Invalid link" }, 404);

      const body = await request.arrayBuffer();
      if (body.byteLength > 5*1024*1024) return json({ ok:false, error:"File too large (5MB max)" }, 413);

      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, body);
      // track minimal info in session
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      uploads.push({ key, name: filename, size: body.byteLength, label });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok: true, key });
    }

    // ------- Save progress -------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: getIP(request), last_ua: getUA(request), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok: true });
    }

    // ------- Store signature (debit or msa) + mark pending -------
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl, type } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature_${type==='debit'?'do':'msa'}.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown session" }, 404);

      const flags = {
        agreement_signed: type === "msa" ? true : (sess.agreement_signed || false),
        debit_signed:     type === "debit" ? true : (sess.debit_signed || false),
        status: "pending"  // waiting for admin approval
      };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, ...flags }), { expirationTtl: 86400 });

      return json({ ok: true, sigKey });
    }

    // ------- Admin list (for tabs 3/4/5) -------
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

        if (mode === "inprog"   && !s.agreement_signed) items.push({ linkid, id: s.id, updated });
        if (mode === "pending"  && s.status === "pending") items.push({ linkid, id: s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id: s.id, updated });
      }
      items.sort((a,b)=> b.updated - a.updated);
      return json({ items });
    }

    // ------- Simple admin review page -------
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });

      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${
            uploads.map(u =>
              `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
                <b>${u.label||'File'}</b> — ${u.name} • ${Math.round((u.size||0)/1024)} KB
              </li>`).join("")
          }</ul>`
        : `<div class="note">No files</div>`;

      const debit = sess.debit || {};
      const debitHTML = Object.keys(debit).length
        ? `<div style="border:1px solid #eee;border-radius:.7em;padding:.8em;">
            <div><b>Account Holder:</b> ${debit.account_holder||''}</div>
            <div><b>ID No:</b> ${debit.id_number||''}</div>
            <div><b>Bank:</b> ${debit.bank_name||''}</div>
            <div><b>Account #:</b> ${debit.account_number||''}</div>
            <div><b>Type:</b> ${debit.account_type||''}</div>
            <div><b>Debit Day:</b> ${debit.debit_day||''}</div>
          </div>`
        : `<div class="note">No debit order details</div>`;

      return new Response(`
<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Review</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}
.note{color:#666;font-size:12px}
</style>
</head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${sess.id}</b> • LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'n/a'}</b></div>

  <h2>Edits</h2>
  <div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${k}</b>: ${v?String(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>

  <h2>Debit Order (read-only)</h2>
  ${debitHTML}

  <h2>Uploads</h2>
  ${filesHTML}

  <h2>Agreement</h2>
  <div class="note">DO signed: ${sess.debit_signed ? "Yes" : "No"} • MSA signed: ${sess.agreement_signed ? "Yes" : "No"}</div>

  <div style="margin-top:12px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg = document.getElementById('msg');
  document.getElementById('approve').onclick = async () => {
    msg.textContent = 'Pushing...';
    try {
      const r = await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d = await r.json().catch(()=>({ok:false}));
      msg.textContent = d.ok ? 'Approved and pushed.' : (d.error || 'Failed.');
    } catch { msg.textContent = 'Network error.'; }
  };
  document.getElementById('reject').onclick = async () => {
    const reason = prompt('Reason for rejection?') || '';
    msg.textContent = 'Rejecting...';
    try {
      const r = await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
      const d = await r.json().catch(()=>({ok:false}));
      msg.textContent = d.ok ? 'Rejected.' : (d.error || 'Failed.');
    } catch { msg.textContent = 'Network error.'; }
  };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ------- Admin: approve -------
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

      const pending = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!pending) return json({ ok:false, error:"Not found" }, 404);

      // TODO: push pending.edits, debit, uploads to Splynx with splynxPUT and docs upload
      // For now, mark approved and write placeholder PDFs if desired.

      // Ensure public keys match public R2 path
      const msaKey = `agreements/${linkid}/msa.pdf`;
      const doKey  = `agreements/${linkid}/do.pdf`;

      // If you generate PDFs elsewhere, just skip this placeholder write.
      // Here we store small placeholder PDFs if not existing:
      await ensurePdf(env, msaKey, "MSA placeholder");
      await ensurePdf(env, doKey,  "Debit Order placeholder");

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...pending, status:"approved", approved_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true, msa_url: `${R2_PUBLIC_BASE}/${msaKey}`, do_url: `${R2_PUBLIC_BASE}/${doKey}` });
    }

    // ------- Admin: reject -------
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        ...sess, status: "rejected",
        reject_reason: String(reason || "").slice(0, 300),
        rejected_at: Date.now()
      }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------- Splynx profile endpoint (used in UI) -------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // ------- Fallback 404 -------
    return new Response("Not found", { status: 404 });
  },

  // shared helper for /api/debit/save and /submit-debit
  async _saveDebit(env, b, ip, ua) {
    const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
    for (const k of required) if (!b[k] || String(b[k]).trim()==="") return { ok:false, error:`Missing ${k}` };

    const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
    const ts = Date.now();
    const key = `debit/${id}/${ts}`;
    const record = { ...b, splynx_id: id, created: ts, ip, ua };
    await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });

    // also mirror into session for admin-view read-only convenience
    try {
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/" });
      const match = (list.keys||[]).find(k => (k.name.split("/")[1]||"").startsWith(id+"_"));
      if (match) {
        const linkid = match.name.split("/")[1];
        const sess = await env.ONBOARD_KV.get(match.name, "json");
        if (sess) {
          const next = { ...sess, debit: { ...b }, last_ip: ip, last_ua: ua, last_time: Date.now() };
          await env.ONBOARD_KV.put(match.name, JSON.stringify(next), { expirationTtl: 86400 });
        }
      }
    } catch {}
    return { ok:true, key };
  }
};

// ====== WhatsApp senders ======
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
        { type: "body", parameters: [{ type: "text", text: code }] },
        // URL button param length rules can be strict; use last 6
        { type: "button", sub_type: "url", index: "0",
          parameters: [{ type: "text", text: code.slice(-6) }] }
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
    const t = await r.text().catch(()=>"");
    throw new Error(`WA template send failed ${r.status} ${t}`);
  }
}
async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
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
    const t = await r.text().catch(()=>"");
    throw new Error(`WA text send failed ${r.status} ${t}`);
  }
}

// ====== tiny placeholder PDF writer (so links exist after approval even before real PDFs) ======
async function ensurePdf(env, key, label) {
  const exists = await env.R2_UPLOADS.head(key);
  if (exists) return;
  const minimalPdf = new Uint8Array([
    0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a, // %PDF-1.4
    0x25,0xe2,0xe3,0xcf,0xd3,0x0a,
  ]);
  await env.R2_UPLOADS.put(key, minimalPdf.buffer, { httpMetadata: { contentType: "application/pdf", contentDisposition: `inline; filename="${label}.pdf"` } });
}
