// /src/ui/splash.js
export function splashHTML(siteKey) {
  const useTs = !!siteKey && siteKey !== "dummy";
  return /*html*/`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Just a sec…</title>
  ${useTs ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{min-height:100vh;display:grid;place-items:center}
    .card{background:var(--card);width:min(520px,92vw);padding:24px;border-radius:20px;box-shadow:0 12px 36px #0002;text-align:center}
    h1{margin:6px 0 10px;font-size:2rem;font-weight:900}
    .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin:8px 0 10px}
    .bar>i{display:block;height:100%;width:0;background:var(--red);transition:width .6s ease}
    p{color:var(--muted);margin:8px 0 16px}
    .cta{display:flex;gap:10px;justify-content:center}
    button{border:0;background:#111;color:#fff;padding:.8rem 1.2rem;border-radius:999px;font-weight:700;cursor:pointer}
    a.btn{display:inline-block;text-decoration:none;background:#111;color:#fff;padding:.8rem 1.2rem;border-radius:999px;font-weight:700}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>Just a sec…</h1>
      <div class="bar"><i id="prog"></i></div>
      <p id="msg">Checking you’re human.</p>

      <div ${useTs ? "" : 'style="display:none"'}
           class="cf-turnstile"
           data-sitekey="${useTs ? siteKey : ''}"
           data-callback="onTs"
           data-size="invisible"></div>

      <div class="cta">
        <button id="retry">Retry</button>
        <a class="btn" href="/landing">Skip</a>
      </div>
    </section>
  </main>

  <script>
    requestAnimationFrame(()=>{const p=document.getElementById('prog'); if(p) p.style.width='100%';});
    const msg=document.getElementById('msg');
    const retry=document.getElementById('retry');

    async function post(path, data){
      const r = await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
      return { ok:r.ok, json: await r.json().catch(()=>({})) };
    }

    async function verify(token){
      try{
        const {ok,json} = await post('/ts-verify',{token});
        if(!ok || !json.ok){ msg.textContent='Could not secure connection. You can continue.'; return; }
        location.replace('/landing');
      }catch{ msg.textContent='Could not secure connection. You can continue.'; }
    }

    window.onTs = (tok)=> verify(tok);

    async function run(){
      ${useTs ? "if(window.turnstile){ try{ window.turnstile.execute(); return; }catch(e){} }" : ""}
      // No Turnstile available → mark as fail (no ts_ok cookie) and let user continue
      await verify('TURNSTILE-NOT-AVAILABLE');
    }

    retry.addEventListener('click', run);
    run();
  </script>
</body>
</html>`;
}
