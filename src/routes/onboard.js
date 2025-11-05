// src/routes/onboard.js
export function mount(router) {
  // Simple admin UI
  router.add("GET", "/", async () => {
    const html = `<!doctype html><meta charset="utf-8"/>
<title>Vinet Onboarding Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:24px;background:#f7f7f8;font:15px/1.5 ui-sans-serif,system-ui}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid #eee}
  th{background:#fafafa;text-align:left}
</style>
<h2>Onboarding Links</h2>
<table id="t"><thead><tr><th>Link ID</th><th>Customer/Lead</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table>
<script>
(async ()=>{
  const r = await fetch('/api/onboard/list');
  const j = await r.json();
  const tb = document.querySelector('#t tbody'); tb.innerHTML='';
  (j.items||[]).forEach(x=>{
    const tr=document.createElement('tr');
    tr.innerHTML = \`<td>\${x.id}</td><td>\${x.for||''}</td><td>\${new Date(x.at||0).toLocaleString()}</td>
      <td>\${x.status||''}</td>
      <td><a href="/api/onboard/sync?id=\${encodeURIComponent(x.id)}">Sync to Splynx</a></td>\`;
    tb.appendChild(tr);
  });
})();
</script>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  });

  // Placeholder APIs (wire to your real KV keys)
  router.add("GET", "/api/onboard/list", async (_req, env) => {
    // Expect items under ONBOARD_KV with prefix "onboard/"
    const items = []; // keep it simple (fill from your existing keys later)
    return Response.json({ ok: true, items });
  });

  router.add("GET", "/api/onboard/sync", async (req) => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    // call your existing sync logic here
    return Response.json({ ok: true, id });
  });
}
