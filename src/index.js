// --- Vinet Onboarding Worker (single-file) ---
// - Full Admin (Pending/Delete, Completed/Docs+Push, Review/Edit, Create)
// - Onboarding UI (full flow)
// - Splynx lookups/patch + doc upload
// - PDF generators (MSA + Debit) with your exact XY positions
// - R2 template keys: templates/msa-template.pdf, templates/debit-order-template.pdf

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ========= CONFIG / HELPERS ========= */

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  // Allow your office block: 160.226.128.0/20
  const m = ip.split(".").map(n => parseInt(n, 10));
  return m.length === 4 && m[0] === 160 && m[1] === 226 && m[2] >= 128 && m[2] <= 143;
}

const json = (obj, status=200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json" }
});

const nowSec = () => Math.floor(Date.now()/1000);

function drawText(page, value, x, y, {font, size=12, color=rgb(0,0,0), maxWidth=null, lineHeight=1.2}={}) {
  const v = String(value ?? "");
  if (!maxWidth) { page.drawText(v, { x, y, size, font, color }); return; }
  const words = v.split(/\s+/);
  let line="", cy=y;
  for (const w of words) {
    const t = line ? line+" "+w : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) { line=t; continue; }
    if (line) page.drawText(line, { x, y: cy, size, font, color });
    line=w; cy -= size*lineHeight;
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color });
}

async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

function bbox(page, x, y, w, h) {
  page.drawRectangle({ x, y, width:w, height:h, borderWidth:0.8, borderColor: rgb(1,0,0), color: rgb(1,0,0), opacity:0.06 });
}

async function deviceIdFromParts(parts) {
  const s = parts.join("|");
  const enc = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", enc);
  const b = Array.from(new Uint8Array(h)).slice(0, 12);
  return b.map(x=>x.toString(16).padStart(2,"0")).join("");
}

/* ========= SPLYNX HELPERS ========= */

async function splynxGET(env, endpoint) {
  const r = await fetch(env.SPLYNX_API + endpoint, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });
  if (!r.ok) throw new Error("GET " + endpoint + " " + r.status);
  return r.json();
}
async function splynxPATCH(env, endpoint, data) {
  const r = await fetch(env.SPLYNX_API + endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(data || {})
  });
  if (!r.ok) throw new Error("PATCH " + endpoint + " " + r.status);
  try { return await r.json(); } catch { return {}; }
}
async function splynxUploadDoc(env, type, id, filename, bytes, contentType) {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type: contentType || "application/pdf" }), filename);
  const ep = type === "lead"
    ? `/admin/crm/leads/${id}/documents`
    : `/admin/customers/customer/${id}/documents`;
  const r = await fetch(env.SPLYNX_API + ep, { method: "POST", headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }, body: fd });
  if (!r.ok) throw new Error("UPLOAD " + ep + " " + r.status);
  try { return await r.json(); } catch { return {}; }
}

async function tryLeadOrCustomer(env, id) {
  try { await splynxGET(env, `/admin/crm/leads/${id}`); return "lead"; }
  catch {
    try { await splynxGET(env, `/admin/customers/customer/${id}`); return "customer"; }
    catch { return null; }
  }
}

/* ========= PDF COORDS (YOUR XY) ========= */

// MSA: Page indices 0 and 3
const MSA_POS = {
  p1: {
    full_name:   { x: 125, y: 180, size: 12, w: 260 },
    id_passport: { x: 125, y: 215, size: 12, w: 260 },
    client_code: { x: 145, y: 245, size: 12, w: 240 },
    signature:   { x: 400, y: 700, w: 180, h: 45 }
  },
  p4: {
    full_name:   { x: 400, y: 640, size: 12, w: 200 },
    signature:   { x: 400, y: 670, w: 180, h: 45 },
    date:        { x: 360, y: 700, size: 12, w: 140 }
  }
};

const DEBIT_POS = {
  account_holder: { x:  60, y: 145, size: 12, w: 260 },
  holder_id:      { x:  65, y: 200, size: 12, w: 260 },
  bank:           { x: 100, y: 245, size: 12, w: 220 },
  account_no:     { x:  95, y: 290, size: 12, w: 220 },
  account_type:   { x:  80, y: 340, size: 12, w: 200 },
  debit_date:     { x: 150, y: 395, size: 12, w: 120 },
  signature:      { x: 110, y: 440, w: 160, h: 40 },
  date:           { x: 100, y: 480, size: 12, w: 160 },
  client_code:    { x: 170, y: 535, size: 12, w: 180 }
};

/* ========= PDF GENERATORS ========= */

async function renderMSA(env, linkid, showBBox) {
  const sess = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status: 404 });

  const tpl = await env.R2_UPLOADS.get("templates/msa-template.pdf");
  if (!tpl) return new Response("MSA template missing", { status: 500 });

  const pdf = await PDFDocument.load(await tpl.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  const e = sess.edits || {};
  const idOnly = (linkid.split("_")[0] || "").trim();

  // Page 1
  {
    const p = pages[0];
    if (showBBox) bbox(p, MSA_POS.p1.full_name.x, MSA_POS.p1.full_name.y-10, MSA_POS.p1.full_name.w, 14);
    drawText(p, e.full_name || "", MSA_POS.p1.full_name.x, MSA_POS.p1.full_name.y, { font, size: MSA_POS.p1.full_name.size, maxWidth: MSA_POS.p1.full_name.w });

    if (showBBox) bbox(p, MSA_POS.p1.id_passport.x, MSA_POS.p1.id_passport.y-10, MSA_POS.p1.id_passport.w, 14);
    drawText(p, e.passport || e.id_passport || "", MSA_POS.p1.id_passport.x, MSA_POS.p1.id_passport.y, { font, size: MSA_POS.p1.id_passport.size, maxWidth: MSA_POS.p1.id_passport.w });

    if (showBBox) bbox(p, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y-10, MSA_POS.p1.client_code.w, 14);
    drawText(p, idOnly, MSA_POS.p1.client_code.x, MSA_POS.p1.client_code.y, { font, size: MSA_POS.p1.client_code.size, maxWidth: MSA_POS.p1.client_code.w });

    if (sess.agreement_sig_key) {
      const sig = await fetchR2Bytes(env, sess.agreement_sig_key);
      if (sig) {
        const img = await pdf.embedPng(sig);
        const f = MSA_POS.p1.signature;
        if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
        // scale within box
        const wh = img.scale(1);
        let w = f.w, h = wh.height/wh.width*w;
        if (h > f.h) { h = f.h; w = wh.width/wh.height*h; }
        p.drawImage(img, { x: f.x, y: f.y, width: w, height: h });
      }
    }
  }

  // Page 4 (index 3)
  if (pages.length >= 4) {
    const p = pages[3];
    if (showBBox) bbox(p, MSA_POS.p4.full_name.x, MSA_POS.p4.full_name.y-10, MSA_POS.p4.full_name.w, 14);
    drawText(p, e.full_name || "", MSA_POS.p4.full_name.x, MSA_POS.p4.full_name.y, { font, size: MSA_POS.p4.full_name.size, maxWidth: MSA_POS.p4.full_name.w });

    if (sess.agreement_sig_key) {
      const sig = await fetchR2Bytes(env, sess.agreement_sig_key);
      if (sig) {
        const img = await pdf.embedPng(sig);
        const f = MSA_POS.p4.signature;
        if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
        const wh = img.scale(1);
        let w = f.w, h = wh.height/wh.width*w;
        if (h > f.h) { h = f.h; w = wh.width/wh.height*h; }
        p.drawImage(img, { x: f.x, y: f.y, width: w, height: h });
      }
    }

    if (showBBox) bbox(p, MSA_POS.p4.date.x, MSA_POS.p4.date.y-10, MSA_POS.p4.date.w, 14);
    drawText(p, new Date(sess.last_time || Date.now()).toLocaleDateString("en-ZA"),
      MSA_POS.p4.date.x, MSA_POS.p4.date.y, { font, size: MSA_POS.p4.date.size, maxWidth: MSA_POS.p4.date.w });
  }

  const out = await pdf.save();
  return new Response(out, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

async function renderDEBIT(env, linkid, showBBox) {
  const sess = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
  if (!sess) return new Response("Not found", { status: 404 });

  const tpl = await env.R2_UPLOADS.get("templates/debit-order-template.pdf");
  if (!tpl) return new Response("Debit template missing", { status: 500 });

  const pdf = await PDFDocument.load(await tpl.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.getPages()[0];

  const d = sess.debit || {};
  const idOnly = (linkid.split("_")[0] || "").trim();

  function put(f, val) {
    if (showBBox) bbox(p, f.x, f.y-10, f.w || 80, 14);
    drawText(p, val || "", f.x, f.y, { font, size: f.size || 12, maxWidth: f.w || null });
  }

  put(DEBIT_POS.account_holder, d.account_holder);
  put(DEBIT_POS.holder_id,      d.id_number || d.holder_id);
  put(DEBIT_POS.bank,           d.bank_name || d.bank);
  put(DEBIT_POS.account_no,     d.account_number || d.account_no);
  put(DEBIT_POS.account_type,   d.account_type);
  put(DEBIT_POS.debit_date,     d.debit_day || d.debit_date);

  put(DEBIT_POS.client_code, idOnly);
  put(DEBIT_POS.date, new Date(sess.last_time || Date.now()).toLocaleDateString("en-ZA"));

  if (sess.debit_sig_key) {
    const sig = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sig) {
      const img = await pdf.embedPng(sig);
      const f = DEBIT_POS.signature;
      if (showBBox) bbox(p, f.x, f.y, f.w, f.h);
      const wh = img.scale(1);
      let w = f.w, h = wh.height/wh.width*w;
      if (h > f.h) { h = f.h; w = wh.width/wh.height*h; }
      p.drawImage(img, { x: f.x, y: f.y, width: w, height: h });
    }
  }

  const out = await pdf.save();
  return new Response(out, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

/* ========= HTML: ADMIN ========= */

function adminHTML() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vinet Onboarding — Admin</title>
<style>
  :root{--red:#e2001a;--bg:#fafbfc;--card:#fff;--txt:#232;--mut:#666}
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
  .mut{color:var(--mut)}
  .hidden{display:none}
  .note{font-size:12px;color:#666}
  .modal{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center}
  .box{background:#fff;border:1px solid #eee;border-radius:12px;padding:16px;max-width:720px;width:95%}
  .field{margin:8px 0} input,textarea{width:100%;padding:8px;border:1px solid #ddd;border-radius:8px}
</style>
</head><body>
<header>
  <img src="${LOGO_URL}" alt="Vinet">
  <h1>Onboarding Admin</h1>
</header>
<div class="wrap">
  <aside>
    <nav class="menu">
      <a href="#" data-view="pending"  class="active">Pending</a>
      <a href="#" data-view="completed">Completed</a>
      <a href="#" data-view="review">Review / Edit</a>
      <hr>
      <a href="#" data-view="create">Create link</a>
    </nav>
  </aside>
  <main>
    <div class="card">
      <div id="panel-pending">
        <h3>Pending links</h3>
        <table id="tbl-pending"><thead>
          <tr><th>Link ID</th><th>Splynx ID</th><th>Status</th><th>Updated</th><th>Actions</th></tr>
        </thead><tbody></tbody></table>
      </div>

      <div id="panel-completed" class="hidden">
        <h3>Completed</h3>
        <table id="tbl-completed"><thead>
          <tr><th>Link ID</th><th>Splynx ID</th><th>Docs</th><th>Uploads</th><th>Actions</th></tr>
        </thead><tbody></tbody></table>
      </div>

      <div id="panel-review" class="hidden">
        <div class="row"><div class="mut">Select a session below, edit fields, then Save or Push.</div></div>
        <div class="row" style="gap:16px;align-items:flex-start;margin-top:8px">
          <div style="flex:1">
            <table id="tbl-review"><thead>
              <tr><th>Link ID</th><th>Splynx ID</th><th>Status</th><th>Select</th></tr>
            </thead><tbody></tbody></table>
          </div>
          <div style="flex:1">
            <div class="field"><label>Full name</label><input id="ed_full"></div>
            <div class="field"><label>ID / Passport</label><input id="ed_pass"></div>
            <div class="field"><label>Street</label><input id="ed_street"></div>
            <div class="field"><label>City</label><input id="ed_city"></div>
            <div class="field"><label>ZIP</label><input id="ed_zip"></div>
            <div class="row">
              <button class="btn" id="btnSaveEdits">Save Edits</button>
              <button class="btn outl" id="btnPush">Push to Splynx</button>
              <span id="saveMsg" class="note"></span>
            </div>
          </div>
        </div>
      </div>

      <div id="panel-create" class="hidden">
        <h3>Create onboarding link</h3>
        <div class="field"><label>Splynx Lead/Customer ID</label><input id="new_id" placeholder="e.g. 4941"></div>
        <button class="btn" id="btnCreate">Generate link</button>
        <div class="note" id="new_out"></div>
      </div>
    </div>
  </main>
</div>

<div id="modal" class="modal"><div class="box">
  <h3 id="mTitle">Session</h3>
  <div id="mBody"></div>
  <div class="row" style="margin-top:10px"><button class="btn outl" id="mClose">Close</button></div>
</div></div>

<script>
const state = { view: 'pending', selected: null };

function $(q){ return document.querySelector(q); }
function el(tag, html){ const e=document.createElement(tag); e.innerHTML=html; return e.firstElementChild; }
function fmt(ts){ try{const d=new Date(ts||Date.now()); return d.toLocaleString(); }catch{return '';} }

function switchView(v){
  state.view=v;
  document.querySelectorAll('.menu a').forEach(a => a.classList.toggle('active', a.dataset.view===v));
  ['pending','completed','review','create'].forEach(id=>{
    $('#panel-'+id).classList.toggle('hidden', id!==v);
  });
  loadView();
}

async function loadView(){
  if (state.view==='pending'){
    const r=await fetch('/api/admin/sessions?view=pending'); const d=await r.json();
    const tb=$('#tbl-pending tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const tr=el('tr', '<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+ (it.status||'') +'</td><td>'+ fmt(it.last_time) +'</td><td></td>');
      const cell=tr.lastElementChild;
      cell.appendChild(el('button','<button class="btn outl">Open</button>')).onclick=()=>{window.open('/onboard/'+it.linkid,'_blank')};
      cell.appendChild(document.createTextNode(' '));
      const del=el('button','<button class="btn">Delete</button>');
      del.onclick=async()=>{ if(!confirm('Delete pending link '+it.linkid+'?')) return; await fetch('/api/admin/session/'+it.linkid,{method:'DELETE'}); loadView(); };
      cell.appendChild(del);
      tb.appendChild(tr);
    });
  } else if (state.view==='completed'){
    const r=await fetch('/api/admin/sessions?view=completed'); const d=await r.json();
    const tb=$('#tbl-completed tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const docs = '<a target="_blank" href="/agreements/pdf/msa/'+it.linkid+'">MSA</a>' + (it.has_debit ? ' · <a target="_blank" href="/agreements/pdf/debit/'+it.linkid+'">Debit</a>':'');
      const tr=el('tr','<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+docs+'</td><td><a href="#" data-k="'+it.linkid+'">View</a></td><td></td>');
      tr.querySelector('a[data-k]').onclick=async(ev)=>{ ev.preventDefault(); showSession(it.linkid); };
      const act=tr.lastElementChild;
      const p=el('button','<button class="btn">Push to Splynx</button>');
      p.onclick=async()=>{ p.disabled=true; p.textContent='Pushing...'; const rr=await fetch('/api/admin/push/'+it.linkid,{method:'POST'}); p.textContent= rr.ok?'Pushed':'Failed'; };
      act.appendChild(p);
      tb.appendChild(tr);
    });
  } else if (state.view==='review'){
    const r=await fetch('/api/admin/sessions?view=all'); const d=await r.json();
    const tb=$('#tbl-review tbody'); tb.innerHTML='';
    (d.items||[]).forEach(it=>{
      const tr=el('tr','<td>'+it.linkid+'</td><td>'+it.splynx_id+'</td><td>'+ (it.status||'') +'</td><td><button class="btn outl">Select</button></td>');
      tr.querySelector('button').onclick=()=>{ selectForEdit(it.linkid); };
      tb.appendChild(tr);
    });
  }
}

async function selectForEdit(linkid){
  state.selected=linkid;
  const r=await fetch('/api/admin/session/'+linkid); const d=await r.json();
  if(!d.ok) return;
  const e=d.session.edits||{};
  $('#ed_full').value=e.full_name||'';
  $('#ed_pass').value=e.passport||'';
  $('#ed_street').value=e.street||'';
  $('#ed_city').value=e.city||'';
  $('#ed_zip').value=e.zip||'';
}

async function showSession(linkid){
  const r=await fetch('/api/admin/session/'+linkid); const d=await r.json();
  if(!d.ok) return;
  $('#mTitle').textContent='Session '+linkid;
  const u = (d.uploads||[]).map(o=>'<li><a target="_blank" href="/r2/'+encodeURIComponent(o.key)+'">'+o.key.split('/').pop()+'</a> <span class="note">('+o.size+' bytes)</span></li>').join('');
  $('#mBody').innerHTML=
    '<p><b>Docs:</b> <a target="_blank" href="/agreements/pdf/msa/'+linkid+'">MSA</a>'
    + (d.session.debit_sig_key? ' · <a target="_blank" href="/agreements/pdf/debit/'+linkid+'">Debit</a>' : '')
    + '</p>'
    + '<p><b>Uploads</b></p><ul>'+ (u||'<li class="note">None</li>') +'</ul>';
  $('#modal').style.display='flex';
}

document.querySelectorAll('.menu a').forEach(a=>{
  a.onclick=(e)=>{ e.preventDefault(); switchView(a.dataset.view); };
});

$('#btnCreate').onclick=async()=>{
  const id = ($('#new_id').value||'').trim(); if(!id) return;
  const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
  const d=await r.json();
  $('#new_out').innerHTML = d.url ? ('Link: <a target="_blank" href="'+d.url+'">'+d.url+'</a>') : 'Failed';
};

$('#btnSaveEdits').onclick=async()=>{
  if(!state.selected) { $('#saveMsg').textContent='Select a session'; return; }
  const body={ edits:{
    full_name: $('#ed_full').value.trim(),
    passport:  $('#ed_pass').value.trim(),
    street:    $('#ed_street').value.trim(),
    city:      $('#ed_city').value.trim(),
    zip:       $('#ed_zip').value.trim()
  }};
  const r=await fetch('/api/admin/session/'+state.selected,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  $('#saveMsg').textContent = r.ok ? 'Saved' : 'Failed';
};

$('#btnPush').onclick=async()=>{
  if(!state.selected) { $('#saveMsg').textContent='Select a session'; return; }
  $('#saveMsg').textContent='Pushing...';
  const r=await fetch('/api/admin/push/'+state.selected,{method:'POST'});
  $('#saveMsg').textContent = r.ok ? 'Pushed' : 'Failed';
};

$('#mClose').onclick=()=>{ $('#modal').style.display='none'; };

switchView('pending');
</script>
</body></html>`;
}

/* ========= HTML: ONBOARD ========= */

function onboardHTML() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:720px;margin:28px auto;border-radius:20px;box-shadow:0 2px 12px #0002;padding:22px}
  .logo{display:block;margin:0 auto 10px;max-width:180px}
  h1{color:#e2001a;margin:8px 0 18px;font-size:28px;text-align:center}
  .field{margin:12px 0} label{display:block;margin-bottom:6px;color:#333}
  input,textarea,select{width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:16px;background:#fff}
  .row{display:flex;gap:10px;align-items:center}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:16px;cursor:pointer}
  .btn.outl{background:#fff;color:#e2001a;border:1px solid #e2001a}
  .note{color:#666;font-size:12px}
  canvas{display:block}
</style>
</head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Vinet Client Onboarding</h1>
  <div id="content"></div>
</div>
<script>
(function(){
  const linkid = location.pathname.split('/').pop();
  const C = id => document.getElementById(id);

  let state = null;
  let step = 0; // 0..5

  async function load(){
    try {
      const r = await fetch('/api/session/'+linkid);
      if (!r.ok) throw new Error('invalid link');
      state = await r.json();
      step = Math.max(0, Math.min(5, state.progress || 0));
    } catch (e) {
      C('content').innerHTML = '<p class="note">Invalid or expired link.</p>';
      return;
    }
    render();
  }

  function save(){ fetch('/api/progress/'+linkid,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state||{})}); }

  function step0(){
    C('content').innerHTML =
      '<p>Welcome! We\\'ll guide you through a few quick steps to complete your onboarding.</p>'
      + '<div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>'
      + '<div class="field"><label>Phone</label><input id="phone" type="tel" autocomplete="tel"></div>'
      + '<div class="row"><button class="btn" id="next">Continue</button></div>';
    C('next').onclick = (e)=>{ e.preventDefault(); state=state||{}; state.email=C('email').value.trim(); state.phone=C('phone').value.trim(); step=1; state.progress=step; save(); render(); };
  }

  function step1(){
    C('content').innerHTML =
      '<h3>Your details</h3>'
      + '<div class="field"><label>Full name</label><input id="full"></div>'
      + '<div class="field"><label>ID / Passport</label><input id="idp"></div>'
      + '<div class="field"><label>Street</label><input id="street"></div>'
      + '<div class="field"><label>City</label><input id="city"></div>'
      + '<div class="field"><label>ZIP</label><input id="zip"></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="next">Continue</button></div>';
    C('back').onclick = (e)=>{ e.preventDefault(); step=0; state.progress=step; save(); render(); };
    C('next').onclick = (e)=>{ e.preventDefault();
      state=state||{}; state.edits=state.edits||{};
      state.edits.full_name=C('full').value.trim();
      state.edits.passport=C('idp').value.trim();
      state.edits.street=C('street').value.trim();
      state.edits.city=C('city').value.trim();
      state.edits.zip=C('zip').value.trim();
      step=2; state.progress=step; save(); render();
    };
  }

  function step2(){
    C('content').innerHTML =
      '<h3>Choose products</h3>'
      + '<div class="field"><label>Product selection</label><textarea id="products" rows="3" placeholder="e.g., FTTH 50/50, Router, Installation"></textarea></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="next">Continue</button></div>';
    C('back').onclick=(e)=>{e.preventDefault(); step=1; state.progress=step; save(); render();};
    C('next').onclick=(e)=>{e.preventDefault(); state.products=C('products').value.trim(); step=3; state.progress=step; save(); render();};
  }

  function step3(){
    C('content').innerHTML =
      '<h3>Uploads</h3>'
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
        if(file.size>5*1024*1024){ msg.textContent='Max file size 5MB'; throw new Error('big'); }
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

  function step4(){
    C('content').innerHTML =
      '<h3>Master Service Agreement</h3>'
      + '<div class="field"><label><input type="checkbox" id="agree"> I accept the terms</label></div>'
      + '<div class="field"><label>Draw your signature</label><canvas id="sig" width="600" height="160" style="border:1px solid #ddd;border-radius:10px;background:#fff"></canvas>'
      + '<div class="row"><button class="btn outl" id="clear">Clear</button><span class="note" id="msg"></span></div></div>'
      + '<div class="row"><button class="btn outl" id="back">Back</button><button class="btn" id="sign">Agree & Sign</button></div>';
    const canvas=C('sig'), ctx=canvas.getContext('2d'); let drawing=false, drawn=false;
    canvas.onmousedown=e=>{ drawing=true; drawn=true; ctx.beginPath(); ctx.moveTo(e.offsetX,e.offsetY); };
    canvas.onmousemove=e=>{ if(drawing){ ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); } };
    window.onmouseup=()=>{ drawing=false; };
    C('clear').onclick=(e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); drawn=false; };
    C('back').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; save(); render(); };
    C('sign').onclick=async(e)=>{
      e.preventDefault();
      const msg=C('msg');
      if(!C('agree').checked) { msg.textContent='Please accept the terms.'; return; }
      if(!drawn) { msg.textContent='Please draw your signature.'; return; }
      msg.textContent='Saving...';
      const dataUrl=canvas.toDataURL('image/png');
      const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})});
      const d=await r.json().catch(()=>({}));
      if(d.ok){ step=5; state.progress=step; save(); render(); } else { msg.textContent='Could not save signature.'; }
    };
  }

  function step5(){
    const showDebit = !!(state && state.debit && state.debit.account_holder);
    C('content').innerHTML =
      '<h3>All done!</h3>'
      + '<p>Thanks — your onboarding is submitted.</p>'
      + '<p><b>Documents:</b> <a target="_blank" href="/agreements/pdf/msa/'+linkid+'">MSA</a>'
      + (showDebit ? ' · <a target="_blank" href="/agreements/pdf/debit/'+linkid+'">Debit Order</a>' : '')
      + '</p>';
  }

  function render(){
    [step0,step1,step2,step3,step4,step5][step]();
  }

  // important: actually call load()
  load();
})();
</script>
</body></html>`;
}

/* ========= WORKER ROUTES ========= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Root -> admin
    if (path === "/" && method === "GET") {
      return Response.redirect(new URL("/admin", request.url), 302);
    }

    // Admin UI
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(adminHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      return new Response(onboardHTML(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Admin: create link
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const b = await request.json().catch(()=>({}));
      const id = (b.id||"").toString().trim();
      if (!id) return json({ error:"missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = id + "_" + token;
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ splynx_id:id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: url.origin + "/onboard/" + linkid });
    }

    // Admin: list sessions (views: pending, completed, all)
    if (path === "/api/admin/sessions" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const view = url.searchParams.get("view") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/" });
      const items = [];
      for (const k of list.keys) {
        const linkid = k.name.split("/").pop();
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const status = s.status || (s.agreement_signed ? "completed" : "pending");
        const entry = {
          linkid,
          splynx_id: s.splynx_id || (linkid.split("_")[0]),
          status,
          last_time: s.last_time || s.created || Date.now(),
          has_debit: !!s.debit_sig_key
        };
        if (view === "pending" && status === "pending") items.push(entry);
        else if (view === "completed" && (status === "completed" || status === "pushed" || s.agreement_signed)) items.push(entry);
        else if (view === "all") items.push(entry);
      }
      return json({ ok:true, items });
    }

    // Admin: get single session (incl. uploads)
    if (path.startsWith("/api/admin/session/") && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const up = await env.R2_UPLOADS.list({ prefix: "uploads/" + linkid + "/" });
      return json({ ok:true, session:s, uploads: (up.objects||[]).map(o=>({ key:o.key, size:o.size, uploaded:o.uploaded })) });
    }

    // Admin: patch edits
    if (path.startsWith("/api/admin/session/") && method === "PATCH") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const b = await request.json().catch(()=>({}));
      const edits = { ...(s.edits || {}), ...((b.edits)||{}) };
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ ...s, edits, last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin: delete (soft)
    if (path.startsWith("/api/admin/session/") && method === "DELETE") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ ...s, status:"deleted", last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin: push to Splynx (edits + docs + uploads)
    if (path.startsWith("/api/admin/push/") && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!s) return json({ ok:false, error:"not_found" }, 404);
      const idOnly = (linkid.split("_")[0] || "").trim();
      const type = await tryLeadOrCustomer(env, idOnly);
      if (!type) return json({ ok:false, error:"id_unknown" }, 404);

      // Patch fields
      try {
        const data = { ...(s.edits||{}) };
        if (type === "lead") await splynxPATCH(env, `/admin/crm/leads/${idOnly}`, data);
        else await splynxPATCH(env, `/admin/customers/customer/${idOnly}`, data);
      } catch (e) {
        return json({ ok:false, error:"patch_failed" }, 502);
      }

      // Upload PDFs (generate on the fly)
      try {
        const msa = await renderMSA(env, linkid, false);
        const b = await msa.arrayBuffer();
        await splynxUploadDoc(env, type, idOnly, "msa.pdf", b, "application/pdf");
      } catch {}
      try {
        if (s.debit_sig_key) {
          const deb = await renderDEBIT(env, linkid, false);
          const b = await deb.arrayBuffer();
          await splynxUploadDoc(env, type, idOnly, "debit-order.pdf", b, "application/pdf");
        }
      } catch {}

      // Upload client uploads
      try {
        const files = await env.R2_UPLOADS.list({ prefix: "uploads/" + linkid + "/" });
        for (const o of (files.objects||[])) {
          const obj = await env.R2_UPLOADS.get(o.key); if (!obj) continue;
          const arr = await obj.arrayBuffer();
          const name = o.key.split("/").pop() || "upload.bin";
          await splynxUploadDoc(env, type, idOnly, name, arr, obj.httpMetadata?.contentType || "application/octet-stream");
        }
      } catch {}

      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ ...s, status:"pushed", pushed_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true, id:idOnly, type });
    }

    // Terms text (optional, kept simple)
    if (path === "/api/terms" && method === "GET") {
      return new Response("<p>Terms are available on request.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Session (client)
    if (path.startsWith("/api/session/") && method === "GET") {
      const linkid = path.split("/").pop();
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!s) return json({ error:"invalid" }, 404);
      return json(s);
    }

    // Progress save (captures audit)
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/").pop();
      const body = await request.json().catch(()=>({}));
      const existing = await env.ONBOARD_KV.get("onboard/" + linkid, "json") || {};
      const last_loc = {
        city: cf.city || "", region: cf.region || "", country: cf.country || "",
        latitude: cf.latitude || "", longitude: cf.longitude || "",
        timezone: cf.timezone || "", postalCode: cf.postalCode || "",
        asn: cf.asn || "", asOrganization: cf.asOrganization || "", colo: cf.colo || ""
      };
      const last_ip = getIP();
      const last_ua = getUA();
      const device_id = existing.device_id || await deviceIdFromParts([last_ua, last_ip, cf.asn||"", cf.colo||"", (linkid||"").slice(0,8)]);
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads (R2)
    if (path === "/api/onboard/upload" && method === "POST") {
      const linkid = url.searchParams.get("linkid") || "";
      const name = url.searchParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get("onboard/" + linkid, "json");
      if (!sess) return json({ ok:false, error:"invalid link" }, 404);
      const buf = await request.arrayBuffer();
      const key = "uploads/" + linkid + "/" + Date.now() + "_" + name;
      await env.R2_UPLOADS.put(key, buf);
      return json({ ok:true, key });
    }

    // Sign (MSA)
    if (path === "/api/sign" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const linkid = b.linkid || "";
      const dataUrl = b.dataUrl || "";
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"invalid" }, 400);
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const key = "agreements/" + linkid + "/signature.png";
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json") || {};
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ ...s, agreement_signed:true, agreement_sig_key:key, last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Debit signature (optional route kept for parity)
    if (path === "/api/debit/sign" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const linkid = b.linkid || "";
      const dataUrl = b.dataUrl || "";
      if (!linkid || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"invalid" }, 400);
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const key = "debit_agreements/" + linkid + "/signature.png";
      await env.R2_UPLOADS.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const s = await env.ONBOARD_KV.get("onboard/" + linkid, "json") || {};
      await env.ONBOARD_KV.put("onboard/" + linkid, JSON.stringify({ ...s, debit_sig_key:key, last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Serve PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const parts = path.split("/");
      const type = parts[3]; const linkid = parts[4];
      const bboxQ = url.searchParams.get("bbox") === "1";
      try {
        if (type === "msa") return await renderMSA(env, linkid, bboxQ);
        if (type === "debit") return await renderDEBIT(env, linkid, bboxQ);
        return new Response("Unknown", { status: 404 });
      } catch (e) {
        return new Response("PDF error", { status: 500 });
      }
    }

    // Helper to fetch a raw R2 object (admin modal links)
    if (path.startsWith("/r2/") && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const key = decodeURIComponent(path.slice(4));
      const obj = await env.R2_UPLOADS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream" } });
    }

    // Splynx lookup (normalized)
    if (path === "/api/splynx/lookup" && method === "POST") {
      const { id, type } = await request.json().catch(()=>({}));
      if (!id) return json({ ok:false, error:"missing_id" }, 400);

      async function tryJson(ep) {
        const r = await fetch(env.SPLYNX_API + ep, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }});
        const t = await r.text();
        if (!r.ok) throw new Error(String(r.status));
        try { return JSON.parse(t); } catch { throw new Error("parse"); }
      }

      let out=null;
      if (type==="lead" || type==="auto" || !type) {
        try {
          const j = await tryJson(`/admin/crm/leads/${id}`);
          out = { type:"lead", id:j.id, email:j.email, phone:j.phone, name:j.name||j.full_name||"", address:j.address||j.street||"", additional_attributes:j.additional_attributes||{} };
        } catch {}
      }
      if (!out && (type==="customer" || type==="auto" || !type)) {
        try {
          const j = await tryJson(`/admin/customers/customer/${id}`);
          out = { type:"customer", id:j.id, email:j.email||j.billing_email||"", phone:j.phone||"", name:[j.first_name||"",j.last_name||""].join(" ").trim(), address:j.address||j.street||"", additional_attributes:j.additional_attributes||{} };
        } catch {}
      }

      if (!out) return json({ ok:false, error:"not_found" }, 404);
      return json({ ok:true, ...out });
    }

    return new Response("Not found", { status: 404 });
  }
};
