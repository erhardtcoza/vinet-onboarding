export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- Utils ---
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    async function parseBody(req) {
      try { return await req.json(); } catch { return {}; }
    }

    const BUILD_TAG = "vinet-onboarding build 2025-08-07 21:10 SAST";

    // --- HTML helper (no-cache + permissive CSP for inline JS) ---
    function html(content, { title = "Vinet Onboarding" } = {}) {
      const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: system-ui,sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width: 520px; margin: 2.5em auto; border-radius: 1.25em; box-shadow: 0 2px 12px #0002; padding: 1.75em 1.75em 1.25em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:0.7em; padding:0.7em 2em; font-size:1em; cursor:pointer; margin:0.8em 0 0; }
    .field { margin: 1em 0; }
    input, select { width:100%; padding:0.7em; font-size:1em; border-radius:0.5em; border:1px solid #ddd; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width 0.5s; }
    .err { color:#c00; font-size:0.98em; }
    .success { color:#090; }
    .build { font-size:12px; color:#666; margin-top:10px; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${content}
    <div class="build">${BUILD_TAG}</div>
  </div>
</body>
</html>`;

      return new Response(body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
          "pragma": "no-cache",
          "expires": "0",
          // allow inline script while we iterate (tighten later)
          "content-security-policy":
            "default-src 'self'; img-src 'self' https://static.vinet.co.za data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self';",
        },
      });
    }

    // --- Hard redirect /admin -> /admin2 to kill any old cached page ---
    if (path === "/admin" && method === "GET") {
      return new Response(null, {
        status: 302,
        headers: { "Location": "/admin2", "cache-control": "no-store" }
      });
    }

    // --- New admin UI (no form) ---
    if (path === "/admin2" && method === "GET") {
      return html(`
        <h1>Generate Onboarding Link</h1>

        <div id="adminBox">
          <div class="field">
            <label>Splynx Lead/Customer ID</label>
            <input id="splynx_id" autocomplete="off" />
          </div>
          <button class="btn" id="genLinkBtn" type="button">Generate Link</button>
        </div>

        <div id="link"></div>

        <script>
          console.log("[admin2] loaded: ${BUILD_TAG}");
          const input = document.getElementById("splynx_id");
          const btn   = document.getElementById("genLinkBtn");
          const out   = document.getElementById("link");

          // Prevent Enter from navigating; map it to click
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              btn.click();
            }
          });

          btn.addEventListener("click", async () => {
            const id = input.value.trim();
            if (!id) { out.innerHTML = '<div class="err">Please enter an ID.</div>'; return; }
            out.innerHTML = '<div style="color:#666">Generating…</div>';
            try {
              const resp = await fetch("/admin", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id })
              });
              if (!resp.ok) {
                out.innerHTML = '<div class="err">Error: '+ await resp.text() +'</div>';
                return;
              }
              const data = await resp.json();
              if (data && data.url) {
                out.innerHTML = '<div class="success">Onboarding link: <a href="'+data.url+'" target="_blank">'+data.url+'</a></div>';
              } else {
                out.innerHTML = '<div class="err">Unexpected response.</div>';
              }
            } catch (err) {
              console.error(err);
              out.innerHTML = '<div class="err">Fetch failed.</div>';
            }
          });
        <\\/script>
      `, { title: "Admin - Generate Link (v2)" });
    }

    // --- /admin POST - create link (unchanged) ---
    if (path === "/admin" && method === "POST") {
      const { id } = await parseBody(request);
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400 });
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      const kvkey = `onboard/${linkid}`;
      await env.ONBOARD_KV.put(kvkey, JSON.stringify({
        id, started: false, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 }); // 24h
      return new Response(JSON.stringify({ url: `/onboard/${linkid}` }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }

    // --- Onboarding UI (unchanged scaffold) ---
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      const kvkey = `onboard/${linkid}`;
      const session = await env.ONBOARD_KV.get(kvkey, "json");
      if (!session)
        return html(`<h2>Invalid or expired link</h2><p class="err">Please contact support to request a new onboarding link.</p>`);
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

    // --- OTP send/verify (demo) ---
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

    // --- Save progress ---
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
