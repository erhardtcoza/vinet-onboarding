// index.js — Vinet Onboarding Worker (single-file, build-safe)
// - Admin dashboard (IP allowlisted)
// - Onboarding flow (EFT/DO -> Personal info -> Uploads -> MSA accept + signature -> Finish)
// - WhatsApp OTP (template then text fallback)
// - PDF generation on sign (MSA always, DO when selected) to public R2
// - Public R2 links rendered on the finish page

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Allowlist admin/API by CIDR
      const clientIP = request.headers.get("CF-Connecting-IP") || "";
      const needsIPGate = (
        path === "/" ||
        path.startsWith("/admin") ||
        path.startsWith("/api")
      );
      if (needsIPGate && !ipInRange(clientIP, env.ALLOWED_CIDR || "160.226.128.0/20")) {
        return new Response("Access denied", { status: 403 });
      }

      // -------- Routes --------
      if (path === "/") return renderAdmin(env);

      if (path.startsWith("/onboard/")) {
        const linkid = path.split("/")[2] || "";
        return onboardHTML(linkid, request, env);
      }

      // Admin APIs
      if (path === "/api/admin/genlink" && request.method === "POST") return genLink(request, env);
      if (path === "/api/admin/list"   && request.method === "GET")  return adminList(url, env);
      if (path === "/api/admin/approve"&& request.method === "POST") return adminApprove(request, env);
      if (path === "/api/admin/reject" && request.method === "POST") return adminReject(request, env);

      // OTP
      if (path === "/api/otp/send"   && request.method === "POST") return sendOtp(request, env);
      if (path === "/api/otp/verify" && request.method === "POST") return verifyOtp(request, env);

      // Progress & uploads
      if (path.startsWith("/api/progress/") && request.method === "POST") {
        const linkid = path.split("/")[3] || "";
        return saveProgress(linkid, request, env);
      }
      if (path === "/api/upload" && request.method === "POST")   return handleUpload(request, env);

      // Finalize (sign + PDF generation)
      if (path === "/api/finalize" && request.method === "POST") return finalizeSubmission(request, env);

      // Info pages
      if (path === "/info/eft"   && request.method === "GET") return eftHTML(url.searchParams.get("id") || "");
      if (path === "/info/debit" && request.method === "GET") return debitOrderHTML(url.searchParams.get("id") || "", env);

      // Terms helper
      if (path === "/api/terms" && request.method === "GET")   return termsHTML(url, env);

      // Public R2 passthrough (only if you still link /r2/… anywhere)
      if (path.startsWith("/r2/") && request.method === "GET") {
        const key = path.replace("/r2/", "");
        return serveR2(key, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Worker exception: " + (err?.message || String(err)), { status: 500 });
    }
  }
};

// ------------------------ Helpers ------------------------
function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" }
  });
}
function jerr(msg, s = 400) { return json({ ok: false, error: msg }, s); }

function ipToInt(ip) {
  const p = ip.split(".").map(x => parseInt(x, 10));
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return 0;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}
function ipInRange(ip, cidr) {
  const [range, bitsStr = "32"] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function catNow() {
  // South Africa: Africa/Johannesburg (CAT, UTC+2, no DST)
  return new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
}

// ------------------------ Admin UI ------------------------
async function renderAdmin(env) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet Onboarding Admin</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
  header{background:#fff;box-shadow:0 1px 6px #0002;padding:16px;text-align:center}
  header img{max-width:120px}
  .wrap{max-width:1100px;margin:16px auto;padding:0 12px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 6px #0002;padding:16px}
  h2{color:#e2001a;margin:0 0 8px}
  input{width:70%;padding:10px;border:1px solid #ddd;border-radius:8px}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 14px;cursor:pointer}
  .link{margin-top:8px;background:#fafafa;border:1px dashed #ddd;border-radius:8px;padding:8px;font-size:.95em;word-break:break-all}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}
  .muted{color:#666;font-size:.92em}
  .center{text-align:center}
</style></head>
<body>
  <header><img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet logo"></header>
  <div class="wrap">
    <div class="grid">
      <div class="card center">
        <h2>1. Generate Onboarding Link</h2>
        <input id="clid" placeholder="Splynx ID / Lead ID"/>
        <div style="margin-top:8px"><button class="btn" id="gen">Generate</button></div>
        <div id="link" class="link"></div>
      </div>
      <div class="card center">
        <h2>2. Generate Verification Code</h2>
        <input id="linkid" placeholder="link id e.g. 319_ab12cd34"/>
        <div style="margin-top:8px"><button class="btn" id="genc">Generate Staff OTP</button></div>
        <div id="code" class="link"></div>
        <div class="muted">Use when WhatsApp delivery fails. Valid 15 minutes.</div>
      </div>
    </div>

    <div class="card">
      <h2>3. In-progress</h2>
      <div id="inprog" class="muted">Loading…</div>
    </div>
    <div class="card">
      <h2>4. Awaiting approval</h2>
      <div id="await" class="muted">Loading…</div>
    </div>
    <div class="card">
      <h2>5. Approved</h2>
      <div id="approved" class="muted">Loading…</div>
    </div>
  </div>

<script>
  async function load(mode, elId){
    const r = await fetch('/api/admin/list?mode='+encodeURIComponent(mode));
    const d = await r.json().catch(()=>({items:[]}));
    const rows = (d.items||[]).map(i =>
      '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})+'</td>'+
      '<td>'+(
        mode==='await'
          ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
          : '<a class="btn" href="/onboard/'+encodeURIComponent(i.linkid)+'" target="_blank">Open</a>'
      )+'</td></tr>'
    ).join('');
    const html = rows
      ? '<table><thead><tr><th>Splynx ID</th><th>Link</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
      : '<div class="muted">No records.</div>';
    document.getElementById(elId).innerHTML = html;
  }
  load('inprog','inprog'); load('await','await'); load('approved','approved');

  document.getElementById('gen').onclick = async ()=>{
    const id = document.getElementById('clid').value.trim();
    if(!id) return alert('Enter ID');
    const r = await fetch('/api/admin/genlink', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id})});
    const d = await r.json();
    document.getElementById('link').innerHTML = d.url ? '<a href="'+d.url+'" target="_blank">'+d.url+'</a>' : 'Failed';
  };

  document.getElementById('genc').onclick = async ()=>{
    const linkid = document.getElementById('linkid').value.trim();
    if(!linkid) return alert('Enter linkid');
    const r = await fetch('/api/otp/send', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({linkid})});
    const d = await r.json().catch(()=>({}));
    document.getElementById('code').textContent = d.ok ? 'WhatsApp sent' : (d.error || 'Failed');
  };
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

async function adminList(url, env) {
  const mode = url.searchParams.get("mode") || "await";
  const list = await env.ONBOARD_KV.list({ prefix: "onboard/" });
  const out = [];
  for (const k of list.keys) {
    const s = await env.ONBOARD_KV.get(k.name, "json");
    if (!s) continue;
    const linkid = k.name.split("/")[1];
    const updated = s.last_time || s.created || 0;
    if (mode === "inprog" && !s.agreement_signed) out.push({ linkid, id: s.id, updated });
    if (mode === "await"  && s.status === "pending") out.push({ linkid, id: s.id, updated });
    if (mode === "approved" && s.status === "approved") out.push({ linkid, id: s.id, updated });
  }
  out.sort((a,b)=> b.updated - a.updated);
  return json({ items: out });
}

async function genLink(request, env) {
  const { id } = await request.json().catch(()=> ({}));
  if (!id) return jerr("Missing id", 400);
  const token = Math.random().toString(36).slice(2,10);
  const linkid = `${id}_${token}`;
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
  return json({ url: `${env.PUBLIC_ORIGIN || "https://onboard.vinet.co.za"}/onboard/${linkid}` });
}

async function adminApprove(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return jerr("Missing linkid", 400);
  const s = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!s) return jerr("Not found", 404);
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...s, status: "approved", approved_at: Date.now() }), { expirationTtl: 86400 });
  return json({ ok: true });
}
async function adminReject(request, env) {
  const { linkid, reason } = await request.json().catch(()=> ({}));
  if (!linkid) return jerr("Missing linkid", 400);
  const s = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!s) return jerr("Not found", 404);
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...s, status:"rejected", reason:String(reason||"").slice(0,300) }), { expirationTtl: 86400 });
  return json({ ok: true });
}

// ------------------------ Onboarding UI ------------------------
async function onboardHTML(linkid, request, env) {
  const [id, token] = (linkid || "").split("_");
  if (!id || !token) return new Response("Invalid link", { status: 400 });

  // fetch profile (customer or lead)
  const prof = await fetchSplynxProfile(env, id);
  const firstName = prof.first_name || "";
  const lastName  = prof.last_name  || "";
  const idNumber  = prof.passport   || ""; // Splynx "passport"
  const street    = (prof.street_1 || prof.street || "") || "";
  const city      = prof.city || "";
  const zip       = prof.zip_code || prof.zip || "";
  const phone     = prof.phone_mobile || prof.phone || "";
  const email     = prof.email || "";

  const TERMS_MSA_URL   = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const TERMS_DEBIT_URL = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>Vinet Onboarding</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
  header{background:#fff;box-shadow:0 1px 6px #0002;padding:16px;text-align:center}
  header img{max-width:200px}
  .wrap{max-width:760px;margin:20px auto;padding:0 12px}
  .step{background:#fff;margin:16px 0;padding:16px;border-radius:12px;box-shadow:0 1px 6px #0002}
  h2{color:#e2001a;margin:0 0 10px}
  label{font-weight:600;display:block;margin-top:10px}
  input,select{width:100%;padding:10px;border:1px solid #dcdcdc;border-radius:8px;margin-top:6px}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
  .btn.out{background:#fff;color:#e2001a;border:2px solid #e2001a}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row>div{flex:1;min-width:240px}
  .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:8px;padding:10px;font-weight:700}
  .tick{transform:scale(1.6);margin-right:10px}
  canvas#sig{width:100%;height:180px;border:1px dashed #bbb;border-radius:10px;background:#fff;touch-action:none}
  .note{color:#666;font-size:.92em}
  .links a{display:block;margin:8px 0}
</style></head>
<body>
<header><img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet logo"></header>
<div class="wrap">
  <!-- 0 Welcome -->
  <div class="step" id="s0"><h2>Welcome to Vinet</h2>
    <p>We’ll guide you through a few quick steps to confirm your details and sign your agreements.</p>
    <button class="btn" id="start">Start</button>
  </div>

  <!-- 1 Payment method -->
  <div class="step" id="s1" style="display:none">
    <h2>Payment method</h2>
    <label>Choose one</label>
    <select id="pay"><option value="">— Select —</option><option value="EFT">EFT</option><option value="DEBIT">Debit order</option></select>

    <div id="eft" style="display:none;margin-top:10px">
      <div class="ref">Please use the correct EFT reference: REF <b>${id}</b></div>
      <div style="text-align:center;margin-top:10px">
        <button class="btn" type="button" onclick="window.open('/info/eft?id=${id}','_blank')">Print banking details</button>
      </div>
    </div>

    <div id="do" style="display:none;margin-top:10px">
      <div class="row">
        <div><label>Bank Account Holder Name</label><input id="do_name"></div>
        <div><label>Bank Account Holder ID no</label><input id="do_id"></div>
      </div>
      <div class="row">
        <div><label>Bank</label><input id="do_bank"></div>
        <div><label>Bank Account No</label><input id="do_acc"></div>
      </div>
      <div class="row">
        <div><label>Bank Account Type</label>
          <select id="do_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
        </div>
        <div><label>Debit Order Date</label>
          <select id="do_day"><option>1</option><option>7</option><option>15</option><option>25</option><option>29</option><option>30</option></select>
        </div>
      </div>
      <div style="margin-top:8px"><label><input id="do_ok" type="checkbox" class="tick"> I accept the Debit Order terms</label></div>
      <div style="margin-top:8px"><iframe src="${TERMS_DEBIT_URL}" style="width:100%;height:230px;border:1px solid #eee;border-radius:8px"></iframe></div>
    </div>

    <div class="row" style="margin-top:14px"><div><button class="btn out" id="b1">Back</button></div><div><button class="btn" id="n1">Continue</button></div></div>
  </div>

  <!-- 2 Personal info -->
  <div class="step" id="s2" style="display:none">
    <h2>Please verify your details and change if you see any errors</h2>
    <div class="row"><div><label>First name</label><input id="f_first" value="${escapeHtml(firstName)}"></div><div><label>Last name</label><input id="f_last" value="${escapeHtml(lastName)}"></div></div>
    <div class="row"><div><label>ID / Passport</label><input id="f_pass" value="${escapeHtml(idNumber)}"></div><div><label>Mobile</label><input id="f_phone" value="${escapeHtml(phone)}"></div></div>
    <label>Email</label><input id="f_email" value="${escapeHtml(email)}">
    <label>Street</label><input id="f_street" value="${escapeHtml(street)}">
    <div class="row"><div><label>City</label><input id="f_city" value="${escapeHtml(city)}"></div><div><label>ZIP</label><input id="f_zip" value="${escapeHtml(zip)}"></div></div>
    <div class="row" style="margin-top:14px"><div><button class="btn out" id="b2">Back</button></div><div><button class="btn" id="n2">Continue</button></div></div>
  </div>

  <!-- 3 Uploads -->
  <div class="step" id="s3" style="display:none">
    <h2>Please upload your supporting documents</h2>
    <p class="note">ID or Passport and proof of address (as per RICA regulations)</p>
    <div><label>Document 1</label><input id="u1" type="file" accept="image/*,application/pdf"></div>
    <div><label>Document 2 (optional)</label><input id="u2" type="file" accept="image/*,application/pdf"></div>
    <div class="row" style="margin-top:14px"><div><button class="btn out" id="b3">Back</button></div><div><button class="btn" id="n3">Continue</button></div></div>
  </div>

  <!-- 4 Service agreement -->
  <div class="step" id="s4" style="display:none">
    <h2>Vinet Service Agreement</h2>
    <div style="margin-bottom:8px"><iframe src="${TERMS_MSA_URL}" style="width:100%;height:260px;border:1px solid #eee;border-radius:8px"></iframe></div>
    <label><input id="msa_ok" type="checkbox" class="tick"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label>
    <div style="margin-top:10px">
      <label>Draw your signature</label>
      <canvas id="sig"></canvas>
      <div style="margin-top:8px"><button class="btn out" id="clearSig">Clear</button></div>
    </div>
    <div class="row" style="margin-top:14px"><div><button class="btn out" id="b4">Back</button></div><div><button class="btn" id="finish">Finish & Sign</button></div></div>
  </div>

  <!-- 5 Done -->
  <div class="step" id="s5" style="display:none">
    <h2>All set!</h2>
    <p>Thanks - we've recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at 021 007 0200 / sales@vinetco.za</p>
    <div id="dl" class="links"></div>
  </div>
</div>

<script>
  const linkid=${JSON.stringify(linkid)}, idOnly=${JSON.stringify(id)};
  const state={ pay:"", debit:null, info:{}, uploads:[], device:navigator.userAgent, browser:navigator.userAgent, ip:"" };

  // show helper
  const show=i=>{ for(let s=0;s<=5;s++){ const el=document.getElementById('s'+s); if(el) el.style.display=(s===i?'block':'none'); } };

  // start
  document.getElementById('start').onclick=()=>show(1);

  // pay step
  const sel=document.getElementById('pay'), eft=document.getElementById('eft'), dob=document.getElementById('do');
  sel.onchange=()=>{ const v=sel.value; eft.style.display=(v==='EFT')?'block':'none'; dob.style.display=(v==='DEBIT')?'block':'none'; };
  document.getElementById('b1').onclick=()=>show(0);
  document.getElementById('n1').onclick=()=>{ const v=sel.value; if(!v) return alert('Select a payment method'); if(v==='DEBIT' && !document.getElementById('do_ok').checked) return alert('Please accept the Debit Order terms');
    state.pay=v;
    state.debit=(v==='DEBIT')?{account_holder:val('do_name'),id_number:val('do_id'),bank_name:val('do_bank'),account_number:val('do_acc'),account_type:val('do_type'),debit_day:val('do_day')} : null;
    show(2);
  };

  // info
  document.getElementById('b2').onclick=()=>show(1);
  document.getElementById('n2').onclick=()=>{ state.info={ first_name:val('f_first'), last_name:val('f_last'), passport:val('f_pass'), phone:val('f_phone'), email:val('f_email'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') }; show(3); };

  // uploads
  document.getElementById('b3').onclick=()=>show(2);
  document.getElementById('n3').onclick=async()=>{ state.uploads=[]; const f1=gid('u1').files[0]; const f2=gid('u2').files[0];
    if(f1) state.uploads.push(await up(linkid,f1)); if(f2) state.uploads.push(await up(linkid,f2)); show(4); };
  async function up(linkid,file){ const u='/api/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name); const buf=await file.arrayBuffer(); const r=await fetch(u,{method:'POST',body:buf}); return await r.json().catch(()=>({})); }

  // signature pad
  const canvas=document.getElementById('sig'), ctx=canvas.getContext('2d'); let drawing=false,last=null;
  function resize(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*s); canvas.height=Math.floor(180*s); ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
  function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
  function down(e){ drawing=true; last=pos(e); e.preventDefault(); }
  function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
  function up(){ drawing=false; last=null; }
  window.addEventListener('resize',resize); resize();
  canvas.addEventListener('mousedown',down); window.addEventListener('mouseup',up); canvas.addEventListener('mousemove',move);
  canvas.addEventListener('touchstart',down,{passive:false}); window.addEventListener('touchend',up); canvas.addEventListener('touchmove',move,{passive:false});
  document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); };

  document.getElementById('b4').onclick=()=>show(3);
  document.getElementById('finish').onclick=async()=>{
    if(!document.getElementById('msa_ok').checked) return alert('Please confirm the agreement');
    const signature=canvas.toDataURL('image/png');
    const body={ linkid, id:idOnly, state, signature };
    const r=await fetch('/api/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    show(5);
    const dl=document.getElementById('dl'); const links=[];
    if(d.msa_url) links.push('<a target="_blank" href="'+d.msa_url+'">Download Vinet Service Agreement (MSA)</a>');
    if(d.do_url)  links.push('<a target="_blank" href="'+d.do_url+'">Download Debit Order Agreement</a>');
    dl.innerHTML=links.join('');
  };

  // utils
  function gid(id){ return document.getElementById(id); }
  function val(id){ return (gid(id)?.value||'').trim(); }

  // boot
  show(0);
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

// ------------------------ Info pages ------------------------
async function eftHTML(id) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>EFT Details</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
  .card{max-width:720px;margin:24px auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 1px 6px #0002}
  .logo{display:block;margin:0 auto 8px;max-width:160px}
  h2{color:#e2001a;margin:8px 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .f{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
  .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:10px;padding:10px;font-weight:700}
  .c{text-align:center}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO}" alt="">
  <h2>Banking details</h2>
  <div class="grid">
    <div class="f"><b>Bank</b><br>First National Bank (FNB/RMB)</div>
    <div class="f"><b>Account name</b><br>Vinet Internet Solutions</div>
    <div class="f"><b>Account number</b><br>62757054996</div>
    <div class="f"><b>Branch code</b><br>250655</div>
  </div>
  <div class="ref" style="margin-top:10px">Please use the correct EFT reference: <b>REF ${id || ""}</b></div>
  <p style="color:#666">All accounts are payable on or before the 1st of every month.</p>
  <div class="c"><button class="btn" onclick="window.print()">Print banking details</button></div>
</div></body></html>`;
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

async function debitOrderHTML(id, env) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  let terms = "";
  try { const r = await fetch(termsUrl); terms = r.ok ? await r.text() : ""; } catch {}
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Debit Order</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
  .card{max-width:760px;margin:24px auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 1px 6px #0002}
  .logo{display:block;margin:0 auto 8px;max-width:160px}
  h2{color:#e2001a;margin:8px 0 12px}
  label{font-weight:600;display:block;margin-top:10px}
  input,select{width:100%;padding:10px;border:1px solid #dcdcdc;border-radius:8px;margin-top:6px}
  .tick{transform:scale(1.6);margin-right:10px}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  .row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:240px}
  pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO}" alt="">
  <h2>Debit order details</h2>
  <form method="POST" action="/api/debit/save">
    <input type="hidden" name="splynx_id" value="${id || ""}">
    <div class="row">
      <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
      <div><label>Bank Account Holder ID no</label><input name="id_number" required></div>
    </div>
    <div class="row">
      <div><label>Bank</label><input name="bank_name" required></div>
      <div><label>Bank Account No</label><input name="account_number" required></div>
    </div>
    <div class="row">
      <div><label>Bank Account Type</label>
        <select name="account_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
      </div>
      <div><label>Debit order date</label>
        <select name="debit_day"><option>1</option><option>7</option><option>15</option><option>25</option><option>29</option><option>30</option></select>
      </div>
    </div>
    <div style="margin-top:10px"><label><input class="tick" type="checkbox" name="agree" required> I accept the Debit Order terms</label></div>
    <pre>${escapeHtml(terms || "Terms unavailable.")}</pre>
    <div style="margin-top:10px"><button class="btn" type="submit">Submit</button></div>
  </form>
</div></body></html>`;
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

async function termsHTML(url, env) {
  const pay = (url.searchParams.get("pay") || "").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  async function get(u){ try{ const r=await fetch(u); return r.ok?await r.text():""; }catch{ return ""; } }
  const svc = await get(svcUrl);
  const deb = pay === "debit" ? await get(debUrl) : "";
  const html = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${escapeHtml(svc)}</pre>` + (deb ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${escapeHtml(deb)}</pre>` : "");
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

// ------------------------ OTP ------------------------
async function sendOtp(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return jerr("Missing linkid", 400);
  const splynxId = (linkid.split("_")[0] || "").trim();
  const msisdn = await findMsisdn(env, splynxId);
  if (!msisdn) return jerr("No WhatsApp number on file", 404);

  const code = String(Math.floor(100000 + Math.random()*900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });

  try {
    await waSendTemplate(env, msisdn, code);
    return json({ ok: true });
  } catch {
    try {
      await waSendText(env, msisdn, `Your Vinet verification code is: ${code}`);
      return json({ ok: true, note: "sent-as-text" });
    } catch {
      return jerr("WhatsApp send failed", 502);
    }
  }
}

async function verifyOtp(request, env) {
  const { linkid, otp } = await request.json().catch(()=> ({}));
  if (!linkid || !otp) return jerr("Missing params", 400);
  const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
  return json({ ok: !!code && code === otp });
}

// ------------------------ Progress & Uploads ------------------------
async function saveProgress(linkid, request, env) {
  const body = await request.json().catch(()=> ({}));
  const cur = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || {};
  const next = { ...cur, ...body, last_time: Date.now() };
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
  return json({ ok: true });
}

async function handleUpload(request, env) {
  const u = new URL(request.url);
  const linkid = u.searchParams.get("linkid") || "";
  const name   = u.searchParams.get("filename") || "file.bin";
  if (!linkid) return jerr("Missing linkid", 400);
  const buf = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${name}`;
  await env.R2_UPLOADS.put(key, buf);
  return json({ ok: true, key, url: `https://onboarding-uploads.vinethosting.org/${key}` });
}

// ------------------------ Finalize (PDFs) ------------------------
async function finalizeSubmission(request, env) {
  const { linkid, id, state, signature } = await request.json().catch(()=> ({}));
  if (!linkid || !id || !state || !signature) return jerr("Missing data", 400);

  // Save signature PNG
  const png64 = (signature.split(",")[1] || "");
  const sigBytes = Uint8Array.from(atob(png64), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata: { contentType: "image/png" } });

  // Build PDFs
  const msaOut = await buildMsaPdf(env, id, linkid, state, sigBytes);
  const doOut  = state.pay === "DEBIT" ? await buildDoPdf(env, id, linkid, state, sigBytes) : null;

  // Store to R2
  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaOut, { httpMetadata: { contentType: "application/pdf" } });
  let doKey = null;
  if (doOut) {
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doOut, { httpMetadata: { contentType: "application/pdf" } });
  }

  const pub = "https://onboarding-uploads.vinethosting.org";
  const resp = { ok: true, msa_url: `${pub}/${msaKey}` };
  if (doKey) resp.do_url = `${pub}/${doKey}`;

  // mark session pending approval
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || { id };
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status: "pending", agreement_signed: true, last_time: Date.now() }), { expirationTtl: 86400 });

  return json(resp);
}

// ------------------------ PDF builders ------------------------
async function buildMsaPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.MSA_TEMPLATE_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
  const res = await fetch(tplUrl);
  const tpl = await res.arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm ? pdf.getForm() : null;

  const fields = {
    full_name: `${state.info.first_name || ""} ${state.info.last_name || ""}`.trim(),
    passport: state.info.passport || "",
    customer_id: String(id),
    email: state.info.email || "",
    phone: state.info.phone || "",
    street: state.info.street || "",
    city: state.info.city || "",
    zip: state.info.zip || "",
    date: catNow(),
  };
  if (form) {
    for (const [k,v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature on page 4 near bottom right
  try {
    const png = await pdf.embedPng(sigBytes);
    const idx = Math.min(3, pdf.getPageCount()-1);
    const page = pdf.getPage(idx);
    const { width } = page.getSize();
    const sigW = 180, sigH = 60;
    page.drawImage(png, { x: width - sigW - 80, y: 90, width: sigW, height: sigH });
  } catch {}

  // Security stamp page
  appendStampPage(pdf, state);

  return await pdf.save();
}

async function buildDoPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.DO_TEMPLATE_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";
  const res = await fetch(tplUrl);
  const tpl = await res.arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm ? pdf.getForm() : null;

  const d = state.debit || {};
  const fields = {
    account_holder: d.account_holder || "",
    id_number: d.id_number || "",
    bank_name: d.bank_name || "",
    account_number: d.account_number || "",
    account_type: d.account_type || "",
    debit_day: String(d.debit_day || ""),
    customer_id: String(id),
    date: catNow(),
  };
  if (form) {
    for (const [k,v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature between Debit Order Date and Date fields (approx lower middle)
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(0);
    const { width } = page.getSize();
    const sigW = 180, sigH = 60;
    page.drawImage(png, { x: width/2 - sigW/2, y: 120, width: sigW, height: sigH });
  } catch {}

  appendStampPage(pdf, state);
  return await pdf.save();
}

function appendStampPage(pdf, state) {
  const page = pdf.addPage([595,842]); // A4
  let font = null; try { font = pdf.embedStandardFont(StandardFonts.Helvetica); } catch {}
  const draw = (t,x,y,s=12)=>{ try{ page.drawText(t,{x,y,size:s,font,color:rgb(0,0,0)});}catch{} };
  let y = 800;
  draw("Security Verification", 40, y, 18); y -= 24;
  draw("Date/time (CAT): " + catNow(), 40, y); y -= 18;
  draw("Device: " + (state.device || "n/a"), 40, y); y -= 18;
  draw("Browser: " + (state.browser || "n/a"), 40, y); y -= 18;
  draw("IP: " + (state.ip || "n/a"), 40, y);
}

// ------------------------ Splynx + WhatsApp ------------------------
async function fetchSplynxProfile(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  const eps = [
    `/admin/customers/customer/${id}`,
    `/crm/leads/${id}`
  ];
  for (const ep of eps) {
    try {
      const r = await fetch(base + ep, { headers });
      if (r.ok) return await r.json();
    } catch {}
  }
  return {};
}

function pickPhone(obj) {
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  if (!obj) return null;
  if (typeof obj === "string" && ok(obj)) return obj.trim();
  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string" && ok(v)) return v.trim();
      const deep = pickPhone(v); if (deep) return deep;
    }
  }
  return null;
}
async function findMsisdn(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  for (const ep of [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}`,
    `/crm/leads/${id}/contacts`
  ]) {
    try {
      const r = await fetch(base + ep, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      const m = pickPhone(data);
      if (m) return m;
    } catch {}
  }
  return null;
}

async function waSendTemplate(env, to, code) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type:"text", text: code }] },
        { type: "button", sub_type:"url", index:"0", parameters:[{ type:"text", text: code.slice(-6) }] }
      ]
    }
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}
async function waSendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

// ------------------------ Debit save API (for /info/debit form POST) ------------------------
async function debitSaveFromForm(request, env) {
  const form = await request.formData();
  const rec = {
    splynx_id:  String(form.get("splynx_id") || "").trim(),
    account_holder: String(form.get("account_holder") || "").trim(),
    id_number:      String(form.get("id_number") || "").trim(),
    bank_name:      String(form.get("bank_name") || "").trim(),
    account_number: String(form.get("account_number") || "").trim(),
    account_type:   String(form.get("account_type") || "").trim(),
    debit_day:      String(form.get("debit_day") || "").trim(),
    agree:          !!form.get("agree"),
    created: Date.now()
  };
  if (!rec.splynx_id || !rec.account_holder || !rec.id_number || !rec.bank_name || !rec.account_number || !rec.account_type || !rec.debit_day || !rec.agree) {
    return jerr("Missing fields", 400);
  }
  const key = `debit/${rec.splynx_id}/${rec.created}`;
  await env.ONBOARD_KV.put(key, JSON.stringify(rec), { expirationTtl: 60*60*24*90 });
  // also mark in onboard KV if exists
  const list = await env.ONBOARD_KV.list({ prefix: "onboard/" });
  for (const k of list.keys) {
    if ((await env.ONBOARD_KV.get(k.name, "json"))?.id == rec.splynx_id) {
      const s = await env.ONBOARD_KV.get(k.name, "json");
      await env.ONBOARD_KV.put(k.name, JSON.stringify({ ...s, last_time: Date.now() }), { expirationTtl: 86400 });
    }
  }
  return json({ ok: true, ref: key });
}

// PATCH: route binder for /api/debit/save (form POST)
async function debitOrderHTML_Handler(request, env) {
  if (request.method === "POST") return debitSaveFromForm(request, env);
  const url = new URL(request.url);
  return debitOrderHTML(url.searchParams.get("id") || "", env);
}

// NOTE: If you prefer handling /info/debit via GET only, keep debitOrderHTML; if you want form POST, map route:
// in fetch(), replace `if (path === "/info/debit" && request.method === "GET")` with handler:
// if (path === "/info/debit") return debitOrderHTML_Handler(request, env);

// ------------------------ R2 passthrough ------------------------
async function serveR2(key, env) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status:404 });
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "content-type": ct } });
}
