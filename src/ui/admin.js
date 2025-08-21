// src/ui/admin.js
import { LOGO_URL } from "../constants.js";

/* ===========================================================
   SERVER-SIDE LIST RENDERER (used by /api/admin/list)
   =========================================================== */
export function renderAdminReviewHTML(sections) {
  const html = [];

  html.push(`
    <style>
      .adm-sec-title{margin:18px 0 10px;font-weight:800;color:#333}
      .adm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
      .adm-card{background:#fff;border:1px solid #e7e7e7;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
      .adm-h{margin:0 0 6px;color:#b30000;font-weight:800}
      .adm-meta{font-size:13px;line-height:1.35;color:#344}
      .adm-actions{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}
      .adm-btn{padding:7px 12px;border:0;border-radius:7px;color:#fff;cursor:pointer}
      .adm-approve{background:#2e7d32}
      .adm-reject{background:#c62828}
      .adm-view{background:#0069c0}
      .adm-splynx{color:#0a662e;font-weight:700;margin:6px 0 0}
      .adm-links{margin-top:6px;display:flex;flex-wrap:wrap;gap:8px}
      .adm-link{display:inline-block;background:#f5f7ff;border:1px solid #dbe3ff;color:#174ea6;text-decoration:none;border-radius:8px;padding:6px 10px;font-size:12px}
      .adm-empty{font-style:italic;color:#666}
    </style>
  `);

  for (const [section, sessions] of Object.entries(sections)) {
    const pretty =
      section === "inprogress" ? "In Progress" :
      section === "pending" ? "Pending Review" :
      section === "approved" ? "Approved" : section;

    html.push(`<h2 class="adm-sec-title">${esc(pretty)}</h2>`);

    if (!sessions || sessions.length === 0) {
      html.push(`<p class="adm-empty">No sessions in ${esc(pretty)}.</p>`);
      continue;
    }

    html.push(`<div class="adm-grid">`);
    for (const s of sessions) {
      const id = s.id ?? "";
      const name = s.full_name || s.name || "Unnamed";
      const splynxId = s.splynx_id || s.id || ""; // fallback if you store it as id
      const email = s.email || "—";
      const phone = s.phone || "—";
      const address = [s.address, s.city, s.zip].filter(Boolean).join(", ") || "—";
      const passport = s.passport || s.id_number || "—";

      const spC = `https://splynx.vinet.co.za/admin/customers/customer/${encodeURIComponent(splynxId)}`;
      const spL = `https://splynx.vinet.co.za/admin/crm/leads/${encodeURIComponent(splynxId)}`;

      html.push(`
        <div class="adm-card">
          <div class="adm-h">${esc(name)}</div>
          <div class="adm-meta">
            <div><b>ID:</b> ${esc(String(id))}</div>
            <div><b>Email:</b> ${esc(email)}</div>
            <div><b>Phone:</b> ${esc(phone)}</div>
            <div><b>Passport/ID:</b> ${esc(passport)}</div>
            <div><b>Address:</b> ${esc(address)}</div>
            ${splynxId ? `<div class="adm-splynx">Splynx ID: ${esc(String(splynxId))}</div>` : ""}
            ${splynxId ? `
              <div class="adm-links">
                <a class="adm-link" href="${spC}" target="_blank" rel="noopener">Open in Splynx (Customer)</a>
                <a class="adm-link" href="${spL}" target="_blank" rel="noopener">Open in Splynx (Lead)</a>
              </div>` : ""}
          </div>
          <div class="adm-actions">
            ${section !== "approved"
              ? `<button class="adm-btn adm-approve" data-act="approve" data-id="${escAttr(id)}">Approve</button>`
              : ""}
            ${section !== "approved"
              ? `<button class="adm-btn adm-reject" data-act="reject" data-id="${escAttr(id)}">Reject</button>`
              : ""}
            <button class="adm-btn adm-view" data-act="edit" data-id="${escAttr(id)}">Edit</button>
          </div>
        </div>
      `);
    }
    html.push(`</div>`);
  }

  return html.join("\n");
}

/* ===========================================================
   FULL ADMIN PAGE (your original layout + generators on top)
   =========================================================== */
export function renderAdminPage() {
  return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Vinet Onboarding – Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{
    --vinet:#e2001a; --ink:#222; --muted:#666;
    --card:#fff; --bg:#f7f8fb; --radius:14px;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--vinet);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:1100px;margin:30px auto;padding:0 18px}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .brand img{height:60px}
  .brand h1{font-size:32px;color:var(--vinet);margin:0;font-weight:900;line-height:1.1}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:900px){.grid-2{grid-template-columns:1fr}}
  .card{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .h{font-weight:800;color:var(--ink);margin:0 0 10px}
  .sub{font-size:12px;color:var(--muted);margin:6px 0}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .input{width:100%;padding:11px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:700}
  .btn:disabled{opacity:.6;cursor:not-allowed}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet)}
  .pill-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 2px}
  .pill{padding:10px 16px;border-radius:999px;border:2px solid var(--vinet);color:var(--vinet);font-weight:800;background:#fff;cursor:pointer}
  .pill.active{background:var(--vinet);color:#fff}
  .list-col{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .group-title{font-weight:900;margin:0 0 8px}
  .empty{color:var(--muted);font-style:italic}
  /* Modal & toast */
  .modal-back{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center;z-index:20}
  .modal{background:#fff;border-radius:16px;box-shadow:0 10px 40px #0004;max-width:560px;width:min(92vw,560px);padding:16px 16px 14px}
  .modal .title{font-weight:900;color:var(--vinet);margin:0 0 8px}
  .modal .box{border:2px solid var(--vinet);border-radius:12px;padding:10px 12px;background:#fff;margin:6px 0;overflow:auto}
  .modal .row{justify-content:flex-end}
  .toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#222;color:#fff;border-radius:10px;padding:9px 12px;font-size:13px;display:none;z-index:25}
  .err{color:#b00020;margin-top:10px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <img src="${LOGO_URL}" alt="Vinet Logo">
      <h1>Onboarding Admin<br/>Dashboard</h1>
    </div>

    <!-- ======= TOP: GENERATORS (restored) ======= -->
    <div class="grid-2">
      <div class="card">
        <p class="h">Generate Onboard link (Splynx ID)</p>
        <input id="splynxId" class="input" placeholder="e.g. 319" />
        <div style="display:flex;justify-content:center;margin-top:10px">
          <button id="genLink" class="btn">Generate</button>
        </div>
      </div>

      <div class="card">
        <p class="h">Generate Verification code (linkid)</p>
        <input id="linkId" class="input" placeholder="e.g. 319_abcd1234" />
        <div style="display:flex;justify-content:center;margin-top:10px">
          <button id="genStaff" class="btn">Generate</button>
        </div>
        <p class="sub">Creates a one‑time staff code for the given link.</p>
      </div>
    </div>

    <!-- ======= LISTS ======= -->
    <div class="pill-tabs">
      <button data-sec="inprogress" class="pill active">In Progress</button>
      <button data-sec="pending" class="pill">Pending Review</button>
      <button data-sec="approved" class="pill">Approved</button>
    </div>

    <div id="listWrap" class="list-col">
      <p class="group-title" id="groupTitle">In Progress</p>
      <div id="listBody">Loading…</div>
    </div>
  </div>

  <!-- Modal + toast -->
  <div id="modalBack" class="modal-back" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="modal">
      <p id="mTitle" class="title">Onboarding link</p>
      <div id="mBox" class="box"></div>
      <div class="row">
        <button id="mCopy" class="btn">Copy</button>
        <button id="mOk" class="btn btn-ghost">OK</button>
      </div>
      <p class="sub" style="margin:8px 0 0">This window will close automatically.</p>
    </div>
  </div>
  <div id="toast" class="toast">Copied!</div>

<script>
(function(){
  const $ = (s)=>document.querySelector(s);
  const listBody = $('#listBody');
  const groupTitle = $('#groupTitle');

  // ===== Modal helpers =====
  let modalTimer=null;
  function showModalLink(url){
    $('#mBox').textContent = url;
    $('#modalBack').style.display='flex';
    clearTimeout(modalTimer);
    modalTimer = setTimeout(()=> closeModal(true), 5000);
  }
  function closeModal(reload){ $('#modalBack').style.display='none'; if(reload) location.reload(); }
  $('#mOk').onclick = ()=> closeModal(true);
  $('#mCopy').onclick = async ()=>{ try{ await navigator.clipboard.writeText($('#mBox').textContent); toast('Link copied'); }catch{} };

  function toast(msg){ const t=$('#toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=> t.style.display='none', 1500); }

  // ===== Generators (restored endpoints) =====
  $('#genLink').onclick = async ()=>{
    const id = ($('#splynxId').value||'').trim();
    if (!id) return;
    $('#genLink').disabled = true;
    try{
      const r = await fetch('/api/admin/genlink', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ id })
      });
      const d = await r.json().catch(()=> ({}));
      if (d && d.url) showModalLink(d.url);
      else toast('Failed to generate link');
    }catch{ toast('Failed to generate link'); }
    $('#genLink').disabled = false;
  };

  $('#genStaff').onclick = async ()=>{
    const linkid = ($('#linkId').value||'').trim();
    if (!linkid) return;
    $('#genStaff').disabled = true;
    try{
      const r = await fetch('/api/staff/gen', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ linkid })
      });
      const d = await r.json().catch(()=> ({}));
      if (d && (d.code || d.ok)) showModalLink(\`Staff code for \${linkid}: \${d.code || '(check logs)'}\`);
      else toast('Failed to generate code');
    }catch{ toast('Failed to generate code'); }
    $('#genStaff').disabled = false;
  };

  // ===== Lists (server-rendered HTML, same endpoints you have now) =====
  const tabs = Array.from(document.querySelectorAll('.pill'));
  tabs.forEach(btn=>{
    btn.onclick = ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const sec = btn.getAttribute('data-sec');
      groupTitle.textContent =
        sec==='inprogress' ? 'In Progress' :
        sec==='pending' ? 'Pending Review' : 'Approved';
      loadSection(sec);
    };
  });

  async function loadSection(sec){
    listBody.textContent = 'Loading…';
    try{
      const r = await fetch('/api/admin/list?section=' + encodeURIComponent(sec));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      listBody.innerHTML = html;
      wireRowButtons();
    }catch(e){
      listBody.innerHTML = '<div class="err">Failed to load list: ' + (e.message||e) + '</div>';
    }
  }

  function wireRowButtons(){
    listBody.querySelectorAll('[data-act]').forEach(btn=>{
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
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('Marked as ' + label);
      // reload current section
      const active = document.querySelector('.pill.active')?.getAttribute('data-sec') || 'inprogress';
      await loadSection(active);
    }catch(e){ toast('Error: ' + (e.message||e)); }
  }

  loadSection('inprogress');
})();
</script>
</body>
</html>`;
}

/* ---------- escape helpers ---------- */
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, m => m==="&"?"&amp;":m==="<"?"&lt;":m===">"?"&gt;":"&quot;"); }
function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }