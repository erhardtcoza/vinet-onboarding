// src/ui/admin.js

/**
 * Server-side HTML renderer used by /api/admin/list
 * sections: { [sectionName]: Array<Session> }
 * Each session card renders Approve/Reject buttons wired to:
 *  - POST /api/admin/approve/:id
 *  - POST /api/admin/reject/:id
 */
export function renderAdminReviewHTML(sections) {
  const html = [];

  html.push(`
    <style>
      .adm-sec-title{margin:18px 0 10px;font-weight:800;color:#333}
      .adm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
      .adm-card{background:#fff;border:1px solid #e7e7e7;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
      .adm-h{margin:0 0 6px;color:#b30000;font-weight:800}
      .adm-meta{font-size:13px;line-height:1.35;color:#344}
      .adm-actions{margin-top:10px}
      .adm-btn{padding:7px 12px;border:0;border-radius:7px;color:#fff;cursor:pointer}
      .adm-approve{background:#2e7d32}
      .adm-reject{background:#c62828;margin-left:6px}
      .adm-view{background:#0069c0;margin-left:6px}
      .adm-splynx{color:#0a662e;font-weight:700;margin:6px 0 0}
      .adm-empty{font-style:italic;color:#666}
    </style>
  `);

  for (const [section, sessions] of Object.entries(sections)) {
    const pretty =
      section === "inprogress" ? "In Progress" :
      section === "pending" ? "Pending Review" :
      section === "approved" ? "Approved" : section;

    html.push(`<h2 class="adm-sec-title">${escapeHtml(pretty)}</h2>`);

    if (!sessions || sessions.length === 0) {
      html.push(`<p class="adm-empty">No sessions in ${escapeHtml(pretty)}.</p>`);
      continue;
    }

    html.push(`<div class="adm-grid">`);
    for (const s of sessions) {
      const id = s.id ?? "";
      const name = s.full_name || s.name || "Unnamed";
      const splynxId = s.splynx_id || "";
      const email = s.email || "—";
      const phone = s.phone || "—";
      const address = [s.address, s.city, s.zip].filter(Boolean).join(", ") || "—";
      const passport = s.passport || s.id_number || "—";

      html.push(`
        <div class="adm-card">
          <div class="adm-h">${escapeHtml(name)}</div>
          <div class="adm-meta">
            <div><b>ID:</b> ${escapeHtml(String(id))}</div>
            <div><b>Email:</b> ${escapeHtml(email)}</div>
            <div><b>Phone:</b> ${escapeHtml(phone)}</div>
            <div><b>Passport/ID:</b> ${escapeHtml(passport)}</div>
            <div><b>Address:</b> ${escapeHtml(address)}</div>
            ${splynxId ? `<div class="adm-splynx">Splynx ID: ${escapeHtml(String(splynxId))}</div>` : ""}
          </div>
          <div class="adm-actions">
            ${section !== "approved"
              ? `<button class="adm-btn adm-approve" data-act="approve" data-id="${escapeAttr(id)}">Approve</button>`
              : ""}
            ${section !== "approved"
              ? `<button class="adm-btn adm-reject" data-act="reject" data-id="${escapeAttr(id)}">Reject</button>`
              : ""}
            <button class="adm-btn adm-view" data-act="edit" data-id="${escapeAttr(id)}">Edit</button>
          </div>
        </div>
      `);
    }
    html.push(`</div>`);
  }

  // These handlers are added client-side by renderAdminPage(); here we only render markup.
  return html.join("\n");
}

/**
 * Full Admin page shell used by routes/public.js -> renderAdminPage()
 * Loads a section via /api/admin/list?section=... and injects the HTML,
 * then wires Approve/Reject/Edit buttons with robust error handling.
 */
export function renderAdminPage() {
  return /*html*/`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Onboarding Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#f6f7fb;color:#222}
  .wrap{max-width:1100px;margin:28px auto;padding:0 18px}
  h1{margin:0 0 12px;color:#b30000}
  .tabs{display:flex;gap:10px;margin:8px 0 16px;flex-wrap:wrap}
  .tab{padding:8px 14px;border-radius:999px;border:2px solid #b30000;color:#b30000;background:#fff;cursor:pointer;font-weight:700}
  .tab.active{background:#b30000;color:#fff}
  #content{min-height:200px}
  .toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#222;color:#fff;border-radius:8px;padding:9px 12px;font-size:13px;display:none;z-index:5}
  .err{color:#b00020;margin:8px 0}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Onboarding Admin Dashboard</h1>

    <div class="tabs">
      <button class="tab active" data-sec="inprogress">In Progress</button>
      <button class="tab" data-sec="pending">Pending Review</button>
      <button class="tab" data-sec="approved">Approved</button>
    </div>

    <div id="content">Loading…</div>
  </div>

  <div id="toast" class="toast"></div>

<script>
(function(){
  const content = document.getElementById('content');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  let current = 'inprogress';

  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(()=>{ t.style.display='none'; }, 1600);
  }

  async function loadSection(sec){
    current = sec;
    content.innerHTML = 'Loading…';
    try{
      const r = await fetch('/api/admin/list?section=' + encodeURIComponent(sec), { method:'GET' });
      if (!r.ok) {
        const tx = await r.text().catch(()=> '');
        throw new Error('Failed to load list (' + r.status + '): ' + tx);
      }
      const html = await r.text();
      content.innerHTML = html;
      wireButtons();
    }catch(e){
      content.innerHTML = '<div class="err">Error: ' + (e.message || e) + '</div>';
    }
  }

  function wireButtons(){
    content.querySelectorAll('[data-act]').forEach(btn=>{
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      if (!act || !id) return;
      if (act === 'approve') {
        btn.onclick = ()=> doStatus('/api/admin/approve/' + encodeURIComponent(id), 'approved');
      } else if (act === 'reject') {
        btn.onclick = ()=> doStatus('/api/admin/reject/' + encodeURIComponent(id), 'rejected');
      } else if (act === 'edit') {
        btn.onclick = ()=> { location.href = '/admin/edit?id=' + encodeURIComponent(id); };
      }
    });
  }

  async function doStatus(url, label){
    try{
      const r = await fetch(url, { method:'POST' });
      if (!r.ok) {
        const tx = await r.text().catch(()=> '');
        throw new Error('Request failed (' + r.status + '): ' + tx);
      }
      const d = await r.json().catch(()=> ({}));
      toast('Marked ' + (d.id || '') + ' as ' + label);
      await loadSection(current);
    }catch(e){
      toast('Error: ' + (e.message || e));
    }
  }

  tabs.forEach(b=>{
    b.onclick = ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      loadSection(b.dataset.sec);
    };
  });

  loadSection('inprogress');
})();
</script>
</body>
</html>
  `;
}

/* ---------- small escape helpers for SSR ---------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, m => m === "&" ? "&amp;" : m === "<" ? "&lt;" : m === ">" ? "&gt;" : "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}