// src/ui/admin.js
import { LOGO_URL } from "../constants.js";

/* ===========================================================
   DASHBOARD (Admin) — shows OTP verification status badges
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
    --card:#fff; --bg:#f7f8fb;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--vinet);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:1100px;margin:30px auto;padding:0 18px}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .brand img{height:58px}
  .brand h1{font-size:30px;line-height:1.05;color:var(--vinet);margin:0;font-weight:900}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:900px){.grid-2{grid-template-columns:1fr}}
  .card{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .h{font-weight:900;color:var(--ink);margin:0 0 10px}
  .note{font-size:12px;color:var(--muted);margin:6px 0}
  .input{width:100%;padding:11px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;font-weight:800}
  .btn:disabled{opacity:.6;cursor:not-allowed}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet)}
  .pill-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 8px}
  .pill{padding:10px 16px;border-radius:999px;border:2px solid var(--vinet);color:var(--vinet);font-weight:800;background:#fff;cursor:pointer}
  .pill.active{background:var(--vinet);color:#fff}
  .list-col{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .group-title{font-weight:900;margin:0 0 8px}
  .empty{color:var(--muted);font-style:italic}
  .item{border:1px solid #eee;border-radius:12px;padding:12px;margin:10px 0}
  .meta{font-size:12px;color:#445}
  .links{display:flex;gap:12px;margin:6px 0 2px}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap}
  .btn-small{padding:7px 12px;border-radius:9px;font-size:14px}
  .badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;margin-left:6px}
  .ok{background:#e8fff1;color:#0a7a38;border:1px solid #9be3ba}
  .warn{background:#fff4e5;color:#9a5a00;border:1px solid #ffd49a}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <img src="${LOGO_URL}" alt="Vinet Logo">
      <h1>Onboarding Admin<br/>Dashboard</h1>
    </div>

    <!-- Generate cards -->
    <div class="grid-2">
      <div class="card">
        <p class="h">Generate Onboard link (Splynx ID)</p>
        <input id="splynxId" class="input" placeholder="e.g. 319" />
        <div style="display:flex;justify-content:center;margin-top:8px"><button id="genLink" class="btn">Generate</button></div>
        <p id="genMsg" class="note"></p>
      </div>

      <div class="card">
        <p class="h">Generate Verification code (linkid)</p>
        <input id="linkId" class="input" placeholder="e.g. 319_abcd1234" />
        <div style="display:flex;justify-content:center;margin-top:8px"><button id="genStaff" class="btn">Generate</button></div>
        <p id="staffMsg" class="note">Creates a one-time staff code for the given link.</p>
      </div>
    </div>

    <!-- Lists -->
    <div class="pill-tabs">
      <button data-mode="inprogress" class="pill active">In Progress</button>
      <button data-mode="pending" class="pill">Pending Review</button>
      <button data-mode="approved" class="pill">Approved</button>
    </div>
    <div id="listWrap" class="list-col">
      <p class="group-title" id="groupTitle">In Progress</p>
      <div id="listBody"></div>
      <p id="emptyMsg" class="empty" style="display:none">No sessions in <span id="emptyLabel">this section</span>.</p>
    </div>
  </div>

<script>
(function(){
  const $ = (s)=>document.querySelector(s);
  const groupTitle = $('#groupTitle');
  const listBody = $('#listBody');
  const emptyMsg = $('#emptyMsg');
  const emptyLabel = $('#emptyLabel');

  // Generate link
  $('#genLink').onclick = async ()=>{
    const id = ($('#splynxId').value||'').trim();
    if (!id) return;
    $('#genLink').disabled = true;
    $('#genMsg').textContent = '';
    try{
      const r = await fetch('/api/admin/genlink', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ id })
      });
      const d = await r.json();
      if (d.ok && d.url){
        $('#genMsg').innerHTML = 'Created: <a href="'+d.url+'" target="_blank">'+d.url+'</a>';
        loadList(); // refresh "In Progress"
      } else {
        $('#genMsg').textContent = d.error || 'Failed to generate link';
      }
    }catch{ $('#genMsg').textContent = 'Network error'; }
    $('#genLink').disabled = false;
  };

  // Generate staff code
  $('#genStaff').onclick = async ()=>{
    const linkid = ($('#linkId').value||'').trim();
    if (!linkid) return;
    $('#genStaff').disabled = true;
    $('#staffMsg').textContent = 'Generating...';
    try{
      const r = await fetch('/api/admin/staff/gen', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ linkid })
      });
      const d = await r.json();
      if (d.ok){
        $('#staffMsg').textContent = 'Staff code: ' + d.code;
      } else {
        $('#staffMsg').textContent = d.error || 'Failed to generate code';
      }
    }catch{ $('#staffMsg').textContent = 'Network error'; }
    $('#genStaff').disabled = false;
  };

  // Tabs
  let mode = 'inprogress';
  const tabs = Array.from(document.querySelectorAll('.pill-tabs .pill'));
  tabs.forEach(btn=>{
    btn.onclick = ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      const label = mode==='pending' ? 'Pending Review' : mode==='approved' ? 'Approved' : 'In Progress';
      groupTitle.textContent = label;
      emptyLabel.textContent = label;
      loadList();
    };
  });

  function fmtAgo(ts){
    if (!ts) return '—';
    const ms = Date.now()-ts;
    const m = Math.max(0, Math.round(ms/60000));
    if (m < 1) return 'just now';
    if (m < 60) return m+'m ago';
    const h = Math.round(m/60);
    return h+'h ago';
  }

  function itemHtml(it){
    const id = it.id || '—';
    const linkid = it.linkid || '';
    const updated = it.updated ? new Date(it.updated).toLocaleString() : '—';
    const ago = fmtAgo(it.updated);

    const verBadge = it.verified_ok
      ? '<span class="badge ok">Verified '+(it.verified_kind==='staff'?'(Staff)':'(WhatsApp)')+(it.verified_phone?' · '+it.verified_phone:'')+'</span>'
      : '<span class="badge warn">Not verified</span>';

    const links = [
      '<a target="_blank" href="/onboard/'+linkid+'">Open link</a>',
      '<a target="_blank" href="/admin/review?linkid='+linkid+'">Review</a>',
      '<a target="_blank" href="/pdf/msa/'+linkid+'">MSA</a>',
      '<a target="_blank" href="/pdf/debit/'+linkid+'">Debit</a>'
    ].join(' · ');

    const actionsInProg = `
      <div class="btn-row">
        <button class="btn btn-small" data-act="approve" data-linkid="${linkid}">Approve</button>
        <button class="btn btn-small btn-ghost" data-act="reject" data-linkid="${linkid}">Reject</button>
        <button class="btn btn-small btn-ghost" data-act="delete" data-linkid="${linkid}">Delete</button>
      </div>`;

    const actionsOther = `
      <div class="btn-row">
        <button class="btn btn-small btn-ghost" data-act="delete" data-linkid="${linkid}">Delete</button>
      </div>`;

    return `
      <div class="item">
        <div class="meta"><b>Splynx ID ${id}</b> ${verBadge}</div>
        <div class="meta">Updated: ${updated} (${ago})</div>
        <div class="meta">${links}</div>
        ${mode==='inprogress' ? actionsInProg : actionsOther}
      </div>`;
  }

  async function loadList(){
    listBody.innerHTML = '';
    emptyMsg.style.display = 'none';
    try{
      const r = await fetch('/api/admin/list?section='+encodeURIComponent(mode));
      const d = await r.json();
      const items = (d && d.ok && Array.isArray(d.items)) ? d.items : [];
      if (!items.length){ emptyMsg.style.display = 'block'; return; }
      listBody.innerHTML = items.map(itemHtml).join('');
      listBody.querySelectorAll('[data-act]').forEach(btn=>{
        const act = btn.getAttribute('data-act');
        const linkid = btn.getAttribute('data-linkid');
        btn.onclick = ()=> handleAct(act, linkid);
      });
    }catch{
      emptyMsg.style.display = 'block';
    }
  }

  async function handleAct(act, linkid){
    if (!linkid) return;
    if (act==='approve'){
      await fetch('/api/admin/approve', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
    } else if (act==='reject'){
      const reason = prompt('Reason for rejection (optional):') || '';
      await fetch('/api/admin/reject', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, reason })});
    } else if (act==='delete'){
      if (!confirm('Delete this onboarding session (including uploads)?')) return;
      await fetch('/api/admin/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
    }
    loadList();
  }

  loadList();
})();
</script>
</body>
</html>`;
}