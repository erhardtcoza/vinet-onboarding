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

    // E.164-ish normalizer (defaults ZA if leading 0)
    function normalizeMsisdn(input) {
      if (!input) return null;
      let s = String(input).replace(/[^\d+]/g, "");
      if (s.startsWith("+")) s = s.slice(1);
      if (s.startsWith("0") && s.length >= 10) s = "27" + s.slice(1); // ZA default
      // basic sanity
      if (!/^\d{10,15}$/.test(s)) return null;
      return s;
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
        const txt = await resp.text();
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
        <p class="note">You can also open: <code>/admin2/gen?id=319</code></p>
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

    // JSON POST generator still available (unused by admin2 page now)
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
            // Step 0: WhatsApp OTP (collect phone, send, verify)
            if (step === 0) {
              return \`
                <form id="waForm" autocomplete="off">
                  <div class="field">
                    <label>Mobile number for WhatsApp OTP</label>
                    <input name="msisdn" placeholder="+27xxxxxxxxx or 0xxxxxxxxx" required />
                    <p class="note">We will send a 6-digit code to your WhatsApp.</p>
                  </div>
                  <button class="btn">Send code</button>
                  <div id="waMsg"></div>
                </form>
                <form id="otpForm" class="field" autocomplete="off" style="margin-top:10px">
                  <label>Enter OTP</label>
                  <input name="otp" maxlength="6" pattern="\\\\d{6}" />
                  <button class="btn" type="submit">Verify</button>
                  <div id="otpMsg"></div>
                </form>
                <script>
                  const waForm = document.getElementById('waForm');
                  const otpForm = document.getElementById('otpForm');
                  const waMsg = document.getElementById('waMsg');
                  const otpMsg = document.getElementById('otpMsg');

                  waForm.onsubmit = async (e) => {
                    e.preventDefault();
                    waMsg.textContent = 'Sending code...';
                    const msisdn = waForm.msisdn.value.trim();
                    const res = await fetch('/api/otp/send', { method:'POST', body: JSON.stringify({ linkid: '${linkid}', msisdn }) });
                    const data = await res.json().catch(()=>({ok:false}));
                    waMsg.textContent = data.ok ? 'Code sent via WhatsApp.' : ('Failed to send code' + (data.error ? ': '+data.error : ''));
                  };

                  otpForm.onsubmit = async (e) => {
                    e.preventDefault();
                    const otp = otpForm.otp.value.trim();
                    if (!/^[0-9]{6}$/.test(otp)) { otpMsg.textContent = 'Enter a valid 6-digit code.'; return; }
                    const res = await fetch('/api/otp/verify', { method:'POST', body: JSON.stringify({ linkid: '${linkid}', otp }) });
                    const data = await res.json().catch(()=>({ok:false}));
                    if (data.ok) { step++; state.progress = step; update(); render(); }
                    else { otpMsg.textContent = 'Invalid code.'; }
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

    // ---------- OTP API (WhatsApp) ----------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid, msisdn } = await parseJson(request);
      if (!linkid || !msisdn) {
        return new Response(JSON.stringify({ ok:false, error:"Missing linkid or msisdn" }), { headers:{ "content-type":"application/json" }, status:400 });
      }
      const to = normalizeMsisdn(msisdn);
      if (!to) {
        return new Response(JSON.stringify({ ok:false, error:"Invalid phone format" }), { headers:{ "content-type":"application/json" }, status:400 });
      }

      // generate & store code
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 }); // 10 min
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, to, { expirationTtl: 600 });

      // send via WhatsApp
      try {
        await sendWhatsApp(env, to, `Your Vinet verification code is: ${code}`);
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
        // extend session TTL on success
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
