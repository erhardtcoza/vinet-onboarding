export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ------------ utils ------------
    async function readJSON(req) { try { return await req.json(); } catch { return {}; } }
    const noCache = {
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0",
    };
    const csp = {
      "content-security-policy":
        "default-src 'self'; img-src 'self' https://static.vinet.co.za data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self';"
    };
    const htmlHeaders = { "content-type": "text/html; charset=utf-8", ...noCache, ...csp };
    const jsHeaders   = { "content-type": "application/javascript; charset=utf-8", ...noCache };

    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") || "";

    const getUA = () => request.headers.get("user-agent") || "";

    function ipAllowedAdmin(ip, env) {
      const list = (env.ADMIN_IPS || "").split(",").map(s => s.trim()).filter(Boolean);
      if (list.length === 0) return true; // no restriction configured
      return list.includes(ip);
    }

    function page(body, { title = "Vinet Onboarding" } = {}) {
      return new Response(
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:650px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .btn-outline { background:#fff; color:#e2001a; border:2px solid #e2001a; border-radius:.7em; padding:.6em 1.4em; }
    .btn-secondary { background:#eee; color:#222; border:0; border-radius:.7em; padding:.6em 1.2em; text-decoration:none; display:inline-block; }
    .btn-pill { padding:.7em 1.4em; border-radius:999px; }
    .field { margin:1em 0; }
    input, select, textarea { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size:12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .4s; }
    .row { display:flex; gap:.75em; }
    .row > * { flex:1; }
    .col-2 { display:grid; grid-template-columns: 1fr 1fr; gap: .75em; }
    a.btnlink { display:inline-block; background:#eee; color:#222; padding:.5em .8em; border-radius:.6em; text-decoration:none; margin-top:.8em; }
    .termsbox { max-height: 280px; overflow:auto; padding:1em; border:1px solid #ddd; border-radius:.6em; background:#fafafa; }
    canvas.signature { border:1px dashed #bbb; border-radius:.6em; width:100%; height:180px; touch-action: none; background:#fff; }
    ul.files { list-style: none; padding: 0; }
    ul.files li { display:flex; justify-content:space-between; align-items:center; padding:.4em .6em; border:1px solid #eee; border-radius:.5em; margin:.35em 0; }
    ul.files li .meta { font-size:12px; color:#555; }
    .pill-wrap { display:flex; gap:.6em; flex-wrap:wrap; }
    .pill { border:2px solid #e2001a; color:#e2001a; padding:.5em 1em; border-radius:999px; cursor:pointer; user-select:none; }
    .pill.active { background:#e2001a; color:#fff; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${body}
  </div>
</body>
</html>`,
        { headers: htmlHeaders }
      );
    }

    // ------------ Splynx helpers ------------
    async function splynxGET(endpoint) {
      const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> "");
        console.error("Splynx error", endpoint, r.status, t);
        throw new Error(`Splynx GET ${endpoint} ${r.status}`);
      }
      return r.json();
    }

    // Try to pick a msisdn (already in 27… format)
    function pickPhone(obj) {
      if (!obj) return null;
      const tryField = (v) => {
        if (!v) return null;
        const s = String(v).trim();
        if (/^27\d{8,13}$/.test(s)) return s;
        return null;
      };
      const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone];
      for (const v of direct) { const m = tryField(v); if (m) return m; }
      if (Array.isArray(obj)) {
        for (const it of obj) { const m = pickPhone(it); if (m) return m; }
      } else if (typeof obj === "object") {
        for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; }
      }
      return null;
    }

    async function fetchCustomerMsisdn(id) {
      const eps = [
        `/admin/customers/customer/${id}`,
        `/admin/customers/${id}`,
        `/crm/leads/${id}`,
        `/admin/customers/${id}/contacts`,
        `/crm/leads/${id}/contacts`,
      ];
      for (const ep of eps) {
        try {
          const data = await splynxGET(ep);
          const m = pickPhone(data);
          if (m) return m;
        } catch {}
      }
      return null;
    }

    // Compact, merged “profile” to show/edit
    async function fetchProfileForDisplay(id) {
      // Try customer then lead; take best available fields
      let cust = null, lead = null, contacts = null;
      try { cust = await splynxGET(`/admin/customers/customer/${id}`); } catch {}
      if (!cust) { try { lead = await splynxGET(`/crm/leads/${id}`); } catch {} }
      try { contacts = await splynxGET(`/admin/customers/${id}/contacts`); } catch {}

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
        partner: src.partner || src.location || "",
        payment_method: src.payment_method || "", // display only
      };
    }

    // ------------ WhatsApp senders ------------
    async function sendWhatsAppTemplate(toMsisdn, code, lang = "en") {
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
            // If your template has a URL button requiring a short param:
            { type: "button", sub_type: "url", index: "0",
              parameters: [{ type: "text", text: code.slice(-6) }] }
          ]
        }
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
        const t = await r.text().catch(()=> "");
        console.error("WA template send failed", r.status, t);
        throw new Error(`WA template ${r.status}`);
      }
    }

    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product: "whatsapp", to: toMsisdn, type: "text", text: { body: bodyText } };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> "");
        console.error("WA text send failed", r.status, t);
        throw new Error(`WA text ${r.status}`);
      }
    }

    // ------------ ADMIN (IP allowlist) ------------
    if (path === "/admin2" && method === "GET") {
      if (!ipAllowedAdmin(getIP(), env)) return new Response("Forbidden", { status: 403 });
      return page(`
        <h1>Generate Onboarding Link</h1>
        <form action="/admin2/gen" method="GET" autocomplete="off" class="field">
          <label>Splynx Lead/Customer ID</label>
          <div class="row">
            <input name="id" required autocomplete="off" />
            <button class="btn" type="submit">Generate Link</button>
          </div>
        </form>
        <div class="note">Staff: <a class="btnlink" href="/admin2/staff">Generate staff code</a></div>
      `, { title: "Admin - Generate Link" });
    }

    if (path === "/admin2/gen" && method === "GET") {
      if (!ipAllowedAdmin(getIP(), env)) return new Response("Forbidden", { status: 403 });
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing id", { status: 400 });

      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });

      const full = `${url.origin}/onboard/${linkid}`;
      return page(`
        <h1>Onboarding Link</h1>
        <div class="field"><label>URL</label><input value="${full}" readonly /></div>
        <p>
          <a class="btn" href="${full}" target="_blank">Open link</a>
          <a class="btn-secondary" href="/admin2">Generate another</a>
        </p>
      `, { title: "Admin - Link Ready" });
    }

    if (path === "/admin2/staff" && method === "GET") {
      if (!ipAllowedAdmin(getIP(), env)) return new Response("Forbidden", { status: 403 });
      return page(`
        <h1>Generate Staff Code</h1>
        <div class="field"><label>Onboarding link ID (e.g. 319_ab12cd34)</label><input id="linkid" /></div>
        <button class="btn" id="gen">Generate Staff Code</button>
        <div id="out" class="field"></div>
        <script src="/static/staff.js"></script>
      `, { title: "Admin - Staff Code" });
    }

    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowedAdmin(getIP(), env)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await readJSON(request);
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // ------------ INFO: EFT details ------------
    if (path === "/info/eft" && method === "GET") {
      const bank   = env.EFT_BANK_NAME    || "Your Bank";
      const accnm  = env.EFT_ACCOUNT_NAME || "Vinet Internet Solutions (Pty) Ltd";
      const accno  = env.EFT_ACCOUNT_NO   || "0000000000";
      const branch = env.EFT_BRANCH_CODE  || "000000";
      const ref    = env.EFT_REFERENCE    || "Your Splynx ID / Invoice No";
      const notes  = env.EFT_NOTES        || "";
      return page(`
        <h1>EFT Payment Details</h1>
        <div class="field"><label>Bank</label><input value="${bank}" readonly /></div>
        <div class="field"><label>Account Name</label><input value="${accnm}" readonly /></div>
        <div class="field"><label>Account Number</label><input value="${accno}" readonly /></div>
        <div class="field"><label>Branch Code</label><input value="${branch}" readonly /></div>
        <div class="field"><label>Reference</label><input value="${ref}" readonly /></div>
        ${notes ? `<p class="note">${notes}</p>` : ""}
        <p><a class="btn" href="javascript:window.print()">Print</a></p>
      `, { title: "EFT Details" });
    }

    // ------------ INFO: Debit order + terms ------------
    if (path === "/info/debit" && method === "GET") {
      const splynxId = url.searchParams.get("id") || "";
      return page(`
        <h1>Debit Order Instruction</h1>
        <form id="debitForm" autocomplete="off" class="field">
          <div class="row">
            <div class="field"><label>Account Holder</label><input name="account_holder" required /></div>
            <div class="field"><label>ID / Company Reg No</label><input name="id_number" required /></div>
          </div>
          <div class="row">
            <div class="field"><label>Contact Email</label><input name="email" type="email" required /></div>
            <div class="field"><label>Contact Number</label><input name="phone" required /></div>
          </div>
          <div class="row">
            <div class="field"><label>Bank</label><input name="bank_name" required /></div>
            <div class="field"><label>Branch Code</label><input name="branch_code" required /></div>
          </div>
          <div class="row">
            <div class="field"><label>Account Number</label><input name="account_number" required /></div>
            <div class="field"><label>Account Type</label>
              <select name="account_type" required>
                <option value="cheque">Cheque / Current</option>
                <option value="savings">Savings</option>
                <option value="transmission">Transmission</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="field"><label>Preferred Debit Day</label>
              <select name="debit_day" required>
                ${Array.from({length:28}, (_,i)=>`<option>${i+1}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Start Month</label><input name="start_month" type="month" required /></div>
          </div>
          ${splynxId ? `<input type="hidden" name="splynx_id" value="${splynxId}" />` : ""}
          <div class="termsbox" id="termsBox">Loading terms…</div>
          <div class="field"><label><input type="checkbox" id="agree" /> I agree to the Debit Order terms</label></div>
          <div class="row">
            <button class="btn" type="submit">Submit</button>
            <a class="btnlink" href="/info/eft">Prefer EFT?</a>
          </div>
          <div id="msg" class="note" style="margin-top:8px"></div>
        </form>
        <script>
          (async () => {
            try {
              const r = await fetch('/api/terms?pay=debit'); const t = await r.text();
              document.getElementById('termsBox').innerHTML = t || 'Terms not available.';
            } catch { document.getElementById('termsBox').textContent = 'Failed to load terms.'; }
          })();
          document.getElementById('debitForm').onsubmit = async (e)=>{
            e.preventDefault();
            const msg = document.getElementById('msg');
            if (!document.getElementById('agree').checked) { msg.textContent='Please accept the Debit Order terms.'; return; }
            const data = Object.fromEntries(new FormData(e.target).entries());
            msg.textContent='Submitting...';
            try {
              const r = await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
              const d = await r.json().catch(()=>({ok:false}));
              msg.textContent = d.ok ? 'Saved. Our team will activate your debit order.' : (d.error||'Could not save.');
              if (d.ok) e.target.reset();
            } catch { msg.textContent='Network error.'; }
          };
        <\/script>
      `, { title: "Debit Order" });
    }

    // ------------ API: save debit order ------------
    if (path === "/api/debit/save" && method === "POST") {
      const b = await readJSON(request);
      const required = ["account_holder","id_number","email","phone","bank_name","branch_code","account_number","account_type","debit_day","start_month"];
      for (const k of required) {
        if (!b[k] || String(b[k]).trim() === "") return json({ ok:false, error:`Missing ${k}` }, 400);
      }
      const ts = Date.now();
      const id = (b.splynx_id || "unknown").toString();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, created: ts, ip: getIP(), ua: getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref: key });
    }

    // ------------ Onboarding HTML (welcome-first flow) ------------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session) return page(`<h2 class="err">Invalid or expired link.</h2>`, { title: "Onboarding" });
      const pct = (session.progress || 0) * 14 + 14; // 7 steps incl done => 14% increments
      return new Response(
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Onboarding</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:650px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .btn-outline { background:#fff; color:#e2001a; border:2px solid #e2001a; border-radius:.7em; padding:.6em 1.4em; }
    .field { margin:1em 0; }
    input, select, textarea { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size:12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .4s; }
    .row { display:flex; gap:.75em; }
    .row > * { flex:1; }
    .pill-wrap { display:flex; gap:.6em; flex-wrap:wrap; margin:.6em 0 0; }
    .pill { border:2px solid #e2001a; color:#e2001a; padding:.6em 1.2em; border-radius:999px; cursor:pointer; user-select:none; }
    .pill.active { background:#e2001a; color:#fff; }
    .termsbox { max-height: 280px; overflow:auto; padding:1em; border:1px solid #ddd; border-radius:.6em; background:#fafafa; }
    canvas.signature { border:1px dashed #bbb; border-radius:.6em; width:100%; height:180px; touch-action: none; background:#fff; }
    ul.files { list-style:none; padding:0; }
    ul.files li { display:flex; justify-content:space-between; align-items:center; padding:.4em .6em; border:1px solid #eee; border-radius:.5em; margin:.35em 0; }
    ul.files li .meta { font-size:12px; color:#555; }
  </style>
</head>
<body>
  <div class="card" id="root" data-linkid="${linkid}" data-progress="${session.progress||0}">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    <div class="progressbar"><div id="prog" class="progress" style="width:${pct}%"></div></div>
    <div id="step"></div>
  </div>
  <script src="/static/onboard.js"></script>
</body>
</html>`,
        { headers: htmlHeaders }
      );
    }

    // ------------ STATIC: onboard.js (welcome + buttons + details) ------------
    if (path === "/static/onboard.js" && method === "GET") {
      const js = `
(function(){
  const root = document.getElementById('root');
  if (!root) return;
  const linkid = root.getAttribute('data-linkid');
  let step = parseInt(root.getAttribute('data-progress') || '0', 10) || 0;
  // Steps:
  // 0: Welcome
  // 1: OTP (WhatsApp or Staff)
  // 2: Contact prefs + Payment buttons
  // 3: Review/edit details
  // 4: Uploads
  // 5: Agreements + signature
  // 6: Done
  const total = 6;

  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let state = { progress: step, uploads: [], edits: {} };

  function setProgress(){
    const pct = Math.min(100, Math.round(((step+1)/(total+1))*100));
    if (progEl) progEl.style.width = pct + '%';
  }
  function save(){
    try { fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }); } catch(e){}
  }

  async function sendOtp(){
    const msg = document.getElementById('otpmsg');
    if (msg) msg.textContent = 'Sending code to WhatsApp...';
    try {
      const r = await fetch('/api/otp/send', { method:'POST', body: JSON.stringify({ linkid }) });
      const d = await r.json().catch(()=>({ok:false}));
      if (msg) msg.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : ('Failed to send: ' + (d.error||'unknown'));
    } catch {
      if (msg) msg.textContent = 'Network error sending code.';
    }
  }

  function renderUploads(list){
    if (!Array.isArray(list)) list = [];
    if (!list.length) return '<div class="note">No files uploaded yet.</div>';
    return '<ul class="files">' + list.map((f, i) =>
      '<li><div><b>'+f.label+'</b><div class="meta">'+f.name+' • '+Math.round((f.size||0)/1024)+' KB</div></div>' +
      '<button class="btn" data-del="'+i+'" style="padding:.4em .8em">Remove</button></li>'
    ).join('') + '</ul>';
  }
  function bindDeletions(){
    document.querySelectorAll('button[data-del]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = parseInt(btn.getAttribute('data-del'),10);
        const f = state.uploads[idx]; if (!f) return;
        btn.disabled = true;
        try {
          const r = await fetch('/api/upload/delete', { method:'POST', body: JSON.stringify({ linkid, key: f.key }) });
          const d = await r.json().catch(()=>({ok:false}));
          if (d.ok) { state.uploads.splice(idx,1); save(); render(); }
          else { btn.disabled=false; alert('Remove failed'); }
        } catch { btn.disabled=false; alert('Network error'); }
      };
    });
  }

  function signaturePad(canvas){
    const ctx = canvas.getContext('2d');
    let drawing=false, last=null;
    function resize(){
      const scale = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * scale);
      canvas.height = Math.floor(rect.height * scale);
      ctx.scale(scale, scale);
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#222';
    }
    resize(); window.addEventListener('resize', resize);
    function rect(){ return canvas.getBoundingClientRect(); }
    function pos(e){ const r = rect(); if (e.touches&&e.touches[0]) return {x:e.touches[0].clientX-r.left,y:e.touches[0].clientY-r.top}; return {x:e.clientX-r.left,y:e.clientY-r.top}; }
    function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ drawing=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  async function fetchProfile(){
    try {
      const id = (linkid||'').split('_')[0];
      const r = await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  function render(){
    setProgress();

    // STEP 0: Welcome
    if (step === 0) {
      stepEl.innerHTML = [
        '<h2>Welcome</h2>',
        '<p>We\\u2019ll quickly verify you and confirm a few details.</p>',
        '<button class="btn" id="start">Let\\u2019s begin</button>'
      ].join('');
      document.getElementById('start').onclick = ()=>{ step=1; state.progress=step; save(); render(); };
      return;
    }

    // STEP 1: OTP (WhatsApp or staff)
    if (step === 1) {
      stepEl.innerHTML = [
        '<h2>Verify your identity</h2>',
        '<div class="note">Choose a method:</div>',
        '<div class="pill-wrap">',
        '  <span class="pill active" id="p-wa">WhatsApp OTP</span>',
        '  <span class="pill" id="p-staff">I have a staff code</span>',
        '</div>',
        '<div id="waBox" class="field" style="margin-top:10px;"></div>',
        '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
      ].join('');

      // WhatsApp UI
      const wa = document.getElementById('waBox');
      wa.innerHTML = [
        '<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div>',
        '<form id="otpForm" autocomplete="off" class="field">',
        '  <div class="row">',
        '    <input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required />',
        '    <button class="btn" type="submit">Verify</button>',
        '  </div>',
        '</form>',
        '<a class="btnlink" id="resend">Resend code</a>'
      ].join('');
      sendOtp();
      document.getElementById('resend').onclick = (e)=>{ e.preventDefault(); sendOtp(); };
      document.getElementById('otpForm').onsubmit = async (e)=>{
        e.preventDefault();
        const otp = e.target.otp.value.trim();
        const r = await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'wa'})});
        const d = await r.json().catch(()=>({ok:false}));
        if (d.ok) { step=2; state.progress=step; save(); render(); }
        else { document.getElementById('otpmsg').textContent = 'Invalid code. Try again.'; }
      };

      // Staff UI
      const staff = document.getElementById('staffBox');
      staff.innerHTML = [
        '<div class="note">Ask Vinet for a one-time staff code.</div>',
        '<form id="staffForm" autocomplete="off" class="field">',
        '  <div class="row">',
        '    <input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required />',
        '    <button class="btn" type="submit">Verify</button>',
        '  </div>',
        '</form>',
        '<div id="staffMsg" class="note"></div>'
      ].join('');
      document.getElementById('staffForm').onsubmit = async (e)=>{
        e.preventDefault();
        const otp = e.target.otp.value.trim();
        const r = await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:'staff'})});
        const d = await r.json().catch(()=>({ok:false}));
        if (d.ok) { step=2; state.progress=step; save(); render(); }
        else { document.getElementById('staffMsg').textContent = 'Invalid or expired staff code.'; }
      };

      // Switcher
      const pwa = document.getElementById('p-wa');
      const pst = document.getElementById('p-staff');
      pwa.onclick = ()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
      pst.onclick = ()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
      return;
    }

    // STEP 2: Preferences + Payment buttons with quick links
    if (step === 2) {
      const id = (linkid||'').split('_')[0];
      const quickEft = '/info/eft';
      const quickDebit = '/info/debit?id='+encodeURIComponent(id);
      const pay = state.pay_method || 'eft';

      stepEl.innerHTML = [
        '<h2>Contact Preferences</h2>',
        '<div class="field"><label>Preferred Language</label>',
        '<select id="lang">',
        '  <option value="en" '+(state.lang==='en'?'selected':'')+'>English</option>',
        '  <option value="af" '+(state.lang==='af'?'selected':'')+'>Afrikaans</option>',
        '  <option value="both" '+(state.lang==='both'?'selected':'')+'>Both</option>',
        '</select></div>',

        '<div class="field"><label>Payment Method</label>',
        '<div class="pill-wrap">',
        '  <span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span>',
        '  <span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span>',
        '</div>',
        '<div class="note" id="pm-note" style="margin-top:.6em"></div>',
        '</div>',

        '<div class="field"><label>Secondary Contact (optional)</label>',
        '<input id="secondary" placeholder="Name and number (optional)" value="'+(state.secondary||'')+'" />',
        '</div>',

        '<div class="row"><a class="btnlink" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>'
      ].join('');

      function setNote(which){
        const el = document.getElementById('pm-note');
        if (which === 'debit') el.innerHTML = 'Need a debit order? <a href="'+quickDebit+'" target="_blank">Open debit form</a>';
        else el.innerHTML = 'Prefer EFT? <a href="'+quickEft+'" target="_blank">View EFT details</a>';
      }
      setNote(pay);

      document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; save(); render(); };
      document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; save(); render(); };

      document.getElementById('back1').onclick = (e)=>{ e.preventDefault(); step=1; state.progress=step; save(); render(); };
      document.getElementById('cont').onclick = (e)=>{
        e.preventDefault();
        state.lang = document.getElementById('lang').value;
        state.secondary = document.getElementById('secondary').value || '';
        if (!state.pay_method) state.pay_method = 'eft';
        step=3; state.progress=step; save(); render();
      };
      return;
    }

    // STEP 3: Review/Edit details (fetched, then editable)
    if (step === 3) {
      stepEl.innerHTML = '<h2>Confirm your details</h2><div id="profBox" class="note">Loading your profile…</div>';
      (async ()=>{
        const prof = await fetchProfile();
        const p = prof || {};
        // hydrate with previously edited values
        const cur = {
          full_name: state.edits.full_name ?? p.full_name ?? '',
          email: state.edits.email ?? p.email ?? '',
          phone: state.edits.phone ?? p.phone ?? '',
          street: state.edits.street ?? p.street ?? '',
          city: state.edits.city ?? p.city ?? '',
          zip: state.edits.zip ?? p.zip ?? ''
        };
        document.getElementById('profBox').innerHTML = [
          '<div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'" /></div>',
          '<div class="row">',
          '  <div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'" /></div>',
          '  <div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'" /></div>',
          '</div>',
          '<div class="row">',
          '  <div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'" /></div>',
          '  <div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'" /></div>',
          '</div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'" /></div>',
          '<div class="row"><a class="btnlink" id="back2">Back</a><button class="btn" id="cont">Looks good</button></div>',
          '<div class="note">We\\u2019ll use these updates later to sync with our system.</div>'
        ].join('');
        document.getElementById('back2').onclick = (e)=>{ e.preventDefault(); step=2; state.progress=step; save(); render(); };
        document.getElementById('cont').onclick = (e)=>{
          e.preventDefault();
          state.edits = {
            full_name: document.getElementById('f_full').value.trim(),
            email: document.getElementById('f_email').value.trim(),
            phone: document.getElementById('f_phone').value.trim(),
            street: document.getElementById('f_street').value.trim(),
            city: document.getElementById('f_city').value.trim(),
            zip: document.getElementById('f_zip').value.trim()
          };
          step=4; state.progress=step; save(); render();
        };
      })();
      return;
    }

    // STEP 4: Uploads (same as before)
    if (step === 4) {
      stepEl.innerHTML = [
        '<h2>Upload your documents</h2>',
        '<div class="note">Allowed: PDF, JPG, PNG. Max 8 MB each.</div>',
        '<form id="upForm" class="field" enctype="multipart/form-data">',
        '  <div class="field"><label>Identity Document</label><input type="file" name="idfile" accept=".pdf,image/*" /></div>',
        '  <div class="field"><label>Proof of Address</label><input type="file" name="poafile" accept=".pdf,image/*" /></div>',
        '  <div class="row"><button class="btn" type="submit">Upload</button><a class="btnlink" id="skip">Skip</a></div>',
        '</form>',
        '<div id="uplMsg" class="note"></div>',
        '<div id="uplList"></div>',
        '<div class="row" style="margin-top:10px"><a class="btnlink" id="back3">Back</a><button class="btn" id="cont">Continue</button></div>'
      ].join('');

      const listEl = document.getElementById('uplList');
      const msg = document.getElementById('uplMsg');
      function refresh(){ listEl.innerHTML = renderUploads(state.uploads); bindDeletions(); }
      refresh();

      document.getElementById('back3').onclick = (e)=>{ e.preventDefault(); step=3; state.progress=step; save(); render(); };
      document.getElementById('skip').onclick = (e)=>{ e.preventDefault(); step=5; state.progress=step; save(); render(); };
      document.getElementById('cont').onclick = (e)=>{ e.preventDefault(); step=5; state.progress=step; save(); render(); };

      document.getElementById('upForm').onsubmit = async (e)=>{
        e.preventDefault();
        const idf = e.target.idfile.files[0];
        const poa = e.target.poafile.files[0];
        if (!idf && !poa) { msg.textContent = 'Choose at least one file.'; return; }
        async function up(file,label){
          const fd = new FormData();
          fd.append('linkid',linkid); fd.append('type',label); fd.append('file',file);
          const r = await fetch('/api/upload',{method:'POST',body:fd});
          const d = await r.json().catch(()=>({ok:false}));
          if (!d.ok) throw new Error(d.error||'Upload failed');
          return d.file;
        }
        msg.textContent='Uploading...';
        try {
          if (idf) state.uploads.push(await up(idf,'id'));
          if (poa) state.uploads.push(await up(poa,'poa'));
          save(); msg.textContent='Uploaded.'; refresh(); e.target.reset();
        } catch(err){ msg.textContent = err.message||'Upload failed.'; }
      };
      return;
    }

    // STEP 5: Agreements + signature (conditional terms)
    if (step === 5) {
      stepEl.innerHTML = [
        '<h2>Service Agreement</h2>',
        '<div id="terms" class="termsbox">Loading terms…</div>',
        '<div class="field"><label><input type="checkbox" id="agreeChk"/> I have read and accept the terms</label></div>',
        '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas>',
        '<div class="row"><a class="btnlink" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
        '<div class="row"><a class="btnlink" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
      ].join('');
      (async()=>{ try{
        const pay = (state.pay_method||'eft');
        const r = await fetch('/api/terms?pay='+encodeURIComponent(pay)); const t = await r.text();
        document.getElementById('terms').innerHTML = t || 'Terms not available.';
      }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
      const pad = signaturePad(document.getElementById('sig'));
      document.getElementById('clearSig').onclick = (e)=>{ e.preventDefault(); pad.clear(); };
      document.getElementById('back4').onclick = (e)=>{ e.preventDefault(); step=4; state.progress=step; save(); render(); };
      document.getElementById('signBtn').onclick = async (e)=>{
        e.preventDefault();
        const msg = document.getElementById('sigMsg');
        if (!document.getElementById('agreeChk').checked) { msg.textContent='Please tick the checkbox to accept the terms.'; return; }
        msg.textContent='Uploading signature…';
        try {
          const dataUrl = pad.dataURL();
          const r = await fetch('/api/sign',{method:'POST',body:JSON.stringify({linkid,dataUrl})});
          const d = await r.json().catch(()=>({ok:false}));
          if (d.ok) { step=6; state.progress=step; save(); render(); }
          else { msg.textContent=d.error||'Failed to save signature.'; }
        } catch { msg.textContent='Network error.'; }
      };
      return;
    }

    // STEP 6: Done
    stepEl.innerHTML = '<h2>All set!</h2><p>Thanks — we\\u2019ve recorded your onboarding.</p>';
  }

  render();
})();`;
      return new Response(js, { headers: jsHeaders });
    }

    // ------------ STATIC: staff.js ------------
    if (path === "/static/staff.js" && method === "GET") {
      const js = `
(() => {
  const $ = (s)=>document.querySelector(s);
  const out = $('#out');
  $('#gen').onclick = async () => {
    const linkid = ($('#linkid')?.value || '').trim();
    if (!linkid) { out.innerHTML = '<div class="err">Enter linkid</div>'; return; }
    try {
      const r = await fetch('/api/staff/gen', { method:'POST', body: JSON.stringify({ linkid }) });
      const d = await r.json().catch(()=>({ok:false}));
      out.innerHTML = d.ok ? '<div class="success">Staff code: <b>'+d.code+'</b> (valid 15 min)</div>' : '<div class="err">'+(d.error||'error')+'</div>';
    } catch { out.innerHTML = '<div class="err">Request failed</div>'; }
  };
})();`;
      return new Response(js, { headers: jsHeaders });
    }

    // ------------ API: TERMS (service + conditional debit) ------------
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay") || "eft").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

      async function fetchText(u) {
        if (!u) return "";
        try {
          const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } });
          return r.ok ? await r.text() : "";
        } catch { return ""; }
      }

      const [svc, deb] = await Promise.all([
        fetchText(svcUrl),
        pay === "debit" ? fetchText(debUrl) : Promise.resolve("")
      ]);

      const html =
        `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${escapeHtml(svc)}</pre>` +
        (deb ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${escapeHtml(deb)}</pre>` : "");

      return new Response(html || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8", ...noCache }
      });
    }

    // ------------ API: Splynx profile (merged view) ------------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try {
        const prof = await fetchProfileForDisplay(id);
        return json(prof);
      } catch (e) {
        console.error("profile error", e.message);
        return json({ error: "Lookup failed" }, 502);
      }
    }

    // ------------ API: OTP send ------------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await readJSON(request);
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];

      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(splynxId); }
      catch (e) { console.error("Splynx lookup failed", e.message); return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      try { 
        await sendWhatsAppTemplate(msisdn, code, "en"); 
        return json({ ok:true }); 
      } catch {
        try { 
          await sendWhatsAppTextIfSessionOpen(msisdn, \`Your Vinet verification code is: \${code}\`);
          return json({ ok:true, note:"sent-as-text" }); 
        } catch { 
          return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502); 
        }
      }
    }

    // ------------ API: OTP verify (WA + staff) ------------
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await readJSON(request);
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ------------ API: save progress ------------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await readJSON(request);
      const ip = getIP();
      const ua = getUA();
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: ip, last_ua: ua, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------------ API: file upload (multipart -> R2) ------------
    if (path === "/api/upload" && method === "POST") {
      const ct = request.headers.get("content-type") || "";
      if (!ct.includes("multipart/form-data")) return json({ ok:false, error:"Invalid content-type" }, 415);
      const form = await request.formData();
      const linkid = (form.get("linkid") || "").toString();
      const type = (form.get("type") || "").toString(); // 'id' | 'poa'
      const file = form.get("file");
      if (!linkid || !type || !file || typeof file === "string") return json({ ok:false, error:"Missing fields" }, 400);

      const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
      const MAX = 8 * 1024 * 1024; // 8 MB
      const mime = file.type || "";
      const size = file.size || 0;
      if (!ALLOWED.includes(mime)) return json({ ok:false, error:"Unsupported file type" }, 400);
      if (size > MAX) return json({ ok:false, error:"File too large (8MB max)" }, 400);

      const name = (file.name || "upload").replace(/[^\w.\-]+/g, "_").slice(0, 80);
      const ts = Date.now();
      const key = `uploads/${linkid}/${type}-${ts}-${name}`;
      const buf = await file.arrayBuffer();

      await env.R2_UPLOADS.put(key, buf, { httpMetadata: { contentType: mime } });

      // update session uploads
      const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const item = { key, label: type === "id" ? "ID Document" : "Proof of Address", name, size, mime, ts };
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      uploads.push(item);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });

      return json({ ok:true, file: item });
    }

    // ------------ API: delete uploaded file ------------
    if (path === "/api/upload/delete" && method === "POST") {
      const { linkid, key } = await readJSON(request);
      if (!linkid || !key) return json({ ok:false, error:"Missing params" }, 400);
      await env.R2_UPLOADS.delete(key).catch(()=>{});
      const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const uploads = (sess.uploads || []).filter(u => u.key !== key);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------------ API: sign & store signature (R2) ------------
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await readJSON(request);
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok:false, error:"Missing or invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const now = new Date().toISOString();
      const ip = getIP();
      const ua = getUA();

      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
        httpMetadata: { contentType: "image/png" }
      });

      const receipt = { linkid, signed_at: now, ip, ua, note: "agreement accepted" };
      await env.ONBOARD_KV.put(`agreement/${linkid}`, JSON.stringify(receipt), { expirationTtl: 60*60*24*30 });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
          ...sess, progress: 6, agreement_signed: true, agreement_sig_key: sigKey
        }), { expirationTtl: 86400 });
      }

      return json({ ok:true, sigKey });
    }

    // ------------ 404 ------------
    return new Response("Not found", { status: 404 });

    // helpers
    function json(obj, status=200) {
      return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...noCache } });
    }
    function escapeHtml(s=""){return s.replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));}
  }
}
