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
  .brand img{height:60px} /* +50% */
  .brand h1{font-size:22px;color:var(--vinet);margin:0;font-weight:800}
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
  .pill-tabs{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 2px}
  .pill{padding:8px 14px;border-radius:999px;border:2px solid var(--vinet);color:var(--vinet);font-weight:700;background:#fff;cursor:pointer}
  .pill.active{background:var(--vinet);color:#fff}
  .lists{margin-top:18px}
  .list-col{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  .group-title{font-weight:800;margin:0 0 8px}
  .empty{color:var(--muted);font-style:italic}
  .item{border:1px solid #eee;border-radius:12px;padding:12px;margin:10px 0}
  .meta{font-size:12px;color:#445}
  .links{display:flex;gap:12px;margin:8px 0}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap}
  .btn-small{padding:7px 12px;border-radius:9px;font-size:14px}
  .muted{color:#6a6a6a}
  .urlchip{display:inline-block;background:#fafafa;border:1px dashed #ddd;border-radius:10px;padding:6px 10px;font-size:12px;color:#333}
  .center{display:flex;justify-content:center;margin-top:8px}
  /* Modal */
  .modal-back{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center;z-index:20}
  .modal{background:#fff;border-radius:16px;box-shadow:0 10px 40px #0004;max-width:560px;width:min(92vw,560px);padding:16px 16px 14px}
  .modal .title{font-weight:900;color:var(--vinet);margin:0 0 8px}
  .modal .box{border:2px solid var(--vinet);border-radius:12px;padding:10px 12px;background:#fff;margin:6px 0;overflow:auto}
  .modal .row{justify-content:flex-end}
  .toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#222;color:#fff;border-radius:10px;padding:9px 12px;font-size:13px;display:none;z-index:25}
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
      <div class="card" id="card-left">
        <p class="h">Generate Onboard link (Splynx ID)</p>
        <input id="splynxId" class="input" placeholder="e.g. 319" />
        <div class="center"><button id="genLink" class="btn">Generate</button></div>
      </div>

      <div class="card" id="card-right">
        <p class="h">Generate Verification code (linkid)</p>
        <input id="linkId" class="input" placeholder="e.g. 319_abcd1234" />
        <div class="center"><button id="genStaff" class="btn">Generate</button></div>
        <p class="sub">No records.</p>
      </div>
    </div>

    <!-- Lists block (below cards) -->
    <div class="lists">
      <div class="pill-tabs">
        <button data-mode="all" class="pill active">In Progress + Pending</button>
        <button data-mode="inprog" class="pill">In Progress</button>
        <button data-mode="pending" class="pill">Pending</button>
        <button data-mode="approved" class="pill">Approved</button>
      </div>
      <div id="listWrap" class="list-col">
        <p class="group-title" id="groupTitle">In Progress + Pending</p>
        <div id="listBody"></div>
        <p id="emptyMsg" class="empty" style="display:none">No records.</p>
      </div>
    </div>
  </div>

  <!-- Modal -->
  <div id="modalBack" class="modal-back" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="modal">
      <p id="mTitle" class="title">Onboarding link</p>
      <div id="mBox" class="box"></div>
      <div class="row">
        <button id="mCopy" class="btn btn-small">Copy</button>
        <button id="mOk" class="btn btn-small btn-ghost">OK</button>
      </div>
      <p id="mNote" class="sub" style="margin:8px 0 0">This window will close automatically.</p>
    </div>
  </div>
  <div id="toast" class="toast">Copied!</div>

<script>
(function(){
  const $ = (s)=>document.querySelector(s);
  const listBody = $('#listBody');
  const emptyMsg = $('#emptyMsg');
  const groupTitle = $('#groupTitle');

  // Modal
  let modalTimer = null;
  function showModalLink(url){
    $('#mBox').textContent = url;
    $('#modalBack').style.display = 'flex';
    clearTimeout(modalTimer);
    modalTimer = setTimeout(()=>{ closeModal(true); }, 5000);
  }
  function closeModal(reload){
    $('#modalBack').style.display = 'none';
    if (reload) location.reload();
  }
  $('#mOk').onclick = ()=> closeModal(true);
  $('#mCopy').onclick = async ()=>{
    try{ await navigator.clipboard.writeText($('#mBox').textContent); toast('Link copied'); }catch{}
  };
  function toast(msg){
    const t=$('#toast'); t.textContent=msg; t.style.display='block';
    setTimeout(()=>{ t.style.display='none'; }, 1500);
  }

  // Generate actions
  $('#genLink').onclick = async ()=>{
    const id = ($('#splynxId').value||'').trim();
    if (!id) return;
    $('#genLink').disabled = true;
    try{
      const r = await fetch('/api/admin/genlink', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id })});
      const d = await r.json();
      if (d && d.url) showModalLink(d.url);
    }catch{}
    $('#genLink').disabled = false;
  };
  $('#genStaff').onclick = async ()=>{
    const linkid = ($('#linkId').value||'').trim();
    if (!linkid) return;
    $('#genStaff').disabled = true;
    try{
      const r = await fetch('/api/staff/gen', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
      const d = await r.json();
      if (d && d.ok) showModalLink(\`Staff code for \${linkid}: \${d.code || '(check logs)'}\`);
    }catch{}
    $('#genStaff').disabled = false;
  };

  // Lists
  let mode = 'all';
  const tabs = Array.from(document.querySelectorAll('.pill-tabs .pill'));
  tabs.forEach(btn=>{
    btn.onclick = ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      groupTitle.textContent =
        mode==='inprog' ? 'In Progress' :
        mode==='pending' ? 'Pending' :
        mode==='approved' ? 'Approved' : 'In Progress + Pending';
      loadList();
    };
  });

  function fmtAgo(ts){
    if (!ts) return 'unknown';
    const ms = Date.now()-ts;
    const m = Math.max(0, Math.round(ms/60000));
    if (m < 1) return 'just now';
    if (m < 60) return \`\${m}m ago\`;
    const h = Math.round(m/60);
    return \`\${h}h ago\`;
  }

  async function fetchList(kind){
    if (kind==='all'){
      const [a,b] = await Promise.all([
        fetch('/api/admin/list?mode=inprog').then(r=>r.json()).catch(()=>({items:[]})),
        fetch('/api/admin/list?mode=pending').then(r=>r.json()).catch(()=>({items:[]})),
      ]);
      const items = [].concat(a.items||[], b.items||[]);
      items.sort((x,y)=> (y.updated||0)-(x.updated||0));
      return { items };
    }
    return await fetch('/api/admin/list?mode='+encodeURIComponent(kind)).then(r=>r.json()).catch(()=>({items:[]}));
  }

  function itemHtml(it){
    const id = it.id || '—';
    const linkid = it.linkid || '';
    const updated = it.updated ? new Date(it.updated).toLocaleString() : '—';
    const ago = fmtAgo(it.updated);

    if (mode==='pending'){
      const url = \`\${location.origin}/onboard/\${linkid}\`;
      return \`
        <div class="item">
          <div class="meta"><b>Customer/Lead \${id}</b></div>
          <div class="meta muted">Updated: \${updated} (\${ago})</div>
          <div style="margin:8px 0"><span class="urlchip">\${url}</span></div>
          <div class="btn-row">
            <button class="btn btn-small btn-ghost" data-act="delete" data-linkid="\${linkid}">Delete</button>
          </div>
        </div>\`;
    }
    if (mode==='approved'){
      return \`
        <div class="item">
          <div class="meta"><b>Customer/Lead \${id}</b></div>
          <div class="meta muted">Updated: \${updated} (\${ago})</div>
          <div class="links">
            <a target="_blank" href="/admin/review?linkid=\${linkid}">Review</a>
            <a target="_blank" href="/pdf/msa/\${linkid}">MSA</a>
            <a target="_blank" href="/pdf/debit/\${linkid}">Debit</a>
          </div>
          <div class="btn-row">
            <button class="btn btn-small btn-ghost" data-act="delete" data-linkid="\${linkid}">Delete</button>
          </div>
        </div>\`;
    }
    return \`
      <div class="item">
        <div class="meta"><b>Customer/Lead \${id}</b></div>
        <div class="meta muted">Updated: \${updated} (\${ago})</div>
        <div class="links">
          <a target="_blank" href="/admin/review?linkid=\${linkid}">Review</a>
          <a target="_blank" href="/pdf/msa/\${linkid}">MSA</a>
          <a target="_blank" href="/pdf/debit/\${linkid}">Debit</a>
        </div>
        <div class="btn-row">
          <button class="btn btn-small" data-act="approve" data-linkid="\${linkid}">Approve</button>
          <button class="btn btn-small btn-ghost" data-act="reject" data-linkid="\${linkid}">Reject</button>
          <button class="btn btn-small btn-ghost" data-act="delete" data-linkid="\${linkid}">Delete</button>
        </div>
      </div>\`;
  }

  async function loadList(){
    listBody.innerHTML = '';
    emptyMsg.style.display = 'none';
    const { items } = await fetchList(mode);
    if (!items || !items.length){
      emptyMsg.style.display = 'block';
      return;
    }
    listBody.innerHTML = items.map(itemHtml).join('');
    listBody.querySelectorAll('[data-act]').forEach(btn=>{
      const act = btn.getAttribute('data-act');
      const linkid = btn.getAttribute('data-linkid');
      btn.onclick = ()=> handleAct(act, linkid);
    });
  }

  async function handleAct(act, linkid){
    if (!linkid) return;
    if (act==='approve'){
      const r = await fetch('/api/admin/approve', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
      if (r.ok) loadList();
    } else if (act==='reject'){
      const reason = prompt('Reason for rejection (optional):') || '';
      await fetch('/api/admin/reject', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, reason })});
      loadList();
    } else if (act==='delete'){
      if (!confirm('Delete this onboarding session (including uploads)?')) return;
      await fetch('/api/admin/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
      loadList();
    }
  }

  loadList();
})();
</script>
</body>
</html>`;
}

/* ===========================================================
   REVIEW & APPROVE (with side‑by‑side diff)
   =========================================================== */
export function renderAdminReviewHTML({ linkid, sess, r2PublicBase }) {
  const esc = (s)=> String(s ?? "").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const uploads = Array.isArray(sess?.uploads) ? sess.uploads : [];
  const msalink = `/pdf/msa/${linkid}`;
  const debitlink = `/pdf/debit/${linkid}`;
  const back = `/`;
  const splynxId = String(sess?.id ?? "").trim();

  return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Review & Approve</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{ --vinet:#e2001a; --ink:#222; --muted:#666; --card:#fff; --bg:#f7f8fb; --changed:#fff1f2; }
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:980px;margin:28px auto;padding:0 18px}
  .card{background:#fff;border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  h1{color:var(--vinet);margin:0 0 14px;font-size:28px}
  .sec{margin:14px 0}
  .chip{display:inline-block;border:1px solid #ddd;border-radius:10px;padding:6px 9px;margin:3px 0;font-size:13px}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;margin-right:10px}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet)}
  .muted{color:#6a6a6a}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .hdr{font-weight:800;margin:4px 0 6px}
  table{width:100%;border-collapse:separate;border-spacing:0 8px}
  th,td{text-align:left;vertical-align:top;font-size:14px}
  th.k{width:42%;color:#333}
  td.v{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:8px 10px}
  td.v.changed{background:var(--changed);border-color:#f3b8bf}
  .changed-badge{display:inline-block;font-size:11px;background:var(--vinet);color:#fff;border-radius:8px;padding:2px 6px;margin-left:6px}
</style>
</head>
<body>
<div class="wrap">
  <a href="${back}" class="chip">&larr; Back</a>
  <div class="card">
    <h1>Review & Approve</h1>
    <div class="sec">
      <span class="chip"><b>Splynx ID:</b> ${esc(splynxId||'—')}</span>
      <span class="chip"><b>LinkID:</b> ${esc(linkid)}</span>
      <span class="chip"><b>Status:</b> ${esc(sess?.status||'pending')}</span>
    </div>

    <!-- Two‑column diff -->
    <div class="sec grid">
      <div>
        <div class="hdr">Splynx (current)</div>
        <table id="tbl-left"></table>
      </div>
      <div>
        <div class="hdr">Edited by customer</div>
        <table id="tbl-right"></table>
      </div>
    </div>

    <h3>Uploads</h3>
    <div class="sec">
      ${uploads.length ? uploads.map(u=>{
        const url = `${r2PublicBase}/${u.key}`;
        const kb = Math.round((u.size||0)/102.4)/10;
        return `<div><a href="${url}" target="_blank">${esc(u.name)}</a> <span class="muted">• ${kb.toFixed(1)} KB</span></div>`;
      }).join('') : '<div class="muted">No uploads</div>'}
    </div>

    <h3>Agreement</h3>
    <div class="sec">
      <div class="chip">Accepted: ${sess?.agreement_signed ? 'Yes' : 'No'}</div>
      <div class="chip"><a href="${msalink}" target="_blank">MSA PDF</a></div>
      <div class="chip"><a href="${debitlink}" target="_blank">Debit PDF</a></div>
    </div>

    <div class="sec">
      <button class="btn" id="approve">Approve & Push</button>
      <button class="btn btn-ghost" id="reject">Reject</button>
      <button class="btn btn-ghost" id="delete">Delete</button>
    </div>
  </div>
</div>

<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const splynxId = ${JSON.stringify(splynxId)};
  const edits = ${JSON.stringify(sess?.edits || {})};

  const FIELDS = [
    ['full_name','Full name'],
    ['passport','ID / Passport'],
    ['email','Email'],
    ['phone','Phone'],
    ['street','Street'],
    ['city','City'],
    ['zip','ZIP']
  ];

  function esc(s){ return String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

  async function loadSplynx(){
    let left = {};
    try{
      const r = await fetch('/api/splynx/profile?id='+encodeURIComponent(splynxId));
      if (r.ok) left = await r.json();
    }catch{}
    renderTables(left, edits);
  }

  function renderTables(left, right){
    const tl = document.getElementById('tbl-left');
    const tr = document.getElementById('tbl-right');
    tl.innerHTML = ''; tr.innerHTML = '';
    for (const [k,label] of FIELDS){
      const lv = left[k] ?? '';
      const rv = right[k] ?? '';
      const changed = String(lv||'') !== String(rv||'');
      tl.insertAdjacentHTML('beforeend',
        '<tr><th class="k">'+esc(label)+'</th><td class="v">'+esc(lv)+'</td></tr>');
      tr.insertAdjacentHTML('beforeend',
        '<tr><th class="k">'+esc(label)+'</th><td class="v'+(changed?' changed':'')+'">'+esc(rv)+(changed?' <span class="changed-badge">changed</span>':'')+'</td></tr>');
    }
  }

  document.getElementById('approve').onclick = async ()=>{
    await fetch('/api/admin/approve', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
    location.href = '/';
  };
  document.getElementById('reject').onclick = async ()=>{
    const reason = prompt('Reason for rejection (optional):')||'';
    await fetch('/api/admin/reject', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, reason })});
    location.href = '/';
  };
  document.getElementById('delete').onclick = async ()=>{
    if (!confirm('Delete this onboarding session (including uploads)?')) return;
    await fetch('/api/admin/delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid })});
    location.href = '/';
  };

  loadSplynx();
})();
</script>
</body>
</html>`;
}
