export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- Utility: Get IP ---
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    // --- Utility: Parse JSON body ---
    async function parseBody(req) {
      try {
        return await req.json();
      } catch {
        return {};
      }
    }

    // --- HTML Helper ---
    function html(content, { title = "Vinet Onboarding" } = {}) {
      return new Response(
        `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>${title}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>
            body { font-family: system-ui,sans-serif; background: #fafbfc; color: #232; }
            .card { background: #fff; max-width: 420px; margin: 3em auto; border-radius: 1.25em; box-shadow: 0 2px 12px #0002; padding: 2em 2em 1.5em; }
            .logo { display: block; margin: 0 auto 1em; max-width: 90px; }
            h1, h2 { color: #e2001a; }
            .btn { background: #e2001a; color: #fff; border: 0; border-radius: 0.7em; padding: 0.7em 2em; font-size: 1em; cursor: pointer; margin: 1.2em 0 0; }
            .field { margin: 1.1em 0; }
            input, select { width: 100%; padding: 0.7em; font-size: 1em; border-radius: 0.5em; border: 1px solid #ddd; }
            .progressbar { height: 7px; background: #eee; border-radius: 5px; margin: 1.4em 0 2.2em; overflow: hidden; }
            .progress { height: 100%; background: #e2001a; transition: width 0.5s; }
            .lang-opt { margin-right: 1em; }
            .err { color: #c00; font-size: 0.98em; }
            .success { color: #090; }
            .hidden { display: none !important; }
          </style>
        </head>
        <body>
          <div class="card">
            <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
            ${content}
          </div>
        </body>
        </html>`,
        { headers: { "content-type": "text/html" } }
      );
    }

    // --- /admin: Generate onboarding link (GET) ---
    if (path === "/admin" && method === "GET") {
      return html(`
        <h1>Generate Onboarding Link</h1>
        <form id="adminForm" autocomplete="off">
          <div class="field">
            <label>Splynx Lead/Customer ID</label>
            <input name="splynx_id" required autocomplete="off" />
          </div>
          <button class="btn" type="submit">Generate Link</button>
        </form>
        <div id="link"></div>
        <script>
          document.getElementById("adminForm").onsubmit = async e => {
            e.preventDefault();
            const id = document.querySelector("[name=splynx_id]").value;
            const resp = await fetch("/admin", { 
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id }) 
            });
            const data = await resp.json();
            document.getElementById("link").innerHTML = data.url 
              ? '<div class="success">Onboarding link: <a href="'+data.url+'" target="_blank">'+data.url+'</a></div>'
              : '<div class="err">Error generating link.</div>';
          };
        <\\/script>
      `, { title: "Admin - Generate Link" });
    }

    // --- /admin: POST - create link ---
    if (path === "/admin" && method === "POST") {
      const { id } = await parseBody(request);
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400 });
      // Generate unique 8-char onboarding link (24h expiry)
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      const kvkey = `onboard/${linkid}`;
      await env.ONBOARD_KV.put(kvkey, JSON.stringify({
        id, started: false, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 }); // 24h expiry
      return new Response(JSON.stringify({ url: `/onboard/${linkid}` }), {
        headers: { "content-type": "application/json" }
      });
    }

    // --- /onboard/:linkid [GET] - Main onboarding UI ---
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      const kvkey = `onboard/${linkid}`;
      const session = await env.ONBOARD_KV.get(kvkey, "json");
      if (!session)
        return html(`<h2>Invalid or expired link</h2><p class="err">Please contact support to request a new onboarding link.</p>`);
      // Progress, resume support
      return html(`
        <div id="step"></div>
        <script>
          let state = ${JSON.stringify(session)};
          let step = state.progress || 0;
          const totalSteps = 6;
          const el = document.getElementById("step");

          function render() {
            let pct = Math.round(100 * (step) / totalSteps);
            el.innerHTML = \`
              <div class="progressbar"><div class="progress" style="width:\${pct}%"></div></div>
              <h2>Step \${step+1} of \${totalSteps}</h2>
              \${getStep()}
            \`;
          }

          function getStep() {
            if (step === 0) {
              return \`
                <form id="otpForm">
                  <label>OTP Code (sent to your registered contact)</label>
                  <input name="otp" maxlength="6" required pattern="\\\\d{6}" autocomplete="one-time-code" />
                  <button class="btn">Verify</button>
                  <div id="otpmsg"></div>
                </form>
                <script>
                  fetch('/api/otp/send', {method:'POST',body:JSON.stringify({linkid:'${linkid}'})});
                  document.getElementById('otpForm').onsubmit = async e => {
                    e.preventDefault();
                    let otp = e.target.otp.value;
                    let resp = await fetch('/api/otp/verify', {method:'POST',body:JSON.stringify({linkid:'${linkid}',otp})});
                    let data = await resp.json();
                    if (data.ok) { step++; state.progress=step; updateSession(); render(); }
                    else document.getElementById('otpmsg').innerHTML = '<span class="err">Invalid OTP</span>';
                  }
                <\\/script>
              \`;
            }
            if (step === 1) {
              return \`
                <form id="langForm">
                  <label>Preferred Language</label>
                  <select name="lang" required>
                    <option value="en">English</option>
                    <option value="af">Afrikaans</option>
                    <option value="both">Both</option>
                  </select>
                  <button class="btn">Continue</button>
                </form>
                <form id="secContactForm">
                  <label>Secondary Contact (optional)</label>
                  <input name="secondary" autocomplete="off" />
                  <button class="btn" type="button" onclick="step++;state.progress=step;updateSession();render();">Skip</button>
                </form>
                <script>
                  document.getElementById('langForm').onsubmit = e => {
                    e.preventDefault();
                    state.lang = e.target.lang.value;
                    step++; state.progress=step; updateSession(); render();
                  }
                  document.getElementById('secContactForm').onsubmit = e => {
                    e.preventDefault();
                    state.secondary = e.target.secondary.value;
                    step++; state.progress=step; updateSession(); render();
                  }
                <\\/script>
              \`;
            }
            // Steps 2+: review details, product selection, uploads, agreement, finish
            return '<p>More onboarding steps here (WIP)...</p>';
          }

          function updateSession() {
            fetch('/api/progress/${linkid}', {
              method: 'POST',
              body: JSON.stringify(state)
            });
          }
          render();
        <\\/script>
      `);
    }

    // --- /api/otp/send [POST] ---
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await parseBody(request);
      // TODO: Fetch contact from Splynx by lead/customer ID, send OTP (store to KV)
      // Here we just fake-send a code for demo purposes:
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 }); // valid 10min
      // TODO: Send code to user's email/phone here (integrate with Splynx contact/email/SMS)
      console.log(`[DEMO] OTP for ${linkid}: ${code}`);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // --- /api/otp/verify [POST] ---
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await parseBody(request);
      const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
      return new Response(JSON.stringify({ ok: code && code === otp }), { headers: { "content-type": "application/json" } });
    }

    // --- /api/progress/:linkid [POST] - Save progress ---
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await parseBody(request);
      // Log IP/device info, save to KV for session
      const ip = getIP();
      // TODO: Parse user agent/device
      const session = { ...body, last_ip: ip, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(session), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // --- Default: Not found ---
    return new Response("Not found", { status: 404 });
  }
}
