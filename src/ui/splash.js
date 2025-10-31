// Splash with logo zoom + progress + Turnstile (graceful failure)
export function renderSplashHTML({ failed = false, siteKey = "" } = {}) {
  const msg = failed ? "Could not secure connection. You can continue." : "Just a sec…";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Just a sec…</title>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;min-height:100vh;display:grid;place-items:center}
  .card{width:min(92vw,760px);background:var(--card);border-radius:20px;box-shadow:0 10px 36px #0002;padding:24px}
  .hero{display:flex;flex-direction:column;align-items:center;gap:.75rem}
  .logo{width:86px;height:86px;border-radius:14px;object-fit:cover;transform:scale(.9);opacity:.9;animation:pop .6s ease forwards}
  @keyframes pop{to{transform:scale(1);opacity:1}}
  h1{margin:.25rem 0 0;font-size:2.2rem}
  .bar{height:6px;background:#eef2f7;border-radius:999px;overflow:hidden;margin:.5rem 0 1rem;width:100%}
  .bar>i{display:block;height:100%;width:0;background:var(--red);border-radius:999px;transition:width .8s ease}
  .muted{color:var(--muted);text-align:center}
  .row{display:flex;gap:.75rem;justify-content:center;margin-top:1rem}
  button{padding:.75rem 1.1rem;border-radius:999px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer}
  button.alt{background:var(--red)}
</style>
</head><body>
  <main class="card">
    <div class="hero">
      <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
      <div class="bar"><i id="bar"></i></div>
      <h1>Just a sec…</h1>
      <div class="muted" id="m">${msg}</div>
    </div>
    <div id="cf" style="margin-top:12px"></div>
    <div class="row">
      <button id="retry">Retry</button>
      <button class="alt" id="skip">Skip</button>
    </div>
  </main>
<script>
(() => {
  const siteKey = ${JSON.stringify(siteKey)};
  const mount   = document.getElementById('cf');
  const msg     = document.getElementById('m');
  const bar     = document.getElementById('bar');
  requestAnimationFrame(()=>{ bar.style.width='85%'; setTimeout(()=>bar.style.width='100%', 600); });

  async function verify(payload){
    const r = await fetch("/ts-verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const j = await r.json().catch(()=>({}));
    if (j && j.ok) location.href = "/landing";
  }

  async function runTurnstile(){
    try{
      if(!siteKey){
        msg.textContent = "Could not secure connection. You can continue.";
        return;
      }
      await new Promise((res,rej)=>{
        const s=document.createElement("script");
        s.src="https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async=true;s.onload=res;s.onerror=rej;document.head.appendChild(s);
      });
      const w = document.createElement("div");
      mount.appendChild(w);
      // @ts-ignore
      turnstile.render(w,{
        sitekey: siteKey,
        size: "invisible",
        callback: (t)=>verify({token:t}),
        "error-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; },
        "timeout-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; }
      });
      // @ts-ignore
      turnstile.execute(w);
    }catch(e){
      msg.textContent = "Could not secure connection. You can continue.";
    }
  }

  document.getElementById('retry').onclick = ()=>runTurnstile();
  document.getElementById('skip').onclick  = ()=>verify({skip:true});
  runTurnstile();
})();
</script>
</body></html>`;
}
