// /src/ui/admin.js
import { LOGO_URL } from "../constants.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[m]));
const fmtDT = (t) => {
  if (!t) return "";
  const d = new Date(t);
  const pad = (n)=> String(n).padStart(2,"0");
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const fmtKB = (n)=> (Math.round((Number(n||0)/1024)*10)/10) + " KB";

// ------- ADMIN DASH (Dashboard) -------
export function renderAdminPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>Admin Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--red:#e2001a;--ink:#222;--muted:#667;--chip:#fff}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7fb;color:var(--ink)}
  .card{background:#fff;max-width:1080px;margin:26px auto;padding:22px;border-radius:16px;box-shadow:0 2px 12px #0002}
  .logo{height:64px;display:block;margin:0 auto 8px}
  h1,h2,h3{color:var(--red);margin:.25em 0 .6em}
  label{font-weight:600;color:#222;font-size:.95em}
  input{border:1px solid #ddd;border-radius:10px;padding:10px 12px;width:100%;font-size:1em;background:#fafafa}
  .row{display:flex;gap:14px;flex-wrap:wrap}
  .col{flex:1 1 360px}
  .btn{background:var(--red);color:#fff;border:0;border-radius:999px;padding:.65em 1.4em;font-weight:700;cursor:pointer}
  .btn.small{padding:.45em .95em;font-weight:600}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:999px;padding:.5em 1.1em;font-weight:700;cursor:pointer}
  .btn-ghost{background:#fff;color:#222;border:2px solid #ddd;border-radius:999px;padding:.45em .9em;cursor:pointer}
  .btn-danger{color:#b00020;border-color:#b00020}
  .note{color:var(--muted);font-size:.9em}
  .section{margin:20px 0 14px}
  .tabs{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
  .tab{border:2px solid var(--red);color:var(--red);background:#fff;border-radius:999px;padding:.5em 1.1em;cursor:pointer}
  .tab.active{background:var(--red);color:#fff}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left}
  td.actions{white-space:nowrap}
  .empty{color:#778}
  .copy{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.95em}
  /* Modal */
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px}
  .modal.active{display:flex}
  .modal-card{background:#fff;max-width:640px;width:100%;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:18px}
  .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
  .modal-url{background:#f6f7fb;border:1px solid #e2e5ef;border-radius:10px;padding:12px 14px;font-size:15px;word-break:break-all}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h2 style="text-align:center">Admin Dashboard</h2>

  <!-- Row: Generate onboarding link + Generate verification code -->
  <div class="row">
    <div class="col">
      <h3>1. Generate onboarding link</h3>
      <label>Splynx Lead/Customer ID</label>
      <div class="row" style="align-items:flex-end">
        <div class="col"><input id="gen_id" placeholder="e.g. 319"></div>
        <div><button class="btn small" id="gen_btn">Generate</button></div>
      </div>
      <div class="note">A modal will show the generated URL.</div>
    </div>

    <div class="col">
      <h3>2. Generate verification code</h3>
      <label>Onboarding Link ID <span class="note">(e.g. 319_ab12cd34)</span></label>
      <div class="row" style="align-items:flex-end">
        <div class="col"><input id="staff_linkid" placeholder="319_xxxxxxxx"></div>
        <div><button class="btn small" id="staff_btn">Generate staff code</button></div>
      </div>
      <div class="note" id="staff_msg"></div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="section">
    <div class="tabs">
      <button class="tab active" data-mode="inprog">3. Pending (in‑progress)</button>
      <button class="tab" data-mode="pending">4. Completed (awaiting approval)</button>
      <button class="tab" data-mode="approved">5. Approved</button>
    </div>
    <div id="listBox"><div class="empty">Loading…</div></div>
  </div>
</div>

<!-- Modal: Generated URL -->
<div class="modal" id="linkModal" role="dialog" aria-modal="true">
  <div class="modal-card">
    <div class="modal-head">
      <h3 style="margin:0;color:#e2001a">Onboarding URL</h3>
      <button class="btn-ghost" id="closeModal">Close</button>
    </div>
    <div id="modalUrl" class="modal-url copy"></div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn" id="copyUrl">Copy link</button>
      <a class="btn-outline" id="openUrl" target="_blank" rel="noopener">Open</a>
    </div>
  </div>
</div>

<script>
(function(){
  const $ = (sel) => document.querySelector(sel);
  const listBox = $("#listBox");

  // Tabs
  let mode = "inprog";
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      mode = btn.getAttribute("data-mode");
      loadList();
    });
  });

  function row(linkid, id, updated, kind){
    const dt = ${fmtDT.toString()}(updated);
    const safeLink = "/onboard/" + encodeURIComponent(linkid);
    const review = "/admin/review?linkid=" + encodeURIComponent(linkid);

    if (kind === "inprog") {
      return \`<tr>
        <td>\${esc(id)}</td>
        <td class="copy">\${esc(linkid)}</td>
        <td>\${esc(dt)}</td>
        <td class="actions">
          <a class="btn-outline small" href="\${safeLink}" target="_blank">Open</a>
          <button class="btn-ghost small btn-danger" data-del="\${esc(linkid)}">Delete</button>
        </td>
      </tr>\`;
    }
    if (kind === "pending") {
      return \`<tr>
        <td>\${esc(id)}</td>
        <td class="copy">\${esc(linkid)}</td>
        <td>\${esc(dt)}</td>
        <td class="actions">
          <a class="btn-outline small" href="\${review}">Review</a>
          <button class="btn-ghost small btn-danger" data-del="\${esc(linkid)}">Delete</button>
        </td>
      </tr>\`;
    }
    // approved
    return \`<tr>
      <td>\${esc(id)}</td>
      <td class="copy">\${esc(linkid)}</td>
      <td>\${esc(dt)}</td>
      <td class="actions">
        <a class="btn-outline small" href="\${review}">Review</a>
        <button class="btn-ghost small btn-danger" data-del="\${esc(linkid)}">Delete</button>
      </td>
    </tr>\`;
  }

  async function loadList(){
    listBox.innerHTML = '<div class="empty">Loading…</div>';
    try{
      const r = await fetch('/api/admin/list?mode='+encodeURIComponent(mode));
      const d = await r.json();
      const items = d.items || [];
      if (!items.length) {
        listBox.innerHTML = '<div class="empty">No records.</div>';
        return;
      }
      const title =
        mode === "approved" ? "Approved"
        : mode === "pending" ? "Completed (awaiting approval)"
        : "Pending (in‑progress)";
      const kind =
        mode === "approved" ? "approved"
        : mode === "pending" ? "pending"
        : "inprog";

      listBox.innerHTML = \`
        <h3>\${title}</h3>
        <table>
          <thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            \${ items.map(x => row(x.linkid, x.id, x.updated, kind)).join("") }
          </tbody>
        </table>\`;

      // wire delete buttons
      listBox.querySelectorAll("[data-del]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const linkid = btn.getAttribute("data-del");
          if (!confirm("Delete this onboarding session and all related data?")) return;
          const res = await fetch("/api/admin/delete", {
            method:"POST",
            headers:{ "content-type":"application/json" },
            body: JSON.stringify({ linkid })
          }).then(r=>r.json()).catch(()=>({ok:false}));
          if (!res.ok) alert(res.error || "Delete failed");
          else loadList();
        });
      });

    }catch{
      listBox.innerHTML = '<div class="empty">Failed to load.</div>';
    }
  }

  // Generate link
  $("#gen_btn").addEventListener("click", async ()=>{
    const id = ($("#gen_id").value || "").trim();
    if (!id) return alert("Enter Splynx ID");
    const res = await fetch("/api/admin/genlink", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ id })
    }).then(r=>r.json()).catch(()=>({}));
    if (!res || !res.url) return alert("Failed to generate");
    showModal(res.url);
    // preselect “in‑progress” to see it if needed
    document.querySelector('.tab[data-mode="inprog"]').click();
  });

  // Staff OTP
  $("#staff_btn").addEventListener("click", async ()=>{
    const linkid = ($("#staff_linkid").value || "").trim();
    if (!linkid) { $("#staff_msg").textContent = "Enter a link ID."; return; }
    const res = await fetch("/api/staff/gen", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ linkid })
    }).then(r=>r.json()).catch(()=>({ ok:false }));
    if (!res.ok) $("#staff_msg").textContent = res.error || "Failed to generate staff code.";
    else $("#staff_msg").textContent = "Staff code: " + res.code + " (valid ~15 min)";
  });

  // Modal helpers
  const modal = $("#linkModal");
  function showModal(url){
    $("#modalUrl").textContent = url;
    $("#openUrl").setAttribute("href", url);
    modal.classList.add("active");
  }
  $("#closeModal").addEventListener("click", ()=> modal.classList.remove("active"));
  $("#copyUrl").addEventListener("click", async ()=>{
    try{
      await navigator.clipboard.writeText($("#modalUrl").textContent);
      alert("Copied!");
    }catch{ alert("Copy failed"); }
  });
  modal.addEventListener("click", (e)=>{ if(e.target === modal) modal.classList.remove("active"); });

  // Initial list
  loadList();
})();
</script>
</body></html>`;
}

// ------- REVIEW PAGE (Review & Approve) -------
const fieldMap = {
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  passport: "ID / Passport",
  street: "Street",
  city: "City",
  zip: "ZIP"
};
function computeDiffs(original, edits) {
  const rows = [];
  for (const k of Object.keys(fieldMap)) {
    const oldV = original?.[k] ?? "";
    const newV = edits?.[k] ?? "";
    if (String(oldV||"").trim() !== String(newV||"").trim()) {
      rows.push({ label: fieldMap[k], oldV, newV });
    }
  }
  return rows;
}

export function renderAdminReviewHTML({ linkid, sess, r2PublicBase, original }) {
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const diffs = computeDiffs(original, sess.edits || {});
  const msaReady = !!sess.agreement_sig_key;
  const debitReady = (sess.pay_method === "debit") && !!sess.debit_sig_key;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>Review & Approve</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--red:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7fb;color:#222}
  .card{background:#fff;max-width:880px;margin:28px auto;padding:22px;border-radius:16px;box-shadow:0 2px 12px #0002}
  .logo{height:54px;display:block;margin:0 auto 8px}
  h1,h2,h3{color:var(--red);margin:.25em 0 .6em}
  .note{color:#666}
  .btn{background:var(--red);color:#fff;border:0;border-radius:999px;padding:.6em 1.2em;cursor:pointer}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:999px;padding:.5em 1.1em;cursor:pointer}
  .btn-danger{border-color:#b00020;color:#b00020}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
  .diff-old{color:#b00020}
  .diff-new{color:#0b6}
  .chips{display:flex;gap:.5em;flex-wrap:wrap}
  .pill{display:inline-block;border:2px solid var(--red);color:var(--red);border-radius:999px;padding:.35em .9em}
</style></head><body>
<div class="card">
  <a class="btn-outline" href="/">← Back</a>
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h2>Review & Approve</h2>
  <div class="note">Splynx ID: <b>${esc(sess.id||"")}</b> • LinkID: <b>${esc(linkid)}</b> • Status: <b>${esc(sess.status||"pending")}</b></div>

  <h3>Requested changes</h3>
  ${
    diffs.length
      ? `<table>
           <thead><tr><th>Field</th><th>Current (Splynx)</th><th>Requested (Customer)</th></tr></thead>
           <tbody>
             ${diffs.map(d=>`<tr><td>${esc(d.label)}</td><td class="diff-old">${esc(d.oldV)}</td><td class="diff-new"><b>${esc(d.newV)}</b></td></tr>`).join("")}
           </tbody>
         </table>`
      : `<div class="note">No changes detected vs Splynx profile.</div>`
  }

  <h3>Edits (full)</h3>
  <div class="grid2">
    <div>
      <div><b>full_name:</b> ${esc(sess.edits?.full_name)}</div>
      <div><b>email:</b> ${esc(sess.edits?.email)}</div>
      <div><b>phone:</b> ${esc(sess.edits?.phone)}</div>
      <div><b>passport:</b> ${esc(sess.edits?.passport)}</div>
    </div>
    <div>
      <div><b>street:</b> ${esc(sess.edits?.street)}</div>
      <div><b>city:</b> ${esc(sess.edits?.city)}</div>
      <div><b>zip:</b> ${esc(sess.edits?.zip)}</div>
    </div>
  </div>

  <h3>Uploads</h3>
  ${
    uploads.length
      ? `<table>
           <thead><tr><th>Label</th><th>File</th><th>Size</th></tr></thead>
           <tbody>
             ${uploads.map(u => {
               const url = \`\${r2PublicBase}/\${u.key}\`;
               return \`<tr>
                 <td>\${esc(u.label||"")}</td>
                 <td><a href="\${esc(url)}" target="_blank">\${esc(u.name||u.key)}</a></td>
                 <td>${'${fmtKB(u.size)}'}</td>
               </tr>\`;
             }).join("")}
           </tbody>
         </table>`
      : `<div class="note">No uploads.</div>`
  }

  <h3>Agreement</h3>
  <div class="chips">
    <span class="pill">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</span>
    <span class="pill">Payment: ${esc(sess.pay_method || "unknown")}</span>
  </div>

  <div style="margin-top:10px">
    <div><b>MSA</b>:
      ${
        msaReady
          ? `<a href="/pdf/msa/${esc(linkid)}" target="_blank">PDF</a> ·
             <a href="/agreements/msa/${esc(linkid)}" target="_blank">HTML</a>`
          : `<span class="note">Not signed yet</span>`
      }
    </div>
    <div style="margin-top:6px"><b>Debit Order</b>:
      ${
        debitReady
          ? `<a href="/pdf/debit/${esc(linkid)}" target="_blank">PDF</a> ·
             <a href="/agreements/debit/${esc(linkid)}" target="_blank">HTML</a>`
          : (sess.pay_method === "debit"
              ? `<span class="note">Awaiting signature</span>`
              : `<span class="note">Not applicable</span>`)
      }
    </div>
  </div>

  <div style="display:flex;gap:.6em;flex-wrap:wrap;margin-top:14px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
    <button class="btn-outline btn-danger" id="delete">Delete</button>
  </div>
</div>

<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  async function post(url, body){
    const r = await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body || {}) });
    return r.json().catch(()=>({ ok:false }));
  }
  document.getElementById("approve").onclick = async ()=>{
    const res = await post("/api/admin/approve", { linkid });
    if (!res.ok) alert(res.error || "Approve failed"); else location.href = "/";
  };
  document.getElementById("reject").onclick = async ()=>{
    const reason = prompt("Reason for rejection (visible to audit):","Incomplete documents");
    if (reason == null) return;
    const res = await post("/api/admin/reject", { linkid, reason });
    if (!res.ok) alert(res.error || "Reject failed"); else location.href = "/";
  };
  document.getElementById("delete").onclick = async ()=>{
    if (!confirm("Delete this onboarding session? KV, R2 uploads and DB traces will be removed.")) return;
    const res = await post("/api/admin/delete", { linkid });
    if (!res.ok) alert(res.error || "Delete failed"); else location.href = "/";
  };
})();
</script>
</body></html>`;
}
