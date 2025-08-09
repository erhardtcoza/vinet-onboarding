// index.js – Vinet Onboarding Worker (PDF on sign, R2 public, debit/EFT fixes, admin endpoints)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Restrict admin & API to your IP range
      const clientIP = request.headers.get("cf-connecting-ip") || "";
      const mustCheckIP = path === "/" || path.startsWith("/admin") || path.startsWith("/api");
      if (mustCheckIP && !ipInRange(clientIP, "160.226.128.0/20")) {
        return new Response("Access denied", { status: 403 });
      }

      // Routes
      if (path === "/") return renderAdmin(env);
      if (path.startsWith("/onboard/")) return onboardHTML(path.split("/")[2], env);

      // Admin/API helpers
      if (path.startsWith("/api/genlink")) return apiGenLink(request, env);
      if (path.startsWith("/api/staff/gen")) return apiStaffGen(request, env);

      // OTP
      if (path.startsWith("/api/otp/send")) return sendOtp(request, env);
      if (path.startsWith("/api/otp/verify")) return verifyOtp(request, env);

      // Progress & finalize
      if (path.startsWith("/api/progress/")) return saveProgress(path.split("/")[3], request, env);
      if (path.startsWith("/api/finalize")) return finalizeSubmission(request, env);

      // Uploads + Debit order save (standalone page)
      if (path.startsWith("/api/upload")) return handleUpload(request, env);
      if (path.startsWith("/api/debit/save")) return apiDebitSave(request, env);

      // Info pages
      if (path.startsWith("/info/eft")) return eftHTML(url.searchParams.get("id"));
      if (path.startsWith("/info/debit")) return debitOrderHTML(url.searchParams.get("id"), env);

      // Optional internal R2 serve
      if (path.startsWith("/r2/")) return serveR2(path.replace("/r2/", ""), env);

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Worker exception: " + err.message, { status: 500 });
    }
  }
};

/* ==================== IP helpers ==================== */
function ipInRange(ip, cidr) {
  const [range, bitsStr = "32"] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}
function ipToInt(ip) {
  const p = (ip || "").split(".").map(x => parseInt(x, 10));
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return 0;
  return (((p[0] << 24) >>> 0) + ((p[1] << 16) >>> 0) + ((p[2] << 8) >>> 0) + (p[3] >>> 0)) >>> 0;
}

/* ==================== Admin page ==================== */
async function renderAdmin(env) {
  const html = `
  <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vinet Onboarding Admin</title>
  <style>
    body { font-family: system-ui, sans-serif; padding:20px; background:#f4f4f4; }
    h1 { color:#e2001a; text-align:center; }
    .grid { display:grid; grid-template-columns: repeat(2,1fr); gap:20px; max-width:1100px; margin:0 auto; }
    .section { background:#fff; padding:20px; border-radius:12px; box-shadow:0 2px 8px #0002; }
    input { padding:10px; border:1px solid #ddd; border-radius:8px; width:70%; }
    button { padding:10px 14px; background:#e2001a; color:#fff; border:0; border-radius:8px; cursor:pointer; }
    .link-output { margin-top:10px; font-weight:600; background:#fafafa; padding:8px; border-radius:8px; word-break:break-all; }
    .muted { color:#666; font-size:.9em }
  </style>
  </head><body>
    <h1>Vinet Onboarding Admin</h1>
    <div class="grid">
      <div class="section">
        <h2>1. Generate onboarding link</h2>
        <p class="muted">Enter Splynx customer/lead ID</p>
        <input id="clientId" placeholder="e.g. 319" />
        <button onclick="genLink()">Generate</button>
        <div id="linkResult" class="link-output"></div>
      </div>
      <div class="section">
        <h2>2. Generate verification code (staff)</h2>
        <p class="muted">Enter a full onboarding link ID (e.g. 319_ab12cd34)</p>
        <input id="linkId" placeholder="e.g. 319_ab12cd34" />
        <button onclick="genStaff()">Generate</button>
        <div id="staffOut" class="link-output"></div>
      </div>
      <div class="section">
        <h2>3. Pending (in-progress)</h2>
        <p class="muted">Coming soon</p>
      </div>
      <div class="section">
        <h2>4. Completed (awaiting approval)</h2>
        <p class="muted">Coming soon</p>
      </div>
      <div class="section">
        <h2>5. Approved</h2>
        <p class="muted">Coming soon</p>
      </div>
    </div>
    <script>
      async function genLink(){
        const id = (document.getElementById('clientId').value||'').trim();
        if(!id) return alert('Enter client ID');
        const r = await fetch('/api/genlink?id='+encodeURIComponent(id));
        const d = await r.json().catch(()=>({}));
        document.getElementById('linkResult').innerHTML = d.url
          ? '<a href="'+d.url+'" target="_blank">'+d.url+'</a>'
          : 'Failed to generate link';
      }
      async function genStaff(){
        const linkid = (document.getElementById('linkId').value||'').trim();
        if(!linkid || !linkid.includes('_')) return alert('Enter a full link ID, e.g. 319_ab12cd34');
        const r = await fetch('/api/staff/gen', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid }) });
        const d = await r.json().catch(()=>({}));
        document.getElementById('staffOut').textContent = d.ok ? ('Staff code: '+d.code+' (valid 15 min)') : (d.error||'Failed');
      }
    </script>
  </body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/* ==================== Onboarding (single, final version) ==================== */
async function onboardHTML(linkId, env) {
  const [id, token] = (linkId || "").split("_");
  if (!id || !token) return new Response("Invalid link", { status: 400 });

  const prof = await fetchSplynxProfile(env, id);
  const firstName = prof.first_name || "";
  const lastName  = prof.last_name  || "";
  const idNumber  = prof.passport   || "";
  const street    = (prof.street_1 || prof.street || "") || "";
  const city      = prof.city || "";
  const zip       = prof.zip_code || prof.zip || "";
  const phone     = prof.phone_mobile || prof.phone || "";
  const email     = prof.email || "";

  const TERMS_MSA_URL   = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const TERMS_DEBIT_URL = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vinet Onboarding</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f4f4f4; margin:0; }
    header { background:#fff; padding:16px; text-align:center; box-shadow:0 1px 4px #0001; }
    header img { max-width: 200px; height:auto; }
    .wrap { max-width:760px; margin:20px auto; padding:0 12px; }
    .step { background:#fff; margin:16px 0; padding:16px; border-radius:12px; box-shadow:0 1px 6px #0002; }
    h2 { color:#e2001a; margin:0 0 10px; }
    label { font-weight:600; display:block; margin-top:10px; }
    input, select { width:100%; padding:10px; border:1px solid #dcdcdc; border-radius:8px; margin-top:6px; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:8px; padding:10px 18px; cursor:pointer; }
    .btn.outline { background:#fff; color:#e2001a; border:2px solid #e2001a; }
    .row { display:flex; gap:12px; flex-wrap:wrap; }
    .row > div { flex:1; min-width:240px; }
    .note { color:#666; font-size:0.92em; }
    .tick { transform:scale(1.6); margin-right:10px; }
    .ref { background:#fff7d6; border:1px dashed #e0b400; padding:10px; border-radius:8px; font-weight:700; }
    .center { text-align:center; }
    canvas#sig { width:100%; height:180px; border:1px dashed #bbb; border-radius:10px; background:#fff; touch-action:none; }
    .links a { display:block; margin:8px 0; }
  </style></head><body>
  <header><img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet logo"></header>
  <div class="wrap">
    <!-- Step 0 -->
    <div class="step" id="s0">
      <h2>Welcome to Vinet</h2>
      <p>We’ll guide you through a few quick steps to confirm your details and sign your agreements.</p>
      <button class="btn" id="startBtn">Start</button>
    </div>

    <!-- Step 1: Payment -->
    <div class="step" id="s1" style="display:none">
      <h2>Payment Method</h2>
      <label>Choose one</label>
      <select id="pay">
        <option value="">— Select —</option>
        <option value="EFT">EFT</option>
        <option value="DEBIT">Debit order</option>
      </select>

      <div id="eftBox" style="display:none; margin-top:12px;">
        <div class="ref">Please use the correct reference when making EFT payments: REF <span>${id}</span></div>
        <div class="center" style="margin-top:10px;">
          <button class="btn" type="button" onclick="window.open('/info/eft?id=${id}','_blank')">Print banking details</button>
        </div>
      </div>

      <div id="doBox" style="display:none; margin-top:12px;">
        <div class="row">
          <div><label>Bank Account Holder Name</label><input id="do_name"></div>
          <div><label>Bank Account Holder ID no</label><input id="do_id"></div>
        </div>
        <div class="row">
          <div><label>Bank</label><input id="do_bank"></div>
          <div><label>Bank Account No</label><input id="do_acc"></div>
        </div>
        <div class="row">
          <div>
            <label>Bank Account Type</label>
            <select id="do_type">
              <option value="cheque">Cheque</option>
              <option value="savings">Savings</option>
              <option value="transmission">Transmission</option>
            </select>
          </div>
          <div>
            <label>Debit Order Date</label>
            <select id="do_day">
              <option value="1">1st</option><option value="7">7th</option><option value="15">15th</option>
              <option value="25">25th</option><option value="29">29th</option><option value="30">30th</option>
            </select>
          </div>
        </div>
        <div style="margin-top:10px;">
          <label><input id="do_agree" type="checkbox" class="tick"> I accept the Debit Order terms</label>
        </div>
        <div style="margin-top:8px;">
          <iframe src="${TERMS_DEBIT_URL}" style="width:100%;height:220px;border:1px solid #eee;border-radius:8px;"></iframe>
        </div>
      </div>

      <div class="row" style="margin-top:14px;">
        <div><button class="btn outline" id="s1Back">Back</button></div>
        <div class="center"><button class="btn" id="s1Next">Continue</button></div>
      </div>
    </div>

    <!-- Step 2: Personal info -->
    <div class="step" id="s2" style="display:none">
      <h2>Please verify your details and change if you see any errors</h2>
      <div class="row">
        <div><label>First name</label><input id="f_first" value="${escapeHtml(firstName)}"></div>
        <div><label>Last name</label><input id="f_last" value="${escapeHtml(lastName)}"></div>
      </div>
      <div class="row">
        <div><label>ID / Passport</label><input id="f_passport" value="${escapeHtml(idNumber)}"></div>
        <div><label>Mobile</label><input id="f_phone" value="${escapeHtml(phone)}"></div>
      </div>
      <label>Email</label><input id="f_email" value="${escapeHtml(email)}">
      <label>Street</label><input id="f_street" value="${escapeHtml(street)}">
      <div class="row">
        <div><label>City</label><input id="f_city" value="${escapeHtml(city)}"></div>
        <div><label>ZIP</label><input id="f_zip" value="${escapeHtml(zip)}"></div>
      </div>
      <div class="row" style="margin-top:14px;">
        <div><button class="btn outline" id="s2Back">Back</button></div>
        <div class="center"><button class="btn" id="s2Next">Continue</button></div>
      </div>
    </div>

    <!-- Step 3: Upload docs -->
    <div class="step" id="s3" style="display:none">
      <h2>Please upload your supporting documents</h2>
      <p class="note">ID or Passport and proof of address (as per RICA regulations)</p>
      <div><label>Document 1</label><input id="up1" type="file" accept="image/*,application/pdf"></div>
      <div><label>Document 2 (optional)</label><input id="up2" type="file" accept="image/*,application/pdf"></div>
      <div class="row" style="margin-top:14px;">
        <div><button class="btn outline" id="s3Back">Back</button></div>
        <div class="center"><button class="btn" id="s3Next">Continue</button></div>
      </div>
    </div>

    <!-- Step 4: MSA -->
    <div class="step" id="s4" style="display:none">
      <h2>Vinet Service Agreement</h2>
      <div style="margin-bottom:8px;">
        <iframe src="${TERMS_MSA_URL}" style="width:100%;height:260px;border:1px solid #eee;border-radius:8px;"></iframe>
      </div>
      <label><input id="msa_ok" type="checkbox" class="tick"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label>
      <div style="margin-top:10px;">
        <label>Draw your signature</label>
        <canvas id="sig"></canvas>
        <div class="row" style="margin-top:8px;">
          <div><button class="btn outline" id="clearSig">Clear</button></div>
        </div>
      </div>
      <div class="row" style="margin-top:14px;">
        <div><button class="btn outline" id="s4Back">Back</button></div>
        <div class="center"><button class="btn" id="finishBtn">Finish & Sign</button></div>
      </div>
    </div>

    <!-- Step 5: Done -->
    <div class="step" id="s5" style="display:none">
      <h2>All set!</h2>
      <p>Thanks - we've recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at 021 007 0200 / sales@vinetco.za</p>
      <div id="dl" class="links"></div>
    </div>
  </div>

  <script>
    const linkid = ${JSON.stringify(linkId)};
    const idOnly = ${JSON.stringify(id)};
    const state = { pay:"", debit:null, info:{}, uploads:[], device:navigator.userAgent, browser:navigator.userAgent, ip:"" };

    // try fetch IP for stamp (best effort)
    try { fetch('https://www.cloudflare.com/cdn-cgi/trace').then(r=>r.text()).then(t=>{
      const m = /ip=(.+)/.exec(t); if (m) state.ip = m[1].trim();
    }); } catch {}

    const show = i => { for (let n=0;n<=5;n++) document.getElementById('s'+n).style.display = (n===i?'block':'none'); };
    document.getElementById('startBtn').onclick = () => { show(1); };

    const sel = document.getElementById('pay'), eftBox = document.getElementById('eftBox'), doBox = document.getElementById('doBox');
    sel.onchange = () => { const v = sel.value; eftBox.style.display = v==='EFT' ? 'block' : 'none'; doBox.style.display = v==='DEBIT' ? 'block' : 'none'; };
    document.getElementById('s1Back').onclick = () => show(0);
    document.getElementById('s1Next').onclick = async () => {
      const v = sel.value;
      if (!v) return alert('Select a payment method');
      state.pay = v;
      if (v === 'DEBIT') {
        if (!document.getElementById('do_agree').checked) return alert('Please accept the Debit Order terms');
        state.debit = {
          account_holder: document.getElementById('do_name').value.trim(),
          id_number:      document.getElementById('do_id').value.trim(),
          bank_name:      document.getElementById('do_bank').value.trim(),
          account_number: document.getElementById('do_acc').value.trim(),
          account_type:   document.getElementById('do_type').value,
          debit_day:      document.getElementById('do_day').value
        };
      } else {
        state.debit = null;
      }
      show(2);
    };

    document.getElementById('s2Back').onclick = () => show(1);
    document.getElementById('s2Next').onclick = () => {
      state.info = {
        first_name: document.getElementById('f_first').value.trim(),
        last_name:  document.getElementById('f_last').value.trim(),
        passport:   document.getElementById('f_passport').value.trim(),
        phone:      document.getElementById('f_phone').value.trim(),
        email:      document.getElementById('f_email').value.trim(),
        street:     document.getElementById('f_street').value.trim(),
        city:       document.getElementById('f_city').value.trim(),
        zip:        document.getElementById('f_zip').value.trim(),
      };
      show(3);
    };

    document.getElementById('s3Back').onclick = () => show(2);
    document.getElementById('s3Next').onclick = async () => {
      const f1 = document.getElementById('up1').files[0];
      const f2 = document.getElementById('up2').files[0];
      state.uploads = [];
      if (f1) state.uploads.push(await doUpload(linkid, f1));
      if (f2) state.uploads.push(await doUpload(linkid, f2));
      show(4);
    };
    async function doUpload(linkid, file){
      const max = 5 * 1024 * 1024;
      if (file.size > max) { alert('Max file size 5 MB'); throw new Error('too big'); }
      const u = '/api/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name);
      const buf = await file.arrayBuffer();
      const r = await fetch(u, { method:'POST', body: buf });
      return await r.json().catch(()=>({}));
    }

    const canvas = document.getElementById('sig');
    const ctx = canvas.getContext('2d');
    let drawing=false, last=null;
    function resize(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*s); canvas.height=Math.floor(180*s); ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left, y:(t?t.clientY:e.clientY)-r.top}; }
    function down(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function up(){ drawing=false; last=null; }
    window.addEventListener('resize', resize); resize();
    canvas.addEventListener('mousedown',down); window.addEventListener('mouseup',up); canvas.addEventListener('mousemove',move);
    canvas.addEventListener('touchstart',down,{passive:false}); window.addEventListener('touchend',up); canvas.addEventListener('touchmove',move,{passive:false});
    document.getElementById('clearSig').onclick = (e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); };

    document.getElementById('s4Back').onclick = () => show(3);
    document.getElementById('finishBtn').onclick = async () => {
      if (!document.getElementById('msa_ok').checked) return alert('Please confirm the agreement');
      const sig = canvas.toDataURL('image/png');
      const body = { linkid, id: idOnly, state, signature: sig };
      const r = await fetch('/api/finalize', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await r.json().catch(()=>({}));
      show(5);
      const dl = document.getElementById('dl');
      const links = [];
      if (d.msa_url) links.push('<a target="_blank" href="'+d.msa_url+'">Download Vinet Service Agreement (MSA)</a>');
      if (d.do_url)  links.push('<a target="_blank" href="'+d.do_url+'">Download Debit Order Agreement</a>');
      dl.innerHTML = links.join('');
    };

    show(0);
  </script>
  </body></html>`;

  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

function escapeHtml(s=""){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function fetchSplynxProfile(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  for (const ep of [
    `/admin/customers/customer/${id}`,
    `/crm/leads/${id}`
  ]) {
    try { const r = await fetch(base + ep, { headers }); if (r.ok) return await r.json(); } catch {}
  }
  return {};
}

/* ==================== Admin/API endpoints ==================== */

async function apiGenLink(request, env) {
  const u = new URL(request.url);
  const id = (u.searchParams.get("id") || "").trim();
  if (!id) return json({ error:"Missing id" }, 400);
  const token = Math.random().toString(36).slice(2, 10);
  const linkid = `${id}_${token}`;
  // optional: store session shell
  try {
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now() }), { expirationTtl: 86400 });
  } catch {}
  const origin = u.origin;
  return json({ url: `${origin}/onboard/${linkid}` });
}

async function apiStaffGen(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  const code = String(Math.floor(100000 + Math.random()*900000));
  try {
    await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
  } catch {}
  return json({ ok:true, code });
}

/* ==================== Info pages ==================== */

async function eftHTML(id) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>EFT Details</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
    .card{max-width:720px;margin:24px auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 1px 6px #0002}
    .logo{display:block;margin:0 auto 8px;max-width:160px}
    h2{color:#e2001a;margin:8px 0 12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .f{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
    .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:10px;padding:10px;font-weight:700}
    .c{text-align:center}
    .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  </style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO}">
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
  </div></body></html>`, { headers: { "content-type":"text/html; charset=utf-8" }});
}

async function debitOrderHTML(id, env) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  let terms = "Terms unavailable.";
  try { const r = await fetch(termsUrl); terms = r.ok ? await r.text() : terms; } catch {}
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Debit Order</title>
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
    <img class="logo" src="${LOGO}">
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
        <div>
          <label>Bank Account Type</label>
          <select name="account_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
        </div>
        <div>
          <label>Debit order date</label>
          <select name="debit_day"><option value="1">1st</option><option value="7">7th</option><option value="15">15th</option><option value="25">25th</option><option value="29">29th</option><option value="30">30th</option></select>
        </div>
      </div>
      <div style="margin-top:10px"><label><input class="tick" type="checkbox" name="agree" required> I accept the Debit Order terms</label></div>
      <pre>${escapeHtml(terms)}</pre>
      <div style="margin-top:10px"><button class="btn" type="submit">Submit</button></div>
    </form>
  </div></body></html>`, { headers: { "content-type":"text/html; charset=utf-8" }});
}

/* ==================== OTP ==================== */

async function sendOtp(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  const splynxId = (linkid.split("_")[0] || "").trim();

  const msisdn = await findMsisdn(env, splynxId);
  if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

  const code = String(Math.floor(100000 + Math.random()*900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });

  try {
    await waSendTemplate(env, msisdn, code);
    return json({ ok:true });
  } catch {
    try {
      await waSendText(env, msisdn, `Your Vinet verification code is: ${code}`);
      return json({ ok:true, note:"sent-as-text" });
    } catch {
      return json({ ok:false, error:"WhatsApp send failed" }, 502);
    }
  }
}

async function verifyOtp(request, env) {
  const { linkid, otp } = await request.json().catch(()=> ({}));
  if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
  const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
  return json({ ok: !!code && code === otp });
}

/* ==================== Save progress & uploads ==================== */

async function saveProgress(linkid, request, env) {
  const body = await request.json().catch(()=> ({}));
  const cur = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || {};
  const next = { ...cur, ...body, last_time: Date.now() };
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
  return json({ ok:true });
}

async function handleUpload(request, env) {
  const u = new URL(request.url);
  const linkid = u.searchParams.get("linkid") || "";
  const name   = u.searchParams.get("filename") || "file.bin";
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  const buf = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${name}`;
  await env.R2_UPLOADS.put(key, buf);
  return json({ ok:true, key, url: `https://onboarding-uploads.vinethosting.org/${key}` });
}

/* ==================== Debit save (standalone page POST) ==================== */
async function apiDebitSave(request, env) {
  const form = await request.formData();
  const record = {
    splynx_id: (form.get("splynx_id")||"").toString(),
    account_holder: (form.get("account_holder")||"").toString(),
    id_number: (form.get("id_number")||"").toString(),
    bank_name: (form.get("bank_name")||"").toString(),
    account_number: (form.get("account_number")||"").toString(),
    account_type: (form.get("account_type")||"").toString(),
    debit_day: (form.get("debit_day")||"").toString(),
    agree: !!form.get("agree"),
    created: Date.now()
  };
  if (!record.splynx_id) return new Response("Missing ID", { status: 400 });
  await env.ONBOARD_KV.put(`debit/${record.splynx_id}/${record.created}`, JSON.stringify(record), { expirationTtl: 60*60*24*30 });
  return new Response(`Saved. You can close this tab.`, { headers: { "content-type":"text/plain; charset=utf-8" }});
}

/* ==================== Finalize: build PDFs & save to R2 ==================== */
async function finalizeSubmission(request, env) {
  const { linkid, id, state, signature } = await request.json().catch(()=> ({}));
  if (!linkid || !id || !state || !signature) return json({ ok:false, error:"Missing data" }, 400);

  const pngB64 = signature.split(",")[1] || "";
  const sigBytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata:{ contentType:"image/png" } });

  const msaOut = await buildMsaPdf(env, id, linkid, state, sigBytes);
  const doOut  = state.pay === "DEBIT" ? await buildDoPdf(env, id, linkid, state, sigBytes) : null;

  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaOut, { httpMetadata:{ contentType:"application/pdf" } });

  let doKey = null;
  if (doOut) {
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doOut, { httpMetadata:{ contentType:"application/pdf" } });
  }

  const pub = "https://onboarding-uploads.vinethosting.org";
  const resp = { ok:true, msa_url: `${pub}/${msaKey}` };
  if (doKey) resp.do_url = `${pub}/${doKey}`;
  return json(resp);
}

/* ==================== R2 serve (optional) ==================== */
async function serveR2(key, env) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status:404 });
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "content-type": ct } });
}

/* ==================== PDF builders ==================== */

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

  // Signature on page 4 bottom-right (adjust as needed to your template)
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(Math.min(3, pdf.getPageCount()-1));
    const { width } = page.getSize();
    const sigW = 180, sigH = 60;
    page.drawImage(png, { x: width - sigW - 80, y: 90, width: sigW, height: sigH });
  } catch {}

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

  // Signature between debit date and date (approx middle bottom)
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
  const page = pdf.addPage([595, 842]); // A4 portrait
  let font = null;
  try { font = pdf.embedStandardFont(StandardFonts.Helvetica); } catch {}
  const drawText = (txt, x, y, size=12) => {
    try { page.drawText(String(txt), { x, y, size, font, color: rgb(0,0,0) }); } catch {}
  };
  let y = 800;
  drawText("Security Verification", 40, y, 18); y -= 24;
  drawText("Date/time (CAT): " + catNow(), 40, y); y -= 18;
  drawText("Device: " + (state.device || "n/a"), 40, y); y -= 18;
  drawText("Browser: " + (state.browser || "n/a"), 40, y); y -= 18;
  drawText("IP: " + (state.ip || "n/a"), 40, y);
}

function catNow() {
  return new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
}

/* ==================== WA + Splynx helpers ==================== */

async function findMsisdn(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
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
      const m = pickPhone(data, ok);
      if (m) return m;
    } catch {}
  }
  return null;
}

function pickPhone(obj, ok) {
  if (!obj) return null;
  const tryVals = v => (Array.isArray(v) ? v.map(tryVals).find(Boolean) : (ok(v) ? String(v).trim() : null));
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (ok(val)) return String(val).trim();
      const deep = tryVals(val);
      if (deep) return deep;
    }
  }
  return null;
}

async function waSendTemplate(env, to, code) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, type: "template",
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
    method:"POST",
    headers: { "content-type":"application/json", Authorization:`Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

async function waSendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body } };
  const r = await fetch(endpoint, {
    method:"POST",
    headers: { "content-type":"application/json", Authorization:`Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

/* ==================== tiny ==================== */
function json(o, status=200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type":"application/json" }});
}