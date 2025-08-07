export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const BUILD = "vinet-onboarding 2025-08-07 21:40 SAST";

    // Utils
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";

    async function parseBody(req) {
      try { return await req.json(); } catch { return {}; }
    }

    function noCacheHtml(body, title = "Vinet Onboarding") {
      return new Response(
        `<!DOCTYPE html><html lang="en"><head>
          <meta charset="UTF-8" />
          <title>${title}</title>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <style>
            body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
            .card{background:#fff;max-width:520px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
            .logo{display:block;margin:0 auto 1em;max-width:90px}
            h1,h2{color:#e2001a}
            .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
            .field{margin:1em 0}
            input,select{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
            .err{color:#c00}
            .success{color:#090}
            .build{font-size:12px;color:#666;margin-top:10px}
          </style>
        </head><body>
          <div class="card">
            <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
            ${body}
            <div class="build">${BUILD}</div>
          </div>
        </body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
            pragma: "no-cache",
            expires: "0",
            // allow inline script while we iterate
            "content-security-policy":
              "default-src 'self'; img-src 'self' https://static.vinet.co.za data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self';",
          },
        }
      );
    }

    // Redirect /admin -> /admin2 (kill any stale cache)
    if (path === "/admin" && method === "GET") {
      return new Response(null, { status: 302, headers: { Location: "/admin2", "cache-control": "no-store" } });
    }

    // Admin UI (no form, Enter mapped, with alerts)
    if (path === "/admin2" && method === "GET") {
      const body = `
        <h1>Generate Onboarding Link</h1>

        <div id="adminBox">
          <div class="field">
            <label>Splynx Lead/Customer ID</label>
            <input id="splynx_id" autocomplete="off" />
          </div>
          <button class="btn" id="genLinkBtn" type="button">Generate Link</button>
        </div>

        <div id="link"></div>

        <p style="margin-top:14px">
          Fallback (no JS): <br/>
          <code>/admin2/gen?id=&lt;YOUR_ID&gt;</code>
        </p>

        <script>
          alert("[admin2] page loaded: ${BUILD}");
          const input = document.getElementById("splynx_id");
          const btn   = document.getElementById("genLinkBtn");
          const out   = document.getElementById("link");

          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); btn.click(); }
          });

          btn.addEventListener("click", async () => {
            alert("[admin2] click");
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
              out.innerHTML = '<div class="err">Fetch failed.</div>';
            }
          });
        <\\/script>
      `;
      return noCacheHtml(body, "Admin - Generate Link (v2)");
    }

    // GET fallback to generate link without JS: /admin2/gen?id=123
    if (path === "/admin2/gen" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        return noCacheHtml(`<h2 class="err">Missing ?id</h2><p>Usage: /admin2/gen?id=319</p>`, "Admin - Fallback");
      }
      // generate like POST /admin
      const rand = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${rand}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id, started: false, created: Date.now(), progress: 0
      }), { expirationTtl: 86400 });
      const link = `/onboard/${linkid}`;
      return noCacheHtml(`<p class="success">Onboarding link:</p><p><a href="${link}" target="_blank">${link}</a></p>`, "Admin - Link Ready");
    }

    // POST /admin - create link (used by button)
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

    // Onboarding UI (kept as-is)
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session)
        return noCacheHtml(`<h2>Invalid or expired link</h2><p class="err">Please contact support to request a new onboarding link.</p>`, "Onboarding");
      const body = `
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
      `;
      return noCacheHtml(body, "Onboarding");
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
