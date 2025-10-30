// src/index.js

// Keep your existing onboarding router from the onboarding app
import { route as routeOnboarding } from "./routes.js";

/* ------------------ Config ------------------ */
const SPYLNX_URL = "https://splynx.vinet.co.za";
const AUTH_HEADER =
  "Basic NTcxMDRhNGJjNjhhY2Y2MjRkMDliMmYwOTQ1ZTI1M2E6N2UyOTNmY2QyNzBjODJmOTdjNWQzODUwZjdhM2I1MTE=";

const WA_TEMPLATE_NAME = "wa_onboarding"; // body: {{text}} name, {{text2}} url
const WA_TEMPLATE_LANG = "en";

/* ------------------ Utils ------------------- */
const DATE_TODAY = () => new Date().toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
const json = (o, s = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
const html = (h, s = 200, extraHeaders = {}) =>
  new Response(h, {
    status: s,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });
const safeStr = (v) => (v == null ? "" : String(v)).trim();
const hostOf = (req) => new URL(req.url).host.toLowerCase();

function isAllowedIP(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  // 160.226.128.0/20
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

function hasTsCookie(req) {
  const c = req.headers.get("cookie") || "";
  return /(?:^|;\s*)ts_ok=1(?:;|$)/.test(c);
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

  // ✅ Add any missing columns defensively
  await tryAlter(`ALTER TABLE leads ADD COLUMN name TEXT`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN lead_id INTEGER`);
  await tryAlter(`ALTER TABLE leads ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN splynx_id INTEGER`);
  await tryAlter(`ALTER TABLE leads_queue ADD COLUMN synced TEXT`);
}

/* ---------------------------------------------
   Public (new.*) — Splash + Turnstile preclear
----------------------------------------------*/

function splashHTML(siteKey) {
  // Loader → verify Turnstile (invisible) → fade to CTA view
  return `<!doctype html>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet · Get Connected</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{--brand:#e2001a;--ink:#0b1320;--muted:#6b7280}
*{box-sizing:border-box} html,body{height:100%}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#fff;color:var(--ink);display:grid;place-items:center}
.wrap{width:100%;max-width:720px;padding:24px}
.card{border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 10px 28px rgba(0,0,0,.08);overflow:hidden}
.header{padding:20px 20px 0}
.logo{width:160px;display:block;margin:0 auto}
.loading{display:flex;align-items:center;gap:12px;justify-content:center;padding:24px 20px 28px}
.bar{width:160px;height:6px;background:#f3f4f6;border-radius:999px;overflow:hidden}
.bar::after{content:"";display:block;height:100%;width:0%;background:var(--brand);animation:fill 1.2s ease-in-out infinite}
@keyframes fill{0%{width:0%}50%{width:60%}100%{width:100%}}
.h1{font-size:28px;font-weight:800;text-align:center;color:var(--brand);margin:10px 0 20px}
.muted{color:var(--muted);text-align:center;margin:0 0 16px}
.cta{display:none;opacity:0;transition:opacity .5s ease}
.btn{display:block;width:100%;padding:14px 16px;border-radius:12px;border:0;cursor:pointer;font-weight:800}
.btn-primary{background:var(--brand);color:#fff}
.btn-ghost{background:#0b1320;color:#fff}
.stack{display:grid;gap:12px;padding:20px}
.faded{opacity:.25}
</style>

<div class="wrap">
  <div class="card">
    <div class="header">
      <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet"/>
      <div class="h1">Get Connected</div>
    </div>
    <div id="loader" class="loading">
      <div class="bar"></div><div class="muted">Securing session…</div>
    </div>

    <div id="cta" class="cta">
      <p class="muted">Choose an option:</p>
      <div class="stack">
        <button id="btnNew" class="btn btn-primary">I want to know more (or sign-up)</button>
        <button id="btnLogin" class="btn btn-ghost">I am already connected (log in)</button>
      </div>
    </div>
  </div>
</div>

<!-- Turnstile (invisible) -->
<div id="ts" class="cf-turnstile"
     data-sitekey="${siteKey}"
     data-size="invisible"
     data-callback="onTsOk"
     data-action="splash">
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<script>
const loader = document.getElementById('loader');
const cta = document.getElementById('cta');

function showCTA(){
  loader.classList.add('faded');
  setTimeout(()=>{
    loader.style.display='none';
    cta.style.display='block';
    requestAnimationFrame(()=>{ cta.style.opacity = 1; });
  }, 200);
}

async function verifyToken(token){
  try{
    const r = await fetch('/ts-verify', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ token })
    });
    if(!r.ok){ throw new Error('verify failed '+r.status); }
    const d = await r.json();
    if(d && d.ok){ showCTA(); } else { location.reload(); }
  }catch(e){
    // If verification fails, keep user on loader to avoid abuse
    console.error(e);
    location.reload();
  }
}

// Called by Turnstile after invisible challenge
window.onTsOk = function(token){
  verifyToken(token);
};

// Execute once API is ready
function whenTSReady(cb){
  if(window.turnstile && typeof turnstile.execute==='function') return cb();
  setTimeout(()=>whenTSReady(cb), 30);
}
whenTSReady(()=> turnstile.execute('#ts') );

// Wire CTAs
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id === 'btnNew'){
    location.href = '/form';
  } else if(e.target && e.target.id === 'btnLogin'){
    location.href = 'https://splynx.vinet.co.za';
  }
});
</script>`;
}

function publicFormHTML() {
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

  // Splash with Turnstile preclearance
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index" || url.pathname === "/index.html")) {
    return html(splashHTML(env.TURNSTILE_SITE_KEY || ""));
  }

  // Lead form page
  if (request.method === "GET" && url.pathname === "/form") {
    return html(publicFormHTML());
  }

  // Turnstile verify (server-side)
  if (request.method === "POST" && url.pathname === "/ts-verify") {
    try {
      const { token } = await request.json().catch(()=>({}));
      if (!token) return json({ error: "missing token" }, 400);

      const ip = request.headers.get("CF-Connecting-IP") || "";
      const body = new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY || "",
        response: token,
        remoteip: ip
      });

      const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body
      });
      const result = await vr.json().catch(()=>({ success:false }));
      if (!result.success) {
        return json({ error: true, detail: "turnstile failed" }, 403);
      }

      const cookie = "ts_ok=1; Max-Age=86400; Path=/; Secure; SameSite=Lax";
      return json({ ok: true }, 200, { "set-cookie": cookie });
    } catch (e) {
      return json({ error: true, detail: "verify exception" }, 500);
    }
  }

  // Form submit — require Turnstile cookie from splash
  if (url.pathname === "/submit" && request.method === "POST") {
    if (!hasTsCookie(request)) {
      return json({ error: "Session not verified" }, 403);
    }

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
    `).bind(
      payload.name, payload.phone, payload.email, payload.source,
      payload.city, payload.street, payload.zip, payload.billing_email,
      payload.date_added
    ).run();

    // Queue for admin review / Splynx push
    await env.DB.prepare(`
      INSERT INTO leads_queue (sales_user,created_at,payload,uploaded_files,processed,splynx_id,synced)
      VALUES ('public',?1,?2,'[]',0,NULL,'0')
    `).bind(nowSec(), JSON.stringify(payload)).run();

    const ref = \`\${Date.now().toString(36)}-\${Math.random().toString(36).slice(2, 6)}\`;
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
      <option value="">
