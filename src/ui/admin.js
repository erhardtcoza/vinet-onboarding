// src/ui/admin.js
import { LOGO_URL } from "../constants.js";

/* ===========================================================
   DASHBOARD (Admin)
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
  .brand h1{font-size:22px;color:var(--vinet);margin:0;font-weight:800}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:900px){.grid-2{grid-template-columns:1fr}}
  .card{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .h{font-weight:800;color:var(--ink);margin:0 0 10px}
  .sub{font-size:12px;color:var(--muted);margin:6px 0}
  .input{width:100%;padding:11px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:700}
  .btn:disabled{opacity:.6;cursor:not-allowed}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet)}
  .lists{margin-top:24px}
  .group-title{font-weight:800;margin:0 0 8px}
  .empty{color:var(--muted);font-style:italic}
  .item{border:1px solid #eee;border-radius:12px;padding:12px;margin:10px 0}
  .meta{font-size:12px;color:#445}
  .links{display:flex;gap:12px;margin:8px 0}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  .btn-small{padding:7px 12px;border-radius:9px;font-size:14px}
  .muted{color:#6a6a6a}
  .urlchip{display:inline-block;background:#fafafa;border:1px dashed #ddd;border-radius:10px;padding:6px 10px;font-size:12px;color:#333}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <img src="${LOGO_URL}" alt="Vinet Logo">
      <h1>Vinet Onboarding – Admin</h1>
    </div>

    <!-- Generate cards -->
    <div class="grid-2">
      <div class="card">
        <p class="h">Generate Onboard link (Splynx ID)</p>
        <input id="splynxId" class="input" placeholder="e.g. 319" />
        <div style="margin-top:10px"><button id="genLink" class="btn">Generate</button></div>
      </div>

      <div class="card">
        <p class="h">Generate Verification code (linkid)</p>
        <input id="linkId" class="input" placeholder="e.g. 319_abcd1234" />
        <div style="margin-top:10px"><button id="genStaff" class="btn">Generate</button></div>
      </div>
    </div>

    <!-- Session Lists -->
    <div class="lists">
      <h2>In Progress</h2>
      <div id="in-progress-list"></div>

      <h2>Pending Review</h2>
      <div id="pending-list"></div>

      <h2>Approved</h2>
      <div id="approved-list"></div>
    </div>
  </div>

<script>
(async function(){

  // Generate actions
  document.getElementById('genLink').onclick = async ()=>{
    const id = (document.getElementById('splynxId').value||'').trim();
    if (!id) return;
    const r = await fetch('/api/admin/genlink', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id })});
    const d = await r.json();
    if (d && d.url) alert("Onboard link: " + d.url);
  };
  document.getElementById('genStaff').onclick = async ()=>{
    const linkid = (document.getElementById('linkId').value||'').trim();
    if (!linkid) return;
    const r = await fetch('/api/staff/gen', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
    const d = await r.json();
    if (d && d.ok) alert("Staff code: " + d.code);
  };

  // Load sessions from new endpoint
  async function loadSessions(){
    try{
      const res = await fetch("/api/admin/listlinks");
      const sessions = await res.json();

      renderList("in-progress-list", sessions.filter(s=>s.status==="in_progress"));
      renderList("pending-list", sessions.filter(s=>s.status==="pending"));
      renderList("approved-list", sessions.filter(s=>s.status==="approved"));
    }catch(err){
      console.error("Failed to load sessions", err);
    }
  }

  function renderList(elementId, items){
    const el = document.getElementById(elementId);
    el.innerHTML = "";
    if (!items.length){
      el.innerHTML = '<p class="empty">No records.</p>';
      return;
    }
    for (const s of items){
      const div = document.createElement("div");
      div.className = "item";
      const url = s.token ? \`\${location.origin}/onboard/\${s.token}\` : "";
      div.innerHTML = \`
        <div class="meta"><b>ID:</b> \${s.id||"(no id)"} • <b>Status:</b> \${s.status}</div>
        \${url? \`<div><span class="urlchip">\${url}</span></div>\`: ""}
        <div class="btn-row">
          <button class="btn btn-small" onclick="location.href='/admin/review?linkid=\${s.token}'">Review</button>
          \${s.status==="pending" ? \`<button class="btn btn-small" onclick="approveSession('\${s.token}')">Approve</button>\`: ""}
          <button class="btn btn-small btn-ghost" onclick="deleteSession('\${s.token}')">Delete</button>
        </div>
      \`;
      el.appendChild(div);
    }
  }

  window.approveSession = async (linkid)=>{
    await fetch('/api/admin/approve',{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});
    loadSessions();
  };

  window.deleteSession = async (linkid)=>{
    if (!confirm("Delete this session?")) return;
    await fetch('/api/admin/delete',{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});
    loadSessions();
  };

  // kick off
  loadSessions();

})();
</script>
</body>
</html>`;
}
