// index.js — Vinet Onboarding Worker (with ID field, debit-only terms, PDFs-on-sign, finish downloads)
// Assumes: R2 bucket bound as R2_UPLOADS, KV as ONBOARD_KV, SPLYNX_* + WhatsApp envs available.

const ALLOWED_IPS = ["160.226.128.0/20"];
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

const TERMS_SERVICE_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_URL   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

const MSA_TEMPLATE_URL  = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DO_TEMPLATE_URL   = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";

// ---------- helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });
async function httpGetText(url) { try{ const r=await fetch(url,{cf:{cacheEverything:true,cacheTtl:300}}); return r.ok?await r.text():""; }catch{return "";} }
const catNow = () => {
  const t = new Date(Date.now() + 2*60*60*1000); // +02:00
  const iso = t.toISOString().replace("T"," ").slice(0,16); // YYYY-MM-DD HH:MM
  return `${iso} CAT`;
};

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile,obj.mobile,obj.phone,obj.whatsapp,obj.msisdn,obj.primary_phone,obj.contact_number,obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj){ const m=pickPhone(it); if(m) return m; } }
  else if (typeof obj==="object") { for (const k of Object.keys(obj)){ const m=pickPhone(obj[k]); if(m) return m; } }
  return null;
}
function pickStreet(src){
  const cands = ["street","address","address1","street_1","billing_street","residential_street","addr1","line1"];
  for (const k of cands){ if (src && src[k]) return src[k]; }
  return "";
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
    kind: cust? "customer" : (lead? "lead":"unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city: src.city || "",
    street: pickStreet(src),
    zip: src.zip_code || src.zip || "",
    passport: src.passport || src.id_number || ""   // Splynx “passport” fallback
  };
}

// ---------- Admin UI ----------
function renderAdminPage(){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin Dashboard</title>
<style>
:root{--brand:#e2001a}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;background:#fafbfc;color:#232}
.card{max-width:1100px;margin:24px auto;background:#fff;border-radius:18px;box-shadow:0 4px 18px #0002;padding:18px 20px}
.logo{display:block;margin:6px auto 10px;max-width:140px}
h1{color:var(--brand);text-align:center;margin:.2em 0 1em}
.tabs{display:flex;gap:.6em;flex-wrap:wrap;justify-content:center;margin:.2em 0 1.2em}
.tab{padding:.6em 1em;border-radius:999px;border:2px solid var(--brand);color:var(--brand);cursor:pointer}
.tab.active{background:var(--brand);color:#fff}
.field{margin:.8em 0}
input{width:100%;padding:.65em;border:1px solid #ddd;border-radius:10px}
.row{display:flex;gap:.7em}.row>*{flex:1}
.btn{background:var(--brand);color:#fff;border:0;border-radius:12px;padding:.7em 1.3em;cursor:pointer}
.btn-outline{background:#fff;border:2px solid var(--brand);color:var(--brand);border-radius:12px;padding:.6em 1em}
table{width:100%;border-collapse:collapse}th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
.note{font-size:12px;color:#666}
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
  <div id="content"></div>
</div>
<script src="/static/admin.js"></script>
</body></html>`;
}
function adminJs(){
  return `(()=>{const tabs=[...document.querySelectorAll('.tab')];const content=document.getElementById('content');tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.dataset.tab);});load('gen');
function H(h){const d=document.createElement('div');d.innerHTML=h;return d;}
async function load(which){
 if(which==='gen'){content.innerHTML='';const v=H('<div class="field"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id"/><button class="btn" id="go">Generate</button></div></div><div id="out" class="field"></div>');v.querySelector('#go').onclick=async()=>{const id=v.querySelector('#id').value.trim();const out=v.querySelector('#out');if(!id){out.textContent='Please enter an ID.';return;}out.textContent='Working...';try{const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});const d=await r.json();out.innerHTML=d.url?'<div style="padding:.8em;border:1px solid #eee;border-radius:12px;background:#fafafa">Onboarding link: <a href="'+d.url+'" target="_blank">'+d.url+'</a></div>':'Error generating link.';}catch{out.textContent='Network error.'}};content.appendChild(v);return;}
 if(which==='staff'){content.innerHTML='';const v=H('<div class="field"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid"/><button class="btn" id="go">Generate staff code</button></div></div><div id="out" class="field note"></div>');v.querySelector('#go').onclick=async()=>{const linkid=v.querySelector('#linkid').value.trim();const out=v.querySelector('#out');if(!linkid){out.textContent='Enter linkid';return;}out.textContent='Working...';try{const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});const d=await r.json();out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> (valid 15 min)':(d.error||'Failed');}catch{out.textContent='Network error.'}};content.appendChild(v);return;}
 if(['inprog','pending','approved'].includes(which)){content.innerHTML='Loading...';try{const r=await fetch('/api/admin/list?mode='+which);const d=await r.json();const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+(which==='pending'?'<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>':'<a class="btn-outline" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+'</td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'; }catch{content.innerHTML='Failed to load.';}return;}
}})();`;
}

// ---------- Onboarding UI (with fixes) ----------
function renderOnboardUI(linkid){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Onboarding</title>
<style>
:root{--brand:#e2001a}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:820px;margin:22px auto;border-radius:18px;box-shadow:0 4px 18px #0002;padding:24px}
.logo{display:block;margin:0 auto 8px;max-width:240px}
h1,h2{color:var(--brand)}
.btn{background:var(--brand);color:#fff;border:0;border-radius:14px;padding:.8em 1.8em;font-size:1em;cursor:pointer}
.btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:14px;padding:.7em 1.4em}
.field{margin:1em 0}
input,select,textarea{width:100%;padding:.75em;font-size:1em;border-radius:12px;border:1px solid #ddd}
.note{font-size:12px;color:#666}
.progressbar{height:10px;background:#eee;border-radius:999px;margin:1.1em 0 1.8em;overflow:hidden}
.progress{height:100%;background:var(--brand);transition:width .4s}
.row{display:flex;gap:.9em}.row>*{flex:1}
.pill-wrap{display:flex;gap:.6em;flex-wrap:wrap}
.pill{border:2px solid var(--brand);color:var(--brand);padding:.55em 1.1em;border-radius:999px;cursor:pointer}
.pill.active{background:var(--brand);color:#fff}
.termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:12px;background:#fafafa}
canvas.signature{border:1px dashed #bbb;border-radius:12px;width:100%;height:180px;touch-action:none;background:#fff}
.check{transform:scale(1.4);transform-origin:left center;margin-right:.4em}
.thin{max-width:700px;margin-inline:auto}
.center{text-align:center}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:12%"></div></div>
  <div id="step" class="thin"></div>
</div>
<script>
(function(){
  function showFatal(err){
    const step=document.getElementById('step');
    if(step){ step.innerHTML='<div style="padding:12px;border:1px solid #f3b;border-radius:10px;background:#fff2f6;color:#900"><b>There was a problem.</b><br><span style="font-size:12px">'+(err && (err.stack||err.message||err))+'</span></div>'; }
    fetch('/api/progress/fault',{method:'POST',body:JSON.stringify({linkid:${JSON.stringify(linkid)},error:String(err && (err.stack||err))})}).catch(()=>{});
  }
  window.addEventListener('error',e=>showFatal(e.error||e.message));
  window.addEventListener('unhandledrejection',e=>showFatal(e.reason));

  try{
    const linkid=${JSON.stringify(linkid)};
    const stepEl=document.getElementById('step'); const progEl=document.getElementById('prog');
    let step=0;
    let state={ progress:0, edits:{}, uploads:[], pay_method:'eft', debit:{} };

    function pct(){return Math.min(100,Math.round(((step+1)/(7+1))*100));}
    function setProg(){progEl.style.width=pct()+'%';}
    function save(){fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{});}

    async function sendOtp(){
      const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp...';
      try{const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});const d=await r.json().catch(()=>({ok:false})); if(m) m.textContent=d.ok?'Code sent. Check WhatsApp.':(d.error||'Failed to send.');}catch{ if(m) m.textContent='Network error.';}
    }
    function sigPad(canvas){const ctx=canvas.getContext('2d');let draw=false,last=null;function resize(){const scale=window.devicePixelRatio||1;const rect=canvas.getBoundingClientRect();canvas.width=Math.floor(rect.width*scale);canvas.height=Math.floor(rect.height*scale);ctx.scale(scale,scale);ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#222';}resize();window.addEventListener('resize',resize);function pos(e){const r=canvas.getBoundingClientRect();const t=e.touches&&e.touches[0];return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top};}function start(e){draw=true;last=pos(e);e.preventDefault();}function move(e){if(!draw) return;const p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;e.preventDefault();}function end(){draw=false;last=null;}canvas.addEventListener('mousedown',start);canvas.addEventListener('mousemove',move);window.addEventListener('mouseup',end);canvas.addEventListener('touchstart',start,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end);return {clear(){const r=canvas.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);},dataURL(){return canvas.toDataURL('image/png');}};}

    // 0 Welcome
    function step0(){ stepEl.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>'; document.getElementById('start').onclick=()=>{step=1;state.progress=step;setProg();save();render();}; }

    // 1 OTP
    function step1(){ stepEl.innerHTML=['<h2>Verify your identity</h2>','<div class="pill-wrap" style="margin-bottom:.6em"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>','<div id="waBox" class="field"></div>','<div id="staffBox" class="field" style="display:none"></div>'].join(''); const wa=document.getElementById('waBox'); wa.innerHTML='<div id="otpmsg" class="note" style="margin:.2em 0 .8em"></div><div class="row"><input id="otpWa" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" id="verifyWa">Verify</button></div><div class="center" style="margin-top:.8em"><button class="btn-outline" id="resend">Resend code</button></div>'; sendOtp(); document.getElementById('resend').onclick=(e)=>{e.preventDefault();sendOtp();}; document.getElementById('verifyWa').onclick=async()=>{const otp=document.getElementById('otpWa').value.trim();const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})});const d=await r.json().catch(()=>({ok:false})); if(d.ok){step=2;state.progress=step;setProg();save();render();} else document.getElementById('otpmsg').textContent='Invalid code. Try again.';}; const staff=document.getElementById('staffBox'); staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><div class="row"><input id="otpStaff" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit staff code" required /><button class="btn" id="verifyStaff">Verify</button></div><div id="staffMsg" class="note" style="margin-top:.4em"></div>'; document.getElementById('verifyStaff').onclick=async()=>{const otp=document.getElementById('otpStaff').value.trim();const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})});const d=await r.json().catch(()=>({ok:false})); if(d.ok){step=2;state.progress=step;setProg();save();render();} else document.getElementById('staffMsg').textContent='Invalid or expired staff code.';}; const pwa=document.getElementById('p-wa'),pst=document.getElementById('p-staff');pwa.onclick=()=>{pwa.classList.add('active');pst.classList.remove('active');wa.style.display='block';staff.style.display='none';};pst.onclick=()=>{pst.classList.add('active');pwa.classList.remove('active');wa.style.display='none';staff.style.display='block';}; }

    // 2 Payment
    function step2(){ const pay=state.pay_method||'eft'; stepEl.innerHTML=['<h2>Payment Method</h2>','<div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div>','<div id="eftBox" class="field" style="margin-top:12px;display:'+(pay==='eft'?'block':'none')+'"></div>','<div id="debitBox" class="field" style="margin-top:12px;display:'+(pay==='debit'?'block':'none')+'"></div>','<div class="row" style="margin-top:10px"><button class="btn-outline" id="back1">Back</button><button class="btn" id="cont">Continue</button></div>'].join(''); const idOnly=(linkid||'').split('_')[0]; const eft=document.getElementById('eftBox'); eft.innerHTML=['<div class="row">','<div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>','<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div>','</div>','<div class="row">','<div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>','<div class="field"><label>Branch Code</label><input readonly value="250655"/></div>','</div>','<div class="field"><label><b>Reference (use this on EFT)</b></label><input readonly value="'+idOnly+'"/></div>','<div class="center"><a class="btn-outline" href="/info/eft?id='+idOnly+'" target="_blank">Print banking details</a></div>','<div class="note" style="margin-top:.6em">Please make sure you use the correct reference when making EFT payments.</div>'].join(''); function renderDebitForm(){const d=state.debit||{};const box=document.getElementById('debitBox');box.style.display='block';box.innerHTML=['<div class="row">','<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'"/></div>','<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'"/></div>','</div>','<div class="row">','<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'"/></div>','<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'"/></div>','</div>','<div class="row">','<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>','<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>','</div>','<div class="termsbox" id="debitTerms">Loading debit order terms...</div>'].join(''); (async()=>{try{const r=await fetch('/api/terms?pay=debit&only=debit');const t=await r.text();document.getElementById('debitTerms').innerHTML=t||'Terms not available.';}catch{document.getElementById('debitTerms').textContent='Failed to load terms.';}})();} document.getElementById('pm-eft').onclick=()=>{state.pay_method='eft';document.getElementById('eftBox').style.display='block';document.getElementById('debitBox').style.display='none';save();}; document.getElementById('pm-debit').onclick=()=>{state.pay_method='debit';renderDebitForm();document.getElementById('eftBox').style.display='none';save();}; if(pay==='debit') renderDebitForm(); document.getElementById('back1').onclick=(e)=>{e.preventDefault();step=1;state.progress=step;setProg();save();render();}; document.getElementById('cont').onclick=(e)=>{e.preventDefault(); if(state.pay_method==='debit'){state.debit={account_holder:val('d_holder'),id_number:val('d_id'),bank_name:val('d_bank'),account_number:val('d_acc'),account_type:(document.getElementById('d_type')||{}).value||'cheque',debit_day:(document.getElementById('d_day')||{}).value||'1'};} step=3;state.progress=step;setProg();save();render();}; function val(id){const el=document.getElementById(id);return el?el.value.trim():'';} }

    // 3 Details (includes ID/passport)
    function step3(){ stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>'; (async()=>{ try{const idOnly=(linkid||'').split('_')[0]; const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(idOnly)); const p=await r.json(); const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', passport: state.edits.passport ?? p.passport ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' }; document.getElementById('box').innerHTML=['<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_passport" value="'+(cur.passport||'')+'"/></div></div>','<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>','<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>','<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>','<div class="row"><button class="btn-outline" id="back2">Back</button><button class="btn" id="cont">Continue</button></div>'].join(''); document.getElementById('back2').onclick=(e)=>{e.preventDefault();step=2;state.progress=step;setProg();save();render();}; document.getElementById('cont').onclick=(e)=>{e.preventDefault();state.edits={ full_name:val('f_full'), passport:val('f_passport'), email:val('f_email'), phone:val('f_phone'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') }; step=4;state.progress=step;setProg();save();render();}; function val(id){const el=document.getElementById(id);return el?el.value.trim():'';} }catch{ document.getElementById('box').textContent='Failed to load profile.'; } })(); }

    // 4 Upload docs
    function step4(){ stepEl.innerHTML=['<h2>Upload documents</h2>','<div class="note" style="margin-bottom:.8em">Please upload your supporting documents — ID or Passport and proof of address (as per RICA regulations). Max 2 files, 5MB each.</div>','<input id="u1" type="file" accept="image/*,.pdf" />','<div style="height:10px"></div>','<input id="u2" type="file" accept="image/*,.pdf" />','<div class="row" style="margin-top:12px"><button class="btn-outline" id="back3">Back</button><button class="btn" id="cont">Continue</button></div>'].join(''); document.getElementById('back3').onclick=(e)=>{e.preventDefault();step=3;state.progress=step;setProg();save();render();}; document.getElementById('cont').onclick=(e)=>{e.preventDefault();step=5;state.progress=step;setProg();save();render();}; }

    // 5 MSA
    function step5(){ stepEl.innerHTML=['<h2>Master Service Agreement</h2>','<div id="terms" class="termsbox">Loading terms…</div>','<div class="field" style="margin-top:.8em"><label><input class="check" type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>','<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><button class="btn-outline" id="clearSig">Clear</button><span class="note" id="sigMsg"></span></div></div>','<div class="row"><button class="btn-outline" id="back4">Back</button><button class="btn" id="signBtn">Agree & Sign</button></div>'].join(''); (async()=>{try{const r=await fetch('/api/terms?pay='+(state.pay_method||'eft'));const t=await r.text();document.getElementById('terms').innerHTML=t||'Terms not available.';}catch{document.getElementById('terms').textContent='Failed to load terms.';}})(); const pad=sigPad(document.getElementById('sig')); document.getElementById('clearSig').onclick=(e)=>{e.preventDefault();pad.clear();}; document.getElementById('back4').onclick=(e)=>{e.preventDefault();step=4;state.progress=step;setProg();save();render();}; document.getElementById('signBtn').onclick=async(e)=>{e.preventDefault();const msg=document.getElementById('sigMsg'); if(!(document.getElementById('agreeChk')||{}).checked){msg.textContent='Please tick the checkbox to accept.';return;} msg.textContent='Saving...'; try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl, info:{ pay_method:state.pay_method, debit:state.debit, edits:state.edits }})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.agreeLinks=d.links||{}; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save.'; } }catch{ msg.textContent='Network error.'; } }; }

    // 6 Finish + downloads
    function step6(){ const a=state.agreeLinks||{}; stepEl.innerHTML=['<h2>All set!</h2>','<p>Thanks – we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>', (a.msa?'<p><a class="btn" href="'+a.msa+'" target="_blank">Download MSA</a></p>':'') , (a.do?'<p><a class="btn" href="'+a.do+'" target="_blank">Download Debit Order</a></p>':'') ].join(''); }

    function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
    render();
  }catch(e){ showFatal(e); }
})();
</script></body></html>`;
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path=url.pathname, method=request.method;
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Admin
    if (path === "/" && method==="GET"){ if(!ipAllowed(request)) return new Response("Forbidden",{status:403}); return new Response(renderAdminPage(),{headers:{ "content-type":"text/html; charset=utf-8"}}); }
    if (path === "/static/admin.js" && method==="GET"){ return new Response(adminJs(),{headers:{ "content-type":"application/javascript; charset=utf-8"}}); }

    // Admin gen link
    if (path==="/api/admin/genlink" && method==="POST"){ if(!ipAllowed(request)) return new Response("Forbidden",{status:403}); const {id}=await request.json().catch(()=>({})); if(!id) return json({error:"Missing id"},400); const token=Math.random().toString(36).slice(2,10); const linkid=`${id}_${token}`; await env.ONBOARD_KV.put(`onboard/${linkid}`,JSON.stringify({id,created:Date.now(),progress:0}),{expirationTtl:86400}); return json({url:`${url.origin}/onboard/${linkid}`}); }

    // Admin list
    if (path==="/api/admin/list" && method==="GET"){ if(!ipAllowed(request)) return new Response("Forbidden",{status:403}); const mode=url.searchParams.get("mode")||"pending"; const list=await env.ONBOARD_KV.list({prefix:"onboard/"}); const items=[]; for(const k of list.keys||[]){ const s=await env.ONBOARD_KV.get(k.name,"json"); if(!s) continue; const linkid=k.name.split("/")[1]; const updated=s.last_time||s.created||0; if(mode==="inprog" && !s.agreement_signed) items.push({linkid,id:s.id,updated}); if(mode==="pending" && s.status==="pending") items.push({linkid,id:s.id,updated}); if(mode==="approved" && s.status==="approved") items.push({linkid,id:s.id,updated}); } items.sort((a,b)=>b.updated-a.updated); return json({items}); }

    // Admin staff code
    if (path==="/api/staff/gen" && method==="POST"){ if(!ipAllowed(request)) return new Response("Forbidden",{status:403}); const {linkid}=await request.json().catch(()=>({})); if(!linkid) return json({ok:false,error:"Missing linkid"},400); const sess=await env.ONBOARD_KV.get(`onboard/${linkid}`); if(!sess) return json({ok:false,error:"Unknown linkid"},404); const code=String(Math.floor(100000+Math.random()*900000)); await env.ONBOARD_KV.put(`staffotp/${linkid}`,code,{expirationTtl:900}); return json({ok:true,linkid,code}); }

    // WhatsApp OTP send/verify
    async function sendWhatsAppTemplate(toMsisdn, code, lang="en"){ const templateName=env.WHATSAPP_TEMPLATE_NAME||"vinetotp"; const endpoint=`https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`; const payload={ messaging_product:"whatsapp", to:toMsisdn, type:"template", template:{ name:templateName, language:{code:env.WHATSAPP_TEMPLATE_LANG||lang}, components:[ {type:"body",parameters:[{type:"text",text:code}]}, {type:"button",sub_type:"url",index:"0",parameters:[{type:"text",text:code.slice(-6)}]} ]}}; const r=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(payload)}); if(!r.ok) throw new Error(`WA template send failed ${r.status} ${await r.text()}`); }
    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText){ const endpoint=`https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`; const r=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:toMsisdn,type:"text",text:{body:bodyText}})}); if(!r.ok) throw new Error(`WA text send failed ${r.status} ${await r.text()}`); }

    if (path==="/api/otp/send" && method==="POST"){ const {linkid}=await request.json().catch(()=>({})); if(!linkid) return json({ok:false,error:"Missing linkid"},400); const splynxId=(linkid||"").split("_")[0]; let msisdn=null; try{ msisdn=await fetchCustomerMsisdn(env,splynxId); }catch{ return json({ok:false,error:"Splynx lookup failed"},502); } if(!msisdn) return json({ok:false,error:"No WhatsApp number on file"},404); const code=String(Math.floor(100000+Math.random()*900000)); await env.ONBOARD_KV.put(`otp/${linkid}`,code,{expirationTtl:600}); await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`,msisdn,{expirationTtl:600}); try{ await sendWhatsAppTemplate(msisdn,code,"en"); return json({ok:true}); }catch{ try{ await sendWhatsAppTextIfSessionOpen(msisdn,`Your Vinet verification code is: ${code}`); return json({ok:true,note:"sent-as-text"}); }catch{ return json({ok:false,error:"WhatsApp send failed (template+text)"},502); }} }

    if (path==="/api/otp/verify" && method==="POST"){ const {linkid,otp,kind}=await request.json().catch(()=>({})); if(!linkid||!otp) return json({ok:false,error:"Missing params"},400); const key=kind==="staff"?`staffotp/${linkid}`:`otp/${linkid}`; const expected=await env.ONBOARD_KV.get(key); const ok=!!expected && expected===otp; if(ok){ const sess=await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(sess) await env.ONBOARD_KV.put(`onboard/${linkid}`,JSON.stringify({...sess,otp_verified:true}),{expirationTtl:86400}); if(kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`); } return json({ok}); }

    // terms (supports only=debit to hide service terms)
    if (path==="/api/terms" && method==="GET"){ const pay=(url.searchParams.get("pay")||"eft").toLowerCase(); const onlyDebit = (url.searchParams.get("only")||"") === "debit"; const service = onlyDebit ? "" : await httpGetText(TERMS_SERVICE_URL); const debit   = pay==="debit" ? await httpGetText(TERMS_DEBIT_URL) : ""; const esc=s=>(s||"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m])); const body = onlyDebit ? `<pre style="white-space:pre-wrap">${esc(debit)}</pre>` : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(service)}</pre>${debit?`<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(debit)}</pre>`:""}`; return new Response(body||"<p>Terms unavailable.</p>",{headers:{"content-type":"text/html; charset=utf-8"}}); }

    // progress & fault log
    if (path.startsWith("/api/progress/") && method==="POST"){ const linkid=path.split("/")[3]; const body=await request.json().catch(()=>({})); const existing=(await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"))||{}; const next={...existing,...body,last_ip:getIP(),last_ua:getUA(),last_time:Date.now()}; await env.ONBOARD_KV.put(`onboard/${linkid}`,JSON.stringify(next),{expirationTtl:86400}); return json({ok:true}); }
    if (path==="/api/progress/fault" && method==="POST"){ const b=await request.json().catch(()=>({})); try{ await env.ONBOARD_KV.put(`fault/${Date.now()}_${Math.random().toString(36).slice(2,8)}`,JSON.stringify({...b,ip:getIP(),ua:getUA(),t:Date.now()}),{expirationTtl:60*60*24*7}); }catch{} return json({ok:true}); }

    // profile proxy
    if (path==="/api/splynx/profile" && method==="GET"){ const id=url.searchParams.get("id"); if(!id) return json({error:"Missing id"},400); try{ const prof=await fetchProfileForDisplay(env,id); return json(prof); }catch{ return json({full_name:"",email:"",phone:"",street:"",city:"",zip:"",passport:""}); } }

    // info pages
    if (path==="/info/eft" && method==="GET"){ const id=url.searchParams.get("id")||""; return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>EFT Payment Details</title><style>:root{--brand:#e2001a}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;background:#fafbfc;color:#232}.card{max-width:900px;margin:24px auto;background:#fff;border-radius:18px;box-shadow:0 4px 18px #0002;padding:20px}.logo{display:block;margin:6px auto 10px;max-width:160px}.row{display:flex;gap:.9em}.row>*{flex:1}input{width:100%;padding:.75em;border:1px solid #ddd;border-radius:12px}.btn{background:var(--brand);color:#fff;border:0;border-radius:14px;padding:.8em 1.8em;display:block;margin:14px auto 0;text-align:center;max-width:320px}</style></head><body><div class="card"><img class="logo" src="${LOGO_URL}" alt="Vinet"/><h2 style="color:#e2001a">EFT Payment Details</h2><div class="row"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div></div><div class="row"><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div></div><div><label><b>Reference (use this on EFT)</b></label><input readonly value="${id}"></div><p style="font-size:12px;color:#666">Please remember that all accounts are payable on or before the 1st of every month.</p><a class="btn" onclick="window.print()">Print</a></div></body></html>`,{headers:{"content-type":"text/html; charset=utf-8"}}); }

    // onboard page
    if (path.startsWith("/onboard/") && method==="GET"){ const linkid=path.split("/")[2]||""; const sess=await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(!sess) return new Response("Link expired or invalid",{status:404}); return new Response(renderOnboardUI(linkid),{headers:{"content-type":"text/html; charset=utf-8"}}); }

    // sign -> generate PDFs, return R2 links
    if (path==="/api/sign" && method==="POST"){
      const { linkid, dataUrl, info } = await request.json().catch(()=>({}));
      if(!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ok:false,error:"Missing/invalid signature"},400);

      // store signature image
      const pngB64 = dataUrl.split(",")[1];
      const sigBytes = Uint8Array.from(atob(pngB64), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata:{ contentType:"image/png" } });

      // build PDFs
      const { PDFDocument } = await import("pdf-lib");
      async function stampPdf(templateUrl, customerName){
        const tplRes = await fetch(templateUrl);
        const tplBytes = new Uint8Array(await tplRes.arrayBuffer());
        const pdf = await PDFDocument.load(tplBytes);
        const sigImg = await pdf.embedPng(sigBytes);
        // draw signature near bottom-right of last page (safe default)
        const page = pdf.getPages()[pdf.getPageCount()-1];
        const w = page.getWidth(), h = page.getHeight();
        const sigW = 160, sigH = (sigW / sigImg.width) * sigImg.height;
        page.drawImage(sigImg, { x: w - sigW - 36, y: 64, width: sigW, height: sigH });

        // add security page
        const sec = pdf.addPage();
        sec.drawText("Electronic signature record", { x: 50, y: sec.getHeight()-80, size: 14 });
        const lines = [
          `Customer: ${customerName || ""}`,
          `Date/time: ${catNow()}`,
          `IP: ${getIP()}`,
          `Device: ${getUA().slice(0,140)}`,
          `Session: ${linkid}`
        ];
        let y = sec.getHeight()-110;
        for (const L of lines){ sec.drawText(L, { x:50, y, size:12 }); y -= 18; }
        return await pdf.save();
      }

      const name = (info?.edits?.full_name)||"";
      const payMethod = info?.pay_method || "eft";
      const msaBytes = await stampPdf(MSA_TEMPLATE_URL, name);
      const msaKey = `agreements/${linkid}/msa.pdf`;
      await env.R2_UPLOADS.put(msaKey, msaBytes, { httpMetadata:{ contentType:"application/pdf" } });

      let doKey = null;
      if (payMethod === "debit"){
        const doBytes = await stampPdf(DO_TEMPLATE_URL, name);
        doKey = `agreements/${linkid}/do.pdf`;
        await env.R2_UPLOADS.put(doKey, doBytes, { httpMetadata:{ contentType:"application/pdf" } });
      }

      // mark session
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...(sess||{}), agreement_signed:true, agreement_sig_key:sigKey, status:"pending", last_time:Date.now() }), { expirationTtl: 86400 });

      const base = "https://onboarding-uploads.vinethosting.org/";
      const links = {
        msa: base + msaKey,
        ...(doKey ? { do: base + doKey } : {})
      };
      return json({ ok:true, sigKey, links });
    }

    // onboard HTML/JS assets
    if (path === "/static/admin.js" && method === "GET"){ return new Response(adminJs(),{headers:{"content-type":"application/javascript"}}); }

    // terms-only info (already handled)
    if (path === "/api/splynx/profile" && method === "GET"){ /* handled earlier */ }

    // default
    return new Response("Not found", { status:404 });
  }
};