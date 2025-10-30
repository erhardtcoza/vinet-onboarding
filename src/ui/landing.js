import { LOGO_URL } from "../constants.js";

export function renderLandingHTML({ secured = false, seen = false } = {}) {
  const warn = seen && !secured
    ? `<div style="margin:12px 0;padding:12px;border:2px solid #f5b5b5;color:#7a2a2a;border-radius:12px">
         Could not secure connection (Turnstile failed). You can continue.
       </div>` : "";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet · Get Connected</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ED1C24"/>
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f5f6f8;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:780px;margin:2.2rem auto;padding:0 1rem}
  .card{background:var(--card);border-radius:22px;box-shadow:0 12px 36px #0002;padding:1.5rem}
  .logo{display:flex;align-items:center;justify-content:center;margin-top:.25rem}
  .logo img{width:120px;height:auto}
  h1{font-size:2.2rem;text-align:center;margin:1rem 0 .35rem;letter-spacing:.2px}
  p.sub{color:var(--muted);text-align:center;margin:.25rem 0 1.25rem}
  .actions{display:flex;flex-direction:column;gap:.75rem;margin-top:1.25rem}
  a.btn{display:block;text-align:center;text-decoration:none;font-weight:900;font-size:1.05rem;padding:1rem 1.2rem;border-radius:14px}
  a.primary{background:var(--red);color:#fff}
  a.secondary{background:#111;color:#fff}
  small{display:block;text-align:center;color:var(--muted);margin-top:12px}
</style></head><body>
  <main class="wrap">
    <section class="card">
      <div class="logo"><img src="${LOGO_URL}" alt="Vinet"/></div>
      <h1>Get Connected</h1>
      <p class="sub">Fast, reliable internet across the Boland & Overberg.</p>
      ${warn}
      <div class="actions">
        <a class="btn primary" href="/lead">I want to know more / Sign up</a>
        <a class="btn secondary" href="https://splynx.vinet.co.za" rel="noopener">I am already connected (Login)</a>
      </div>
      <small>Support: 021&nbsp;007&nbsp;0200</small>
    </section>
  </main>
</body></html>`;
}
