export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------- Utils ----------
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") || "";

    async function parseJson(req) {
      try { return await req.json(); } catch { return {}; }
    }

    function page(content, title = "Vinet Onboarding") {
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui,sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:520px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .field { margin:1em 0; }
    input, select { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size: 12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .5s; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${content}
  </div>
</body>
</html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
            pragma: "no-cache",
            expires: "0",
          },
        }
      );
    }

    // Extract Splynx ID from linkid like "319_abcd1234"
    function parseSplynxIdFromLink(linkid) {
      return String(linkid || "").split("_")[0];
    }

    // Basic phone pick from Splynx payload (expects "277..." format per your note)
    function pickSplynxMsisdn(obj) {
      if (!obj || typeof obj !== "object") return null;
      const candidates = [
        obj.phone_mobile,
        obj.mobile,
        obj.phone,
        obj.whatsapp,
        obj.msisdn,
      ].filter(Boolean);
      for (const v of candidates) {
        const s = String(v).trim();
        if (/^27\d{9,13}$/.test(s)) return s; // 27 + 9..13 digits
      }
      // Look into nested contact arrays if present
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            const m = pickSplynxMsisdn(item);
            if (m) return m;
          }
        } else if (val && typeof val === "object") {
          const m = pickSplynxMsisdn(val);
          if (m) return m;
        }
      }
      return null;
    }

    async function splynxGET(env, endpoint) {
      const resp = await fetch(`${env.SPLYNX_API}${endpoint}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      });
      if (!resp.ok) {
        const t = await resp.text().catch(()=> "");
        throw new Error(`Splynx GET ${endpoint} ${resp.status} ${t}`);
      }
      return resp.json();
    }

    // Try common customer/lead endpoints to find a number (kept simple, no assumptions)
    async function fetchSplynxMsisdn(env, id) {
      const endpoints = [
        `/admin/customers/${id}`,
        `/admin/customers/${id}/contacts`,
        `/crm/leads/${id}`,
        `/crm/leads/${id}/contacts`,
      ];
      for (const ep of endpoints) {
        try {
          const data = await splynxGET(env, ep);
          const msisdn = pickSplynxMsisdn(data);
          if (msisdn) return msisdn;
        } catch (e) {
          // continue trying others
        }
      }
      return null;
    }

    async function sendWhatsApp(env, toMsisdn, message) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "text",
        text: { body: message },
      };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(()=> "");
        console.error("WhatsApp send error", resp.status, txt);
        throw new Error(`WhatsApp API ${resp.status}`);
      }
      return true;
    }

    // ---------- Admin (server-side form, no JS) ----------
    if (path === "/admin" && method === "GET") {
      return new Response(null, { status: 302, headers: { Location: "/admin2" } });
    }

    if (path === "/admin2" && method === "GET") {
      return page(`
        <h1>Generate Onboarding Link</h1>
        <form action="/admin2/gen" method="GET" autocomplete="off">
          <div class="field">
            <label>Splynx Lead/Customer ID</label>
            <input name="id" required autocomplete="off" />
          </div>
          <button class="btn" type="submit">Generate Link</button>
        </form>
        <p class="note">Or open: <code>/admin2/gen?id=319</code></p>
      `, "Admin - Generate Link");
    }

    if (path === "/admin2/gen" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        return page(`<h2 class="err">Missing ?id</h2><p>Usage: /admin2/gen?id=319</p>`, "Admin - Error");
      }
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });
      const link = `/onboard/${linkid}`;
      return page(`
        <p class="success">Onboarding link created:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p><a class="btn" href="/admin2">Generate another</a></p>
      `, "Admin - Link Ready");
    }

    // JSON POST still available if you later need it
    if (path === "/admin" && method === "POST") {
      const { id } = await parseJson(request);
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400 });
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ url: `/onboard/${linkid}` }), {
        headers: { "content-type": "application/json" }
      });
    }

    // ---------- Onboarding UI ----------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session) {
        return page(`<h2>Invalid or expired link</h2><p class="err">Please request a new onboarding link.</p>`, "Onboarding");
      }
      return page(`
        <div id="step"></div>
        <script>
          let state = ${JSON.stringify(session)};
          let step = state.progress || 0;
          const totalSteps = 6;
          const el = document.getElementById("step");

          function render() {
            const pct = Math.round(100 * (step) / totalSteps);
            el.innerHTML = \`
              <div class="progressbar"><div class="progress" style="width:\${pct}%"></div></div>
              <h2>Step \${step+1} of \${totalSteps}</h2>
              \${getStep()}
            \`;
          }

          function getStep() {
            // Step 0: WhatsApp OTP sent to number from Splynx (no input)
            if (step === 0) {
              return \`
                <p>We sent a 6-digit code to your WhatsApp number on file.</p>
                <form id="otpForm" autocomplete="off">
                  <div class="field">
                    <label>Enter OTP</label>
                    <input name="otp" maxlength="6" pattern="\\\\d{6}" required />
                  </div>
                  <button class="btn" type="submit">Verify</button>
                  <div id="otpMsg" class="note"></div>
                </form>
                <script>
                  // Trigger send immediately on render
                  (async () => {
                    const res = await fetch('/api/otp/send', { method:'POST', body: JSON.stringify({ linkid: '${linkid}' }) });
                    const data = await res.json().catch(()=>({ok:false}));
                    const msg = document.getElementById('otpMsg');
                    if (data.ok) {
                      msg.textContent = 'Code sent. Check your WhatsApp.';
                    } else {
                      msg.textContent = 'Could not send code. Please contact support.';
                    }
                  })();

                  const otpForm = document.getElementById('otpForm');
                  otpForm.onsubmit = async (e) => {
                    e.preventDefault();
                    const otp = otpForm.otp.value.trim();
                    const res = await fetch('/api/otp/verify', { method:'POST', body: JSON.stringify({ linkid: '${linkid}', otp }) });
                    const data = await res.json().catch(()=>({ok:false}));
                    const msg = document.getElementById('otpMsg');
                    if (data.ok) { step++; state.progress = step; update(); render(); }
                    else { msg.textContent = 'Invalid code. Try again.'; }
                  };
                <\\/script>
              \`;
            }

            // Step 1: Preferred language + secondary contact
            if (step === 1) {
              return \`
                <form id="langForm">
                  <div class="field">
                    <label>Preferred Language</label>
                    <select name="lang" required>
                      <option value="en">English</option>
                      <option value="af">Afrikaans</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>Secondary Contact (optional)</label>
                    <input name="secondary" autocomplete="off" />
                  </div>
                  <button class="btn">Continue</button>
                </form>
                <script>
                  const langForm = document.getElementById('langForm');
                  langForm.onsubmit = (e) => {
                    e.preventDefault();
                    state.lang = langForm.lang.value;
                    state.secondary = langForm.secondary.value || '';
                    step++; state.progress = step; update(); render();
                  };
                <\\/script>
              \`;
            }

            // TODO: Steps 2..5 (uploads, agreement/signature, payment choice, confirm)
            return '<p>More onboarding steps coming next…</p>';
          }

          function update() {
            fetch('/api/progress/${linkid}', { method:'POST', body: JSON.stringify(state) });
          }

          render();
        <\\/script>
      `, "Onboarding");
    }

    // ---------- OTP API (WhatsApp via Splynx number) ----------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await parseJson(request);
      if (!linkid) {
        return new Response(JSON.stringify({ ok:false, error:"Missing linkid" }), { headers:{ "content-type":"application/json" }, status:400 });
      }
      const splynxId = parseSplynxIdFromLink(linkid);
      // get number from Splynx
      const msisdn = await fetchSplynxMsisdn(env, splynxId);
      if (!msisdn) {
        return new Response(JSON.stringify({ ok:false, error:"No WhatsApp number on file" }), { headers:{ "content-type":"application/json" }, status:404 });
      }

      // generate & store code
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 }); // 10 min
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      // send via WhatsApp
      try {
        await sendWhatsApp(env, msisdn, `Your Vinet verification code is: ${code}`);
        return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok:false, error:"WhatsApp send failed" }), { headers: { "content-type":"application/json" }, status:502 });
      }
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await parseJson(request);
      const expected = await env.ONBOARD_KV.get(`otp/${linkid}`);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) {
          await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        }
      }
      return new Response(JSON.stringify({ ok }), { headers: { "content-type":"application/json" } });
    }

    // ---------- Session save ----------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await parseJson(request);
      const ip = getIP();
      const session = { ...body, last_ip: ip, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(session), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
    }

    // ---------- Default ----------
    return new Response("Not found", { status: 404 });
  }
}
