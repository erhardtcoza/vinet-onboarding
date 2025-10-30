// src/ui/crm_leads.js
export function renderCRMHTML() {
  return /*html*/ `<!doctype html><meta charset="utf-8"/>
<title>Vinet CRM · Leads Queue</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#fafafa;color:#0b1320;margin:0}
  header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0}
  header img{width:120px;height:auto}
  h1{font-size:18px;margin:0;color:#e2001a}
  main{max-width:1080px;margin:18px auto;padding:0 16px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid #f0f2f5;text-align:left;font-size:14px}
  th{background:#e2001a;color:#fff}
  button{background:#e2001a;color:#fff;border:none;border-radius:8px;padding:8px 10px;cursor:pointer}
  .btn-grey{background:#6b7280}
  .row-actions{display:flex;gap:8px}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.18);padding:16px;max-width:560px;width:100%}
  textarea,input,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#eef;border:1px solid #99f;color:#223}
  .matches{padding:8px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;margin:10px 0}
</style>

<header>
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
  <h1>Leads Queue</h1>
</header>

<main>
  <p>Review public submissions, edit, match in Splynx, then create/update + send WhatsApp onboarding.</p>
  <div id="list"></div>
</main>

<div class="modal" id="modal">
  <div class="card">
    <h3>Edit / Submit Lead</h3>
    <div class="grid">
      <div><label>Name<input id="f_name"/></label></div>
      <div><label>Phone<input id="f_phone"/></label></div>
      <div><label>Email<input id="f_email" type="email"/></label></div>
      <div><label>Source<input id="f_source"/></label></div>
      <div><label>City<input id="f_city"/></label></div>
      <div><label>ZIP<input id="f_zip"/></label></div>
    </div>
    <label>Street<textarea id="f_street" rows="3"></textarea></label>
    <label>Service<select id="f_service">
      <option value="">Select…</option>
      <option>FTTH (Fibre to the Home)</option>
      <option>Fixed Wireless / Airfibre</option>
      <option>VoIP</option>
      <option>Web Hosting</option>
    </select></label>

    <div id="matches" class="matches" style="display:none"></div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="btnCancel" type="button" class="btn-grey">Cancel</button>
      <button id="btnSave" type="button">Save</button>
      <button id="btnSubmit" type="button">Submit to Splynx</button>
      <button id="btnWA" type="button">Send WA Onboarding</button>
    </div>
  </div>
</div>

<script>
(function(){
  const list=document.getElementById('list');
  const modal=document.getElementById('modal');
  const matchesBox=document.getElementById('matches');
  let state={rows:[], row:null, payload:null};

  async function load(){
    const r=await fetch('/api/admin/queue');
    const d=await r.json();
    state.rows=d.rows||[];
    const rows=state.rows.map(x=>{
      const p=x.payload||{};
      const badge = x.processed?('<span class="badge">synced #'+(x.splynx_id||'-')+'</span>')
                               :('<span class="badge" style="background:#fee;border-color:#f99">pending</span>');
      return '<tr>'
          + '<td>'+x.id+'</td>'
          + '<td>'+ (p.name||'') +'</td>'
          + '<td>'+ (p.phone||'') +'</td>'
          + '<td>'+ (p.email||'') +'</td>'
          + '<td>'+ (p.city||'') +'</td>'
          + '<td>'+ (p.service_interested||'') +'</td>'
          + '<td>'+ badge +'</td>'
          + '<td class="row-actions"><button data-id="'+x.id+'" data-act="edit">Open</button></td>'
        + '</tr>';
    }).join('');
    list.innerHTML='<table><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>City</th><th>Service</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>';
    list.querySelectorAll('button').forEach(b=>{
      b.onclick=()=>openEdit(Number(b.dataset.id));
    });
  }

  function fillForm(p){
    document.getElementById('f_name').value=p.name||'';
    document.getElementById('f_phone').value=p.phone||'';
    document.getElementById('f_email').value=p.email||'';
    document.getElementById('f_source').value=p.source||'';
    document.getElementById('f_city').value=p.city||'';
    document.getElementById('f_zip').value=p.zip||'';
    document.getElementById('f_street').value=p.street||'';
    document.getElementById('f_service').value=p.service_interested||'';
  }

  async function openEdit(id){
    state.row = state.rows.find(x=>x.id===id);
    state.payload = Object.assign({}, state.row.payload||{});
    fillForm(state.payload);
    matchesBox.style.display='none';
    matchesBox.innerHTML='';
    modal.style.display='flex';

    document.getElementById('btnCancel').onclick=()=>{ modal.style.display='none' };
    document.getElementById('btnSave').onclick=saveEdits;
    document.getElementById('btnSubmit').onclick=submitFlow;
    document.getElementById('btnWA').onclick=sendWA;
  }

  async function saveEdits(){
    state.payload = {
      name:val('f_name'), phone:val('f_phone'), email:val('f_email'),
      source:val('f_source'), city:val('f_city'), zip:val('f_zip'),
      street:val('f_street'), service_interested:val('f_service')
    };
    await fetch('/api/admin/update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:state.row.id,payload:state.payload})});
    alert('Saved.');
  }

  async function submitFlow(){
    const r = await fetch('/api/admin/match',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ payload: state.payload })});
    const d = await r.json();
    const m = d.matches||[];
    if(m.length===0){
      matchesBox.style.display='block';
      matchesBox.innerHTML = '<div><strong>No matches found.</strong> Click the button again to create a new lead.</div>';
      document.getElementById('btnSubmit').onclick = createNew;
      return;
    }
    const items = '<ul>' + m.map(x=>(
      '<li>#'+x.id+' · '+escapeHtml(x.name||'')+' · '+escapeHtml(x.email||'')+' · '+escapeHtml(x.phone||'')+' ('+x.type+')</li>'
    )).join('') + '</ul>';
    matchesBox.style.display='block';
    matchesBox.innerHTML = '<div><strong>Possible matches:</strong>'+items
      + '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<button id="overwrite">Overwrite first match</button>'
      + '<button id="create">Create new</button>'
      + '<button id="reuse">Use "re-use" lead</button>'
      + '</div></div>';
    byId('overwrite').onclick=()=>overwrite(m[0].id, m[0].type);
    byId('create').onclick=createNew;
    byId('reuse').onclick=reuseLead;
  }

  async function overwrite(id, type){
    const r=await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'overwrite', targetId:id, targetType:type })});
    const d=await r.json(); alert(d.ok ? ('Updated #'+d.id) : ('Failed: '+(d.detail||d.error)));
    modal.style.display='none'; load();
  }
  async function createNew(){
    const r=await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'create' })});
    const d=await r.json(); alert(d.ok ? ('Created #'+d.id) : ('Failed: '+(d.detail||d.error)));
    modal.style.display='none'; load();
  }
  async function reuseLead(){
    const r=await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'reuse' })});
    const d=await r.json(); alert(d.ok ? ('Reused #'+d.id) : ('Failed: '+(d.detail||d.error)));
    modal.style.display='none'; load();
  }

  async function sendWA(){
    const r=await fetch('/api/admin/wa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id })});
    const d=await r.json(); alert(d.ok?('WhatsApp sent: '+d.url):('WA failed: '+(d.detail||d.error)));
  }

  // helpers
  function val(id){ return (document.getElementById(id).value||'').trim(); }
  function byId(id){ return document.getElementById(id); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  load();
})();
</script>`;
}
