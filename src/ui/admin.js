// src/ui/admin.js

// ---- tiny helpers ----
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ESC_MAP[m]); }
function fmtKB(bytes) {
  if (bytes === 0) return "0 KB";
  if (!bytes && bytes !== 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  return (kb / 1024).toFixed(1) + " MB";
}

// =================== DASHBOARD ===================
export function renderAdminPage() {
  const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
  return (
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
'<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
'<title>Vinet Onboarding – Admin</title>' +
'<style>' +
'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;color:#222;margin:0}' +
'header{background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}' +
'.wrap{max-width:1100px;margin:0 auto;padding:18px 16px}' +
'.brand{display:flex;align-items:center;gap:14px}' +
'.brand img{height:46px}' +
'.brand h1{margin:0;font-size:22px;color:#e2001a}' +
'.controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 10px}' +
'.card{background:#fff;border:1px solid #eee;border-radius:12px;padding:14px}' +
'label{font-size:12px;color:#444;font-weight:700;display:block;margin:0 0 6px}' +
'input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:10px;background:#fafafa}' +
'.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:700}' +
'.btn.secondary{background:#fff;color:#e2001a;border:2px solid #e2001a}' +
'.cols{display:grid;grid-template-columns:1fr;gap:14px;margin-top:8px}' +
'@media(min-width:900px){.cols{grid-template-columns:1fr 1fr}}' +
'.section h2{margin:6px 0 10px;font-size:18px;color:#333}' +
'.list{display:grid;gap:10px}' +
'.entry{border:1px solid #eee;border-radius:12px;padding:12px;background:#fff}' +
'.entry h3{margin:0 0 5px;font-size:16px;color:#222}' +
'.muted{color:#666;font-size:12px}' +
'.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}' +
'.row a{color:#0b69c7;text-decoration:none} .row a:hover{text-decoration:underline}' +
'.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}' +
'.empty{border:1px dashed #ddd;border-radius:12px;padding:14px;color:#777;text-align:center}' +
'.tabs{display:flex;gap:8px;margin:12px 0 8px}' +
'.tabs .tab{padding:6px 10px;border-radius:999px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:12px}' +
'.tabs .tab.active{border-color:#e2001a;color:#e2001a;font-weight:700}' +
'.toggleBoth{margin:2px 0 10px;font-size:12px;color:#0b69c7;cursor:pointer}' +
'.diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}' +
'.diff h3{margin:6px 0;font-size:14px;color:#e2001a}' +
'.diff table{width:100%;border-collapse:collapse;font-size:13px}' +
'.diff td{border-bottom:1px solid #eee;padding:4px 6px;vertical-align:top}' +
'.diff .label{font-weight:700;color:#444}' +
'</style></head><body>' +
'<header><div class="wrap">' +
  '<div class="brand"><img src="' + LOGO_URL + '" alt="Vinet"><h1>Vinet Onboarding – Admin</h1></div>' +
'</div></header>' +

'<div class="wrap">' +
  '<div class="controls">' +
    '<div class="card">' +
      '<label>Generate Onboard link (Splynx ID)</label>' +
      '<div class="row">' +
        '<input id="gen_id" placeholder="e.g. 319" />' +
        '<button class="btn" id="btn_gen">Generate</button>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<label>Generate Verification code (linkid)</label>' +
      '<div class="row">' +
        '<input id="ver_linkid" placeholder="e.g. 319_abcd1234" />' +
        '<button class="btn" id="btn_ver">Generate</button>' +
      '</div>' +
    '</div>' +
  '</div>' +

  '<div class="tabs">' +
    '<button class="tab active" data-tab="dual">In Progress + Pending</button>' +
    '<button class="tab" data-tab="inprog">In Progress</button>' +
    '<button class="tab" data-tab="pending">Pending</button>' +
    '<button class="tab" data-tab="approved">Approved</button>' +
  '</div>' +

  '<div class="toggleBoth" id="showBoth" style="display:none">↩ Show both “In Progress” and “Pending”</div>' +

  '<div class="cols" id="dual_cols">' +
    '<div class="section card" id="sec_inprog"><h2>In Progress</h2><div class="list" id="list_inprog"></div></div>' +
    '<div class="section card" id="sec_pending"><h2>Pending</h2><div class="list" id="list_pending"></div></div>' +
  '</div>' +

  '<div class="section card" id="sec_approved" style="margin-top:12px; display:none;"><h2>Approved</h2><div class="list" id="list_approved"></div></div>' +
'</div>' +

'<script>' +
'const $ = (s)=>document.querySelector(s); const $all=(s)=>Array.from(document.querySelectorAll(s));' +
'function showModal(t,b){alert(t+"\\n"+b);}' +
'const rBase=(window.R2_PUBLIC_BASE||"https://onboarding-uploads.vinethosting.org");' +
'function fmtKB(bytes){ if(bytes===0) return "0 KB"; if(!bytes&&bytes!==0) return ""; const kb=bytes/1024; if(kb<1024) return kb.toFixed(1)+" KB"; return (kb/1024).toFixed(1)+" MB"; }' +

'function cardHTML(item){ const linkid=item.linkid; const name=(item.edits?.full_name)||""; const uploads=(item.uploads||[]).map(u=>"<li><a href=\\""+rBase+"/"+u.key+"\\" target=\\"_blank\\">"+(u.name||"file")+"</a> <span class=muted>"+fmtKB(u.size)+"</span></li>").join(""); const quick=["<a href=/admin/review?linkid="+linkid+">Review</a>","<a href=/agreements/msa/"+linkid+" target=_blank>MSA</a>","<a href=/agreements/debit/"+linkid+" target=_blank>Debit</a>"].join(" · "); return "<div class=entry><h3>Customer/Lead "+(item.id||"")+"</h3><div class=muted>"+(name?("Name: "+name):"No name yet")+"</div><div class=muted>Updated: "+(new Date(item.updated||0).toLocaleString())+"</div>"+(uploads?("<ul>"+uploads+"</ul>"):"<div class=muted>No uploads</div>")+"<div class=row>"+quick+"</div><div class=actions><button class=btn data-approve="+linkid+">Approve</button><button class=\'btn secondary\' data-reject="+linkid+">Reject</button><button class=\'btn secondary\' data-delete="+linkid+">Delete</button></div></div>"; }' +

'async function loadLists(){ const load=async(m,t)=>{const r=await fetch("/api/admin/list?mode="+m);const d=await r.json().catch(()=>({items:[]}));document.getElementById(t).innerHTML=(d.items||[]).map(cardHTML).join("")||"<div class=empty>No records</div>";}; await Promise.all([load("inprog","list_inprog"),load("pending","list_pending"),load("approved","list_approved")]); bindActions(); }' +

'function bindActions(){ $all("[data-approve]").forEach(b=>{b.onclick=async()=>{const id=b.getAttribute("data-approve");await fetch("/api/admin/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid:id})});loadLists();};}); $all("[data-reject]").forEach(b=>{b.onclick=async()=>{const id=b.getAttribute("data-reject");const reason=prompt("Reason?","");await fetch("/api/admin/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid:id,reason})});loadLists();};}); $all("[data-delete]").forEach(b=>{b.onclick=async()=>{const id=b.getAttribute("data-delete");if(!confirm("Delete?"))return;await fetch("/api/admin/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid:id})});loadLists();};}); }' +

'$all(".tabs .tab").forEach(t=>{t.onclick=()=>{$all(".tabs .tab").forEach(x=>x.classList.remove("active"));t.classList.add("active");const m=t.dataset.tab;const dual=$("#dual_cols"),ap=$("#sec_approved"),both=$("#showBoth");if(m==="dual"){dual.style.display="grid";ap.style.display="none";both.style.display="none";return;}both.style.display="block";if(m==="approved"){dual.style.display="none";ap.style.display="block";}if(m==="inprog"){dual.style.display="block";ap.style.display="none";$("#sec_inprog").style.display="block";$("#sec_pending").style.display="none";}if(m==="pending"){dual.style.display="block";ap.style.display="none";$("#sec_inprog").style.display="none";$("#sec_pending").style.display="block";}}});' +
'$("#showBoth").onclick=()=>{$("#sec_inprog").style.display="block";$("#sec_pending").style.display="block";$all(".tabs .tab").forEach(x=>x.classList.remove("active"));$all(".tabs .tab")[0].classList.add("active");$("#dual_cols").style.display="grid";$("#sec_approved").style.display="none";$("#showBoth").style.display="none";};' +

'document.getElementById("btn_gen").onclick=async()=>{const id=document.getElementById("gen_id").value.trim(); if(!id) return alert("Enter Splynx ID"); const r=await fetch("/api/admin/genlink",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})}); const d=await r.json().catch(()=>({})); if(d.url) showModal("Onboarding link", d.url); loadLists();};' +
'document.getElementById("btn_ver").onclick=async()=>{const linkid=document.getElementById("ver_linkid").value.trim(); if(!linkid) return alert("Enter linkid"); const r=await fetch("/api/staff/gen",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})}); const d=await r.json().catch(()=>({})); if(d.ok) showModal("Staff code for "+linkid, d.code);};' +

'loadLists();' +
'</script>' +
'</body></html>'
  );
}

// =================== REVIEW PAGE ===================
export function renderAdminReviewHTML({ linkid, sess, r2PublicBase, splynxData }) {
  const edits = sess.edits || {};
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const s = splynxData || {};
  const f = (k)=>esc(edits[k]||"");
  const fs = (k)=>esc(s[k]||"");

  const uploadsHtml = uploads.map(function(u){
    const url = (r2PublicBase || "https://onboarding-uploads.vinethosting.org") + "/" + u.key;
    return '<li><a href="' + esc(url) + '" target="_blank">' + esc(u.name || 'file') + '</a> (' + fmtKB(u.size) + ')</li>';
  }).join("");

  return (
'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>' +
'<title>Review & Approve</title>' +
'<style>body{font-family:system-ui,sans-serif;margin:0;background:#fafafa;color:#222}.wrap{max-width:900px;margin:0 auto;padding:20px}.card{background:#fff;padding:16px;border-radius:12px;border:1px solid #eee}.diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}.diff h3{margin:6px 0;font-size:14px;color:#e2001a}.diff table{width:100%;border-collapse:collapse;font-size:13px}.diff td{border-bottom:1px solid #eee;padding:4px 6px;vertical-align:top}.diff .label{font-weight:700;color:#444}.actions{margin-top:14px;display:flex;gap:8px}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}.btn.secondary{background:#fff;color:#e2001a;border:2px solid #e2001a}.muted{color:#666;font-size:12px}.back{display:inline-block;margin-bottom:10px;text-decoration:none;color:#0b69c7}</style></head><body>' +
'<div class="wrap">' +
'<a class="back" href="/">← Back</a>' +
'<h2>Review & Approve</h2>' +
'<div class="card">' +
'<div class="diff">' +
'<div><h3>Submitted (Onboarding)</h3><table>' +
'<tr><td class="label">Full Name</td><td>'+f("full_name")+'</td></tr>' +
'<tr><td class="label">Email</td><td>'+f("email")+'</td></tr>' +
'<tr><td class="label">Phone</td><td>'+f("phone")+'</td></tr>' +
'<tr><td class="label">Passport/ID</td><td>'+f("passport")+'</td></tr>' +
'<tr><td class="label">Street</td><td>'+f("street")+'</td></tr>' +
'<tr><td class="label">City</td><td>'+f("city")+'</td></tr>' +
'<tr><td class="label">ZIP</td><td>'+f("zip")+'</td></tr>' +
'</table></div>' +
'<div><h3>Current (Splynx)</h3><table>' +
'<tr><td class="label">Full Name</td><td>'+fs("full_name")+'</td></tr>' +
'<tr><td class="label">Email</td><td>'+fs("email")+'</td></tr>' +
'<tr><td class="label">Phone</td><td>'+fs("phone")+'</td></tr>' +
'<tr><td class="label">Passport/ID</td><td>'+fs("passport")+'</td></tr>' +
'<tr><td class="label">Street</td><td>'+fs("street")+'</td></tr>' +
'<tr><td class="label">City</td><td>'+fs("city")+'</td></tr>' +
'<tr><td class="label">ZIP</td><td>'+fs("zip")+'</td></tr>' +
'</table></div>' +
'</div>' +

'<h3>Uploads</h3><ul>'+uploadsHtml+'</ul>' +

'<h3>Agreements</h3>' +
'<div class="row"><a href="/pdf/msa/'+esc(linkid)+'" target="_blank">MSA PDF</a> · <a href="/agreements/msa/'+esc(linkid)+'" target="_blank">MSA HTML</a>' +
((sess.pay_method === "debit") ? ' · <a href="/pdf/debit/'+esc(linkid)+'" target="_blank">Debit Order PDF</a> · <a href="/agreements/debit/'+esc(linkid)+'" target="_blank">Debit HTML</a>' : '') +
'</div>' +

'<div class="actions">' +
'<button class="btn" id="btnApprove">Approve & Push</button>' +
'<button class="btn secondary" id="btnReject">Reject</button>' +
'<button class="btn secondary" id="btnDelete">Delete</button>' +
'</div>' +

'</div></div>' +

'<script>' +
'(function(){' +
'const linkid = ' + JSON.stringify(linkid) + ';' +
'document.getElementById("btnApprove").onclick = async function(){' +
'  await fetch("/api/admin/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'  alert("Approved & pushed to Splynx."); location.href="/";' +
'};' +
'document.getElementById("btnReject").onclick = async function(){' +
'  const reason = prompt("Reason for rejection?","");' +
'  if (reason===null) return;' +
'  await fetch("/api/admin/reject",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid,reason})});' +
'  alert("Marked as rejected."); location.href="/";' +
'};' +
'document.getElementById("btnDelete").onclick = async function(){' +
'  if (!confirm("Delete this onboarding session and all related data?")) return;' +
'  await fetch("/api/admin/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({linkid})});' +
'  alert("Deleted."); location.href="/";' +
'};' +
'})();' +
'</script>' +

'</body></html>'
  );
}
