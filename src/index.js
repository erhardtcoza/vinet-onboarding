// index.js — Vinet Onboarding Worker (single-file, “last night” flow & look)
// Welcome -> OTP -> Payment -> Details -> Upload Docs -> Service Agreement (sign) -> Finish (download links)
// Debit-order step shows DO terms; MSA step shows service terms; PDFs generated on sign & saved to public R2

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const PUB = "https://onboarding-uploads.vinethosting.org"; // public R2 domain

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // IP gating for admin/API
      if ((path === "/" || path.startsWith("/admin") || path.startsWith("/api")) && !ipAllowed(request)) {
        // carve-out: customer-facing routes below
        const safe = ["/api/otp/send", "/api/otp/verify", "/api/finalize", "/api/upload",
                      "/api/splynx/profile", "/info/eft", "/info/debit"];
        if (!safe.some(p => path.startsWith(p)) && !path.startsWith("/onboard/")) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      // ===== Admin UI =====
      if (path === "/" && method === "GET") {
        return new Response(renderAdminPage(), { headers: html() });
      }
      if (path === "/static/admin.js" && method === "GET") {
        return new Response(adminJs(), { headers: js() });
      }

      // ===== Admin APIs =====
      if (path === "/api/admin/genlink" && method === "POST") return apiGenLink(request, env, url);
      if (path === "/api/staff/gen" && method === "POST") return apiGenStaffCode(request, env);
      if (path === "/api/admin/list" && method === "GET") return apiAdminList(url, env);
      if (path === "/admin/review" && method === "GET") return adminReviewPage(url, env);
      if (path === "/api/admin/approve" && method === "POST") return apiAdminApprove(request, env);
      if (path === "/api/admin/reject" && method === "POST") return apiAdminReject(request, env);
      if (path === "/api/delete" && method === "POST") return apiDeleteRecord(request, env);

      // ===== Public info pages =====
      if (path === "/info/eft" && method === "GET") {
        const id = url.searchParams.get("id") || "";
        return new Response(await renderEFTPage(id), { headers: html() });
      }
      if (path === "/info/debit" && method === "GET") {
        const id = url.searchParams.get("id") || "";
        return new Response(await renderDebitPage(id, env), { headers: html() });
      }

      // ===== Terms (HTML snippet) =====
      if (path === "/api/terms" && method === "GET") return apiTerms(url, env);

      // ===== OTP =====
      if (path === "/api/otp/send" && method === "POST") return apiOtpSend(request, env);
      if (path === "/api/otp/verify" && method === "POST") return apiOtpVerify(request, env);

      // ===== Onboarding UI =====
      if (path.startsWith("/onboard/") && method === "GET") {
        const linkid = path.split("/")[2] || "";
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (!sess) return new Response("Link expired or invalid", { status: 404 });
        return new Response(renderOnboardUI(linkid, env), { headers: html() });
      }

      // ===== Splynx profile (for details step) =====
      if (path === "/api/splynx/profile" && method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return jerr("Missing id", 400);
        try { return j ok(await fetchProfileForDisplay(env, id)); } catch { return jerr("Lookup failed", 502); }
      }

      // ===== Uploads (supporting docs) =====
      if (path === "/api/upload" && method === "POST") return apiUpload(url, request, env);

      // ===== Finalize (sign -> build PDFs -> store in R2) =====
      if (path === "/api/finalize" && method === "POST") return apiFinalize(request, env);

      // ===== Serve R2 (fallback) =====
      if (path.startsWith("/r2/")) return serveR2(path.slice(4), env);

      return new Response("Not found", { status: 404 });
    } catch (e) {
      return new Response("Worker exception: " + e.message, { status: 500 });
    }
  }
};

/* ───────────────────────────────────────── helpers ───────────────────────────────────────── */

function html() { return { "content-type": "text/html; charset=utf-8" }; }
function js() { return { "content-type": "application/javascript; charset=utf-8" }; }
function j ok(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
function jerr(msg, s = 400) { return j ok({ ok: false, error: msg }, s); }

function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  // Allow 160.226.128.0/20 => a=160, b=226, c=128..143
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

/* ───────────────────────────────────────── Admin UI ───────────────────────────────────────── */

function renderAdminPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Vinet Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--brand:#e2001a}
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:1000px;margin:2.0em auto;border-radius:1.25em;box-shadow:0 6px 18px #0002;padding:1.4em 1.6em}
  .logo{display:block;margin:0 auto 1em;max-width:100px}
  h1,h2{color:var(--brand)}
  .tabs{display:flex;gap:.5em;flex-wrap:wrap;justify-content:center;margin:.2em 0 1em}
  .tab{padding:.55em 1.0em;border-radius:.7em;border:2px solid var(--brand);color:var(--brand);cursor:pointer;user-select:none}
  .tab.active{background:var(--brand);color:#fff}
  .btn{background:var(--brand);color:#fff;border:0;border-radius:.7em;padding:.55em 1.0em;font-size:1em;cursor:pointer}
  .btn-outline{background:#fff;color:var(--brand);border:2px solid var(--brand);border-radius:.7em;padding:.5em 1.0em}
  .btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1.0em;text-decoration:none;display:inline-block}
  .field{margin:.9em 0}
  input,select{width:100%;padding:.6em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .row{display:flex;gap:.75em}
  .row>*{flex:1}
  table{width:100%;border-collapse:collapse}
  th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
  .note{font-size:12px;color:#666}
  .link-out{background:#fafafa;border:1px dashed #ddd;border-radius:.6em;padding:.6em;word-break:break-all}
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
    <h1>Admin Dashboard</h1>
    <div class="tabs">
      <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
      <div class="tab" data-tab="staff">2. Generate staff code</div>
      <div class="tab" data-tab="inprog">3. Pending (in-progress)</div>
      <div class="tab" data-tab="pending">4. Completed (awaiting approval)</div>
      <div class="tab" data-tab="approved">5. Approved</div>
    </div>
    <div id="content"></div>
  </div>
  <script src="/static/admin.js"></script>
</body>
</html>`;
}

function adminJs() {
  return `(()=> {
    const tabs = document.querySelectorAll('.tab');
    const content = document.getElementById('content');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      load(t.getAttribute('data-tab'));
    });
    load('gen');

    function node(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }

    async function load(which){
      if (which==='gen') {
        content.innerHTML = '';
        const v = node(
          '<div class="field"><label>Splynx Lead/Customer ID</label>'+
          '<div class="row"><input id="id" autocomplete="off" />'+
          '<button class="btn" id="go">Generate</button></div></div>'+
          '<div id="out" class="field"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const id = v.querySelector('#id').value.trim();
          const out = v.querySelector('#out');
          if (!id) { out.textContent = 'Please enter an ID.'; return; }
          out.textContent = 'Working...';
          try {
            const r = await fetch('/api/admin/genlink', {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ id })
            });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.url
              ? '<b>Onboarding link:</b> <div class="link-out"><a href="'+d.url+'" target="_blank">'+d.url+'</a></div>'
              : 'Error generating link.';
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (which==='staff') {
        content.innerHTML='';
        const v = node(
          '<div class="field"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label>'+
          '<div class="row"><input id="linkid" autocomplete="off" />'+
          '<button class="btn" id="go">Generate staff code</button></div></div>'+
          '<div id="out" class="field note"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const linkid = v.querySelector('#linkid').value.trim();
          const out = v.querySelector('#out');
          if (!linkid) { out.textContent='Enter linkid'; return; }
          out.textContent='Working...';
          try {
            const r = await fetch('/api/staff/gen', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid }) });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error || 'Failed');
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML = 'Loading...';
        try {
          const r = await fetch('/api/admin/list?mode='+which);
          const d = await r.json();
          const rows = (d.items||[]).map(i =>
            '<tr>'+
              '<td>'+i.id+'</td>'+
              '<td>'+(i.name||'')+'</td>'+
              '<td>'+new Date(i.updated).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})+'</td>'+
              '<td>'+
                (which==='pending'
                  ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid||'')+'&id='+encodeURIComponent(i.id)+'">Review</a>'
                  : '<a class="btn-secondary" href="/onboard/'+(i.linkid||'')+'" target="_blank">Open</a>')+
              '</td>'+
            '</tr>'
          ).join('') || '<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML = '<table><thead><tr><th>Splynx ID</th><th>Name</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        } catch {
          content.innerHTML = 'Failed to load.';
        }
        return;
      }
    }
  })();`;
}

/* ───────────────────────────────────────── Admin APIs ───────────────────────────────────────── */

async function apiGenLink(request, env, url) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return jerr("Missing id", 400);
  const token = Math.random().toString(36).slice(2, 10);
  const linkid = `${id}_${token}`;
  await env.ONBOARD_KV.put(
    `onboard/${linkid}`,
    JSON.stringify({ id, created: Date.now(), progress: 0 }),
    { expirationTtl: 86400 }
  );
  // add to in-progress list
  const inprog = await env.ONBOARD_KV.get("list/inprog", "json") || [];
  inprog.unshift({ id, linkid, updated: Date.now() });
  await env.ONBOARD_KV.put("list/inprog", JSON.stringify(inprog));
  return j ok({ url: `${url.origin}/onboard/${linkid}` });
}

async function apiGenStaffCode(request, env) {
  const { linkid } = await request.json().catch(() => ({}));
  if (!linkid) return jerr("Missing linkid", 400);
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return jerr("Unknown linkid", 404);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
  return j ok({ ok: true, code });
}

async function apiAdminList(url, env) {
  const mode = url.searchParams.get("mode") || "pending";
  const list = await env.ONBOARD_KV.get(`list/${mode}`, "json") || [];
  return j ok({ items: list });
}

async function adminReviewPage(url, env) {
  const id = url.searchParams.get("id");
  const linkid = url.searchParams.get("linkid") || "";
  if (!id) return new Response("Missing id", { status: 400 });
  const rec = await env.ONBOARD_KV.get(`record/${id}`, "json") || {};
  const uploads = rec.uploads || [];
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Review</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
  h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}
  .note{color:#666;font-size:12px}
  ul{padding-left:1em}
</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${id}</b> • LinkID: <code>${linkid}</code></div>

  <h2>Agreements</h2>
  <ul>
    ${rec.msa_url ? `<li><a href="${rec.msa_url}" target="_blank">MSA Agreement</a></li>` : ""}
    ${rec.do_url ? `<li><a href="${rec.do_url}" target="_blank">Debit Order Agreement</a></li>` : ""}
  </ul>

  <h2>Uploads</h2>
  ${uploads.length ? `<ul>${uploads.map(u => `<li>${u.name} — <a href="${u.url}" target="_blank">open</a></li>`).join("")}</ul>` : `<div class="note">No files</div>`}

  <div style="margin-top:12px">
    <button class="btn" onclick="approve()">Approve & Push</button>
    <button class="btn-outline" onclick="reject()">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  async function approve(){
    const r = await fetch('/api/admin/approve', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id:${JSON.stringify(id)}, linkid:${JSON.stringify(linkid)} })});
    const d = await r.json().catch(()=>({}));
    document.getElementById('msg').textContent = d.ok ? 'Approved.' : (d.error||'Failed.');
  }
  async function reject(){
    const reason = prompt('Reason?')||'';
    const r = await fetch('/api/admin/reject', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ id:${JSON.stringify(id)}, linkid:${JSON.stringify(linkid)}, reason })});
    const d = await r.json().catch(()=>({}));
    document.getElementById('msg').textContent = d.ok ? 'Rejected.' : (d.error||'Failed.');
  }
</script>
</body></html>`;
  return new Response(html, { headers: html() });
}

async function apiAdminApprove(request, env) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return jerr("Missing id", 400);
  const awaiting = await env.ONBOARD_KV.get("list/pending", "json") || [];
  const approved = await env.ONBOARD_KV.get("list/approved", "json") || [];
  const rec = (await env.ONBOARD_KV.get(`record/${id}`, "json")) || {};
  approved.unshift({ id, name: rec.name || "", updated: Date.now() });
  await env.ONBOARD_KV.put("list/approved", JSON.stringify(approved));
  const next = awaiting.filter(x => String(x.id) !== String(id));
  await env.ONBOARD_KV.put("list/pending", JSON.stringify(next));
  return j ok({ ok: true });
}

async function apiAdminReject(request, env) {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return jerr("Missing id", 400);
  // Just move back to in-progress
  const inprog = await env.ONBOARD_KV.get("list/inprog", "json") || [];
  inprog.unshift({ id, updated: Date.now() });
  await env.ONBOARD_KV.put("list/inprog", JSON.stringify(inprog));
  // remove from pending
  const pending = await env.ONBOARD_KV.get("list/pending", "json") || [];
  await env.ONBOARD_KV.put("list/pending", JSON.stringify(pending.filter(x => String(x.id) !== String(id))));
  return j ok({ ok: true });
}

async function apiDeleteRecord(request, env) {
  const { id, linkid } = await request.json().catch(() => ({}));
  if (!id) return jerr("Missing id", 400);
  await env.ONBOARD_KV.delete(`record/${id}`);
  if (linkid) await env.ONBOARD_KV.delete(`onboard/${linkid}`);
  // remove across lists
  for (const key of ["list/inprog", "list/pending", "list/approved"]) {
    const arr = await env.ONBOARD_KV.get(key, "json") || [];
    await env.ONBOARD_KV.put(key, JSON.stringify(arr.filter(x => String(x.id) !== String(id))));
  }
  return j ok({ ok: true });
}

/* ───────────────────────────────────────── Public info pages ───────────────────────────────────────── */

async function renderEFTPage(id) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EFT Payment Details</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f7f7fa;margin:0}
  .container{max-width:740px;margin:24px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 6px 18px #0002}
  .logo{display:block;margin:0 auto 8px;max-width:160px}
  h1{color:#e2001a;margin:8px 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .f{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
  .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:10px;padding:10px;font-weight:700}
  .c{text-align:center}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  @media (max-width:680px){.grid{grid-template-columns:1fr}}
</style></head><body>
  <div class="container">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>Banking details</h1>
    <div class="grid">
      <div class="f"><b>Bank</b><br>First National Bank (FNB/RMB)</div>
      <div class="f"><b>Account Name</b><br>Vinet Internet Solutions</div>
      <div class="f"><b>Account Number</b><br>62757054996</div>
      <div class="f"><b>Branch Code</b><br>250655</div>
    </div>
    <div class="ref" style="margin-top:10px">Please use the correct EFT reference: <b>REF ${escapeHtml(String(id||""))}</b></div>
    <p class="c" style="color:#666">All accounts are payable on or before the 1st of every month.</p>
    <div class="c"><button class="btn" onclick="window.print()">Print banking details</button></div>
  </div>
</body></html>`;
}

async function renderDebitPage(id, env) {
  const termsUrl = env.TERMS_DEBIT_URL || `${PUB}/vinet-debitorder-terms.txt`;
  const terms = await (await fetch(termsUrl)).text().catch(()=>"Terms unavailable.");
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Debit Order Instruction</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f7f7fa;margin:0}
  .container{max-width:780px;margin:24px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 6px 18px #0002}
  .logo{display:block;margin:0 auto 8px;max-width:160px}
  h1{color:#e2001a;margin:8px 0 12px}
  label{font-weight:700;display:block;margin-top:10px}
  input,select{width:100%;padding:10px;border:1px solid #dcdcdc;border-radius:8px;margin-top:6px}
  .tick{transform:scale(1.6);margin-right:10px}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  .row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:220px}
  pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
</style></head><body>
  <div class="container">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>Debit Order Details</h1>
    <form method="POST" action="/api/debit/save">
      <input type="hidden" name="splynx_id" value="${escapeHtml(String(id||""))}">
      <div class="row">
        <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
        <div><label>Bank Account Holder ID no</label><input name="id_number" required></div>
      </div>
      <div class="row">
        <div><label>Bank</label><input name="bank_name" required></div>
        <div><label>Bank Account No</label><input name="account_number" required></div>
      </div>
      <div class="row">
        <div><label>Bank Account Type</label>
          <select name="account_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
        </div>
        <div><label>Debit Order Date</label>
          <select name="debit_day"><option value="1">1st</option><option value="7">7th</option><option value="15">15th</option><option value="25">25th</option><option value="29">29th</option><option value="30">30th</option></select>
        </div>
      </div>
      <div style="margin-top:8px"><label><input class="tick" type="checkbox" name="agree" required> I accept the Debit Order terms</label></div>
      <pre>${escapeHtml(terms)}</pre>
      <div style="margin-top:10px"><button class="btn" type="submit">Submit</button></div>
    </form>
  </div>
</body></html>`;
}

/* ───────────────────────────────────────── Terms API ───────────────────────────────────────── */

async function apiTerms(url, env) {
  const pay = (url.searchParams.get("pay") || "eft").toLowerCase();
  const svcUrl = env.TERMS_SERVICE_URL || `${PUB}/vinet-master-terms.txt`;
  const debUrl = env.TERMS_DEBIT_URL || `${PUB}/vinet-debitorder-terms.txt`;
  async function get(u){ try { const r=await fetch(u, { cf:{ cacheEverything:true, cacheTtl:300 } }); return r.ok? await r.text() : ""; } catch { return ""; } }
  const service = await get(svcUrl);
  const debit = pay === "debit" ? await get(debUrl) : "";
  const body = `
    <h3>Service Terms</h3>
    <pre style="white-space:pre-wrap">${escapeHtml(service)}</pre>
    ${debit ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${escapeHtml(debit)}</pre>` : ""}`;
  return new Response(body || "<p>Terms unavailable.</p>", html());
}

/* ───────────────────────────────────────── OTP APIs ───────────────────────────────────────── */

async function apiOtpSend(request, env) {
  const { linkid } = await request.json().catch(() => ({}));
  if (!linkid) return jerr("Missing linkid", 400);
  const splynxId = (linkid || "").split("_")[0];

  const msisdn = await fetchCustomerMsisdn(env, splynxId);
  if (!msisdn) return jerr("No WhatsApp number on file", 404);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
  await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

  try {
    await sendWhatsAppTemplate(env, msisdn, code, "en");
    return j ok({ ok: true });
  } catch {
    try {
      await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`);
      return j ok({ ok: true, note: "sent-as-text" });
    } catch {
      return jerr("WhatsApp send failed (template+text)", 502);
    }
  }
}

async function apiOtpVerify(request, env) {
  const { linkid, otp, kind } = await request.json().catch(() => ({}));
  if (!linkid || !otp) return jerr("Missing params", 400);
  const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
  const expected = await env.ONBOARD_KV.get(key);
  const ok = !!expected && expected === otp;
  if (ok && kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
  return j ok({ ok });
}

/* WhatsApp helpers */
async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
  const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: toMsisdn,
    type: "template",
    template: {
      name: templateName,
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        // Button param length limit 15 → pass last 6
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] }
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}
async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to: toMsisdn, type: "text", text: { body: bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
}

/* ───────────────────────────────────────── Splynx profile ───────────────────────────────────────── */

async function splynxGET(env, endpoint) {
  const base = (env.SPLYNX_API || "").replace(/\/$/, "");
  const r = await fetch(base + endpoint, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` } });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

function pickPhoneDeep(obj) {
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  if (!obj) return null;
  if (Array.isArray(obj)) for (const it of obj) { const m = pickPhoneDeep(it); if (m) return m; }
  else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (ok(v)) return String(v).trim();
      const m = pickPhoneDeep(v); if (m) return m;
    }
  }
  return null;
}

async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/api/2.0/admin/customers/customer/${id}`,
    `/api/2.0/admin/customers/${id}/contacts`,
    `/api/2.0/crm/leads/${id}`,
    `/api/2.0/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhoneDeep(data); if (m) return m; } catch {}
  }
  return null;
}

async function fetchProfileForDisplay(env, id) {
  let src = null;
  try { src = await splynxGET(env, `/api/2.0/admin/customers/customer/${id}`); } catch {}
  if (!src) { try { src = await splynxGET(env, `/api/2.0/crm/leads/${id}`); } catch {} }
  const out = src || {};
  return {
    id,
    full_name: out.full_name || `${out.first_name || ""} ${out.last_name || ""}`.trim(),
    first_name: out.first_name || "",
    last_name: out.last_name || "",
    passport: out.passport || "",
    email: out.email || out.billing_email || "",
    phone: out.phone_mobile || out.phone || "",
    city: out.city || "",
    street: out.street_1 || out.street || "",
    zip: out.zip_code || out.zip || "",
  };
}

/* ───────────────────────────────────────── Onboarding UI ───────────────────────────────────────── */

function renderOnboardUI(linkid, env) {
  // OTP FIRST (this is the “last night” flow)
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--brand:#e2001a}
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; margin:0 }
  .card { background:#fff; max-width:650px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 6px 18px #0002; padding:1.6em }
  .logo { display:block; margin:0 auto 1em; max-width:110px }
  h1, h2 { color:var(--brand); }
  .btn { background:var(--brand); color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
  .btn-outline { background:#fff; color:var(--brand); border:2px solid var(--brand); border-radius:.7em; padding:.6em 1.4em; }
  .field { margin:1em 0; }  input, select, textarea { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
  .note { font-size:12px; color:#666; }
  .row { display:flex; gap:.75em; flex-wrap: wrap }
  .row > * { flex:1; min-width:220px }
  .pill-wrap { display:flex; gap:.6em; flex-wrap:wrap; margin:.6em 0 0; }
  .pill { border:2px solid var(--brand); color:var(--brand); padding:.6em 1.2em; border-radius:999px; cursor:pointer; user-select:none; }
  .pill.active { background:var(--brand); color:#fff; }
  .termsbox { max-height: 280px; overflow:auto; padding:1em; border:1px solid #ddd; border-radius:.6em; background:#fafafa; }
  canvas.signature { border:1px dashed #bbb; border-radius:.6em; width:100%; height:180px; touch-action: none; background:#fff; }
  .ref { background:#fff7d6; border:1px dashed #e0b400; padding:10px; border-radius:10px; font-weight:700 }
  .tick { transform: scale(1.6); margin-right:10px }
  .links a { display:block; margin:8px 0 }
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const idOnly = linkid.split('_')[0];
  const stepEl = document.getElementById('step');
  let step = 0;
  let state = { pay: '', debit: null, info: {}, uploads: [] };

  function render(){ [step0, step1, step2, step3, step4, step5][step](); }

  // Welcome
  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; render(); };
  }

  // OTP verify (WhatsApp OR staff code)
  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }
  function step1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="Enter 6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><div style="margin-top:6px"><a class="btn-outline" id="resend">Resend code</a></div>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="Enter staff code" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  // Payment (EFT inline + “print”; Debit order with terms + agree)
  function step2(){
    const pay = state.pay || '';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><select id="paySel"><option value="">— Select —</option><option value="EFT" '+(pay==='EFT'?'selected':'')+'>EFT</option><option value="DEBIT" '+(pay==='DEBIT'?'selected':'')+'>Debit order</option></select></div>',
      '<div id="eftBox" style="display:'+(pay==='EFT'?'block':'none')+';margin-top:10px">',
        '<div class="ref">Please use the correct reference when making EFT payments: REF <b>'+idOnly+'</b></div>',
        '<div style="text-align:center;margin-top:10px"><button class="btn" type="button" onclick="window.open(\\'/info/eft?id='+idOnly+'\\',\\'_blank\\')">Print banking details</button></div>',
      '</div>',
      '<div id="doBox" style="display:'+(pay==='DEBIT'?'block':'none')+';margin-top:10px"></div>',
      '<div class="row" style="margin-top:14px;"><div><a class="btn-outline" id="back1">Back</a></div><div><button class="btn" id="cont">Continue</button></div></div>'
    ].join('');

    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('doBox');
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
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div style="margin:8px 0"><label><input type="checkbox" class="tick" id="d_ok"/> I accept the Debit Order terms</label></div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();
    }
    function hideDebitForm(){ const box=document.getElementById('doBox'); box.style.display='none'; box.innerHTML=''; }

    const sel = document.getElementById('paySel');
    sel.onchange = ()=>{ const v=sel.value; state.pay=v; if (v==='DEBIT') renderDebitForm(); else hideDebitForm(); };
    if (pay==='DEBIT') renderDebitForm();

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay === 'DEBIT') {
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value
        };
        if (!document.getElementById('d_ok').checked) { alert('Please accept the Debit Order terms'); return; }
      } else state.debit=null;
      step=3; render();
    };
  }

  // Details
  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(idOnly));
        const p=await r.json();
        const cur={ first_name: state.info.first_name ?? p.first_name ?? '', last_name: state.info.last_name ?? p.last_name ?? '', passport: state.info.passport ?? p.passport ?? '', phone: state.info.phone ?? p.phone ?? '', email: state.info.email ?? p.email ?? '', street: state.info.street ?? p.street ?? '', city: state.info.city ?? p.city ?? '', zip: state.info.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>First name</label><input id="f_first" value="'+(cur.first_name||'')+'" /></div><div class="field"><label>Last name</label><input id="f_last" value="'+(cur.last_name||'')+'" /></div></div>',
          '<div class="row"><div class="field"><label>ID / Passport</label><input id="f_passport" value="'+(cur.passport||'')+'" /></div><div class="field"><label>Mobile</label><input id="f_phone" value="'+(cur.phone||'')+'" /></div></div>',
          '<div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'" /></div>',
          '<div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'" /></div>',
          '<div class="row"><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'" /></div><div class="field"><label>ZIP</label><input id="f_zip" value="'+(cur.zip||'')+'" /></div></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.info={ first_name:val('f_first'), last_name:val('f_last'), passport:val('f_passport'), phone:val('f_phone'), email:val('f_email'), street:val('f_street'), city:val('f_city'), zip:val('f_zip') }; step=4; render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
    function val(id){ return (document.getElementById(id).value||'').trim(); }
  }

  // Upload docs
  function step4(){
    stepEl.innerHTML=[
      '<h2>Please upload your supporting documents</h2>',
      '<p class="note">ID or Passport and proof of address (as per RICA regulations)</p>',
      '<input type="file" id="up1" accept="image/*,application/pdf" />',
      '<input type="file" id="up2" accept="image/*,application/pdf" />',
      '<div class="row" style="margin-top:10px"><a class="btn-outline" id="back3">Back</a><button class="btn" id="cont">Continue</button></div>'
    ].join('');
    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      const f1=document.getElementById('up1').files[0]; const f2=document.getElementById('up2').files[0];
      state.uploads=[];
      if (f1) state.uploads.push(await upload(linkid, f1));
      if (f2) state.uploads.push(await upload(linkid, f2));
      step=5; render();
    };
    async function upload(linkid, file){
      const u = '/api/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name);
      const buf = await file.arrayBuffer();
      const r = await fetch(u, { method:'POST', body: buf });
      return await r.json().catch(()=>({}));
    }
  }

  // Service Agreement (terms + signature)
  function step5(){
    stepEl.innerHTML=[
      '<h2>Vinet Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field" style="margin-top:10px"><label><input type="checkbox" id="agreeChk" class="tick"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?pay='+(state.pay==='DEBIT'?'debit':'eft')); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; } msg.textContent='Finalizing…';
      try{
        const payload={ linkid, id:idOnly, state, signature:pad.dataURL() };
        const r=await fetch('/api/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
        const d=await r.json().catch(()=>({ok:false}));
        if(d.ok){
          // show finish
          stepEl.innerHTML = '<h2>All set!</h2><p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p><div id="downloadLinks" class="links"></div>';
          const L=[];
          if(d.msa_url) L.push('<a target="_blank" href="'+d.msa_url+'">Download Vinet Service Agreement (MSA)</a>');
          if(d.do_url)  L.push('<a target="_blank" href="'+d.do_url+'">Download Debit Order Agreement</a>');
          document.getElementById('downloadLinks').innerHTML=L.join('');
        } else { msg.textContent=d.error||'Failed to finalize.'; }
      }catch{ msg.textContent='Network error.'; }
    };
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(180*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  render();
})();
</script>
</body></html>`;
}

/* ───────────────────────────────────────── Upload / Finalize / R2 ───────────────────────────────────────── */

async function apiUpload(url, request, env) {
  const linkid = url.searchParams.get("linkid") || "";
  const fileName = url.searchParams.get("filename") || "file.bin";
  if (!linkid) return jerr("Missing linkid", 400);
  const body = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
  await env.R2_UPLOADS.put(key, body);
  return j ok({ ok: true, key, url: `${PUB}/${key}`, name: fileName });
}

async function apiFinalize(request, env) {
  const { linkid, id, state, signature } = await request.json().catch(()=> ({}));
  if (!linkid || !id || !state || !signature) return jerr("Missing data", 400);

  // Save signature
  const png = signature.split(",")[1] || "";
  const sigBytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata: { contentType: "image/png" } });

  // Build PDFs now
  const msaOut = await buildMsaPdf(env, id, linkid, state, sigBytes);
  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaOut, { httpMetadata: { contentType: "application/pdf" } });

  let doKey = null;
  if (state.pay === "DEBIT") {
    const doOut = await buildDoPdf(env, id, linkid, state, sigBytes);
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doOut, { httpMetadata: { contentType: "application/pdf" } });
  }

  const msa_url = `${PUB}/${msaKey}`;
  const do_url = doKey ? `${PUB}/${doKey}` : null;

  // Record for admin “pending” list and detailed record
  const rec = {
    id,
    linkid,
    name: `${state.info.first_name||""} ${state.info.last_name||""}`.trim(),
    email: state.info.email || "",
    phone: state.info.phone || "",
    uploads: state.uploads || [],
    msa_url, do_url,
    updated: Date.now()
  };
  await env.ONBOARD_KV.put(`record/${id}`, JSON.stringify(rec), { expirationTtl: 60*60*24*90 });

  // Move inprog -> pending
  const inprog = await env.ONBOARD_KV.get("list/inprog", "json") || [];
  const pending = await env.ONBOARD_KV.get("list/pending", "json") || [];
  const nextInprog = inprog.filter(x => String(x.id) !== String(id));
  pending.unshift({ id, linkid, name: rec.name, updated: rec.updated });
  await env.ONBOARD_KV.put("list/inprog", JSON.stringify(nextInprog));
  await env.ONBOARD_KV.put("list/pending", JSON.stringify(pending));

  return j ok({ ok: true, msa_url, do_url });
}

async function serveR2(key, env) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "content-type": ct } });
}

/* ───────────────────────────────────────── PDF builders ───────────────────────────────────────── */

function catNow() { return new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }); }

async function buildMsaPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.MSA_TEMPLATE_URL || `${PUB}/templates/VINET_MSA.pdf`;
  const tpl = await (await fetch(tplUrl)).arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm?.();

  const F = {
    full_name: `${state.info.first_name||""} ${state.info.last_name||""}`.trim(),
    passport: state.info.passport || "",
    customer_id: String(id),
    email: state.info.email || "",
    phone: state.info.phone || "",
    street: state.info.street || "",
    city: state.info.city || "",
    zip: state.info.zip || "",
    date: catNow()
  };
  if (form) {
    for (const [k,v] of Object.entries(F)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature on page 4 bottom-right (approx)
  try {
    const png = await pdf.embedPng(sigBytes);
    const idx = Math.min(3, pdf.getPageCount()-1);
    const page = pdf.getPage(idx);
    const { width } = page.getSize();
    page.drawImage(png, { x: width - 260, y: 95, width: 180, height: 60 });
  } catch {}

  appendStampPage(pdf, state);
  return await pdf.save();
}

async function buildDoPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.DO_TEMPLATE_URL || `${PUB}/templates/VINET_DO.pdf`;
  const tpl = await (await fetch(tplUrl)).arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm?.();

  const d = state.debit || {};
  const F = {
    account_holder: d.account_holder || "",
    id_number: d.id_number || "",
    bank_name: d.bank_name || "",
    account_number: d.account_number || "",
    account_type: d.account_type || "",
    debit_day: String(d.debit_day || ""),
    customer_id: String(id),
    date: catNow()
  };
  if (form) {
    for (const [k,v] of Object.entries(F)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature between Debit Day and Date fields (~mid-bottom)
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(0);
    const { width } = page.getSize();
    page.drawImage(png, { x: width/2 - 90, y: 120, width: 180, height: 60 });
  } catch {}

  appendStampPage(pdf, state);
  return await pdf.save();
}

function appendStampPage(pdf, state) {
  const page = pdf.addPage([595, 842]); // A4
  const draw = (t, x, y, size = 12) => {
    try { page.drawText(t, { x, y, size, color: rgb(0,0,0) }); } catch {}
  };
  let y = 800;
  draw("Security Verification", 40, y, 18); y -= 24;
  draw("Date/time (CAT): " + catNow(), 40, y); y -= 18;
  draw("Device: " + (state.device || "n/a"), 40, y); y -= 18;
  draw("Browser: " + (state.browser || "n/a"), 40, y); y -= 18;
  draw("IP: " + (state.ip || "n/a"), 40, y);
}
