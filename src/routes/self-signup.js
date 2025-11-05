// src/routes/self-signup.js
export function mount(router) {
  // Root shows the self-sign form
  router.add("GET", "/", async (_req) => {
    const html = `<!doctype html><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Vinet · Self Sign Up</title>
<link rel="icon" href="/favicon.ico"/>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f7f7f8;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .card{background:#fff;max-width:760px;padding:24px 28px;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.06)}
  label{display:block;margin:10px 0 4px;color:#374151}
  input,select{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px}
  button{margin-top:16px;border:0;border-radius:12px;padding:12px 16px;cursor:pointer}
  .primary{background:#e10600;color:#fff}
</style>
<div class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" height="38"/>
  <h2>Self Sign Up</h2>
  <form id="f">
    <label>Full name</label><input name="name" required/>
    <label>Email</label><input name="email" type="email" required/>
    <label>Phone</label><input name="phone" required/>
    <label>City</label><input name="city"/>
    <label>Street</label><input name="street"/>
    <label>ZIP</label><input name="zip"/>
    <div class="cf-turnstile" data-sitekey="YOUR_TURNSTILE_SITEKEY"></div>
    <button class="primary" type="submit">Continue</button>
  </form>
  <p id="msg"></p>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
<script>
  const f=document.getElementById('f'), msg=document.getElementById('msg');
  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    msg.textContent='Submitting...';
    const body = Object.fromEntries(new FormData(f).entries());
    const r = await fetch('/api/self-sign/submit', {
      method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)
    });
    const j = await r.json().catch(()=>({ok:false}));
    msg.textContent = j.ok ? 'Thanks! We have your details.' : ('Failed: '+(j.error||'unknown'));
  });
</script>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  });

  // API to accept self sign (store or hand off to existing flow)
  router.add("POST", "/api/self-sign/submit", async (req, env) => {
    const body = await req.json().catch(()=> ({}));
    // TODO: call your existing create-lead / reuse logic here
    // For now just ack so the page works
    return Response.json({ ok: true, received: body });
  });
}
