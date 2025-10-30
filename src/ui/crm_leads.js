export function adminHTML(){
  return /*html*/`<!doctype html><meta charset="utf-8"/>
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
  .muted{color:#6b7280}
  .row-actions{display:flex;gap:8px}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.18);padding:16px;max-width:620px;width:100%}
  textarea,input,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
</style>
<header>
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
  <h1>Leads Queue</h1>
</header>
<main>
  <p class="muted">Review public submissions, edit → check matches → <b>create or overwrite</b> in Splynx → optionally send WhatsApp onboarding.</p>
  <div id="list"></div>
</main>

<!-- Edit modal -->
<div class="modal" id="modal-edit">
  <div class="card">
    <h3>Edit Lead</h3>
    <div class="grid">
      <div><label>Name<input id="f_name"/></label></div>
      <div><label>Phone<input id="f_phone"/></label></div>
      <div><label>Email<input id="f_email" type="email"/></label></div>
      <div><label>Source<input id="f_source"/></label></div>
      <div><label>City<input id="f_city"/></label></div>
      <div><label>ZIP<input id="f_zip"/></label></div>
    </div>
    <label>Street<textarea id="f_street" rows="3"></textarea></label>
    <label>Service interested in<select id="f_service">
      <option value="">Select…</option>
      <option>FTTH (Fibre to the Home)</option>
      <option>Fixed Wireless / Airfibre</option>
      <option>VoIP</option>
      <option>Web Hosting</option>
    </select></label>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <button type="button" id="btnCancelE" style="background:#6b7280">Cancel</button>
      <button type="button" id="btnSaveE">Save</button>
    </div>
  </div>
</div>

<!-- Match modal -->
<div class="modal" id="modal-match">
  <div class="card">
    <h3>Possible Matches</h3>
    <div id="match-list" class="muted">Loading…</div>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <button type="button" id="btnCreateNew" title="Create a brand new lead">Create New</button>
      <button type="button" id="btnCloseM" style="background:#6b7280">Close</button>
    </div>
  </div>
</div>

<script>
  const list = document.getElementById('list');

  const modalE = document.getElementById('modal-edit');
  const f_name   = document.getElementById('f_name');
  const f_phone  = document.getElementById('f_phone');
  const f_email  = document.getElementById('f_email');
  const f_source = document.getElementById('f_source');
  const f_city   = document.getElementById('f_city');
  const f_zip    = document.getElementById('f_zip');
  const f_street = document.getElementById('f_street');
  const f_service= document.getElementById('f_service');

  const btnCancelE = document.getElementById('btnCancelE');
  const btnSaveE   = document.getElementById('btnSaveE');

  const modalM = document.getElementById('modal-match');
  const matchList = document.getElementById('match-list');
  const btnCreateNew = document.getElementById('btnCreateNew');
  const btnCloseM = document.getElementById('btnCloseM');

  let dataCache = [];
  let editRow = null;
  let editPayload = null;
  let matchRowId = null;

  async function load(){
    const r = await fetch('/api/admin/queue'); const data = await r.json();
    dataCache = data.rows||[];
    const rows = dataCache.map(row=>{
      const p = row.payload||{};
      const status = row.processed ? 'Synced' : 'Pending';
      return \`
        <tr>
          <td>\${row.id}</td>
          <td>\${p.name||""}</td>
          <td>\${p.phone||""}</td>
          <td>\${p.email||""}</td>
          <td>\${p.city||""}</td>
          <td>\${p.service_interested||""}</td>
          <td>\${row.splynx_id ? ('#'+row.splynx_id) : '-'}</td>
          <td>\${status}</td>
          <td class="row-actions">
            <button data-id="\${row.id}" data-act="edit">Edit</button>
            <button data-id="\${row.id}" data-act="match">Check Matches</button>
            <button data-id="\${row.id}" data-act="wa">Send WA Onboarding</button>
          </td>
        </tr>\`;
    }).join('');
    list.innerHTML = \`
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>City</th><th>Service</th><th>Splynx ID</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>\`;

    list.querySelectorAll('button').forEach(b=>{
      b.onclick = async ()=>{
        const id = Number(b.dataset.id);
        const act = b.dataset.act;
        const row = dataCache.find(x=>x.id===id);
        if(!row) return;
        if (act==='edit') openEdit(row);
        if (act==='match') openMatch(row);
        if (act==='wa') sendWA(row.id);
      };
    });
  }

  function openEdit(row){
    editRow = row;
    editPayload = Object.assign({}, row.payload||{});
    f_name.value   = editPayload.name||"";
    f_phone.value  = editPayload.phone||"";
    f_email.value  = editPayload.email||"";
    f_source.value = editPayload.source||"";
    f_city.value   = editPayload.city||"";
    f_zip.value    = editPayload.zip||"";
    f_street.value = editPayload.street||"";
    f_service.value= editPayload.service_interested||"";
    modalE.style.display = 'flex';

    btnCancelE.onclick = ()=>{ modalE.style.display='none' };
    btnSaveE.onclick = async ()=>{
      editPayload.name   = f_name.value.trim();
      editPayload.phone  = f_phone.value.trim();
      editPayload.email  = f_email.value.trim();
      editPayload.source = f_source.value.trim();
      editPayload.city   = f_city.value.trim();
      editPayload.zip    = f_zip.value.trim();
      editPayload.street = f_street.value.trim();
      editPayload.service_interested = f_service.value.trim();

      await fetch('/api/admin/update', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ id: editRow.id, payload: editPayload })
      });
      modalE.style.display='none';
      load();
    };
  }

  async function openMatch(row){
    matchRowId = row.id;
    modalM.style.display='flex';
    matchList.textContent = 'Loading…';
    const r = await fetch('/api/admin/match', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ id: row.id })
    });
    const d = await r.json();
    const c = d.candidates||[];
    if (!c.length) {
      matchList.innerHTML = '<p>No matches found. Click "Create New" to add in Splynx.</p>';
      return;
    }
    matchList.innerHTML = c.map(m => `
      <div style="padding:8px;border:1px solid #e5e7eb;border-radius:8px;margin:6px 0">
        <div><b>#${m.id}</b> · ${m.name||""}</div>
        <div style="color:#6b7280">${m.email||""} · ${m.phone||""}</div>
        <div style="margin-top:6px">
          <button data-target="${m.id}" data-act="overwrite">Overwrite this lead</button>
        </div>
      </div>
    `).join('');

    matchList.querySelectorAll('button[data-act="overwrite"]').forEach(btn=>{
      btn.onclick = async ()=>{
        const target = Number(btn.dataset.target);
        await doSubmit('overwrite', target);
      };
    });
  }

  btnCreateNew.onclick = async ()=>{ await doSubmit('create'); };
  btnCloseM.onclick = ()=>{ modalM.style.display='none'; };

  async function doSubmit(mode, target_id){
    const r = await fetch('/api/admin/submit', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ id: matchRowId, mode, target_id })
    });
    const d = await r.json().catch(()=>({}));
    alert(d && d.ok ? ('Submitted to Splynx: #'+d.id) : ('Failed: '+(d.detail||d.error||'unknown')));
    modalM.style.display='none';
    load();
  }

  async function sendWA(id){
    const r = await fetch('/api/admin/wa', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ id })
    });
    const d = await r.json().catch(()=>({}));
    alert(d && d.ok ? 'WhatsApp sent\n'+(d.url||'') : ('WA failed: '+(d.detail||d.error||'unknown')));
  }

  load();
</script>`;
}
