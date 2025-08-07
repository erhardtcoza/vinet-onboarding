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
    .card { background:#fff; max-width:560px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .btn-secondary { background:#eee; color:#222; border:0; border-radius:.7em; padding:.6em 1.2em; text-decoration:none; display:inline-block; }
    .field { margin:1em 0; }
    input, select { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size:12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .4s; }
    .row { display:flex; gap:.75em; }
    .row > * { flex:1; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    a.btnlink { display:inline-block; background:#eee; color:#222; padding:.5em .8em; border-radius:.6em; text-decoration:none; margin-top:.8em; }
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

    function pickPhone(obj) {
      if (!obj) return null;
      const tryField = (v) => {
        if (!v) return null;
        const s = String(v).trim();
        if (/^27\d{8,13}$/.test(s)) return s; // already 27xxxxxxxxx
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

    // ------------ WhatsApp senders ------------
    async function sendWhatsAppTemplate(toMsisdn, code, lang = "en") {
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp"; // ensure this matches in Meta
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "template",
        template: {
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
          components: [
            // Body {{1}} = OTP
            { type: "body", parameters: [{ type: "text", text: code }] },
            // URL button {{1}} = short param (OTP). Your template base URL should be like:
            // https://onboard.vinet.co.za/verify?code=
            { type: "button", sub_type: "url", index: "0",
              parameters: [{ type: "text", text: code }] }
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

    // ------------ ADMIN ------------
    if (path === "/admin2" && method === "GET") {
      return page(`
        <h1>Generate Onboarding Link</h1>
        <form action="/admin2/gen" method="GET" autocomplete="off" class="field">
          <label>Splynx Lead/Customer ID</label>
          <div class="row">
            <input name="id" required autocomplete="off" />
            <button class="btn" type="submit">Generate Link</button>
          </div>
        </form>
        <div class="note">Works without JavaScript.</div>
      `, { title: "Admin - Generate Link" });
    }

    if (path === "/admin2/gen" && method === "GET") {
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
        <div class="field">
          <label>URL</label>
          <input class="mono" value="${full}" readonly />
        </div>
        <p>
          <a class="btn" href="${full}" target="_blank">Open link</a>
          <a class="btn-secondary" href="/admin2">Generate another</a>
        </p>
      `, { title: "Admin - Link Ready" });
    }

    // ------------ ONBOARDING HTML (loads JS from /static/onboard.js) ------------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session) return page(`<h2 class="err">Invalid or expired link.</h2>`, { title: "Onboarding" });

      const pct = (session.progress || 0) * 20 + 20;
      return new Response(
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Onboarding</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:560px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .field { margin:1em 0; }
    input, select { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size:12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .4s; }
    .row { display:flex; gap:.75em; }
    .row > * { flex:1; }
    a.btnlink { display:inline-block; background:#eee; color:#222; padding:.5em .8em; border-radius:.6em; text-decoration:none; margin-top:.8em; }
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

    // ------------ STATIC: onboard.js ------------
    if (path === "/static/onboard.js" && method === "GET") {
      const js = `
(function(){
  const root = document.getElementById('root');
  if (!root) return;
  const linkid = root.getAttribute('data-linkid');
  let step = parseInt(root.getAttribute('data-progress') || '0', 10) || 0;
  const total = 5;
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');

  function setProgress(){
    const pct = Math.min(100, Math.round(((step+1)/(total+1))*100));
    if (progEl) progEl.style.width = pct + '%';
  }
  function save(state){
    try { fetch('/api/progress/' + linkid, { method:'POST', body: JSON.stringify(state) }); } catch(e){}
  }

  async function sendOtp(){
    const msg = document.getElementById('otpmsg');
    if (msg) msg.textContent = 'Sending code to WhatsApp...';
    try {
      const r = await fetch('/api/otp/send', { method:'POST', body: JSON.stringify({ linkid }) });
      const data = await r.json().catch(()=>({ok:false}));
      if (msg) msg.textContent = data.ok ? 'Code sent. Check your WhatsApp.' : ('Failed to send: ' + (data.error || 'unknown'));
    } catch {
      if (msg) msg.textContent = 'Network error sending code.';
    }
  }

  let state = { progress: step };

  function render(){
    setProgress();

    if (step === 0) {
      stepEl.innerHTML = [
        '<h2>Verify your number</h2>',
        '<p class="note">We\\u2019re using the WhatsApp number on your account.</p>',
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
      const resend = document.getElementById('resend');
      if (resend) resend.onclick = (e)=>{ e.preventDefault(); sendOtp(); };
      const form = document.getElementById('otpForm');
      if (form) form.onsubmit = async (e)=>{
        e.preventDefault();
        const otp = form.otp.value.trim();
        const r = await fetch('/api/otp/verify', { method:'POST', body: JSON.stringify({ linkid, otp }) });
        const data = await r.json().catch(()=>({ok:false}));
        const msg = document.getElementById('otpmsg');
        if (data.ok) { step=1; state.progress=step; save(state); render(); }
        else { if (msg) msg.textContent = 'Invalid code. Try again.'; }
      };
      return;
    }

    if (step === 1) {
      stepEl.innerHTML = [
        '<h2>Contact Preferences</h2>',
        '<form id="prefs" autocomplete="off">',
        '  <div class="field">',
        '    <label>Preferred Language</label>',
        '    <select name="lang" required>',
        '      <option value="en">English</option>',
        '      <option value="af">Afrikaans</option>',
        '      <option value="both">Both</option>',
        '    </select>',
        '  </div>',
        '  <div class="field">',
        '    <label>Secondary Contact (optional)</label>',
        '    <input name="secondary" placeholder="Name and number (optional)" />',
        '  </div>',
        '  <div class="row">',
        '    <button class="btn" type="submit">Continue</button>',
        '    <a class="btnlink" id="skip">Skip</a>',
        '  </div>',
        '</form>'
      ].join('');
      const skip = document.getElementById('skip');
      if (skip) skip.onclick = (e)=>{ e.preventDefault(); step=2; state.progress=step; save(state); render(); };
      const prefs = document.getElementById('prefs');
      if (prefs) prefs.onsubmit = (e)=>{
        e.preventDefault();
        state.lang = prefs.lang.value;
        state.secondary = prefs.secondary.value || '';
        step=2; state.progress=step; save(state); render();
      };
      return;
    }

    if (step === 2) {
      stepEl.innerHTML = [
        '<h2>Confirm Your Details</h2>',
        '<p class="note">We will fetch and display your details here for confirmation.</p>',
        '<button class="btn" id="next">Looks good</button>'
      ].join('');
      const n = document.getElementById('next');
      if (n) n.onclick = ()=>{ step=3; state.progress=step; save(state); render(); };
      return;
    }

    if (step === 3) {
      stepEl.innerHTML = [
        '<h2>Upload ID/POA</h2>',
        '<p class="note">Upload interface coming next. You can continue for now.</p>',
        '<button class="btn" id="next">Continue</button>'
      ].join('');
      const n = document.getElementById('next');
      if (n) n.onclick = ()=>{ step=4; state.progress=step; save(state); render(); };
      return;
    }

    if (step === 4) {
      stepEl.innerHTML = [
        '<h2>Service Agreement</h2>',
        '<p class="note">Terms and signature step coming next.</p>',
        '<button class="btn" id="finish">Finish</button>'
      ].join('');
      const f = document.getElementById('finish');
      if (f) f.onclick = ()=>{ step=5; state.progress=step; save(state); render(); };
      return;
    }

    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we\\u2019ve recorded your onboarding.</p>'
    ].join('');
  }

  render();
})();`;
      return new Response(js, { headers: jsHeaders });
    }

    // ------------ API: OTP send ------------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await readJSON(request);
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);

      const splynxId = (linkid || "").split("_")[0];

      // 1) get msisdn
      let msisdn = null;
      try {
        msisdn = await fetchCustomerMsisdn(splynxId);
      } catch (e) {
        console.error("Splynx lookup failed", e.message);
        return json({ ok:false, error:"Splynx lookup failed" }, 502);
      }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      // 2) make code
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      // 3) send template; fallback to text if session is open
      try {
        await sendWhatsAppTemplate(msisdn, code, "en");
        return json({ ok:true });
      } catch (e) {
        try {
          await sendWhatsAppTextIfSessionOpen(msisdn, `Your Vinet verification code is: ${code}`);
          return json({ ok:true, note:"sent-as-text" });
        } catch (e2) {
          return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502);
        }
      }
    }

    // ------------ API: OTP verify ------------
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await readJSON(request);
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const expected = await env.ONBOARD_KV.get(`otp/${linkid}`);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
      }
      return json({ ok });
    }

    // ------------ API: save progress ------------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await readJSON(request);
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const ua = request.headers.get("user-agent") || "";
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: ip, last_ua: ua, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ------------ 404 ------------
    return new Response("Not found", { status: 404 });

    // helper
    function json(obj, status=200) {
      return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...noCache } });
    }
  }
}
