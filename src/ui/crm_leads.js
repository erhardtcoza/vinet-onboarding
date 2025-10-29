// src/ui/crm_leads.js
export function renderCRMHTML(){
  return /*html*/`
<!doctype html><meta charset="utf-8"/>
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
  .row-actions{display:flex;gap:8px;flex-wrap:wrap}
  .badge{font-size:12px;padding:2px 8px;border-radius:999px;background:#eef1f6;color:#344054}
</style>
<header>
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
  <h1>Leads Queue</h1>
</header>
<main>
  <p class="muted">Review public submissions, edit, check matches (lead/customer), then create/overwrite in Splynx or send WhatsApp onboarding.</p>
  <div id="list"></div>
</main>

<script>
async function load(){
  const r = await fetch('/api/admin/queue'); const data = await r.json();
  const rows = (data.rows||[]).map(row=>{
    const p = row.payload||{};
    const status = row.processed ? '<span class="badge">synced</span>' : '<span class="badge">pending</span>';
    const sid = row.splynx_id ? ('#'+row.splynx_id) : '-';
    return \`
      <tr>
        <td>\${row.id}</td>
        <td>\${p.name||""}</td>
        <td>\${p.phone||""}</td>
        <td>\${p.email||""}</td>
        <td>\${p.city||""}</td>
        <td>\${p.service_interested||""}</td>
        <td>\${status}</td>
        <td>\${sid}</td>
        <td class="row-actions">
          <button data-id="\${row.id}" data-act="edit">Edit</button>
          <button data-id="\${row.id}" data-act="match">Check Matches</button>
          <button data-id="\${row.id}" data-act="submit">Create/Overwrite</button>
          <button data-id="\${row.id}" data-act="wa">Send WA Onboarding</button>
        </td>
      </tr>\`;
  }).join('');
  document.getElementById('list').innerHTML = \`
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>City</th><th>Service</th><th>Status</th><th>Splynx</th><th>Actions</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`;

  document.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = Number(btn.dataset.id), act = btn.dataset.act;
      if (act==='edit')    return edit(id);
      if (act==='match')   return match(id);
      if (act==='submit')  return submit(id);
      if (act==='wa')      return wa(id);
    };
  });
}

async function edit(id){
  const row = await (await fetch('/api/admin/get?id='+id)).json();
  const p = row.payload||{};
  const next = prompt("Edit JSON payload", JSON.stringify(p, null, 2));
  if (!next) return;
  await fetch('/api/admin/update', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id, payload: JSON.parse(next) }) });
  load();
}

async function match(id){
  const r = await fetch('/api/admin/match', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id }) });
  const d = await r.json();
  alert("Matches found:\\nLeads: "+(d.leads||[]).length+"\\nCustomers: "+(d.customers||[]).length+"\\n\nYou can choose an ID to overwrite when you click Create/Overwrite.");
}

async function submit(id){
  // If you want to overwrite a specific lead ID, ask here:
  const overwriteId = prompt("Enter Splynx lead ID to overwrite (or leave blank to auto: match/RE-USE/new):", "");
  const body = overwriteId ? { id, overwrite_id: Number(overwriteId) } : { id };
  const r = await fetch('/api/admin/submit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json().catch(()=>({}));
  alert(d && d.ok ? 'Splynx lead ID: #'+d.id : ('Failed: '+(d.detail||d.error||'unknown')));
  load();
}

async function wa(id){
  const r = await fetch('/api/admin/wa', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id }) });
  const d = await r.json().catch(()=>({}));
  alert(d && d.ok ? ('WhatsApp sent: '+d.url) : ('WA failed: '+(d.detail||d.error||'unknown')));
}

load();
</script>`;
}
