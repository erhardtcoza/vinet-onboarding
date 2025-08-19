// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, PDF generation, Splynx sync
// Updated: Times Roman fonts for PDF, Debit Order/MSA layout fixes, Splynx endpoints

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ALLOWED_IPS = ["160.226.128.0/20"]; // VNET ASN
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// ---------- Helpers ----------
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`
  ];

  for (const ep of eps) {
    try {
      const r = await fetch(`${env.SPLYNX_URL}/api/2.0${ep}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
      });
      if (r.ok) return await r.json();
    } catch (e) {
      console.log("Endpoint failed", ep, e.message);
    }
  }
  throw new Error("No valid Splynx endpoint responded");
}

async function pushToSplynx(env, id, data, isLead = false) {
  const eps = isLead
    ? [`/admin/crm/leads/${id}`]
    : [`/admin/customers/customer/${id}`, `/admin/customers/${id}`];

  for (const ep of eps) {
    const r = await fetch(`${env.SPLYNX_URL}/api/2.0${ep}`, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${env.SPLYNX_AUTH}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
    if (r.ok) return await r.json();
  }
  throw new Error("Push to Splynx failed");
}

// ---------- PDF Utilities ----------
async function drawHeader(pdfDoc, page, title) {
  const { height, width } = page.getSize();

  const logoBytes = await fetch(LOGO_URL).then(r => r.arrayBuffer());
  const logoImg = await pdfDoc.embedJpg(logoBytes);

  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesBold);

  // Bigger logo (25%)
  const logoDims = logoImg.scale(0.31);
  page.drawImage(logoImg, {
    x: width / 2 - logoDims.width / 2,
    y: height - logoDims.height - 40,
    width: logoDims.width,
    height: logoDims.height
  });

  // Website + phone under logo
  page.drawText("www.vinet.co.za  |  021 007 0200", {
    x: width / 2 - 120,
    y: height - logoDims.height - 55,
    size: 10,
    font: timesRoman
  });

  // Dashed line slightly lower
  page.drawLine({
    start: { x: 50, y: height - logoDims.height - 70 },
    end: { x: width - 50, y: height - logoDims.height - 70 },
    thickness: 1,
    color: rgb(0, 0, 0)
  });

  // Title
  page.drawText(title, {
    x: 50,
    y: height - logoDims.height - 100,
    size: 16,
    font: timesBold,
    color: rgb(1, 0, 0)
  });
}
// ---------- Debit Order PDF ----------
async function renderDebitOrderPdf(session, auditInfo) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4

  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesBold);

  await drawHeader(pdfDoc, page, "Debit Order Instruction");

  let y = 700;

  // Subheadings
  page.drawText("Client Details", {
    x: 50,
    y,
    size: 12,
    font: timesBold,
    color: rgb(1, 0, 0)
  });
  page.drawText("Debit Order Details", {
    x: 320,
    y,
    size: 12,
    font: timesBold,
    color: rgb(1, 0, 0)
  });
  y -= 20;

  // Client info (left)
  page.drawText(`Client Code: ${session.clientId || ""}`, {
    x: 50,
    y,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Full Name: ${session.full_name || ""}`, {
    x: 50,
    y: y - 15,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Phone: ${session.phone || ""}`, {
    x: 50,
    y: y - 30,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Email: ${session.email || ""}`, {
    x: 50,
    y: y - 45,
    size: 10,
    font: timesRoman
  });

  // Debit order info (right column)
  page.drawText(`Bank: ${session.debit_bank || ""}`, {
    x: 320,
    y,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Branch: ${session.debit_branch || ""}`, {
    x: 320,
    y: y - 15,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Account #: ${session.debit_account || ""}`, {
    x: 320,
    y: y - 30,
    size: 10,
    font: timesRoman
  });
  page.drawText(`Type: ${session.debit_type || ""}`, {
    x: 320,
    y: y - 45,
    size: 10,
    font: timesRoman
  });

  // Signature section
  let sigY = 200;
  page.drawText("Signature:", {
    x: 50,
    y: sigY,
    size: 12,
    font: timesRoman
  });

  // Signature image if exists
  if (session.signatureUrl) {
    const sigBytes = await fetch(session.signatureUrl).then(r => r.arrayBuffer());
    const sigImg = await pdfDoc.embedPng(sigBytes);
    const sigDims = sigImg.scale(0.4);
    page.drawImage(sigImg, {
      x: 120,
      y: sigY - 10,
      width: sigDims.width,
      height: sigDims.height
    });
  }

  // Date field
  page.drawText("Date: ", {
    x: 400,
    y: sigY,
    size: 12,
    font: timesRoman
  });

  // Page 2 for terms + audit info
  const page2 = pdfDoc.addPage([595, 842]);
  page2.drawText("Terms & Conditions", {
    x: 50,
    y: 780,
    size: 14,
    font: timesBold,
    color: rgb(1, 0, 0)
  });

  page2.drawText("1. Debit order terms go here...", {
    x: 50,
    y: 750,
    size: 10,
    font: timesRoman
  });

  // Security audit info at bottom
  page2.drawText(`IP: ${auditInfo.ip || ""}`, {
    x: 50,
    y: 100,
    size: 9,
    font: timesRoman
  });
  page2.drawText(`Device: ${auditInfo.device || ""}`, {
    x: 50,
    y: 85,
    size: 9,
    font: timesRoman
  });
  page2.drawText(`Date/Time: ${auditInfo.timestamp || ""}`, {
    x: 50,
    y: 70,
    size: 9,
    font: timesRoman
  });

  return await pdfDoc.save();
}

// ---------- MSA PDF ----------
async function renderMSAPdf(session, auditInfo) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesBold);

  await drawHeader(pdfDoc, page, "Master Service Agreement");

  let y = 700;

  // Example intro
  page.drawText("This Master Service Agreement (MSA) is entered into between:", {
    x: 50,
    y,
    size: 11,
    font: timesRoman
  });
  y -= 40;

  page.drawText(`Client: ${session.full_name || ""}`, {
    x: 50,
    y,
    size: 11,
    font: timesRoman
  });
  y -= 20;

  page.drawText(`Email: ${session.email || ""}`, {
    x: 50,
    y,
    size: 11,
    font: timesRoman
  });
  y -= 20;

  page.drawText(`Phone: ${session.phone || ""}`, {
    x: 50,
    y,
    size: 11,
    font: timesRoman
  });

  // Signature section
  let sigY = 200;
  page.drawText("Signature:", {
    x: 50,
    y: sigY,
    size: 12,
    font: timesRoman
  });

  if (session.signatureUrl) {
    const sigBytes = await fetch(session.signatureUrl).then(r => r.arrayBuffer());
    const sigImg = await pdfDoc.embedPng(sigBytes);
    const sigDims = sigImg.scale(0.4);
    page.drawImage(sigImg, {
      x: 120,
      y: sigY - 10,
      width: sigDims.width,
      height: sigDims.height
    });
  }

  page.drawText("Date: ", {
    x: 400,
    y: sigY,
    size: 12,
    font: timesRoman
  });

  // Page 2 - Terms + Audit
  const page2 = pdfDoc.addPage([595, 842]);
  page2.drawText("Terms & Conditions", {
    x: 50,
    y: 780,
    size: 14,
    font: timesBold,
    color: rgb(1, 0, 0)
  });
  page2.drawText("Standard MSA terms go here...", {
    x: 50,
    y: 750,
    size: 10,
    font: timesRoman
  });

  page2.drawText(`IP: ${auditInfo.ip || ""}`, {
    x: 50,
    y: 100,
    size: 9,
    font: timesRoman
  });
  page2.drawText(`Device: ${auditInfo.device || ""}`, {
    x: 50,
    y: 85,
    size: 9,
    font: timesRoman
  });
  page2.drawText(`Date/Time: ${auditInfo.timestamp || ""}`, {
    x: 50,
    y: 70,
    size: 9,
    font: timesRoman
  });

  return await pdfDoc.save();
}
// ---------- File Upload Helpers ----------
async function uploadDocument(env, id, fileUrl, isLead, type) {
  if (!fileUrl) return;

  const endpoint = isLead
    ? `/admin/crm/lead-documents`
    : `/admin/customers/customer-documents`;

  const res = await fetch(`${env.SPLYNX_URL}/api/2.0${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`
    },
    body: (() => {
      const form = new FormData();
      form.append(isLead ? "lead_id" : "customer_id", id);
      form.append("type", type);
      form.append("file", fileUrl); // assumes already uploaded to R2 or tmp store
      return form;
    })()
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${type} → ${res.status}`);
  }
  return await res.json();
}

// ---------- Session Handling ----------
async function getSession(env, key) {
  const val = await env.SESSION_KV.get(key, { type: "json" });
  return val || {};
}

async function saveSession(env, key, data) {
  await env.SESSION_KV.put(key, JSON.stringify(data), { expirationTtl: 86400 });
}

function makeAuditInfo(req) {
  const cf = req.cf || {};
  return {
    ip: req.headers.get("cf-connecting-ip"),
    device: req.headers.get("user-agent"),
    timestamp: new Date().toISOString(),
    colo: cf.colo,
    city: cf.city,
    asn: cf.asn
  };
}
// ---------- OTP ----------
async function sendOtp(env, session, method = "whatsapp") {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  session.otp = otp;
  await saveSession(env, session.key, session);

  if (method === "whatsapp" && env.WHATSAPP_TOKEN) {
    const url = `https://graph.facebook.com/v17.0/${env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: session.phone,
      type: "text",
      text: { body: `Your Vinet onboarding OTP is: ${otp}` }
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error("WhatsApp OTP send failed", await res.text());
    }
  } else {
    console.log("OTP (fallback):", otp);
  }
}

// ---------- Routes ----------
async function handleOnboard(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Serve onboarding form
  if (path.startsWith("/onboard/")) {
    const key = path.split("/")[2];
    const session = await getSession(env, key);
    if (!session.key) return new Response("Session expired", { status: 404 });
    return new Response(renderOnboardHtml(session), {
      headers: { "Content-Type": "text/html" }
    });
  }

  // API save step
  if (path === "/api/save" && req.method === "POST") {
    const body = await req.json();
    const session = await getSession(env, body.key);
    Object.assign(session, body.data);
    await saveSession(env, session.key, session);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // API send OTP
  if (path === "/api/send-otp" && req.method === "POST") {
    const body = await req.json();
    const session = await getSession(env, body.key);
    await sendOtp(env, session);
    return new Response(JSON.stringify({ ok: true }));
  }

  // API verify OTP
  if (path === "/api/verify-otp" && req.method === "POST") {
    const body = await req.json();
    const session = await getSession(env, body.key);
    if (session.otp === body.otp) {
      session.verified = true;
      await saveSession(env, session.key, session);
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response(JSON.stringify({ ok: false }), { status: 400 });
  }

  // PDF MSA
  if (path.startsWith("/pdf/msa/")) {
    const key = path.split("/")[2];
    const session = await getSession(env, key);
    const audit = makeAuditInfo(req);
    const pdf = await renderMSAPdf(session, audit);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=msa.pdf"
      }
    });
  }

  // PDF Debit Order
  if (path.startsWith("/pdf/debit/")) {
    const key = path.split("/")[2];
    const session = await getSession(env, key);
    const audit = makeAuditInfo(req);
    const pdf = await renderDebitOrderPdf(session, audit);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=debit-order.pdf"
      }
    });
  }

  return new Response("Not found", { status: 404 });
}
// ---------- Admin Routes ----------
async function handleAdmin(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Approve & push onboarding data to Splynx
  if (path === "/api/admin/approve" && req.method === "POST") {
    const body = await req.json();
    const session = await getSession(env, body.key);
    if (!session.verified) {
      return new Response(JSON.stringify({ ok: false, error: "Not verified" }), {
        status: 400
      });
    }

    try {
      const isLead = session.type === "lead";
      const id = session.id;

      // Push updated info
      await pushToSplynx(env, id, {
        email: session.email,
        phone: session.phone,
        name: session.name,
        billing_email: session.email,
        address: session.address
      }, isLead);

      // Upload supporting documents
      if (session.id_doc_url) {
        await uploadDocument(env, id, session.id_doc_url, isLead, "id_document");
      }
      if (session.poa_doc_url) {
        await uploadDocument(env, id, session.poa_doc_url, isLead, "proof_of_address");
      }

      // Upload agreements
      if (session.msa_url) {
        await uploadDocument(env, id, session.msa_url, isLead, "msa");
      }
      if (session.debit_order_url) {
        await uploadDocument(env, id, session.debit_order_url, isLead, "debit_order");
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500
      });
    }
  }

  // Simple dashboard
  if (path === "/admin" && req.method === "GET") {
    return new Response(renderAdminHtml(), {
      headers: { "Content-Type": "text/html" }
    });
  }

  return new Response("Not found", { status: 404 });
}
// ---------- Router ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // Onboarding routes
      if (path.startsWith("/onboard/") || path.startsWith("/api/") || path.startsWith("/pdf/")) {
        return await handleOnboard(req, env, ctx);
      }

      // Admin routes
      if (path.startsWith("/admin")) {
        return await handleAdmin(req, env, ctx);
      }

      // Root
      if (path === "/") {
        return new Response("Vinet Onboarding Worker OK", {
          headers: { "Content-Type": "text/plain" }
        });
      }

      return new Response("Not found", { status: 404 });
    } catch (e) {
      console.error("Worker exception", e);
      return new Response("Internal error: " + e.message, { status: 500 });
    }
  }
};
