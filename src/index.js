// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, EFT & Debit Order pages

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const DEFAULT_MSA_PDF   = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DEFAULT_DEBIT_PDF = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";

// ---------- Helpers ----------
function ipAllowed(request) {
  // If you want to restrict admin to VNET IPs, update here. For now, allow all.
  return true;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });

function onlyDigits(s) {
  // remove zero-width etc & keep digits only
  return String(s||"").replace(/[\u200B-\u200D\uFEFF]/g,"").replace(/\D+/g,"");
}

// ---------- Splynx helpers (fixed paths) ----------
async function splynxGET(env, path) {
  const url = `${env.SPLYNX_API}${path.startsWith("/api/2.0")?path:`/api/2.0${path}`}`;
  const r = await fetch(url, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}
async function splynxPUT(env, path, body) {
  const url = `${env.SPLYNX_API}${path.startsWith("/api/2.0")?path:`/api/2.0${path}`}`;
  const r = await fetch(url, {
    method:"PUT",
    headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}`, "content-type":"application/json" },
    body: JSON.stringify(body||{})
  });
  if (!r.ok) throw new Error(`PUT ${path} ${r.status}`);
  return r.json().catch(()=> ({}));
}
async function splynxPOSTMultipart(env, path, formData) {
  const url = `${env.SPLYNX_API}${path.startsWith("/api/2.0")?path:`/api/2.0${path}`}`;
  const r = await fetch(url, { method:"POST", headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }, body: formData });
  if (!r.ok) throw new Error(`POST ${path} ${r.status}`);
  return r.json().catch(()=> ({}));
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; }
  }
  return null;
}
function pick(obj, keys) {
  if (!obj) return null;
  const want = keys.map(k=>k.toLowerCase());
  const stack=[obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur==="object") {
      for (const [k,v] of Object.entries(cur)) {
        if (want.includes(String(k).toLowerCase())) {
          const s = String(v??"").trim();
          if (s) return s;
        }
        if (v && typeof v==="object") stack.push(v);
      }
    }
  }
  return null;
}

async function fetchMsisdn(env, id) {
  const paths = [
    `/api/2.0/admin/customers/customer/${id}`,
    `/api/2.0/admin/customers/${id}`,
    `/api/2.0/admin/customers/${id}/contacts`,
    `/api/2.0/admin/crm/leads/${id}`,
    `/api/2.0/admin/crm/leads/${id}/contacts`
  ];
  for (const p of paths) {
    try { const d = await splynxGET(env, p); const m = pickPhone(d); if (m) return m; } catch {}
  }
  return null;
}

async function fetchProfile(env, id) {
  let cust=null, lead=null, custInfo=null, contacts=null;
  try { cust   = await splynxGET(env, `/api/2.0/admin/customers/customer/${id}`); } catch {}
  try { custInfo = await splynxGET(env, `/api/2.0/admin/customers/customer-info/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/api/2.0/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/api/2.0/admin/customers/${id}/contacts`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    billing_email: src.billing_email || src.email || "",
    phone: phone || "",
    city: src.city || "",
    street: src.street || src.street_1 || "",
    zip: src.zip_code || src.zip || "",
    passport: (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
              src.passport || src.id_number || "",
  };
}

// ---------- WhatsApp OTP (template → fallback to text) ----------
async function waSendTemplate(env, to, code, lang="en") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, type:"template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type:"body", parameters:[{ type:"text", text: code }] },
        { type:"button", sub_type:"url", index:"0", parameters:[{ type:"text", text: code }] }
      ]
    }
  };
  const r = await fetch(endpoint, {
    method:"POST",
    headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "content-type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WA template ${r.status}`);
}
async function waSendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body } };
  const r = await fetch(endpoint, {
    method:"POST",
    headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "content-type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WA text ${r.status}`);
}

// ---------- PDF helpers ----------
async function fetchBytesFromUrl(urlStr) {
  const r = await fetch(urlStr, { cf:{ cacheEverything:true, cacheTtl:600 }});
  if (!r.ok) throw new Error(`fetch ${urlStr} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}
function drawText(page, text, x, y, opts) {
  const { font, size=10, color=rgb(0,0,0) } = opts||{};
  if (!text) return;
  page.drawText(String(text), { x, y, size, font, color });
}
function drawBBox(page, x, y, w, h) {
  page.drawRectangle({ x, y, width:w, height:h, borderColor:rgb(1,0,0), borderWidth:0.5, color:rgb(1,0,0), opacity:0.05 });
}

// === Your absolute XY positions (PDF user-space points). Pages are 1-indexed in your note; convert to 0-index here.
const MSA_POS = {
  p1_full_name: { page:0, x:125, y:180, size:11 },
  p1_passport:  { page:0, x:125, y:215, size:11 },
  p1_client:    { page:0, x:145, y:245, size:11 },
  p1_signature: { page:0, x:400, y:700, w:140, h:50 }, // image
  p4_full_name: { page:3, x:400, y:640, size:11 },
  p4_signature: { page:3, x:400, y:670, w:140, h:50 }, // image
  p4_date:      { page:3, x:360, y:700, size:11 },
};

const DO_POS = {
  holder:    { page:0, x: 60, y:145, size:11 },
  idnum:     { page:0, x: 65, y:200, size:11 },
  bank:      { page:0, x:100, y:245, size:11 },
  accno:     { page:0, x: 95, y:290, size:11 },
  accttype:  { page:0, x: 80, y:340, size:11 },
  debitday:  { page:0, x:150, y:395, size:11 },
  signature: { page:0, x:110, y:440, w:140, h:50 },
  date:      { page:0, x:100, y:480, size:11 },
  client:    { page:0, x:170, y:535, size:11 },
};

async function renderMSA(env, linkid, bbox=false) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status:404 });

  const id = String((linkid||"").split("_")[0]);
  const e = sess.edits || {};
  const name = e.full_name || "";
  const passport = e.passport || "";
  const dateStr = new Date().toLocaleDateString();

  const tpl = await fetchBytesFromUrl(env.SERVICE_PDF_KEY || DEFAULT_MSA_PDF);
  const pdf = await PDFDocument.load(tpl, { ignoreEncryption:true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  const D = (pos, val) => {
    const p = pages[pos.page]; if (bbox && pos.w && pos.h) drawBBox(p, pos.x, pos.y, pos.w, pos.h);
    drawText(p, val, pos.x, pos.y, { font, size: pos.size||11 });
  };

  // Page 1
  D(MSA_POS.p1_full_name, name);
  D(MSA_POS.p1_passport,  passport);
  D(MSA_POS.p1_client,    id);

  // Page 4
  D(MSA_POS.p4_full_name, name);
  D(MSA_POS.p4_date,      dateStr);

  // Signature (page1 + page4)
  if (sess.agreement_sig_key) {
    const sig = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sig) {
      const img = await pdf.embedPng(sig);
      const drawSig = (pos) => {
        const p = pages[pos.page];
        const { width, height } = img.scale(1);
        let w = pos.w, h = (height/width)*w;
        if (h > pos.h) { h = pos.h; w = (width/height)*h; }
        if (bbox) drawBBox(p, pos.x, pos.y, pos.w, pos.h);
        p.drawImage(img, { x:pos.x, y:pos.y, width:w, height:h });
      };
      drawSig(MSA_POS.p1_signature);
      drawSig(MSA_POS.p4_signature);
    }
  }

  const bytes = await pdf.save();
  return new Response(bytes, { headers:{ "content-type":"application/pdf", "cache-control":"no-store" }});
}

async function renderDO(env, linkid, bbox=false) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status:404 });
  const id = String((linkid||"").split("_")[0]);
  const d = sess.debit || {};
  const dateStr = new Date().toLocaleDateString();

  const tpl = await fetchBytesFromUrl(env.DEBIT_PDF_KEY || DEFAULT_DEBIT_PDF);
  const pdf = await PDFDocument.load(tpl, { ignoreEncryption:true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const D = (pos, val) => { const p = pages[pos.page]; drawText(p, val, pos.x, pos.y, { font, size:pos.size||11 }); if (bbox && pos.w && pos.h) drawBBox(p, pos.x, pos.y, pos.w, pos.h); };

  D(DO_POS.holder,   d.account_holder || "");
  D(DO_POS.idnum,    d.id_number || "");
  D(DO_POS.bank,     d.bank_name || "");
  D(DO_POS.accno,    d.account_number || "");
  D(DO_POS.accttype, (d.account_type||"").toString());
  D(DO_POS.debitday, (d.debit_day||"").toString());
  D(DO_POS.date,     dateStr);
  D(DO_POS.client,   id);

  if (sess.debit_sig_key) {
    const sig = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sig) {
      const img = await pdf.embedPng(sig);
      const pos = DO_POS.signature;
      const p = pages[pos.page];
      const { width, height } = img.scale(1);
      let w = pos.w, h = (height/width)*w;
      if (h > pos.h) { h = pos.h; w = (width/height)*h; }
      if (bbox) drawBBox(p, pos.x, pos.y, pos.w, pos.h);
      p.drawImage(img, { x:pos.x, y:pos.y, width:w, height:h });
    }
  }

  const bytes = await pdf.save();
  return new Response(bytes, { headers:{ "content-type":"application/pdf", "cache-control":"no-store" }});
}

// ---------- Admin UI ----------
function adminHTML() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding Admin</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
.card{background:#fff;max-width:1050px;margin:26px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px}
.logo{display:block;margin:0 auto 6px;max-width:120px}
h1{color:#e2001a;text-align:center;margin:.2em 0 .8em}
.tabs{display:flex;gap:.6em;flex-wrap:wrap;justify-content:center;margin:0 0 14px}
.tab{padding:.6em 1.1em;border-radius:999px;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
.tab.active{background:#e2001a;color:#fff}
.row{display:flex;gap:.6em}.row>*{flex:1}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.5em 1.1em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.45em 1.1em}
input{padding:.6em;border:1px solid #ddd;border-radius:.5em;width:100%}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:.55em .6em;border-bottom:1px solid #eee;text-align:left}
.small{font-size:12px;color:#666}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}">
  <h1>Admin Dashboard</h1>
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
const $ = s => document.querySelector(s);
const mk = h => { const d=document.createElement('div'); d.innerHTML=h; return d; };
const tabs=document.querySelectorAll('.tab'); const content=$('#content');
tabs.forEach(t=>t.onclick=()=>{ tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); load(t.dataset.tab); });
load('gen');

async function load(which){
  if(which==='gen'){
    content.innerHTML='';
    const v=mk('<div style="max-width:540px;margin:0 auto"><div class="row"><input id="id" placeholder="Splynx Lead/Customer ID"><button class="btn" id="go">Generate</button></div><div id="out" class="small" style="margin-top:.6em"></div></div>');
    v.querySelector('#go').onclick=async()=>{
      const raw=v.querySelector('#id').value||''; const id=raw.replace(/[\\u200B-\\u200D\\uFEFF]/g,'').replace(/\\D+/g,'');
      const out=v.querySelector('#out'); if(!id){ out.textContent='Please enter a numeric ID.'; return; }
      out.textContent='Working...';
      try{ const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}); const d=await r.json(); out.innerHTML=d.url?('<b>Onboarding link:</b> <a target="_blank" href="'+d.url+'">'+d.url+'</a>'):(d.error||'Failed'); }catch{ out.textContent='Network error.';}
    };
    content.appendChild(v); return;
  }
  if(which==='staff'){
    content.innerHTML='';
    const v=mk('<div style="max-width:540px;margin:0 auto"><div class="row"><input id="linkid" placeholder="Link ID, e.g. 319_ab12cd34"><button class="btn" id="go">Generate staff code</button></div><div id="out" class="small" style="margin-top:.6em"></div></div>');
    v.querySelector('#go').onclick=async()=>{
      const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out'); if(!linkid){ out.textContent='Enter linkid'; return; }
      out.textContent='Working...';
      try{ const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})}); const d=await r.json(); out.textContent=d.ok?('Staff code: '+d.code+' (valid 15 min)'):(d.error||'Failed'); }catch{ out.textContent='Network error.';}
    };
    content.appendChild(v); return;
  }
  if(['inprog','pending','approved'].includes(which)){
    content.innerHTML='Loading...';
    try{
      const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
      const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+(which==='pending'?'<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>':'<a class="btn-outline" target="_blank" href="/onboard/'+encodeURIComponent(i.linkid)+'">Open</a>')+' <button class="btn-outline" data-del="'+i.linkid+'">Delete</button></td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
      content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
      content.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this onboarding link and all files?')) return; b.disabled=true; await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:b.dataset.del})}); load(which); });
    }catch{ content.textContent='Failed to load.'; }
    return;
  }
}
</script>
</body></html>`;
}

function reviewHTML(sess, linkid) {
  const e = sess.edits||{};
  const ups = Array.isArray(sess.uploads)?sess.uploads:[];
  const upList = ups.length
    ? ups.map(u => `<li style="margin:.35em 0;padding:.45em .6em;border:1px solid #eee;border-radius:.6em"><b>${esc(u.label)}</b> — ${esc(u.name)} • ${Math.round((u.size||0)/1024)} KB  &nbsp; <a class="btn-outline" href="/api/admin/file?key=${encodeURIComponent(u.key)}" target="_blank">Download</a></li>`).join("")
    : `<div class="small">No files</div>`;

  const msa = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
  const doa = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
.card{background:#fff;max-width:980px;margin:26px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px}
h1{color:#e2001a;margin:.2em 0 .6em}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1.1em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.4em .9em;text-decoration:none}
.small{font-size:12px;color:#666}
</style></head><body><div class="card">
<h1>Review & Approve</h1>
<div class="small">Splynx ID: <b>${esc(sess.id)}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||"pending")}</b></div>

<h3>Edits</h3>
<pre style="background:#fafafa;border:1px solid #eee;border-radius:.6em;padding:.7em">${esc(
`full_name: ${e.full_name||""}
email: ${e.email||""}
billing_email: ${e.billing_email||e.email||""}
phone: ${e.phone||""}
passport: ${e.passport||""}
street: ${e.street||""}
city: ${e.city||""}
zip: ${e.zip||""}`)}</pre>

<h3>Uploads</h3>
<ul style="list-style:none;padding:0;margin:0">${upList}</ul>

<h3>Agreements</h3>
<ul>
  <li><a class="btn-outline" target="_blank" href="${msa}">MSA (PDF)</a> — <a class="small" target="_blank" href="${msa}?bbox=1">debug</a></li>
  <li><a class="btn-outline" target="_blank" href="${doa}">Debit Order (PDF)</a> — <a class="small" target="_blank" href="${doa}?bbox=1">debug</a></li>
</ul>

<div style="margin-top:14px">
  <button class="btn" id="approve">Approve & Push</button>
  <button class="btn-outline" id="reject">Reject</button>
  <button class="btn-outline" id="delete">Delete</button>
</div>
<div id="msg" class="small" style="margin-top:8px"></div>

<script>
const linkid=${JSON.stringify(linkid)};
const msg=document.getElementById('msg');
document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing to Splynx...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})}); const d=await r.json(); msg.textContent=d.ok?'Approved & pushed.':(d.error||'Failed'); }catch{ msg.textContent='Network error.'; } };
document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,reason})}); const d=await r.json(); msg.textContent=d.ok?'Rejected.':(d.error||'Failed'); }catch{ msg.textContent='Network error.';} };
document.getElementById('delete').onclick=async()=>{ if(!confirm('Delete this onboarding session and files?')) return; msg.textContent='Deleting...'; try{ await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})}); msg.textContent='Deleted.'; }catch{ msg.textContent='Delete failed'; } };
</script>
</div></body></html>`;
}

// ---------- Onboarding UI (client) ----------
function onboardingHTML(linkid) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vinet Client Onboarding</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
.card{background:#fff;max-width:720px;margin:26px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px}
.logo{display:block;margin:0 auto 10px;max-width:160px}
h2{color:#e2001a;margin:.2em 0 .4em}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.65em 1.6em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.55em 1.2em}
input,select,textarea{width:100%;padding:.65em;border:1px solid #ddd;border-radius:.5em}
.row{display:flex;gap:.7em}.row>*{flex:1}
.note{font-size:12px;color:#666}
.progressbar{height:7px;background:#eee;border-radius:5px;margin:10px 0 18px;overflow:hidden}
.progress{height:100%;background:#e2001a;transition:width .35s}
canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
.pills{display:flex;gap:.5em;flex-wrap:wrap;margin:.4em 0 .8em}
.pill{border:2px solid #e2001a;color:#e2001a;border-radius:999px;padding:.45em 1.1em;cursor:pointer}
.pill.active{background:#e2001a;color:#fff}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}">
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid=${JSON.stringify(linkid)};
  const stepEl=document.getElementById('step'); const progEl=document.getElementById('prog');
  let step=0; let state={ progress:0, edits:{}, uploads:[], pay_method:'eft' };
  const pct=()=> Math.min(100, Math.round(((step+1)/7)*100)); const setProg=()=> progEl.style.width=pct()+'%';
  const save=()=> fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{});
  function sigPad(canvas){ const ctx=canvas.getContext('2d'); let down=false,last=null,dirty=false;
    function resize(){ const sc=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*sc); canvas.height=Math.floor(r.height*sc); ctx.scale(sc,sc); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; } resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    const start=e=>{down=true; last=pos(e); e.preventDefault();}; const move=e=>{ if(!down) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }; const end=()=>{down=false; last=null;};
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  function step0(){ stepEl.innerHTML='<h2>Welcome</h2><p>We’ll quickly verify you and confirm a few details.</p><button class="btn" id="go">Let\\u2019s begin</button>'; document.getElementById('go').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); }; }

  async function sendOtp(){ const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp...';
    try{
      const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})}); const d=await r.json().catch(()=>({ok:false}));
      if(m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function step1(){
    stepEl.innerHTML='<h2>Verify your identity</h2><div class="pills"><span id="pwa" class="pill active">WhatsApp OTP</span><span id="pstaff" class="pill">I have a staff code</span></div><div id="wa"></div><div id="st" style="display:none"></div>';
    const wa=document.getElementById('wa'); wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="f" class="row" autocomplete="off"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required><button class="btn">Verify</button></form><a href="#" id="resend" class="btn-outline">Resend code</a>';
    sendOtp(); document.getElementById('resend').onclick=(e)=>{e.preventDefault();sendOtp();};
    document.getElementById('f').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };
    const st=document.getElementById('st'); st.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="sf" class="row" autocomplete="off"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required><button class="btn">Verify</button></form><div id="smsg" class="note"></div>';
    document.getElementById('sf').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('smsg').textContent='Invalid/expired staff code.'; } };
    const pwa=document.getElementById('pwa'), pst=document.getElementById('pstaff');
    pwa.onclick=()=>{pwa.classList.add('active');pst.classList.remove('active');wa.style.display='block';st.style.display='none';};
    pst.onclick=()=>{pst.classList.add('active');pwa.classList.remove('active');wa.style.display='none';st.style.display='block';};
  }

  function step2(){
    const pay=state.pay_method||'eft';
    stepEl.innerHTML='<h2>Payment Method</h2><div class="pills"><span id="eft" class="pill '+(pay==='eft'?'active':'')+'">EFT</span><span id="deb" class="pill '+(pay==='debit'?'active':'')+'">Debit order</span></div><div id="eftbox"></div><div id="debox"></div><div class="row" style="margin-top:.8em"><a class="btn-outline" id="back">Back</a><button class="btn" id="next">Continue</button></div>';
    const showEFT=()=>{ const id=(linkid||'').split('_')[0]; const b=document.getElementById('eftbox'); const d=document.getElementById('debox'); b.style.display='block'; d.style.display='none'; b.innerHTML='<div class="row"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div></div><div class="row"><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div></div><div><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"></div><div style="margin-top:.6em;text-align:center"><a class="btn-outline" target="_blank" href="/info/eft?id='+id+'">Print banking details</a></div>'; };
    let pad=null;
    const showDebit=()=>{ const b=document.getElementById('debox'); const e=state.debit||{}; const d=document.getElementById('eftbox'); d.style.display='none'; b.style.display='block'; b.innerHTML='<div class="row"><div><label>Bank Account Holder Name</label><input id="d_holder" value="'+(e.account_holder||'')+'"></div><div><label>Bank Account Holder ID no</label><input id="d_id" value="'+(e.id_number||'')+'"></div></div><div class="row"><div><label>Bank</label><input id="d_bank" value="'+(e.bank_name||'')+'"></div><div><label>Bank Account No</label><input id="d_acc" value="'+(e.account_number||'')+'"></div></div><div class="row"><div><label>Bank Account Type</label><select id="d_type"><option value="Cheque / Current" '+((e.account_type||'')==='Cheque / Current'?'selected':'')+'>Cheque / Current</option><option value="Savings" '+((e.account_type||'')==='Savings'?'selected':'')+'>Savings</option><option value="Transmission" '+((e.account_type||'')==='Transmission'?'selected':'')+'>Transmission</option></select></div><div><label>Debit Order Date</label><select id="d_day">'+[1,7,15,25,29,30].map(x=>'<option '+((e.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join('')+'</select></div></div><div class="note" id="terms">Loading terms...</div><label style="display:flex;align-items:center;gap:.5em;margin-top:.6em"><input id="agree" type="checkbox"> I agree to the Debit Order terms</label><div style="margin-top:.6em"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clear">Clear</a><span id="dmsg" class="note"></span></div></div>';
      fetch('/api/terms?kind=debit').then(r=>r.text()).then(t=>{document.getElementById('terms').innerHTML=t||'Terms not available.';}).catch(()=>{document.getElementById('terms').textContent='Terms unavailable.';});
      pad = sigPad(document.getElementById('sig')); document.getElementById('clear').onclick=(e)=>{e.preventDefault(); pad.clear();};
    };
    document.getElementById('eft').onclick=()=>{state.pay_method='eft'; showEFT(); save();};
    document.getElementById('deb').onclick=()=>{state.pay_method='debit'; showDebit(); save();};
    if (pay==='debit') showDebit(); else showEFT();

    document.getElementById('back').onclick=(e)=>{e.preventDefault(); step=1; state.progress=step; setProg(); save(); render();};
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      if(state.pay_method==='debit'){
        const msg=document.getElementById('dmsg');
        if(!document.getElementById('agree').checked){ msg.textContent='Please agree to the terms.'; return; }
        if(!pad || pad.isEmpty()){ msg.textContent='Please add your signature.'; return; }
        state.debit={
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed: true
        };
        try{
          const id=(linkid||'').split('_')[0];
          await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...state.debit, splynx_id:id})});
          await fetch('/api/debit/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid, dataUrl:pad.dataURL()})});
        }catch{}
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id)); const p=await r.json();
        const cur={ full_name:state.edits.full_name ?? p.full_name ?? '', email:state.edits.email ?? p.email ?? '', billing_email:state.edits.billing_email ?? p.billing_email ?? p.email ?? '', phone:state.edits.phone ?? p.phone ?? '', passport:state.edits.passport ?? p.passport ?? '', street:state.edits.street ?? p.street ?? '', city:state.edits.city ?? p.city ?? '', zip:state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML='<div class="row"><div><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"></div><div><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"></div></div><div class="row"><div><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"></div><div><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"></div></div><div class="row"><div><label>Billing email</label><input id="f_bemail" value="'+(cur.billing_email||'')+'"></div><div><label>City</label><input id="f_city" value="'+(cur.city||'')+'"></div></div><div class="row"><div><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"></div><div><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"></div></div><div class="row" style="margin-top:.6em"><a class="btn-outline" id="back">Back</a><button class="btn" id="next">Continue</button></div>';
        document.getElementById('back').onclick=(e)=>{e.preventDefault(); step=2; state.progress=step; setProg(); save(); render();};
        document.getElementById('next').onclick=(e)=>{e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), billing_email:document.getElementById('f_bemail').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML='<h2>Upload documents</h2><div class="note">Please upload your ID and Proof of Address (max 2 files, 5MB each).</div><div class="row"><input id="f1" type="file" accept=".png,.jpg,.jpeg,.pdf,image/*"><input id="f2" type="file" accept=".png,.jpg,.jpeg,.pdf,image/*"></div><div id="umsg" class="note" style="margin-top:.4em"></div><div class="row" style="margin-top:.6em"><a class="btn-outline" id="back">Back</a><button class="btn" id="next">Continue</button></div>';
    document.getElementById('back').onclick=(e)=>{e.preventDefault(); step=3; state.progress=step; setProg(); save(); render();};
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault(); const msg=document.getElementById('umsg');
      async function up(file,label){ if(!file) return null; if(file.size>5*1024*1024){ msg.textContent='Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf=await file.arrayBuffer(); const name=(file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r=await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label),{method:'POST',body:buf});
        const d=await r.json().catch(()=>({ok:false})); if(!d.ok) throw new Error('upload failed'); return { key:d.key, name, size:file.size, label };
      }
      try{ msg.textContent='Uploading...'; const u1=await up(document.getElementById('f1').files[0],'ID Document'); const u2=await up(document.getElementById('f2').files[0],'Proof of Address'); state.uploads=[u1,u2].filter(Boolean); msg.textContent='Uploaded.'; step=5; state.progress=step; setProg(); save(); render(); }catch{ if(!msg.textContent) msg.textContent='Upload failed.'; }
    };
  }

  function step5(){
    stepEl.innerHTML='<h2>Master Service Agreement</h2><div id="terms" class="note" style="background:#fafafa;border:1px solid #eee;border-radius:.6em;padding:1em;max-height:280px;overflow:auto;margin-bottom:.6em">Loading terms…</div><label style="display:flex;align-items:center;gap:.55em;margin:.2em 0 .6em"><input id="agree" type="checkbox"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label><div><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clear">Clear</a><span class="note" id="smsg"></span></div></div><div class="row" style="margin-top:.6em"><a class="btn-outline" id="back">Back</a><button class="btn" id="sign">Agree & Sign</button></div>';
    fetch('/api/terms?kind=service').then(r=>r.text()).then(t=>{document.getElementById('terms').innerHTML=t||'Terms unavailable.';}).catch(()=>{document.getElementById('terms').textContent='Terms unavailable.';});
    const pad=sigPad(document.getElementById('sig')); document.getElementById('clear').onclick=(e)=>{e.preventDefault(); pad.clear();};
    document.getElementById('back').onclick=(e)=>{e.preventDefault(); step=4; state.progress=step; setProg(); save(); render();};
    document.getElementById('sign').onclick=async(e)=>{e.preventDefault(); const m=document.getElementById('smsg'); if(!document.getElementById('agree').checked){ m.textContent='Please tick the checkbox.'; return; } if(pad.isEmpty()){ m.textContent='Please add your signature.'; return; } m.textContent='Saving...';
      try{ const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl:pad.dataURL()})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { m.textContent=d.error||'Failed'; } }catch{ m.textContent='Network error.'; }
    };
  }

  function step6(){
    const debit=(state.pay_method==='debit');
    stepEl.innerHTML='<h2>All set!</h2><p>Thanks — we’ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p><hr style="border:none;border-top:1px solid #e6e6e6;margin:14px 0"><div class="note">Your agreements (available immediately after signing)</div><ul><li><a target="_blank" href="/agreements/pdf/msa/'+linkid+'">Master Service Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/msa/'+linkid+'?bbox=1">debug</a></li>'+ (debit?'<li><a target="_blank" href="/agreements/pdf/debit/'+linkid+'">Debit Order Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/debit/'+linkid+'?bbox=1">debug</a></li>':'') +'</ul>';
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Admin UI
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      return new Response(adminHTML(), { headers:{ "content-type":"text/html; charset=utf-8" }});
    }
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status:404 });
      return new Response(reviewHTML(sess, linkid), { headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    // Info: EFT printable
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EFT Payment Details</title>
      <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;background:#f7f7fa}.card{max-width:900px;margin:36px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}h1{color:#e2001a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:720px){.grid{grid-template-columns:1fr}}input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;background:#fafafa}.logo{display:block;margin:0 auto 6px;height:68px}.btn{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;font-weight:700}</style></head><body><div class="card"><img class="logo" src="${LOGO_URL}"><h1>EFT Payment Details</h1><div class="grid"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div><div style="grid-column:1 / -1"><label><b>Reference</b></label><input readonly style="font-weight:900" value="${esc(id)}"></div></div><div style="margin-top:14px"><button class="btn" onclick="window.print()">Print</button></div></div></body></html>`;
      return new Response(html, { headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    // Terms text proxy
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind")||"").toLowerCase();
      const serviceUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debitUrl   = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      const u = kind==="debit" ? debitUrl : serviceUrl;
      try { const r = await fetch(u,{ cf:{ cacheEverything:true, cacheTtl:300 }}); const t = r.ok ? await r.text() : ""; return new Response(`<pre style="white-space:pre-wrap">${esc(t)}</pre>`, { headers:{ "content-type":"text/html; charset=utf-8" }}); }
      catch { return new Response("<p>Terms unavailable.</p>", { headers:{ "content-type":"text/html; charset=utf-8" }}); }
    }

    // Generate onboarding link (admin)
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { id: raw } = await request.json().catch(()=> ({}));
      const id = onlyDigits(raw);
      if (!id) return json({ error:"Missing/invalid id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created:Date.now(), progress:0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Staff OTP
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { linkid } = await request.json().catch(()=> ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // OTP send/verify
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=> ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid||"").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchMsisdn(env, splynxId); } catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      try {
        await waSendTemplate(env, msisdn, code, "en");
        return json({ ok:true });
      } catch {
        try {
          await waSendText(env, msisdn, 'Your Vinet verification code is: ' + code);
          return json({ ok:true, note:"sent-as-text" });
        } catch {
          return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502);
        }
      }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=> ({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true, last_time:Date.now() }), { expirationTtl:86400 });
        if (kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Onboarding UI page
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = decodeURIComponent(path.split("/")[2]||"");
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status:404 });
      return new Response(onboardingHTML(linkid), { headers:{ "content-type":"text/html; charset=utf-8" }});
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=> ({}));
      const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, ...body, last_time:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads to R2
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid")||"";
      const filename = (url.searchParams.get("filename")||"file.bin").replace(/[^a-z0-9_.-]/gi,'_');
      const label = url.searchParams.get("label") || "file";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Invalid link" }, 404);
      const buf = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, buf);
      const uploads = Array.isArray(sess.uploads)?sess.uploads:[];
      uploads.push({ key, name:filename, size:buf.byteLength, label });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl:86400 });
      return json({ ok:true, key });
    }

    // Agreement signatures
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=> ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, png.buffer, { httpMetadata:{ contentType:"image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending", last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true, sigKey });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=> ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, png.buffer, { httpMetadata:{ contentType:"image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey, last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true, sigKey });
    }
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=> ({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k]||String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      // store under KV for record (not tied to link)
      const key = `debit/${onlyDigits(b.splynx_id||"unknown")}/${Date.now()}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, created:Date.now() }), { expirationTtl: 60*60*24*90 });
      return json({ ok:true });
    }

    // Agreements (PDF)
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkidRaw] = path.split("/");
      const linkid = decodeURIComponent(linkidRaw||"");
      const bbox = url.searchParams.get("bbox")==="1";
      if (!linkid) return new Response("Missing linkid", { status:400 });
      if (type==="msa") return renderMSA(env, linkid, bbox);
      if (type==="debit") return renderDO(env, linkid, bbox);
      return new Response("Unknown type", { status:404 });
    }

    // Admin: list
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix:"onboard/", limit:1000 });
      const items=[];
      for (const k of list.keys||[]) {
        const s = await env.ONBOARD_KV.get(k.name, "json"); if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode==="inprog"   && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode==="pending"  && s.status==="pending") items.push({ linkid, id:s.id, updated });
        if (mode==="approved" && s.status==="approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=> b.updated-a.updated);
      return json({ items });
    }

    // Admin: delete (also remove files)
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { linkid } = await request.json().catch(()=> ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      await env.ONBOARD_KV.delete(`onboard/${linkid}`);
      // R2 cleanup
      const prefixes = [`uploads/${linkid}/`, `agreements/${linkid}/`, `debit_agreements/${linkid}/`];
      for (const pfx of prefixes) {
        try { const l = await env.R2_UPLOADS.list({ prefix:pfx }); for (const o of l.objects||[]) await env.R2_UPLOADS.delete(o.key); } catch {}
      }
      return json({ ok:true });
    }

    // Admin: file download (R2 proxy)
    if (path === "/api/admin/file" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const key = url.searchParams.get("key")||"";
      if (!key) return new Response("Missing key", { status:400 });
      const obj = await env.R2_UPLOADS.get(key);
      if (!obj) return new Response("Not found", { status:404 });
      const headers = new Headers(obj.httpMetadata || {});
      headers.set("content-type", headers.get("content-type") || "application/octet-stream");
      headers.set("content-disposition", `inline; filename="${key.split("/").pop()}"`);
      return new Response(obj.body, { headers });
    }

    // Splynx profile (for prefill)
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = onlyDigits(url.searchParams.get("id")||"");
      if (!id) return json({ error:"Missing id" }, 400);
      try { const p = await fetchProfile(env, id); return json(p); } catch { return json({ error:"Lookup failed" }, 502); }
    }

    // Admin: reject / approve
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { linkid, reason } = await request.json().catch(()=> ({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { linkid } = await request.json().catch(()=> ({}));
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);

      const id = onlyDigits(sess.id||"");
      const edits = sess.edits || {};
      const isCustomer = !!(await (async()=>{try{await splynxGET(env, `/api/2.0/admin/customers/customer/${id}`); return true;}catch{return false;}})());

      // 1) Update email + billing_email, phone, city/zip/passport where possible
      try {
        if (isCustomer) {
          const patch = {};
          if (edits.email) patch.email = edits.email;
          if (edits.billing_email || edits.email) patch.billing_email = edits.billing_email || edits.email;
          if (edits.phone) patch.phone = edits.phone;
          if (Object.keys(patch).length) await splynxPUT(env, `/api/2.0/admin/customers/customer/${id}`, patch);
          const infoPatch = {};
          if (edits.passport) infoPatch.passport = edits.passport;
          if (Object.keys(infoPatch).length) await splynxPUT(env, `/api/2.0/admin/customers/customer-info/${id}`, infoPatch);
        } else {
          const patch = {};
          if (edits.email) patch.email = edits.email;
          if (edits.billing_email || edits.email) patch.billing_email = edits.billing_email || edits.email;
          if (edits.phone) patch.phone = edits.phone;
          if (edits.street) patch.street_1 = edits.street;
          if (edits.city) patch.city = edits.city;
          if (edits.zip) patch.zip_code = edits.zip;
          if (Object.keys(patch).length) await splynxPUT(env, `/api/2.0/admin/crm/leads/${id}`, patch);
        }
      } catch (e) {
        // non-fatal: continue to documents
      }

      // 2) Generate PDFs (bytes)
      const msaResp = await renderMSA(env, linkid, false);
      const msaBytes = new Uint8Array(await msaResp.arrayBuffer());
      const doBytes = (sess.debit_sig_key ? new Uint8Array(await (await renderDO(env, linkid, false)).arrayBuffer()) : null);

      // 3) Upload documents (tries modern + legacy path)
      async function uploadDoc(kind, docTitle, bytes, name) {
        if (!bytes) return;
        const fd = new FormData();
        fd.append("type", "contract"); // required by Splynx docs
        fd.append("title", docTitle);
        fd.append("visible_by_customer", "0");
        fd.append("description", "");
        fd.append("file", new Blob([bytes], { type:"application/pdf" }), name);

        if (kind==="customer") {
          try { await splynxPOSTMultipart(env, `/api/2.0/admin/customers/customer/${id}/documents`, fd); }
          catch { await splynxPOSTMultipart(env, `/api/2.0/admin/customers/${id}/documents`, fd); }
        } else {
          await splynxPOSTMultipart(env, `/api/2.0/admin/crm/leads/${id}/documents`, fd);
        }
      }
      try {
        const kind = isCustomer ? "customer" : "lead";
        await uploadDoc(kind, "MSA", msaBytes, `MSA_${id}_${linkid.split("_")[1]}.pdf`);
        if (doBytes) await uploadDoc(kind, "Debit Order", doBytes, `Debit_${id}_${linkid.split("_")[1]}.pdf`);
      } catch (e) {
        // allow approve even if docs fail — but report error in response
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", last_time:Date.now() }), { expirationTtl:86400 });
        return json({ ok:false, error:"Approved but document upload failed" });
      }

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    return new Response("Not found", { status:404 });
  }
};
