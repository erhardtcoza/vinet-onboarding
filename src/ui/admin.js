// /src/ui/admin.js
import { LOGO_URL } from "../constants.js";

export function renderAdminHTML() {
  return /*html*/ `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Vinet Admin</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#ED1C24"/>
  <script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
    body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    header{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0}
    header img{width:34px;height:34px;border-radius:8px}
    header nav{margin-left:auto;display:flex;gap:.75rem}
    header a{color:var(--ink);text-decoration:none;padding:.5rem .75rem;border-radius:10px}
    header a:hover{background:#f3f4f6}
    .chip{background:var(--red);color:#fff;border-radius:999px;padding:.25rem .6rem;font-size:.75rem}
    main{max-width:1100px;margin:1rem auto;padding:0 1rem}
    .card{background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1rem}
  </style>
</head>
<body>
  <header>
    <img src="${LOGO_URL}" alt="Vinet"/>
    <strong>Vinet Admin</strong>
    <nav>
      <a href="/"><span>Onboarding</span></a>
      <a href="/crm"><span>Leads CRM</span></a>
      <a href="/agreements"><span>Agreements</span></a>
    </nav>
  </header>
  <main>
    <div class="card">
      <!-- Your existing admin dashboard content is rendered by routes/admin.js -->
      <div id="app-root"></div>
    </div>
  </main>
</body>
</html>`;
}
