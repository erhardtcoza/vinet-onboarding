// /src/ui/landing.js
// Minimal landing with 2 clear actions.
// "I am Interested" -> /lead
// "Already connected" -> Splynx
export function renderLandingHTML() {
  return /*html*/ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Vinet · Welcome</title>
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--bg:#f7f7f8}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);font-family:system-ui, -apple-system, Segoe UI, Roboto}
    .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}
    .card{width:min(960px,100%);background:#fff;border-radius:18px;box-shadow:0 12px 40px #0002;padding:24px}
    .logo{height:52px;border-radius:10px}
    h1{margin:16px 0 8px}
    p{margin:0 0 18px}
    .row{display:flex;gap:12px;flex-wrap:wrap}
    a.btn{display:inline-block;padding:14px 18px;border-radius:12px;text-decoration:none;font-weight:700}
    a.red{background:var(--red);color:#fff}
    a.ghost{border:2px solid #0003;color:var(--ink)}
    .muted{color:#6b7280}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
      <h1>Fast, Reliable Internet</h1>
      <p class="muted">Welcome to Vinet Internet Solutions. How can we help?</p>
      <div class="row">
        <a class="btn red" href="/lead">I am Interested</a>
        <a class="btn ghost" href="https://splynx.vinet.co.za" target="_blank" rel="noopener">Already connected</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}
