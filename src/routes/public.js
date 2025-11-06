// /src/routes/public.js
// Lightweight route group for splash, lead page, and submission

/* ---------- tiny response helpers ---------- */
const text = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/plain; charset=utf-8", ...h } });
const json = (o, c = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const html = (s, c = 200, h = {}) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8", ...h } });

/* ---------- minimal HTML (kept inline to avoid external deps) ---------- */
function splashHTML() {
  return `<!doctype html><meta charset="utf-8"/>
<title>Vinet · Welcome</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#f7f7f8;color:#0b1320;margin:0;display:grid;place-items:center;min-height:100vh}
  .card{background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08);border-radius:16px;padding:28px;text-align:center}
  a.btn{display:inline-block;margin-top:14px;background:#ED1C24;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px}
</style>
<div class="card">
  <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" style="height:56px;border-radius:10px"/><br/>
  <h1 style="margin:10px 0 6px">Vinet</h1>
  <div>Public lead capture and CRM admin.</div>
  <a class="btn" href="/lead">Open Lead Form</a>
</div>`;
}

function leadFormHTML() {
  return `<!doctype html><meta charset="utf-8"/>
<title>New Lead</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--bg:#f7f7f8;--card:#fff;--muted:#6b7280}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink)}
  main{max-width:720px;margin:2rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
  h1{margin:.25rem 0 1rem}
  form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.25rem}
  input,select,textarea{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #e5e7eb;border-radius:10px}
  .row-2{grid-column:span 2}
  .actions{display:flex;gap:.75rem;align-items:center;margin-top:.5rem}
  button{background:var(--red);color:#fff;border:0;border-radius:10px;padding:.65rem 1rem;font-weight:600;cursor:pointer}
  .note{margin-top:.75rem;color:var(--muted);font-size:.85rem}
  .toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#111;color:#fff;padding:.6rem .9rem;border-radius:10px;opacity:.97}
</style>
<main>
  <h1>Public Lead</h1>
  <form id="leadForm" autocomplete="off">
    <div class="row-2"><label>Full name</label><input name="name" required/></div>
    <div><label>Phone</label><input name="phone" placeholder="27..." required/></div>
    <div><label>Email</label><input name="email" type="email" required/></div>
    <div><label>City/Town</label><input name="city" required/></div>
    <div><label>ZIP</label><input name="zip" required/></div>
    <div class="row-2"><label>Street Address</label><input name="street" required/></div>
    <div class="row-2"><label>Message (notes)</label><textarea name="message" rows="3" placeholder="How can we help?"></textarea></div>
    <div><label>Service</label>
      <select name="service">
        <option value="unknown">Select…</option>
        <option value="fibre">Fibre</option>
        <option value="wireless">Wireless</option>
        <option value="voip">VoIP</option>
        <option value="hosting">Web Hosting</option>
      </select>
    </div>
    <div><label>Source</label><input name="source" placeholder="website"/></div>
    <!-- Hidden defaults the business wanted -->
    <input type="hidden" name="partner" value="main"/>
    <input type="hidden" name="location" value="main"/>
    <input type="hidden" name="score" value="1"/>
    <input type="hidden" name="billing_type" value="recurring payments"/>
    <div class="row-2 actions">
      <button type="submit">Submit</button>
      <span class="note">We’ll save your details securely.</span>
    </div>
  </form>
</main>
<script>
  // kill bfcache sticky values on back/refresh
  addEventListener("pageshow",(e)=>{ if(e.persisted){ document.getElementById("leadForm")?.reset(); } });
  const form = document.getElementById("leadForm");
  function toast(msg){
    const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
    document.body.appendChild(t); setTimeout(()=>t.remove(), 2200);
  }
  function to27(msisdn){
    const s=String(msisdn||"").replace(/[^0-9]/g,"");
    if(s.startsWith("27")) return s;
    if(s.startsWith("0")) return "27"+s.slice(1);
    return s;
  }
  form.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.phone = to27(data.phone);
    const res = await fetch("/lead/submit",{ method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(data) });
    const out = await res.json().catch(()=>({ok:false,error:"Invalid response"}));
    if(out.ok){
      toast("Saved. Lead ID: "+(out.ref??"N/A"));
      form.reset();
    }else{
      toast("Error: "+(out.error||"Could not save"));
    }
  });
</script>`;
}

/* ---------- helpers for DB & validation ---------- */
const REQ_FIELDS = ["name","email","phone","city","zip","street"];
const asInt = (v) => Number(v || 0) | 0;
const nowSec = () => Math.floor(Date.now() / 1000);

function to27(msisdn) {
  const s = String(msisdn || "").replace(/[^0-9]/g, "");
  if (s.startsWith("27")) return s;
  if (s.startsWith("0")) return "27" + s.slice(1);
  return s;
}

async function ensureLeadTables(env) {
  // Uses your schema from earlier messages; idempotent.
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      splynx_id TEXT,
      full_name TEXT, email TEXT, phone TEXT,
      street TEXT, city TEXT, zip TEXT, passport TEXT,
      created_at INTEGER,
      lead_id INTEGER, name TEXT, whatsapp TEXT, message TEXT,
      partner TEXT, location TEXT, billing_type TEXT,
      synced INTEGER
    );
    CREATE TABLE IF NOT EXISTS leads_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_user TEXT,
      created_at INTEGER,
      payload TEXT,
      uploaded_files TEXT,
      processed INTEGER DEFAULT 0,
      splynx_id INTEGER,
      synced TEXT
    );
  `);
}

/* ---------- mount ---------- */
export function mount(router /*, env, ctx */) {
  // Home -> splash
  router.add("GET", "/", async () => html(splashHTML()));

  // Lead form
  router.add("GET", "/lead", async () => html(leadFormHTML()));

  // Health
  router.add("GET", "/_health", async () => text("ok"));

  // Lead submit (stores both in leads and leads_queue for CRM flow)
  router.add("POST", "/lead/submit", async (req, env) => {
    try {
      const body = await req.json().catch(() => ({}));
      for (const k of REQ_FIELDS) {
        if (!body[k]) return json({ ok: false, error: `Missing ${k}` }, 400);
      }

      // normalize / defaults
      const payload = {
        name: String(body.name || "").trim(),
        email: String(body.email || "").trim(),
        phone: to27(body.phone),
        city: String(body.city || "").trim(),
        zip: String(body.zip || "").trim(),
        street: String(body.street || "").trim(),
        message: String(body.message || "").trim(),
        service_interested: String(body.service || "unknown"),
        source: String(body.source || "website"),
        partner: String(body.partner || "main"),
        location: String(body.location || "main"),
        score: asInt(body.score || 1),
        billing_type: String(body.billing_type || "recurring payments"),
      };

      await ensureLeadTables(env);

      // Insert into leads (for reporting/search)
      await env.DB.prepare(
        `INSERT INTO leads
         (splynx_id, full_name, email, phone, street, city, zip, created_at,
          name, whatsapp, message, partner, location, billing_type, synced)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`
      )
      .bind(
        null,                // splynx_id
        payload.name,        // full_name
        payload.email,
        payload.phone,
        payload.street,
        payload.city,
        payload.zip,
        nowSec(),
        payload.name,        // name
        payload.phone,       // whatsapp (store same normalized)
        payload.message,
        payload.partner,
        payload.location,
        payload.billing_type,
        0                    // synced
      ).run();

      // Insert into queue for Admin UI to process
      const ins = await env.DB.prepare(
        `INSERT INTO leads_queue (sales_user, created_at, payload, processed, splynx_id, synced)
         VALUES (?1, ?2, ?3, 0, NULL, '0')`
      )
      .bind(
        "public",                // sales_user
        nowSec(),
        JSON.stringify(payload)
      ).run();

      const queueId = ins.lastRowId || ins.last_insert_rowid || 0;
      return json({ ok: true, ref: queueId });
    } catch (e) {
      console.error("lead/submit failed:", e && e.stack ? e.stack : e);
      return json({ ok: false, error: "server-error" }, 500);
    }
  });
}
