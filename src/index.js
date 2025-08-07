export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Utils
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    async function parseBody(req) {
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
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .5s; }
    .build { font-size:12px; color:#666; margin-top:10px; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${content}
    <div class="build">vinet-onboarding server-form build</div>
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

    // Redirect old admin -> new
    if (path === "/admin" && method === "GET") {
      return new Response(null, { status: 302, headers: { Location: "/admin2" } });
    }

    // --- Admin (server-side form, no JS required) ---
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
        <p style="margin-top:10px;color:#555">Tip: Press Enter to submit.</p>
      `, "Admin - Generate Link");
    }

    // --- Admin link generator (GET fallback endpoint) ---
    if (path === "/admin2/gen" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        return page(`<h2 class="err">Missing ?id</h2><p>Usage: /admin2/gen?id=319</p>`, "Admin - Error");
      }
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, started: false, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });
      const link = `/onboard/${linkid}`;
      return page(`
        <p class="success">Onboarding link created:</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p><a class="btn" href="/admin2">Generate another</a></p>
      `, "Admin - Link Ready");
    }

    // --- (Keep JSON POST if you later want to call it from JS) ---
    if (path === "/admin" && method === "POST") {
      const { id } = await parseBody(request);
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400 });
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, started: false, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ url: `/onboard/${linkid}` }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    // --- Onboarding UI (resume support) ---
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session)
        return page(`<h2>Invalid or expired link</h2><p class="err">Please contact support to request a new onboarding link.</p>`, "Onboarding");

      return page(`
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
      `, "Onboarding");
    }

    // OTP demo
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await parseBody(request);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      console.log(`[DEMO] OTP for ${linkid}: ${code}`);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await parseBody(request);
      const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
      return new Response(JSON.stringify({ ok: code && code === otp }), { headers: { "content-type": "application/json" } });
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await parseBody(request);
      const ip = getIP();
      const session = { ...body, last_ip: ip, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(session), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  }
}
