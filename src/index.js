// Vinet Onboarding Worker — single-file version
// Last update: flow polish, debit-order first-sign, uploads step, PDF on sign, CAT timestamps

// ------------------- Config (env fallbacks) -------------------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const PUBLIC_R2_URL_FALLBACK = "https://onboarding-uploads.vinethosting.org";
const TERMS_SERVICE_DEFAULT = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_DEFAULT   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// Your office range
const ALLOWED_IPS = ["160.226.128.0/20"]; // quick CIDR check below

// ------------------- Small helpers -------------------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const json = (o, s = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...headers }});

function esc(s) { return String(s ?? "").replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function r2Url(env, key) {
  const base = (env.PUBLIC_R2_URL || PUBLIC_R2_URL_FALLBACK).replace(/\/+$/,"");
  return `${base}/${key.replace(/^\/+/, "")}`;
}
function nowCAT() {
  // CAT == Africa/Johannesburg (UTC+2, no DST)
  try {
    return new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12:false });
  } catch {
    // fallback: manual offset (+120 min)
    const d = new Date();
    return new Date(d.getTime() + 120*60000).toISOString().replace("T"," ").replace(/\..+/, "");
  }
}
function clientIP(req) {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
}
function clientUA(req) { return req.headers.get("user-agent") || ""; }

async function fetchText(url) {
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 }});
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

// ------------------- Splynx helpers -------------------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
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
    id_number: src.passport || "",            // map “passport” to our id_number field
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city: src.city || "",
    street: src.street || "",
    zip: src.zip_code || src.zip || "",
  };
}

// ------------------- OTP (WhatsApp) helpers -------------------
async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: toMsisdn,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0",
          parameters: [{ type: "text", text: code.slice(-6) }] }
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`WA template send failed ${r.status} ${t}`);
  }
}
async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to: toMsisdn, type: "text", text: { body: bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`WA text send failed ${r.status} ${t}`);
  }
}

// ------------------- PDF helpers (draw text + signature) -------------------
async function drawText(page, font, text, x, y, size = 10) {
  page.drawText(text, { x, y, size, font });
}

// Coordinates assume the current templates you gave me.
// If you update the templates, ping me and I’ll tweak these.
async function makeDebitPDF(templateBytes, fields, sigBytes, audit, pdfLib) {
  const { PDFDocument, StandardFonts } = pdfLib;
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p0 = doc.getPage(0);
  // Text blocks (roughly aligned to the blanks)
  await drawText(p0, font, fields.account_holder || "", 150, 658, 11);
  await drawText(p0, font, fields.id_number || "",       520, 658, 11);
  await drawText(p0, font, fields.bank_name || "",       150, 620, 11);
  await drawText(p0, font, fields.account_number || "",  520, 620, 11);
  await drawText(p0, font, (fields.account_type||"").toUpperCase(), 150, 583, 11);
  await drawText(p0, font, String(fields.debit_day || ""), 520, 583, 11);

  if (sigBytes) {
    const png = await doc.embedPng(sigBytes);
    // Signature between Debit Date and Date lines
    p0.drawImage(png, { x: 150, y: 520, width: 180, height: 60 });
  }
  await drawText(p0, font, String(fields.date || nowCAT()), 520, 520, 11);
  await drawText(p0, font, String(fields.customer_id || ""), 150, 485, 11);

  // Audit page
  const auditPage = doc.addPage();
  const aFont = await doc.embedFont(StandardFonts.Helvetica);
  auditPage.drawText("Electronic acceptance – audit record", { x: 50, y: auditPage.getHeight()-60, size: 14, font: aFont });
  let y = auditPage.getHeight()-90;
  const lines = [
    `Splynx ID: ${fields.customer_id || ""}`,
    `Link ID: ${fields.link_id || ""}`,
    `Date/time (CAT): ${audit.when}`,
    `IP: ${audit.ip}`,
    `User-Agent: ${audit.ua}`
  ];
  for (const ln of lines) { auditPage.drawText(ln, { x: 50, y, size: 12, font: aFont }); y -= 18; }

  return await doc.save();
}

async function makeMsaPDF(templateBytes, fields, sigBytes, audit, pdfLib) {
  const { PDFDocument, StandardFonts } = pdfLib;
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Signature block on page 4 bottom-right; name on left
  const idx = Math.min(3, doc.getPageCount()-1);
  const p = doc.getPage(idx);

  await drawText(p, font, fields.full_name || "", 80, 110, 11);        // Full First & Last name
  await drawText(p, font, fields.date || nowCAT(),  80, 90, 11);       // Date (left area)

  if (sigBytes) {
    const png = await doc.embedPng(sigBytes);
    p.drawImage(png, { x: 380, y: 78, width: 180, height: 60 });       // Signature right area
  }

  // Security/Audit page
  const auditPage = doc.addPage();
  const aFont = await doc.embedFont(StandardFonts.Helvetica);
  auditPage.drawText("Electronic acceptance – audit record", { x: 50, y: auditPage.getHeight()-60, size: 14, font: aFont });
  let y = auditPage.getHeight()-90;
  const lines = [
    `Splynx ID: ${fields.customer_id || ""}`,
    `Link ID: ${fields.link_id || ""}`,
    `Date/time (CAT): ${audit.when}`,
    `IP: ${audit.ip}`,
    `User-Agent: ${audit.ua}`
  ];
  for (const ln of lines) { auditPage.drawText(ln, { x: 50, y, size: 12, font: aFont }); y -= 18; }

  return await doc.save();
}

// ------------------- Pages (HTML) -------------------
function adminHTML() {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin Dashboard</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#232}
  .card{max-width:1100px;margin:32px auto;background:#fff;border-radius:18px;padding:24px 28px;box-shadow:0 3px 18px #0002}
  .logo{display:block;margin:8px auto 12px;height:70px}
  h1{font-size:34px;margin:4px 0 16px;color:var(--red)}
  .tabs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;justify-content:center}
  .tab{border:2px solid var(--red);padding:10px 14px;border-radius:20px;cursor:pointer;color:var(--red)}
  .tab.active{background:var(--red);color:#fff}
  .panel{margin-top:12px}
  .row{display:flex;gap:10px;align-items:center}
  input[type=text]{flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:10px;font-size:16px}
  .btn{background:var(--red);color:#fff;border:0;border-radius:12px;padding:12px 18px;font-size:16px;cursor:pointer}
  .btn-outline{background:#fff;border:2px solid var(--red);color:var(--red);border-radius:12px;padding:10px 14px;cursor:pointer}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:10px;border-bottom:1px solid #eee;text-align:left}
  .note{color:#666;font-size:13px;margin-top:8px}
  .pill{display:inline-block;background:#f7f7f9;border:1px solid #eee;padding:6px 10px;border-radius:8px}
  .linkbox{margin-top:12px;background:#faf7f8;border:1px dashed var(--red);border-radius:12px;padding:10px 12px}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <h1>Admin Dashboard</h1>
  <div class="tabs">
    <div class="tab active" data-tab="gen">1) Generate onboarding link</div>
    <div class="tab" data-tab="staff">2) Generate staff verification code</div>
    <div class="tab" data-tab="inprog">3) Pending (in progress)</div>
    <div class="tab" data-tab="pending">4) Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">5) Approved</div>
  </div>
  <div id="panel" class="panel"></div>
</div>
<script>
  const panel = document.getElementById('panel');
  document.querySelectorAll('.tab').forEach(t=>{
    t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.dataset.tab)};
  });
  load('gen');

  function h(html){const d=document.createElement('div');d.innerHTML=html;return d}

  async function load(which){
    if(which==='gen'){
      panel.innerHTML='';
      const v=h('<div class="row"><input id="id" type="text" placeholder="Splynx Lead/Customer ID"><button class="btn" id="go">Generate</button></div><div id="out" class="linkbox" style="display:none"></div>');
      v.querySelector('#go').onclick=async()=>{
        const id=v.querySelector('#id').value.trim(); if(!id) return alert('Enter an ID');
        const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d=await r.json().catch(()=>({}));
        const out=v.querySelector('#out');
        if(d.url){ out.style.display='block'; out.innerHTML='<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a><div class="note">Share this link with the customer to start onboarding.</div>'; }
        else { out.style.display='block'; out.textContent='Failed to generate link'; }
      };
      panel.appendChild(v);
      return;
    }

    if(which==='staff'){
      panel.innerHTML='';
      const v=h('<div class="row"><input id="linkid" type="text" placeholder="Link ID, e.g. 319_ab12cd34"><button class="btn" id="go">Generate staff code</button></div><div id="out" class="note"></div>');
      v.querySelector('#go').onclick=async()=>{
        const linkid=v.querySelector('#linkid').value.trim(); if(!linkid) return alert('Enter link id');
        const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
        const d=await r.json().catch(()=>({}));
        v.querySelector('#out').innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 minutes).' : (d.error||'Failed');
      };
      panel.appendChild(v);
      return;
    }

    if(['inprog','pending','approved'].includes(which)){
      panel.textContent='Loading...';
      const r=await fetch('/api/admin/list?mode='+which); const d=await r.json().catch(()=>({items:[]}));
      const rows=(d.items||[]).map(i=>{
        const open = which==='pending'
          ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
          : '<a class="btn-outline" href="/onboard/'+i.linkid+'" target="_blank">Open</a>';
        const del = '<button class="btn-outline" data-del="'+i.linkid+'">Delete</button>';
        return '<tr><td>'+i.id+'</td><td class="pill">'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+open+' '+del+'</td></tr>';
      }).join('') || '<tr><td colspan="4">No records.</td></tr>';
      panel.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
      panel.querySelectorAll('[data-del]').forEach(btn=>{
        btn.onclick=async()=>{ if(!confirm('Delete this entry?')) return;
          const r=await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:btn.dataset.del})});
          const d=await r.json().catch(()=>({})); if(d.ok) load(which); else alert('Failed: '+(d.error||''));
        }
      });
      return;
    }
  }
</script>
</body></html>`;
}

function eftInfoHTML(id) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EFT Payment Details</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f7f7fa}
  .card{max-width:980px;margin:34px auto;background:#fff;border-radius:16px;padding:22px 24px;box-shadow:0 3px 18px #0002}
  .logo{display:block;margin:4px auto 10px;height:72px}
  h1{color:var(--red);margin:10px 0 18px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .field label{font-size:13px;color:#555;display:block;margin-bottom:6px}
  .field input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}
  .ref label{font-weight:700}
  .ref input{font-weight:700;color:#b00012}
  .note{font-size:13px;color:#444;margin-top:8px}
  .center{display:flex;justify-content:center;margin-top:16px}
  .btn{background:var(--red);color:#fff;border:0;border-radius:12px;padding:12px 28px;font-size:16px;cursor:pointer}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div class="field"><label>Account Number</label><input readonly value="62757054996"></div>
    <div class="field"><label>Branch Code</label><input readonly value="250655"></div>
    <div class="field ref"><label>Reference (use this EXACTLY)</label><input readonly value="${esc(id)}"></div>
  </div>
  <div class="note">Please make sure you use the correct reference when making EFT payments.</div>
  <div class="center"><button class="btn" onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// ------------------- Onboarding UI -------------------
function onboardHTML(linkid) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Onboarding</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#232}
  .card{max-width:980px;margin:28px auto;background:#fff;border-radius:16px;padding:20px 24px;box-shadow:0 3px 18px #0002}
  .logo{display:block;margin:2px auto 8px;height:86px} /* bigger welcome brand */
  h2{color:var(--red);margin:14px 0}
  .progress{height:8px;background:#eee;border-radius:6px;margin:8px 0 14px;overflow:hidden}
  .bar{height:100%;background:var(--red);width:10%}
  .row{display:flex;gap:14px}
  .row>*{flex:1}
  .field{margin:10px 0}
  label{display:block;font-size:13px;color:#444;margin-bottom:6px}
  input,select,textarea{width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px}
  .pillbar{display:flex;gap:10px;margin:8px 0 2px;flex-wrap:wrap}
  .pill{border:2px solid var(--red);padding:10px 14px;border-radius:999px;color:var(--red);cursor:pointer;user-select:none}
  .pill.active{background:var(--red);color:#fff}
  .btn{background:var(--red);color:#fff;border:0;border-radius:12px;padding:12px 24px;font-size:16px;cursor:pointer}
  .btn-outline{background:#fff;border:2px solid var(--red);color:var(--red);border-radius:12px;padding:12px 24px;cursor:pointer}
  .btn-link{border:2px solid var(--red);color:var(--red);background:#fff;border-radius:999px;padding:10px 20px;cursor:pointer}
  .actions{display:flex;gap:12px;margin-top:12px}
  .note{font-size:13px;color:#666;margin-top:6px}
  .terms{max-height:320px;overflow:auto;border:1px solid #ddd;border-radius:10px;padding:10px;background:#fafafa}
  .bigcheck{transform:scale(1.4);margin-right:8px;vertical-align:middle}
  canvas.signature{width:100%;height:200px;border:1px dashed #bbb;border-radius:10px;background:#fff;touch-action:none}
  .center{display:flex;justify-content:center}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <div class="progress"><div id="bar" class="bar"></div></div>
  <div id="step"></div>
</div>
<script>
 (function(){
  const linkid=${JSON.stringify(linkid)};
  let step=0;
  const bar=document.getElementById('bar'), box=document.getElementById('step');
  const state={ pay_method:'eft', edits:{}, debit:{}, uploads:[], otp_ok:false, do_signed:false, msa_signed:false };

  function pct(){ 
    // 0 Welcome,1 OTP,2 Payment,3 DO-sign (only if debit),4 Details,5 Uploads,6 MSA,7 Done
    const max = (state.pay_method==='debit') ? 8 : 7;
    return Math.min(100, Math.round(((step+1)/max)*100));
  }
  function prog(){ bar.style.width=pct()+'%'; }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)}).catch(()=>{}); }

  // signature pad
  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null;
    function resize(){ const scale=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=r.width*scale; canvas.height=r.height*scale; ctx.setTransform(scale,0,0,scale,0,0); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#111' }
    resize(); addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault() }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault() }
    function end(){ draw=false; last=null }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height) }, data(){ return canvas.toDataURL('image/png') } }
  }

  async function sendOtp(){
    const m=document.getElementById('otpmsg');
    if(m) m.textContent='Sending code to WhatsApp...';
    try{
      const r=await fetch('/api/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({ok:false}));
      if(m) m.textContent=d.ok?'Code sent. Check WhatsApp.':(d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.' }
  }

  function step0(){
    prog();
    box.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><div class="actions"><button class="btn" id="go">Let\\u2019s begin</button></div>';
    document.getElementById('go').onclick=()=>{ step=1; prog(); save(); render(); };
  }

  function step1(){
    prog();
    box.innerHTML='<h2>Verify your identity</h2>\
      <div class="pillbar"><span class="pill active" id="wa">WhatsApp OTP</span><span class="pill" id="staff">I have a staff code</span></div>\
      <div class="field" id="wab"></div><div class="field" id="stfb" style="display:none"></div>';
    const wa=document.getElementById('wa'), st=document.getElementById('staff'), wab=document.getElementById('wab'), stfb=document.getElementById('stfb');
    wa.onclick=()=>{wa.classList.add('active');st.classList.remove('active');wab.style.display='block';stfb.style.display='none';};
    st.onclick=()=>{st.classList.add('active');wa.classList.remove('active');stfb.style.display='block';wab.style.display='none';};
    wab.innerHTML='<div id="otpmsg" class="note"></div>\
      <div class="row"><input id="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code"><button class="btn" id="verify">Verify</button></div>\
      <div class="actions"><button class="btn-outline" id="resend">Resend code</button></div>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{e.preventDefault();sendOtp();};
    document.getElementById('verify').onclick=async()=>{
      const otp=document.getElementById('otp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:'wa'})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ state.otp_ok=true; step=2; prog(); save(); render(); } else document.getElementById('otpmsg').textContent='Invalid code. Try again.';
    };
    stfb.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div>\
      <div class="row"><input id="sotp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit staff code"><button class="btn" id="sverify">Verify</button></div>';
    document.getElementById('sverify').onclick=async()=>{
      const otp=document.getElementById('sotp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:'staff'})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ state.otp_ok=true; step=2; prog(); save(); render(); } else alert('Invalid or expired staff code.');
    };
  }

  function renderDebitForm() {
    const d = state.debit || {};
    return '<div class="row">\
      <div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'"></div>\
      <div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'"></div>\
    </div>\
    <div class="row">\
      <div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'"></div>\
      <div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'"></div>\
    </div>\
    <div class="row">\
      <div class="field"><label>Bank Account Type</label><select id="d_type">\
        <option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option>\
        <option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option>\
        <option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option>\
      </select></div>\
      <div class="field"><label>Debit Order Date</label><select id="d_day">\
        '+[1,7,15,25,29,30].map(x=>'<option value="'+x+'" '+((d.debit_day||'')==x?'selected':'')+'>'+x+'</option>').join('')+'\
      </select></div>\
    </div>';
  }

  function step2(){
    prog();
    const id=(linkid||'').split('_')[0];
    box.innerHTML='<h2>Payment Method</h2>\
      <div class="pillbar"><span class="pill '+(state.pay_method==='eft'?'active':'')+'" id="pmE">EFT</span><span class="pill '+(state.pay_method==='debit'?'active':'')+'" id="pmD">Debit order</span></div>\
      <div id="pmBox"></div>\
      <div class="actions"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>';
    document.getElementById('pmE').onclick=()=>{state.pay_method='eft';renderPM();save();};
    document.getElementById('pmD').onclick=()=>{state.pay_method='debit';renderPM();save();};
    document.getElementById('back').onclick=()=>{step=1;prog();save();render();};
    document.getElementById('cont').onclick=async()=>{
      if(state.pay_method==='debit'){
        // capture values
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value
        };
        await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...state.debit,splynx_id:id})}).catch(()=>{});
        step=3; // Debit Agreement step
      } else {
        step=4; // Skip to details
      }
      prog(); save(); render();
    };

    function renderPM(){
      const c=document.getElementById('pmBox');
      if(state.pay_method==='eft'){
        c.innerHTML='<div class="row">\
          <div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>\
          <div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div></div>\
          <div class="row">\
          <div class="field"><label>Account Number</label><input readonly value="62757054996"></div>\
          <div class="field"><label>Branch Code</label><input readonly value="250655"></div></div>\
          <div class="field"><label><b>Reference (use this EXACTLY)</b></label><input readonly value="${esc(id)}" style="font-weight:700;color:#b00012"></div>\
          <div class="center"><button class="btn-link" onclick="location.href='/info/eft?id=${encodeURIComponent(id)}'">Print banking details</button></div>';
      } else {
        c.innerHTML = renderDebitForm() + '<div class="terms" id="doTerms">Loading terms…</div>';
        fetch('/api/terms?only=debit').then(r=>r.text()).then(t=>{document.getElementById('doTerms').innerHTML=t||'Terms not available.'}).catch(()=>{document.getElementById('doTerms').textContent='Failed to load terms.'});
      }
    }
    renderPM();
  }

  function step3(){ // Debit Order Terms + Signature (only for debit)
    prog();
    box.innerHTML='<h2>Debit Order Instruction</h2>\
      <div class="terms" id="terms">Loading terms…</div>\
      <div class="field"><label><input class="bigcheck" type="checkbox" id="agree"> I agree to the Debit Order terms</label></div>\
      <div class="field"><label>Draw your signature for Debit Order</label><canvas id="sig" class="signature"></canvas></div>\
      <div class="actions"><button class="btn-outline" id="back">Back</button><button class="btn" id="sign">Continue</button></div>\
      <div id="msg" class="note"></div>';
    fetch('/api/terms?only=debit').then(r=>r.text()).then(t=>{document.getElementById('terms').innerHTML=t||'Terms not available.'});
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('back').onclick=()=>{step=2;prog();save();render();};
    document.getElementById('sign').onclick=async()=>{
      const msg=document.getElementById('msg');
      if(!document.getElementById('agree').checked){ msg.textContent='Please tick the checkbox to accept.'; return; }
      msg.textContent='Saving…';
      try{
        const r=await fetch('/api/sign/do',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl:pad.data()})});
        const d=await r.json().catch(()=>({}));
        if(d.ok){ state.do_signed=true; step=4; prog(); save(); render(); } else msg.textContent=d.error||'Failed';
      }catch{ msg.textContent='Network error.' }
    };
  }

  function step4(){ // Your details
    prog();
    box.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="b" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', id_number: state.edits.id_number ?? p.id_number ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('b').innerHTML='<div class="row">\
          <div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"></div>\
          <div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.id_number||'')+'"></div>\
        </div>\
        <div class="row">\
          <div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"></div>\
          <div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"></div>\
        </div>\
        <div class="row">\
          <div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"></div>\
          <div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"></div>\
        </div>\
        <div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"></div>\
        <div class="actions"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>';
        document.getElementById('back').onclick=()=>{ step=(state.pay_method==='debit')?3:2; prog(); save(); render(); };
        document.getElementById('cont').onclick=()=>{ state.edits={ full_name:val('f_full'), id_number:val('f_id'), email:val('f_email'), phone:val('f_phone'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') }; step=5; prog(); save(); render(); };
      } catch { document.getElementById('b').textContent='Failed to load profile.'; }
    })();
    function val(id){ return (document.getElementById(id).value||'').trim(); }
  }

  function step5(){ // Uploads
    prog();
    box.innerHTML='<h2>Upload documents</h2>\
     <p class="note">Please upload your supporting documents<br> <b>ID or Passport and proof of address (as per RICA regulations)</b> (max 2 files, 5MB each).</p>\
     <div class="field"><input type="file" id="f1"></div>\
     <div class="field"><input type="file" id="f2"></div>\
     <div class="actions"><button class="btn-outline" id="back">Back</button><button class="btn" id="cont">Continue</button></div>\
     <div id="msg" class="note"></div>';
    document.getElementById('back').onclick=()=>{ step=4; prog(); save(); render(); };
    document.getElementById('cont').onclick=async()=>{
      const files=[document.getElementById('f1').files[0], document.getElementById('f2').files[0]].filter(Boolean);
      const msg=document.getElementById('msg');
      if(files.length){
        try{
          for(const f of files){
            if(f.size>5*1024*1024){ alert('Each file must be <= 5MB'); return; }
            const buf=await f.arrayBuffer();
            const r=await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(f.name),{method:'POST',body:buf});
            const d=await r.json().catch(()=>({}));
            if(!d.ok) throw new Error('upload failed');
          }
          msg.textContent='Uploaded.';
        }catch{ msg.textContent='Upload failed.' }
      }
      step=6; prog(); save(); render();
    };
  }

  function step6(){ // MSA Terms & signature
    prog();
    box.innerHTML='<h2>Master Service Agreement</h2>\
      <div class="terms" id="terms">Loading terms…</div>\
      <div class="field"><label><input class="bigcheck" type="checkbox" id="agree"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>\
      <div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas></div>\
      <div class="actions"><button class="btn-outline" id="back">Back</button><button class="btn" id="sign">Agree & Sign</button></div>\
      <div id="msg" class="note"></div>';
    fetch('/api/terms').then(r=>r.text()).then(t=>{ document.getElementById('terms').innerHTML=t||'Terms not available.' });
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('back').onclick=()=>{ step=5; prog(); save(); render(); };
    document.getElementById('sign').onclick=async()=>{
      const msg=document.getElementById('msg');
      if(!document.getElementById('agree').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; }
      try {
        msg.textContent='Saving…';
        const r=await fetch('/api/sign/msa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl:pad.data(),edits:state.edits})});
        const d=await r.json().catch(()=>({}));
        if(d.ok){ state.msa_signed=true; step=7; prog(); save(); render(); }
        else msg.textContent=d.error||'Failed to save';
      } catch { msg.textContent='Network error.' }
    };
  }

  function step7(){ // Done
    prog();
    const id=(linkid||'').split('_')[0];
    // Try to fetch what keys were produced (msa/do)
    fetch('/api/onboard/agreements?linkid='+encodeURIComponent(linkid)).then(r=>r.json()).then(d=>{
      const links = [];
      if(d.msa_key) links.push('<a class="btn-link" href="'+d.msa_url+'" target="_blank">Download MSA</a>');
      if(d.do_key)  links.push('<a class="btn-link" href="'+d.do_url+'" target="_blank">Download Debit Order</a>');
      box.innerHTML='<h2>All set!</h2>\
        <p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>\
        <div class="actions center">'+(links.join(' ')||'')+'</div>';
    }).catch(()=>{
      box.innerHTML='<h2>All set!</h2><p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>';
    });
  }

  function render(){ [step0,step1,step2,step3,step4,step5,step6,step7][step](); }
  render();
 })();
</script>
</body></html>`;
}

// ------------------- Admin review page -------------------
function reviewHTML(sess, linkid, msaUrl, doUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Review & Approve</title>
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc}
  .card{max-width:980px;margin:28px auto;background:#fff;border-radius:16px;padding:20px 24px;box-shadow:0 3px 18px #0002}
  h1{color:var(--red)}
  .btn{background:var(--red);color:#fff;border:0;border-radius:12px;padding:10px 18px;cursor:pointer}
  .btn-outline{background:#fff;border:2px solid var(--red);color:var(--red);border-radius:12px;padding:8px 16px;cursor:pointer}
  .note{color:#666}
  .files a{display:inline-block;margin:4px 8px 0 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .pill{display:inline-block;padding:4px 8px;border-radius:8px;background:#f6f6f9;border:1px solid #eee}
</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID <b>${esc(sess.id)}</b> • Link <span class="pill">${esc(linkid)}</span> • Status <b>${esc(sess.status||'n/a')}</b></div>

  <h3>Edits</h3>
  <div class="grid">
    ${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b><div>${esc(v||'')}</div></div>`).join("") || "<div class='note'>None</div>"}
  </div>

  <h3>Agreements</h3>
  <div class="files">
    ${msaUrl ? `<a class="btn-outline" href="${msaUrl}" target="_blank">Download MSA</a>` : '<span class="note">MSA not signed yet.</span>'}
    ${doUrl  ? `<a class="btn-outline" href="${doUrl}" target="_blank">Download Debit Order</a>` : ''}
  </div>

  <h3>Uploads</h3>
  ${(Array.isArray(sess.uploads)&&sess.uploads.length)
    ? `<ul>${sess.uploads.map(u=>`<li>${esc(u.name||'file')} • ${(Math.round((u.size||0)/1024))} KB</li>`).join("")}</ul>`
    : '<div class="note">No files.</div>'}

  <div style="margin-top:14px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const linkid=${JSON.stringify(linkid)};
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{
    msg.textContent='Pushing...';
    try{
      const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({}));
      msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.' }
  };
  document.getElementById('reject').onclick=async()=>{
    const reason=prompt('Reason for rejection?')||'';
    msg.textContent='Rejecting...';
    try{
      const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,reason})});
      const d=await r.json().catch(()=>({}));
      msg.textContent=d.ok?'Rejected.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.' }
  };
</script>
</body></html>`;
}

// ------------------- Worker -------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------- Admin ----------
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(adminHTML(), { headers: { "content-type": "text/html; charset=utf-8" }});
    }
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const msaKey = sess.agreement_msa_key, doKey = sess.agreement_do_key;
      const msaUrl = msaKey ? r2Url(env, msaKey) : "";
      const doUrl  = doKey  ? r2Url(env, doKey)  : "";
      return new Response(reviewHTML(sess, linkid, msaUrl, doUrl), { headers: { "content-type": "text/html; charset=utf-8" }});
    }
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ error: "Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items=[];
      for (const k of list.keys) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode==='inprog' && !s.msa_signed) items.push({ linkid, id:s.id, updated });
        if (mode==='pending' && s.status==='pending') items.push({ linkid, id:s.id, updated });
        if (mode==='approved' && s.status==='approved') items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      await env.ONBOARD_KV.delete(`onboard/${linkid}`);
      await env.ONBOARD_KV.delete(`pending/${linkid}`);
      return json({ ok:true });
    }
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);

      // TODO: Push to Splynx: edits + file uploads + PDFs
      // For now: mark approved
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:'approved', approved_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:'rejected', reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ---------- Static admin shell ----------
    if (path === "/static/admin.js" && method === "GET") {
      // (not used anymore; keeping endpoint harmless)
      return new Response("", { headers: { "content-type": "application/javascript" }});
    }

    // ---------- Info pages ----------
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(eftInfoHTML(id), { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // ---------- Terms ----------
    if (path === "/api/terms" && method === "GET") {
      const only = (url.searchParams.get("only") || "").toLowerCase(); // 'debit' or ''
      const svcUrl = env.TERMS_SERVICE_URL || TERMS_SERVICE_DEFAULT;
      const debUrl = env.TERMS_DEBIT_URL || TERMS_DEBIT_DEFAULT;
      if (only === "debit") {
        const debit = await fetchText(debUrl);
        return new Response(`<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(debit)}</pre>`, { headers: { "content-type": "text/html; charset=utf-8" }});
      }
      const service = await fetchText(svcUrl);
      return new Response(`<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(service)}</pre>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // ---------- OTP send/verify ----------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid||"").split("_")[0];

      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); }
      catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try {
        await sendWhatsAppTemplate(env, msisdn, code, "en");
        return json({ ok:true });
      } catch {
        try {
          await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`);
          return json({ ok:true, note:"sent-as-text" });
        } catch {
          return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502);
        }
      }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = (kind==="staff") ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // ---------- Onboard app ----------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(onboardHTML(linkid), { headers: { "content-type": "text/html; charset=utf-8" }});
    }
    if (path === "/api/progress/"+url.pathname.split("/").pop() && method === "POST") {
      // shouldn’t happen; kept for safety
    }
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/").pop();
      const body = await request.json().catch(()=>({}));
      const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...sess, ...body, last_ip: clientIP(request), last_ua: clientUA(request), last_time: Date.now(), id: (linkid||"").split("_")[0] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid") || "";
      const filename = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Invalid link" }, 404);
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, body);
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      uploads.push({ key, name: filename, size: body.byteLength });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok:true, key, url: r2Url(env, key) });
    }

    // Agreements keys query (for “All set” page)
    if (path === "/api/onboard/agreements" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false }, 404);
      const msa_key = sess.agreement_msa_key || null;
      const do_key  = sess.agreement_do_key  || null;
      return json({
        ok:true,
        msa_key, do_key,
        msa_url: msa_key ? r2Url(env, msa_key) : null,
        do_url : do_key  ? r2Url(env, do_key ) : null
      });
    }

    // Debit minimal save (from Payment step)
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const reqd = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of reqd) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const key = `debit/${id}/${Date.now()}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, ip:clientIP(request), ua:clientUA(request) }), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref: key });
    }

    // Sign DO -> create DO PDF
    if (path === "/api/sign/do" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl||"")) return json({ ok:false, error:"Missing linkid/signature" }, 400);
      const png = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json"); if (!sess) return json({ ok:false, error:"Session not found" }, 404);
      const id = (linkid||"").split("_")[0];

      // Load template + build
      const [tpl, pdfLib] = await Promise.all([
        fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf").then(r=>r.arrayBuffer()),
        import("pdf-lib")
      ]);
      const fields = {
        account_holder: sess.debit?.account_holder || "",
        id_number:      sess.debit?.id_number || "",
        bank_name:      sess.debit?.bank_name || "",
        account_number: sess.debit?.account_number || "",
        account_type:   sess.debit?.account_type || "",
        debit_day:      sess.debit?.debit_day || "",
        date:           nowCAT(),
        customer_id:    id,
        link_id:        linkid
      };
      const audit = { when: nowCAT(), ip: clientIP(request), ua: clientUA(request) };
      const out = await makeDebitPDF(new Uint8Array(tpl), fields, png, audit, pdfLib);
      const doKey = `agreements/${linkid}/do.pdf`;
      await env.R2_UPLOADS.put(doKey, out, { httpMetadata: { contentType: "application/pdf" }});

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, do_signed:true, agreement_do_key: doKey, last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true, key: doKey, url: r2Url(env, doKey) });
    }

    // Sign MSA -> create MSA PDF
    if (path === "/api/sign/msa" && method === "POST") {
      const { linkid, dataUrl, edits } = await request.json().catch(()=>({}));
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl||"")) return json({ ok:false, error:"Missing linkid/signature" }, 400);
      const png = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json"); if (!sess) return json({ ok:false, error:"Session not found" }, 404);
      const id = (linkid||"").split("_")[0];

      const [tpl, pdfLib] = await Promise.all([
        fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf").then(r=>r.arrayBuffer()),
        import("pdf-lib")
      ]);
      const fields = {
        full_name: edits?.full_name || sess.edits?.full_name || "",
        date:      nowCAT(),
        customer_id: id,
        link_id:   linkid
      };
      const audit = { when: nowCAT(), ip: clientIP(request), ua: clientUA(request) };
      const out = await makeMsaPDF(new Uint8Array(tpl), fields, png, audit, pdfLib);
      const msaKey = `agreements/${linkid}/msa.pdf`;
      await env.R2_UPLOADS.put(msaKey, out, { httpMetadata: { contentType: "application/pdf" }});

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, msa_signed:true, agreement_msa_key: msaKey, last_time: Date.now(), status:'pending' }), { expirationTtl: 86400 });
      return json({ ok:true, key: msaKey, url: r2Url(env, msaKey) });
    }

    // ---------- Splynx profile (for details step) ----------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // ---------- Default 404 ----------
    return new Response("Not found", { status: 404 });
  }
};
