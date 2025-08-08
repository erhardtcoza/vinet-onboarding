// Vinet Onboarding Worker – single-file version
// Last updated: inline fixes (bigger logo, OTP layout, EFT emphasis, debit terms, ID field, uploads, MSA wording/signature req, CAT stamp, links, admin tidy)

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// --- Allow-list (CIDR-ish) ---
const ALLOWED_IPS = ["160.226.128.0/20"];
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

// --- Config / URLs ---
const TERMS_SERVICE_URL_DEFAULT = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_URL_DEFAULT   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
const PUBLIC_R2_DEFAULT         = "https://onboarding-uploads.vinethosting.org/";

// --- Utilities ---
const json = (o, s=200) => new Response(JSON.stringify(o), {status: s, headers: {"content-type":"application/json"}});
const html = (h, s=200) => new Response(h, {status: s, headers: {"content-type":"text/html; charset=utf-8"}});
const text = (t, s=200) => new Response(t, {status: s, headers: {"content-type":"text/plain; charset=utf-8"}});

const safe = (v) => (v==null ? "" : String(v));
const getIP = (req) => req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || "";
const getUA = (req) => req.headers.get("user-agent") || "";

function r2PublicUrl(env, key) {
  const base = (env.PUBLIC_R2_HTTP || PUBLIC_R2_DEFAULT).replace(/\/+$/, "");
  return `${base}/${key}`.replace(/([^:]\/)\/+/g, "$1");
}

// --- Fetch file text (terms) ---
async function fetchText(url) {
  try {
    const r = await fetch(url, { cf: { cacheEverything:true, cacheTtl:300 }});
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

// --- Splynx helpers ---
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
// pick any msisdn in 27xxxxxxxxx format
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; } }
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
    id, kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    street: src.street || "",
    city: src.city || "",
    zip: src.zip || src.zip_code || "",
    id_number: src.passport || "", // Splynx "passport"
  };
}

// --- WhatsApp (template + text fallback) ---
async function sendWATemplate(env, to, code, lang="en") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] }
      ]
    }
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WA template send failed ${r.status} ${await r.text()}`);
}
async function sendWAText(env, to, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body: bodyText } };
  const r = await fetch(endpoint, {
    method:"POST",
    headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WA text send failed ${r.status} ${await r.text()}`);
}

// --- Admin HTML ---
function adminHTML() {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin Dashboard</title>
<style>
  :root{--red:#e2001a;}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fafbfc;color:#222}
  .card{background:#fff;max-width:1100px;margin:2.2em auto;border-radius:1.2em;box-shadow:0 2px 12px #0002;padding:1.6em 2em}
  .logo{display:block;margin:0 auto .5em;max-width:140px}
  h1{color:var(--red);margin:.2em 0 1em;font-size:2.1rem}
  .tabs{display:flex;gap:.6em;flex-wrap:wrap;justify-content:center;margin:.4em 0 1.2em}
  .pill{border:2px solid var(--red);color:var(--red);padding:.6em 1.1em;border-radius:999px;cursor:pointer}
  .pill.active{background:var(--red);color:#fff}
  .row{display:flex;gap:.8em;align-items:center}
  input{width:100%;padding:.7em;border:1px solid #ddd;border-radius:.7em}
  .btn{background:var(--red);color:#fff;border:0;border-radius:.8em;padding:.75em 1.4em;cursor:pointer}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:.8em;padding:.6em 1.2em;cursor:pointer}
  .note{font-size:.9rem;color:#666}
  table{width:100%;border-collapse:collapse}
  th,td{padding:.7em;border-bottom:1px solid #eee;text-align:left}
  .urlbox{margin-top:.6em;padding:.7em 1em;border:1px dashed #ddd;border-radius:.7em;background:#fafafa}
  .del{color:#a00;cursor:pointer}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <h1>Admin Dashboard</h1>
  <div class="tabs">
    <div class="pill active" data-tab="gen">1) Generate onboarding link</div>
    <div class="pill" data-tab="staff">2) Generate staff verification code</div>
    <div class="pill" data-tab="inprog">3) Pending (in progress)</div>
    <div class="pill" data-tab="pending">4) Completed (awaiting approval)</div>
    <div class="pill" data-tab="approved">5) Approved</div>
  </div>
  <div id="content"></div>
</div>
<script src="/static/admin.js" defer></script>
</body></html>`;
}
function adminJS() {
  return `(()=> {
    const tabs=[...document.querySelectorAll('.pill')], content=document.getElementById('content');
    tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.dataset.tab)});
    load('gen');

    function el(html){const d=document.createElement('div');d.innerHTML=html;return d;}

    async function load(which){
      if(which==='gen'){
        content.innerHTML='';
        const v = el('<div class="row"><input id="id" placeholder="Splynx Lead/Customer ID"/><button class="btn" id="go">Generate</button></div><div id="out" class="urlbox note">Onboarding link will appear here.</div>');
        v.querySelector('#go').onclick=async()=>{
          const id = v.querySelector('#id').value.trim();
          const out = v.querySelector('#out');
          if(!id){ out.textContent='Please enter an ID.'; return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
            const d=await r.json();
            if(d.url){ out.innerHTML='<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'; } else out.textContent='Error generating link.';
          }catch{ out.textContent='Network error.'; }
        };
        content.appendChild(v); return;
      }

      if(which==='staff'){
        content.innerHTML='';
        const v=el('<div class="row"><input id="lk" placeholder="Onboarding link ID e.g. 319_ab12cd34"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="note" style="margin-top:.6em"></div>');
        v.querySelector('#go').onclick=async()=>{
          const linkid=v.querySelector('#lk').value.trim(); const out=v.querySelector('#out');
          if(!linkid){ out.textContent='Enter linkid.'; return;}
          out.textContent='Working...';
          try{ const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})}); const d=await r.json();
            out.innerHTML=d.ok?('Staff code: <b>'+d.code+'</b> (valid 15 min)'):(d.error||'Failed'); }catch{ out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }

      if(['inprog','pending','approved'].includes(which)){
        content.innerHTML='Loading...';
        try{
          const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
          const rows=(d.items||[]).map(i=>{
            const open = which==='pending'
              ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
              : '<a class="btn-outline" target="_blank" href="/onboard/'+i.linkid+'">Open</a>';
            const del  = which==='inprog' ? ' <span class="del" data-linkid="'+i.linkid+'">Delete</span>' : '';
            return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+open+del+'</td></tr>';
          }).join('') || '<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
          content.querySelectorAll('.del').forEach(a=>a.onclick=async()=>{
            if(!confirm('Delete this in-progress entry?')) return;
            const r=await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:a.dataset.linkid})});
            const d=await r.json(); if(d.ok) load(which); else alert('Delete failed');
          });
        }catch{ content.innerHTML='Failed to load.'; }
        return;
      }
    }
  })();`;
}

// --- Info pages ---
async function renderEFTPage(id) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EFT Payment Details</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Arial,sans-serif;background:#f7f7fa}
  .container{max-width:900px;margin:40px auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 2px 12px #0002}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  h1{color:var(--red)}
  label{font-weight:600}
  .field{background:#f9f9fb;border:1px solid #e6e6ef;border-radius:10px;padding:12px}
  .ref{border:2px solid var(--red);background:#fff}
  .ref label{color:#111}
  .ref strong{font-size:1.1rem;color:#111}
  .note{font-size:.9rem;color:#666;margin-top:8px}
  .btn{display:block;margin:18px auto 0;background:var(--red);color:#fff;border:0;border-radius:10px;padding:14px 20px;min-width:220px;cursor:pointer}
  .logo{display:block;margin:0 auto 8px;max-width:120px}
</style></head><body>
  <div class="container">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
    <h1>EFT Payment Details</h1>
    <div class="grid">
      <div class="field"><label>Bank</label><div>First National Bank (FNB/RMB)</div></div>
      <div class="field"><label>Account Name</label><div>Vinet Internet Solutions</div></div>
      <div class="field"><label>Account Number</label><div>62757054996</div></div>
      <div class="field"><label>Branch Code</label><div>250655</div></div>
      <div class="field ref" style="grid-column:1 / span 2"><label>Reference</label><div><strong>${id || ""}</strong></div></div>
    </div>
    <div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments. All accounts are payable on or before the 1st of every month.</div>
    <button class="btn" onclick="window.print()">Print</button>
  </div>
</body></html>`;
}

async function renderDebitPage(id) {
  const terms = await fetchText(TERMS_DEBIT_URL_DEFAULT);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Debit Order Instruction</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Arial,sans-serif;background:#f7f7fa}
  .container{max-width:900px;margin:40px auto;background:#fff;padding:24px;border-radius:12px;box-shadow:0 2px 12px #0002}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  h1{color:var(--red)}
  label{font-weight:600}
  input,select{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px}
  .box{border:1px solid #eee;background:#fafafa;border-radius:10px;padding:12px;max-height:240px;overflow:auto}
  .row{display:flex;gap:12px;margin-top:12px}
  .btn{background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 18px;cursor:pointer}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:10px;padding:10px 16px;cursor:pointer}
  .logo{display:block;margin:0 auto 8px;max-width:120px}
  .bigcheck{transform:scale(1.3);margin-right:8px}
</style></head><body>
  <div class="container">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
    <h1>Debit Order Instruction</h1>
    <form method="POST" action="/submit-debit">
      <input type="hidden" name="client_id" value="${id || ""}"/>
      <div class="grid">
        <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
        <div><label>Bank Account Holder ID No</label><input name="id_number" required></div>
        <div><label>Bank</label><input name="bank_name" required></div>
        <div><label>Bank Account No</label><input name="account_number" required></div>
        <div><label>Bank Account Type</label>
          <select name="account_type">
            <option value="cheque">Cheque</option>
            <option value="savings">Savings</option>
            <option value="transmission">Transmission</option>
          </select>
        </div>
        <div><label>Debit Order Date</label>
          <select name="debit_day">
            <option value="1">1st</option><option value="7">7th</option><option value="15">15th</option>
            <option value="25">25th</option><option value="29">29th</option><option value="30">30th</option>
          </select>
        </div>
      </div>
      <div class="box" style="margin-top:12px">${terms ? terms.replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;'}[s])) : 'Terms unavailable.'}</div>
      <div class="row" style="align-items:center"><label><input class="bigcheck" type="checkbox" name="agree" required> I agree to the Debit Order terms</label></div>
      <div class="row"><button class="btn" type="submit">Submit</button><a class="btn-outline" href="/info/eft?id=${encodeURIComponent(id||"")}">Prefer EFT?</a></div>
    </form>
  </div>
</body></html>`;
}

// --- Onboarding HTML ---
function onboardHTML(linkid) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Onboarding</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fafbfc;color:#222}
  .card{background:#fff;max-width:980px;margin:2.2em auto;border-radius:1.2em;box-shadow:0 2px 12px #0002;padding:1.6em 2em}
  .logo{display:block;margin:0 auto .6em;max-width:180px}
  @media(max-width:640px){.logo{max-width:140px}}
  h1,h2{color:var(--red)}
  .progressbar{height:10px;background:#eee;border-radius:6px;margin:.8em 0 1.4em;overflow:hidden}
  .progress{height:100%;background:var(--red);transition:width .4s}
  .btn{background:var(--red);color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:1rem;cursor:pointer}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:12px;padding:12px 18px;cursor:pointer}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid var(--red);color:var(--red);padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:var(--red);color:#fff}
  .row{display:flex;gap:.9em}
  .row>*{flex:1}
  input,select,textarea{width:100%;padding:.8em;border:1px solid #ddd;border-radius:12px}
  .termsbox{max-height:300px;overflow:auto;border:1px solid #eee;border-radius:12px;padding:12px;background:#fafafa}
  .bigcheck{transform:scale(1.35);margin-right:10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  canvas.signature{border:1px dashed #bbb;border-radius:10px;width:100%;height:180px;touch-action:none;background:#fff}
  .center{display:flex;justify-content:center}
  .mini{font-size:.92rem;color:#666}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid=${JSON.stringify(linkid)};
  const stepEl=document.getElementById('step'), progEl=document.getElementById('prog');
  let step=0;
  let state={ progress:0, pay_method:'eft', edits:{}, uploads:[], debit:{}, links:{} };

  function pct(){ return Math.min(100, Math.round(((step+1)/(7+1))*100)); }
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+encodeURIComponent(linkid), {method:'POST', body: JSON.stringify(state)}).catch(()=>{}); }
  function idPart(){ return (linkid||'').split('_')[0] || ''; }

  async function sendOtp(){
    const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp...';
    try{
      const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({ok:false}));
      if(m) m.textContent = d.ok ? 'Code sent. Check WhatsApp.' : (d.error||'Could not send code.');
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

  // Step 0: Welcome
  function step0(){
    stepEl.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><div class="center"><button class="btn" id="start">Let\\u2019s begin</button></div>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  // Step 1: Verify (OTP or staff code)
  function step1(){
    stepEl.innerHTML=[
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" style="margin-top:10px"></div>',
      '<div id="staffBox" style="display:none;margin-top:10px"></div>'
    ].join('');
    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="mini" style="margin:.4em 0 1em;"></div><div class="row"><input id="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code"/><button class="btn" id="verify">Verify</button></div><div style="margin-top:.6em"><button class="btn-outline" id="resend" type="button">Resend code</button></div>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('verify').onclick=async()=>{
      const otp=document.getElementById('otp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false}));
      if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; }
    };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="mini">Ask Vinet for a one-time staff code.</div><div class="row" style="margin-top:8px"><input id="sotp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code"/><button class="btn" id="sverify">Verify</button></div><div class="mini" id="smsg" style="margin-top:.5em"></div>';
    document.getElementById('sverify').onclick=async()=>{
      const otp=document.getElementById('sotp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false}));
      if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('smsg').textContent='Invalid/expired staff code.'; }
    };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  // Step 2: Payment Method
  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML=[
      '<h2>Payment Method</h2>',
      '<div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div>',
      '<div id="box" style="margin-top:12px"></div>',
      '<div class="row" style="margin-top:12px"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>'
    ].join('');
    const box=document.getElementById('box');

    function renderEFT(){
      box.innerHTML=[
        '<div class="grid">',
          '<div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
          '<div><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div>',
          '<div><label>Account Number</label><input readonly value="62757054996"/></div>',
          '<div><label>Branch Code</label><input readonly value="250655"/></div>',
          '<div style="grid-column:1 / span 2"><label><b>Reference</b></label><input readonly value="'+idPart()+'" style="border:2px solid var(--red);font-weight:700"/></div>',
        '</div>',
        '<div class="mini" style="margin:.6em 0 1em">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div class="center" style="gap:10px"><a class="btn-outline" target="_blank" href="/info/eft?id='+encodeURIComponent(idPart())+'">Print banking details</a><a class="btn-outline" target="_blank" href="/info/eft?id='+encodeURIComponent(idPart())+'">View EFT page</a></div>'
      ].join('');
    }
    function renderDebit(){
      const d=state.debit||{};
      box.innerHTML=[
        '<div class="grid">',
          '<div><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'"/></div>',
          '<div><label>Bank Account Holder ID No</label><input id="d_id" value="'+(d.id_number||'')+'"/></div>',
          '<div><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'"/></div>',
          '<div><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'"/></div>',
          '<div><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms" style="margin-top:10px">Loading terms...</div>',
        '<div style="margin:.6em 0"><label><input class="bigcheck" type="checkbox" id="d_agree"/> I agree to the Debit Order terms</label></div>',
        '<div><label>Draw your signature for Debit Order</label><canvas id="dosig" class="signature"></canvas><div class="row" style="margin-top:6px"><button class="btn-outline" id="dosigClear" type="button">Clear</button><span class="mini" id="dosigMsg"></span></div></div>'
      ].join('');
      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; }})();
      const pad=sigPad(document.getElementById('dosig')); document.getElementById('dosigClear').onclick=(e)=>{e.preventDefault(); pad.clear();}; box._pad=pad;
    }

    document.getElementById('pm-eft').onclick=()=>{ state.pay_method='eft'; renderEFT(); save(); };
    document.getElementById('pm-debit').onclick=()=>{ state.pay_method='debit'; renderDebit(); save(); };

    if(pay==='debit') renderDebit(); else renderEFT();

    document.getElementById('back').onclick=(e)=>{ e.preventDefault(); step=1; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if(state.pay_method==='debit'){
        const msgEl=document.getElementById('dosigMsg');
        const agree=document.getElementById('d_agree').checked;
        const d={
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value
        };
        if(!agree){ msgEl.textContent='Please tick the checkbox to accept the debit order terms.'; return; }
        state.debit = d; save();
        try{
          await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...d, splynx_id: idPart()})});
          const dataUrl = box._pad ? box._pad.dataURL() : null;
          if(dataUrl){ await fetch('/api/debit/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, dataUrl})}); }
        }catch{}
      }
      step=3; setProg(); save(); render();
    };
  }

  // Step 3: Your details (with ID)
  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div class="mini" id="msg">Loading…</div>';
    (async()=>{
      try{
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(idPart())); const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', id_number: state.edits.id_number ?? p.id_number ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        stepEl.innerHTML=[
          '<h2>Please verify your details and change if you see any errors</h2>',
          '<div class="grid">',
            '<div><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div>',
            '<div><label>ID / Passport</label><input id="f_idn" value="'+(cur.id_number||'')+'"/></div>',
            '<div><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div>',
            '<div><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div>',
            '<div><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div>',
            '<div><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div>',
            '<div><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '</div>',
          '<div class="row" style="margin-top:12px"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back').onclick=(e)=>{ e.preventDefault(); step=2; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault();
          state.edits={ full_name:val('f_full'), id_number:val('f_idn'), email:val('f_email'), phone:val('f_phone'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') };
          step=4; setProg(); save(); render();
        };
      }catch{ document.getElementById('msg').textContent='Failed to load profile.'; }
    })();
  }
  function val(id){ return (document.getElementById(id).value||'').trim(); }

  // Step 4: Upload documents
  function step4(){
    stepEl.innerHTML=[
      '<h2>Upload documents</h2>',
      '<div class="mini">Please upload your supporting documents<br/>ID or Passport and proof of address (as per RICA regulations). Max 2 files, 5MB each.</div>',
      '<div style="margin-top:10px"><input id="u1" type="file" accept=".jpg,.jpeg,.png,.pdf,image/*,application/pdf"/></div>',
      '<div style="margin-top:10px"><input id="u2" type="file" accept=".jpg,.jpeg,.png,.pdf,image/*,application/pdf"/></div>',
      '<div class="mini" id="umsg" style="margin-top:.6em"></div>',
      '<div class="row" style="margin-top:12px"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>'
    ].join('');
    document.getElementById('back').onclick=(e)=>{ e.preventDefault(); step=3; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      const files=[document.getElementById('u1').files[0], document.getElementById('u2').files[0]].filter(Boolean);
      const msg=document.getElementById('umsg');
      for(const f of files){
        if(f.size>5*1024*1024){ msg.textContent='One of the files exceeds 5MB.'; return; }
      }
      for(const f of files){
        try{
          const arr = await f.arrayBuffer();
          const q = new URLSearchParams({linkid, filename: f.name});
          const r = await fetch('/api/onboard/upload?'+q.toString(), { method:'POST', body: arr });
          const d = await r.json();
          if(d.ok){ state.uploads.push({ key:d.key, name:f.name, size:f.size }); }
        }catch{}
      }
      save(); step=5; setProg(); render();
    };
  }

  // Step 5: MSA agree + sign
  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div style="margin:.8em 0"><label><input class="bigcheck" type="checkbox" id="agree"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row" style="margin-top:6px"><button class="btn-outline" id="clear" type="button">Clear</button><span class="mini" id="smsg"></span></div></div>',
      '<div class="row" style="margin-top:12px"><button class="btn-outline" id="back">Back</button><button class="btn" id="sign">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?pay=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clear').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back').onclick=(e)=>{ e.preventDefault(); step=4; setProg(); save(); render(); };
    document.getElementById('sign').onclick=async(e)=>{
      e.preventDefault(); const msg=document.getElementById('smsg');
      if(!document.getElementById('agree').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; }
      msg.textContent='Saving…';
      try{
        // Save all client edits + stage data first
        await fetch('/api/onboard/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, data: state})});
        // Upload signature & generate PDFs immediately
        const dataUrl=pad.dataURL();
        const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, dataUrl})});
        const d=await r.json().catch(()=>({ok:false}));
        if(d.ok){ state.links=d.links||{}; save(); step=6; setProg(); render(); }
        else { msg.textContent=d.error||'Failed to save signature.'; }
      }catch{ msg.textContent='Network error.'; }
    };
  }

  // Step 6: Finish
  function step6(){
    const msa = state.links && state.links.msa_url ? state.links.msa_url : '';
    const dourl = state.links && state.links.do_url ? state.links.do_url : '';
    const a = msa ? '<a class="btn-outline" target="_blank" href="'+msa+'">Download MSA</a>' : '';
    const b = dourl ? '<a class="btn-outline" target="_blank" href="'+dourl+'">Download Debit Order</a>' : '';
    stepEl.innerHTML='<h2>All set!</h2><p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p><div class="center" style="gap:10px;margin-top:10px">'+a+b+'</div>';
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script></body></html>`;
}

// --- PDF generation helpers (pdf-lib) ---
async function generateAgreements(env, linkid, sess, req) {
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
  // pull data
  const id = (linkid||"").split("_")[0];
  const fullName  = safe(sess?.edits?.full_name);
  const idNumber  = safe(sess?.edits?.id_number);
  const email     = safe(sess?.edits?.email);
  const phone     = safe(sess?.edits?.phone);
  const street    = safe(sess?.edits?.street);
  const city      = safe(sess?.edits?.city);
  const zip       = safe(sess?.edits?.zip);
  const debit     = sess?.debit || {};
  const ip        = getIP(req);
  const ua        = getUA(req);

  // CAT time (UTC+02:00)
  const nowUtcMs = Date.now();
  const catMs = nowUtcMs + 2*60*60*1000;
  const cat = new Date(catMs);
  const pad2 = n=>String(n).padStart(2,"0");
  const catStr = `${cat.getUTCFullYear()}-${pad2(cat.getUTCMonth()+1)}-${pad2(cat.getUTCDate())} ${pad2(cat.getUTCHours())}:${pad2(cat.getUTCMinutes())} CAT (UTC+02:00)`;

  async function fillOrStamp(url, fieldsMap, sigPngKey, sigPlacement) {
    const tRes = await fetch(url);
    const bytes = new Uint8Array(await tRes.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    const form = pdf.getForm?.();
    let usedForm = false;

    if (form) {
      for (const [k,v] of Object.entries(fieldsMap)) {
        try {
          const f = form.getTextField(k);
          f.setText(safe(v));
          usedForm = true;
        } catch {}
      }
      try { form.flatten(); } catch {}
    }

    // if not form-filled, stamp basic text on last page top-left
    if (!usedForm) {
      const page = pdf.getPage(pdf.getPageCount()-1);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      let y = page.getHeight() - 60, x = 60;
      const lines = Object.entries(fieldsMap).map(([k,v])=>`${k}: ${safe(v)}`);
      for(const L of lines){ page.drawText(L, {x, y, size: 10, font}); y -= 14; }
    }

    // Signature image if any
    if (sigPngKey && sigPlacement) {
      try {
        const obj = await env.R2_UPLOADS.get(sigPngKey);
        if (obj) {
          const sigBytes = await obj.arrayBuffer();
          const sigImg = await pdf.embedPng(sigBytes);
          const page = pdf.getPage(sigPlacement.pageIndex < pdf.getPageCount() ? sigPlacement.pageIndex : (pdf.getPageCount()-1));
          const { x,y,w,h } = sigPlacement;
          const width = w || 220, height = h || 60;
          page.drawImage(sigImg, { x, y, width, height });
        }
      } catch {}
    }

    // Security page
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Electronic Acceptance - Security Stamp", {x: 60, y: page.getHeight()-60, size: 12, font, color: rgb(0.1,0.1,0.1)});
    let y = page.getHeight()-90;
    const pairs = [
      ["Splynx ID", id],
      ["Full Name", fullName],
      ["ID/Passport", idNumber],
      ["Email", email],
      ["Phone", phone],
      ["Street", street],
      ["City", city],
      ["ZIP", zip],
      ["Date/Time", catStr],
      ["IP", ip],
      ["Device", ua],
    ];
    for (const [k,v] of pairs) { page.drawText(`${k}: ${safe(v)}`, {x:60, y, size:10, font}); y -= 16; }

    return await pdf.save();
  }

  const results = {};
  // MSA
  try {
    const msaBytes = await fillOrStamp(
      env.TEMPLATE_MSA_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf",
      // Try these field names first, fall back to stamping:
      { full_name: fullName, customer_id: id, date: catStr, id_number: idNumber },
      sess?.agreement_sig_key,
      // guessed signature position: page index 3 near bottom
      { pageIndex: 3, x: 120, y: 90, w: 220, h: 60 }
    );
    const msaKey = `agreements/${linkid}/msa.pdf`;
    await env.R2_UPLOADS.put(msaKey, msaBytes, { httpMetadata: { contentType: "application/pdf" }});
    results.msa_key = msaKey;
    results.msa_url = r2PublicUrl(env, msaKey);
  } catch (e) {}

  // Debit Order (only if provided)
  if (sess?.debit && Object.keys(sess.debit).length) {
    try {
      const doBytes = await fillOrStamp(
        env.TEMPLATE_DO_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf",
        {
          account_holder: safe(debit.account_holder),
          id_number: safe(debit.id_number),
          bank_name: safe(debit.bank_name),
          account_number: safe(debit.account_number),
          account_type: safe(debit.account_type),
          debit_day: safe(debit.debit_day),
          date: catStr
        },
        sess?.debit_sig_key,
        // guessed signature position: page 0 around lower area
        { pageIndex: 0, x: 120, y: 120, w: 220, h: 60 }
      );
      const doKey = `agreements/${linkid}/do.pdf`;
      await env.R2_UPLOADS.put(doKey, doBytes, { httpMetadata: { contentType: "application/pdf" }});
      results.do_key = doKey;
      results.do_url = r2PublicUrl(env, doKey);
    } catch (e) {}
  }

  return results;
}

// --- Worker ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Admin pages
    if (path === "/") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      return html(adminHTML());
    }
    if (path === "/static/admin.js") return new Response(adminJS(), { headers: { "content-type":"application/javascript; charset=utf-8" } });

    // Info pages
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return html(await renderEFTPage(id));
    }
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return html(await renderDebitPage(id));
    }
    // Form POST for /info/debit
    if (path === "/submit-debit" && method === "POST") {
      const form = await request.formData();
      const b = Object.fromEntries([...form.entries()].map(([k,v])=>[k,String(v)]));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) { if (!b[k] || !String(b[k]).trim()) return text(`Missing ${k}`, 400); }
      const id = String(b.client_id||"").trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(request), ua:getUA(request) };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      return html(`<!doctype html><meta charset="utf-8"/><meta http-equiv="refresh" content="0;url=/onboard/${id}_manual">Saved. Redirecting…`);
    }

    // Terms block (service/debit)
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay") || "service").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || TERMS_SERVICE_URL_DEFAULT;
      const debUrl = env.TERMS_DEBIT_URL   || TERMS_DEBIT_URL_DEFAULT;
      const service = await fetchText(svcUrl);
      const debit = pay === "debit" ? await fetchText(debUrl) : "";
      const out = pay === "debit" ? debit : service;
      return html(`<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace">${(out||"").replace(/[&<>]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>`);
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

    // Admin: staff OTP
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error: "Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, code });
    }

    // Admin: list (inprog/pending/approved)
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items=[];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog"   && !s.agreement_signed) items.push({linkid, id:s.id, updated});
        if (mode === "pending"  && s.status === "pending") items.push({linkid, id:s.id, updated});
        if (mode === "approved" && s.status === "approved") items.push({linkid, id:s.id, updated});
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // Admin: delete in-progress
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false }, 400);
      await env.ONBOARD_KV.delete(`onboard/${linkid}`);
      await env.ONBOARD_KV.delete(`pending/${linkid}`);
      return json({ ok:true });
    }

    // Admin review page
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Not found", 404);
      const msaUrl = sess.links?.msa_url || "";
      const doUrl  = sess.links?.do_url  || "";
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u => `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">${u.name} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="mini">No files</div>`;
      return html(`<!doctype html><meta charset="utf-8"/><style>
        body{font-family:system-ui;background:#fafbfc;color:#222}
        .card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
        .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
        .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}
        .mini{color:#666;font-size:.9rem}
      </style><div class="card">
        <h2>Review & Approve</h2>
        <div class="mini">Splynx ID: <b>${sess.id}</b> • LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'n/a'}</b></div>
        <h3>Agreements</h3>
        <div style="display:flex;gap:10px">${msaUrl?`<a class="btn-outline" target="_blank" href="${msaUrl}">MSA</a>`:''}${doUrl?`<a class="btn-outline" target="_blank" href="${doUrl}">Debit Order</a>`:''}</div>
        <h3 style="margin-top:12px">Uploads</h3>${filesHTML}
        <div style="margin-top:12px">
          <button class="btn" id="approve">Approve & Push</button>
          <button class="btn-outline" id="reject">Reject</button>
          <span class="mini" id="msg"></span>
        </div>
      </div>
      <script>
        const msg=document.getElementById('msg');
        document.getElementById('approve').onclick=async()=>{
          msg.textContent='Pushing...';
          const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
          const d=await r.json().catch(()=>({ok:false}));
          msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed');
        };
        document.getElementById('reject').onclick=async()=>{
          const reason=prompt('Reason for rejection?')||'';
          msg.textContent='Rejecting...';
          const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
          const d=await r.json().catch(()=>({ok:false}));
          msg.textContent=d.ok?'Rejected.':(d.error||'Failed');
        };
      </script>`);
    }

    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      // TODO: push to Splynx (update fields, upload docs) – left as stub
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved" }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return text("Forbidden", 403);
      const { linkid, reason } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // OTP send/verify
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = String(linkid).split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try { await sendWATemplate(env, msisdn, code, "en"); return json({ ok:true }); }
      catch(e){
        try { await sendWAText(env, msisdn, "Your Vinet verification code is: "+code); return json({ ok:true, note:"sent-as-text" }); }
        catch { return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502); }
      }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Link expired or invalid", 404);
      return html(onboardHTML(linkid));
    }

    // Save stage / edits
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = decodeURIComponent(path.split("/")[3]||"");
      const body = await request.json().catch(()=>({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip:getIP(request), last_ua:getUA(request), last_time:Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }
    if (path === "/api/onboard/save" && method === "POST") {
      const { linkid, data } = await request.json().catch(()=>({}));
      if (!linkid || !data) return json({ ok:false, error:"Missing params" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Invalid link" }, 404);
      await env.ONBOARD_KV.put(`pending/${linkid}`, JSON.stringify(data), { expirationTtl: 60*60*24*30 });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, progress:50, pending:true }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Upload files to R2
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid");
      const name   = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return text("Invalid link", 404);
      const buf = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${name}`;
      await env.R2_UPLOADS.put(key, buf);
      // Track in session
      const next = { ...sess, uploads: [...(sess.uploads||[]), { key, name, size: buf.byteLength }] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // Debit save via API & signature
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || !String(b[k]).trim()) return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, splynx_id:id, created:ts, ip:getIP(request), ua:getUA(request) }), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/do_signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_sig_key: sigKey }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // Save MSA signature + generate PDFs now
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/msa_signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" }});
      let sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      sess = { ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(sess), { expirationTtl: 86400 });

      // Generate PDFs right now
      const links = await generateAgreements(env, linkid, sess, request);
      const next = { ...sess, links };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, links });
    }

    // Splynx profile for UI
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error:"Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error:"Lookup failed" }, 502); }
    }

    // 404
    return text("Not found", 404);
  }
};