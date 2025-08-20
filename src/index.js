// --- Vinet Onboarding Worker ---
// Full inline Worker with onboarding flow, admin dashboard, PDF generation, Splynx sync
// Updated: inline admin changes, popup URLs, delete logic, R2 links, PUT updates

import { PDFDocument, StandardFonts } from "pdf-lib";

// ---------- Config ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const R2_PUBLIC_BASE = "https://onboarding-uploads.vinethosting.org";

// Allow only Vinet ASN for access
const ALLOWED_ASN = 328178;

// KV + DB bindings will be available as env.SESSION_KV and env.DB

// ---------- Utilities ----------

// Check ASN restriction
function checkAccess(request) {
  const cf = request.cf || {};
  if (cf.asn !== ALLOWED_ASN) {
    return new Response("Access denied", { status: 403 });
  }
  return null;
}

// Parse JSON safely
async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

// Random ID
function randId(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// Format date for PDF (only "Date")
function formatDate() {
  const d = new Date();
  return d.toLocaleDateString("en-GB"); // but will render only label "Date"
}

// Helper to return JSON
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
// ---------- OTP Flow ----------

// Generate & store OTP in KV for 5 min
async function generateOtp(env, clientKey) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await env.SESSION_KV.put(`otp_${clientKey}`, otp, { expirationTtl: 300 });
  return otp;
}

// Validate OTP
async function validateOtp(env, clientKey, code) {
  const stored = await env.SESSION_KV.get(`otp_${clientKey}`);
  if (stored && stored === code) {
    await env.SESSION_KV.delete(`otp_${clientKey}`);
    return true;
  }
  return false;
}

// ---------- Splynx API Helpers ----------

async function splynxFetch(env, endpoint, method = "GET", body = null) {
  const url = `https://splynx.vinet.co.za/api/2.0${endpoint}`;
  const headers = {
    "Authorization": env.SPLYNX_AUTH,
    "Content-Type": "application/json"
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    console.error("Splynx API error", method, endpoint, res.status);
    return null;
  }
  return await safeJson(res);
}

// Endpoints to fetch/update customer/lead by ID
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`
  ];

  for (const ep of eps) {
    const data = await splynxFetch(env, ep, "GET");
    if (data) return data;
  }
  return null;
}

// Push changes back to Splynx (PUT update)
async function updateCustomerOrLead(env, id, payload, isLead = false) {
  const endpoint = isLead
    ? `/admin/crm/leads/${id}`
    : `/admin/customers/${id}`;
  return await splynxFetch(env, endpoint, "PUT", payload);
}

// Upload file (MSA, Debit Order, ID, POA)
async function uploadDocument(env, id, file, isLead = false) {
  const endpoint = isLead
    ? `/admin/crm/lead-documents`
    : `/admin/customers/customer-documents`;

  const url = `https://splynx.vinet.co.za/api/2.0${endpoint}`;
  const formData = new FormData();
  formData.append(isLead ? "lead_id" : "customer_id", id);
  formData.append("file", new File([file.content], file.name));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": env.SPLYNX_AUTH },
    body: formData
  });

  if (!res.ok) {
    console.error("Upload error", res.status);
    return null;
  }
  return await safeJson(res);
}
// ---------- Onboarding Flow & KV/DB ----------

// Generate short onboarding link valid for 24h
async function generateOnboardLink(env, id, isLead = true) {
  const random = Math.random().toString(36).substring(2, 8);
  const key = `${id}_${random}`;
  const link = `https://onboard.vinet.co.za/onboard/${key}`;

  // Store session in KV (24h)
  await env.SESSION_KV.put(`onboard_${key}`, JSON.stringify({
    id, isLead, status: "pending", created: Date.now()
  }), { expirationTtl: 86400 });

  // Store in DB
  await env.DB.prepare(`
    INSERT INTO onboard_sessions (id, splynx_id, is_lead, status, created_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
  `).bind(key, id, isLead ? 1 : 0, "pending").run();

  return { key, link };
}

// Fetch session by key
async function getOnboardSession(env, key) {
  let kv = await env.SESSION_KV.get(`onboard_${key}`);
  if (kv) return JSON.parse(kv);

  // fallback to DB
  const row = await env.DB.prepare("SELECT * FROM onboard_sessions WHERE id = ?")
    .bind(key).first();
  return row || null;
}

// Update session status
async function setOnboardStatus(env, key, status) {
  const session = await getOnboardSession(env, key);
  if (!session) return;

  session.status = status;
  await env.SESSION_KV.put(`onboard_${key}`, JSON.stringify(session), { expirationTtl: 86400 });

  await env.DB.prepare("UPDATE onboard_sessions SET status = ? WHERE id = ?")
    .bind(status, key).run();
}

// Delete session completely (KV + DB + files in R2)
async function deleteOnboardSession(env, key) {
  await env.SESSION_KV.delete(`onboard_${key}`);
  await env.DB.prepare("DELETE FROM onboard_sessions WHERE id = ?").bind(key).run();

  // Delete uploads from R2
  for await (const item of env.R2_BUCKET.list({ prefix: `uploads/${key}/` })) {
    await env.R2_BUCKET.delete(item.name);
  }
}

// Store uploaded file into R2
async function saveUpload(env, key, file) {
  const path = `uploads/${key}/${file.name}`;
  await env.R2_BUCKET.put(path, file.content, {
    httpMetadata: { contentType: file.type }
  });
  return `https://onboarding-uploads.vinethosting.org/${path}`;
}
// ---------- HTML Renderers (Admin Dashboard & Menus) ----------

// Popup helper
function popupScript() {
  return `
  <script>
    function showPopup(url) {
      const popup = document.createElement("div");
      popup.style.position = "fixed";
      popup.style.top = "50%";
      popup.style.left = "50%";
      popup.style.transform = "translate(-50%, -50%)";
      popup.style.background = "#fff";
      popup.style.padding = "20px";
      popup.style.border = "2px solid #000";
      popup.style.zIndex = "1000";
      popup.style.maxWidth = "90%";
      popup.style.wordBreak = "break-all";
      popup.innerHTML = "<strong>Generated Link:</strong><br><a href='" + url + "' target='_blank'>" + url + "</a><br><br><button onclick='this.parentNode.remove()'>Close</button>";
      document.body.appendChild(popup);
    }
  </script>`;
}

// Admin dashboard
function renderDashboard(sessions) {
  return `
  <html>
  <head>
    <title>Onboarding Admin Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { color: red; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 8px; border: 1px solid #ccc; }
      .btn { padding: 5px 10px; background: black; color: white; border: none; cursor: pointer; }
      .btn-delete { background: red; }
    </style>
    ${popupScript()}
  </head>
  <body>
    <h1>Admin Dashboard</h1>

    <div>
      <button class="btn" onclick="location.href='/admin/generate'">Generate Onboard</button>
      <button class="btn" onclick="location.href='/admin/verify'">Generate Verification</button>
    </div>
    <br>

    <div>
      <button class="btn" onclick="location.href='/admin/pending'">Pending</button>
      <button class="btn" onclick="location.href='/admin/completed'">Completed</button>
      <button class="btn" onclick="location.href='/admin/approved'">Approved</button>
    </div>

    <table>
      <tr><th>ID</th><th>Splynx ID</th><th>Status</th><th>Created</th><th>Action</th></tr>
      ${sessions.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${s.splynx_id}</td>
          <td>${s.status}</td>
          <td>${new Date(s.created_at * 1000).toLocaleString()}</td>
          <td>
            <button class="btn-delete" onclick="if(confirm('Delete this session?')){fetch('/admin/delete/${s.id}', {method:'POST'}).then(()=>location.reload())}">Delete</button>
          </td>
        </tr>`).join("")}
    </table>
  </body>
  </html>`;
}

// Generic menu page (Pending / Completed / Approved)
function renderMenuPage(title, sessions) {
  return `
  <html>
  <head>
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { color: red; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 8px; border: 1px solid #ccc; }
      .btn { padding: 5px 10px; background: black; color: white; border: none; cursor: pointer; }
      .btn-delete { background: red; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <button class="btn" onclick="location.href='/admin'">Back</button>
    <table>
      <tr><th>ID</th><th>Splynx ID</th><th>Status</th><th>Created</th><th>Action</th></tr>
      ${sessions.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${s.splynx_id}</td>
          <td>${s.status}</td>
          <td>${new Date(s.created_at * 1000).toLocaleString()}</td>
          <td>
            <button class="btn-delete" onclick="if(confirm('Delete this session?')){fetch('/admin/delete/${s.id}', {method:'POST'}).then(()=>location.reload())}">Delete</button>
          </td>
        </tr>`).join("")}
    </table>
  </body>
  </html>`;
}
// ---------- Review Page & Splynx Push ----------

// Review completed onboarding session
function renderReviewPage(session, attachments) {
  return `
  <html>
  <head>
    <title>Review Session ${session.id}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      h1 { color: red; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 8px; border: 1px solid #ccc; }
      .btn { padding: 5px 10px; background: black; color: white; border: none; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>Review Session ${session.id}</h1>
    <button class="btn" onclick="location.href='/admin/completed'">Back</button>

    <h2>Client Info</h2>
    <pre>${JSON.stringify(session.data, null, 2)}</pre>

    <h2>Attachments</h2>
    <ul>
      ${attachments.map(a => `
        <li>
          <a href="https://onboarding-uploads.vinethosting.org/${a.key}" target="_blank">${a.filename}</a>
        </li>`).join("")}
    </ul>

    <form method="POST" action="/admin/push/${session.id}">
      <button class="btn">Push Changes to Splynx</button>
    </form>
  </body>
  </html>`;
}

// Push session updates to Splynx
async function pushToSplynx(env, session, attachments) {
  const token = `Basic ${env.SPLYNX_AUTH}`;
  const id = session.splynx_id;
  const isCustomer = session.type === "customer";

  // 1. Update customer/lead info
  const endpoint = isCustomer
    ? `/admin/customers/customer/${id}`
    : `/admin/crm/leads/${id}`;

  await fetch(env.SPLYNX_URL + endpoint, {
    method: "PUT",
    headers: { "Authorization": token, "Content-Type": "application/json" },
    body: JSON.stringify(session.data),
  });

  // 2. Upload attachments (MSA, Debit Order, ID, POA, etc.)
  for (const a of attachments) {
    const fileResp = await env.R2_BUCKET.get(a.key);
    if (!fileResp) continue;

    const buf = await fileResp.arrayBuffer();
    const uploadEp = isCustomer
      ? `/admin/customers/customer-documents/${id}`
      : `/admin/crm/lead-documents/${id}`;

    await fetch(env.SPLYNX_URL + uploadEp, {
      method: "POST",
      headers: {
        "Authorization": token,
      },
      body: (() => {
        const fd = new FormData();
        fd.append("file", new Blob([buf]), a.filename);
        return fd;
      })(),
    });
  }
}
// ---------- PDF Generators (MSA & Debit Order) ----------

import { PDFDocument, StandardFonts } from "pdf-lib";

// Render Master Service Agreement PDF
async function renderMSAPdf(session, signature, meta) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const { width, height } = page.getSize();
  const fontSize = 12;

  page.drawText("MASTER SERVICE AGREEMENT", {
    x: 50,
    y: height - 80,
    size: 18,
    font: times,
    color: rgb(0, 0, 0),
  });

  // Client details
  page.drawText(`Client: ${session.data.full_name || ""}`, {
    x: 50,
    y: height - 120,
    size: fontSize,
    font: times,
  });
  page.drawText(`Email: ${session.data.email || ""}`, {
    x: 50,
    y: height - 140,
    size: fontSize,
    font: times,
  });
  page.drawText(`Phone: ${session.data.phone || ""}`, {
    x: 50,
    y: height - 160,
    size: fontSize,
    font: times,
  });

  // Signature block
  if (signature) {
    const sigImg = await pdfDoc.embedPng(signature);
    page.drawImage(sigImg, {
      x: 50,
      y: 100,
      width: 200,
      height: 60,
    });
  }

  page.drawText("Signed by Client", {
    x: 50,
    y: 80,
    size: fontSize,
    font: times,
  });

  // Meta info
  page.drawText(
    `IP: ${meta.ip} | Date: ${meta.date} | Device: ${meta.device}`,
    { x: 50, y: 60, size: 10, font: times }
  );

  return await pdfDoc.save();
}

// Render Debit Order PDF
async function renderDebitPdf(session, bank, signature, meta) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const { width, height } = page.getSize();
  const fontSize = 12;

  page.drawText("DEBIT ORDER INSTRUCTION", {
    x: 50,
    y: height - 80,
    size: 18,
    font: times,
    color: rgb(0, 0, 0),
  });

  page.drawText(`Account Holder: ${bank.holder || ""}`, {
    x: 50,
    y: height - 120,
    size: fontSize,
    font: times,
  });
  page.drawText(`Bank: ${bank.name || ""}`, {
    x: 50,
    y: height - 140,
    size: fontSize,
    font: times,
  });
  page.drawText(`Account No: ${bank.number || ""}`, {
    x: 50,
    y: height - 160,
    size: fontSize,
    font: times,
  });
  page.drawText(`Branch Code: ${bank.branch || ""}`, {
    x: 50,
    y: height - 180,
    size: fontSize,
    font: times,
  });

  // Signature block
  if (signature) {
    const sigImg = await pdfDoc.embedPng(signature);
    page.drawImage(sigImg, {
      x: 50,
      y: 100,
      width: 200,
      height: 60,
    });
  }

  page.drawText("Signed by Account Holder", {
    x: 50,
    y: 80,
    size: fontSize,
    font: times,
  });

  // Meta info
  page.drawText(
    `IP: ${meta.ip} | Date: ${meta.date} | Device: ${meta.device}`,
    { x: 50, y: 60, size: 10, font: times }
  );

  return await pdfDoc.save();
}
// ---------- Router & Fetch Handler ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ---------- Admin Dashboard ----------
      if (path === "/admin" && method === "GET") {
        return new Response(await renderAdminDashboard(env), {
          headers: { "content-type": "text/html" },
        });
      }

      // ---------- Onboarding URL Generator ----------
      if (path === "/api/admin/generate" && method === "POST") {
        const { id } = await request.json();
        const token = randomId(8);
        const link = `https://onboard.vinet.co.za/onboard/${id}_${token}`;

        await env.SESSION_KV.put(`${id}_${token}`, JSON.stringify({ id, status: "pending" }));

        return jsonResponse({ url: link });
      }

      // ---------- Delete Session ----------
      if (path.startsWith("/api/admin/delete/") && method === "DELETE") {
        const key = path.split("/").pop();
        await env.SESSION_KV.delete(key);
        await env.DB.prepare("DELETE FROM sessions WHERE key = ?").bind(key).run();
        return jsonResponse({ ok: true });
      }

      // ---------- Push to Splynx ----------
      if (path.startsWith("/api/admin/push/") && method === "POST") {
        const id = path.split("/").pop();
        const { type, data } = await request.json();
        const endpoint =
          type === "lead"
            ? `/admin/crm/leads/${id}`
            : `/admin/customers/${id}`;

        const res = await fetch(env.SPLYNX_URL + endpoint, {
          method: "PUT",
          headers: {
            Authorization: `Basic ${env.SPLYNX_AUTH}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error(`Splynx push failed: ${res.status}`);
        return jsonResponse({ ok: true });
      }

      // ---------- PDF Routes ----------
      if (path.startsWith("/pdf/msa/") && method === "GET") {
        const key = path.split("/").pop();
        const session = await getSession(env, key);
        if (!session) return new Response("Not found", { status: 404 });

        const pdf = await renderMSAPdf(session, session.signature, {
          ip: session.ip,
          date: session.date,
          device: session.device,
        });

        return new Response(pdf, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="msa_${key}.pdf"`,
          },
        });
      }

      if (path.startsWith("/pdf/debit/") && method === "GET") {
        const key = path.split("/").pop();
        const session = await getSession(env, key);
        if (!session) return new Response("Not found", { status: 404 });

        const pdf = await renderDebitPdf(session, session.bank, session.signature, {
          ip: session.ip,
          date: session.date,
          device: session.device,
        });

        return new Response(pdf, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="debit_${key}.pdf"`,
          },
        });
      }

      // ---------- Default 404 ----------
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};

// ---------- Helpers ----------
function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
  });
}

function randomId(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

async function getSession(env, key) {
  const raw = await env.SESSION_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}
