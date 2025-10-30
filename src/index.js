// src/index.js

// Keep your existing onboarding router from the onboarding app
import { route as routeOnboarding } from "./routes.js";

/* ------------------ Config ------------------ */
const SPYLNX_URL = "https://splynx.vinet.co.za";
const AUTH_HEADER =
  "Basic NTcxMDRhNGJjNjhhY2Y2MjRkMDliMmYwOTQ1ZTI1M2E6N2UyOTNmY2QyNzBjODJmOTdjNWQzODUwZjdhM2I1MTE=";

const WA_TEMPLATE_NAME = "wa_onboarding"; // body: {{text}} name, {{text2}} url
const WA_TEMPLATE_LANG = "en_US";

/* ------------------ Utils ------------------- */
const DATE_TODAY = () => new Date().toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const html = (h, s = 200) => new Response(h, { status: s, headers: { "content-type": "text/html; charset=utf-8" } });
const safeStr = (v) => (v == null ? "" : String(v)).trim();
const hostOf = (req) => new URL(req.url).host.toLowerCase();

function isAllowedIP(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  // 160.226.128.0/20
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

function normalizeMsisdn(s) {
  let t = String(s || "").trim();
  if (t.startsWith("0")) t = "27" + t.slice(1);
  if (t.startsWith("+")) t = t.slice(1);
  return t.replace(/\D+/g, "");
}

async function splynx(method, path, body) {
  // path should start with "/api/2.0/..."
  const r = await fetch(`${SPYLNX_URL}${path}`, {
    method,
    headers: { Authorization: AUTH_HEADER, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}

async function sendWATemplate(env, msisdn, templateName, lang, nameText, urlText) {
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msisdn,
        type: "template",
        template: {
          name: templateName,
          language: { code: lang },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: nameText }, { type: "text", text: urlText }],
            },
          ],
        },
      }),
    });
    if (!r.ok) {
      console.log("WA fail", r.status, await r.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.log("WA exc:", e);
    return false;
  }
}

/* ------------------ D1 schema ------------------ */
async function ensureLeadSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, phone TEXT, email TEXT, source TEXT,
      city TEXT, street TEXT, zip TEXT, billing_email TEXT,
      score INTEGER, date_added TEXT, captured_by TEXT,
      synced INTEGER DEFAULT 0,
      lead_id INTEGER, splynx_id INTEGER
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT, created_at INTEGER,
      payload TEXT, uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER, synced TEXT
    )`)
  ]);
  const tryAlter = async (sql) => { try { await env.DB.prepare(sql).run(); } catch {} };
  await tryAlter(`ALTER TABLE leads ADD COLUMN lead_id INTEGER`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN synced TEXT`);
}

/* -------------- Public (new.*) --------------- */
function publicHTML() {
  return `<!doctype html>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet Lead Capture</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{--brand:#e2001a;--ink:#111;--line:#ddd;--bg:#f7f7fa}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--ink);max-width:680px;margin:40px auto;padding:20px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,.06);padding:22px}
.logo{width:160px;display:block;margin:0 auto 10px}
h1{color:var(--brand);text-align:center;margin:6px 0 20px;font-size:28px}
label{display:block;margin:10px 0 6px;font-weight:600}
input,select{width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;background:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.actions{margin-top:18px}
button{width:100%;background:var(--brand);color:#fff;border:none;border-radius:10px;padding:12px 14px;font-weight:700;cursor:pointer}
.toast{position:fixed;inset:auto 16px 16px 16px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 10px 28px rgba(0,0,0,.12);display:none}
.ok{color:#0a7d2b;font-weight:700}
.center{text-align:center}
</style>
<div class="card">
  <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
  <h1>New Service Enquiry</h1>
  <form id="f" novalidate>
    <div class="row">
      <div><label>Full Name *</label><input name="full_name" required/></div>
      <div><label>Phone (WhatsApp) *</label><input name="phone" required/></div>
    </div>
    <div class="row">
      <div><label>Email *</label><input name="email" type="email" required/></div>
      <div><label>Source *</label>
        <select name="source" required>
          <option value="">Select…</option><option>Website</option><option>Facebook</option>
          <option>Walk-in</option><option>Referral</option><option>Other</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div><label>City *</label><input name="city" required/></div>
      <div><label>ZIP *</label><input name="zip" required/></div>
    </div>
    <label>Street Address *</label><input name="street" required/>
    <label>Service Interested In *</label>
    <select name="service" required>
      <option value="">Select…</option><option>FTTH (Fibre to the Home)</option>
      <option>Fixed Wireless / Airfibre</option><option>VoIP</option><option>Web Hosting</option>
    </select>
    <input type="hidden" name="partner" value="main"/><input type="hidden" name="location" value="main"/>
    <label><input type="checkbox" name="consent" required/> I consent to Vinet contacting me regarding this enquiry.</label>
    <div class="actions"><button type="submit">Submit</button></div>
    <p class="center"><small>Support: 021 007 0200</small></p>
  </form>
</div>
<div id="t" class="toast"></div>
<script>
const f=document.getElementById('f'), t=document.getElementById('t');
const toast=(h)=>{t.innerHTML=h;t.style.display='block';setTimeout(()=>t.style.display='none',6000)}
f.addEventListener('submit',async(e)=>{
  e.preventDefault();
  const fd=new FormData(f);
  if(!fd.get('consent')){toast('Please tick consent to proceed.');return;}
  const r=await fetch('/submit',{method:'POST',body:fd});
  const d=await r.json().catch(()=>({}));
  if(d && d.ok){ toast('<div class="ok">Thank you! Your enquiry was received.</div><div>Reference: '+(d.ref||'-')+'</div>'); f.reset(); }
  else { toast('Error: '+((d && (d.error||d.detail))||'Could not save.')); }
});
</script>`;
}

async function handlePublic(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index" || url.pathname === "/index.html")) {
    return html(publicHTML());
  }

  if (url.pathname === "/submit" && request.method === "POST") {
    await ensureLeadSchema(env);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "Bad form" }, 400);

    const full_name = safeStr(form.get("full_name"));
    const phone = safeStr(form.get("phone"));
    const email = safeStr(form.get("email"));
    const source = safeStr(form.get("source"));
    const city = safeStr(form.get("city"));
    const street = safeStr(form.get("street"));
    const zip = safeStr(form.get("zip"));
    const service = safeStr(form.get("service"));
    const partner = safeStr(form.get("partner") || "main");
    const location = safeStr(form.get("location") || "main");
    const consent = !!form.get("consent");

    if (!full_name || !phone || !email || !source || !city || !street || !zip || !service || !consent) {
      return json({ error: "Missing required fields" }, 400);
    }

    const payload = {
      name: full_name,
      phone, email, source, city, street, zip,
      billing_email: email, score: 1, date_added: DATE_TODAY(),
      captured_by: "public", service_interested: service, partner, location
    };

    // Insert into leads
    await env.DB.prepare(`
      INSERT INTO leads (name,phone,email,source,city,street,zip,billing_email,score,date_added,captured_by,synced)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,'public',0)
    `).bind(payload.name, payload.phone, payload.email, payload.source, payload.city, payload.street, payload.zip, payload.billing_email, payload.date_added).run();

    // Queue for admin review / Splynx push
    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return json({ ok: true, ref });
  }

  return null;
}

/* -------------- Admin (crm.*) --------------- */

function adminHTML() {
  return `<!doctype html><meta charset="utf-8"/>
<title>Vinet CRM · Leads Queue</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#fafafa;color:#0b1320;margin:0}
header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0}
header img{width:120px}
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
    <div id="matches" style="margin:10px 0"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="btnCancel" type="button" class="btn-grey">Cancel</button>
      <button id="btnSave" type="button">Save</button>
      <button id="btnSubmit" type="button">Submit to Splynx</button>
      <button id="btnWA" type="button">Send WA Onboarding</button>
    </div>
  </div>
</div>

<script>
const list=document.getElementById('list');
const modal=document.getElementById('modal');
let state={rows:[], row:null, payload:null, splynxId:null};

async function load(){
  const r=await fetch('/api/admin/queue'); const d=await r.json();
  state.rows=d.rows||[];
  const rows=state.rows.map(x=>{
    const p=x.payload||{};
    const badge = x.processed?'<span class="badge">synced #'+(x.splynx_id||'-')+'</span>':'<span class="badge" style="background:#fee;border-color:#f99">pending</span>';
    return '<tr><td>'+x.id+'</td><td>'+ (p.name||'') +'</td><td>'+ (p.phone||'') +'</td><td>'+ (p.email||'') +'</td><td>'+ (p.city||'') +'</td><td>'+ (p.service_interested||'') +'</td><td>'+badge+'</td><td class="row-actions"><button data-id="'+x.id+'" data-act="edit">Open</button></td></tr>';
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
  modal.style.display='flex';
  document.getElementById('matches').innerHTML='';
  // wire buttons
  document.getElementById('btnCancel').onclick=()=>{ modal.style.display='none' };
  document.getElementById('btnSave').onclick=async()=>{
    state.payload = {
      name:document.getElementById('f_name').value.trim(),
      phone:document.getElementById('f_phone').value.trim(),
      email:document.getElementById('f_email').value.trim(),
      source:document.getElementById('f_source').value.trim(),
      city:document.getElementById('f_city').value.trim(),
      zip:document.getElementById('f_zip').value.trim(),
      street:document.getElementById('f_street').value.trim(),
      service_interested:document.getElementById('f_service').value.trim()
    };
    await fetch('/api/admin/update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:state.row.id,payload:state.payload})});
    alert('Saved.');
  };
  document.getElementById('btnSubmit').onclick=submitFlow;
  document.getElementById('btnWA').onclick=sendWA;
}

async function submitFlow(){
  // step 1: get matches
  const r = await fetch('/api/admin/match',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ payload: state.payload })});
  const d = await r.json(); // {matches:[{id,name,email,phone,type:'lead'|'customer'}]}
  const m = d.matches||[];
  const el = document.getElementById('matches');
  if(m.length===0){
    el.innerHTML = '<div>No matches. Click "Submit to Splynx" again to create new.</div>';
    // second click creates new
    document.getElementById('btnSubmit').onclick = createNew;
    return;
  }
  el.innerHTML = '<div><strong>Possible matches:</strong><ul>'+m.map(x=>'<li>#'+x.id+' · '+x.name+' · '+(x.email||'')+' · '+(x.phone||'')+' ('+x.type+')</li>').join('')+'</ul><button id="overwrite">Overwrite first match</button> <button id="create">Create new</button> <button id="reuse">Use "re-use" lead</button></div>';
  document.getElementById('overwrite').onclick=()=>overwrite(m[0].id, m[0].type);
  document.getElementById('create').onclick=createNew;
  document.getElementById('reuse').onclick=reuseLead;
}

async function overwrite(id, type){
  const r = await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'overwrite', targetId:id, targetType:type })});
  const d = await r.json(); alert(d.ok ? ('Updated #'+d.id) : ('Failed: '+(d.detail||d.error)));
  modal.style.display='none'; load();
}
async function createNew(){
  const r = await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'create' })});
  const d = await r.json(); alert(d.ok ? ('Created #'+d.id) : ('Failed: '+(d.detail||d.error)));
  modal.style.display='none'; load();
}
async function reuseLead(){
  const r = await fetch('/api/admin/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id, mode:'reuse' })});
  const d = await r.json(); alert(d.ok ? ('Reused #'+d.id) : ('Failed: '+(d.detail||d.error)));
  modal.style.display='none'; load();
}

async function sendWA(){
  const r=await fetch('/api/admin/wa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ id: state.row.id })});
  const d=await r.json(); alert(d.ok?('WhatsApp sent: '+d.url):('WA failed: '+(d.detail||d.error)));
}
load();
</script>`;
}

async function handleAdmin(request, env) {
  if (!isAllowedIP(request)) return html("<h1 style='color:#e2001a'>Access Denied</h1>", 403);
  const url = new URL(request.url);

  // UI
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index")) {
    return html(adminHTML());
  }

  await ensureLeadSchema(env);

  // List queue
  if (url.pathname === "/api/admin/queue" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, sales_user, created_at, payload, processed, splynx_id FROM leads_queue ORDER BY created_at DESC LIMIT 500"
    ).all();
    const parsed = (rows.results || []).map((r) => ({
      id: r.id,
      sales_user: r.sales_user,
      created_at: r.created_at,
      processed: r.processed,
      splynx_id: r.splynx_id,
      payload: (()=>{
        try { return JSON.parse(r.payload||"{}"); } catch { return {}; }
      })()
    }));
    return json({ rows: parsed });
  }

  // Save edits
  if (url.pathname === "/api/admin/update" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id || !body.payload) return json({ error: "Bad request" }, 400);
    await env.DB.prepare("UPDATE leads_queue SET payload=?1 WHERE id=?2").bind(JSON.stringify(body.payload), body.id).run();
    return json({ ok: true });
  }

  // Match candidates in Splynx (customers + leads by email/phone/name)
  if (url.pathname === "/api/admin/match" && request.method === "POST") {
    const { payload } = await request.json().catch(() => ({}));
    const candidates = [];

    // Customers
    try {
      const rc = await splynx("GET", "/api/2.0/admin/customers/customer");
      const customers = await rc.json().catch(() => []);
      (Array.isArray(customers) ? customers : []).forEach((c) => {
        if (!c) return;
        const hit =
          (payload.email && c.email === payload.email) ||
          (payload.phone && c.phone === payload.phone) ||
          (payload.name && (c.name || "").toLowerCase() === payload.name.toLowerCase());
        if (hit) candidates.push({ id: c.id, name: c.name, email: c.email, phone: c.phone, type: "customer" });
      });
    } catch {}

    // Leads
    try {
      const rl = await splynx("GET", "/api/2.0/admin/crm/leads");
      const leads = await rl.json().catch(() => []);
      (Array.isArray(leads) ? leads : []).forEach((l) => {
        if (!l) return;
        const hit =
          (payload.email && l.email === payload.email) ||
          (payload.phone && l.phone === payload.phone) ||
          (payload.name && (l.name || "").toLowerCase() === payload.name.toLowerCase());
        if (hit) candidates.push({ id: l.id, name: l.name, email: l.email, phone: l.phone, type: "lead" });
      });
    } catch {}

    return json({ matches: candidates });
  }

  // Submit to Splynx (mode: create | overwrite | reuse)
  if (url.pathname === "/api/admin/submit" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = (()=>{ try { return JSON.parse(row.payload||"{}"); } catch { return {}; } })();

    const leadPayload = {
      name: p.name,
      email: p.email,
      phone: p.phone,
      city: p.city,
      street_1: p.street,
      zip_code: p.zip,
      source: p.source,
      billing_email: p.email,
      score: 1,
      status: "New enquiry",
      date_add: DATE_TODAY(),
      owner: "public"
    };

    // resolve mode
    let r, splynxId = null;
    if (body.mode === "overwrite" && body.targetId && body.targetType) {
      const path = body.targetType === "customer"
        ? `/api/2.0/admin/customers/customer/${body.targetId}`
        : `/api/2.0/admin/crm/leads/${body.targetId}`;
      r = await splynx("PUT", path, leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      splynxId = body.targetId;
    } else if (body.mode === "reuse") {
      // find first 're-use' lead (like your earlier flow)
      const rl = await splynx("GET", "/api/2.0/admin/crm/leads");
      const leads = await rl.json().catch(() => []);
      const reuse = (Array.isArray(leads) ? leads : []).find((l) => (l.name || "").toLowerCase() === "re-use");
      if (!reuse) return json({ error: true, detail: "No 're-use' lead found" }, 500);
      r = await splynx("PUT", `/api/2.0/admin/crm/leads/${reuse.id}`, leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      splynxId = reuse.id;
    } else {
      r = await splynx("POST", "/api/2.0/admin/crm/leads", leadPayload);
      if (!r.ok) return json({ error: true, detail: await r.text().catch(()=>`Splynx ${r.status}`) }, 500);
      const created = await r.json().catch(() => ({}));
      splynxId = created.id || null;
    }

    await env.DB.prepare("UPDATE leads_queue SET processed=1, splynx_id=?1, synced='1' WHERE id=?2").bind(splynxId, body.id).run();
    if (splynxId) {
      await env.DB.prepare("UPDATE leads SET splynx_id=?1, synced=1 WHERE email=?2 OR phone=?3").bind(splynxId, p.email||"", p.phone||"").run();
    }
    return json({ ok: true, id: splynxId });
  }

  // WhatsApp onboarding link
  if (url.pathname === "/api/admin/wa" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) return json({ error: "Bad request" }, 400);

    const row = await env.DB.prepare("SELECT payload FROM leads_queue WHERE id=?1 LIMIT 1").bind(body.id).first();
    if (!row) return json({ error: "Not found" }, 404);
    const p = (()=>{ try { return JSON.parse(row.payload||"{}"); } catch { return {}; } })();

    const name = p.name || "there";
    const phone = normalizeMsisdn(p.phone || "");
    const code = `${(name.split(' ')[0]||'client').toLowerCase()}_${Math.random().toString(36).slice(2,8)}`;
    const urlText = `https://onboard.vinet.co.za/onboard/${code}`;

    const ok = await sendWATemplate(env, phone, WA_TEMPLATE_NAME, WA_TEMPLATE_LANG, name, urlText);
    return ok ? json({ ok: true, url: urlText }) : json({ error: true, detail: "WA send failed" }, 500);
  }

  return null;
}

/* -------------- Entry (host switch) --------------- */
export default {
  async fetch(request, env, ctx) {
    const host = hostOf(request);

    if (host === "new.vinet.co.za") {
      const r = await handlePublic(request, env);
      if (r) return r;
      return html("<h1>Not found</h1>", 404);
    }

    if (host === "crm.vinet.co.za") {
      const r = await handleAdmin(request, env);
      if (r) return r;
      return html("<h1>Admin route not handled</h1>", 404);
    }

    if (host === "onboard.vinet.co.za") {
      // Delegate entirely to your existing onboarding app router
      return routeOnboarding(request, env, ctx);
    }

    return html("<h1>Host not configured</h1>", 400);
  },
};
