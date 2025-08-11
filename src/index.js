// Vinet Onboarding Worker — single file
// - Root (/) : Create onboarding link + link to /admin
// - /admin   : Pending | Completed (to approve) | Approved (pushed)
// - Onboarding flow: email/phone -> details -> products -> uploads -> sign MSA -> done
// - PDF stamping (MSA + Debit) with provided XY
// - Splynx: uses /admin/crm/leads/:id (correct) and /admin/customers/customer/:id

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ========== small utils ========== */

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json" } });

function ipAllowed(request) {
  // keep admin gated to office: 160.226.128.0/20
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

async function r2getBytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}
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
async function deviceIdFromParts(parts) {
  const data = new TextEncoder().encode(parts.join("|"));
  const h = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(h).slice(0,12)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* ========== Splynx helpers ========== */

async function splynxGET(env, ep) {
  const r = await fetch(env.SPLYNX_API + ep, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` } });
  if (!r.ok) throw new Error("GET "+ep+" "+r.status);
  return r.json();
}
async function splynxPATCH(env, ep, data) {
  const r = await fetch(env.SPLYNX_API + ep, {
    method:"PATCH", headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}`, "content-type":"application/json" }, body: JSON.stringify(data||{})
  });
  if (!r.ok) throw new Error("PATCH "+ep+" "+r.status);
  try { return await r.json(); } catch { return {}; }
}
async function splynxUploadDoc(env, type, id, filename, bytes, contentType="application/pdf") {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type: contentType }), filename);
  const ep = (type==="lead") ? `/admin/crm/leads/${id}/documents` : `/admin/customers/customer/${id}/documents`;
  const r = await fetch(env.SPLYNX_API + ep, { method:"POST", headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }, body: fd });
  if (!r.ok) throw new Error("UPLOAD "+ep+" "+r.status);
}
async function detectLeadOrCustomer(env, id) {
  try { await splynxGET(env, `/admin/crm/leads/${id}`); return "lead"; }
  catch { try { await splynxGET(env, `/admin/customers/customer/${id}`); return "customer"; } catch { return null; } }
}

/* ========== PDF coords (your XY) ========== */

// MSA pages: 0 and 3
const MSA_POS = {
  p1: {
    full_name:   { x:125, y:180, size:12, w:260 },
    id_passport: { x:125, y:215, size:12, w:260 },
    client_code: { x:145, y:245, size:12, w:240 },
    signature:   { x:400, y:700, w:180, h:45 }
  },
  p4: {
    full_name:   { x:400, y:640, size:12, w:200 },
    signature:   { x:400, y:670, w:180, h:45 },
    date:        { x:360, y:700, size:12, w:140 }
  }
};
// Debit: page 0
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

/* ========== PDF renderers ========== */

async function renderMSA(env, linkid, showBBox) {
  const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status:404 });

  const tpl = await env.R2_UPLOADS.get("templates/msa-template.pdf");
  if (!tpl) return new Response("MSA template missing", { status:500 });

  const pdf = await PDFDocument.load(await tpl.arrayBuffer());
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
    drawText(p, e.passport || e.id_passport || "", MSA_POS.p1.id_passport.x, MSA_POS.p1.id_passport.y, { font, size:MSA_POS.p1.id_passport.size, maxWidth:MSA_POS.p1.id_passport.w });

    if (showBBox) bbox(p, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y-10, MSA_POS.p1.client_code.w, 14);
    drawText(p, idOnly, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y, { font, size:MSA_POS.p1.client_code.size, maxWidth:MSA_POS.p1.client_code.w });

    if (sess.agreement_sig_key) {
      const sig = await r2getBytes(env, sess.agreement_sig_key);
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
      const sig = await r2getBytes(env, sess.agreement_sig_key);
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

  const tpl = await env.R2_UPLOADS.get("templates/debit-order-template.pdf");
  if (!tpl) return new Response("Debit template missing", { status:500 });

  const pdf = await PDFDocument.load(await tpl.arrayBuffer());
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
    const sig = await r2getBytes(env, sess.debit_sig_key);
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

/* ========== HTML (Root, Admin, Onboarding) ========== */

function rootHTML() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Create Onboarding Link</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:720px;margin:28px auto;border-radius:20px;box-shadow:0 2px 12px #0002;padding:22px}
  .logo{display:block;margin:0 auto 10px;max-width:180px}
  h1{color:#e2001a;margin:8px 0 18px;font-size:24px;text-align:center}
  .field{margin:12px 0} label{display:block;margin-bottom:6px}
  input{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:16px}
  .row{display:flex;gap:10px;align-items:center}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:16px;cursor:pointer}
  .note{color:#666;font-size:12px}
  a.lnk{display:inline-block;margin:10px 0 0}
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Create onboarding link</h1>
  <div class="field"><label>Splynx Lead/Customer ID</label><input id="id" placeholder="e.g. 4941"></div>
  <div class="row"><button class="btn" id="go">Generate link</button><a class="lnk" href="/admin">Open Admin</a></div>
  <div id="out" class="note"></div>
</div>
<script>
document.getElementById('go').onclick=async()=>{
  const id=(document.getElementById('id').value||'').trim();
  if(!id){ document.getElementById('out').textContent='Please enter an ID'; return; }
  const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
  const d=await r.json().catch(()=>({}));
  document.getElementById('out').innerHTML = d.url ? ('Link: <a target="_blank" href="'+d.url+'">'+d.url+'</a>') : 'Failed';
};
</script>`;
}

function adminHTML() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding Admin</title>
<style>
  :root{--red:#e2001a;--bg:#fafbfc;--card:#fff;--mut:#666;--txt:#232}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--txt);margin:0}
  header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid #eee}
  header img{height:34px}
  header h1{font-size:18px;margin:0;color:var(--red)}
  .wrap{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 62px)}
  aside{background:#fff;border-right:1px solid #eee;padding:12px}
  .menu a{display:block;padding:10px 12px;border-radius:10px;margin:4px 0;color:#222;text-decoration:none}
  .menu a.active{background:var(--red);color:#fff}
  main{padding:18px}
  .card{background:#fff;border:1px solid #eee;border-radius:14px;padding:16px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:9px;border-bottom:1px solid #f1f1f1;text-align:left;font-size:14px}
  th{color:#444}
  .row{display:flex;gap:8px;align-items:center}
  .btn{background:var(--red);color:#fff;border:0;border-radius:9px;padding:7px 11px;font-size:13px;cursor:pointer}
  .btn.outl{background:#fff;color:var(--red);border:1px solid var(--red)}
  .pill{display:inline-block;padding:3px 8px;border-radius:999px;font-size:12px;border:1px solid #eee}
  .hidden{display:none}
  .note{font-size:12px;color:#666}
  .modal{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center}
  .box{background:#fff;border:1px solid #eee;border-radius:12px;padding:16px;max-width:720px;width:95%}
</style>
<header><img src="${LOGO_URL}" alt=""><h1>Onboarding Admin</h1></header>
<div class="wrap">
  <aside>
    <nav class="menu">
      <a href="#" data-v="pending" class="active">Pending sessions</a>
      <a href="#" data-v="completed">Completed (to approve)</a>
      <a href="#" data-v="approved">Approved (pushed)</a>
    </nav>
  </aside>
  <main>
    <div class="card">
      <div id="panel-pending">
        <table id="tbl-pending"><thead><tr><th>Link</th><th>Splynx ID</th><th>Updated</th><th>Actions</th></tr></thead><tbody></tbody></table>
      </div>
      <div id="panel-completed" class="hidden">
        <table id="tbl-completed"><thead><tr><th>Link</th><th>Splynx ID</th><th>Docs</th><th>Uploads</th><th>Actions</th></tr></thead><tbody></tbody></table>
      </div>
      <div id="panel-approved" class="hidden">
        <table id="tbl-approved"><thead><tr><th>Link</th><th>Splynx ID</th><th>Docs</th><th>Pushed</th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </main>
</div>

<div id="modal" class="modal"><div class="box">
  <h3 id="mTitle"></h3>
  <div id="mBody"></div>
  <div class="row" style="margin-top:10px"><button class="btn outl" id="mClose">Close</button></div>
</div></div>

<script>
const V = { cur:'pending' };
function $(q){ return document.querySelector(q); }
function el(tag, html){ const e=document.createElement(tag); e.innerHTML=html; return e.firstElementChild; }
function fmt(ts){ try{ return new Date(ts||Date.now()).toLocaleString(); }catch{return '';} }

document.querySelectorAll('.menu a').forEach(a=>{
  a.onclick=(e)=>{ e.preventDefault(); document.querySelectorAll('.menu a').forEach(x=>x.classList.remove('active')); a.classList.add('active');
    V.cur=a.dataset.v; ['pending','completed','approved'].forEach(id=>$('#panel-'+id).classList.toggle('hidden', id!==V.cur)); load(); };
});

async function load(){
  if (V.cur==='pending'){
    const r=await fetch('/api/admin/sessions?view=pending'); const d=await r.json();
    const tb=$('#tbl-pending tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const tr=el('tr', '<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+fmt(it.last_time)+'</td><td></td>');
      const cell=tr.lastElementChild;
      cell.appendChild(el('button','<button class="btn outl">Open</button>')).onclick=()=>{ window.open('/onboard/'+it.linkid,'_blank') };
      cell.appendChild(document.createTextNode(' '));
      const del=el('button','<button class="btn">Delete</button>');
      del.onclick=async()=>{ if(!confirm('Delete '+it.linkid+'?'))return; await fetch('/api/admin/session/'+it.linkid,{method:'DELETE'}); load(); };
      cell.appendChild(del);
      tb.appendChild(tr);
    });
  } else if (V.cur==='completed'){
    const r=await fetch('/api/admin/sessions?view=completed'); const d=await r.json();
    const tb=$('#tbl-completed tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const docs = '<a target="_blank" href="/agreements/pdf/msa/'+it.linkid+'">MSA</a>'+(it.has_debit?' · <a target="_blank" href="/agreements/pdf/debit/'+it.linkid+'">Debit</a>':'');
      const tr=el('tr','<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+docs+'</td><td><a href="#" data-k="'+it.linkid+'">View</a></td><td><button class="btn">Approve & Push</button></td>');
      tr.querySelector('a[data-k]').onclick=async(ev)=>{ ev.preventDefault(); showUploads(it.linkid); };
      tr.querySelector('button.btn').onclick=async()=>{
        const b=tr.querySelector('button.btn'); b.disabled=true; b.textContent='Pushing...';
        const rr=await fetch('/api/admin/push/'+it.linkid,{method:'POST'});
        b.textContent = rr.ok ? 'Pushed' : 'Failed';
        if (rr.ok) load();
      };
      tb.appendChild(tr);
    });
  } else if (V.cur==='approved'){
    const r=await fetch('/api/admin/sessions?view=approved'); const d=await r.json();
    const tb=$('#tbl-approved tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const docs = '<a target="_blank" href="/agreements/pdf/msa/'+it.linkid+'">MSA</a>'+(it.has_debit?' · <a target="_blank" href="/agreements/pdf/debit/'+it.linkid+'">Debit</a>':'');
      const tr=el('tr','<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+docs+'</td><td>'+fmt(it.pushed_at)+'</td>');
      tb.appendChild(tr);
    });
  }
}
async function showUploads(linkid){
  const r=await fetch('/api/admin/session/'+linkid); const d=await r.json();
  if(!d.ok) return;
  $('#mTitle').textContent='Uploads for '+linkid;
  const list=(d.uploads||[]).map(o=>'<li><a target="_blank" href="/r2/'+encodeURIComponent(o.key)+'">'+(o.key.split('/').pop())+'</a> <span class="note">('+o.size+' bytes)</span></li>').join('');
  $('#mBody').innerHTML = list ? '<ul>'+list+'</ul>' : '<p class="note">No uploads</p>';
  $('#modal').style.display='flex';
}
$('#mClose').onclick=()=>{ $('#modal').style.display='none'; };

load();
</script>`;
}

function onboardHTML() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:720px;margin:28px auto;border-radius:20px;box-shadow:0 2px 12px #0002;padding:22px}
  .logo{display:block;margin:0 auto 10px;max-width:180px}
  h1{color:#e2001a;margin:8px 0 18px;font-size:28px;text-align:center}
  .field{margin:12px 0} label{display:block;margin-bottom:6px}
  input,textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:16px}
  .row{display:flex;gap:10px;align-items:center}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:16px;cursor:pointer}
  .btn.outl{background:#fff;color:#e2001a;border:1px solid #e2001a}
  .note{color:#666;font-size:12px}
  canvas{display:block}
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Vinet Client Onboarding</h1>
  <div id="content"></div>
</div>
<script>
(function(){
  const linkid = location.pathname.split('/').pop();
  const C = id => document.getElementById(id);

  let state=null, step=0;

  async function load(){
    try {
      const r=await fetch('/api/session/'+linkid);
      if(!r.ok) throw new Error('bad');
      state=await r.json();
      step=Math.max(0, Math.min(5, state.progress||0));
      render();
    } catch {
      C('content').innerHTML='<p class="note">Invalid or expired link.</p>';
    }
  }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state||{})}); }

  function s0(){
    C('content').innerHTML = '<p>Welcome! We\\'ll guide you through a few quick steps to complete your onboarding.</p>'
      + '<div class="field"><label>Email</label><input id="email" type="email"></div>'
      + '<div class="field"><label>Phone</label><input id="phone" type="tel"></div>'
      + '<div class="row"><button class="btn" id="next">Continue</button></div>';
    C('next').onclick=(e)=>{e.preventDefault(); state=state||{}; state.email=C('email').value.trim(); state.phone=C('phone').value.trim(); step=1; state.progress=step; save(); render();};
  }
  function s1(){
    C('content').innerHTML = '<h3>Your details</h3>'
      + '<div class="field"><label>Full name</label><input id="full"></div>'
      + '<div class="field"><label>ID / Passport</label><input id="idp"></div>'
      + '<div class="field"><label>Street</label><input id="street"></div>'
      + '<div class="field"><label>City</label><input id="city"></div>'
      + '<div class="field"><label>ZIP</label><input id="zip"></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="next">Continue</button></div>';
    C('back').onclick=(e)=>{e.preventDefault(); step=0; state.progress=step; save(); render();};
    C('next').onclick=(e)=>{e.preventDefault(); state=state||{}; state.edits=state.edits||{};
      state.edits.full_name=C('full').value.trim();
      state.edits.passport=C('idp').value.trim();
      state.edits.street=C('street').value.trim();
      state.edits.city=C('city').value.trim();
      state.edits.zip=C('zip').value.trim();
      step=2; state.progress=step; save(); render();};
  }
  function s2(){
    C('content').innerHTML = '<h3>Choose products</h3>'
      + '<div class="field"><label>Product selection</label><textarea id="products" rows="3" placeholder="e.g., FTTH 50/50, Router, Installation"></textarea></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="next">Continue</button></div>';
    C('back').onclick=(e)=>{e.preventDefault(); step=1; state.progress=step; save(); render();};
    C('next').onclick=(e)=>{e.preventDefault(); state.products=C('products').value.trim(); step=3; state.progress=step; save(); render();};
  }
  function s3(){
    C('content').innerHTML = '<h3>Uploads</h3>'
      + '<div class="field"><label>ID Document</label><input type="file" id="f1" accept=".png,.jpg,.jpeg,.pdf,image/*"></div>'
      + '<div class="field"><label>Proof of Address</label><input type="file" id="f2" accept=".png,.jpg,.jpeg,.pdf,image/*"></div>'
      + '<div class="note" id="uMsg"></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="next">Continue</button></div>';
    C('back').onclick=(e)=>{e.preventDefault(); step=2; state.progress=step; save(); render();};
    C('next').onclick=async(e)=>{
      e.preventDefault();
      const msg=C('uMsg');
      async function up(file,label){
        if(!file) return null;
        if(file.size>5*1024*1024){ msg.textContent='Max 5MB each.'; throw new Error('big'); }
        const buf=await file.arrayBuffer();
        const name=(file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r=await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label),{method:'POST',body:buf});
        const d=await r.json().catch(()=>({}));
        if(!d.ok) throw new Error('upload');
        return { key:d.key, label };
      }
      try {
        const u1=await up(C('f1').files[0],'ID Document');
        const u2=await up(C('f2').files[0],'Proof of Address');
        state.uploads=[u1,u2].filter(Boolean);
        step=4; state.progress=step; save(); render();
      } catch(err) { if(!msg.textContent) msg.textContent='Upload failed'; }
    };
  }
  function s4(){
    C('content').innerHTML = '<h3>Master Service Agreement</h3>'
      + '<div class="field"><label><input type="checkbox" id="agree"> I accept the terms</label></div>'
      + '<div class="field"><label>Draw your signature</label><canvas id="sig" width="600" height="160" style="border:1px solid #ddd;border-radius:10px;background:#fff"></canvas>'
      + '<div class="row"><button class="btn outl" id="clear">Clear</button><span class="note" id="msg"></span></div></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="sign">Agree & Sign</button></div>';
    const canvas=C('sig'), ctx=canvas.getContext('2d'); let drawing=false, drawn=false;
    canvas.onmousedown=e=>{drawing=true; drawn=true; ctx.beginPath(); ctx.moveTo(e.offsetX,e.offsetY);};
    canvas.onmousemove=e=>{ if(drawing){ ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); } };
    window.onmouseup=()=>{ drawing=false; };
    C('clear').onclick=(e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); drawn=false; };
    C('back').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; save(); render(); };
    C('sign').onclick=async(e)=>{
      e.preventDefault(); const msg=C('msg');
      if(!C('agree').checked){ msg.textContent='Please accept the terms.'; return; }
      if(!drawn){ msg.textContent='Please draw your signature.'; return; }
      msg.textContent='Saving...';
      const dataUrl=canvas.toDataURL('image/png');
      const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ step=5; state.progress=step; save(); render(); } else { msg.textContent='Could not save signature.'; }
    };
  }
  function s5(){
    const showDebit = !!(state && state.debit && state.debit.account_holder);
    C('content').innerHTML = '<h3>All done!</h3>'
      + '<p>Thanks — your onboarding is submitted.</p>'
      + '<p><b>Documents:</b> <a target="_blank" href="/agreements/pdf/msa/'+linkid+'">MSA</a>'
      + (showDebit ? ' · <a target="_blank" href="/agreements/pdf/debit/'+linkid+'">Debit Order</a>' : '')
      + '</p>';
  }
  function render(){ [s0,s1,s2,s3,s4,s5][step](); }

  load();
})();
</script>`;
}

/* ========== Router ========== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Root (create link)
    if (path === "/" && method === "GET") {
      return new Response(rootHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Admin (IP limited)
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      return new Response(adminHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      return new Response(onboardHTML(), { headers:{ "content-type":"text/html; charset=utf-8" } });
    }

    // --- API ---

    // Create link (used by / and admin tooling)
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(()=>({}));
      const sp = (id||"").toString().trim();
      if (!sp) return json({ error:"missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = sp + "_" + token;
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ splynx_id:sp, created:Date.now(), progress:0 }), { expirationTtl: 86400 });
      return json({ url: url.origin + "/onboard/" + linkid });
    }

    // Session fetch (client)
    if (path.startsWith("/api/session/") && method === "GET") {
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ error:"invalid" }, 404);
      return json(s);
    }

    // Save progress (captures audit)
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/").pop();
      const body = await request.json().catch(()=>({}));
      const existing = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
      const last_loc = {
        city: cf.city||"", region: cf.region||"", country: cf.country||"",
        latitude: cf.latitude||"", longitude: cf.longitude||"",
        timezone: cf.timezone||"", postalCode: cf.postalCode||"",
        asn: cf.asn||"", asOrganization: cf.asOrganization||"", colo: cf.colo||""
      };
      const last_ip = getIP(); const last_ua = getUA();
      const device_id = existing.device_id || await deviceIdFromParts([last_ua, last_ip, cf.asn||"", cf.colo||"", (linkid||"").slice(0,8)]);
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid") || "";
      const name = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!sess) return json({ ok:false, error:"invalid link" }, 404);
      const buf = await request.arrayBuffer();
      const key = "uploads/"+linkid+"/"+Date.now()+"_"+name;
      await env.R2_UPLOADS.put(key, buf);
      return json({ ok:true, key });
    }

    // Sign (MSA)
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl||"")) return json({ ok:false, error:"invalid" }, 400);
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c=>c.charCodeAt(0));
      const key = "agreements/"+linkid+"/signature.png";
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata:{ contentType:"image/png" }});
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json") || {};
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, agreement_signed:true, agreement_sig_key:key, last_time: Date.now(), status:"completed" }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      const dbg = url.searchParams.get("bbox")==="1";
      try {
        if (type==="msa")   return await renderMSA(env, linkid, dbg);
        if (type==="debit") return await renderDEBIT(env, linkid, dbg);
        return new Response("Unknown", { status:404 });
      } catch { return new Response("PDF error", { status:500 }); }
    }

    // Admin: list sessions
    if (path === "/api/admin/sessions" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const view = url.searchParams.get("view") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix:"onboard/" });
      const out=[];
      for (const k of list.keys) {
        const linkid = k.name.split("/").pop();
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const status = s.status || (s.agreement_signed ? "completed" : "pending");
        const row = {
          linkid,
          splynx_id: s.splynx_id || (linkid.split("_")[0]),
          has_debit: !!s.debit_sig_key,
          last_time: s.last_time || s.created || Date.now(),
          pushed_at: s.pushed_at || 0,
          status
        };
        if (view==="pending"   && status==="pending")   out.push(row);
        if (view==="completed" && status==="completed") out.push(row);
        if (view==="approved"  && status==="pushed")    out.push(row);
      }
      return json({ ok:true, items: out });
    }

    // Admin: get one (with uploads)
    if (path.startsWith("/api/admin/session/") && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const ups = await env.R2_UPLOADS.list({ prefix:"uploads/"+linkid+"/" });
      return json({ ok:true, session:s, uploads:(ups.objects||[]).map(o=>({ key:o.key, size:o.size, uploaded:o.uploaded })) });
    }

    // Admin: delete (soft)
    if (path.startsWith("/api/admin/session/") && method === "DELETE") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, status:"deleted", last_time:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    // Admin: push (approve)
    if (path.startsWith("/api/admin/push/") && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/"+linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const idOnly = (linkid.split("_")[0]||"").trim();
      const type = await detectLeadOrCustomer(env, idOnly);
      if (!type) return json({ ok:false, error:"id_unknown" }, 404);

      // Patch basic edits
      try {
        const data = { ...(s.edits||{}) };
        if (type==="lead") await splynxPATCH(env, `/admin/crm/leads/${idOnly}`, data);
        else await splynxPATCH(env, `/admin/customers/customer/${idOnly}`, data);
      } catch { return json({ ok:false, error:"patch_failed" }, 502); }

      // Upload PDFs
      try { const msa = await renderMSA(env, linkid, false); await splynxUploadDoc(env, type, idOnly, "msa.pdf", await msa.arrayBuffer()); } catch {}
      try { if (s.debit_sig_key) { const deb = await renderDEBIT(env, linkid, false); await splynxUploadDoc(env, type, idOnly, "debit-order.pdf", await deb.arrayBuffer()); } } catch {}

      // Upload client uploads
      try {
        const files = await env.R2_UPLOADS.list({ prefix:"uploads/"+linkid+"/" });
        for (const o of (files.objects||[])) {
          const obj = await env.R2_UPLOADS.get(o.key); if (!obj) continue;
          const buf = await obj.arrayBuffer();
          const name = o.key.split("/").pop() || "upload.bin";
          await splynxUploadDoc(env, type, idOnly, name, buf, obj.httpMetadata?.contentType || "application/octet-stream");
        }
      } catch {}

      await env.ONBOARD_KV.put("onboard/"+linkid, JSON.stringify({ ...s, status:"pushed", pushed_at: Date.now() }), { expirationTtl:86400 });
      return json({ ok:true, id:idOnly, type });
    }

    // Raw R2 (admin modal links)
    if (path.startsWith("/r2/") && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status:403 });
      const key = decodeURIComponent(path.slice(4));
      const obj = await env.R2_UPLOADS.get(key);
      if (!obj) return new Response("Not found", { status:404 });
      return new Response(obj.body, { headers:{ "content-type": obj.httpMetadata?.contentType || "application/octet-stream" } });
    }

    // Splynx lookup (normalized, optional)
    if (path === "/api/splynx/lookup" && method === "POST") {
      const { id, type } = await request.json().catch(()=>({}));
      if (!id) return json({ ok:false, error:"missing_id" }, 400);
      async function j(ep){ const r=await fetch(env.SPLYNX_API+ep,{headers:{Authorization:`Basic ${env.SPLYNX_AUTH}`}}); const t=await r.text(); if(!r.ok) throw 0; try{return JSON.parse(t);}catch{throw 0;} }
      let out=null;
      if (!type || type==="lead" || type==="auto") { try{ const k=await j(`/admin/crm/leads/${id}`); out={ type:"lead", id:k.id, email:k.email, phone:k.phone, name:k.name||k.full_name||"", address:k.address||k.street||"", additional_attributes:k.additional_attributes||{} }; }catch{} }
      if (!out && (!type || type==="customer" || type==="auto")) { try{ const k=await j(`/admin/customers/customer/${id}`); out={ type:"customer", id:k.id, email:k.email||k.billing_email||"", phone:k.phone||"", name:[k.first_name||"",k.last_name||""].join(" ").trim(), address:k.address||k.street||"", additional_attributes:k.additional_attributes||{} }; }catch{} }
      if (!out) return json({ ok:false, error:"not_found" }, 404);
      return json({ ok:true, ...out });
    }

    return new Response("Not found", { status:404 });
  }
};
