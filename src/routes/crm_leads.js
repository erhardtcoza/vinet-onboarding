// src/routes/crm_leads.js
import { listLeads, updateLeadFields, bulkSanitizeLeads } from "../splynx.js";

export function mount(router) {
  // UI
  router.add("GET", "/", async () => {
    const html = `<!doctype html><meta charset="utf-8"/>
<title>Vinet CRM Intake</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:24px;background:#f7f7f8;font:15px/1.5 ui-sans-serif,system-ui}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid #eee}
  th{background:#fafafa;text-align:left}
  .row{display:flex;gap:10px;margin:0 0 16px}
  input,select,button{padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px}
  button.primary{background:#e10600;color:#fff;border:0}
</style>
<h2>CRM Intake</h2>
<div class="row">
  <label>Status <select id="status"><option value="">(any)</option><option>New enquiry</option><option>Open</option><option>Closed</option></select></label>
  <label>Limit <input id="limit" type="number" value="50" min="1" max="500"/></label>
  <button class="primary" id="load">Load</button>
</div>
<table id="t"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Last</th><th>Actions</th></tr></thead><tbody></tbody></table>
<script>
const $ = (s)=>document.querySelector(s);
$("#load").onclick = async ()=>{
  const p = new URLSearchParams({ status: $("#status").value, limit: $("#limit").value });
  const r = await fetch('/api/crm/leads/list?'+p);
  const j = await r.json();
  const tb = $("#t tbody"); tb.innerHTML='';
  (j.rows||[]).forEach(x=>{
    const tr = document.createElement('tr');
    tr.innerHTML = \`<td>\${x.id}</td><td>\${x.name||''}</td><td>\${x.email||''}</td>
    <td>\${x.phone||''}</td><td>\${x.status||''}</td><td>\${x.last_contacted||0}</td>
    <td>
      <button data-id="\${x.id}" class="u">Mark used</button>
      <button data-id="\${x.id}" class="s">Sanitize</button>
    </td>\`;
    tb.appendChild(tr);
  });
};
document.addEventListener('click', async (e)=>{
  if (e.target.classList.contains('u')) {
    const id=e.target.dataset.id;
    await fetch('/api/crm/leads/update?id='+id, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ status:'Closed' }) });
    $("#load").click();
  }
  if (e.target.classList.contains('s')) {
    const id=e.target.dataset.id;
    await fetch('/api/crm/leads/sanitize', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ids:[Number(id)] }) });
    $("#load").click();
  }
});
$("#load").click();
</script>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  });

  // APIs
  router.add("GET", "/api/crm/leads/list", async (req) => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "";
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const rows = await listLeads({ status, limit, offset });
    return Response.json({ ok: true, rows });
  });

  router.add("POST", "/api/crm/leads/update", async (req) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const fields = await req.json().catch(()=> ({}));
    const r = await updateLeadFields(Number(id), fields);
    return Response.json(r);
  });

  router.add("POST", "/api/crm/leads/sanitize", async (req) => {
    const { ids } = await req.json().catch(()=> ({ ids: [] }));
    const r = await bulkSanitizeLeads(ids);
    return Response.json(r);
  });
}
