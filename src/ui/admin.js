// src/ui/admin.js
import { LOGO_URL } from "../constants.js";

/** Admin dashboard (inline, self-contained) */
export function renderAdminPage() {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Vinet Onboarding – Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{
    --vinet:#e2001a; --ink:#122; --muted:#6b7280; --bg:#f7f8fb; --card:#fff; --line:#e9ecf1;
    --pill-shadow: 0 2px 10px rgba(0,0,0,.08);
  }
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
  .wrap{max-width:1100px;margin:28px auto;padding:0 18px}
  .logo-row{display:flex;align-items:center;gap:14px;margin:4px 0 12px}
  .logo-row img{height:60px} /* ~50% bigger */
  h1{font-size:22px;color:var(--vinet);font-weight:800;margin:0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}
  .card{background:var(--card);border-radius:16px;box-shadow:var(--pill-shadow);padding:16px}
  .hbar{border-bottom:1px solid var(--line);padding:10px 0 12px;margin-bottom:12px}
  .hbar .tabs{display:flex;gap:10px;flex-wrap:wrap}
  .pill{border:2px solid var(--vinet);color:var(--vinet);background:#fff;border-radius:999px;padding:.45em 1.0em;font-weight:700;cursor:pointer}
  .pill.active{background:var(--vinet);color:#fff}
  .center-actions{display:flex;justify-content:center;gap:12px;margin-top:10px}
  .field{margin:8px 0}
  .field input{width:100%;padding:10px;border:1px solid var(--line);border-radius:10px;background:#fafafa}
  .btn{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:800;cursor:pointer}
  .btn-ghost{background:#fff;color:var(--vinet);border:2px solid var(--vinet);border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
  .list{display:flex;flex-direction:column;gap:14px}
  .item{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .item h3{margin:0 0 6px 0;font-size:15px}
  .meta{line-height:1.25;color:var(--muted);font-size:12px}
  .links{display:flex;gap:10px;align-items:center;margin-top:8px}
  .links a{color:#1b4; text-decoration:none}
  .actions{display:flex;gap:8px;margin-top:10px}
  .danger{border-color:#eab308;color:#eab308}
  .delete{border-color:#ef4444;color:#ef4444}
  .bad{color:#ef4444}
  .muted{color:var(--muted)}
  .url{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;color:#374151}
  .empty{color:var(--muted);font-style:italic}

  /* Styled popup */
  .popup{
    position:fixed; inset:0; display:none; place-items:center; background:rgba(0,0,0,.35); z-index:9999;
  }
  .popup.open{display:grid}
  .pop-card{
    background:#fff; max-width:540px; width:min(92vw,540px); border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.25);
    padding:18px 18px 14px;
  }
  .pop-title{display:flex;align-items:center;gap:10px;color:var(--vinet);font-weight:900;font-size:18px;margin:2px 0 10px}
  .pop-url{background:#fff;border:1px dashed var(--vinet);border-radius:10px;padding:10px 12px}
  .pop-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}
  .copy{background:var(--vinet);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer}
  .ok{background:#fff;color:var(--vinet);border:2px solid var(--vinet);border-radius:10px;padding:8px 14px;font-weight:800;cursor:pointer}

  @media (max-width:840px){ .grid{grid-template-columns:1fr} .center-actions{justify-content:flex-start} }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo-row">
      <img src="${LOGO_URL}" alt="Vinet logo">
      <h1>Vinet Onboarding – Admin</h1>
    </div>

    <div class="grid">
      <!-- Generate onboarding link -->
      <div class="card">
        <div class="hbar"><strong>Generate Onboard link (Splynx ID)</strong></div>
        <div class="field"><input id="gen-id" placeholder="e.g. 319" inputmode="numeric"></div>
        <div class="center-actions">
          <button class="btn" id="btn-gen">Generate</button>
        </div>
        <div class="hbar" style="margin-top:16px">
          <div class="tabs">
            <span class="pill active" data-tab="mix">In Progress + Pending</span>
            <span class="pill" data-tab="inprog">In Progress</span>
            <span class="pill" data-tab="pending">Pending</span>
            <span class="pill" data-tab="approved">Approved</span>
          </div>
        </div>
        <div id="col-inprog" class="list"></div>
      </div>

      <!-- Staff verify code -->
      <div class="card">
        <div class="hbar"><strong>Generate Verification code (linkid)</strong></div>
        <div class="field"><input id="gen-linkid" placeholder="e.g. 319_abcd1234"></div>
        <div class="center-actions">
          <button class="btn" id="btn-staff">Generate</button>
        </div>
        <div class="hbar" style="visibility:hidden;height:1px;padding:0;margin:0;border:0"></div>
        <div id="col-pending" class="list"></div>
      </div>
    </div>
  </div>

  <!-- Pretty popup -->
  <div class="popup" id="popup">
    <div class="pop-card">
      <div class="pop-title">Onboarding link</div>
      <div class="pop-url"><div id="pop-url" class="url"></div></div>
      <div class="pop-actions">
        <button class="copy" id="copy">Copy</button>
        <button class="ok" id="ok">OK</button>
      </div>
    </div>
  </div>

<script>
(function(){
  const el = (id)=>document.getElementById(id);
  const $inprog = el('col-inprog');
  const $pending = el('col-pending');
  const popup = el('popup'); const popUrl = el('pop-url');
  el('ok').onclick = ()=> popup.classList.remove('open');
  el('copy').onclick = async ()=> { try { await navigator.clipboard.writeText(popUrl.textContent.trim()); el('copy').textContent='Copied'; setTimeout(()=> el('copy').textContent='Copy', 1200);} catch{} };

  // Tabs
  const tabs = [...document.querySelectorAll('.pill[data-tab]')];
  let currentTab = 'mix'; // approved hidden by default
  tabs.forEach(t=> t.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    currentTab = t.dataset.tab;
    refresh();
  }));

  // Generate onboarding link
  el('btn-gen').onclick = async ()=>{
    const id = el('gen-id').value.trim();
    if(!id) return;
    const r = await fetch('/api/admin/genlink', {method:'POST', body: JSON.stringify({ id })});
    const d = await r.json().catch(()=>({}));
    if (d && d.url){
      popUrl.textContent = d.url;
      popup.classList.add('open');
      await refresh();
    }
  };

  // Generate staff code
  el('btn-staff').onclick = async ()=>{
    const linkid = el('gen-linkid').value.trim();
    if(!linkid) return;
    const r = await fetch('/api/staff/gen', {method:'POST', body: JSON.stringify({ linkid })});
    const d = await r.json().catch(()=>({}));
    if (d && d.code){
      popUrl.textContent = 'Staff code for ' + linkid + ': ' + d.code;
      popup.classList.add('open');
    }
  };

  // Helpers
  const ago = (t)=> {
    if(!t) return '—';
    const s = Math.floor((Date.now()-t)/1000);
    if (s<60) return s+'s ago';
    const m = Math.floor(s/60); if (m<60) return m+'m ago';
    const h = Math.floor(m/60); if (h<24) return h+'h ago';
    const d = Math.floor(h/24); return d+'d ago';
  };

  function itemCard(kind, it){
    const linkid = it.linkid;
    const id = it.id || '—';
    const updated = it.updated || 0;

    // Base block
    const lines = [
      '<div class="item">',
      '<h3>Customer/Lead '+id+'</h3>',
      '<div class="meta"><div>No name yet</div><div>Updated: '+ new Date(updated).toLocaleString() +' ('+ago(updated)+')</div>' +
      (it.has_uploads? '' : '<div>No uploads</div>') + '</div>'
    ];

    // Links row
    const links = [];
    if (kind !== 'pending'){ // For pending we remove Review/MSA/Debit as requested
      links.push('<a href="/admin/review?linkid='+linkid+'" target="_blank">Review</a>');
      links.push('<a href="/agreements/msa/'+linkid+'" target="_blank">MSA</a>');
      links.push('<a href="/agreements/debit/'+linkid+'" target="_blank">Debit</a>');
    } else {
      // show the onboarding URL for convenience
      links.push('<span class="url">'+location.origin+'/onboard/'+linkid+'</span>');
    }
    if (links.length) lines.push('<div class="links">'+links.join(' · ')+'</div>');

    // Actions
    const acts = [];
    if (kind !== 'approved'){
      if (kind !== 'pending') acts.push('<button class="btn" data-act="approve" data-id="'+linkid+'">Approve</button>');
      acts.push('<button class="btn-ghost danger" data-act="reject" data-id="'+linkid+'">Reject</button>');
    }
    acts.push('<button class="btn-ghost delete" data-act="delete" data-id="'+linkid+'">Delete</button>');
    lines.push('<div class="actions">'+acts.join('')+'</div>');
    lines.push('</div>');
    return lines.join('');
  }

  async function fetchList(mode){
    const r = await fetch('/api/admin/list?mode='+mode);
    const d = await r.json().catch(()=>({items:[]}));
    return Array.isArray(d.items)? d.items : [];
  }

  // Single render pass depending on currentTab
  async function refresh(){
    // in-progress & pending always visible when tab = mix
    const showInprog = (currentTab==='mix' || currentTab==='inprog');
    const showPending = (currentTab==='mix' || currentTab==='pending');
    const showApproved = (currentTab==='approved');

    // Fetch
    const [inprog, pending, approved] = await Promise.all([
      showInprog ? fetchList('inprog') : Promise.resolve([]),
      showPending ? fetchList('pending') : Promise.resolve([]),
      showApproved ? fetchList('approved') : Promise.resolve([])
    ]);

    // Render left column (in-progress OR approved based on tab)
    $inprog.innerHTML = '';
    if (currentTab==='approved'){
      if (!approved.length){ $inprog.innerHTML = '<div class="empty">No records.</div>'; }
      else $inprog.innerHTML = approved.map(it=> itemCard('approved', it)).join('');
    }else{
      if (!inprog.length){ $inprog.innerHTML = '<div class="empty">No records.</div>'; }
      else $inprog.innerHTML = inprog.map(it=> itemCard('inprog', it)).join('');
    }

    // Render right column (pending or empty)
    $pending.innerHTML = '';
    if (showPending){
      if (!pending.length){ $pending.innerHTML = '<div class="empty">No records.</div>'; }
      else $pending.innerHTML = pending.map(it=> itemCard('pending', it)).join('');
    }

    // Wire actions
    document.querySelectorAll('[data-act]').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const act = btn.dataset.act;
        const linkid = btn.dataset.id;
        if (act==='approve'){
          await fetch('/api/admin/approve',{method:'POST',body:JSON.stringify({linkid})});
        } else if (act==='reject'){
          const reason = prompt('Reason (optional):') || '';
          await fetch('/api/admin/reject',{method:'POST',body:JSON.stringify({linkid,reason})});
        } else if (act==='delete'){
          if (!confirm('Delete this onboarding session and all related KV/R2 records?')) return;
          await fetch('/api/admin/delete',{method:'POST',body:JSON.stringify({linkid})});
        }
        await refresh();
      });
    });
  }

  refresh();
})();
</script>
</body>
</html>`;
}

/** Review page (kept – includes clickable R2 links) */
export function renderAdminReviewHTML({ linkid, sess, r2PublicBase }) {
  const kb = (n)=> (Math.round((n/1024)*10)/10).toFixed(1) + " KB";
  const e = (s)=> String(s||"");
  const up = Array.isArray(sess.uploads)?sess.uploads:[];
  const edits = sess.edits || {};
  const audit = sess.audit_meta || {};
  const status = sess.status || 'pending';

  const rows = Object.entries(edits).map(([k,v])=> `<div><b>${k}</b>: ${e(v)}</div>`).join("");

  const files = up.map(u=>{
    const url = `${r2PublicBase}/${u.key}`;
    return `<div><a href="${url}" target="_blank">${e(u.name)}</a> · ${kb(u.size)}</div>`;
  }).join("") || `<div class="muted">No uploads</div>`;

  const msaLink = `/pdf/msa/${linkid}`;
  const doLink  = `/pdf/debit/${linkid}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Review & Approve</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial; background:#f7f8fb; color:#122}
  .wrap{max-width:900px;margin:28px auto;padding:0 16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.08);padding:18px}
  h1{color:#e2001a;margin:0 0 10px;font-size:26px}
  .muted{color:#6b7280}
  .row{display:flex;gap:18px;flex-wrap:wrap}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer}
  .btn-ghost{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
  .danger{border-color:#ef4444;color:#ef4444}
</style>
</head><body>
<div class="wrap">
  <a href="/" class="btn-ghost" style="margin-bottom:12px;display:inline-block">← Back</a>
  <div class="card">
    <h1>Review & Approve</h1>
    <div class="muted">Splynx ID: ${e(sess.id)} • LinkID: ${e(linkid)} • Status: ${e(status)}</div>

    <h3 style="margin-top:16px">Client Edits</h3>
    <div>${rows || '<span class="muted">No edits captured</span>'}</div>

    <h3 style="margin-top:18px">Uploads</h3>
    <div>${files}</div>

    <h3 style="margin-top:18px">Agreement</h3>
    <div>Accepted: ${sess.agreement_signed ? 'Yes' : 'No'}</div>
    <div style="margin-top:10px">
      <a class="btn-ghost" href="${msaLink}" target="_blank">Open MSA PDF</a>
      <a class="btn-ghost" href="${doLink}" target="_blank">Open Debit PDF</a>
    </div>

    <div class="row" style="margin-top:16px">
      <button class="btn" id="approve">Approve & Push</button>
      <button class="btn-ghost" id="reject">Reject</button>
      <button class="btn-ghost danger" id="delete">Delete</button>
    </div>
  </div>
</div>
<script>
  (function(){
    const linkid = ${JSON.stringify(linkid)};
    document.getElementById('approve').onclick = async ()=>{
      await fetch('/api/admin/approve',{method:'POST',body:JSON.stringify({linkid})});
      alert('Approved & pushed (check Splynx).'); location.href='/';
    };
    document.getElementById('reject').onclick = async ()=>{
      const reason = prompt('Reason (optional):') || '';
      await fetch('/api/admin/reject',{method:'POST',body:JSON.stringify({linkid,reason})});
      alert('Marked as rejected.'); location.href='/';
    };
    document.getElementById('delete').onclick = async ()=>{
      if (!confirm('Delete this onboarding session and all related KV/R2 records?')) return;
      await fetch('/api/admin/delete',{method:'POST',body:JSON.stringify({linkid})});
      alert('Deleted.'); location.href='/';
    };
  })();
</script>
</body></html>`;
}
