// /src/ui/splash.js
export function renderSplashHTML({ failed = false, siteKey = "" } = {}) {
  const msg = failed ? "Security check unavailable right now — you can continue." : "Just a sec…";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Just a sec…</title>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;min-height:100vh;display:grid;place-items:center}
  .card{width:min(92vw,760px);background:var(--card);border-radius:20px;box-shadow:0 10px 36px #0002;padding:24px}
  .hero{display:flex;flex-direction:column;align-items:center;gap:.75rem}
  .logo{width:min(180px,42vw);aspect-ratio:16/6;object-fit:contain;animation:breath 1.8s ease-in-out infinite}
  @keyframes breath{0%,100%{transform:scale(.98)}50%{transform:scale(1)}}
  h1{margin:.25rem 0 0;font-size:2.0rem}
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
      <img class="logo" src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
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
    try{
      const r = await fetch("/ts-verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      await r.json().catch(()=>({}));
    }catch{}
    location.href = "/landing";
  }

  async function runTurnstile(){
    try{
      if(!siteKey){
        msg.textContent = "Security check unavailable right now — you can continue.";
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
        sitekey: siteKey, size: "invisible",
        callback: (t)=>verify({token:t}),
        "error-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; verify({skip:true}); },
        "timeout-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; verify({skip:true}); }
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
