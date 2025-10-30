// Splash card with Turnstile + graceful failure
export function renderSplashHTML({ failed = false, siteKey = "" } = {}) {
  const msg = failed
    ? "Could not secure connection. You can continue."
    : "Just a sec…";
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Just a sec…</title>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
    display:grid;place-items:center;min-height:100vh}
  .card{background:var(--card);width:min(92vw,720px);border-radius:20px;box-shadow:0 6px 28px #0002;padding:28px}
  h1{margin:.2rem 0 1rem;font-size:2.2rem}
  .bar{height:6px;background:#eee;border-radius:999px;overflow:hidden;margin:-.3rem 0 1rem}
  .bar>i{display:block;height:100%;width:100%;background:var(--red)}
  .muted{color:#6b7280}
  .row{display:flex;gap:.75rem;margin-top:1rem}
  button{padding:.7rem 1.1rem;border-radius:999px;border:0;background:#111;color:#fff;font-weight:700;cursor:pointer}
  button.alt{background:#ED1C24}
</style>
</head><body>
  <main class="card">
    <div class="bar"><i></i></div>
    <h1>Just a sec…</h1>
    <div class="muted" id="m">${msg}</div>
    <div id="cf" style="margin-top:12px"></div>
    <div class="row">
      <button id="retry">Retry</button>
      <button class="alt" id="skip">Skip</button>
    </div>
  </main>
<script>
(async () => {
  const siteKey = ${JSON.stringify(siteKey)};
  const mount = document.getElementById('cf');
  const msg   = document.getElementById('m');

  async function verify(token){
    const r = await fetch("/ts-verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});
    const j = await r.json().catch(()=>({ok:false}));
    if (j.proceed) location.href = "/landing";
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
      // invisible widget
      const w = document.createElement("div");
      mount.appendChild(w);
      // @ts-ignore
      turnstile.render(w,{
        sitekey: siteKey,
        callback: (t)=>verify(t),
        "error-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; },
        "timeout-callback": ()=>{ msg.textContent="Could not secure connection. You can continue."; },
        size: "invisible"
      });
      // @ts-ignore
      turnstile.execute(w);
    }catch(e){
      msg.textContent = "Could not secure connection. You can continue.";
    }
  }

  document.getElementById('retry').onclick = ()=>runTurnstile();
  document.getElementById('skip').onclick  = ()=>verify("skip");

  runTurnstile();
})();
</script>
</body></html>`;
}
