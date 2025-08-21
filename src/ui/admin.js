// src/ui/admin.js

// ---- small helpers (no external deps) ----
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ESC_MAP[m]); }
function fmtKB(bytes) {
  if (bytes === 0) return "0 KB";
  if (!bytes && bytes !== 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  return (kb / 1024).toFixed(1) + " MB";
}

// ---- MAIN DASHBOARD PAGE ----
export function renderAdminPage() {
  return (
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
'<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
'<title>Vinet Onboarding – Admin</title>' +
'<style>' +
'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;color:#222;margin:0}' +
'header{background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}' +
'.wrap{max-width:1100px;margin:0 auto;padding:18px 16px}' +
'h1{margin:0;font-size:22px;color:#e2001a}' +
'.controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 10px}' +
'.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px}' +
'label{font-size:12px;color:#444;font-weight:700;display:block;margin:0 0 6px}' +
'input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}' +
'.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700}' +
'.btn.secondary{background:#fff;color:#e2001a;border:2px solid #e2001a}' +
'.btn.link{background:transparent;border:0;color:#0b69c7;padding:0 4px;cursor:pointer}' +
'.cols{display:grid;grid-template-columns:1fr;gap:14px;margin-top:8px}' +
'@media(min-width:900px){.cols{grid-template-columns:1fr 1fr}}' +
'.section h2{margin:6px 0 10px;font-size:18px;color:#333}' +
'.list{display:grid;gap:10px}' +
'.entry{border:1px solid #eee;border-radius:12px;padding:12px;background:#fff}' +
'.entry h3{margin:0 0 5px;font-size:16px;color:#222}' +
'.muted{color:#666;font-size:12px}' +
'.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}' +
'.row a{color:#0b69c7;text-decoration:none} .row a:hover{text-decoration:underline}' +
'.chip{background:#f1f3f7;border-radius:999px;padding:4px 10px;font-size:12px}' +
'.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
'.mono{font-family:ui-monospace,Menlo,Consolas,monospace}' +
'.empty{border:1px dashed #ddd;border-radius:12px;padding:14px;color:#777;text-align:center}' +
'.tabs{display:flex;gap:8px;margin:12px 0 8px}' +
'.tabs .tab{padding:6px 10px;border-radius:999px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:12px}' +
'.tabs .tab.active{border-color:#e2001a;color:#e2001a;font-weight:700}' +
'.modal{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center;z-index:20}' +
'.modal .dialog{background:#fff;border-radius:12px;max-width:520px;width:92%;padding:16px;border:1px solid #eee}' +
'.dialog h3{margin:0 0 8px;font-size:18px}' +
'.dialog .mono-box{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px;word-break:break-all}' +
'.top-help{font-size:12px;color:#666;margin:6px 0 0}' +
'</style></head><body>' +
'<header><div class="wrap"><h1>Vinet Onboarding – Admin</h1></div></header>' +
'<div class="wrap">' +
  '<div class="controls">' +
    '<div class="card">' +
      '<label>Generate Onboard link (Splynx ID)</label>' +
      '<div class="row">' +
        '<input id="gen_id" placeholder="e.g. 319" />' +
        '<button class="btn" id="btn_gen">Generate</button>' +
      '</div>' +
      '<div class="top-help">Creates a unique onboarding URL for the customer.</div>' +
    '</div>' +
    '<div class="card">' +
      '<label>Generate Verification code (linkid)</label>' +
      '<div class="row">' +
        '<input id="ver_linkid" placeholder="e.g. 319_abcd1234" />' +
        '<button class="btn" id="btn_ver">Generate</button>' +
      '</div>' +
      '<div class="top-help">Issues a 6‑digit staff verification code for the given link.</div>' +
    '</div>' +
  '</div>' +

  '<div class="tabs">' +
    '<button class="tab active" data-tab="inprog">In Progress</button>' +
    '<button class="tab" data-tab="pending">Pending</button>' +
    '<button class="tab" data-tab="approved">Approved</button>' +
  '</div>' +

  '<div class="cols">' +
    '<div class="section card" id="sec_inprog"><h2>In Progress</h2><div class="list" id="list_inprog"></div></div>' +
    '<div class="section card" id="sec_pending"><h2>Pending</h2><div class="list" id="list_pending"></div></div>' +
  '</div>' +

  '<div class="section card" id="sec_approved" style="margin-top:12px;"><h2>Approved</h2><div class="list" id="list_approved"></div></div>' +
'</div>' +

'<div class="modal" id="modal">' +
  '<div class="dialog">' +
    '<h3 id="modal_title"></h3>' +
    '<div class="mono-box" id="modal_body"></div>' +
    '<div class="row" style="margin-top:10px">' +
      '<button class="btn secondary" id="modal_copy">Copy</button>' +
      '<button class="btn" id="modal_close">Close</button>' +
    '</div>' +
  '</div>' +
'</div>' +

'<script>' +
// modal helpers
'const $ = (s)=>document.querySelector(s);' +
'const $all=(s)=>Array.from(document.querySelectorAll(s));' +
'const modal=$("#modal"), mTitle=$("#modal_title"), mBody=$("#modal_body");' +
'$("#modal_close").onclick=()=>{ modal.style.display="none"; };' +
'$("#modal_copy").onclick=()=>{ const txt=mBody.textContent||""; navigator.clipboard.writeText(txt).catch(()=>{}); };' +
'function showModal(title, body){ mTitle.textContent=title; mBody.textContent=body; modal.style.display="flex"; }' +

'const rBase = (window.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org");' +

'function fmtKB(bytes){ if(bytes===0) return "0 KB"; if(!bytes&&bytes!==0) return ""; const kb=bytes/1024; if(kb<1024) return kb.toFixed(1)+" KB"; return (kb/1024).toFixed(1)+" MB"; }' +

'function cardHTML(item){' +
'  const linkid = item.linkid;' +
'  const edits = item.edits||{};' +
'  const name = edits.full_name || "";' +
'  const uploads=(item.uploads||[]).map(u=>{' +
'    const url = rBase + "/" + u.key;' +
'    const sizeStr = fmtKB(u.size);' +
'    return "<li><a href=\\"" + url + "\\" target=\\"_blank\\">" + (u.name||"file") + "</a> <span class=\\"muted\\">" + sizeStr + "</span></li>";' +
'  }).join("");' +
'  const quick = [' +
'    "<a href=\\"/admin/review?linkid=" + linkid + "\\">Review</a>",' +
'    "<a href=\\"/agreements/msa/" + linkid + "\\" target=\\"_blank\\">MSA</a>",' +
'    "<a href=\\"/agreements/debit/" + linkid + "\\" target=\\"_blank\\">Debit</a>"' +
'  ].join(" · ");' +
'  return (' +
'    "<div class=\\"entry\\">" +' +
'      "<h3>Customer/Lead " + (item.id||"") + "</h3>" +' +
'      "<div class=\\"muted\\">" + (name ? ("Name: " + name) : "No name yet") + "</div>" +' +
'      "<div class=\\"muted\\">Updated: " + (new Date(item.updated||0).toLocaleString()) + "</div>" +' +
'      (uploads ? ("<ul style=\\"margin:8px 0;\\">" + uploads + "</ul>") : "<div class=\\"muted\\">No uploads</div>") +' +
'      "<div class=\\"row\\">" + quick + "</div>" +' +
'      "<div class=\\"actions\\">" +' +
'        "<button class=\\"btn\\" data-approve=\\"" + linkid + "\\">Approve</button>" +' +
'        "<button class=\\"btn secondary\\" data-reject=\\"" + linkid + "\\">Reject</button>" +' +
'        "<button class=\\"btn secondary\\" data-delete=\\"" + linkid + "\\">Delete</button>" +' +
'      "</div>" +' +
'    "</div>"' +
'  );' +
'}' +

'async function loadLists(which){' +
'  const load = async (mode, target) => {' +
'    const r = await fetch("/api/admin/list?mode=" + mode);' +
'    const d = await r.json().catch(()=>({items:[]}));' +
'    const html = (d.items||[]).map(cardHTML).join("") || "<div class=\\"empty\\">No records</div>";' +
'    document.getElementById(target).innerHTML = html;' +
'  };' +
'  await Promise.all([' +
'    load("inprog", "list_inprog"),' +
'    load("pending", "list_pending"),' +
'    load("approved","list_approved")' +
'  ]);' +
'  bindActions();' +
'}' +

'function bindActions(){' +
// Approve
'  $all("[data-approve]").forEach(btn=>{' +
'    btn.onclick = async()=>{' +
'      const linkid = btn.getAttribute("data-approve");' +
'      const r = await fetch("/api/admin/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'      if(!r.ok){ alert("Approve failed"); return; }' +
'      loadLists();' +
'    };' +
'  });' +
// Reject
'  $all("[data-reject]").forEach(btn=>{' +
'    btn.onclick = async()=>{' +
'      const linkid = btn.getAttribute("data-reject");' +
'      const reason = prompt("Reason for rejection? (optional)","");' +
'      const r = await fetch("/api/admin/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid,reason})});' +
'      if(!r.ok){ alert("Reject failed"); return; }' +
'      loadLists();' +
'    };' +
'  });' +
// Delete (wipe session + KV + R2 via server)
'  $all("[data-delete]").forEach(btn=>{' +
'    btn.onclick = async()=>{' +
'      const linkid = btn.getAttribute("data-delete");' +
'      if(!confirm("Delete this onboarding session and all associated records?")) return;' +
'      const r = await fetch("/api/admin/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'      if(!r.ok){ alert("Delete failed"); return; }' +
'      loadLists();' +
'    };' +
'  });' +
'}' +

// tabs
'$all(".tabs .tab").forEach(t=>{' +
'  t.onclick = ()=>{' +
'    $all(".tabs .tab").forEach(x=>x.classList.remove("active"));' +
'    t.classList.add("active");' +
'    const tab = t.getAttribute("data-tab");' +
'    $("#sec_inprog").style.display = (tab==="inprog"?"block":"none");' +
'    $("#sec_pending").style.display = (tab==="pending"?"block":"none");' +
'    $("#sec_approved").style.display = (tab==="approved"?"block":"none");' +
'  };' +
'});' +
// default state
'$("#sec_inprog").style.display="block";' +
'$("#sec_pending").style.display="block";' +
'$("#sec_approved").style.display="block";' +

// Generate onboard
'$("#btn_gen").onclick = async ()=>{' +
'  const id = ($("#gen_id").value||"").trim();' +
'  if(!id){ alert("Enter the Splynx ID"); return; }' +
'  const r = await fetch("/api/admin/genlink",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});' +
'  const d = await r.json().catch(()=>({}));' +
'  if(!d.url){ alert("Failed to generate link"); return; }' +
'  showModal("Onboarding link", d.url);' +
'  loadLists();' +
'};' +

// Generate staff verification
'$("#btn_ver").onclick = async ()=>{' +
'  const linkid = ($("#ver_linkid").value||"").trim();' +
'  if(!linkid){ alert("Enter the linkid"); return; }' +
'  const r = await fetch("/api/staff/gen",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'  const d = await r.json().catch(()=>({}));' +
'  if(!d.ok){ alert("Failed to generate code"); return; }' +
'  showModal("Verification code", "Code for " + linkid + ": " + (d.code||""));' +
'};' +

'loadLists();' +
'</script>' +
'</body></html>'
  );
}

// ---- REVIEW PAGE (now loads LIVE Splynx profile and shows side‑by‑side diff) ----
export function renderAdminReviewHTML({ linkid, sess, r2PublicBase }) {
  const uploads = Array.isArray(sess?.uploads) ? sess.uploads : [];
  const msaPdf   = "/pdf/msa/"   + linkid;
  const msaHtml  = "/agreements/msa/" + linkid;
  const debitPdf = "/pdf/debit/" + linkid;
  const debitHtml= "/agreements/debit/" + linkid;
  const splynxId = String(sess?.id || "");

  // Build attachment list (R2 public)
  const filesHTML = uploads.length
    ? ('<ul>' + uploads.map(u => {
        const url = (r2PublicBase || "https://onboarding-uploads.vinethosting.org") + "/" + esc(u.key);
        const name = esc(u.name || "file");
        return '<li><a target="_blank" href="' + url + '">' + name + '</a> <span class="muted">' + esc(fmtKB(u.size)) + '</span></li>';
      }).join("") + '</ul>')
    : '<div class="empty">No attachments uploaded</div>';

  return (
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
'<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
'<title>Admin Review</title>' +
'<style>' +
'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;color:#222;margin:0}' +
'header{background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}' +
'.wrap{max-width:980px;margin:0 auto;padding:18px 16px}' +
'h1{margin:0;font-size:22px;color:#e2001a}' +
'.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px;margin-top:12px}' +
'h2{margin:4px 0 10px;font-size:18px}' +
'table.diff{width:100%;border-collapse:collapse}' +
'table.diff th, table.diff td{border:1px solid #eee;padding:8px;vertical-align:top}' +
'table.diff th{background:#fafafa;text-align:left}' +
'.muted{color:#666;font-size:12px}' +
'.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}' +
'.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700}' +
'.btn.secondary{background:#fff;color:#e2001a;border:2px solid #e2001a}' +
'.empty{border:1px dashed #ddd;border-radius:12px;padding:14px;color:#777;text-align:center}' +
'a{color:#0b69c7;text-decoration:none} a:hover{text-decoration:underline}' +
'.badge{display:inline-block;border-radius:6px;padding:2px 6px;font-size:11px;margin-left:6px}' +
'.badge.changed{background:#ffefe8;color:#9b2c00;border:1px solid #ffd7c2}' +
'.badge.same{background:#eef8f0;color:#1f6f3f;border:1px solid #cfead7}' +
'.mono{font-family:ui-monospace,Menlo,Consolas,monospace}' +
'</style></head><body>' +
'<header><div class="wrap"><h1>Review & Approve</h1></div></header>' +
'<div class="wrap">' +

  '<div class="card">' +
    '<div class="row">' +
      '<button class="btn secondary" onclick="location.href=\'/\'">Back to Dashboard</button>' +
      '<div class="muted">Link: ' + esc(linkid) + ' &nbsp;·&nbsp; Splynx ID: ' + esc(splynxId) + '</div>' +
    '</div>' +
  '</div>' +

  '<div class="card">' +
    '<h2>Client‑edited details</h2>' +
    '<div id="diff_box" class="muted">Loading live Splynx profile…</div>' +
  '</div>' +

  '<div class="card">' +
    '<h2>Attachments</h2>' +
    filesHTML +
  '</div>' +

  '<div class="card">' +
    '<h2>Agreements</h2>' +
    '<div class="row">' +
      '<a class="btn" target="_blank" href="' + esc(msaPdf) + '">MSA PDF</a>' +
      '<a class="btn secondary" target="_blank" href="' + esc(msaHtml) + '">MSA (HTML)</a>' +
      '<a class="btn" target="_blank" href="' + esc(debitPdf) + '">Debit Order PDF</a>' +
      '<a class="btn secondary" target="_blank" href="' + esc(debitHtml) + '">Debit (HTML)</a>' +
    '</div>' +
  '</div>' +

  '<div class="card">' +
    '<h2>Decision</h2>' +
    '<div class="row">' +
      '<button class="btn" id="approve">Approve</button>' +
      '<button class="btn secondary" id="reject">Reject</button>' +
      '<button class="btn secondary" id="del">Delete</button>' +
    '</div>' +
  '</div>' +

'</div>' +

'<script>' +
// safe esc in page
'const ESC_MAP={ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\\' + "'" + '":"&#39;" };' +
'function esc(s){ return String(s??"").replace(/[&<>\"\\' + "'" + ']/g,m=>ESC_MAP[m]); }' +
'function diffRow(label, beforeVal, afterVal){' +
'  const b = esc(beforeVal ?? "");' +
'  const a = esc(afterVal ?? "");' +
'  const changed = (b !== a);' +
'  const mark = changed ? \'<span class="badge changed">changed</span>\' : \'<span class="badge same">same</span>\';' +
'  return (' +
'    "<tr>" +' +
'      "<th>" + esc(label) + "</th>" +' +
'      "<td class=\\"mono\\">" + b + "</td>" +' +
'      "<td class=\\"mono\\">" + a + "</td>" +' +
'      "<td>" + mark + "</td>" +' +
'    "</tr>"' +
'  );' +
'}' +
'const linkid = ' + JSON.stringify(linkid) + ';' +
'const splynxId = ' + JSON.stringify(splynxId) + ';' +
'const edits = ' + JSON.stringify(sess?.edits || {}) + ';' +

'async function loadLive(){' +
'  const box = document.getElementById("diff_box");' +
'  if(!splynxId){ box.textContent = "No Splynx ID on record."; return; }' +
'  try{' +
'    const r = await fetch("/api/splynx/profile?id="+encodeURIComponent(splynxId));' +
'    if(!r.ok) throw new Error("lookup failed");' +
'    const p = await r.json();' +
'    const rows = [' +
'      diffRow("Full name",  p.full_name, edits.full_name),' +
'      diffRow("Email",      p.email,     edits.email),' +
'      diffRow("Phone",      p.phone,     edits.phone),' +
'      diffRow("ID/Passport",p.passport,  edits.passport),' +
'      diffRow("Street",     p.street,    edits.street),' +
'      diffRow("City",       p.city,      edits.city),' +
'      diffRow("ZIP",        p.zip,       edits.zip)' +
'    ].join("");' +
'    box.innerHTML = ' +
'      "<table class=\\"diff\\">" +' +
'        "<thead><tr><th>Field</th><th>Original (Splynx)</th><th>Submitted</th><th>Status</th></tr></thead>" +' +
'        "<tbody>" + rows + "</tbody>" +' +
'      "</table>";' +
'  }catch(e){ box.textContent = "Failed to load Splynx profile."; }' +
'}' +
'loadLive();' +

'document.getElementById("approve").onclick = async()=>{' +
'  const r=await fetch("/api/admin/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'  if(!r.ok){ alert("Approve failed"); return; }' +
'  location.href="/";' +
'};' +
'document.getElementById("reject").onclick = async()=>{' +
'  const reason = prompt("Reason for rejection? (optional)","");' +
'  const r=await fetch("/api/admin/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid,reason})});' +
'  if(!r.ok){ alert("Reject failed"); return; }' +
'  location.href="/";' +
'};' +
'document.getElementById("del").onclick = async()=>{' +
'  if(!confirm("Delete this onboarding session and all associated records?")) return;' +
'  const r=await fetch("/api/admin/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'  if(!r.ok){ alert("Delete failed"); return; }' +
'  location.href="/";' +
'};' +
'</script>' +
'</body></html>'
  );
}
