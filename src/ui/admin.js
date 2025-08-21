import { LOGO_URL } from "../constants.js";

export function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px} h1,h2{color:#e2001a}
.row{display:flex;gap:.75em;flex-wrap:wrap}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0} input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
table{width:100%;border-collapse:collapse} th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
.note{font-size:12px;color:#666}
.inline-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.section{margin:1em 0 1.4em}
.back{margin-bottom:10px}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>

  <div class="section inline-grid">
    <div>
      <h2>1. Generate onboarding link</h2>
      <div class="field"><label>Splynx Lead/Customer ID</label>
        <div class="row"><input id="id" autocomplete="off"/><button class="btn" id="goGen">Generate</button></div>
        <div class="note">A modal will show the generated URL.</div>
      </div>
    </div>
    <div>
      <h2>2. Generate verification code</h2>
      <div class="field"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label>
        <div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="goStaff">Generate staff code</button></div>
        <div id="staffMsg" class="note"></div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>3. Pending (in-progress)</h2>
    <div id="inprog"></div>
  </div>
  <div class="section">
    <h2>4. Completed (awaiting approval)</h2>
    <div id="pending"></div>
  </div>
  <div class="section">
    <h2>5. Approved</h2>
    <div id="approved"></div>
  </div>
</div>

<script>
(function(){
  const q = (s)=>document.querySelector(s);
  function modal(text){
    const m=document.createElement('dialog');
    m.style.padding='16px'; m.style.maxWidth='720px';
    m.innerHTML='<div style="font: 15px/1.4 system-ui"><div style="margin-bottom:10px"><b>Generated URL</b></div><div><a href="'+text+'" target="_blank">'+text+'</a></div><div style="margin-top:12px"><button id="close" class="btn">Close</button></div></div>';
    document.body.appendChild(m); m.showModal(); m.querySelector('#close').onclick=()=>m.close();
  }

  async function loadList(which, el){
    el.textContent='Loading...';
    try{
      const r=await fetch('/api/admin/list?mode='+which);
      const d=await r.json();
      const rows=(d.items||[]).map(i=>{
        const actions = which==='pending'
          ? '<a class="btn-secondary" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
          : '<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>';
        const del = '<button class="btn" data-del="'+i.linkid+'">Delete</button>';
        return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+actions+' '+del+'</td></tr>';
      }).join('') || '<tr><td colspan="4">No records.</td></tr>';
      el.innerHTML = '<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
      el.querySelectorAll('button[data-del]').forEach(b=>{
        b.onclick=async()=>{
          if(!confirm('Delete this onboarding session and ALL stored data?')) return;
          const linkid=b.getAttribute('data-del');
          const r=await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
          const j=await r.json().catch(()=>({}));
          alert(j.ok?'Deleted':'Failed: '+(j.error||'')); loadAll();
        };
      });
    }catch{ el.textContent='Failed to load.'; }
  }
  async function loadAll(){
    await loadList('inprog', q('#inprog'));
    await loadList('pending', q('#pending'));
    await loadList('approved', q('#approved'));
  }
  loadAll();

  q('#goGen').onclick=async()=>{
    const id=q('#id').value.trim(); if(!id) return alert('Please enter an ID');
    try{
      const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
      const d=await r.json().catch(()=>({}));
      if(d.url) modal(d.url); else alert('Error generating link');
      loadAll();
    }catch{ alert('Network error'); }
  };

  q('#goStaff').onclick=async()=>{
    const linkid=q('#linkid').value.trim(); if(!linkid) return alert('Enter linkid');
    q('#staffMsg').textContent='Working...';
    try{
      const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({}));
      q('#staffMsg').textContent=d.ok?('Staff code: '+d.code+' (valid 15 min)'):(d.error||'Failed');
    }catch{ q('#staffMsg').textContent='Network error'; }
  };
})();
</script>
</body></html>`;
}

export function renderAdminReviewHTML({ linkid, sess, r2PublicBase }) {
  const escape = (s)=>String(s||"").replace(/[&<>]/g,(t)=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[t]));
  const uploads = Array.isArray(sess.uploads)?sess.uploads:[];
  const filesHTML = uploads.length
    ? `<ul style="list-style:none;padding:0">${uploads.map(u=>{
        const key = u.key || ""; const name = escape(u.name||"file");
        const href = `${r2PublicBase}/${key.replace(/^uploads\//,'uploads/')}`;
        return `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
          <a href="${href}" target="_blank">${name}</a> • ${Math.round((u.size||0)/1024)} KB</li>`;
      }).join("")}</ul>`
    : `<div class="note">No files</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}.back{margin-bottom:10px}</style></head><body>
<div class="card">
  <div class="back"><a class="btn-outline" href="/">← Back</a></div>
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escape(sess.id||"")}</b> • LinkID: <code>${escape(linkid)}</code> • Status: <b>${escape(sess.status||"n/a")}</b></div>
  <h2>Edits</h2><div>${
    Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${escape(k)}</b>: ${v?escape(String(v)):""}</div>`).join("") || "<div class='note'>None</div>"
  }</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed?"Yes":"No"}</div>
  <div style="margin-top:12px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
    <button class="btn" id="del">Delete</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...';
    try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...';
    try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
      const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.');
    }catch{ msg.textContent='Network error.'; }
  };
  document.getElementById('del').onclick=async()=>{ if(!confirm('Delete this onboarding session and ALL stored data?')) return; msg.textContent='Deleting...';
    try{ const r=await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Deleted.':'Failed.';
    }catch{ msg.textContent='Network error.'; }
  };
</script>
</body></html>`;
}
