// src/ui/splash.js
export function splashHTML(siteKey) {
  return `<!doctype html>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet · Get Connected</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{--brand:#e2001a;--ink:#0b1320;--muted:#6b7280}
*{box-sizing:border-box} html,body{height:100%}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#fff;color:var(--ink);display:grid;place-items:center}
.wrap{width:100%;max-width:720px;padding:24px}
.card{border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 28px rgba(0,0,0,.08);overflow:hidden}
.header{padding:20px 20px 0}
.logo{width:160px;display:block;margin:0 auto}
.loading{display:flex;align-items:center;gap:12px;justify-content:center;padding:24px 20px 28px}
.bar{width:160px;height:6px;background:#f3f4f6;border-radius:999px;overflow:hidden}
.bar::after{content:"";display:block;height:100%;width:0%;background:var(--brand);animation:fill 1.2s ease-in-out infinite}
@keyframes fill{0%{width:0%}50%{width:60%}100%{width:100%}}
.h1{font-size:28px;font-weight:800;text-align:center;color:var(--brand);margin:10px 0 20px}
.muted{color:var(--muted);text-align:center;margin:0 0 16px}
.cta{display:none;opacity:0;transition:opacity .5s ease}
.btn{display:block;width:100%;padding:14px 16px;border-radius:12px;border:0;cursor:pointer;font-weight:800}
.btn-primary{background:var(--brand);color:#fff}
.btn-ghost{background:#0b1320;color:#fff}
.stack{display:grid;gap:12px;padding:20px}
.faded{opacity:.25}
</style>

<div class="wrap">
  <div class="card">
    <div class="header">
      <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
      <div class="h1">Get Connected</div>
    </div>
    <div id="loader" class="loading">
      <div class="bar"></div><div class="muted">Securing session…</div>
    </div>

    <div id="cta" class="cta">
      <p class="muted">Choose an option:</p>
      <div class="stack">
        <button id="btnNew" class="btn btn-primary">I want to know more (or sign-up)</button>
        <button id="btnLogin" class="btn btn-ghost">I am already connected (log in)</button>
      </div>
    </div>
  </div>
</div>

<!-- Turnstile (invisible) -->
<div id="ts" class="cf-turnstile"
     data-sitekey="${siteKey}"
     data-size="invisible"
     data-callback="onTsOk"
     data-action="splash"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<script>
const loader = document.getElementById('loader');
const cta = document.getElementById('cta');

function showCTA(){
  loader.classList.add('faded');
  setTimeout(()=>{
    loader.style.display='none';
    cta.style.display='block';
    requestAnimationFrame(()=>{ cta.style.opacity = 1; });
  }, 200);
}

async function verifyToken(token){
  try{
    const r = await fetch('/ts-verify', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ token })
    });
    if(!r.ok){ throw new Error('verify failed '+r.status); }
    const d = await r.json();
    if(d && d.ok){ showCTA(); } else { location.reload(); }
  }catch(e){ location.reload(); }
}

// Called by Turnstile after invisible challenge
window.onTsOk = function(token){ verifyToken(token); };

// Execute once API is ready
function whenTSReady(cb){
  if(window.turnstile && typeof turnstile.execute==='function') return cb();
  setTimeout(()=>whenTSReady(cb), 30);
}
whenTSReady(()=> turnstile.execute('#ts') );

// Wire CTAs
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id === 'btnNew'){ location.href = '/form'; }
  else if(e.target && e.target.id === 'btnLogin'){ location.href = 'https://splynx.vinet.co.za'; }
});
</script>`;
}
