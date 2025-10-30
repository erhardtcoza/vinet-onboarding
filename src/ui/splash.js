// src/ui/splash.js
export function splashHTML(siteKey) {
  // Invisible Turnstile preclear; on success it posts the token to /ts-verify,
  // then redirects to /home (landing).
  const KEY = siteKey || "0x4AAAAAABxWz1R1NnIj1POM";
  return /*html*/ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Checking…</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f5f6f8;--card:#fff}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{max-width:760px;margin:18vh auto 0;padding:0 1rem}
    .card{background:var(--card);border-radius:22px;box-shadow:0 12px 36px #0002;padding:2rem;text-align:center}
    h1{margin:0 0 .25rem}
    p{color:var(--muted);margin:.25rem 0 1rem}
    .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden}
    .bar>i{display:block;height:100%;width:0;background:var(--red);border-radius:999px;animation:p 1.6s ease forwards}
    @keyframes p{to{width:100%}}
    .hint{margin-top:.75rem;color:var(--muted);font-size:.9rem}
    .hide{display:none}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>Securing your session…</h1>
      <p>We’re doing a quick check to keep things safe.</p>
      <div class="bar"><i></i></div>

      <!-- Turnstile (invisible) -->
      <div id="cf-turnstile"
        class="cf-turnstile"
        data-sitekey="${KEY}"
        data-callback="onTurnstileOk"
        data-execution="execute">
      </div>

      <div class="hint" id="msg">This will only take a moment.</div>
    </section>
  </main>

  <script>
    async function verify(token){
      try{
        const r = await fetch("/ts-verify",{
          method:"POST",
          headers:{"content-type":"application/json"},
          body: JSON.stringify({ token })
        });
        const j = await r.json().catch(()=>({}));
        if(j && j.ok){
          location.replace("/home"); // go to landing
        }else{
          document.getElementById('msg').textContent = "Please refresh to try again.";
        }
      }catch{
        document.getElementById('msg').textContent = "Network error. Please refresh and try again.";
      }
    }
    window.onTurnstileOk = (t)=>verify(t);
    // If auto-execution doesn’t run for some reason, attempt after load:
    window.addEventListener("load", ()=>{
      if (window.turnstile && window.turnstile.execute) {
        try { window.turnstile.execute(); } catch {}
      }
    });
  </script>
</body>
</html>`;
}
