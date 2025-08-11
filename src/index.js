// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, EFT & Debit Order pages
// Matches your screenshots/flow exactly.
//
// Notes:
// • Admin "/" shows tabs: 1) Generate onboarding link  2) Generate verification code
//                         3) Pending (in-progress)  4) Completed (awaiting approval)  5) Approved
// • Pending:    list + Open + Delete (soft delete only — hidden from lists; no file purge)
// • Completed:  Review page with: MSA/DO links, uploads list, editable fields, Approve & Push
// • Approved:   shows pushed sessions with documents
// • Prefill from Splynx: includes passport from /admin/customers/customer-info/:id
// • Lead endpoints use /admin/crm/leads/:id  (correct path)
// • PDFs are stamped with your exact XY
// • Admin & /r2 are IP-restricted with a friendly message page
//
// ENV expected:
//   SPLYNX_API (e.g. https://splynx.example.com/api/2.0)
//   SPLYNX_AUTH (Basic base64(user:token))
//   R2_UPLOADS (R2 bucket binding)
//   ONBOARD_KV (KV binding)
//   TERMS_SERVICE_URL, TERMS_DEBIT_URL (optional text URLs)
//   SERVICE_PDF_KEY, DEBIT_PDF_KEY (optional PDF template URLs in R2 or HTTP URLs)
//   PHONE_NUMBER_ID, WHATSAPP_TOKEN, WHATSAPP_TEMPLATE_NAME (optional for OTP WhatsApp)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const DEFAULT_MSA_PDF   = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DEFAULT_DEBIT_PDF = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";

// ---------------- IP gate ----------------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143; // 160.226.128.0/20
}
function restrictedHTML() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Restricted</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#222;margin:0}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:18px;box-shadow:0 2px 12px #0002;padding:24px 26px;text-align:center}
.logo{height:70px;display:block;margin:0 auto 12px} h1{color:#e2001a} .note{color:#666}</style>
<div class="card"><img class="logo" src="${LOGO_URL}" alt><h1>Access restricted</h1>
<p class="note">The admin dashboard is only available on the Vinet office network.<br/>If you believe this is an error, please contact the team.</p></div>`;
}

// ---------------- Small utils ----------------
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });
const esc = (s) => String(s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[m]));

// ---------------- Splynx helpers ----------------
async function splynxGET(env, ep) {
  const r = await fetch(env.SPLYNX_API + ep, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` } });
  if (!r.ok) throw new Error(`GET ${ep} ${r.status}`);
  return r.json();
}
async function splynxPATCH(env, ep, data) {
  const r = await fetch(env.SPLYNX_API + ep, {
    method:"PATCH",
    headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}`, "content-type":"application/json" },
    body: JSON.stringify(data||{})
  });
  if (!r.ok) throw new Error(`PATCH ${ep} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}
async function splynxUploadDoc(env, type, id, filename, bytes, contentType="application/pdf") {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type: contentType }), filename);
  const ep = (type==="lead") ? `/admin/crm/leads/${id}/documents` : `/admin/customers/customer/${id}/documents`;
  const r = await fetch(env.SPLYNX_API + ep, { method:"POST", headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }, body: fd });
  if (!r.ok) throw new Error(`UPLOAD ${ep} ${r.status}`);
}
async function detectLeadOrCustomer(env, id) {
  try { await splynxGET(env, `/admin/crm/leads/${id}`); return "lead"; }
  catch { try { await splynxGET(env, `/admin/customers/customer/${id}`); return "customer"; } catch { return null; } }
}
// For prefill (passport)
async function fetchProfileForOnboarding(env, id) {
  let lead=null, customer=null, custInfo=null, contacts=null;
  try { customer = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!customer) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  const src = customer || lead || {};
  // quick phone pick
  const phone = (() => {
    const ok = v => /^27\d{8,13}$/.test(String(v||"").trim());
    const tryKeys = ["phone_mobile","mobile","phone","whatsapp","msisdn","primary_phone","contact_number","billing_phone"];
    for (const k of tryKeys) if (ok(src[k])) return String(src[k]).trim();
    if (Array.isArray(contacts)) for (const c of contacts) for (const k of tryKeys) if (ok(c[k])) return String(c[k]).trim();
    return "";
  })();
  const street = src.street || src.address || (src.addresses && (src.addresses.street||src.addresses.address_1)) || "";
  const city   = src.city   || (src.addresses && src.addresses.city) || "";
  const zip    = src.zip    || src.zip_code || (src.addresses && (src.addresses.zip||src.addresses.zip_code)) || "";
  const passport = (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) || src.passport || src.id_number || "";
  return {
    kind: customer ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone, street, city, zip, passport
  };
}

// ---------------- R2 helpers ----------------
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}
async function fetchBytesFromUrl(urlStr) {
  const r = await fetch(urlStr, { cf:{ cacheEverything:true, cacheTtl:600 } });
  if (!r.ok) throw new Error(`fetch ${urlStr} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------------- PDF placement (YOUR XY) ----------------
// Coordinates are PDF points from bottom-left.
const MSA_POS = {
  p1: {
    full_name:   { x:125, y:180, size:12, w:260 },
    id_passport: { x:125, y:215, size:12, w:260 },
    client_code: { x:145, y:245, size:12, w:220 },
    signature:   { x:400, y:700, w:180, h:45 }
  },
  p4: {
    full_name:   { x:400, y:640, size:12, w:200 },
    signature:   { x:400, y:670, w:180, h:45 },
    date:        { x:360, y:700, size:12, w:140 }
  }
};
const DEBIT_POS = {
  account_holder: { x: 60, y:145, size:12, w:260 },
  holder_id:      { x: 65, y:200, size:12, w:260 },
  bank:           { x:100, y:245, size:12, w:220 },
  account_no:     { x: 95, y:290, size:12, w:220 },
  account_type:   { x: 80, y:340, size:12, w:200 },
  debit_date:     { x:150, y:395, size:12, w:120 },
  signature:      { x:110, y:440, w:160, h:40 },
  date:           { x:100, y:480, size:12, w:160 },
  client_code:    { x:170, y:535, size:12, w:180 }
};
function drawText(page, value, x, y, { font, size=12, color=rgb(0,0,0), maxWidth=null, lineHeight=1.2 } = {}) {
  const s = String(value ?? "");
  if (!maxWidth) { page.drawText(s, { x, y, size, font, color }); return; }
  const words = s.split(/\s+/); let line="", cy=y;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) { line = t; continue; }
    if (line) page.drawText(line, { x, y: cy, size, font, color });
    line = w; cy -= size*lineHeight;
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color });
}
function bbox(page, x, y, w, h) {
  page.drawRectangle({ x, y, width:w, height:h, borderWidth:0.7, borderColor:rgb(1,0,0), color:rgb(1,0,0), opacity:0.06 });
}

// ---------------- PDF renderers ----------------
async function renderMSA(env, linkid, showBBox) {
  const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status:404 });

  const tpl = env.SERVICE_PDF_KEY
    ? await (env.SERVICE_PDF_KEY.startsWith("http") ? fetchBytesFromUrl(env.SERVICE_PDF_KEY) : fetchR2Bytes(env, env.SERVICE_PDF_KEY))
    : await fetchBytesFromUrl(DEFAULT_MSA_PDF);

  const pdf = await PDFDocument.load(tpl);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  const e = sess.edits || {};
  const idOnly = (linkid.split("_")[0]||"").trim();

  // Page 1
  {
    const p = pages[0];
    if (showBBox) bbox(p, MSA_POS.p1.full_name.x, MSA_POS.p1.full_name.y-10, MSA_POS.p1.full_name.w, 14);
    drawText(p, e.full_name || "", MSA_POS.p1.full_name.x, MSA_POS.p1.full_name.y, { font, size:MSA_POS.p1.full_name.size, maxWidth:MSA_POS.p1.full_name.w });

    if (showBBox) bbox(p, MSA_POS.p1.id_passport.x, MSA_POS.p1.id_passport.y-10, MSA_POS.p1.id_passport.w, 14);
    drawText(p, e.passport || "", MSA_POS.p1.id_passport.x, MSA_POS.p1.id_passport.y, { font, size:MSA_POS.p1.id_passport.size, maxWidth:MSA_POS.p1.id_passport.w });

    if (showBBox) bbox(p, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y-10, MSA_POS.p1.client_code.w, 14);
    drawText(p, idOnly, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y, { font, size:MSA_POS.p1.client_code.size, maxWidth:MSA_POS.p1.client_code.w });

    if (sess.agreement_sig_key) {
      const sig = await fetchR2Bytes(env, sess.agreement_sig_key);
      if (sig) {
        const img = await pdf.embedPng(sig);
        const f = MSA_POS.p1.signature;
        if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
        const wh = img.scale(1); let w=f.w, h=wh.height/wh.width*w; if (h>f.h){ h=f.h; w=wh.width/wh.height*h; }
        p.drawImage(img, { x:f.x, y:f.y, width:w, height:h });
      }
    }
  }

  // Page 4
  if (pages.length >= 4) {
    const p = pages[3];
    if (showBBox) bbox(p, MSA_POS.p4.full_name.x, MSA_POS.p4.full_name.y-10, MSA_POS.p4.full_name.w, 14);
    drawText(p, e.full_name || "", MSA_POS.p4.full_name.x, MSA_POS.p4.full_name.y, { font, size:MSA_POS.p4.full_name.size, maxWidth:MSA_POS.p4.full_name.w });

    if (sess.agreement_sig_key) {
      const sig = await fetchR2Bytes(env, sess.agreement_sig_key);
      if (sig) {
        const img = await pdf.embedPng(sig);
        const f = MSA_POS.p4.signature;
        if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
        const wh = img.scale(1); let w=f.w, h=wh.height/wh.width*w; if (h>f.h){ h=f.h; w=wh.width/wh.height*h; }
        p.drawImage(img, { x:f.x, y:f.y, width:w, height:h });
      }
    }

    if (showBBox) bbox(p, MSA_POS.p4.date.x, MSA_POS.p4.date.y-10, MSA_POS.p4.date.w, 14);
    drawText(p, new Date(sess.last_time || Date.now()).toLocaleDateString("en-ZA"),
      MSA_POS.p4.date.x, MSA_POS.p4.date.y, { font, size:MSA_POS.p4.date.size, maxWidth:MSA_POS.p4.date.w });
  }

  const out = await pdf.save();
  return new Response(out, { headers:{ "content-type":"application/pdf", "cache-control":"no-store" } });
}
async function renderDEBIT(env, linkid, showBBox) {
  const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
  if (!sess) return new Response("Not found", { status:404 });

  const tpl = env.DEBIT_PDF_KEY
    ? await (env.DEBIT_PDF_KEY.startsWith("http") ? fetchBytesFromUrl(env.DEBIT_PDF_KEY) : fetchR2Bytes(env, env.DEBIT_PDF_KEY))
    : await fetchBytesFromUrl(DEFAULT_DEBIT_PDF);

  const pdf = await PDFDocument.load(tpl);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.getPages()[0];

  const d = sess.debit || {};
  const idOnly = (linkid.split("_")[0]||"").trim();

  const put = (f, val) => { if (showBBox) bbox(p, f.x, f.y-10, f.w||80, 14); drawText(p, val||"", f.x, f.y, { font, size:f.size||12, maxWidth:f.w||null }); };

  put(DEBIT_POS.account_holder, d.account_holder);
  put(DEBIT_POS.holder_id,      d.id_number || d.holder_id);
  put(DEBIT_POS.bank,           d.bank_name || d.bank);
  put(DEBIT_POS.account_no,     d.account_number || d.account_no);
  put(DEBIT_POS.account_type,   d.account_type);
  put(DEBIT_POS.debit_date,     d.debit_day || d.debit_date);
  put(DEBIT_POS.client_code,    idOnly);
  put(DEBIT_POS.date,           new Date(sess.last_time || Date.now()).toLocaleDateString("en-ZA"));

  if (sess.debit_sig_key) {
    const sig = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sig) {
      const img = await pdf.embedPng(sig);
      const f = DEBIT_POS.signature;
      if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
      const wh = img.scale(1); let w=f.w, h=wh.height/wh.width*w; if (h>f.h){ h=f.h; w=wh.width/wh.height*h; }
      p.drawImage(img, { x:f.x, y:f.y, width:w, height:h });
    }
  }

  const out = await pdf.save();
  return new Response(out, { headers:{ "content-type":"application/pdf", "cache-control":"no-store" } });
}

// ---------------- Admin UI (HTML + JS) ----------------
function adminHTML() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:1000px;margin:28px auto;border-radius:20px;box-shadow:0 2px 12px #0002;padding:22px}
  .logo{display:block;margin:0 auto 8px;height:68px}
  h1{color:#e2001a;text-align:center}
  .tabs{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:8px 0 18px}
  .tab{padding:.55em 1em;border-radius:.9em;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
  .tab.active{background:#e2001a;color:#fff}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.5em 1em;cursor:pointer}
  .btn.outl{background:#fff;color:#e2001a;border:2px solid #e2001a}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:9px;border-bottom:1px solid #eee;text-align:left}
  .note{color:#666;font-size:12px} .row{display:flex;gap:10px;align-items:center}
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt>
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
(function(){
  const tabs=[...document.querySelectorAll('.tab')];
  const content=document.getElementById('content');
  const node=html=>{const d=document.createElement('div'); d.innerHTML=html; return d;};
  tabs.forEach(t=>t.onclick=()=>{ tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); load(t.dataset.tab); });
  load('gen');

  async function load(which){
    if(which==='gen'){
      content.innerHTML='';
      const v=node('<div style="max-width:640px;margin:0 auto"><div class="row"><input id="id" placeholder="Splynx Lead/Customer ID"/><button class="btn" id="go">Generate</button></div><div id="out" class="note" style="margin-top:8px"></div></div>');
      v.querySelector('#go').onclick=async()=>{
        const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
        if(!id){out.textContent='Enter an ID.';return;}
        out.textContent='Working...';
        const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML = d.url ? '<b>Onboarding link:</b> <a target="_blank" href="'+d.url+'">'+d.url+'</a>' : (d.error||'Failed');
      };
      content.appendChild(v); return;
    }
    if(which==='staff'){
      content.innerHTML='';
      const v=node('<div style="max-width:640px;margin:0 auto"><div class="row"><input id="linkid" placeholder="linkid e.g. 319_ab12cd34"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="note" style="margin-top:8px"></div></div>');
      v.querySelector('#go').onclick=async()=>{
        const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
        if(!linkid){out.textContent='Enter linkid';return;}
        out.textContent='Working...';
        const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
        const d=await r.json().catch(()=>({}));
        out.innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error||'Failed');
      };
      content.appendChild(v); return;
    }
    if(['inprog','pending','approved'].includes(which)){
      content.innerHTML='Loading...';
      try{
        const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
        const rows=(d.items||[]).map(i=>{
          const action = which==='inprog'
            ? '<a class="btn outl" target="_blank" href="/onboard/'+i.linkid+'">Open</a> <button class="btn" data-del="'+i.linkid+'">Delete</button>'
            : (which==='pending'
              ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
              : '<a class="btn outl" target="_blank" href="/agreements/pdf/msa/'+i.linkid+'">MSA</a>' + (i.has_debit ? ' <a class="btn outl" target="_blank" href="/agreements/pdf/debit/'+i.linkid+'">DO</a>' : '')
            );
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+action+'</td></tr>';
        }).join('') || '<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML='<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        content.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
          if(!confirm('Delete '+b.dataset.del+' ?'))return;
          await fetch('/api/admin/session/'+b.dataset.del,{method:'DELETE'});
          load(which);
        });
      }catch{ content.innerHTML='Failed to load.'; }
      return;
    }
  }
})();
</script>`;
}
function reviewHTML(linkid, sess, uploads) {
  const e = sess.edits || {};
  const upList = uploads.length
    ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><a target="_blank" href="/r2/${encodeURIComponent(u.key)}">${esc(u.key.split('/').pop())}</a> <span style="color:#666">(${Math.round((u.size||0)/1024)} KB)</span></li>`).join("")}</ul>`
    : `<div class="note">No files uploaded.</div>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:900px;margin:26px auto;border-radius:18px;box-shadow:0 2px 12px #0002;padding:18px 22px}
  h1,h2{color:#e2001a}.row{display:flex;gap:10px}.row>*{flex:1}.field{margin:.6em 0}
  input{width:100%;padding:.6em;border:1px solid #ddd;border-radius:.5em}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
  .btn.outl{background:#fff;color:#e2001a;border:2px solid #e2001a}.note{color:#666;font-size:12px}
</style>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id||"")}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||"")}</b></div>
  <h2>Documents</h2>
  <div class="row">
    <a class="btn outl" target="_blank" href="/agreements/pdf/msa/${esc(linkid)}">MSA (PDF)</a>
    ${sess.debit_sig_key?`<a class="btn outl" target="_blank" href="/agreements/pdf/debit/${esc(linkid)}">Debit Order (PDF)</a>`:""}
  </div>
  <h2>Uploads</h2>
  ${upList}
  <h2>Edit details</h2>
  <div class="row">
    <div class="field"><label>Full name</label><input id="f_full" value="${esc(e.full_name||"")}"></div>
    <div class="field"><label>ID / Passport</label><input id="f_pass" value="${esc(e.passport||"")}"></div>
  </div>
  <div class="row">
    <div class="field"><label>Email</label><input id="f_email" value="${esc(e.email||"")}"></div>
    <div class="field"><label>Phone</label><input id="f_phone" value="${esc(e.phone||"")}"></div>
  </div>
  <div class="row">
    <div class="field"><label>Street</label><input id="f_street" value="${esc(e.street||"")}"></div>
    <div class="field"><label>City</label><input id="f_city" value="${esc(e.city||"")}"></div>
  </div>
  <div class="field"><label>ZIP</label><input id="f_zip" value="${esc(e.zip||"")}"></div>
  <div class="row" style="margin-top:10px">
    <button class="btn outl" id="save">Save</button>
    <button class="btn" id="push">Approve & Push</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const linkid=${JSON.stringify(linkid)};
  const msg=document.getElementById('msg');
  document.getElementById('save').onclick=async()=>{
    msg.textContent='Saving...';
    const body={ edits:{
      full_name:document.getElementById('f_full').value.trim(),
      passport: document.getElementById('f_pass').value.trim(),
      email:    document.getElementById('f_email').value.trim(),
      phone:    document.getElementById('f_phone').value.trim(),
      street:   document.getElementById('f_street').value.trim(),
      city:     document.getElementById('f_city').value.trim(),
      zip:      document.getElementById('f_zip').value.trim()
    }};
    const r=await fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    msg.textContent=r.ok?'Saved.':'Failed.';
  };
  document.getElementById('push').onclick=async()=>{
    msg.textContent='Pushing to Splynx...';
    const r=await fetch('/api/admin/push/'+linkid,{method:'POST'});
    const d=await r.json().catch(()=>({ok:false}));
    msg.textContent=d.ok?'Approved & pushed.':'Failed: '+(d.error||'');
    if(d.ok) setTimeout(()=>location.href='/',1200);
  };
</script>`;
}

// ---------------- Onboarding HTML (client) ----------------
function onboardHTML(linkid) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn.outl{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
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
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt/><div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid=${JSON.stringify(linkid)};
  const stepEl=document.getElementById('step'), progEl=document.getElementById('prog');
  let step=0, state={ progress:0, edits:{}, uploads:[], pay_method:'eft' };
  function pct(){ return Math.min(100, Math.round(((step+1)/7)*100)); } function setProg(){ progEl.style.width=pct()+'%'; }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)}).catch(()=>{}); }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*s); canvas.height=Math.floor(180*s); ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw)return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); dirty=true; }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  function step0(){ stepEl.innerHTML='<h2>Welcome</h2><p>We\\'ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\'s begin</button>'; document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); }; }

  async function sendOtp(){
    const m=document.getElementById('otpmsg'); if(m) m.textContent='Sending code to WhatsApp...';
    try{ const r=await fetch('/api/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})}); const d=await r.json().catch(()=>({})); if(m) m.textContent=d.ok?'Code sent. Check WhatsApp.':(d.error||'Failed'); }
    catch{ if(m) m.textContent='Network error.'; }
  }
  function step1(){
    stepEl.innerHTML=[
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');
    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required/><button class="btn" type="submit">Verify</button></div></form><a class="btn outl" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code.'; } };
    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required/><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };
    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  function step2(){
    const pay=state.pay_method||'eft';
    stepEl.innerHTML=[
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn outl" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>'
    ].join('');
    function renderEft(){
      const id=(linkid||'').split('_')[0];
      document.getElementById('eftBox').innerHTML=[
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"></div><div class="field"><label>Branch Code</label><input readonly value="250655"></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"></div>',
        '<div class="note">Please use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn outl" href="/info/eft?id='+id+'" target="_blank">Print banking details</a></div>'
      ].join('');
    }
    let dPad=null;
    function renderDebit(){
      const d=state.debit||{};
      document.getElementById('debitBox').innerHTML=[
        '<div class="row"><div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'"></div><div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'"></div></div>',
        '<div class="row"><div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'"></div><div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'"></div></div>',
        '<div class="row"><div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque">Cheque / Current</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select></div><div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option value="'+x+'">'+x+'</option>').join(''),'</select></div></div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn outl" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');
      dPad=sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick=(e)=>{e.preventDefault(); dPad.clear();};
      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; }})();
    }
    document.getElementById('pm-eft').onclick=()=>{ state.pay_method='eft'; document.getElementById('debitBox').innerHTML=''; renderEft(); save(); };
    document.getElementById('pm-debit').onclick=()=>{ state.pay_method='debit'; document.getElementById('eftBox').innerHTML=''; renderDebit(); save(); };
    if(pay==='debit') renderDebit(); else renderEft();
    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{ e.preventDefault();
      if(state.pay_method==='debit'){
        const msg=document.getElementById('d_msg');
        if(!dPad || dPad.isEmpty()){ msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit={
          account_holder:document.getElementById('d_holder').value.trim(),
          id_number:     document.getElementById('d_id').value.trim(),
          bank_name:     document.getElementById('d_bank').value.trim(),
          account_number:document.getElementById('d_acc').value.trim(),
          account_type:  document.getElementById('d_type').value,
          debit_day:     document.getElementById('d_day').value
        };
        try{
          const id=(linkid||'').split('_')[0];
          await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ ...state.debit, splynx_id:id })});
          await fetch('/api/debit/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ linkid, dataUrl:dPad.dataURL() })});
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
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name:state.edits.full_name ?? p.full_name ?? '', passport:state.edits.passport ?? p.passport ?? '', email:state.edits.email ?? p.email ?? '', phone:state.edits.phone ?? p.phone ?? '', street:state.edits.street ?? p.street ?? '', city:state.edits.city ?? p.city ?? '', zip:state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"></div>',
          '<div class="row"><a class="btn outl" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), passport:document.getElementById('f_id').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML=[
      '<h2>Upload documents</h2>',
      '<div class="note">Please upload your ID and Proof of Address (max 2 files, 5MB each).</div>',
      '<div class="field"><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*"></div>',
      '<div class="field"><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*"></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn outl" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');
    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg=document.getElementById('uMsg');
      async function up(file,label){
        if(!file) return null;
        if(file.size>5*1024*1024){ msg.textContent='Each file must be 5MB or smaller.'; throw new Error('big'); }
        const buf=await file.arrayBuffer();
        const name=(file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r=await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label),{method:'POST',body:buf});
        const d=await r.json().catch(()=>({ok:false}));
        if(!d.ok) throw new Error('upload'); return { key:d.key, name, size:file.size, label };
      }
      try{
        msg.textContent='Uploading...';
        const u1=await up(document.getElementById('file1').files[0],'ID Document');
        const u2=await up(document.getElementById('file2').files[0],'Proof of Address');
        state.uploads=[u1,u2].filter(Boolean);
        step=5; state.progress=step; setProg(); save(); render();
      }catch(err){ if(msg.textContent==='') msg.textContent='Upload failed.'; }
    };
  }

  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn outl" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn outl" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  function step6(){
    const showDebit = !!state.debit;
    stepEl.innerHTML=[
      '<h2>All set!</h2>',
      '<p>Thanks — we’ve recorded your information. Our team will be in contact shortly.</p>',
      '<hr style="border:none;border-top:1px solid #eee;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em;padding:0;line-height:1.9">',
        '<li><a target="_blank" href="/agreements/pdf/msa/'+linkid+'">Master Service Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/msa/'+linkid+'?bbox=1">debug</a></li>',
        (showDebit?'<li><a target="_blank" href="/agreements/pdf/debit/'+linkid+'">Debit Order Agreement (PDF)</a> — <a class="note" target="_blank" href="/agreements/pdf/debit/'+linkid+'?bbox=1">debug</a></li>':''),
      '</ul>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>`;
}

// ---------------- Worker ----------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Admin root (IP restricted with message)
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response(restrictedHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
      return new Response(adminHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Admin static review (IP restricted)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response(restrictedHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!sess) return new Response("Not found", { status:404 });
      const ups = await env.R2_UPLOADS.list({ prefix:"uploads/"+linkid+"/" });
      const uploads = (ups.objects||[]).map(o=>({ key:o.key, size:o.size }));
      return new Response(reviewHTML(linkid, sess, uploads), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Onboard UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!sess) return new Response("Link expired or invalid", { status:404 });
      return new Response(onboardHTML(linkid), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Info (EFT printable)
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const html = await (async()=>`<!doctype html><meta charset="utf-8"><title>EFT Payment Details</title>
<style>body{font-family:Arial,sans-serif;background:#f7f7fa}.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}h1{color:#e2001a;font-size:34px;margin:8px 0 18px}.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}.grid .full{grid-column:1 / -1}label{font-weight:700;color:#333;font-size:14px}input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style>
<div class="container"><img src="${LOGO_URL}" class="logo" alt="Vinet"><h1>EFT Payment Details</h1>
<div class="grid"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div><div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${esc(id)}"></div></div>
<p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p><div style="margin-top:14px"><button onclick="window.print()">Print</button></div></div>` )();
      return new Response(html, { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Terms blobs (service/debit)
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind")||"").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      async function getText(u){ try{ const r=await fetch(u,{cf:{cacheEverything:true,cacheTtl:300}}); return r.ok?await r.text():""; }catch{return "";} }
      const text = kind==="debit" ? await getText(debUrl) : await getText(svcUrl);
      return new Response(text || "Terms unavailable.", { headers:{ "content-type":"text/plain; charset=utf-8" } });
    }

    // Session fetch (client)
    if (path.startsWith("/api/session/") && method === "GET") {
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ error:"invalid" }, 404);
      return json(s);
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/").pop();
      const body = await request.json().catch(()=>({}));
      const existing = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
      const next = { ...existing, ...body, last_ip:getIP(), last_ua:getUA(), last_time:Date.now() };
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Upload (R2)
    if (path === "/api/onboard/upload" && method === "POST") {
      const q = url.searchParams; const linkid=q.get("linkid")||""; const name=q.get("filename")||"file.bin";
      const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json"); if (!sess) return json({ ok:false, error:"invalid link" }, 404);
      const buf = await request.arrayBuffer(); const key="uploads/"+linkid+"/"+Date.now()+"_"+name;
      await env.R2_UPLOADS.put(key, buf); return json({ ok:true, key });
    }

    // Sign (MSA)
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl||"")) return json({ ok:false, error:"invalid" }, 400);
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const key = "agreements/"+linkid+"/signature.png";
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata:{ contentType:"image/png" }});
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, agreement_signed:true, agreement_sig_key:key, status:"pending", last_time:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Debit save + sign
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const id = (b.splynx_id||"").toString().trim() || "unknown";
      const key = `debit/${id}/${Date.now()}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, created:Date.now(), ip:getIP(), ua:getUA() }), { expirationTtl:60*60*24*90 });
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl||"")) return json({ ok:false, error:"invalid" }, 400);
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const key = "debit_agreements/"+linkid+"/signature.png";
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata:{ contentType:"image/png" }});
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, debit_signed:true, debit_sig_key:key, last_time:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      const dbg = url.searchParams.get("bbox")==="1";
      if (type==="msa")   return await renderMSA(env, linkid, dbg);
      if (type==="debit") return await renderDEBIT(env, linkid, dbg);
      return new Response("Unknown", { status:404 });
    }

    // Admin APIs (IP restricted)
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ id, created:Date.now(), progress:0 }), { expirationTtl:86400 });
      return json({ url: url.origin + "/onboard/" + linkid });
    }
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json"); if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put("staffotp/"+linkid, code, { expirationTtl: 900 });
      return json({ ok:true, code });
    }
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix:"onboard/", limit:1000 });
      const items=[];
      for (const k of list.keys||[]) {
        const s = await env.ONBOARD_KV.get(k.name, "json"); if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        const has_debit = !!s.debit_sig_key;
        if (s.status === "deleted") continue;
        if (mode==="inprog"   && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode==="pending"  && s.status==="pending") items.push({ linkid, id:s.id, updated, has_debit });
        if (mode==="approved" && s.status==="approved") items.push({ linkid, id:s.id, updated, has_debit });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }
    if (path.startsWith("/api/admin/session/") && method === "DELETE") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, status:"deleted", last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }
    if (path.startsWith("/api/admin/push/") && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const idOnly = (s.id || linkid.split("_")[0] || "").toString();
      const type = await detectLeadOrCustomer(env, idOnly);
      if (!type) return json({ ok:false, error:"id_unknown" }, 404);

      // PATCH a safe subset of fields
      const e = s.edits || {};
      const patch = { email:e.email, phone:e.phone, full_name:e.full_name, street:e.street, city:e.city, zip:e.zip };
      try {
        if (type==="lead") await splynxPATCH(env, `/admin/crm/leads/${idOnly}`, patch);
        else              await splynxPATCH(env, `/admin/customers/customer/${idOnly}`, patch);
      } catch { /* ignore to avoid blocking docs upload */ }

      // Upload PDFs
      try { const msa = await renderMSA(env, linkid, false); await splynxUploadDoc(env, type, idOnly, "MSA.pdf", await msa.arrayBuffer()); } catch {}
      try { if (s.debit_sig_key) { const d = await renderDEBIT(env, linkid, false); await splynxUploadDoc(env, type, idOnly, "Debit-Order.pdf", await d.arrayBuffer()); } } catch {}

      // Upload user uploads
      try {
        const files = await env.R2_UPLOADS.list({ prefix:"uploads/"+linkid+"/" });
        for (const o of (files.objects||[])) {
          const obj = await env.R2_UPLOADS.get(o.key); if (!obj) continue;
          const buf = await obj.arrayBuffer();
          const name = o.key.split("/").pop() || "upload.bin";
          await splynxUploadDoc(env, type, idOnly, name, buf, obj.httpMetadata?.contentType || "application/octet-stream");
        }
      } catch {}

      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, status:"approved", pushed_at:Date.now(), last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true, type, id:idOnly });
    }

    // R2 file view (IP restricted)
    if (path.startsWith("/r2/") && method === "GET") {
      if (!ipAllowed(request)) return new Response(restrictedHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
      const key = decodeURIComponent(path.slice(4));
      const obj = await env.R2_UPLOADS.get(key); if (!obj) return new Response("Not found", { status:404 });
      return new Response(obj.body, { headers:{ "content-type": obj.httpMetadata?.contentType || "application/octet-stream" } });
    }

    // OTP send/verify (WhatsApp + staff)
    async function sendWhatsAppTemplate(toMsisdn, code, lang="en") {
      if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) throw new Error("WA env missing");
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"template", template:{ name:templateName, language:{ code:lang }, components:[{ type:"body", parameters:[{ type:"text", text:code }] }] } };
      const r = await fetch(endpoint, { method:"POST", headers:{ Authorization:`Bearer ${env.WHATSAPP_TOKEN}`, "content-type":"application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("WA send failed");
    }
    async function fetchCustomerMsisdn(env, id) {
      try {
        const c = await splynxGET(env, `/admin/customers/customer/${id}`);
        const tryKeys=["phone_mobile","mobile","phone","whatsapp","msisdn","primary_phone","contact_number","billing_phone"];
        for (const k of tryKeys) if (c[k]) return String(c[k]);
      } catch {}
      try {
        const l = await splynxGET(env, `/admin/crm/leads/${id}`);
        const tryKeys=["phone_mobile","mobile","phone","whatsapp"];
        for (const k of tryKeys) if (l[k]) return String(l[k]);
      } catch {}
      return null;
    }
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const idOnly = (linkid||"").split("_")[0];
      const msisdn = await fetchCustomerMsisdn(env, idOnly);
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random()*900000));
      await env.ONBOARD_KV.put("otp/"+linkid, code, { expirationTtl: 600 });
      try { await sendWhatsAppTemplate(msisdn, code); return json({ ok:true }); }
      catch { return json({ ok:false, error:"WhatsApp send failed" }, 502); }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind==="staff" ? "staffotp/"+linkid : "otp/"+linkid;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok && kind==="staff") await env.ONBOARD_KV.delete("staffotp/"+linkid);
      if (ok) {
        const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
        await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, otp_verified:true, last_time:Date.now() }), { expirationTtl:86400 });
      }
      return json({ ok });
    }

    // Splynx profile (prefill)
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error:"Missing id" }, 400);
      try { const prof = await fetchProfileForOnboarding(env, id); return json(prof); }
      catch { return json({ error:"Lookup failed" }, 502); }
    }

    return new Response("Not found", { status:404 });
  }
};
