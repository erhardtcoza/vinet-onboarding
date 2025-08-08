// Vinet Onboarding Worker — all-in-one file
// Last updated: inline build (OTP+EFT/DO inline, details+uploads+MSA, PDFs at sign)

// ───────────────────────────────────────────────────────────────────────────────
// Config / constants
// ───────────────────────────────────────────────────────────────────────────────
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const DEFAULT_R2_PUBLIC = "https://onboarding-uploads.vinethosting.org";
const DEFAULT_SERVICE_TERMS = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// allow-list (simple, same as earlier)
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143; // 160.226.128.0/20
}

// quick helpers
const j = (o, s=200) => new Response(JSON.stringify(o), {status:s, headers:{"content-type":"application/json"}});
async function ftxt(url) { try { const r=await fetch(url); return r.ok ? await r.text() : ""; } catch { return ""; } }

// phone harvesting
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
    obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj){ const m=pickPhone(it); if(m) return m;} }
  else if (typeof obj==="object") { for (const k of Object.keys(obj)){ const m=pickPhone(obj[k]); if(m) return m; } }
  return null;
}

// Splynx helpers
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
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
    id_number: src.passport || "", // Splynx calls this "passport"
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// WhatsApp OTP
async function sendWhatsAppTemplate(env, to, code, lang="en") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0",
          parameters: [{ type: "text", text: code.slice(-6) }] } // <=15 chars
      ]
    }
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template send failed ${r.status} ${await r.text().catch(()=> "")}`);
}

async function sendWhatsAppTextIfSessionOpen(env, to, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body: bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text send failed ${r.status} ${await r.text().catch(()=> "")}`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Admin HTML + JS
// ───────────────────────────────────────────────────────────────────────────────
function adminHTML(origin){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--pri:#e2001a;}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:1100px;margin:2em auto;border-radius:18px;box-shadow:0 2px 18px #0002;padding:1.6em 1.8em}
  .logo{display:block;margin:0 auto 8px;max-width:120px}
  h1{color:var(--pri);text-align:center;margin:.2em 0 .6em}
  .row{display:flex;gap:.75em;flex-wrap:wrap;align-items:center;justify-content:center}
  .pill{border:2px solid var(--pri);color:var(--pri);padding:.6em 1.2em;border-radius:999px;cursor:pointer;margin:.25em .35em;user-select:none}
  .pill.active{background:var(--pri);color:#fff}
  .hide{display:none}
  .field{margin:1em 0}
  input{width:100%;padding:.65em;border:1px solid #ddd;border-radius:10px;font-size:15px}
  button{background:var(--pri);border:0;color:#fff;cursor:pointer;border-radius:12px;padding:.7em 1.4em;font-size:15px}
  .btn-outline{background:#fff;color:var(--pri);border:2px solid var(--pri)}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
  .note{font-size:12px;color:#666}
  .linkbox{background:#fafafa;border:1px dashed #ddd;padding:.7em 1em;border-radius:12px}
  a.btn{background:#eef;border:0;padding:.5em .9em;border-radius:10px;text-decoration:none}
  .actions .mini{padding:.35em .7em;border-radius:10px;font-size:12px}
</style>
</head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Admin Dashboard</h1>

  <div class="row">
    <div class="pill active" data-tab="gen">1) Generate onboarding link</div>
    <div class="pill" data-tab="staff">2) Generate staff verification code</div>
  </div>
  <div class="row">
    <div class="pill" data-tab="inprog">3) Pending (in progress)</div>
    <div class="pill" data-tab="pending">4) Completed (awaiting approval)</div>
    <div class="pill" data-tab="approved">5) Approved</div>
  </div>

  <div id="content" style="margin-top:12px"></div>
</div>
<script>
(function(){
  const content = document.getElementById('content');
  document.querySelectorAll('.pill').forEach(p => p.onclick=()=>{document.querySelectorAll('.pill').forEach(x=>x.classList.remove('active'));p.classList.add('active'); load(p.dataset.tab);});
  load('gen');

  function el(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }

  function load(tab){
    if(tab==='gen'){
      content.innerHTML='';
      const v = el('<div class="field"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id" style="max-width:380px"/><button id="go">Generate</button></div><div id="out" class="field"></div></div>');
      v.querySelector('#go').onclick = async ()=>{
        const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
        if(!id){ out.textContent='Enter an ID'; return; }
        out.innerHTML='Working…';
        const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d=await r.json().catch(()=>({}));
        if(d.url){
          out.innerHTML = '<div class="linkbox"><div><b>Onboarding link</b></div><div style="margin-top:6px"><a href="'+d.url+'" target="_blank">'+d.url+'</a></div></div>';
        }else out.textContent='Error';
      };
      content.appendChild(v); return;
    }

    if(tab==='staff'){
      content.innerHTML='';
      const v=el('<div class="field"><label>Onboarding link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid" style="max-width:380px"/><button id="go">Generate</button></div><div id="out" class="field note"></div></div>');
      v.querySelector('#go').onclick = async ()=>{
        const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
        if(!linkid){ out.textContent='Enter linkid'; return; }
        out.textContent='Working…';
        const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error||'Failed');
      };
      content.appendChild(v); return;
    }

    if(['inprog','pending','approved'].includes(tab)){
      content.innerHTML='Loading…';
      fetch('/api/admin/list?mode='+tab).then(r=>r.json()).then(d=>{
        const rows = (d.items||[]).map(i=>{
          const open = '<a class="btn" target="_blank" href="/onboard/'+i.linkid+'">Open</a>';
          const rev  = tab==='pending' ? '<a class="btn" href="/admin/review?linkid='+i.linkid+'">Review</a>' : '';
          const del  = '<button class="mini btn-outline" data-del="'+i.linkid+'">Delete</button>';
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td class="actions">'+open+' '+rev+' '+del+'</td></tr>';
        }).join('') || '<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML = '<table><thead><tr><th>Splynx ID</th><th>LinkID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        content.querySelectorAll('button[data-del]').forEach(b=> b.onclick = async ()=>{
          if(!confirm('Delete this record?')) return;
          const r = await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:b.dataset.del})});
          const x = await r.json().catch(()=>({}));
          if(x.ok) load(tab); else alert(x.error||'Failed');
        });
      }).catch(()=> content.textContent='Failed.');
      return;
    }
  }
})();
</script>
</body></html>`;
}

// Admin review page
function reviewHTML(sess, linkid, r2base){
  const msa = sess.msa_key ? `${r2base}/${sess.msa_key}` : '';
  const dop = sess.do_key  ? `${r2base}/${sess.do_key}`  : '';
  const upHtml = (sess.uploads||[]).map(u=> `<li>${u.label||'File'} — ${u.name} • ${Math.round((u.size||0)/1024)} KB</li>`).join('') || '<li class="note">None</li>';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Review</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--pri:#e2001a;} body{font-family:system-ui;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:900px;margin:2em auto;border-radius:18px;box-shadow:0 2px 18px #0002;padding:1.2em 1.4em}
  h1,h2{color:var(--pri)} .note{color:#666;font-size:12px}
  a.btn{background:#eef;border:0;padding:.5em .9em;border-radius:10px;text-decoration:none;display:inline-block;margin:.2em .2em 0 0}
  button{background:var(--pri);color:#fff;border:0;border-radius:12px;padding:.6em 1.2em;cursor:pointer}
  .btn-outline{background:#fff;color:var(--pri);border:2px solid var(--pri)}
</style>
</head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${sess.id}</b> • LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'in-progress'}</b></div>

  <h2>Edits</h2>
  <div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${k}</b>: ${v?String(v):''}</div>`).join('') || "<div class='note'>None</div>"}</div>

  <h2>Uploads</h2><ul>${upHtml}</ul>

  <h2>Agreements</h2>
  <div>
    ${msa?`<a class="btn" href="${msa}" target="_blank">Download MSA</a>`:"<span class='note'>No MSA yet</span>"}
    ${dop?`<a class="btn" href="${dop}" target="_blank">Download Debit Order</a>`:""}
  </div>

  <div style="margin-top:12px">
    <button id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{
    msg.textContent='Pushing…';
    const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
    const d=await r.json().catch(()=>({}));
    msg.textContent = d.ok ? 'Approved and pushed.' : (d.error||'Failed.');
  };
  document.getElementById('reject').onclick=async()=>{
    const reason=prompt('Reason?')||'';
    const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
    const d=await r.json().catch(()=>({}));
    msg.textContent = d.ok ? 'Rejected.' : (d.error||'Failed.');
  };
</script>
</body></html>`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Onboarding HTML
// ───────────────────────────────────────────────────────────────────────────────
function onboardHTML(linkid){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--pri:#e2001a;}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:860px;margin:2.2em auto;border-radius:18px;box-shadow:0 2px 18px #0002;padding:1.6em 1.8em}
  .logo{display:block;margin:0 auto 10px;max-width:180px}
  h2{color:var(--pri);margin:.2em 0 .6em}
  .progress{height:8px;background:#eee;border-radius:7px;margin:.8em 0 1.2em;overflow:hidden}
  .bar{height:100%;background:var(--pri);width:12%;transition:width .3s}
  .field{margin:.75em 0}
  label{display:block;margin-bottom:.25em;font-weight:600}
  input,select,textarea{width:100%;padding:.7em;border:1px solid #ddd;border-radius:10px;font-size:15px}
  .row{display:flex;gap:.8em;flex-wrap:wrap}
  .row>.col{flex:1}
  button{background:var(--pri);color:#fff;border:0;border-radius:12px;padding:.8em 1.6em;cursor:pointer;font-size:16px}
  .btn-outline{background:#fff;color:var(--pri);border:2px solid var(--pri)}
  .btn-link{background:#fff;color:var(--pri);border:2px solid var(--pri);border-radius:12px;padding:.6em 1.2em;text-decoration:none;display:inline-block}
  .pill{border:2px solid var(--pri);color:var(--pri);padding:.55em 1.2em;border-radius:999px;cursor:pointer;user-select:none}
  .pill.active{background:var(--pri);color:#fff}
  .pillrow{display:flex;gap:.6em;flex-wrap:wrap}
  .terms{max-height:260px;overflow:auto;background:#fafafa;border:1px solid #ddd;border-radius:10px;padding:10px}
  .center{text-align:center}
  .note{font-size:12px;color:#666}
  canvas.sig{border:1px dashed #bbb;border-radius:10px;width:100%;height:180px;background:#fff;touch-action:none}
  .bigcheck{transform:scale(1.4);transform-origin:left center;margin-right:.4em}
</style>
</head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <div class="progress"><div id="pbar" class="bar"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid=${JSON.stringify(linkid)};
  let step=0;
  let state={ pay_method:'eft', edits:{}, uploads:[], otp_ok:false, debit:null,
              msa_key:null, do_key:null };

  const pbar=document.getElementById('pbar');
  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
  function setProg(){ pbar.style.width = pct()+'%'; }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{}); }

  // util
  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null;
    function resize(){ const scale=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect();
      canvas.width=Math.floor(r.width*scale); canvas.height=Math.floor(r.height*scale);
      ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#111'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); },
             dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  async function sendOtp(){
    const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp…';
    try{
      const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({}));
      if(m) m.textContent=d.ok?'Code sent. Check WhatsApp.':(d.error||'Could not send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  // Steps
  function step0(){
    document.getElementById('step').innerHTML =
      '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p>\
       <div class="center"><button id="start">Let\\u2019s begin</button></div>';
    document.getElementById('start').onclick=()=>{ step=1; setProg(); save(); render(); };
  }

  function step1(){
    document.getElementById('step').innerHTML =
      '<h2>Verify your identity</h2>\
       <div class="pillrow" style="margin-bottom:8px"><span class="pill active" id="pwa">WhatsApp OTP</span><span class="pill" id="pstaff">I have a staff code</span></div>\
       <div id="wabox"></div><div id="staffbox" style="display:none"></div>';
    const wa=document.getElementById('wabox');
    wa.innerHTML = '<div id="otpmsg" class="note" style="margin:.4em 0 1em"></div>\
      <div class="row"><div class="col"><input id="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" /></div>\
      <div class="col"><button id="verify">Verify</button></div></div>\
      <div class="row" style="margin-top:6px"><div class="col"><button class="btn-outline" id="resend">Resend code</button></div></div>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('verify').onclick=async()=>{
      const otp=document.getElementById('otp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'wa'})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ state.otp_ok=true; step=2; setProg(); save(); render(); }
      else document.getElementById('otpmsg').textContent='Invalid code. Try again.';
    };

    const st=document.getElementById('staffbox');
    st.innerHTML = '<div class="note">Ask Vinet for a one-time staff code.</div>\
      <div class="row" style="margin-top:6px"><div class="col"><input id="sotp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit staff code" /></div>\
      <div class="col"><button id="sverify">Verify</button></div></div><div id="smsg" class="note"></div>';
    document.getElementById('sverify').onclick=async()=>{
      const otp=document.getElementById('sotp').value.trim();
      const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'staff'})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ state.otp_ok=true; step=2; setProg(); save(); render(); }
      else document.getElementById('smsg').textContent='Invalid/expired.';
    };
    document.getElementById('pwa').onclick=()=>{ document.getElementById('pwa').classList.add('active'); document.getElementById('pstaff').classList.remove('active'); wa.style.display='block'; st.style.display='none'; };
    document.getElementById('pstaff').onclick=()=>{ document.getElementById('pstaff').classList.add('active'); document.getElementById('pwa').classList.remove('active'); wa.style.display='none'; st.style.display='block'; };
  }

  function step2(){
    const id=(linkid||'').split('_')[0];
    document.getElementById('step').innerHTML =
      '<h2>Payment Method</h2>\
       <div class="pillrow"><span id="eftp" class="pill '+(state.pay_method==='eft'?'active':'')+'">EFT</span><span id="dop" class="pill '+(state.pay_method==='debit'?'active':'')+'">Debit order</span></div>\
       <div id="pmBox" style="margin-top:10px"></div>\
       <div class="row" style="margin-top:10px"><div class="col"><button class="btn-outline" id="b1">Back</button></div><div class="col" style="text-align:right"><button id="c1">Continue</button></div></div>';

    function renderPM(){
      const c=document.getElementById('pmBox');
      if(state.pay_method==='eft'){
        c.innerHTML =
          '<div class="row">\
            <div class="col field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>\
            <div class="col field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>\
          </div>\
          <div class="row">\
            <div class="col field"><label>Account Number</label><input readonly value="62757054996"></div>\
            <div class="col field"><label>Branch Code</label><input readonly value="250655"></div>\
          </div>\
          <div class="field"><label><b>Reference (use this EXACTLY)</b></label><input readonly id="refInput" style="font-weight:700;color:#b00012"></div>\
          <div class="center" style="margin-top:6px"><a class="btn-link" id="printBtn">Print banking details</a></div>';
        document.getElementById('refInput').value=id;
        document.getElementById('printBtn').onclick = ()=> location.href='/info/eft?id='+encodeURIComponent(id);
      } else {
        c.innerHTML =
          '<div class="row">\
            <div class="col field"><label>Bank Account Holder Name</label><input id="d_holder"></div>\
            <div class="col field"><label>Bank Account Holder ID no</label><input id="d_id"></div>\
          </div>\
          <div class="row">\
            <div class="col field"><label>Bank</label><input id="d_bank"></div>\
            <div class="col field"><label>Bank Account No</label><input id="d_acc"></div>\
          </div>\
          <div class="row">\
            <div class="col field"><label>Bank Account Type</label><select id="d_type"><option value="cheque">Cheque / Current</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select></div>\
            <div class="col field"><label>Debit Order Date</label><select id="d_day"><option>1</option><option>7</option><option>15</option><option>25</option><option>29</option><option>30</option></select></div>\
          </div>\
          <div class="terms" id="doTerms">Loading terms…</div>\
          <div class="field" style="margin-top:8px"><label><input id="doAgree" class="bigcheck" type="checkbox"> I agree to the Debit Order terms</label></div>\
          <div class="field"><label>Draw your signature for Debit Order</label><canvas id="doSig" class="sig"></canvas>\
          <div class="row"><div class="col"><button class="btn-outline" id="doClear">Clear</button></div></div></div>';
        fetch('/api/terms?pay=debit').then(r=>r.text()).then(t=>{document.getElementById('doTerms').innerHTML=t||'Terms not available.';}).catch(()=>{document.getElementById('doTerms').textContent='Failed to load terms.';});
        const pad=sigPad(document.getElementById('doSig')); document.getElementById('doClear').onclick=(e)=>{e.preventDefault();pad.clear();};
        // prefill if user came back
        if(state.debit){ document.getElementById('d_holder').value=state.debit.account_holder||''; document.getElementById('d_id').value=state.debit.id_number||''; document.getElementById('d_bank').value=state.debit.bank_name||''; document.getElementById('d_acc').value=state.debit.account_number||''; document.getElementById('d_type').value=state.debit.account_type||'cheque'; document.getElementById('d_day').value=state.debit.debit_day||'1'; }
        // stash pad for later
        c._pad = pad;
      }
    }
    renderPM();
    document.getElementById('eftp').onclick = ()=>{ state.pay_method='eft'; renderPM(); };
    document.getElementById('dop').onclick  = ()=>{ state.pay_method='debit'; renderPM(); };

    document.getElementById('b1').onclick=(e)=>{ e.preventDefault(); step=1; setProg(); save(); render(); };
    document.getElementById('c1').onclick=async(e)=>{
      e.preventDefault();
      if(state.pay_method==='debit'){
        const box=document.getElementById('pmBox');
        const pad=box._pad;
        const agree=document.getElementById('doAgree').checked;
        const data={
          account_holder:document.getElementById('d_holder').value.trim(),
          id_number:document.getElementById('d_id').value.trim(),
          bank_name:document.getElementById('d_bank').value.trim(),
          account_number:document.getElementById('d_acc').value.trim(),
          account_type:document.getElementById('d_type').value,
          debit_day:document.getElementById('d_day').value
        };
        state.debit=data;
        if(!agree){ alert('Please accept the Debit Order terms'); return; }
        try{
          const r=await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ ...data, splynx_id:id })});
          await r.json().catch(()=>({}));
          // save signature image for DO now
          const sig = pad.dataURL();
          if(/^data:image\/png;base64,/.test(sig)){
            await fetch('/api/sign-do',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, dataUrl:sig})}).catch(()=>{});
          }
        }catch{}
      }
      step=3; setProg(); save(); render();
    };
  }

  function step3(){
    document.getElementById('step').innerHTML = '<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id)); const p=await r.json();
        const cur={
          full_name: state.edits.full_name ?? p.full_name ?? '',
          email:     state.edits.email     ?? p.email     ?? '',
          phone:     state.edits.phone     ?? p.phone     ?? '',
          street:    state.edits.street    ?? p.street    ?? '',
          city:      state.edits.city      ?? p.city      ?? '',
          zip:       state.edits.zip       ?? p.zip       ?? '',
          id_number: state.edits.id_number ?? p.id_number ?? ''
        };
        document.getElementById('box').innerHTML =
          '<div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"></div>\
           <div class="row">\
             <div class="col field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"></div>\
             <div class="col field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"></div>\
           </div>\
           <div class="row">\
             <div class="col field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"></div>\
             <div class="col field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"></div>\
           </div>\
           <div class="row">\
             <div class="col field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"></div>\
             <div class="col field"><label>ID / Passport</label><input id="f_idnum" value="'+(cur.id_number||'')+'"></div>\
           </div>\
           <div class="row"><div class="col"><button class="btn-outline" id="b2">Back</button></div><div class="col" style="text-align:right"><button id="c2">Continue</button></div></div>';
        document.getElementById('b2').onclick=(e)=>{e.preventDefault(); step=2; setProg(); save(); render();};
        document.getElementById('c2').onclick=(e)=>{ e.preventDefault();
          state.edits={
            full_name:document.getElementById('f_full').value.trim(),
            email:document.getElementById('f_email').value.trim(),
            phone:document.getElementById('f_phone').value.trim(),
            street:document.getElementById('f_street').value.trim(),
            city:document.getElementById('f_city').value.trim(),
            zip:document.getElementById('f_zip').value.trim(),
            id_number:document.getElementById('f_idnum').value.trim()
          };
          step=4; setProg(); save(); render();
        };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    document.getElementById('step').innerHTML =
      '<h2>Upload documents</h2>\
       <p><b>Please upload your supporting documents</b><br>ID or Passport and proof of address (as per RICA regulations). (Max 2 files, 5 MB each.)</p>\
       <div class="field"><input id="u1" type="file" accept=".pdf,image/*"></div>\
       <div class="field"><input id="u2" type="file" accept=".pdf,image/*"></div>\
       <div class="row"><div class="col"><button class="btn-outline" id="b3">Back</button></div><div class="col" style="text-align:right"><button id="c3">Continue</button></div></div>\
       <div id="umsg" class="note"></div>';
    document.getElementById('b3').onclick=(e)=>{e.preventDefault(); step=3; setProg(); save(); render();};
    document.getElementById('c3').onclick=async(e)=>{
      e.preventDefault();
      const files=[document.getElementById('u1').files[0], document.getElementById('u2').files[0]].filter(Boolean).slice(0,2);
      const msg=document.getElementById('umsg'); msg.textContent='';
      for (const f of files){
        if (f.size>5*1024*1024){ msg.textContent='One of the files is larger than 5 MB.'; return; }
      }
      for (const f of files){
        const ab=await f.arrayBuffer();
        await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(f.name),{method:'POST',headers:{'content-type':f.type||'application/octet-stream'},body:ab});
        state.uploads.push({name:f.name,size:f.size,label:'Document'});
      }
      step=5; setProg(); save(); render();
    };
  }

  function step5(){
    document.getElementById('step').innerHTML =
      '<h2>Master Service Agreement</h2>\
       <div id="terms" class="terms">Loading terms…</div>\
       <div class="field" style="margin-top:8px"><label><input id="agree" class="bigcheck" type="checkbox"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>\
       <div class="field"><label>Draw your signature</label><canvas id="sig" class="sig"></canvas><div class="row"><div class="col"><button class="btn-outline" id="clear">Clear</button></div></div></div>\
       <div class="row"><div class="col"><button class="btn-outline" id="b4">Back</button></div><div class="col" style="text-align:right"><button id="sign">Agree & Sign</button></div></div>\
       <div id="smsg" class="note"></div>';
    fetch('/api/terms').then(r=>r.text()).then(t=>{document.getElementById('terms').innerHTML=t||'Terms not available.';}).catch(()=>{document.getElementById('terms').textContent='Failed to load terms.';});
    const pad=sigPad(document.getElementById('sig')); document.getElementById('clear').onclick=(e)=>{e.preventDefault();pad.clear();};
    document.getElementById('b4').onclick=(e)=>{e.preventDefault(); step=4; setProg(); save(); render();};
    document.getElementById('sign').onclick=async(e)=>{
      e.preventDefault(); const msg=document.getElementById('smsg');
      if(!document.getElementById('agree').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; }
      msg.textContent='Saving signature & generating agreements…';
      const dataUrl=pad.dataURL();
      try{
        const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})});
        const d=await r.json().catch(()=>({}));
        if(d.ok){ state.msa_key=d.msa_key||null; state.do_key=d.do_key||null; step=6; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save.'; }
      }catch{ msg.textContent='Network error.'; }
    };
  }

  function step6(){
    const wrap=document.getElementById('step');
    const msa = state.msa_key ? ('<a class="btn-link" href="'+state.msa_key+'" target="_blank">Download MSA</a> ') : '';
    const dop = state.do_key  ? ('<a class="btn-link" href="'+state.do_key+'" target="_blank">Download Debit Order</a> ') : '';
    wrap.innerHTML =
      '<h2>All set!</h2>\
       <p>Thanks – we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>\
       <div style="margin-top:10px">'+ msa + dop +'</div>';
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// EFT info page
function eftHTML(id){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>EFT Payment Details</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--pri:#e2001a;} body{font-family:system-ui;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:1000px;margin:2em auto;border-radius:18px;box-shadow:0 2px 18px #0002;padding:1.4em 1.6em}
  .logo{display:block;margin:0 auto 10px;max-width:150px}
  h1{color:var(--pri);margin:.2em 0 .8em}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.9em}
  label{display:block;margin-bottom:.25em;font-weight:600}
  input{width:100%;padding:.7em;border:1px solid #ddd;border-radius:10px}
  .note{font-size:12px;color:#666;margin-top:6px}
  button{background:var(--pri);color:#fff;border:0;border-radius:12px;padding:.8em 1.6em;cursor:pointer}
  .center{text-align:center;margin-top:12px}
  b.em{color:#b00012}
</style>
</head><body>
<div class="card">
  <img src="${LOGO_URL}" class="logo">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div><label><b class="em">Reference (use this EXACTLY)</b></label><input readonly value="${id||''}" style="font-weight:700;color:#b00012"></div>
  </div>
  <div class="note">Please remember that all accounts are payable on or before the 1st of every month.</div>
  <div class="center"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// Debit order external page (kept for internal link if used)
function debitHTML(terms, id){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Debit Order Instruction</title><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--pri:#e2001a;} body{font-family:system-ui;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:900px;margin:2em auto;border-radius:18px;box-shadow:0 2px 18px #0002;padding:1.4em 1.6em}
  .logo{display:block;margin:0 auto 10px;max-width:120px}
  h1{color:var(--pri)}
  label{display:block;margin-bottom:.25em;font-weight:600}
  input,select,textarea{width:100%;padding:.7em;border:1px solid #ddd;border-radius:10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.9em}
  .terms{max-height:260px;overflow:auto;background:#fafafa;border:1px solid #ddd;border-radius:10px;padding:10px;margin-top:8px}
  button{background:var(--pri);color:#fff;border:0;border-radius:12px;padding:.8em 1.6em;cursor:pointer}
  .btn-outline{background:#fff;color:var(--pri);border:2px solid var(--pri)}
</style></head><body>
<div class="card">
  <img src="${LOGO_URL}" class="logo">
  <h1>Debit Order Instruction</h1>
  <form method="POST" action="/submit-debit">
    <input type="hidden" name="client_id" value="${id||''}"/>
    <div class="grid">
      <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
      <div><label>Bank Account Holder ID No</label><input name="id_number" required></div>
      <div><label>Bank</label><input name="bank_name" required></div>
      <div><label>Bank Account No</label><input name="account_number" required></div>
      <div><label>Bank Account Type</label>
        <select name="account_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
      </div>
      <div><label>Debit Order Date</label>
        <select name="debit_day"><option>1</option><option>7</option><option>15</option><option>25</option><option>29</option><option>30</option></select>
      </div>
    </div>
    <div class="terms">${terms||'Terms unavailable.'}</div>
    <div style="margin-top:10px"><label><input type="checkbox" name="agree" required> I agree to the Debit Order terms</label></div>
    <div style="margin-top:10px">
      <button type="submit">Submit</button>
      <a class="btn-outline" href="/info/eft?id=${id||''}">Prefer EFT?</a>
    </div>
  </form>
</div>
</body></html>`;
}

// ───────────────────────────────────────────────────────────────────────────────
// PDF helpers (pdf-lib dynamic import)
// ───────────────────────────────────────────────────────────────────────────────
async function makeMSAPdf(env, edits, sigPngBytes, meta){
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  // load template
  const tpl = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf");
  const bytes = new Uint8Array(await tpl.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  // best-effort fill by name
  try{
    const fields = form.getFields();
    const map = {
      full_name: edits.full_name || "",
      id_number: edits.id_number || "",
      customer_id: edits.splynx_id || ""
    };
    for (const f of fields){
      const n=f.getName().toLowerCase();
      const key = n.includes('name') ? 'full_name'
              : n.includes('passport')||n.includes('id') ? 'id_number'
              : n.includes('customer')||n.includes('account id') ? 'customer_id'
              : null;
      if(key){ try{ form.getTextField(f.getName()).setText(String(map[key]||"")); }catch{} }
    }
  } catch {}

  // append "security stamp" page (CAT +02)
  const p = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const tzOffset = 2 * 60; // +02:00
  const stampDt = new Date(meta.time + (tzOffset - (new Date().getTimezoneOffset()))*60000);
  const text = `Security verification\n\nName: ${edits.full_name||""}\nID/Passport: ${edits.id_number||""}\nCustomer ID: ${edits.splynx_id||""}\nIP: ${meta.ip}\nDevice: ${meta.ua}\nDate/time (CAT): ${stampDt.toISOString().replace('T',' ').replace('Z','')}`;
  p.drawText(text, { x: 50, y: p.getHeight()-120, size: 12, font, color: rgb(0,0,0) });

  // place signature image on that page (right side)
  if (sigPngBytes){
    const img = await pdf.embedPng(sigPngBytes);
    const w=180, h=80;
    p.drawImage(img, { x: p.getWidth()-w-60, y: p.getHeight()-180, width:w, height:h });
    p.drawText("Authorised Signature", { x: p.getWidth()-w-60, y: p.getHeight()-190, size:10, font, color: rgb(.3,.3,.3) });
  }

  form.flatten();
  return await pdf.save();
}

async function makeDOPdf(env, debit, sigPngBytes, meta){
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const tpl = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf");
  const bytes = new Uint8Array(await tpl.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  // best-effort fill
  try{
    const fields = form.getFields();
    const map = {
      account_holder: debit.account_holder||"",
      id_number: debit.id_number||"",
      bank_name: debit.bank_name||"",
      account_number: debit.account_number||"",
      account_type: debit.account_type||"",
      debit_day: debit.debit_day||""
    };
    for (const f of fields){
      const n=f.getName().toLowerCase();
      let key=null;
      if(n.includes('holder') && n.includes('name')) key='account_holder';
      else if(n.includes('id')) key='id_number';
      else if(n.includes('bank') && n.includes('name')) key='bank_name';
      else if(n.includes('account') && n.includes('number')) key='account_number';
      else if(n.includes('type')) key='account_type';
      else if(n.includes('debit') && n.includes('date')) key='debit_day';
      if(key){ try{ form.getTextField(f.getName()).setText(String(map[key]||"")); }catch{} }
    }
  }catch{}

  // Append security/sign page as well
  const p = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const tzOffset = 2 * 60;
  const stampDt = new Date(meta.time + (tzOffset - (new Date().getTimezoneOffset()))*60000);
  const text = `Security verification (Debit Order)\n\nAcc Holder: ${debit.account_holder||""}\nID/Passport: ${debit.id_number||""}\nBank: ${debit.bank_name||""}\nAccount: ${debit.account_number||""} (${debit.account_type||""})\nDebit day: ${debit.debit_day||""}\nIP: ${meta.ip}\nDevice: ${meta.ua}\nDate/time (CAT): ${stampDt.toISOString().replace('T',' ').replace('Z','')}`;
  p.drawText(text, { x: 50, y: p.getHeight()-140, size: 12, font, color: rgb(0,0,0) });

  if (sigPngBytes){
    const img = await pdf.embedPng(sigPngBytes);
    const w=180, h=80;
    p.drawImage(img, { x: p.getWidth()-w-60, y: p.getHeight()-200, width:w, height:h });
    p.drawText("Debit Order Signature", { x: p.getWidth()-w-60, y: p.getHeight()-210, size:10, font, color: rgb(.3,.3,.3) });
  }

  form.flatten();
  return await pdf.save();
}

// ───────────────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const r2base = env.R2_PUBLIC_BASE || DEFAULT_R2_PUBLIC;
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Admin UI
    if (path === "/" && method === "GET"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      return new Response(adminHTML(url.origin), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    if (path === "/admin/review" && method === "GET"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      const linkid=url.searchParams.get("linkid"); if(!linkid) return new Response("Missing linkid",{status:400});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(!sess) return new Response("Not found",{status:404});
      return new Response(reviewHTML(sess, linkid, r2base), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Static terms
    if (path === "/api/terms" && method === "GET"){
      const only = (url.searchParams.get("only")||"").toLowerCase();
      const pay  = (url.searchParams.get("pay")||"").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_SERVICE_TERMS;
      const debUrl = env.TERMS_DEBIT_URL   || DEFAULT_DEBIT_TERMS;

      const esc = s => (s||"").replace(/[&<>]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
      let body = "";
      if (only === "debit" || pay === "debit"){
        const debit = await ftxt(debUrl);
        body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(debit)}</pre>`;
      } else {
        const service = await ftxt(svcUrl);
        body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(service)}</pre>`;
      }
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Admin APIs
    if (path === "/api/admin/genlink" && method === "POST"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      const { id } = await request.json().catch(()=> ({}));
      if (!id) return j({error:"Missing id"},400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return j({ url: `${url.origin}/onboard/${linkid}` });
    }

    if (path === "/api/admin/list" && method === "GET"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      const mode = url.searchParams.get("mode")||"pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys){
        const s = await env.ONBOARD_KV.get(k.name,"json"); if(!s) continue;
        const linkid = k.name.split("/")[1]; const updated = s.last_time || s.created || 0;
        if (mode==="inprog"  && !s.agreement_signed) items.push({linkid,id:s.id,updated});
        if (mode==="pending" && s.status==="pending")  items.push({linkid,id:s.id,updated});
        if (mode==="approved"&& s.status==="approved") items.push({linkid,id:s.id,updated});
      }
      items.sort((a,b)=>b.updated-a.updated);
      return j({items});
    }

    if (path === "/api/admin/delete" && method === "POST"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      const { linkid } = await request.json().catch(()=> ({}));
      if(!linkid) return j({ok:false,error:"Missing linkid"},400);
      await env.ONBOARD_KV.delete(`onboard/${linkid}`);
      await env.ONBOARD_KV.delete(`pending/${linkid}`);
      await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      await env.ONBOARD_KV.delete(`otp/${linkid}`);
      return j({ok:true});
    }

    if (path === "/api/admin/approve" && method === "POST"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      // Stub push; mark approved
      const { linkid } = await request.json().catch(()=> ({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return j({ok:false,error:"Not found"},404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({...sess,status:"approved",approved_at:Date.now()}), {expirationTtl:86400});
      return j({ok:true});
    }

    if (path === "/api/admin/reject" && method === "POST"){
      if(!ipAllowed(request)) return new Response("Forbidden",{status:403});
      const { linkid, reason } = await request.json().catch(()=> ({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(!sess) return j({ok:false,error:"Not found"},404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({...sess,status:"rejected",reject_reason:String(reason||"").slice(0,300),rejected_at:Date.now()}), {expirationTtl:86400});
      return j({ok:true});
    }

    // OTP
    if (path === "/api/otp/send" && method === "POST"){
      const { linkid } = await request.json().catch(()=> ({}));
      if(!linkid) return j({ok:false,error:"Missing linkid"},400);
      const spid = linkid.split("_")[0];
      let msisdn=null; try{ msisdn=await fetchCustomerMsisdn(env, spid);}catch{}
      if(!msisdn) return j({ok:false,error:"No WhatsApp number on file"},404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, {expirationTtl:600});
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, {expirationTtl:600});
      try { await sendWhatsAppTemplate(env, msisdn, code, "en"); return j({ok:true}); }
      catch(e){ try{ await sendWhatsAppTextIfSessionOpen(env, msisdn, "Your Vinet verification code is: "+code); return j({ok:true,note:"sent-as-text"}); } catch{ return j({ok:false,error:"WhatsApp send failed (template+text)"},502); } }
    }

    if (path === "/api/otp/verify" && method === "POST"){
      const { linkid, otp, kind } = await request.json().catch(()=> ({}));
      if(!linkid||!otp) return j({ok:false,error:"Missing params"},400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok){
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
        if(sess){ await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({...sess, otp_verified:true}), {expirationTtl:86400}); }
        if (kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return j({ok});
    }

    // Onboarding entry
    if (path.startsWith("/onboard/") && method === "GET"){
      const linkid=path.split("/")[2]||"";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json");
      if(!sess) return new Response("Link expired or invalid",{status:404});
      return new Response(onboardHTML(linkid), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // progress store
    if (path.startsWith("/api/progress/") && method === "POST"){
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=> ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`,"json")) || {};
      const next = { ...existing, ...body, last_ip: getIP(), last_ua: getUA(), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), {expirationTtl:86400});
      return j({ok:true});
    }

    // profile passthrough
    if (path === "/api/splynx/profile" && method === "GET"){
      const id = url.searchParams.get("id");
      if(!id) return j({error:"Missing id"},400);
      try { const prof = await fetchProfileForDisplay(env, id); return j(prof); } catch { return j({error:"Lookup failed"},502); }
    }

    // uploads
    if (path === "/api/onboard/upload" && method === "POST"){
      const linkid = url.searchParams.get("linkid"); const filename=url.searchParams.get("filename")||"file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(!sess) return new Response("Invalid link",{status:404});
      const ab = await request.arrayBuffer(); if (ab.byteLength > 5*1024*1024) return new Response("Too large",{status:413});
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, ab, { httpMetadata: { contentType: request.headers.get("content-type")||"application/octet-stream" }});
      return j({ok:true,key, url: `${r2base}/${key}` });
    }

    // debit save (API)
    if (path === "/api/debit/save" && method === "POST"){
      const b = await request.json().catch(()=> ({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return j({ok:false,error:`Missing ${k}`},400);
      const id = (b.splynx_id||b.client_id||"").toString().trim() || "unknown";
      const ts = Date.now(); const key = `debit/${id}/${ts}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA()}), {expirationTtl: 60*60*24*90});
      return j({ok:true, ref:key});
    }

    // debit signature save from inline DO step
    if (path === "/api/sign-do" && method === "POST"){
      const { linkid, dataUrl } = await request.json().catch(()=> ({}));
      if(!linkid || !/^data:image\/png;base64,/.test(dataUrl)) return j({ok:false,error:"Missing/invalid signature"},400);
      const png = dataUrl.split(",")[1]; const bytes = Uint8Array.from(atob(png), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/do-signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json")||{};
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({...sess, do_sig_key:sigKey}), {expirationTtl:86400});
      return j({ok:true, sigKey: `${r2base}/${sigKey}`});
    }

    // signature & PDF generation (MSA + optional DO)
    if (path === "/api/sign" && method === "POST"){
      const { linkid, dataUrl } = await request.json().catch(()=> ({}));
      if(!linkid || !/^data:image\/png;base64,/.test(dataUrl)) return j({ok:false,error:"Missing/invalid signature"},400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`,"json"); if(!sess) return j({ok:false,error:"Unknown session"},404);

      const png = dataUrl.split(",")[1]; const sigBytes = Uint8Array.from(atob(png), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata:{contentType:"image/png"} });

      // Build edits with splynx_id for PDF
      const splynx_id = (linkid||"").split("_")[0];
      const edits = { ...sess.edits, splynx_id };

      const meta = { ip:getIP(), ua:getUA(), time: Date.now() };

      // Generate MSA now
      let msaKey=null, doKey=null;
      try{
        const pdf = await makeMSAPdf(env, edits, sigBytes, meta);
        const key = `agreements/${linkid}/msa.pdf`;
        await env.R2_UPLOADS.put(key, pdf, { httpMetadata:{contentType:"application/pdf"} });
        msaKey = `${r2base}/${key}`;
      }catch{}

      // If DO chosen, try generate DO PDF using previously saved DO sig (or current sig if none)
      if (sess.debit || sess.pay_method==='debit'){
        const doSigKey = sess.do_sig_key;
        let doSigBytes = sigBytes;
        if (doSigKey){
          try { const obj = await env.R2_UPLOADS.get(doSigKey); if(obj) doSigBytes = new Uint8Array(await obj.arrayBuffer()); } catch {}
        }
        try{
          const pdf = await makeDOPdf(env, sess.debit||{}, doSigBytes, meta);
          const key = `agreements/${linkid}/do.pdf`;
          await env.R2_UPLOADS.put(key, pdf, { httpMetadata:{contentType:"application/pdf"} });
          doKey = `${r2base}/${key}`;
        }catch{}
      }

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, msa_key: msaKey ? msaKey.replace(r2base+"/","") : null, do_key: doKey ? doKey.replace(r2base+"/","") : null, status:"pending" }), {expirationTtl:86400});
      return j({ok:true, msa_key: msaKey, do_key: doKey});
    }

    // External info pages
    if (path === "/info/eft" && method === "GET"){
      const id = url.searchParams.get("id") || "";
      return new Response(eftHTML(id), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    if (path === "/info/debit" && method === "GET"){
      const id = url.searchParams.get("id") || "";
      const terms = await ftxt(env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS);
      return new Response(debitHTML(terms, id), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Fix for the old HTML form ("Not found")
    if (path === "/submit-debit" && method === "POST"){
      const form = await request.formData();
      const b = {
        client_id: form.get("client_id")||"",
        account_holder: form.get("account_holder")||"",
        id_number: form.get("id_number")||"",
        bank_name: form.get("bank_name")||"",
        account_number: form.get("account_number")||"",
        account_type: form.get("account_type")||"",
        debit_day: form.get("debit_day")||""
      };
      // Reuse save
      const r = await this.fetch(new Request(new URL("/api/debit/save", url).toString(), {method:"POST", headers:{'content-type':'application/json'}, body: JSON.stringify(b)}), env, ctx);
      const jr = await r.json();
      return new Response(`<meta charset="utf-8"><p>Thanks, saved. Ref: ${jr.ref||''}</p><p><a href="/info/debit?id=${b.client_id}">Back</a></p>`, { headers:{"content-type":"text/html; charset=utf-8"}});
    }

    // default
    return new Response("Not found",{status:404});
  }
};
