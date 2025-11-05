// /src/ui/splash.js
// Renders a simple Turnstile splash with logo + "Loading...".
// Expects: renderSplashHTML({ siteKey: string })
export function renderSplashHTML({ siteKey = "" } = {}) {
  const hasTurnstile = Boolean(siteKey);
  return /*html*/ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Vinet · Checking...</title>
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--bg:#f7f7f8}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);font-family:system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell}
    .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}
    .card{width:min(960px,100%);background:#fff;border-radius:18px;box-shadow:0 12px 40px #0002;padding:24px}
    .logo{height:52px;border-radius:10px}
    h1{margin:16px 0 8px}
    p.muted{color:#6b7280;margin:0 0 18px}
    .bar{height:8px;border-radius:999px;background:linear-gradient(90deg,var(--red),#ff7b7b,var(--red));animation:move 1.2s linear infinite;background-size:200% 100%}
    @keyframes move{0%{background-position:0 0}100%{background-position:200% 0}}
    .center{display:grid;place-items:center;gap:10px}
    .turnstile{margin-top:12px}
    .hide{display:none}
    .ok{color:#136c2e;font-weight:600}
    .err{color:#b91c1c;font-weight:600}
    button{appearance:none;border:0;background:var(--red);color:#fff;border-radius:10px;padding:12px 16px;font-weight:600;cursor:pointer}
    a{color:var(--red)}
  </style>
  ${hasTurnstile ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
</head>
<body>
  <main class="wrap">
    <section class="card">
      <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
      <h1>Loading…</h1>
      <p class="muted">We’re just making sure you’re human.</p>

      <div class="bar" aria-hidden="true"></div>

      <div class="center">
        ${
          hasTurnstile
            ? `<div class="turnstile" data-sitekey="${siteKey}" data-callback="vinetTsCb"></div>`
            : `<div class="err">Turnstile is not configured. Continuing…</div>`
        }
        <div id="status" class="muted">Please wait…</div>
        <noscript>
          <p class="err">JavaScript is required. Please enable it to continue.</p>
        </noscript>
      </div>
    </section>
  </main>

  <script>
    async function verify(token, skip) {
      try {
        const res = await fetch("/splash/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, skip })
        });
        const data = await res.json().catch(()=>({}));
        const status = document.getElementById("status");
        if(data.ok){
          status.textContent = "OK — taking you in…";
          status.className = "ok";
          location.replace("/");
        }else{
          status.textContent = "Could not verify. Please refresh.";
          status.className = "err";
        }
      } catch (e) {
        const status = document.getElementById("status");
        status.textContent = "Network error. Please refresh.";
        status.className = "err";
      }
    }

    // Called by Turnstile upon success
    window.vinetTsCb = function(token){
      verify(token, false);
    };

    // If no Turnstile on page (not configured), auto-continue
    ${hasTurnstile ? "" : "verify('', true);"}

  </script>
</body>
</html>`;
}
