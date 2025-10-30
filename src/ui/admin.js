// /src/ui/admin.js
import { LOGO_URL } from "../constants.js";

/* ------------------------------------------------------------------ *
 * Main Admin shell (used by routes.js -> renderAdminPage())
 * ------------------------------------------------------------------ */
export function renderAdminPage() {
  return /*html*/ `<!doctype html>
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
    header{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}
    header img{width:34px;height:34px;border-radius:8px}
    header nav{margin-left:auto;display:flex;gap:.75rem}
    header a{color:var(--ink);text-decoration:none;padding:.5rem .75rem;border-radius:10px}
    header a:hover{background:#f3f4f6}
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
      <!-- routes/admin.js renders content via API + front-end -->
      <div id="app-root"></div>
    </div>
  </main>
</body>
</html>`;
}

/* ------------------------------------------------------------------ *
 * Keep backward name for any other modules referencing it
 * ------------------------------------------------------------------ */
export const renderAdminHTML = renderAdminPage;

/* ------------------------------------------------------------------ *
 * Admin Review page (used by routes.js & routes/admin.js)
 * props: { linkid, sess, r2PublicBase, original }
 * ------------------------------------------------------------------ */
export function renderAdminReviewHTML(props = {}) {
  const { linkid = "", sess = {}, r2PublicBase = "", original = null } = props;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

  const up = Array.isArray(sess.uploads) ? sess.uploads : [];
  const uploadsHtml = up.length
    ? `<ul>` + up.map(u => `<li><a href="${r2PublicBase}/${esc(u.key)}" target="_blank" rel="noopener">${esc(u.name||u.key)}</a> <small>(${u.size||0} bytes)</small></li>`).join("") + `</ul>`
    : `<em>No uploads</em>`;

  const edits = sess.edits || {};
  const fields = [
    ["Full name","full_name"],
    ["Email","email"],
    ["Phone","phone"],
    ["Street","street"],
    ["City","city"],
    ["ZIP","zip"],
    ["Payment method","pay_method"]
  ];

  const compareRows = fields.map(([label,key])=>{
    const newVal = esc(edits[key] ?? "");
    const oldVal = esc(original && (original[key] ?? original?.[key]) || "");
    return `<tr>
      <td>${esc(label)}</td>
      <td>${oldVal || "<span style='color:#6b7280'>—</span>"}</td>
      <td>${newVal || "<span style='color:#6b7280'>—</span>"}</td>
    </tr>`;
  }).join("");

  return /*html*/ `<!doctype html>
<meta charset="utf-8"/>
<title>Review · ${esc(linkid)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink)}
  header{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0}
  header img{width:34px;height:34px;border-radius:8px}
  header strong{font-weight:800}
  main{max-width:1100px;margin:1rem auto;padding:0 1rem}
  .grid{display:grid;grid-template-columns:1fr;gap:14px}
  .card{background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1rem}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid #eee;padding:.6rem;text-align:left}
  th{background:#fafafa}
  .actions{display:flex;gap:.6rem;flex-wrap:wrap}
  button, a.btn{border:0;border-radius:10px;padding:.7rem 1rem;cursor:pointer;font-weight:700;text-decoration:none;display:inline-block}
  .primary{background:var(--red);color:#fff}
  .grey{background:#111;color:#fff}
  .muted{color:var(--muted)}
</style>
<header>
  <img src="${LOGO_URL}" alt="Vinet"/>
  <strong>Admin Review</strong>
  <div style="margin-left:auto" class="muted">Link: ${esc(linkid)}</div>
</header>

<main>
  <div class="grid">
    <section class="card">
      <h3 style="margin:.25rem 0 1rem">Details</h3>
      <table>
        <thead><tr><th>Field</th><th>Original</th><th>Edited</th></tr></thead>
        <tbody>${compareRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h3 style="margin:.25rem 0 1rem">Uploads</h3>
      ${uploadsHtml}
    </section>

    <section class="card">
      <h3 style="margin:.25rem 0 1rem">Actions</h3>
      <div class="actions">
        <button class="primary" onclick="approve()">Approve & Push to Splynx</button>
        <button class="grey" onclick="reject()">Reject</button>
        <a class="btn grey" href="/pdf/msa/${encodeURIComponent(linkid)}" target="_blank">Open MSA PDF</a>
        <a class="btn grey" href="/pdf/debit/${encodeURIComponent(linkid)}" target="_blank">Open Debit PDF</a>
      </div>
      <p class="muted" style="margin-top:.6rem">Approving will upload edits & documents to the correct Splynx profile.</p>
    </section>
  </div>
</main>

<script>
  async function approve(){
    const r = await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ linkid: ${JSON.stringify(linkid)} })});
    const j = await r.json().catch(()=>({}));
    if(!r.ok || !j.ok){ alert('Approve failed: '+(j.error||r.statusText)); return; }
    alert('Approved & pushed.');
    location.href = '/';
  }
  async function reject(){
    const reason = prompt('Reason for rejection?') || '';
    const r = await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ linkid: ${JSON.stringify(linkid)}, reason })});
    const j = await r.json().catch(()=>({}));
    if(!r.ok || !j.ok){ alert('Reject failed: '+(j.error||r.statusText)); return; }
    alert('Rejected.');
    location.href = '/';
  }
</script>`;
}
