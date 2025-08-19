// --- Vinet Onboarding Worker ---
// Full deployable index.js with Admin dashboard, onboarding, R2, OTP, Splynx, PDFs (Debit Order + MSA)
// Updated: CRM endpoints fixed (/admin/crm/...), PDF rendering switched to Times Roman

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const ALLOWED_IPS = ["160.226.128.0/20"]; // VNET ASN range
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const DEFAULT_MSA_PDF   = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DEFAULT_DEBIT_PDF = "https://onboarding-uploads.vinethosting.org/templates/VINET_DEBIT.pdf";

const BANK_NAME = "First National Bank (FNB/RMB)";
const BANK_BRANCH = "210554";
const BANK_ACC = "62676377878";

// OTP setup
async function sendWhatsAppOtp(env, phone, otp) {
  try {
    const url = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "vinet_otp",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: otp }]
          }
        ]
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.error("WhatsApp OTP send failed, fallback to plain text", await resp.text());
      return await sendWhatsAppFallback(env, phone, otp);
    }
    return true;
  } catch (e) {
    console.error("WhatsApp OTP error", e);
    return await sendWhatsAppFallback(env, phone, otp);
  }
}

async function sendWhatsAppFallback(env, phone, otp) {
  const url = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: `Your Vinet OTP is: ${otp}` }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return resp.ok;
}

// Utility: random OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ---------- Fetch helpers ----------
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];

  for (let ep of eps) {
    try {
      const r = await fetch(`${env.SPLYNX_URL}/api/2.0${ep}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      });
      if (r.ok) {
        const data = await r.json();
        if (data && data.phone) return data.phone;
      }
    } catch (e) {
      console.error("fetchCustomerMsisdn failed for", ep, e);
    }
  }
  return null;
}

// ---------- PDF Utilities ----------
async function createPdfTemplate(title, contentLines, signature, meta) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const { height } = page.getSize();
  let y = height - 50;

  page.drawText(title, {
    x: 50,
    y,
    size: 18,
    font: timesRomanFont,
    color: rgb(0, 0, 0),
  });
  y -= 40;

  for (const line of contentLines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 12,
      font: timesRomanFont,
      color: rgb(0, 0, 0),
    });
    y -= 20;
  }

  if (signature) {
    page.drawText("Signature:", { x: 50, y: 120, size: 12, font: timesRomanFont });
    const sigImg = await pdfDoc.embedPng(signature);
    const sigDims = sigImg.scale(0.5);
    page.drawImage(sigImg, { x: 120, y: 80, width: sigDims.width, height: sigDims.height });
  }

  if (meta) {
    page.drawText(`IP: ${meta.ip}`, { x: 50, y: 60, size: 10, font: timesRomanFont });
    page.drawText(`Device: ${meta.device}`, { x: 50, y: 45, size: 10, font: timesRomanFont });
    page.drawText(`Date: ${meta.date}`, { x: 50, y: 30, size: 10, font: timesRomanFont });
  }

  return await pdfDoc.save();
}
// =========================
// PDF SHARED HELPERS / CONST
// =========================

// Brand colors (Times fonts in use elsewhere)
const BRAND_RED = { r: 237 / 255, g: 28 / 255, b: 36 / 255 }; // ed1c24
const BRAND_BLACK = { r: 3 / 255, g: 3 / 255, b: 3 / 255 };   // 030303

// Fetch remote image (logo) as Uint8Array
async function fetchImageBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

// Draw dashed divider (uses drawLine with dashArray – no setLineWidth calls)
function drawDashedDivider(page, x1, x2, y, thickness = 1, color = BRAND_BLACK) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness,
    color: rgb(color.r, color.g, color.b),
    dashArray: [6, 4],
    dashPhase: 0,
  });
}

// Generic text wrapper (single column)
function drawWrappedText(page, text, opts) {
  const {
    x, yStart, width, font, size, lineHeight,
    color = BRAND_BLACK, maxY = 40,
  } = opts;

  let y = yStart;
  const words = String(text || '').split(/\s+/);
  let line = '';

  function flush() {
    if (!line) return;
    page.drawText(line.trimEnd(), {
      x, y, size, font,
      color: rgb(color.r, color.g, color.b),
    });
    y -= lineHeight;
    line = '';
  }

  for (const w of words) {
    const test = line + w + ' ';
    const tw = font.widthOfTextAtSize(test, size);
    if (tw > width) {
      flush();
      if (y <= maxY) break;
      line = w + ' ';
    } else {
      line = test;
    }
  }
  if (y > maxY) flush();
  return y; // last y position
}

// Two-column text wrapper for MSA terms (returns {pageY, nextPageNeeded})
function drawTwoColumnText(page, text, opts) {
  const {
    pageWidth, pageHeight,
    margin, gutter,
    colWidth,
    topY,
    minY,
    font, size, lineHeight,
    color = BRAND_BLACK,
  } = opts;

  let y = topY;
  let col = 0; // 0 = left, 1 = right
  let xLeft = margin;
  let xRight = margin + colWidth + gutter;

  const words = String(text || '').split(/\s+/);
  let line = '';

  function X() { return col === 0 ? xLeft : xRight; }
  function flush() {
    if (!line) return;
    page.drawText(line.trimEnd(), {
      x: X(),
      y,
      size, font,
      color: rgb(color.r, color.g, color.b),
    });
    y -= lineHeight;
    line = '';
  }

  for (const w of words) {
    const test = line + w + ' ';
    const tw = font.widthOfTextAtSize(test, size);
    if (tw > colWidth) {
      flush();
      if (y <= minY) {
        // next column
        if (col === 0) {
          col = 1;
          y = topY;
        } else {
          // next page required
          return { pageY: y, nextPageNeeded: true, remainder: words.slice(words.indexOf(w)).join(' ') };
        }
      }
      line = w + ' ';
    } else {
      line = test;
    }
  }
  // draw last line
  if (line) {
    flush();
  }
  return { pageY: y, nextPageNeeded: false, remainder: '' };
}

// Header block used by both PDFs
async function drawHeader(page, pdfDoc, options) {
  const {
    title,
    titleColor = BRAND_RED,
    logoUrl = LOGO_URL,
    website = "www.vinet.co.za",
    phone = "021 007 0200",
  } = options;

  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesBold);
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  // Try to place a bigger logo top-right
  const logoBytes = await fetchImageBytes(logoUrl);
  let logoW = 140; // 50% bigger than previous
  let logoH = 40;

  const { width: PW, height: PH } = page.getSize();
  const M = 40;
  let y = PH - 50;

  if (logoBytes) {
    try {
      const logoImg = await pdfDoc.embedPng(logoBytes).catch(async () => {
        // fallback to JPEG if PNG fails
        const jb = await pdfDoc.embedJpg(logoBytes);
        return jb;
      });
      const dims = logoImg.scale(1.0);
      const ratio = dims.height / dims.width;
      logoH = logoW * ratio;
      page.drawImage(logoImg, {
        x: PW - M - logoW,
        y: y - logoH + 10,
        width: logoW,
        height: logoH,
      });
    } catch {}
  }

  // Title left, red
  page.drawText(title, {
    x: M,
    y,
    size: 20,
    font: timesBold,
    color: rgb(titleColor.r, titleColor.g, titleColor.b),
  });
  y -= 22;

  // Under the logo: website and phone (small)
  page.drawText(website, {
    x: PW - M - logoW,
    y: y + 10,
    size: 10,
    font: times,
    color: rgb(BRAND_BLACK.r, BRAND_BLACK.g, BRAND_BLACK.b),
  });
  page.drawText(phone, {
    x: PW - M - logoW,
    y: y - 4,
    size: 10,
    font: times,
    color: rgb(BRAND_BLACK.r, BRAND_BLACK.g, BRAND_BLACK.b),
  });

  // Move y down, draw dashed divider lower
  y -= 18;
  drawDashedDivider(page, M, PW - M, y, 1, BRAND_BLACK);
  y -= 10;

  return { y };
}

// Small label/value row helper
function drawRow(page, fontLabel, fontValue, x, y, label, value, sizeLabel, sizeValue) {
  page.drawText(label, {
    x, y,
    size: sizeLabel,
    font: fontLabel,
    color: rgb(BRAND_BLACK.r, BRAND_BLACK.g, BRAND_BLACK.b),
  });
  page.drawText(String(value || ''), {
    x: x + 140,
    y,
    size: sizeValue,
    font: fontValue,
    color: rgb(BRAND_BLACK.r, BRAND_BLACK.g, BRAND_BLACK.b),
  });
  return y - 16;
}

// =========================
// DEBIT ORDER PDF (new look)
// =========================
async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) {
    return new Response("Debit Order not available for this link.", { status: 409 });
  }

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  // Terms
  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const termsResp = await fetch(termsUrl);
  const termsRaw = termsResp.ok ? await termsResp.text() : "Terms unavailable.";

  // Build PDF
  const pdf = await PDFDocument.create();
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesBold);

  // Page 1
  const page = pdf.addPage([595, 842]);
  const { width: PW, height: PH } = page.getSize();
  const M = 40;

  // Header
  const { y: headerEndY } = await drawHeader(page, pdf, {
    title: "Vinet Debit Order Instruction",
  });

  let y = headerEndY;

  // Left column: client info
  const leftX = M;
  const rightX = PW / 2 + 10;

  y = drawRow(page, bold, times, leftX, y, "Client code:", idOnly, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Full Name:", edits.full_name, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "ID / Passport:", edits.passport, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Email:", edits.email, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Phone:", edits.phone, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Street:", edits.street, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "City:", edits.city, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "ZIP:", edits.zip, 11, 11);

  // Right column: debit details
  let yr = headerEndY;
  page.drawText("Debit Order Details", {
    x: rightX, y: yr,
    size: 12,
    font: bold,
    color: rgb(BRAND_BLACK.r, BRAND_BLACK.g, BRAND_BLACK.b),
  });
  yr -= 18;

  yr = drawRow(page, bold, times, rightX, yr, "Account Holder Name:", d.account_holder, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Account Holder ID :", d.id_number, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Bank:", d.bank_name, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Bank Account No:", d.account_number, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Account Type:", d.account_type, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Debit Order Date:", d.debit_day, 11, 11);

  // Information section divider (full width)
  const infoBottomY = Math.min(y, yr) - 8;
  drawDashedDivider(page, M, PW - M, infoBottomY, 1, BRAND_BLACK);

  // Terms block (no columns), font size 8–9
  const termsTopY = infoBottomY - 12;
  const termsSize = 8;
  const lineH = 12;
  let ty = drawWrappedText(page, termsRaw, {
    x: M,
    yStart: termsTopY,
    width: PW - M * 2,
    font: times,
    size: termsSize,
    lineHeight: lineH,
    color: BRAND_BLACK,
    maxY: 110, // leave room for signature row
  });

  // Signature row at the bottom (name left, signature center, date right)
  const sigRowY = 90;
  page.drawText("Full Name:", { x: M, y: sigRowY + 22, size: 10, font: bold });
  page.drawText(String(edits.full_name || ''), { x: M + 70, y: sigRowY + 22, size: 10, font: times });

  page.drawText("Signature:", { x: PW / 2 - 60, y: sigRowY + 22, size: 10, font: bold });
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  if (sigBytes) {
    try {
      const sigImg = await pdf.embedPng(sigBytes);
      const w = 160;
      const s = sigImg.scale(1);
      const h = (s.height / s.width) * w;
      page.drawImage(sigImg, { x: PW / 2 - 20, y: sigRowY - 6, width: w, height: h });
    } catch {}
  }

  page.drawText("Date (DD/MM/YYYY):", { x: PW - M - 160, y: sigRowY + 22, size: 10, font: bold });
  // Render date string right-aligned-ish
  const today = new Date();
  const dStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  page.drawText(dStr, { x: PW - M - 160 + 130, y: sigRowY + 22, size: 10, font: times });

  // Page 2: Security audit page
  const page2 = pdf.addPage([595, 842]);
  const { width: PW2, height: PH2 } = page2.getSize();
  const { y: y2 } = await drawHeader(page2, pdf, {
    title: "Debit Order Security Audit",
  });

  // Some basic audit info (use what we have in KV session)
  let ay = y2;
  page2.drawText(`Splynx ID: ${idOnly}`, { x: M, y: ay, size: 12, font: times });
  ay -= 16;
  page2.drawText(`Client: ${String(edits.full_name || '')}`, { x: M, y: ay, size: 12, font: times });
  ay -= 16;
  page2.drawText(`Collected: ${today.toISOString()}`, { x: M, y: ay, size: 12, font: times });
  ay -= 16;
  page2.drawText(`Client IP: ${String(sess.last_ip || '')}`, { x: M, y: ay, size: 12, font: times });
  ay -= 16;
  page2.drawText(`User Agent: ${String(sess.last_ua || '').slice(0, 120)}`, { x: M, y: ay, size: 12, font: times });

  // Cache & return
  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf" } });
}

// =========================
// MSA PDF (Times, 2 columns)
// =========================
async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  // Terms (MSA)
  const termsUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const resp = await fetch(termsUrl);
  let terms = resp.ok ? await resp.text() : "Terms unavailable.";

  // Replace curly quotes with straight quotes to avoid WinAnsi errors
  terms = terms.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
               .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Build PDF
  const pdf = await PDFDocument.create();
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesBold);

  // Page 1: header + client info (split into left/right)
  const page = pdf.addPage([595, 842]);
  const { width: PW, height: PH } = page.getSize();
  const M = 40;

  const { y: headerEndY } = await drawHeader(page, pdf, {
    title: "Vinet Internet Solutions Service Agreement",
  });
  let y = headerEndY;

  // Left block (client code, Full name, ID/Passport, Email)
  const leftX = M;
  const rightX = PW / 2 + 10;
  y = drawRow(page, bold, times, leftX, y, "Client code:", idOnly, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Full Name:", edits.full_name, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "ID / Passport:", edits.passport, 11, 11);
  y = drawRow(page, bold, times, leftX, y, "Email:", edits.email, 11, 11);

  // Right block (Phone, Street, City, ZIP)
  let yr = headerEndY;
  yr = drawRow(page, bold, times, rightX, yr, "Phone:", edits.phone, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "Street:", edits.street, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "City:", edits.city, 11, 11);
  yr = drawRow(page, bold, times, rightX, yr, "ZIP:", edits.zip, 11, 11);

  // Divider to end off the info section
  const infoBottomY = Math.min(y, yr) - 8;
  drawDashedDivider(page, M, PW - M, infoBottomY, 1, BRAND_BLACK);

  // Terms in 2 columns, likely spans multiple pages
  const topY = infoBottomY - 14;
  const margin = M;
  const gutter = 18;
  const colWidth = (PW - margin * 2 - gutter) / 2;
  const minY = 120; // leave room for signature lines on last page
  const size = 7;
  const lineHeight = 10;

  let textLeft = terms;
  let curPage = page;
  let curY = topY;

  while (textLeft && textLeft.trim().length > 0) {
    const result = drawTwoColumnText(curPage, textLeft, {
      pageWidth: PW, pageHeight: PH,
      margin, gutter, colWidth, topY, minY,
      font: times, size, lineHeight,
      color: BRAND_BLACK,
    });

    if (result.nextPageNeeded) {
      // New page with header (no info block, just a tiny header line)
      curPage = pdf.addPage([595, 842]);
      const { y: yHdr } = await drawHeader(curPage, pdf, {
        title: "Vinet Internet Solutions Service Agreement",
      });
      curY = yHdr - 8;
      // divider
      drawDashedDivider(curPage, M, PW - M, curY, 1, BRAND_BLACK);
      textLeft = result.remainder || '';
    } else {
      // finished placing text in this page
      textLeft = '';
      curY = result.pageY;
      break;
    }
  }

  // Last page: signature row (bottom)
  const sigY = 90;
  curPage.drawText("Full Name:", { x: M, y: sigY + 22, size: 10, font: bold });
  curPage.drawText(String(edits.full_name || ''), { x: M + 70, y: sigY + 22, size: 10, font: times });

  curPage.drawText("Signature:", { x: PW / 2 - 60, y: sigY + 22, size: 10, font: bold });
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    try {
      const sigImg = await pdf.embedPng(sigBytes);
      const w = 160;
      const s = sigImg.scale(1);
      const h = (s.height / s.width) * w;
      curPage.drawImage(sigImg, { x: PW / 2 - 20, y: sigY - 6, width: w, height: h });
    } catch {}
  }

  curPage.drawText("Date (DD/MM/YYYY):", { x: PW - M - 160, y: sigY + 22, size: 10, font: bold });
  const now = new Date();
  const dStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  curPage.drawText(dStr, { x: PW - M - 160 + 130, y: sigY + 22, size: 10, font: times });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf" } });
}
// =========================
// OTP (WhatsApp + staff fallback)
// =========================

// Send via approved WhatsApp template with single body parameter (the code)
async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en_US") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: toMsisdn,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] }
      ]
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`WA template send failed ${r.status} ${t}`);
  }
}

// =========================
// ADMIN UI (HTML + JS)
// =========================

function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--red:#ed1c24}
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0}
  .card{background:#fff;max-width:1000px;margin:28px auto;border-radius:20px;box-shadow:0 2px 12px #0002;padding:24px}
  .logo{display:block;margin:0 auto 10px;max-width:120px}
  h1,h2{color:var(--red);margin:.2em 0}
  .tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
  .tab{padding:.55em 1em;border-radius:.7em;border:2px solid var(--red);color:var(--red);cursor:pointer;user-select:none}
  .tab.active{background:var(--red);color:#fff}
  .btn{background:var(--red);color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
  .btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
  .field{margin:.9em 0}
  input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
  .row{display:flex;gap:.75em}.row>*{flex:1}
  table{width:100%;border-collapse:collapse} th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
  .note{font-size:12px;color:#666} #out a{word-break:break-all}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>
  <div class="tabs">
    <div class="tab active" data-tab="gen">Generate onboarding link</div>
    <div class="tab" data-tab="staff">Generate verification code</div>
    <div class="tab" data-tab="inprog">Pending (in-progress)</div>
    <div class="tab" data-tab="pending">Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">Approved</div>
  </div>
  <div id="content"></div>
</div>
<script src="/static/admin.js"></script>
</body></html>`;
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
    const node = html => { const d=document.createElement('div'); d.innerHTML=html; return d; };

    async function load(which){
      if (which==='gen') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id" autocomplete="off"/><button class="btn" id="go">Generate</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
          if(!id){out.textContent='Please enter an ID.';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.url?'<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>':'Error generating link.';
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (which==='staff') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
          if(!linkid){out.textContent='Enter linkid';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> (valid 15 min)':(d.error||'Failed');
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML='Loading...';
        try{
          const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
          const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+(which==='pending'?'<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>':'<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+'</td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML='<table style="max-width:900px;margin:0 auto"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        }catch{content.innerHTML='Failed to load.';}
        return;
      }
    }
  })();`;
}

// =========================
// ONBOARDING UI (HTML)
// =========================

function renderOnboardUI(linkid) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root{--red:#ed1c24}
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:var(--red)}
  .btn{background:var(--red);color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:var(--red);border:2px solid var(--red);border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.4em 0 2.2em;overflow:hidden}
  .progress{height:100%;background:var(--red);transition:width .4s}
  .row{display:flex;gap:.75em}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid var(--red);color:var(--red);padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:var(--red);color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
  .accent { height:8px; background:var(--red); border-radius:4px; width:60%; max-width:540px; margin:10px auto 18px; }
  .final p { margin:.35em 0 .65em; }
  .final ul { margin:.25em 0 0 1em; }
  .doclist { list-style:none; margin:.4em 0 0 0; padding:0; }
  .doclist .doc-item { display:flex; align-items:center; gap:.5em; margin:.45em 0; }
  .doclist .doc-ico { display:inline-flex; width:18px; height:18px; opacity:.9; }
  .doclist .doc-ico svg { width:18px; height:18px; }
  .doclist a { text-decoration:none; }
  .doclist a:hover { text-decoration:underline; }
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); } // 0..6
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send. Ask Vinet for a staff code.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
  }

  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  function step1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again or ask Vinet for a staff code.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');

    function renderEft(){
      const id = (linkid||'').split('_')[0];
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML = [
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a></div>'
      ].join('');
    }

    let dPad = null; // debit signature pad
    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('debitBox');
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
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick = (e)=>{ e.preventDefault(); dPad.clear(); };
    }

    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; dPad=null; }
    function hideEft(){ const box=document.getElementById('eftBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); renderEft(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; hideEft(); renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm(); else renderEft();

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        const msg = document.getElementById('d_msg');
        if (!document.getElementById('d_agree').checked) { msg.textContent='Please confirm you agree to the Debit Order terms.'; return; }
        if (!dPad || dPad.isEmpty()) { msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed:         true
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save?linkid='+encodeURIComponent(linkid), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
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
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', passport: state.edits.passport ?? p.passport ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // Step 4 (uploads) and Step 5 (MSA) and Step 6 (final) are in Part 4
  function render(){ setProg(); [step0,step1,step2,step3][step](); }
  render();
})();
</script>
</body></html>`;
}
// =========================
// ONBOARDING UI (continued: steps 4–6)
// =========================

// (This function string is injected by renderOnboardUI in Part 3)
// We continue inside the same IIFE scope in the browser:

// NOTE to reader: This block is appended to the string returned by renderOnboardUI().
// It starts with Step 4 definition and redefines render() to include steps 4–6.

function _appendOnboardingStep456() {
  return `
  function step4(){
    stepEl.innerHTML = [
      '<h2>Upload documents</h2>',
      '<div class="note">Please upload your ID and Proof of Address (max 2 files, 5MB each). You can also skip and come back later using your onboarding link.</div>',
      '<div class="field"><label>ID Document</label><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><label>Proof of Address</label><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row">',
        '<a class="btn-outline" id="back3">Back</a>',
        '<button class="btn" id="skip">I will upload later</button>',
        '<button class="btn" id="next">Continue</button>',
      '</div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };

    document.getElementById('skip').onclick=(e)=>{
      e.preventDefault();
      // Mark as incomplete, preserve session
      state.uploads = state.uploads || [];
      state.skipped_uploads = true;
      save();
      step=5; state.progress=step; setProg(); render();
    };

    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');

      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { msg.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }

      try {
        msg.textContent = 'Uploading...';
        const f1 = document.getElementById('file1').files[0];
        const f2 = document.getElementById('file2').files[0];
        const u1 = await up(f1, 'ID Document');
        const u2 = await up(f2, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        state.skipped_uploads = false;
        msg.textContent = 'Uploaded.';
        step=5; state.progress=step; setProg(); save(); render();
      } catch (err) { if (msg.textContent==='') msg.textContent='Upload failed.'; }
    };
  }

  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{
        const dataUrl=pad.dataURL();
        const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})});
        const d=await r.json().catch(()=>({ok:false}));
        if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; }
      }catch{ msg.textContent='Network error.'; }
    };
  }

  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    const docIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5L18.5 8H14V3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zM8 9h4v1.5H8V9z"/></svg>';
    stepEl.innerHTML = [
      '<div class="final">',
        '<h2 style="color:#ed1c24;margin:0 0 .2em">All set!</h2>',
        '<div class="accent"></div>',
        '<p>Thanks – we’ve recorded your information. Our team will be in contact shortly.</p>',
        '<p>If you have any questions, please contact our sales team:</p>',
        '<ul>',
          '<li><b>Phone:</b> <a href="tel:+27210070200">021 007 0200</a></li>',
          '<li><b>Email:</b> <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></li>',
        '</ul>',
        '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
        '<div class="field"><b>Your agreements</b> <span class="note">(links work after signing; PDFs generate instantly)</span></div>',
        '<ul class="doclist">',
          '<li class="doc-item"><span class="doc-ico">', docIcon, '</span>',
            '<a href="/pdf/msa/', linkid, '" target="_blank">Master Service Agreement (PDF)</a>',
            ' &nbsp;•&nbsp; <a href="/agreements/msa/', linkid, '" target="_blank">View in browser</a>',
          '</li>',
          (showDebit
            ? '<li class="doc-item"><span class="doc-ico">' + docIcon + '</span>' +
              '<a href="/pdf/debit/' + linkid + '" target="_blank">Debit Order Agreement (PDF)</a>' +
              ' &nbsp;•&nbsp; <a href="/agreements/debit/' + linkid + '" target="_blank">View in browser</a>' +
              '</li>'
            : ''),
        '</ul>',
      '</div>'
    ].join('');
  }

  // rebind renderer with steps 0..6
  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
  `;
}

// =========================
// TERMS + TEXT FETCH
// =========================

async function fetchTextCached(url, env, cachePrefix = "terms") {
  const key = `${cachePrefix}:${btoa(url).slice(0, 40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!r.ok) return "";
    const t = await r.text();
    await env.ONBOARD_KV.put(key, t, { expirationTtl: 60 * 60 * 24 * 7 });
    return t;
  } catch { return ""; }
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
}

// =========================
// R2 helpers
// =========================
async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch { return null; }
}

// =========================
// Worker entry
// =========================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // ----- Admin UI -----
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // ----- Terms (for UI display) -----
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      async function getText(u) { try { const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } }); return r.ok ? await r.text() : ""; } catch { return ""; } }
      const esc = s => s.replace(/[&<>]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[t]));
      const service = esc(await getText(svcUrl) || "");
      const debit   = esc(await getText(debUrl) || "");
      let body = "";
      if (kind === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Info pages -----
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Onboarding UI -----
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });

      // inject steps 4–6 code into the page string
      const html = renderOnboardUI(linkid).replace(
        /<\/script>\s*<\/body>/i,
        _appendOnboardingStep456() + "</script></body>"
      );
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Uploads (R2) -----
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const label = urlParams.get("label") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
      uploads.push({ key, name: fileName, size: body.byteLength, label });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads, last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok: true, key });
    }

    // ----- Save progress -----
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: getIP(), last_ua: getUA(), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok: true });
    }

    // ----- Service agreement signature (MSA) -----
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok: false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending", last_time: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // ----- Debit save + signature -----
    if (path === "/api/debit/save" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid") || "";
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(() => null);
        if (!form) return {};
        const o = {}; for (const [k, v] of form.entries()) o[k] = v; return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });

      // persist on session to drive HTML viewer + PDF
      if (linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit: { ...record }, last_time: Date.now() }), { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey, last_time: Date.now() }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // ----- Admin: generate link -----
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // ----- Admin: staff OTP -----
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // ----- WhatsApp OTP send/verify -----
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try { await sendWhatsAppTemplate(env, msisdn, code, "en_US"); return json({ ok:true }); }
      catch(e){ return json({ ok:false, error:"WhatsApp template send failed" }, 502); }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true, last_time: Date.now() }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ----- Admin list -----
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // ----- Admin review -----
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${escapeHtml(u.label||'File')}</b> — ${escapeHtml(u.name||'')} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#ed1c24}.btn{background:#ed1c24;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#ed1c24;border:2px solid #ed1c24;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id||'')}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${escapeHtml(k)}</b>: ${v?escapeHtml(String(v)):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now(), last_time: Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    // Push-to-Splynx can be added or restored later if needed; keeping approve stub
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return json({ ok:true });
    }

    // ---------- Agreements assets (signature PNGs) ----------
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // ---------- Agreement HTML pages (with terms underneath) ----------
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status: 404 });

      const e = sess.edits || {};
      const today = (new Date()).toISOString().slice(0,10);
      const name  = escapeHtml(e.full_name||'');
      const email = escapeHtml(e.email||'');
      const phone = escapeHtml(e.phone||'');
      const street= escapeHtml(e.street||'');
      const city  = escapeHtml(e.city||'');
      const zip   = escapeHtml(e.zip||'');
      const passport = escapeHtml(e.passport||'');
      const debit = sess.debit || null;

      const msaTerms = await fetchTextCached(env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt", env, "terms:msa");
      const debitTerms = await fetchTextCached(env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt", env, "terms:debit");

      function page(title, body){ return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
        .card{background:#fff;max-width:820px;margin:24px auto;border-radius:14px;box-shadow:0 2px 12px #0002;padding:22px 26px}
        h1{color:#ed1c24;margin:.2em 0 .3em;font-size:28px}.b{font-weight:600}
        table{width:100%;border-collapse:collapse;margin:.6em 0}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
        .muted{color:#666;font-size:12px}.sig{margin-top:14px}.sig img{max-height:120px;border:1px dashed #bbb;border-radius:6px;background:#fff}
        .actions{margin-top:14px}.btn{background:#ed1c24;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
        .logo{height:60px;display:block;margin:0 auto 10px}@media print {.actions{display:none}}
        pre.terms{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:12px;border-radius:8px}
      </style></head><body><div class="card">
        <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>${escapeHtml(title)}</h1>
        ${body}
        <div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
        <div class="muted">Generated ${today} • Link ${escapeHtml(linkid)}</div>
      </div></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});}

      if (type === "msa") {
        const body = `
          <p>This document represents your Master Service Agreement with Vinet Internet Solutions.</p>
          <table>
            <tr><th class="b">Customer</th><td>${name}</td></tr>
            <tr><th class="b">Email</th><td>${email}</td></tr>
            <tr><th class="b">Phone</th><td>${phone}</td></tr>
            <tr><th class="b">ID / Passport</th><td>${passport}</td></tr>
            <tr><th class="b">Address</th><td>${street}, ${city}, ${zip}</td></tr>
            <tr><th class="b">Date</th><td>${today}</td></tr>
          </table>
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig/${linkid}.png" alt="signature">
          </div>
          <h2>Terms</h2>
          <pre class="terms">${escapeHtml(msaTerms || "Terms unavailable.")}</pre>`;
        return page("Master Service Agreement", body);
      }

      if (type === "debit") {
        const hasDebit = !!(debit && debit.account_holder && debit.account_number);
        const debitHtml = hasDebit ? `
          <table>
            <tr><th class="b">Account Holder</th><td>${escapeHtml(debit.account_holder||'')}</td></tr>
            <tr><th class="b">ID Number</th><td>${escapeHtml(debit.id_number||'')}</td></tr>
            <tr><th class="b">Bank</th><td>${escapeHtml(debit.bank_name||'')}</td></tr>
            <tr><th class="b">Account No</th><td>${escapeHtml(debit.account_number||'')}</td></tr>
            <tr><th class="b">Account Type</th><td>${escapeHtml(debit.account_type||'')}</td></tr>
            <tr><th class="b">Debit Day</th><td>${escapeHtml(debit.debit_day||'')}</td></tr>
          </table>` : `<p class="muted">No debit order details on file for this onboarding.</p>`;
        const body = `
          <p>This document represents your Debit Order Instruction.</p>
          ${debitHtml}
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
          </div>
          <h2>Terms</h2>
          <pre class="terms">${escapeHtml(debitTerms || "Terms unavailable.")}</pre>`;
        return page("Debit Order Agreement", body);
      }

      return new Response("Unknown agreement type", { status: 404 });
    }

    // PDF endpoints and the rest of the file continue in Part 5...
// =========================
// PDF HELPERS (common)
// =========================

import { PDFDocument, StandardFonts /*, rgb*/ } from "pdf-lib"; // rgb may not be bundled by wrangler -> provide safe shim below

// Safe rgb shim (works even if pdf-lib's rgb helper isn't available in this bundle)
const rgbSafe = (r, g, b) => {
  try { /* if rgb exists */ if (typeof rgb === 'function') return rgb(r,g,b); } catch {}
  return { type: 'RGB', r, g, b };
};

// VINET colours
const VINET_RED = rgbSafe(237/255, 28/255, 36/255); // #ed1c24
const VINET_BLACK = rgbSafe(3/255, 3/255, 3/255);   // #030303

// replace smart quotes / unsupported WinAnsi glyphs with ASCII equivalents
function sanitizeWinAnsi(s) {
  if (!s) return '';
  return String(s)
    // quotes/apostrophes
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033\u201F]/g, '"')
    // dashes
    .replace(/[\u2013\u2014\u2212]/g, "-")
    // ellipsis
    .replace(/\u2026/g, "...")
    // bullets
    .replace(/[\u2022\u25CF]/g, "*")
    // non-breaking space
    .replace(/\u00A0/g, " ");
}

// try to embed logo as PNG then JPG
async function embedLogo(pdf, env) {
  const url = LOGO_URL || "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 }});
    if (!r.ok) throw new Error("logo fetch fail");
    const bytes = await r.arrayBuffer();
    try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
  } catch { return null; }
}

// dashed horizontal line using small rectangles (works without line APIs)
function drawDashedHLine(page, x1, x2, y, dash=6, gap=4, thickness=1, color=VINET_BLACK) {
  const width = Math.max(0, x2 - x1);
  let x = x1;
  while (x < x2) {
    const w = Math.min(dash, x2 - x);
    if (w <= 0) break;
    page.drawRectangle({ x, y: y - thickness/2, width: w, height: thickness, color });
    x += dash + gap;
  }
}

// solid horizontal line
function drawSolidHLine(page, x1, x2, y, thickness=1, color=VINET_BLACK) {
  page.drawRectangle({ x: x1, y: y - thickness/2, width: (x2 - x1), height: thickness, color });
}

// text wrappers
function wrapToLines(text, font, size, maxWidth) {
  const words = sanitizeWinAnsi(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? (line + " " + w) : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(page, text, x, y, font, size, maxWidth, lineHeight) {
  const lines = wrapToLines(text, font, size, maxWidth);
  for (const ln of lines) {
    page.drawText(ln, { x, y, size, font });
    y -= lineHeight;
  }
  return y;
}

// column flow helper for multi-page, multi-column terms (MSA)
function drawTwoColumnTerms(pdf, page, terms, fonts, startY, margin, gap) {
  const { font, size, lineHeight } = fonts; // size=7, lineHeight ~9.5
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const colGap = gap || 18;
  const colW = (pageWidth - margin*2 - colGap) / 2;
  let x = margin;
  let y = startY;

  function newPage() {
    const p = pdf.addPage([pageWidth, pageHeight]);
    return p;
  }

  const paragraphs = sanitizeWinAnsi(terms).split(/\n{2,}/); // keep paragraphs
  for (const para of paragraphs) {
    // paragraph can be long; break to lines then place across columns, making new pages as needed
    const lines = wrapToLines(para, font, size, colW);
    for (const ln of lines) {
      // new column/page if out of space
      if (y < margin + 40) {
        // move to next column or page
        if (x === margin) { // go to right column
          x = margin + colW + colGap;
          y = startY;
        } else { // new page and return to left column
          page = newPage();
          x = margin;
          y = pageHeight - margin - 20;
        }
      }
      page.drawText(ln, { x, y, size, font });
      y -= lineHeight;
    }
    // blank line between paragraphs
    y -= Math.floor(lineHeight / 2);
  }

  return { page, x, y, colW };
}

// common header for PDFs (logo + contact line + title + dashed divider)
async function drawHeader(pdf, page, env, titleText) {
  const M = 40;
  const W = page.getWidth();
  let y = page.getHeight() - M;

  // logo bigger (50% larger than before)
  const logo = await embedLogo(pdf, env);
  if (logo) {
    const maxW = 220; // increased
    const scaled = logo.scale(1);
    const w = Math.min(maxW, scaled.width);
    const h = (scaled.height / scaled.width) * w;
    page.drawImage(logo, { x: (W - w)/2, y: y - h, width: w, height: h });
    y -= (h + 6);
  }

  // website + phone under logo
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesBold);

  const contact = "www.vinet.co.za • 021 007 0200";
  page.drawText(contact, {
    x: (W - font.widthOfTextAtSize(contact, 11))/2,
    y: y - 13,
    size: 11,
    font
  });
  y -= 22;

  // Title in VINET red
  const ttl = sanitizeWinAnsi(titleText);
  page.drawText(ttl, {
    x: M, y,
    size: 18,
    font: bold,
    color: VINET_RED
  });
  y -= 14;

  // dashed divider (placed a tad lower)
  y -= 6;
  drawDashedHLine(page, M, W - M, y, 8, 5, 1.2, VINET_BLACK);
  y -= 10;

  return y; // content start y
}

// footer signature/date row
function drawSignatureRow(page, pdfFonts, y, leftName, centerSigPngBytes, rightDateText) {
  const { font, bold } = pdfFonts;
  const W = page.getWidth();
  const M = 40;

  // target baseline
  let baseY = y;

  // Left: Client full name label + value
  page.drawText("Full Name:", { x: M, y: baseY, size: 11, font: bold });
  page.drawText(sanitizeWinAnsi(leftName||""), { x: M + 80, y: baseY, size: 11, font });

  // Center: Signature image above small caption line
  const centerX = W/2;
  const sigW = 180, sigH = 60;

  if (centerSigPngBytes) {
    (async () => {})(); // keep eslint happy
  }

  return { baseY, M, W, sigW, sigH, centerX };
}

// draw centered signature box + labels (synchronous helper using embedded PNG passed in)
function drawSignatureAndDate(page, pdf, fonts, y, nameText, sigBytes, dateText) {
  const { font, bold } = fonts;
  const W = page.getWidth();
  const M = 40;

  // Left name
  page.drawText("Full Name:", { x: M, y, size: 11, font: bold });
  page.drawText(sanitizeWinAnsi(nameText||""), { x: M + 80, y, size: 11, font });

  // Center signature (above caption "Signature")
  let sigH = 0;
  if (sigBytes) {
    page.drawText("Signature:", { x: (W/2) - 40, y, size: 11, font: bold });
    const yImg = y - 56;
    try {
      const img = (async()=>sigBytes)(); // placeholder so linter doesn't warn
    } catch {}
  }

  // We'll embed and draw synchronously in callers (see PDF renderers)
}

// helper to embed PNG/JPG bytes
async function embedAnyImage(pdf, bytes) {
  try { return await pdf.embedPng(bytes); } catch { try { return await pdf.embedJpg(bytes); } catch { return null; } }
}

// security audit page
function addSecurityAuditPage(pdf, fonts, sess, linkid) {
  const page = pdf.addPage([595, 842]);
  const { font, bold } = fonts;
  const M = 40;
  let y = page.getHeight() - M;

  // Header (simple)
  page.drawText("Security Audit", { x: M, y, size: 16, font: bold, color: VINET_RED });
  y -= 12;
  drawDashedHLine(page, M, page.getWidth() - M, y, 8, 5, 1.2, VINET_BLACK);
  y -= 16;

  const pairs = [
    ["Link ID", linkid],
    ["Splynx ID", (sess && sess.id) || ""],
    ["Created", (sess && sess.created) ? new Date(sess.created).toISOString() : ""],
    ["Last update", (sess && sess.last_time) ? new Date(sess.last_time).toISOString() : ""],
    ["Last IP", (sess && sess.last_ip) || ""],
    ["Last UA", (sess && sess.last_ua) || ""],
  ];
  for (const [k,v] of pairs) {
    page.drawText(`${k}:`, { x: M, y, size: 11, font: bold });
    page.drawText(sanitizeWinAnsi(String(v||'')), { x: M + 120, y, size: 11, font });
    y -= 16;
  }
}

// =========================
// PDF: MSA
// =========================

async function renderMSAPdf(env, linkid) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) return new Response("MSA not available for this link.", { status: 409 });

  const edits = sess.edits || {};
  const termsUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const termsRaw = await fetchTextCached(termsUrl, env, "terms:msa");
  const terms = sanitizeWinAnsi(termsRaw || "Terms unavailable.");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesBold);
  const fonts = { font, bold };

  // Header
  let y = await drawHeader(pdf, page, env, "Vinet Internet Solutions Service Agreement");

  // Personal info split left/right (as requested)
  const M = 40, W = page.getWidth();
  const idOnly = String(linkid).split("_")[0];

  // Left
  const left = [
    ["Client code:", idOnly],
    ["Full Name:", edits.full_name],
    ["ID / Passport:", edits.passport],
    ["Email:", edits.email],
  ];

  // Right
  const right = [
    ["Phone:", edits.phone],
    ["Street:", edits.street],
    ["City:", edits.city],
    ["ZIP:", edits.zip],
  ];

  function drawBlock(block, x, y0) {
    let yy = y0;
    for (const [k,v] of block) {
      page.drawText(k, { x, y: yy, size: 11, font: bold });
      page.drawText(sanitizeWinAnsi(String(v||"")), { x: x + 120, y: yy, size: 11, font });
      yy -= 16;
    }
    return yy;
  }

  const yLeft = drawBlock(left, M, y);
  const yRight = drawBlock(right, W/2 + 10, y);
  y = Math.min(yLeft, yRight) - 8;

  // end of info section divider
  drawDashedHLine(page, M, W - M, y, 8, 5, 1.2, VINET_BLACK);
  y -= 12;

  // Terms two columns: 7pt; likely many pages
  const termsFonts = { font, size: 7, lineHeight: 9.5 };
  const startY = y; // start on current page
  const result = drawTwoColumnTerms(pdf, page, terms, termsFonts, startY, M, 18);
  let endPage = result.page;

  // Final signature/date on last page bottom (page may have changed)
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  const lastPage = endPage;
  let sigY = 70; // distance from bottom upwards
  const bottomY = 70;

  // Draw signature row
  // Left name
  lastPage.drawText("Full Name:", { x: M, y: bottomY, size: 11, font: bold });
  lastPage.drawText(sanitizeWinAnsi(edits.full_name||""), { x: M + 80, y: bottomY, size: 11, font });

  // Center signature
  lastPage.drawText("Signature:", { x: (W/2) - 40, y: bottomY, size: 11, font: bold });
  if (sigBytes) {
    const img = await embedAnyImage(pdf, sigBytes);
    if (img) {
      const wImg = 180;
      const hImg = (img.height / img.width) * wImg;
      lastPage.drawImage(img, { x: (W/2) - (wImg/2), y: bottomY + 8, width: wImg, height: hImg });
    }
  }
  // Right date
  const today = new Date().toISOString().slice(0,10);
  lastPage.drawText("Date:", { x: W - M - 120, y: bottomY, size: 11, font: bold });
  lastPage.drawText(today, { x: W - M - 80, y: bottomY, size: 11, font });

  // Audit page
  addSecurityAuditPage(pdf, { font, bold }, sess, linkid);

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// =========================
// PDF: Debit Order
// =========================

async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) return new Response(cached, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) return new Response("Debit Order not available for this link.", { status: 409 });

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const termsRaw = await fetchTextCached(termsUrl, env, "terms:debit");
  const terms = sanitizeWinAnsi(termsRaw || "Terms unavailable.");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesBold);

  // Header (with requested title casing and in red)
  let y = await drawHeader(pdf, page, env, "Vinet Debit Order Instruction");

  const M = 40, W = page.getWidth();

  // Left block (client info)
  const left = [
    ["Client code:", idOnly],
    ["Full Name:", edits.full_name],
    ["ID / Passport:", edits.passport],
    ["Email:", edits.email],
    ["Phone:", edits.phone],
    ["Street:", edits.street],
    ["City:", edits.city],
    ["ZIP:", edits.zip],
  ];

  // Right block (Debit Order Details)
  const rightTitle = "Debit Order Details";
  const right = [
    ["Account Holder Name:", d.account_holder],
    ["Account Holder ID:", d.id_number],
    ["Bank:", d.bank_name],
    ["Bank Account No:", d.account_number],
    ["Account Type:", d.account_type],
    ["Debit Order Date:", d.debit_day],
  ];

  function drawBlock(block, x, y0) {
    let yy = y0;
    for (const [k,v] of block) {
      page.drawText(k, { x, y: yy, size: 11, font: bold });
      page.drawText(sanitizeWinAnsi(String(v||"")), { x: x + 150, y: yy, size: 11, font });
      yy -= 16;
    }
    return yy;
  }

  // Left
  const yLeft = drawBlock(left, M, y);
  // Right with heading slightly larger
  page.drawText(rightTitle, { x: W/2 + 10, y, size: 13, font: bold });
  const yRight = drawBlock(right, W/2 + 10, y - 18);

  y = Math.min(yLeft, yRight) - 10;

  // closing dashed divider
  drawDashedHLine(page, M, W - M, y, 8, 5, 1.2, VINET_BLACK);
  y -= 10;

  // Terms (8 or 9pt)
  const sizeTerms = 8; // per discussion
  const lhTerms = 10.8;
  y = drawParagraph(page, terms, M, y, font, sizeTerms, W - 2*M, lhTerms) - 10;

  // Signature row at bottom
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  const today = new Date().toISOString().slice(0,10);

  // left name
  page.drawText("Full Name:", { x: M, y, size: 11, font: bold });
  page.drawText(sanitizeWinAnsi(edits.full_name||""), { x: M + 80, y, size: 11, font });

  // center signature image above label
  page.drawText("Signature:", { x: (W/2) - 40, y, size: 11, font: bold });
  if (sigBytes) {
    const img = await embedAnyImage(pdf, sigBytes);
    if (img) {
      const wImg = 180;
      const hImg = (img.height / img.width) * wImg;
      page.drawImage(img, { x: (W/2) - (wImg/2), y: y + 8, width: wImg, height: hImg });
    }
  }

  // right date
  page.drawText("Date:", { x: W - M - 120, y, size: 11, font: bold });
  page.drawText(today, { x: W - M - 80, y, size: 11, font });

  // Security audit second page
  addSecurityAuditPage(pdf, { font, bold }, sess, linkid);

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 60 * 60 * 24 * 7 });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" } });
}

// =========================
// PDF ROUTES
// =========================

/* These continue from the fetch handler in Part 4; paste right after the
   /agreements/* block and before the final default 404.
   We include both PDF endpoints using the new renderers above. */

async function handlePdfRoutes(path, env) {
  if (path.startsWith("/pdf/msa/")) {
    const linkid = path.split("/").pop();
    return await renderMSAPdf(env, linkid);
  }
  if (path.startsWith("/pdf/debit/")) {
    const linkid = path.split("/").pop();
    return await renderDebitPdf(env, linkid);
  }
  return null;
}
// =========================
// SPYLNX PUT + PUSH HELPERS
// =========================

async function splynxPUT(env, endpoint, payload) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Splynx PUT ${endpoint} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}

// Try update as customer first, otherwise as lead (/admin/crm/leads/:id)
async function pushEditsToSplynx(env, id, edits) {
  const up = {};
  // basic fields
  if (edits.full_name) up.full_name = edits.full_name;
  if (edits.email) up.email = edits.email;
  if (edits.phone) up.phone_mobile = edits.phone; // common Splynx field
  // address fields (common names in Splynx)
  if (edits.street) up.street = edits.street;
  if (edits.city) up.city = edits.city;
  if (edits.zip) up.zip_code = edits.zip;

  // 1) Customer
  try {
    await splynxPUT(env, `/admin/customers/customer/${id}`, up);
    return { ok: true, kind: "customer" };
  } catch (e1) {
    // 2) Lead (note: your requested prefix /admin/crm)
    try {
      await splynxPUT(env, `/admin/crm/leads/${id}`, up);
      return { ok: true, kind: "lead" };
    } catch (e2) {
      return { ok: false, error: `Update failed: ${String(e2 && e2.message || e1 && e1.message || 'unknown')}` };
    }
  }
}

// =========================
// MAIN FETCH TAIL (routes)
// =========================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

    // ---------- ADMIN ACCESS GATE ----------
    const isAdminPath =
      path === "/" ||
      path === "/static/admin.js" ||
      path === "/admin/review" ||
      path.startsWith("/api/admin/");
    if (isAdminPath && !ipAllowed(request)) {
      return new Response("Forbidden", { status: 403 });
    }

    // ---------- STATIC ADMIN UI ----------
    if (path === "/" && method === "GET") {
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // ---------- INFO PAGES ----------
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---------- TERMS (UI) ----------
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      async function getText(u) { try { const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } }); return r.ok ? await r.text() : ""; } catch { return ""; } }
      const esc = s => s.replace(/[&<>]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[t]));
      const service = esc(await getText(svcUrl) || "");
      const debit = esc(await getText(debUrl) || "");
      let body = "";
      if (kind === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---------- ADMIN: GENERATE ONBOARD LINK ----------
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error: "Missing id" }, 400);
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // ---------- ADMIN: STAFF OTP GEN ----------
    if (path === "/api/staff/gen" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok: true, linkid, code });
    }

    // ---------- OTP SEND (template only) ----------
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return json({ ok: false, error: "Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      // send via approved template with code as body parameter
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: msisdn,
        type: "template",
        template: {
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || "en_US" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] }
          ]
        },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        // do NOT fallback to text; UI already allows staff-code fallback by design
        const t = await r.text().catch(()=> "");
        return json({ ok: false, error: `WhatsApp send failed: ${r.status} ${t}` }, 502);
      }
      return json({ ok: true });
    }

    // ---------- OTP VERIFY ----------
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified: true }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ---------- DEBIT SAVE ----------
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(()=>null);
        if (!form) return {};
        const o = {}; for (const [k,v] of form.entries()) o[k]=v; return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });

      const linkid = url.searchParams.get("linkid") || "";
      if (linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit: { ...record } }), { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }

    // ---------- DEBIT SIGN ----------
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // ---------- AGREEMENT SIGN (MSA) ----------
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok: false, error: "Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed: true, agreement_sig_key: sigKey, status: "pending" }), { expirationTtl: 86400 });
      return json({ ok: true, sigKey });
    }

    // ---------- SAVE PROGRESS ----------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: (request.headers.get("CF-Connecting-IP")||""), last_ua: (request.headers.get("user-agent")||""), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok: true });
    }

    // ---------- ADMIN LIST ----------
    if (path === "/api/admin/list" && method === "GET") {
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // ---------- ADMIN REVIEW PAGE ----------
    if (path === "/admin/review" && method === "GET") {
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${escapeHtml(u.label||'File')}</b> — ${escapeHtml(u.name||'')} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id||'')}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${escapeHtml(k)}</b>: ${v?escapeHtml(String(v)):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---------- ADMIN REJECT ----------
    if (path === "/api/admin/reject" && method === "POST") {
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    // ---------- ADMIN APPROVE (push to Splynx) ----------
    if (path === "/api/admin/approve" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      const id = String(sess.id || "").trim();
      if (!id) return json({ ok:false, error:"Session missing Splynx ID" }, 400);
      const edits = sess.edits || {};

      const pushed = await pushEditsToSplynx(env, id, edits);
      if (!pushed.ok) return json({ ok:false, error:pushed.error || "Push failed" }, 502);

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", approved_at: Date.now(), approved_kind: pushed.kind }), { expirationTtl: 60*60*24*7 });
      return json({ ok:true, kind: pushed.kind });
    }

    // ---------- AGREEMENT ASSET PNGS ----------
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // ---------- AGREEMENT HTML VIEWS (unchanged) ----------
    if (path.startsWith("/agreements/") && method === "GET") {
      // (Handled earlier in your Parts—left intact)
      // If moved, keep the existing implementation from Part 4.
    }

    // ---------- ONBOARD UI ----------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---------- UPLOADS (R2) ----------
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const label = urlParams.get("label") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
      uploads.push({ key, name: fileName, size: body.byteLength, label });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // ---------- SPYLNX PROFILE (for step 3) ----------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // ---------- PDF ROUTES ----------
    const pdfRes = await handlePdfRoutes(path, env);
    if (pdfRes) return pdfRes;

    // ---------- DEFAULT ----------
    return new Response("Not found", { status: 404 });
  }
};
