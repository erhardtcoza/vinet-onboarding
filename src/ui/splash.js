// src/ui/splash.js
// Minimal splash that runs invisible Turnstile, sets cookie via /ts-verify,
// then redirects to /home (landing with buttons)

export function splashHTML(siteKey) {
  const key = siteKey || "0x4AAAAAABxWz1R1NnIj1POM"; // fallback test key
  return /*html*/`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Loading…</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    :root{--red:#ED1C24}
    body{margin:0;display:grid;place-items:center;height:100svh;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#fff}
    .card{max-width:480px;padding:28px;border-radius:18px;box-shadow:0 10px 30px #0002;text-align:center}
    .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin:10px 0 6px}
    .bar>i{display:block;height:100%;width:0;background:var(--red);animation:load 1.6s ease forwards}
    @keyframes load{to{width:100%}}
    button{display:inline-block;margin-top:12px;padding:.6rem 1rem;border:0;border-radius:999px;background:#111;color:#fff;font-weight:700;cursor:pointer}
    .hint{color:#6b7280;font-size:.9rem;margin-top:6px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Just a sec…</h1>
    <div class="bar"><i></i></div>
    <div id="status" class="hint">Securing your session</div>
    <div id="ts" style="margin-top:10px"></div>
    <button id="continue" style="display:none">Continue</button>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('continue');

    async function verify(token){
      try{
        const r = await fetch('/ts-verify', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({ token })
        });
        const j = await r.json();
        if(r.ok && j && j.ok){
          location.href = '/home';
          return;
        }
        statusEl.textContent = 'Verification failed. Tap Continue to try again.';
        btn.style.display = 'inline-block';
      }catch(e){
        statusEl.textContent = 'Network issue. Tap Continue to retry.';
        btn.style.display = 'inline-block';
      }
    }

    btn.addEventListener('click', ()=>{
      statusEl.textContent = 'Retrying…';
      renderTS();
    });

    function renderTS(){
      try{
        turnstile.render('#ts', {
          sitekey: '${key}',
          callback: verify,
          'error-callback': () => { statusEl.textContent='Error. Tap Continue to retry.'; btn.style.display='inline-block'; },
          'timeout-callback': () => { statusEl.textContent='Timed out. Tap Continue to retry.'; btn.style.display='inline-block'; },
          theme: 'light',
          size: 'invisible',
          action: 'preclear'
        });
      }catch(e){
        statusEl.textContent = 'Init error. Tap Continue to retry.';
        btn.style.display = 'inline-block';
      }
    }

    // Boot
    document.addEventListener('DOMContentLoaded', renderTS);
  </script>
</body>
</html>`;
}
