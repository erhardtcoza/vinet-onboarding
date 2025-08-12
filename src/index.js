// --- Vinet Onboarding Worker ---
// Flow: Admin link -> Onboarding -> OTP -> Details/Uploads -> Sign -> PDFs (inline) -> Audit page
// PDFs are generated inline (no external PDF templates), with branding and roomy margins.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Branding / Config ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const BRAND_RED = rgb(0.886, 0.0, 0.102); // #e2001a approx
const DEFAULT_SERVICE_TERMS = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// We’ll render on A4 (595 x 842) but keep content column ~500pt wide for a “slightly narrower” look.
// Margins & layout sizes:
const PAGE_W = 595, PAGE_H = 842;
const MARGIN_X = 48;                 // generous side margins
const CONTENT_W = PAGE_W - MARGIN_X*2; // ~499pt
const HEADER_H = 64;

// VNET ASN range (for /admin)
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

// ---------- Small utils ----------
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

async function fetchTextCached(urlStr) {
  const r = await fetch(urlStr, { cf: { cacheEverything: true, cacheTtl: 600 } });
  if (!r.ok) return "";
  return r.text();
}

async function fetchBytes(urlStr) {
  const r = await fetch(urlStr, { cf: { cacheEverything: true, cacheTtl: 600 } });
  if (!r.ok) throw new Error(`fetch ${urlStr} ${r.status}`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

function wrapTextLines(font, text, size, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(page, font, text, x, y, size, lineGap, maxWidth, color = rgb(0,0,0)) {
  const lines = wrapTextLines(font, text, size, maxWidth);
  let cy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: cy, size, font, color });
    cy -= size + lineGap;
  }
  return cy;
}

function hr(page, x, y, w, color = rgb(0.85, 0.85, 0.85), thickness = 1) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, color, thickness });
}

function nowDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function deviceIdSource(request, cf, linkid) {
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";
  return [ua, ip, cf?.asn || "", cf?.colo || "", (linkid||"").slice(0,8)].join("|");
}

async function hashHex(s) {
  const enc = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(h)).slice(0,12).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPATCH(env, endpoint, data) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}`, 'content-type': 'application/json' },
    body: JSON.stringify(data || {})
  });
  if (!r.ok) throw new Error(`Splynx PATCH ${endpoint} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}

// Loose phone discovery (27xxxxxxxxx etc)
function pickPhone(obj) {
  if (!obj) return null;
  const ok = (s) => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const m = pickPhone(obj[k]);
      if (m) return m;
    }
  }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map((k) => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim();
          if (s) return s;
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return null;
}
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
  }
  return null;
}
async function fetchProfileForDisplay(env, id) {
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street || src.address || src.address_1 || src.street_1 ||
                 pickFrom(src, ["street","address","address_1","street_1"]) ||
                 pickFrom(custInfo, ["street","address","address_1","street_1"]) || "";
  const city   = src.city || pickFrom(src, ["city","town"]) || pickFrom(custInfo, ["city","town"]) || "";
  const zip    = src.zip_code || src.zip || pickFrom(src, ["zip","zip_code","postal_code"]) ||
                 pickFrom(custInfo, ["zip","zip_code","postal_code"]) || "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","identity_number","idnumber","document_number","id_card"]) || "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || [src.first_name||"", src.last_name||""].join(" ").trim(),
    email: src.email || src.billing_email || "",
    phone: phone || "",
    street, city, zip, passport,
  };
}

// ---------- WhatsApp senders (with fallback) ----------
async function sendWhatsAppTemplate(to, code, env) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] },
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template ${r.status} ${await r.text()}`);
}
async function sendWhatsAppText(to, body, env) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text ${r.status} ${await r.text()}`);
}

// ---------- Admin / Onboarding UI (unchanged visuals) ----------
function renderRootPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vinet Onboarding</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}
.logo{height:72px;margin:0 auto 6px;display:block}
h1{color:#e2001a;margin:.2em 0 .6em}
.row{display:flex;gap:10px;justify-content:center}
input{padding:.7em .9em;border:1px solid #ddd;border-radius:10px;min-width:300px}
.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:.7em 1.4em;cursor:pointer}
a.btn-secondary{background:#fff;border:2px solid #e2001a;color:#e2001a;border-radius:10px;padding:.6em 1.2em;text-decoration:none;display:inline-block;margin-left:.5em}
.note{font-size:12px;color:#666;margin-top:10px}
#out a{word-break:break-all}
</style></head><body>
<div class="card">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>Create onboarding link</h1>
  <div class="row"><input id="id" placeholder="Splynx Lead/Customer ID" autocomplete="off"><button class="btn" id="go">Generate</button></div>
  <div id="out" class="note"></div>
  <div style="margin-top:14px"><a href="/admin" class="btn-secondary">Go to Admin dashboard</a></div>
</div>
<script>
document.getElementById('go').onclick=async()=>{
  const id=document.getElementById('id').value.trim(); const out=document.getElementById('out');
  if(!id){out.textContent='Please enter an ID.';return;}
  out.textContent='Working...';
  try{
    const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    out.innerHTML=d.url?('<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'):'Error generating link.';
  }catch{out.textContent='Network error.';}
};
</script>
</body></html>`;
}

function renderAdminPage(restricted = false) {
  if (restricted) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Restricted</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}
h1{color:#e2001a}
.logo{height:72px;margin:0 auto 8px;display:block}
.note{color:#666}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Admin — Restricted</h1>
  <p class="note">Access is limited to the VNET network.</p>
</div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px} h1,h2{color:#e2001a}
.tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
.tab{padding:.55em 1em;border-radius:.7em;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
.tab.active{background:#e2001a;color:#fff}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0} input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
.row{display:flex;gap:.75em}.row>*{flex:1}
table{width:100%;border-collapse:collapse} th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
.note{font-size:12px;color:#666} #out a{word-break:break-all}
.badge{display:inline-block;background:#eee;border-radius:999px;padding:.2em .6em;font-size:.85em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>
  <div class="tabs">
    <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
    <div class="tab" data-tab="staff">2. Generate verification code</div>
    <div class="tab" data-tab="inprog">3. Pending (in-progress)</div>
    <div class="tab" data-tab="pending">4. Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">5. Approved</div>
  </div>
  <div id="content"></div>
</div>
<script>
(()=> {
  const tabs = document.querySelectorAll('.tab');
  const content = document.getElementById('content');
  tabs.forEach(t => t.onclick = () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    load(t.getAttribute('data-tab'));
  });
  load('gen');
  const node = html => { const d=document.createElement('div'); d.innerHTML=html; return d; };

  async function load(which){
    if (which==='gen') {
      content.innerHTML='';
      const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id" autocomplete="off"/><button class="btn" id="go">Generate</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
      v.querySelector('#go').onclick=async()=>{
        const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
        if(!id){out.textContent='Please enter an ID.';return;}
        out.textContent='Working...';
        try{
          const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
          const d=await r.json().catch(()=>({}));
          out.innerHTML=d.url?'<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>':'Error generating link.';
        }catch{out.textContent='Network error.';}
      };
      content.appendChild(v); return;
    }
    if (which==='staff') {
      content.innerHTML='';
      const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
      v.querySelector('#go').onclick=async()=>{
        const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
        if(!linkid){out.textContent='Enter linkid';return;}
        out.textContent='Working...';
        try{
          const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
          const d=await r.json().catch(()=>({}));
          out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> <span class="badge">valid 15 min</span>':(d.error||'Failed');
        }catch{out.textContent='Network error.';}
      };
      content.appendChild(v); return;
    }
    if (['inprog','pending','approved'].includes(which)) {
      content.innerHTML='Loading...';
      try{
        const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
        const rows=(d.items||[]).map(i=>{
          let actions='';
          if(which==='inprog'){
            actions = '<a class="btn-secondary" href="/onboard/'+encodeURIComponent(i.linkid)+'" target="_blank">Open</a> '+
                      '<button class="btn" data-del="'+i.linkid+'">Delete</button>';
          } else if (which==='pending'){
            actions = '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>';
          } else {
            actions = '<a class="btn-secondary" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Open</a>';
          }
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+actions+'</td></tr>';
        }).join('')||'<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML='<table style="max-width:900px;margin:0 auto"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        document.querySelectorAll('[data-del]').forEach(btn=>{
          btn.onclick=async()=>{
            if(!confirm('Delete this pending link?')) return;
            btn.disabled=true;
            await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:btn.getAttribute('data-del')})}).catch(()=>{});
            load(which);
          };
        });
      }catch{content.innerHTML='Failed to load.';}
      return;
    }
  }
})();
</script>
</body></html>`;
}

function renderOnboardUI(linkid) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.4em 0 2.2em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid #e2001a;color:#e2001a;padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:#e2001a;color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); } // 0..6
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (d.ok) {
        if (m) m.textContent = d.mode==='text-fallback' ? 'Code sent as a WhatsApp text. Check your WhatsApp.' : 'Code sent. Check your WhatsApp.';
      } else {
        if (d.error==='whatsapp-not-configured' || d.error==='whatsapp-send-failed') {
          if (m) m.textContent = 'WhatsApp sending is unavailable. Use the Staff code option below.';
          document.getElementById('waBox').style.display='none';
          document.getElementById('staffBox').style.display='block';
          document.getElementById('p-wa').classList.remove('active');
          document.getElementById('p-staff').classList.add('active');
        } else {
          if (m) m.textContent = d.error || 'Failed to send.';
        }
      }
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  // Step 0
  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  // Step 1 Verify
  function step1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  // Step 2 Payment
  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');

    function renderEft(){
      const id = (linkid||'').split('_')[0];
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML = [
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a></div>'
      ].join('');
    }

    let dPad = null;
    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('debitBox');
      box.style.display = 'block';
      box.innerHTML = [
        '<div class="row">',
          '<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required /></div>',
          '<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required /></div>',
          '<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick = (e)=>{ e.preventDefault(); dPad.clear(); };
    }

    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; dPad=null; }
    function hideEft(){ const box=document.getElementById('eftBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); renderEft(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; hideEft(); renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm(); else renderEft();

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        const msg = document.getElementById('d_msg');
        if (!document.getElementById('d_agree').checked) { msg.textContent='Please confirm you agree to the Debit Order terms.'; return; }
        if (!dPad || dPad.isEmpty()) { msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed:         true
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id, linkid }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  // Step 3 Prefill
  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', passport: state.edits.passport ?? p.passport ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // Step 4 Uploads (kept for admin visibility; not embedded in MSA)
  function step4(){
    stepEl.innerHTML = [
      '<h2>Upload documents</h2>',
      '<div class="note">Optional: ID / Proof of Address (max 2 files, 5MB each). These are stored but not embedded in the agreement PDF.</div>',
      '<div class="field"><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');
      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { msg.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }
      try {
        msg.textContent = 'Uploading...';
        const f1 = document.getElementById('file1').files[0];
        const f2 = document.getElementById('file2').files[0];
        const u1 = await up(f1, 'ID Document');
        const u2 = await up(f2, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        msg.textContent = 'Uploaded.';
        step=5; state.progress=step; setProg(); save(); render();
      } catch (err) { if (msg.textContent==='') msg.textContent='Upload failed.'; }
    };
  }

  // Step 5 MSA (checkbox + signature)
  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I agree to the Master Service Agreement terms.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } if (pad.isEmpty()){ msg.textContent='Please draw your signature.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  // Step 6 Done
  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we’ve recorded your information. Our team will be in contact shortly. ',
      'If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">',
        '<li><a href="/agreements/pdf/msa/'+linkid+'" target="_blank">Master Service Agreement (PDF)</a></li>',
        (showDebit ? '<li><a href="/agreements/pdf/debit/'+linkid+'" target="_blank">Debit Order Agreement (PDF)</a></li>' : ''),
      '</ul>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// ---------- Security/Audit Page ----------
async function appendSecurityPage(pdf, sess, linkid) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const titleSize = 18;
  const yTop = PAGE_H - MARGIN_X;

  page.drawText("VINET — Agreement Security Summary", { x: MARGIN_X, y: yTop - titleSize, size: titleSize, font, color: BRAND_RED });

  const t = nowDateStr();
  const ua = sess.last_ua || "n/a";
  const loc = sess.last_loc || {};
  const lines = [
    ["Link ID", linkid],
    ["Splynx ID", (linkid || "").split("_")[0]],
    ["IP Address", sess.last_ip || "n/a"],
    ["Location", [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "n/a"],
    ["Coordinates", (loc.latitude!=null && loc.longitude!=null) ? `${loc.latitude}, ${loc.longitude}` : "n/a"],
    ["ASN / Org", [loc.asn, loc.asOrganization].filter(Boolean).join(" • ") || "n/a"],
    ["Cloudflare PoP", loc.colo || "n/a"],
    ["User-Agent", ua || "n/a"],
    ["Device ID", sess.device_id || "n/a"],
    ["Timestamp", t],
  ];

  let y = yTop - 36;
  const size = 11;
  const gap = 8;
  const keyW = 120;

  for (const [k,v] of lines) {
    page.drawText(k + ":", { x: MARGIN_X, y, size, font, color: rgb(0.25,0.25,0.25) });
    page.drawText(String(v||""), { x: MARGIN_X + keyW, y, size, font, color: rgb(0,0,0) });
    y -= (size + gap);
  }

  page.drawText("This page is appended for audit purposes and should accompany the agreement.", { x: MARGIN_X, y: MARGIN_X, size: 10, font, color: rgb(0.4,0.4,0.4) });
}

// ---------- PDF (Inline) Renderers ----------
async function renderHeader(pdf, page, title) {
  const logoBytes = await fetchBytes(LOGO_URL).catch(()=>null);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);

  // Left: Title
  page.drawText(title, { x: MARGIN_X, y: PAGE_H - MARGIN_X - 18, size: 18, font, color: BRAND_RED });

  // Right: Logo + contact
  let xRight = PAGE_W - MARGIN_X;
  let yTop = PAGE_H - MARGIN_X - 6;
  if (logoBytes) {
    try {
      const png = await pdf.embedJpg(logoBytes).catch(async()=>await pdf.embedPng(logoBytes));
      const desiredW = 90;
      const scale = desiredW / png.width;
      const w = desiredW, h = png.height * scale;
      page.drawImage(png, { x: xRight - w, y: yTop - h, width: w, height: h });
      yTop -= (h + 6);
      xRight -= 0;
    } catch {}
  }
  const contact = "www.vinet.co.za • 021 007 0200";
  const contactW = normal.widthOfTextAtSize(contact, 10);
  page.drawText(contact, { x: xRight - contactW, y: yTop - 12, size: 10, font: normal, color: rgb(0.15,0.15,0.15) });

  // Divider
  hr(page, MARGIN_X, PAGE_H - MARGIN_X - HEADER_H, CONTENT_W, rgb(0.88,0.88,0.90), 1);
  return PAGE_H - MARGIN_X - HEADER_H - 14; // return y cursor below header
}

async function renderClientBlock(page, font, data, y) {
  const small = 11, gap = 6, lineGap = 4;

  const leftCol = [
    ["Full Name", data.full_name || ""],
    ["Email", data.email || ""],
    ["Phone", data.phone || ""],
  ];
  const rightCol = [
    ["Street", data.street || ""],
    ["City", data.city || ""],
    ["ZIP", data.zip || ""],
  ];

  // Left column
  let cy = y;
  for (const [k, v] of leftCol) {
    page.drawText(k + ":", { x: MARGIN_X, y: cy, size: small, font, color: rgb(0.25,0.25,0.25) });
    const yy = cy;
    const textX = MARGIN_X + 90;
    cy = drawParagraph(page, font, v, textX, yy, small, lineGap, CONTENT_W/2 - 100, rgb(0,0,0)) - gap;
  }

  // Right column
  let ry = y;
  for (const [k, v] of rightCol) {
    const rx = MARGIN_X + CONTENT_W/2;
    page.drawText(k + ":", { x: rx, y: ry, size: small, font, color: rgb(0.25,0.25,0.25) });
    ry = drawParagraph(page, font, v, rx + 70, ry, small, lineGap, CONTENT_W/2 - 80, rgb(0,0,0)) - gap;
  }

  // Bottom line for passport and client code
  const by = Math.min(cy, ry) - 4;
  const passport = data.passport || "";
  const code = String(data.client_code || "");

  page.drawText("ID / Passport:", { x: MARGIN_X, y: by, size: small, font, color: rgb(0.25,0.25,0.25) });
  page.drawText(passport || "—", { x: MARGIN_X + 90, y: by, size: small, font, color: rgb(0,0,0) });

  const rightX = MARGIN_X + CONTENT_W/2;
  page.drawText("Client Code:", { x: rightX, y: by, size: small, font, color: rgb(0.25,0.25,0.25) });
  page.drawText(code, { x: rightX + 70, y: by, size: small, font, color: rgb(0,0,0) });

  return by - 16;
}

function renderSignatureRow(page, fonts, y, name, dateStr, sigPng) {
  const labelSize = 11;
  const lineGap = 4;

  const colW = CONTENT_W / 3;
  const x1 = MARGIN_X, x2 = MARGIN_X + colW, x3 = MARGIN_X + 2*colW;

  page.drawText("Name", { x: x1, y, size: labelSize, font: fonts.small, color: rgb(0.25,0.25,0.25) });
  page.drawText(name || "", { x: x1, y: y - 16, size: labelSize, font: fonts.regular, color: rgb(0,0,0) });

  page.drawText("Signature", { x: x2, y, size: labelSize, font: fonts.small, color: rgb(0.25,0.25,0.25) });
  // Signature image if present
  if (sigPng) {
    const boxW = colW - 12, boxH = 48;
    const gx = x2, gy = y - 50;
    const scale = Math.min(boxW / sigPng.width, boxH / sigPng.height);
    const w = sigPng.width * scale, h = sigPng.height * scale;
    page.drawImage(sigPng, { x: gx, y: gy, width: w, height: h });
  } else {
    page.drawText("(missing)", { x: x2, y: y - 16, size: labelSize, font: fonts.italic, color: rgb(0.4,0.0,0.0) });
  }

  page.drawText("Date", { x: x3, y, size: labelSize, font: fonts.small, color: rgb(0.25,0.25,0.25) });
  page.drawText(dateStr || nowDateStr(), { x: x3, y: y - 16, size: labelSize, font: fonts.regular, color: rgb(0,0,0) });
}

// ----- MSA PDF -----
async function renderMsaPdfInline(request, env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status: 404 });

  // Signature is required
  if (!sess.agreement_sig_key) return new Response("Signature missing. Please sign the agreement first.", { status: 400 });

  const idOnly = (linkid || "").split("_")[0];
  const e = sess.edits || {};
  const prof = await fetchProfileForDisplay(env, idOnly).catch(()=>({}));
  const data = {
    full_name: e.full_name || prof.full_name || "",
    email:     e.email     || prof.email     || "",
    phone:     e.phone     || prof.phone     || "",
    street:    e.street    || prof.street    || "",
    city:      e.city      || prof.city      || "",
    zip:       e.zip       || prof.zip       || "",
    passport:  e.passport  || prof.passport  || "",
    client_code: idOnly
  };

  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_SERVICE_TERMS;
  const termsText = await fetchTextCached(termsUrl).catch(()=> "") || "";

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const small   = await pdf.embedFont(StandardFonts.Helvetica);
  const italic  = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const fonts = { regular, small, italic };

  // Page 1
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = await renderHeader(pdf, page, "Master Service Agreement");

  // Client block
  y = await renderClientBlock(page, regular, data, y);

  // Terms
  y -= 4;
  page.drawText("Terms", { x: MARGIN_X, y, size: 12, font: regular, color: BRAND_RED });
  y -= 14;
  y = drawParagraph(page, regular, termsText || "(terms unavailable)", MARGIN_X, y, 11, 4, CONTENT_W, rgb(0,0,0)) - 8;

  // Signature row
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  const sigPng = sigBytes ? await pdf.embedPng(sigBytes) : null;

  // Enforce signature presence
  if (!sigPng) return new Response("Signature missing. Please sign the agreement first.", { status: 400 });

  renderSignatureRow(page, fonts, Math.max(MARGIN_X + 70, y - 64), data.full_name, nowDateStr(), sigPng);

  // Audit page
  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ----- Debit Order PDF -----
async function renderDebitPdfInline(request, env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });

  // Signature required for debit when chosen
  if (!sess.debit_sig_key) return new Response("Debit Order signature missing. Please sign the debit mandate.", { status: 400 });

  const idOnly = (linkid || "").split("_")[0];
  const d = sess.debit || {};
  const prof = await fetchProfileForDisplay(env, idOnly).catch(()=>({}));
  const data = {
    full_name: (sess.edits?.full_name) || prof.full_name || "",
    email:     (sess.edits?.email)     || prof.email     || "",
    phone:     (sess.edits?.phone)     || prof.phone     || "",
    street:    (sess.edits?.street)    || prof.street    || "",
    city:      (sess.edits?.city)      || prof.city      || "",
    zip:       (sess.edits?.zip)       || prof.zip       || "",
    passport:  (sess.edits?.passport)  || prof.passport  || "",
    client_code: idOnly
  };

  const termsUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS;
  const termsText = await fetchTextCached(termsUrl).catch(()=> "") || "";

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const small   = await pdf.embedFont(StandardFonts.Helvetica);
  const italic  = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const fonts = { regular, small, italic };

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = await renderHeader(pdf, page, "Debit Order Instruction");

  // Client block
  y = await renderClientBlock(page, regular, data, y);

  // Debit fields block
  y -= 8;
  page.drawText("Debit Order Details", { x: MARGIN_X, y, size: 12, font: regular, color: BRAND_RED });
  y -= 16;

  const left = [
    ["Account Holder Name", d.account_holder || ""],
    ["Bank", d.bank_name || ""],
    ["Account Type", d.account_type || ""],
  ];
  const right = [
    ["Account Holder ID / Passport", d.id_number || ""],
    ["Bank Account No", d.account_number || ""],
    ["Debit Order Date", d.debit_day || ""],
  ];

  for (let i=0;i<left.length;i++){
    const [lk, lv] = left[i];
    const rx = MARGIN_X + CONTENT_W/2;
    const [rk, rv] = right[i];

    page.drawText(lk+":", { x: MARGIN_X, y, size: 11, font: small, color: rgb(0.25,0.25,0.25) });
    page.drawText(String(lv||""), { x: MARGIN_X+160, y, size: 11, font: regular, color: rgb(0,0,0) });

    page.drawText(rk+":", { x: rx, y, size: 11, font: small, color: rgb(0.25,0.25,0.25) });
    page.drawText(String(rv||""), { x: rx+160, y, size: 11, font: regular, color: rgb(0,0,0) });
    y -= 16;
  }

  // Terms
  y -= 8;
  page.drawText("Debit Order Terms", { x: MARGIN_X, y, size: 12, font: regular, color: BRAND_RED });
  y -= 14;
  y = drawParagraph(page, regular, termsText || "(terms unavailable)", MARGIN_X, y, 11, 4, CONTENT_W, rgb(0,0,0)) - 8;

  // Signature row
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  const sigPng = sigBytes ? await pdf.embedPng(sigBytes) : null;
  if (!sigPng) return new Response("Debit signature missing. Please sign the debit mandate.", { status: 400 });

  renderSignatureRow(page, fonts, Math.max(MARGIN_X + 70, y - 64), data.full_name, nowDateStr(), sigPng);

  // Audit page
  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Root & Admin
    if (path === "/" && method === "GET") {
      return new Response(renderRootPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response(renderAdminPage(true), { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response(renderAdminPage(false), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Terms
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_SERVICE_TERMS;
      const debUrl = env.TERMS_DEBIT_URL   || DEFAULT_DEBIT_TERMS;
      const body = (kind === "debit")
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(await fetchTextCached(debUrl))}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(await fetchTextCached(svcUrl))}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Admin: generate onboarding link
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Staff OTP generate (IP restricted)
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // WhatsApp OTP send (template -> text fallback)
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      const msisdn = await fetchCustomerMsisdn(env, splynxId).catch(()=>null);
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) {
        return json({ ok:false, error:"whatsapp-not-configured" }, 501);
      }
      try {
        await sendWhatsAppTemplate(msisdn, code, env);
        return json({ ok:true, mode:"template" });
      } catch {
        try {
          await sendWhatsAppText(msisdn, `Your Vinet verification code is: ${code}`, env);
          return json({ ok:true, mode:"text-fallback" });
        } catch {
          return json({ ok:false, error:"whatsapp-send-failed" }, 502);
        }
      }
    }

    // OTP verify
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const id = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${id}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Session fetch
    if (path.startsWith("/api/session/") && method === "GET") {
      const linkid = path.split("/")[3];
      const data = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!data) return json({ error:"Invalid link" }, 404);
      return json(data);
    }

    // Save progress + audit
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      // CF geo
      const last_loc = {
        city: cf.city || "", region: cf.region || "", country: cf.country || "",
        latitude: cf.latitude || "", longitude: cf.longitude || "",
        timezone: cf.timezone || "", postalCode: cf.postalCode || "",
        asn: cf.asn || "", asOrganization: cf.asOrganization || "", colo: cf.colo || ""
      };
      const last_ip = getIP();
      const last_ua = getUA();
      const baseForDev = deviceIdSource(request, cf, linkid);
      const device_id = existing.device_id || await hashHex(baseForDev);
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads to R2 (kept; not embedded in PDFs)
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const label = urlParams.get("label") || "File";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const rec = { key, name: fileName, size: body.byteLength, label };
      const next = { ...sess, uploads: [...(sess.uploads||[]), rec] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // MSA signature store
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // Debit: save + sign
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(()=>null);
        if (!form) return {};
        const o = {}; for (const [k,v] of form.entries()) o[k]=v; return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });

      // attach snapshot to session (for PDF)
      const linkid = (b.linkid || "");
      if (linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit: { ...b } }), { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      try {
        if (type === "msa")   return await renderMsaPdfInline(request, env, linkid);
        if (type === "debit") return await renderDebitPdfInline(request, env, linkid);
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // Admin list (basic) — unchanged logic
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed && !s.deleted) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending" && !s.deleted) items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved" && !s.deleted) items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // Admin soft delete
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, deleted:true, deleted_at:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin review (unchanged stub)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${esc(u.label)}</b> — ${esc(u.name)} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      const msaLink = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
      const doLink = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}a{color:#e2001a}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id)}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b>: ${v?esc(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreements</h2>
  <div><a href="${msaLink}" target="_blank">Master Service Agreement (PDF)</a></div>
  ${sess.debit_sig_key ? `<div style="margin-top:.5em"><a href="${doLink}" target="_blank">Debit Order Agreement (PDF)</a></div>` : '<div class="note" style="margin-top:.5em">No debit order on file.</div>'}
</div>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // EFT printable
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const body = `<!doctype html><meta charset="utf-8"><title>Vinet EFT Details</title>
      <style>body{font-family:system-ui,sans-serif;margin:2em;color:#232} h1{color:#e2001a}</style>
      <h1>Electronic Funds Transfer (EFT)</h1>
      <p><b>Account:</b> Vinet Internet Solutions</p>
      <p><b>Bank:</b> First National Bank (FNB/RMB)</p>
      <p><b>Account No:</b> 62757054996</p>
      <p><b>Branch Code:</b> 250655</p>
      <p><b>Reference:</b> <b>${esc(id)}</b></p>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  }
};