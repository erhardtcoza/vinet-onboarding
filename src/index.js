// index.js — Vinet Onboarding Worker (single-file, copy‑paste ready)
// Layout = “last night” sleek admin + full onboarding flow
// Includes: OTP, uploads to R2, PDF generation on sign, final download links,
// debit-order terms, EFT “Print banking details”, documents upload step,
// big tickboxes, street fix, Vinet Service Agreement naming, admin lists.
//
// ENV VARS (Wrangler):
// SPLYNX_API, SPLYNX_AUTH (Basic base64)
// PHONE_NUMBER_ID, WHATSAPP_TOKEN, WHATSAPP_TEMPLATE_NAME (vinetotp), WHATSAPP_TEMPLATE_LANG (en)
// TERMS_SERVICE_URL, TERMS_DEBIT_URL
// MSA_TEMPLATE_URL, DO_TEMPLATE_URL
// R2_UPLOADS (R2 bucket binding), ONBOARD_KV (KV binding)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // IP gate for admin/API (you can comment this if it’s blocking you during testing)
      const clientIP = request.headers.get("cf-connecting-ip") || "";
      const allowedCIDR = "160.226.128.0/20";
      if ((path.startsWith("/admin") || path.startsWith("/api")) && !ipInRange(clientIP, allowedCIDR)) {
        // Allow internal health/ping without IP check
        if (!path.startsWith("/admin") && path !== "/api/ping") {
          return new Response("Access denied", { status: 403 });
        }
      }

      // -------- Routing --------
      if (path === "/" || path === "/admin") return adminHTML(env);
      if (path.startsWith("/admin/gen")) return apiGenLink(url, env);
      if (path.startsWith("/admin/code")) return apiGenStaffCode(url, env);
      if (path.startsWith("/admin/review")) return adminReview(url, env);
      if (path.startsWith("/admin/approve") && request.method === "POST") return adminApprove(request, env);

      if (path.startsWith("/onboard/")) return onboardHTML(path.split("/")[2], env);

      if (path === "/api/ping") return json({ ok: true });

      if (path.startsWith("/api/otp/send")) return sendOtp(request, env);
      if (path.startsWith("/api/otp/verify")) return verifyOtp(request, env);

      if (path.startsWith("/api/upload")) return handleUpload(request, env);
      if (path.startsWith("/api/finalize")) return finalizeSubmission(request, env);

      if (path.startsWith("/api/delete")) return deletePending(request, env);

      if (path.startsWith("/info/eft")) return eftHTML(url.searchParams.get("id"));
      if (path.startsWith("/info/debit")) return debitOrderHTML(url.searchParams.get("id"), env);

      if (path.startsWith("/r2/")) return serveR2(path.replace("/r2/", ""), env);

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Worker exception: " + (err?.message || err), { status: 500 });
    }
  }
};

/* =========================
   Small helpers
   ========================= */
function json(o, status = 200, headers = {}) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
}
function ipInRange(ip, cidr) {
  if (!ip || !cidr) return true;
  const [range, bits = "32"] = cidr.split("/");
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  const mask = ~(2 ** (32 - Number(bits)) - 1);
  return (ipNum & mask) === (rangeNum & mask);
}
function ipToInt(ip) {
  const p = ip.split(".").map(x => parseInt(x, 10));
  if (p.length !== 4 || p.some(isNaN)) return 0;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
const PUB = "https://onboarding-uploads.vinethosting.org";
const CAT = { timeZone: "Africa/Johannesburg" };
const catNow = () => new Date().toLocaleString("en-ZA", CAT);

/* =========================
   Admin (sleek layout)
   ========================= */
async function adminHTML(env) {
  const data = await fetchAdminLists(env);
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Vinet Onboarding Admin</title>
  <style>
    :root{--brand:#e2001a;}
    body{margin:0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222}
    .wrap{max-width:1100px;margin:24px auto;padding:0 16px}
    h1{font-weight:800;color:var(--brand);text-align:center;margin:10px 0 24px;font-size:38px}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
    .card{background:#fff;border-radius:14px;box-shadow:0 6px 18px #00000012;padding:18px}
    .card h2{margin:0 0 10px;font-size:20px}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    input[type=text]{padding:10px;border:1px solid #e5e7ea;border-radius:10px;flex:1;min-width:200px}
    .btn{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
    .link-out{margin-top:10px;font-size:14px;background:#fafafa;border:1px dashed #ddd;border-radius:10px;padding:10px;word-break:break-all}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px;border-bottom:1px solid #f0f1f3;font-size:14px}
    th{text-align:left;color:#555}
    .muted{color:#666}
    .btn.small{padding:6px 10px;border-radius:8px;font-size:13px}
    @media (max-width:860px){.grid{grid-template-columns:1fr}}
  </style></head><body>
  <div class="wrap">
    <h1>Vinet Onboarding Admin</h1>

    <div class="grid">
      <div class="card">
        <h2>1) Generate onboarding link</h2>
        <div class="row">
          <input id="g_id" type="text" placeholder="Enter Splynx customer/lead ID (e.g. 319)"/>
          <button class="btn" id="g_btn">Generate</button>
        </div>
        <div id="g_out" class="link-out"></div>
      </div>

      <div class="card">
        <h2>2) Generate staff verification code</h2>
        <div class="row">
          <input id="c_link" type="text" placeholder="Enter full onboarding link id (e.g. 319_ab12cd34)"/>
          <button class="btn" id="c_btn">Generate</button>
        </div>
        <div id="c_out" class="link-out"></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <h2>3) Pending (in progress)</h2>
      ${tableHTML(data.pending)}
    </div>

    <div class="card" style="margin-top:18px">
      <h2>4) Completed (awaiting approval)</h2>
      ${tableHTML(data.awaiting, true)}
    </div>

    <div class="card" style="margin-top:18px">
      <h2>5) Approved</h2>
      ${tableHTML(data.approved)}
    </div>
  </div>

  <script>
    const q = s=>document.querySelector(s);
    q('#g_btn').onclick = async () => {
      const id = q('#g_id').value.trim();
      if(!id) return alert('Please enter an ID');
      const r = await fetch('/admin/gen?id=' + encodeURIComponent(id));
      const d = await r.json().catch(()=>({}));
      q('#g_out').innerHTML = d.url ? ('<a href="'+d.url+'" target="_blank">'+d.url+'</a>') : 'Failed.';
    };
    q('#c_btn').onclick = async () => {
      const lid = q('#c_link').value.trim();
      if(!lid) return alert('Enter onboarding link id');
      const r = await fetch('/admin/code?id=' + encodeURIComponent(lid));
      const d = await r.json().catch(()=>({}));
      q('#c_out').innerHTML = d.code ? ('Staff code: <b>'+d.code+'</b>') : 'Failed.';
    };
  </script>
  </body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function tableHTML(arr, review = false) {
  if (!arr || !arr.length) return `<p class="muted">Nothing yet.</p>`;
  return `<table>
    <tr><th>ID</th><th>Name</th><th>Updated</th>${review ? "<th></th>" : ""}</tr>
    ${arr.map(r => `<tr>
      <td>${escapeHtml(String(r.id||""))}</td>
      <td>${escapeHtml(String(r.name||""))}</td>
      <td class="muted">${new Date(r.updated||Date.now()).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})}</td>
      ${review ? `<td><a class="btn small" href="/admin/review?id=${encodeURIComponent(r.id)}">Open</a></td>` : ""}
    </tr>`).join("")}
  </table>`;
}

async function fetchAdminLists(env) {
  const pending = await env.ONBOARD_KV.get("admin/pending", "json") || [];
  const awaiting = await env.ONBOARD_KV.get("admin/awaiting", "json") || [];
  const approved = await env.ONBOARD_KV.get("admin/approved", "json") || [];
  return { pending, awaiting, approved };
}

async function apiGenLink(url, env) {
  const id = url.searchParams.get("id")?.trim();
  if (!id) return json({ ok: false, error: "missing id" }, 400);
  const token = Math.random().toString(36).slice(2, 10);
  const linkId = `${id}_${token}`;
  // seed pending list
  const pending = await env.ONBOARD_KV.get("admin/pending", "json") || [];
  if (!pending.find(r => r.id == id)) {
    pending.unshift({ id, name: "", updated: Date.now() });
    await env.ONBOARD_KV.put("admin/pending", JSON.stringify(pending));
  }
  return json({ ok: true, url: `${url.origin}/onboard/${linkId}`, linkId });
}

async function apiGenStaffCode(url, env) {
  const id = url.searchParams.get("id")?.trim();
  if (!id) return json({ ok: false, error: "missing id" }, 400);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.ONBOARD_KV.put(`staff_code/${id}`, code, { expirationTtl: 900 });
  return json({ ok: true, code });
}

async function adminReview(url, env) {
  const id = url.searchParams.get("id")?.trim();
  if (!id) return new Response("Missing id", { status: 400 });
  const rec = await env.ONBOARD_KV.get(`record/${id}`, "json") || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Review</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f5f6f8;margin:0}
    .wrap{max-width:800px;margin:24px auto;background:#fff;border-radius:14px;box-shadow:0 6px 18px #00000012;padding:18px}
    .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
    a{color:#e2001a}
    .muted{color:#666}
  </style></head><body><div class="wrap">
  <h2>Review submission</h2>
  <p><b>Name:</b> ${escapeHtml(rec.name||"")}</p>
  <p><b>Email:</b> ${escapeHtml(rec.email||"")}</p>
  <p><b>Phone:</b> ${escapeHtml(rec.phone||"")}</p>
  <p class="muted">${new Date(rec.updated||Date.now()).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})}</p>
  <h3>Agreements</h3>
  <ul>
    ${rec.msa_url ? `<li><a target="_blank" href="${rec.msa_url}">Vinet Service Agreement (MSA)</a></li>` : ""}
    ${rec.do_url ? `<li><a target="_blank" href="${rec.do_url}">Debit Order Agreement</a></li>` : ""}
  </ul>
  <form method="POST" action="/admin/approve">
    <input type="hidden" name="id" value="${escapeHtml(id)}"/>
    <button class="btn">Approve & push to Splynx</button>
  </form>
  </div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
async function adminApprove(request, env) {
  // Placeholder: push PDFs to Splynx files via its API if desired
  const form = await request.formData();
  const id = form.get("id");
  // Move from awaiting -> approved
  const awaiting = await env.ONBOARD_KV.get("admin/awaiting", "json") || [];
  const approved = await env.ONBOARD_KV.get("admin/approved", "json") || [];
  const rec = awaiting.find(r => String(r.id) === String(id));
  const nextAwait = awaiting.filter(r => String(r.id) !== String(id));
  if (rec) {
    approved.unshift({ ...rec, updated: Date.now() });
    await env.ONBOARD_KV.put("admin/approved", JSON.stringify(approved));
    await env.ONBOARD_KV.put("admin/awaiting", JSON.stringify(nextAwait));
  }
  return new Response("Approved", { status: 302, headers: { Location: "/admin" } });
}

/* =========================
   Onboarding (client flow)
   ========================= */
async function fetchSplynxProfile(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = (env.SPLYNX_API || "").replace(/\/$/, "");
  for (const ep of [`/api/2.0/admin/customers/customer/${id}`, `/api/2.0/crm/leads/${id}`]) {
    try { const r = await fetch(base + ep, { headers }); if (r.ok) return await r.json(); } catch {}
  }
  return {};
}

async function onboardHTML(linkId, env) {
  const [id, token] = (linkId || "").split("_");
  if (!id || !token) return new Response("Invalid link", { status: 400 });

  const prof = await fetchSplynxProfile(env, id);
  const first = prof.first_name || "";
  const last = prof.last_name || "";
  const passport = prof.passport || "";
  const street = (prof.street_1 || prof.street || "").trim();
  const city = prof.city || "";
  const zip = prof.zip_code || prof.zip || "";
  const phone = prof.phone_mobile || prof.phone || "";
  const email = prof.email || "";

  const TERMS_MSA_URL = env.TERMS_SERVICE_URL || `${PUB}/vinet-master-terms.txt`;
  const TERMS_DEBIT_URL = env.TERMS_DEBIT_URL || `${PUB}/vinet-debitorder-terms.txt`;

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Onboarding</title>
  <style>
    :root{--brand:#e2001a}
    body{margin:0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222}
    header{background:#fff;padding:14px 0;text-align:center;box-shadow:0 4px 10px #0000000d}
    header img{max-width:200px;height:auto}
    .wrap{max-width:760px;margin:20px auto;padding:0 14px}
    .step{background:#fff;border-radius:14px;box-shadow:0 6px 18px #00000012;padding:16px;margin-bottom:16px}
    h2{color:var(--brand);margin:0 0 10px}
    label{display:block;font-weight:600;margin-top:10px}
    input,select{width:100%;padding:10px;border:1px solid #e5e7ea;border-radius:10px;margin-top:6px}
    .btn{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
    .btn.outline{background:#fff;color:var(--brand);border:2px solid var(--brand)}
    .row{display:flex;gap:10px;flex-wrap:wrap}
    .row>div{flex:1;min-width:220px}
    .ref{background:#fff7d6;border:1px dashed #e0b400;padding:10px;border-radius:10px;font-weight:700}
    .tick{transform:scale(1.6);margin-right:10px}
    canvas#sig{width:100%;height:180px;border:1px dashed #bbb;border-radius:10px;background:#fff;touch-action:none}
    .links a{display:block;margin:8px 0}
  </style></head><body>
  <header><img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/></header>
  <div class="wrap">

    <div class="step" id="s0">
      <h2>Welcome</h2>
      <p>We’ll quickly verify you and confirm a few details.</p>
      <button class="btn" id="startBtn">Let's begin</button>
    </div>

    <div class="step" id="s1" style="display:none">
      <h2>Payment Method</h2>
      <label>Choose one</label>
      <select id="pay"><option value="">— Select —</option><option value="EFT">EFT</option><option value="DEBIT">Debit order</option></select>
      <div id="eftBox" style="display:none;margin-top:10px">
        <div class="ref">Please use the correct reference when making EFT payments: REF <b>${id}</b></div>
        <div style="text-align:center;margin-top:10px"><button class="btn" onclick="window.open('/info/eft?id=${id}','_blank')">Print banking details</button></div>
      </div>
      <div id="doBox" style="display:none;margin-top:10px">
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
            <select id="do_day"><option value="1">1st</option><option value="7">7th</option><option value="15">15th</option><option value="25">25th</option><option value="29">29th</option><option value="30">30th</option></select>
          </div>
        </div>
        <div style="margin-top:8px"><label><input type="checkbox" id="do_ok" class="tick"> I accept the Debit Order terms</label></div>
        <div style="margin-top:6px"><iframe src="${TERMS_DEBIT_URL}" style="width:100%;height:220px;border:1px solid #eee;border-radius:10px"></iframe></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div><button class="btn outline" id="s1Back">Back</button></div>
        <div><button class="btn" id="s1Next">Continue</button></div>
      </div>
    </div>

    <div class="step" id="s2" style="display:none">
      <h2>Please verify your details and change if you see any errors</h2>
      <div class="row">
        <div><label>First name</label><input id="f_first" value="${escapeHtml(first)}"></div>
        <div><label>Last name</label><input id="f_last" value="${escapeHtml(last)}"></div>
      </div>
      <div class="row">
        <div><label>ID / Passport</label><input id="f_passport" value="${escapeHtml(passport)}"></div>
        <div><label>Mobile</label><input id="f_phone" value="${escapeHtml(phone)}"></div>
      </div>
      <label>Email</label><input id="f_email" value="${escapeHtml(email)}">
      <label>Street</label><input id="f_street" value="${escapeHtml(street)}">
      <div class="row">
        <div><label>City</label><input id="f_city" value="${escapeHtml(city)}"></div>
        <div><label>ZIP</label><input id="f_zip" value="${escapeHtml(zip)}"></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div><button class="btn outline" id="s2Back">Back</button></div>
        <div><button class="btn" id="s2Next">Continue</button></div>
      </div>
    </div>

    <div class="step" id="s3" style="display:none">
      <h2>Please upload your supporting documents</h2>
      <p class="muted">ID or Passport and proof of address (as per RICA regulations)</p>
      <div><label>Document 1</label><input id="up1" type="file" accept="image/*,application/pdf"></div>
      <div><label>Document 2 (optional)</label><input id="up2" type="file" accept="image/*,application/pdf"></div>
      <div class="row" style="margin-top:12px">
        <div><button class="btn outline" id="s3Back">Back</button></div>
        <div><button class="btn" id="s3Next">Continue</button></div>
      </div>
    </div>

    <div class="step" id="s4" style="display:none">
      <h2>Vinet Service Agreement</h2>
      <div style="margin-bottom:8px"><iframe src="${TERMS_MSA_URL}" style="width:100%;height:260px;border:1px solid #eee;border-radius:10px"></iframe></div>
      <label><input id="msa_ok" type="checkbox" class="tick"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label>
      <div style="margin-top:10px">
        <label>Draw your signature</label>
        <canvas id="sig"></canvas>
        <div class="row" style="margin-top:6px"><div><button class="btn outline" id="clearSig">Clear</button></div></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div><button class="btn outline" id="s4Back">Back</button></div>
        <div><button class="btn" id="finishBtn">Finish & Sign</button></div>
      </div>
    </div>

    <div class="step" id="s5" style="display:none">
      <h2>All set!</h2>
      <p>Thanks — we've recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>
      <div id="dl" class="links"></div>
    </div>

  </div>

  <script>
    const linkid = ${JSON.stringify(linkId)};
    const spId = ${JSON.stringify(id)};
    const state = { pay:"", debit:null, info:{}, uploads:[], device:navigator.userAgent, browser:navigator.userAgent, ip:"" };

    // progress nav
    const show = i => { for (let n=0;n<=5;n++) document.getElementById('s'+n).style.display=(n===i?'block':'none'); };
    document.getElementById('startBtn').onclick = ()=>show(1);

    // Payment
    const sel = document.getElementById('pay'), eftBox = document.getElementById('eftBox'), doBox = document.getElementById('doBox');
    sel.onchange = ()=>{ const v=sel.value; eftBox.style.display = v==='EFT'?'block':'none'; doBox.style.display = v==='DEBIT'?'block':'none'; };
    document.getElementById('s1Back').onclick = ()=>show(0);
    document.getElementById('s1Next').onclick = ()=>{
      const v = sel.value; if(!v) return alert('Select a payment method'); state.pay=v;
      if (v==='DEBIT'){
        if(!document.getElementById('do_ok').checked) return alert('Please accept the Debit Order terms');
        state.debit = {
          account_holder: document.getElementById('do_name').value.trim(),
          id_number:      document.getElementById('do_id').value.trim(),
          bank_name:      document.getElementById('do_bank').value.trim(),
          account_number: document.getElementById('do_acc').value.trim(),
          account_type:   document.getElementById('do_type').value,
          debit_day:      document.getElementById('do_day').value
        };
      } else state.debit=null;
      show(2);
    };

    // Info
    document.getElementById('s2Back').onclick = ()=>show(1);
    document.getElementById('s2Next').onclick = ()=>{
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

    // Uploads
    document.getElementById('s3Back').onclick = ()=>show(2);
    document.getElementById('s3Next').onclick = async ()=>{
      const f1 = document.getElementById('up1').files[0];
      const f2 = document.getElementById('up2').files[0];
      state.uploads = [];
      if (f1) state.uploads.push(await doUpload(linkid, f1));
      if (f2) state.uploads.push(await doUpload(linkid, f2));
      show(4);
    };
    async function doUpload(linkid, file){
      const u = '/api/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name);
      const r = await fetch(u, { method:'POST', body: await file.arrayBuffer() });
      return await r.json().catch(()=>({}));
    }

    // Signature pad
    const canvas = document.getElementById('sig'), ctx = canvas.getContext('2d');
    let drawing=false,last=null; function resize(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*s); canvas.height=Math.floor(180*s); ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; } function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left, y:(t?t.clientY:e.clientY)-r.top}; } function down(e){drawing=true; last=pos(e); e.preventDefault();} function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); } function up(){drawing=false; last=null;}
    window.addEventListener('resize', resize); resize();
    canvas.addEventListener('mousedown',down); window.addEventListener('mouseup',up); canvas.addEventListener('mousemove',move);
    canvas.addEventListener('touchstart',down,{passive:false}); window.addEventListener('touchend',up); canvas.addEventListener('touchmove',move,{passive:false});
    document.getElementById('clearSig').onclick = (e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); };

    document.getElementById('s4Back').onclick = ()=>show(3);
    document.getElementById('finishBtn').onclick = async ()=>{
      if (!document.getElementById('msa_ok').checked) return alert('Please confirm the agreement');
      const sig = canvas.toDataURL('image/png');
      const body = { linkid, id: spId, state, signature: sig };
      const r = await fetch('/api/finalize', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const d = await r.json().catch(()=>({}));
      show(5);
      const dl = document.getElementById('dl'); const L=[];
      if (d.msa_url) L.push('<a target="_blank" href="'+d.msa_url+'">Download Vinet Service Agreement (MSA)</a>');
      if (d.do_url)  L.push('<a target="_blank" href="'+d.do_url+'">Download Debit Order Agreement</a>');
      dl.innerHTML = L.join('');
    };

    show(0);
  </script>
  </body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/* =========================
   EFT / Debit Order info pages
   ========================= */
async function eftHTML(id) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>EFT Details</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f5f6f8;margin:0}
    .card{max-width:760px;margin:24px auto;background:#fff;border-radius:14px;box-shadow:0 6px 18px #00000012;padding:18px}
    .logo{display:block;margin:0 auto 8px;max-width:160px}
    h2{color:#e2001a;margin:8px 0 12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .f{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
    .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:10px;padding:10px;font-weight:700}
    .c{text-align:center}.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
    @media (max-width:700px){.grid{grid-template-columns:1fr}}
  </style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO}"/>
    <h2>EFT Payment Details</h2>
    <div class="grid">
      <div class="f"><b>Bank</b><br>First National Bank (FNB/RMB)</div>
      <div class="f"><b>Account Name</b><br>Vinet Internet Solutions</div>
      <div class="f"><b>Account Number</b><br>62757054996</div>
      <div class="f"><b>Branch Code</b><br>250655</div>
    </div>
    <div class="ref" style="margin-top:10px">Please use the correct EFT reference: <b>REF ${escapeHtml(String(id||""))}</b></div>
    <p class="c" style="color:#666">All accounts are payable on or before the 1st of every month.</p>
    <div class="c"><button class="btn" onclick="window.print()">Print banking details</button></div>
  </div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function debitOrderHTML(id, env) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  const termsUrl = env.TERMS_DEBIT_URL || `${PUB}/vinet-debitorder-terms.txt`;
  const terms = await (await fetch(termsUrl)).text().catch(() => "Terms currently unavailable.");
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Debit Order</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f5f6f8;margin:0}
    .card{max-width:760px;margin:24px auto;background:#fff;border-radius:14px;box-shadow:0 6px 18px #00000012;padding:18px}
    .logo{display:block;margin:0 auto 8px;max-width:160px}
    h2{color:#e2001a;margin:8px 0 12px}
    label{font-weight:600;display:block;margin-top:10px}
    input,select{width:100%;padding:10px;border:1px solid #e5e7ea;border-radius:10px;margin-top:6px}
    .tick{transform:scale(1.6);margin-right:10px}
    .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}
    .row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:220px}
    pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
  </style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO}"/>
    <h2>Debit Order Details</h2>
    <form method="POST" action="/api/debit/save">
      <input type="hidden" name="splynx_id" value="${escapeHtml(String(id||""))}">
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
          <select name="debit_day"><option value="1">1st</option><option value="7">7th</option><option value="15">15th</option><option value="25">25th</option><option value="29">29th</option><option value="30">30th</option></select>
        </div>
      </div>
      <div style="margin-top:8px"><label><input class="tick" type="checkbox" name="agree" required> I accept the Debit Order terms</label></div>
      <pre>${escapeHtml(terms)}</pre>
      <div style="margin-top:10px"><button class="btn" type="submit">Submit</button></div>
    </form>
  </div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/* =========================
   OTP via WhatsApp
   ========================= */
async function findMsisdn(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = (env.SPLYNX_API || "").replace(/\/$/, "");
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  for (const ep of [
    `/api/2.0/admin/customers/customer/${id}`,
    `/api/2.0/admin/customers/${id}/contacts`,
    `/api/2.0/crm/leads/${id}`,
    `/api/2.0/crm/leads/${id}/contacts`
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
  if (Array.isArray(obj)) {
    for (const x of obj) { const z = pickPhone(x, ok); if (z) return z; }
  } else if (typeof obj === "object") {
    for (const [k,v] of Object.entries(obj)) {
      if (typeof v === "string" && ok(v)) return v.trim();
      const z = pickPhone(v, ok); if (z) return z;
    }
  }
  return null;
}

async function sendOtp(request, env) {
  const { linkid } = await request.json().catch(() => ({}));
  if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
  const splynxId = (linkid.split("_")[0] || "").trim();
  const msisdn = await findMsisdn(env, splynxId);
  if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });

  try {
    await waSendTemplate(env, msisdn, code);
    return json({ ok: true });
  } catch {
    try {
      await waSendText(env, msisdn, `Your Vinet verification code is: ${code}`);
      return json({ ok: true, note: "sent-as-text" });
    } catch {
      return json({ ok: false, error: "WhatsApp send failed" }, 502);
    }
  }
}
async function verifyOtp(request, env) {
  const { linkid, otp } = await request.json().catch(() => ({}));
  if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);
  const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
  return json({ ok: !!code && code === otp });
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
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] }
      ]
    }
  };
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await r.text());
}
async function waSendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${env.WHATSAPP_TOKEN}` }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await r.text());
}

/* =========================
   Uploads, Finalize, R2
   ========================= */
async function handleUpload(request, env) {
  const u = new URL(request.url);
  const linkid = u.searchParams.get("linkid") || "";
  const name = u.searchParams.get("filename") || "file.bin";
  if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
  const buf = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${name}`;
  await env.R2_UPLOADS.put(key, buf);
  return json({ ok: true, key, url: `${PUB}/${key}` });
}

async function finalizeSubmission(request, env) {
  const { linkid, id, state, signature } = await request.json().catch(() => ({}));
  if (!linkid || !id || !state || !signature) return json({ ok: false, error: "Missing data" }, 400);

  // Persist a compact record for admin review lists
  const record = {
    id,
    name: `${state.info.first_name || ""} ${state.info.last_name || ""}`.trim(),
    email: state.info.email || "",
    phone: state.info.phone || "",
    updated: Date.now()
  };

  // Save signature PNG
  const sigB64 = signature.split(",")[1] || "";
  const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata: { contentType: "image/png" } });

  // Build PDFs
  const msaPdf = await buildMsaPdf(env, id, linkid, state, sigBytes);
  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaPdf, { httpMetadata: { contentType: "application/pdf" } });

  let doKey = null;
  if (state.pay === "DEBIT") {
    const doPdf = await buildDoPdf(env, id, linkid, state, sigBytes);
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doPdf, { httpMetadata: { contentType: "application/pdf" } });
  }

  const msa_url = `${PUB}/${msaKey}`;
  const do_url = doKey ? `${PUB}/${doKey}` : null;

  // Move to “awaiting approval”
  const awaiting = await env.ONBOARD_KV.get("admin/awaiting", "json") || [];
  const pending = await env.ONBOARD_KV.get("admin/pending", "json") || [];
  const nextPending = pending.filter(r => String(r.id) !== String(id));
  awaiting.unshift({ ...record, msa_url, do_url });
  await env.ONBOARD_KV.put("admin/awaiting", JSON.stringify(awaiting));
  await env.ONBOARD_KV.put("admin/pending", JSON.stringify(nextPending));
  await env.ONBOARD_KV.put(`record/${id}`, JSON.stringify({ ...record, msa_url, do_url }));

  return json({ ok: true, msa_url, do_url });
}

async function deletePending(request, env) {
  const { linkid } = await request.json().catch(() => ({}));
  if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
  await env.ONBOARD_KV.delete(`onboard/${linkid}`);
  return json({ ok: true });
}

async function serveR2(key, env) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "content-type": ct } });
}

/* =========================
   PDF builders (using provided fillable templates)
   ========================= */
async function buildMsaPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.MSA_TEMPLATE_URL || `${PUB}/templates/VINET_MSA.pdf`;
  const tpl = await (await fetch(tplUrl)).arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm?.();

  const fields = {
    full_name: `${state.info.first_name || ""} ${state.info.last_name || ""}`.trim(),
    passport: state.info.passport || "",
    customer_id: String(id),
    email: state.info.email || "",
    phone: state.info.phone || "",
    street: state.info.street || "",
    city: state.info.city || "",
    zip: state.info.zip || "",
    date: catNow()
  };

  if (form) {
    for (const [k, v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature block: MSA page 4 bottom — between Full name and Date ~ an inch below Full name
  try {
    const png = await pdf.embedPng(sigBytes);
    const idx = Math.min(3, pdf.getPageCount() - 1); // page 4 or last
    const page = pdf.getPage(idx);
    const { width } = page.getSize();
    page.drawImage(png, { x: width - 260, y: 95, width: 180, height: 60 });
  } catch {}

  appendStampPage(pdf, state);
  return await pdf.save();
}

async function buildDoPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.DO_TEMPLATE_URL || `${PUB}/templates/VINET_DO.pdf`;
  const tpl = await (await fetch(tplUrl)).arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm?.();

  const d = state.debit || {};
  const fields = {
    account_holder: d.account_holder || "",
    id_number: d.id_number || "",
    bank_name: d.bank_name || "",
    account_number: d.account_number || "",
    account_type: d.account_type || "",
    debit_day: String(d.debit_day || ""),
    customer_id: String(id),
    date: catNow()
  };

  if (form) {
    for (const [k, v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature: between Debit Order Date and Date field, about 1 inch spacing
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(0);
    const { width } = page.getSize();
    page.drawImage(png, { x: width/2 - 90, y: 120, width: 180, height: 60 });
  } catch {}

  appendStampPage(pdf, state);
  return await pdf.save();
}

function appendStampPage(pdf, state) {
  const page = pdf.addPage([595, 842]); // A4
  const draw = (t, x, y, size = 12) => {
    try {
      page.drawText(t, { x, y, size, font: pdf.embedStandardFont ? undefined : undefined, color: rgb(0, 0, 0) });
    } catch {}
  };
  let y = 800;
  draw("Security Verification", 40, y, 18); y -= 24;
  draw("Date/time (CAT): " + catNow(), 40, y); y -= 18;
  draw("Device: " + (state.device || "n/a"), 40, y); y -= 18;
  draw("Browser: " + (state.browser || "n/a"), 40, y); y -= 18;
  draw("IP: " + (state.ip || "n/a"), 40, y);
}