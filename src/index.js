// index.js — Vinet Onboarding Worker (fixed)
// - Times Roman + red headings via rgb()
// - WhatsApp OTP logging improved
// - On approval, pushes edits + uploads + agreements into Splynx
// - Still records audit entry in D1

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Constants ----------
const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const DEFAULTS = {
  TERMS_SERVICE_URL: "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt",
  TERMS_DEBIT_URL:   "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt",
};
const A4W = 595, A4H = 842, MARGIN = 40;
const RED = rgb(1, 0, 0); // pdf-lib expects rgb() not [1,0,0]

// ---------- Helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}
const escapeHtml = (s) => String(s || "").replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
function todayZA() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function toDDMMYYYY(iso) {
  const [y,m,d] = (iso||"").split("-");
  if (!y) return "";
  return `${d}/${m}/${y}`;
}
async function fetchTextCached(url, env, cachePrefix = "terms") {
  const key = `${cachePrefix}:${btoa(url).slice(0, 40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!r.ok) return "";
    const t = await r.text();
    await env.ONBOARD_KV.put(key, t, { expirationTtl: 60*60*24*7 });
    return t;
  } catch { return ""; }
}
async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch { return null; }
}

// ---------- EFT Info Page ----------
async function renderEFTPage(id, env) {
  const bank   = env.EFT_BANK_NAME    || "First National Bank (FNB/RMB)";
  const name   = env.EFT_ACCOUNT_NAME || "Vinet Internet Solutions";
  const acc    = env.EFT_ACCOUNT_NO   || "62757054996";
  const branch = env.EFT_BRANCH_CODE  || "250655";
  const notes  = env.EFT_NOTES || "Please remember that all accounts are payable on or before the 1st of every month.";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7fa}
.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{color:#e2001a;font-size:34px;margin:8px 0 18px}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.grid .full{grid-column:1 / -1}
label{font-weight:700;color:#333;font-size:14px}
input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}
button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}
.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="${escapeHtml(bank)}"></div>
    <div><label>Account Name</label><input readonly value="${escapeHtml(name)}"></div>
    <div><label>Account Number</label><input readonly value="${escapeHtml(acc)}"></div>
    <div><label>Branch Code</label><input readonly value="${escapeHtml(branch)}"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(id||"")}"></div>
  </div>
  <p class="note" style="margin-top:16px">${escapeHtml(notes)}</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPUT(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Splynx PUT ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPOST(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Splynx POST ${endpoint} ${r.status} ${t}`);
  }
  return r.json().catch(()=> ({}));
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  if (typeof obj === "string") return ok(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } return null; }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
      obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone,
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile
    ];
    for (const v of direct) if (ok(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok(v)) return String(v).trim();
      if (v && typeof v === "object") { const m = pickPhone(v); if (m) return m; }
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
  let cust = null, lead = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  const src = cust || lead || {};
  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: pickPhone(src) || "",
    city: src.city || "",
    street: src.street || src.address || "",
    zip: src.zip_code || src.zip || "",
    passport: src.passport || src.id_number || "",
  };
}

// ---------- Admin Dashboard ----------
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px} h1,h2{color:#e2001a}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>
  <div id="content"></div>
</div>
<script src="/static/admin.js"></script>
</body></html>`;
}
// ---------- Admin JS ----------
function renderAdminJS() {
  return `console.log("Admin panel loaded");
async function loadSessions(){
  const r = await fetch("/api/admin/sessions");
  const data = await r.json();
  const c = document.getElementById("content");
  c.innerHTML = "<h2>Pending Sessions</h2>";
  const tbl = document.createElement("table");
  tbl.border = 1; tbl.cellPadding = 6;
  tbl.innerHTML = "<tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Action</th></tr>";
  data.forEach(s=>{
    const tr = document.createElement("tr");
    tr.innerHTML = "<td>"+s.id+"</td><td>"+s.full_name+"</td><td>"+s.email+"</td><td>"+s.status+"</td>";
    const act = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Review";
    btn.onclick=()=>location.href="/review?id="+s.id;
    act.appendChild(btn);
    tr.appendChild(act);
    tbl.appendChild(tr);
  });
  c.appendChild(tbl);
}
loadSessions();`;
}

// ---------- Onboarding Frontend ----------
function renderOnboardingPage(linkId) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Vinet Onboarding</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Times New Roman,serif;background:#fafafa;margin:0;padding:0}
.container{max-width:900px;margin:2em auto;background:#fff;padding:2em;border-radius:1.25em;box-shadow:0 4px 12px rgba(0,0,0,.1)}
.logo{display:block;margin:0 auto 1em;max-width:140px}
h1{color:#e2001a;text-align:center}
.step{display:none}.step.active{display:block}
label{display:block;margin-top:1em;font-weight:700}
input,select{width:100%;padding:10px;margin-top:4px;border:1px solid #ccc;border-radius:6px}
button{background:#e2001a;color:#fff;padding:12px 16px;border:none;border-radius:8px;margin-top:1em;cursor:pointer}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet Logo">
  <h1>Client Onboarding</h1>
  <div id="steps"></div>
</div>
<script>
let step=0;
function showStep(n){
  document.querySelectorAll(".step").forEach((el,i)=>el.classList.toggle("active",i===n));
}
function nextStep(){step++;showStep(step);}
async function sendOTP(){
  const contact=document.getElementById("contact").value.trim();
  if(!contact){alert("Enter phone/email");return;}
  const r=await fetch("/api/send-otp",{method:"POST",body:JSON.stringify({id:"${linkId}",contact}),headers:{'Content-Type':'application/json'}});
  const j=await r.json();
  if(j.ok){alert("OTP sent! Check your phone/email");nextStep();}
  else alert("Failed to send OTP");
}
async function verifyOTP(){
  const otp=document.getElementById("otp").value.trim();
  const r=await fetch("/api/verify-otp",{method:"POST",body:JSON.stringify({id:"${linkId}",otp}),headers:{'Content-Type':'application/json'}});
  const j=await r.json();
  if(j.ok){alert("Verified! Continue.");nextStep();}
  else alert("Invalid OTP");
}
document.getElementById("steps").innerHTML=\`
<div class="step active">
  <label>Enter phone/email</label>
  <input id="contact" placeholder="Email or phone">
  <button onclick="sendOTP()">Send OTP</button>
</div>
<div class="step">
  <label>Enter OTP</label>
  <input id="otp" placeholder="One-Time Pin">
  <button onclick="verifyOTP()">Verify</button>
</div>
<div class="step"><p>More onboarding steps will load here...</p></div>
\`;
</script></body></html>`;
}
// ---------- OTP + KV Session Logic ----------
async function handleSendOTP(env, data) {
  const { id, contact } = data;
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const key = `otp:${id}`;
  await env.SESSION_KV.put(key, JSON.stringify({ otp, contact }), { expirationTtl: 300 });

  // Try WhatsApp template send, fallback to text
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: contact,
          type: "template",
          template: { name: "vinet_otp", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text", text: otp }] }] }
        }),
      }
    );
    const j = await resp.json();
    if (!j.messages) {
      console.error("WhatsApp template failed", j);
      // fallback
      await fetch(`https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: contact,
          type: "text",
          text: { body: "Your OTP is " + otp }
        }),
      });
    }
  } catch (e) {
    console.error("OTP send error", e);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}

async function handleVerifyOTP(env, data) {
  const { id, otp } = data;
  const key = `otp:${id}`;
  const stored = await env.SESSION_KV.get(key, "json");
  if (stored && stored.otp === otp) {
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: false }), { headers: { "Content-Type": "application/json" } });
}

// ---------- PDF Generation Helpers ----------
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

async function generateAgreementPDF(type, data, sigPngBytes, meta) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([595, 842]); // A4

  const { width, height } = page.getSize();
  const title = type === "msa" ? "Master Service Agreement" : "Debit Order Authorization";

  page.drawText("VINET INTERNET SOLUTIONS", { x: 50, y: height - 80, size: 22, font, color: rgb(1, 0, 0) });
  page.drawText(title, { x: 50, y: height - 120, size: 18, font, color: rgb(0, 0, 0) });

  // Draw client info
  page.drawText("Client: " + data.full_name, { x: 50, y: height - 180, size: 12, font });
  page.drawText("Email: " + data.email, { x: 50, y: height - 200, size: 12, font });
  page.drawText("Phone: " + data.phone, { x: 50, y: height - 220, size: 12, font });
  page.drawText("Date: " + new Date().toLocaleString(), { x: 50, y: height - 240, size: 12, font });

  // Insert signature if provided
  if (sigPngBytes) {
    const sigImg = await pdfDoc.embedPng(sigPngBytes);
    page.drawImage(sigImg, { x: 50, y: 100, width: 200, height: 80 });
    page.drawText("Signature", { x: 50, y: 90, size: 10, font });
  }

  // Add metadata (IP, device, etc.)
  if (meta) {
    page.drawText("Signed from: " + meta.ip + " via " + meta.device, { x: 50, y: 70, size: 10, font });
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
// ---------- Admin API Endpoints ----------
async function handleAdminAPI(request, env, url) {
  const path = url.pathname;

  // List all sessions from KV
  if (path === "/api/admin/sessions") {
    const list = await env.SESSION_KV.list({ prefix: "session:" });
    const sessions = [];
    for (const k of list.keys) {
      const s = await env.SESSION_KV.get(k.name, "json");
      if (s) sessions.push(s);
    }
    return new Response(JSON.stringify(sessions), { headers: { "Content-Type": "application/json" } });
  }

  // Approve + Push to Splynx
  if (path === "/api/admin/approve" && request.method === "POST") {
    const data = await request.json();
    const { id } = data;
    const session = await env.SESSION_KV.get(`session:${id}`, "json");
    if (!session) return new Response("No session", { status: 404 });

    const splynxUrl = env.SPLYNX_URL;
    const headers = {
      "Authorization": `Basic ${env.SPLYNX_TOKEN}`,
    };

    try {
      // Update lead/customer info
      if (session.type === "lead") {
        await fetch(`${splynxUrl}/admin/crm/leads/${session.splynx_id}`, {
          method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: session.full_name,
            email: session.email,
            phone: session.phone,
            passport: session.passport,
            street_1: session.street,
            city: session.city,
            zip_code: session.zip
          }),
        });
      } else {
        await fetch(`${splynxUrl}/admin/customers/customer/${session.splynx_id}`, {
          method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: session.full_name,
            email: session.email,
            phone: session.phone,
            passport: session.passport,
            street_1: session.street,
            city: session.city,
            zip_code: session.zip
          }),
        });
      }

      // Upload supporting docs (ID + POA)
      for (const docKey of ["id_doc", "poa_doc"]) {
        if (session[docKey]) {
          const file = await env.R2_BUCKET.get(session[docKey]);
          if (file) {
            const arrayBuffer = await file.arrayBuffer();
            const form = new FormData();
            form.append("file", new Blob([arrayBuffer]), docKey + ".png");
            const endpoint = session.type === "lead"
              ? `${splynxUrl}/admin/crm/lead-documents?lead_id=${session.splynx_id}`
              : `${splynxUrl}/admin/customers/customer-documents?customer_id=${session.splynx_id}`;
            await fetch(endpoint, { method: "POST", headers, body: form });
          }
        }
      }

      // Upload agreements (MSA + Debit Order if selected)
      for (const agr of ["msa_pdf", "debit_pdf"]) {
        if (session[agr]) {
          const file = await env.R2_BUCKET.get(session[agr]);
          if (file) {
            const arrayBuffer = await file.arrayBuffer();
            const form = new FormData();
            form.append("file", new Blob([arrayBuffer]), agr + ".pdf");
            const endpoint = session.type === "lead"
              ? `${splynxUrl}/admin/crm/lead-documents?lead_id=${session.splynx_id}`
              : `${splynxUrl}/admin/customers/customer-documents?customer_id=${session.splynx_id}`;
            await fetch(endpoint, { method: "POST", headers, body: form });
          }
        }
      }

      // Mark approved + insert audit into D1
      session.status = "approved";
      await env.SESSION_KV.put(`session:${id}`, JSON.stringify(session));
      await env.DB.prepare(
        `INSERT INTO onboard_audit (session_id, splynx_id, type, approved_at) VALUES (?1, ?2, ?3, ?4)`
      ).bind(id, session.splynx_id, session.type, Date.now()).run();

      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });

    } catch (e) {
      console.error("Approve error", e);
      return new Response(JSON.stringify({ ok: false, error: String(e) }), { headers: { "Content-Type": "application/json" }, status: 500 });
    }
  }

  return new Response("Not found", { status: 404 });
}
// ---------- Static Admin Dashboard ----------
function renderAdminPage() {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Vinet Onboarding Admin</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin:0;
      font-family:"Times New Roman", Times, serif;
      background:#fff;
      color:#000;
    }
    header {
      display:flex;
      align-items:center;
      background:#fff;
      border-bottom:2px solid #e5e5e5;
      padding:10px;
    }
    header img {
      height:50px;
      margin-right:15px;
    }
    header h1 {
      font-size:22px;
      color:red;
      margin:0;
    }
    nav {
      background:#f8f8f8;
      padding:10px;
      border-bottom:1px solid #ddd;
    }
    nav a {
      margin-right:15px;
      text-decoration:none;
      color:#000;
      font-weight:bold;
    }
    nav a:hover {
      text-decoration:underline;
    }
    .content {
      padding:20px;
    }
    table {
      border-collapse:collapse;
      width:100%;
    }
    th, td {
      border:1px solid #ccc;
      padding:8px;
      font-size:14px;
    }
    th {
      background:#eee;
    }
    button {
      padding:5px 10px;
      border:none;
      border-radius:4px;
      cursor:pointer;
      font-size:13px;
    }
    button.approve { background:#28a745; color:#fff; }
    button.delete { background:#dc3545; color:#fff; }
  </style>
</head>
<body>
  <header>
    <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo">
    <h1>Onboarding Admin</h1>
  </header>
  <nav>
    <a href="/admin">Dashboard</a>
    <a href="/admin/review">Review</a>
  </nav>
  <div class="content">
    <h2>Pending Sessions</h2>
    <table id="sessions">
      <thead>
        <tr>
          <th>ID</th>
          <th>Client</th>
          <th>Email</th>
          <th>Type</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>
  <script>
    async function loadSessions() {
      const res = await fetch('/api/admin/sessions');
      const sessions = await res.json();
      const tbody = document.querySelector('#sessions tbody');
      tbody.innerHTML = '';
      sessions.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td>\${s.id}</td>
          <td>\${s.full_name || ''}</td>
          <td>\${s.email || ''}</td>
          <td>\${s.type}</td>
          <td>\${s.status || 'pending'}</td>
          <td>
            <button class="approve" onclick="approve('\${s.id}')">Approve</button>
            <button class="delete" onclick="del('\${s.id}')">Delete</button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    async function approve(id) {
      if (!confirm("Approve session " + id + "?")) return;
      await fetch('/api/admin/approve', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id})
      });
      loadSessions();
    }

    async function del(id) {
      if (!confirm("Delete session " + id + "?")) return;
      await fetch('/api/admin/delete', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id})
      });
      loadSessions();
    }

    loadSessions();
  </script>
</body>
</html>
  `;
}

function renderReviewPage() {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Onboarding Review</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family:"Times New Roman", Times, serif; padding:20px; color:#000; }
    h1 { color:red; }
    .block { margin-bottom:20px; }
    .label { font-weight:bold; }
    button { margin-right:10px; padding:6px 12px; }
  </style>
</head>
<body>
  <h1>Review Session</h1>
  <div id="review"></div>
  <script>
    async function load() {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      const res = await fetch('/api/session?id='+id);
      const s = await res.json();
      const div = document.getElementById('review');
      div.innerHTML = \`
        <div class="block"><span class="label">Name:</span> \${s.full_name}</div>
        <div class="block"><span class="label">Email:</span> \${s.email}</div>
        <div class="block"><span class="label">Phone:</span> \${s.phone}</div>
        <div class="block"><span class="label">Address:</span> \${s.street}, \${s.city}, \${s.zip}</div>
        <div class="block"><span class="label">Type:</span> \${s.type}</div>
        <button onclick="approve('\${s.id}')">Approve & Push</button>
        <button onclick="del('\${s.id}')">Delete</button>
      \`;
    }
    async function approve(id){
      await fetch('/api/admin/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      alert("Approved & pushed!");
    }
    async function del(id){
      await fetch('/api/admin/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      alert("Deleted");
    }
    load();
  </script>
</body>
</html>
  `;
}
// ---------- Router ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // --- Public Onboarding flow ---
      if (path === "/" || path.startsWith("/onboard")) {
        return new Response(renderOnboardingPage(), { headers: { "Content-Type": "text/html" } });
      }
      if (path === "/api/start" && request.method === "POST") {
        return handleStartSession(request, env);
      }
      if (path === "/api/submit" && request.method === "POST") {
        return handleSubmitStep(request, env);
      }
      if (path === "/api/verify-otp" && request.method === "POST") {
        return handleVerifyOtp(request, env);
      }
      if (path === "/api/upload" && request.method === "POST") {
        return handleUpload(request, env);
      }
      if (path === "/api/session") {
        return handleGetSession(request, env, url);
      }

      // --- Admin pages ---
      if (path === "/admin") {
        return new Response(renderAdminPage(), { headers: { "Content-Type": "text/html" } });
      }
      if (path === "/admin/review") {
        return new Response(renderReviewPage(), { headers: { "Content-Type": "text/html" } });
      }

      // --- Admin API ---
      if (path.startsWith("/api/admin/")) {
        return handleAdminAPI(request, env, url);
      }

      // --- Fallback 404 ---
      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error("Worker error:", e);
      return new Response("Internal error: " + e.message, { status: 500 });
    }
  }
};
