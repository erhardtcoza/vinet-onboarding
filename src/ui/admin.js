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
  .item{border:1px solid #eee;border-radius:12px;padding:12px;margin:10px 0;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
  .meta{font-size:12px;color:#445}
  .links{display:flex;gap:12px;margin:8px 0}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap}
  .btn-small{padding:7px 12px;border-radius:9px;font-size:14px}
  .muted{color:#6a6a6a}
  .center{display:flex;justify-content:center;margin-top:8px}
  /* Modal */
  .modal-back{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center;z-index:20}
  .modal{background:#fff;border-radius:16px;box-shadow:0 10px 40px #0004;max-width:560px;width:min(92vw,560px);padding:16px 16px 14px}
  .modal .title{font-weight:900;color:var(--vinet);margin:0 0 8px}
  .modal .box{border:2px solid var(--vinet);border-radius:12px;padding:10px 12px;background:#fff;margin:6px 0;overflow:auto;word-break:break-all}
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
        <p class="sub">Creates a one‑time staff code for the given link.</p>
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
      if (d && d.ok) showModalLink('Staff code for '+linkid+': '+(d.code || '(check logs)'));
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
    if (m < 60) return m+'m ago';
    const h = Math.round(m/60);
    return h+'h ago';
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

  function row(it, context){
    const id = it.id || '—';
    const linkid = it.linkid || '';
    const updated = it.updated ? new Date(it.updated).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'}) : '—';
    const ago = fmtAgo(it.updated);

    const left = '<div class="meta"><b>Customer/Lead '+id+'</b><div class="muted">Updated: '+updated+' ('+ago+')</div></div>';
    const right_inprog = '<div class="btn-row">'
      + '<a class="btn btn-small btn-ghost" target="_blank" href="/onboard/'+encodeURIComponent(linkid)+'">Open</a>'
      + '<a class="btn btn-small" href="/admin/review?linkid='+encodeURIComponent(linkid)+'">Review</a>'
      + '<button class="btn btn-small btn-ghost" data-act="approve" data-linkid="'+linkid+'">Approve</button>'
      + '<button class="btn btn-small btn-ghost" data-act="reject" data-linkid="'+linkid+'">Reject</button>'
      + '<button class="btn btn-small btn-ghost" data-act="delete" data-linkid="'+linkid+'">Delete</button>'
      + '</div>';

    const right_pending = '<div class="btn-row">'
      + '<a class="btn btn-small" href="/admin/review?linkid='+encodeURIComponent(linkid)+'">Review</a>'
      + '<button class="btn btn-small btn-ghost" data-act="delete" data-linkid="'+linkid+'">Delete</button>'
      + '</div>';

    const right_approved = '<div class="btn-row">'
      + '<a class="btn btn-small btn-ghost" target="_blank" href="/admin/review?linkid='+encodeURIComponent(linkid)+'">Review</a>'
      + '<a class="btn btn-small btn-ghost" target="_blank" href="/pdf/msa/'+encodeURIComponent(linkid)+'">MSA</a>'
      + '<a class="btn btn-small btn-ghost" target="_blank" href="/pdf/debit/'+encodeURIComponent(linkid)+'">Debit</a>'
      + '<button class="btn btn-small btn-ghost" data-act="delete" data-linkid="'+linkid+'">Delete</button>'
      + '</div>';

    const right = context==='pending' ? right_pending : context==='approved' ? right_approved : right_inprog;
    return '<div class="item">'+left+right+'</div>';
  }

  async function loadList(){
    listBody.innerHTML = '';
    emptyMsg.style.display = 'none';
    const { items } = await fetchList(mode);
    if (!items || !items.length){
      emptyMsg.style.display = 'block';
      return;
    }
    listBody.innerHTML = items.map(it => row(it, mode==='all' ? (it.status||'inprog') : mode)).join('');
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
   REVIEW & APPROVE (with side‑by‑side diff + UX tweaks)
   =========================================================== */
export function renderAdminReviewHTML({ linkid, sess, r2PublicBase, original }) {
  const esc = (s)=> String(s ?? "").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const uploads = Array.isArray(sess?.uploads) ? sess.uploads : [];
  const msalink = `/pdf/msa/${linkid}`;
  const debitlink = `/pdf/debit/${linkid}`;
  const back = `/`;
  const splynxId = String(sess?.id ?? "").trim();
  const r2 = r2PublicBase || "";
  const e = sess?.edits || {};
  const leftObj = original || {};

  const FIELDS = [
    ['full_name','Full name'],
    ['passport','ID / Passport'],
    ['email','Email'],
    ['phone','Phone'],
    ['street','Street'],
    ['city','City'],
    ['zip','ZIP'],
    ['payment_method','Payment method']
  ];

  const uploadResult = (sess && sess.uploadResult && Array.isArray(sess.uploadResult.items))
    ? sess.uploadResult.items : null;

  // simple inline SVGs for ticks/X
  const svgTick = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  const svgX    = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3 10.6 10.6 16.9 4.3z"/></svg>';

  return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Review & Approve</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{
    --vinet:#e2001a; --ink:#222; --muted:#666; --card:#fff; --bg:#f7f8fb;
    --changed:#fff1f2; --ok:#067a00; --bad:#b00020; --pill:#eef1f6;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:980px;margin:28px auto;padding:0 18px}
  .card{background:#fff;border-radius:18px;box-shadow:0 6px 24px #0000000d,0 1px 2px #0001;padding:18px}
  h1{color:var(--vinet);margin:0 0 14px;font-size:28px}
  .sec{margin:16px 0}
  .chip{display:inline-flex;align-items:center;gap:8px;border:1px solid #e6e8ef;border-radius:12px;padding:10px 14px;margin:4px 6px 0 0;font-size:14px;background:#fff}
  .chip strong{font-weight:800}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:12px;padding:12px 16px;cursor:pointer;margin-right:10px;font-weight:800}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet)}
  .muted{color:#6a6a6a}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .hdr{font-weight:800;margin:6px 0 8px}
  table{width:100%;border-collapse:separate;border-spacing:0 10px}
  th,td{text-align:left;vertical-align:top;font-size:14px}
  th.k{width:42%;color:#333}
  td.v{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:10px 12px;line-height:1.45}
  td.v.changed{background:var(--changed);border-color:#f3b8bf}
  .changed-badge{display:inline-block;font-size:11px;background:var(--vinet);color:#fff;border-radius:8px;padding:2px 6px;margin-left:6px}
  .pills{display:flex;flex-wrap:wrap;gap:10px}
  .pill-btn{display:inline-flex;align-items:center;gap:8px;background:var(--pill);border:1px solid #dfe3ea;border-radius:999px;padding:10px 14px;font-weight:700}
  .pill-btn:hover{text-decoration:none}
  .files{display:flex;flex-wrap:wrap;gap:10px}
  .file{display:inline-flex;align-items:center;gap:8px;background:var(--pill);border:1px dashed #dfe3ea;border-radius:999px;padding:9px 14px}
  .status-row{display:flex;flex-direction:column;gap:8px}
  .status-item{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #eee;border-radius:12px;padding:10px 12px;background:#fafafa}
  .badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;font-size:12px}
  .badge.ok{background:#e8f6ea;color:var(--ok)}
  .badge.bad{background:#fde8ec;color:var(--bad)}
  .foot-actions{display:flex;gap:10px;flex-wrap:wrap}
  /* blocking overlay spinner */
  .overlay{position:fixed;inset:0;background:#0008;display:none;align-items:center;justify-content:center;z-index:50}
  .spinner{width:64px;height:64px;border-radius:50%;border:6px solid #fff3;border-top-color:#fff;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
  <a href="${back}" class="chip">&larr; Back</a>
  <div class="card">
    <h1>Review & Approve</h1>

    <!-- bigger info chips -->
    <div class="sec">
      <span class="chip"><strong>Splynx ID</strong> ${esc(splynxId||'—')}</span>
      <span class="chip"><strong>LinkID</strong> ${esc(linkid)}</span>
      <span class="chip"><strong>Status</strong> ${esc(sess?.status||'pending')}</span>
      <span class="chip">${sess?.agreement_signed ? 'MSA signed' : 'MSA not signed'}</span>
      <span class="chip">${sess?.pay_method==='debit' ? (sess?.debit_signed ? 'Debit signed' : 'Debit pending') : 'Debit N/A'}</span>
    </div>

    <!-- Two‑column diff -->
    <div class="sec grid">
      <div>
        <div class="hdr">Splynx (current)</div>
        <table>
          ${FIELDS.map(([k,label])=>{
            const v = leftObj?.[k] ?? '';
            return `<tr><th class="k">${esc(label)}</th><td class="v">${esc(v)}</td></tr>`;
          }).join('')}
        </table>
      </div>
      <div>
        <div class="hdr">Edited by customer</div>
        <table>
          ${FIELDS.map(([k,label])=>{
            const lv = leftObj?.[k] ?? '';
            const rv = e?.[k] ?? (k==='payment_method' ? (sess?.pay_method||'') : '');
            const changed = String(lv||'') !== String(rv||'');
            return `<tr><th class="k">${esc(label)}</th><td class="v${changed?' changed':''}">${esc(rv)}${changed?'<span class="changed-badge">changed</span>':''}</td></tr>`;
          }).join('')}
        </table>
      </div>
    </div>

    <!-- Agreement PDFs as big pill buttons -->
    <h3>Agreement PDFs</h3>
    <div class="sec pills">
      <a class="pill-btn" href="${msalink}" target="_blank" rel="noopener">MSA PDF</a>
      <a class="pill-btn" href="${debitlink}" target="_blank" rel="noopener">Debit Order PDF</a>
    </div>

    <!-- Uploads as pills -->
    <h3>Uploads</h3>
    <div class="sec files">
      ${
        uploads.length
          ? uploads.map(u=>{
              const url = r2 ? (r2 + "/" + u.key) : "#";
              const name = u.label || u.name || u.key;
              return `<a class="file" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>`;
            }).join('')
          : '<div class="muted">No uploads</div>'
      }
    </div>

    ${
      uploadResult ? (`
      <h3>Splynx upload result</h3>
      <div class="sec status-row">
        ${uploadResult.map(it=>{
          const ok = !!it.ok;
          const icon = ok ? '${svgTick}' : '${svgX}';
          const badge = ok ? '<span class="badge ok">${svgTick} Success</span>'
                           : '<span class="badge bad">${svgX} Failed</span>';
          const strat = it.strategy ? ' <span class="badge" style="background:#eef;color:#334;">'+esc(it.strategy)+'</span>' : '';
          const name = esc(it.name || it.title || '');
          const err  = ok ? '' : '<div class="muted" style="margin-top:6px">'+esc(it.error||'')+'</div>';
          return '<div class="status-item"><div style="display:flex;align-items:center;gap:10px"><div style="color:'+(ok?'var(--ok)':'var(--bad)')+'">'+icon+'</div><div><div style="font-weight:700">'+name+'</div>'+err+'</div></div><div>'+badge+strat+'</div></div>';
        }).join('')}
      </div>`):''
    }

    <div class="sec foot-actions">
      <button class="btn" id="approve">Approve & Push</button>
      <button class="btn btn-ghost" id="reject">Reject</button>
      <button class="btn btn-ghost" id="delete">Delete</button>
    </div>
  </div>
</div>

<!-- blocking overlay -->
<div id="overlay" class="overlay" aria-hidden="true">
  <div style="text-align:center;color:#fff">
    <div class="spinner"></div>
    <div style="margin-top:12px;font-weight:800">Uploading & applying changes…</div>
  </div>
</div>

<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const overlay = document.getElementById('overlay');

  function block(on){ overlay.style.display = on ? 'flex' : 'none'; }

  async function post(url, body){
    const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});
    return r.json().catch(()=>({}));
  }

  document.getElementById('approve').onclick = async ()=>{
    try{
      block(true);
      const d = await post('/api/admin/approve',{ linkid });
      if (d && d.ok) location.reload();
      else { block(false); alert('Approve failed: '+(d.error||'unknown')); }
    } catch {
      block(false);
      alert('Approve failed.');
    }
  };
  document.getElementById('reject').onclick = async ()=>{
    const reason = prompt('Reason for rejection (optional):')||'';
    const d = await post('/api/admin/reject',{ linkid, reason });
    if (d && d.ok) location.href = '/';
    else alert('Reject failed: '+(d.error||'unknown'));
  };
  document.getElementById('delete').onclick = async ()=>{
    if (!confirm('Delete this onboarding session (including uploads)?')) return;
    const d = await post('/api/admin/delete',{ linkid });
    if (d && d.ok) location.href = '/';
    else alert('Delete failed: '+(d.error||'unknown'));
  };
})();
</script>
</body>
</html>`;
}
