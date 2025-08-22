// src/pdf/msa.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  fetchTextCached,
  getLogoBytes,
  fetchR2Bytes,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";
import { VINET_BLACK, LOGO_URL } from "../constants.js";

// Utilities --------------------------------------------------------------

async function loadLogo(pdf, env) {
  const bytes = await getLogoBytes(env); // cached by helpers
  if (!bytes) return null;
  try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
}

function drawParagraphs({ page, text, font, size, x, y, width, lineGap = 3, paraGap = 8, color = VINET_BLACK }) {
  const maxWidth = width;
  const wordsWidth = (s) => font.widthOfTextAtSize(s, size);
  const drawLine = (s, yy) => page.drawText(s, { x, y: yy, size, font, color });

  const paras = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/);

  let cursor = y;
  for (const p of paras) {
    const words = p.replace(/\s+/g, " ").trim().split(" ");
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (wordsWidth(next) > maxWidth) {
        drawLine(line, cursor);
        cursor -= size + lineGap;
        line = w;
      } else {
        line = next;
      }
    }
    if (line) { drawLine(line, cursor); cursor -= size + paraGap; }
  }
  return cursor; // final y
}

function threeColFooter({ page, font, bold, size = 10, y = 60, fullName, dateStr, sigImg, pageWidth }) {
  // Skip footer if y is too low
  const colW = pageWidth / 3;
  const centers = [colW / 2, colW + colW / 2, 2 * colW + colW / 2];
  const labels = ["Full name", "Signature", "Date"];
  const values = [fullName || "", sigImg ? "(signed)" : "", dateStr || ""];

  // Baselines
  const labelY = y;
  const valueY = y + 16;

  for (let i = 0; i < 3; i++) {
    const label = labels[i];
    const value = values[i];

    // Centered label
    const lw = bold.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: centers[i] - lw / 2,
      y: labelY,
      size,
      font: bold,
      color: VINET_BLACK,
    });

    // Centered value (name/date)
    if (i !== 1) {
      const vw = font.widthOfTextAtSize(value, size + 1);
      page.drawText(value, {
        x: centers[i] - vw / 2,
        y: valueY,
        size: size + 1,
        font,
        color: VINET_BLACK,
      });
    }
  }

  // Signature image centered in col 2, above the word "(signed)"
  if (sigImg) {
    const sigWidth = 140;
    const sigHeight = 45;
    page.drawImage(sigImg, {
      x: centers[1] - sigWidth / 2,
      y: valueY + 6,
      width: sigWidth,
      height: sigHeight,
    });
  }
}

// Security audit page test
const isSecurityAuditPage = (i) => i === 1; // second page (index 1) in these docs

// Main -------------------------------------------------------------------

export async function renderMSAPdf(env, linkid) {
  // Pull session (to get names, pay method, signature key, auth method, etc.)
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json").catch(() => null);
  if (!sess) return new Response("Unknown session", { status: 404 });

  const id = String(linkid || "").split("_")[0];
  const fullName = (sess?.edits?.full_name || sess?.full_name || sess?.customer?.full_name || "").trim();
  const email = (sess?.edits?.email || sess?.email || sess?.customer?.email || "").trim();
  const phone = (sess?.edits?.phone || sess?.phone || sess?.customer?.phone || "").trim();
  const address = [
    (sess?.edits?.street || sess?.street || sess?.customer?.street || "").trim(),
    (sess?.edits?.city || sess?.city || sess?.customer?.city || "").trim(),
    (sess?.edits?.zip || sess?.zip || sess?.customer?.zip || "").trim(),
  ].filter(Boolean).join(", ");
  const passport = (sess?.edits?.passport || sess?.passport || sess?.customer?.passport || "").trim();

  const payMethod = (sess?.pay_method || sess?.payment_method || "").toLowerCase() === "debit"
    ? "Debit Order"
    : "Cash/EFT";

  const generatedPretty = localDateTimePrettyZA(Date.now());

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf, env);

  // Signature (from KV -> R2)
  let sigImage = null;
  const sigKey = sess?.agreement_sig_key || `agreements/${linkid}/signature.png`;
  const sigBytes = await fetchR2Bytes(env, sigKey);
  if (sigBytes) {
    try { sigImage = await pdf.embedPng(sigBytes); } catch { /* ignore */ }
  }

  // TERMS (cached text source you already had)
  const termsUrl = env.MSA_TERMS_URL || LOGO_URL; // fallback to something if not set
  const termsText = await fetchTextCached(termsUrl, env, "msa_terms");

  // Page 1 ---------------------------------------------------------------
  let page = pdf.addPage([595.28, 841.89]); // A4 Portrait (pt)
  const { width: pw, height: ph } = page.getSize();

  // Logo (same size as before)
  if (logo) {
    const targetW = 160; // match previous feel
    const scale = targetW / logo.width;
    page.drawImage(logo, { x: 40, y: ph - 80, width: targetW, height: logo.height * scale });
  }

  // Title
  page.drawText("Master Service Agreement", {
    x: 40,
    y: ph - 110,
    size: 18,
    font: bold,
    color: VINET_BLACK,
  });

  // Right-hand table (customer details)
  const rx = 320;
  let ry = ph - 110;

  const row = (label, value) => {
    ry -= 18;
    page.drawText(`${label}:`, { x: rx, y: ry, size: 10, font: bold, color: VINET_BLACK });
    const tw = font.widthOfTextAtSize(String(value || ""), 10);
    page.drawText(String(value || ""), { x: rx + 110, y: ry, size: 10, font, color: VINET_BLACK });
  };
  row("Customer", fullName);
  row("Splynx ID", id);
  row("Passport / ID", passport || "—");
  row("Email", email || "—");
  row("Phone", phone || "—");
  row("Address", address || "—");
  row("Payment method", payMethod);
  row("Generated (date)", generatedPretty);

  // Intro (kept like your original – shorter lead-in above terms)
  const intro =
    "Master Service agreement Between VINET Internet Solutions Pty Ltd (VINET) and the subscriber I hereby authorise VINET Internet Solutions Pty Ltd (ISP), hereafter known as VINET, to create and set up my account with the services as I agreed upon with quote received and accepted. I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.";
  drawParagraphs({
    page,
    text: intro,
    font,
    size: 10.5,
    x: 40,
    y: ry - 30,
    width: pw - 80,
    lineGap: 2.5,
    paraGap: 9,
  });

  // Terms block (paragraph aware)
  const termsStartY = ry - 70;
  drawParagraphs({
    page,
    text: termsText,
    font,
    size: 10,
    x: 40,
    y: termsStartY,
    width: pw - 80,
    lineGap: 2.5,
    paraGap: 8,
  });

  // Footer on page 1
  threeColFooter({
    page,
    font,
    bold,
    size: 10,
    y: 70,
    fullName,
    dateStr: localDateZAISO(Date.now()),
    sigImg: sigImage,
    pageWidth: pw,
  });

  // Page 2 – Security Audit page ----------------------------------------
  const p2 = pdf.addPage([595.28, 841.89]);
  const { width: pw2, height: ph2 } = p2.getSize();

  // Logo again (consistent)
  if (logo) {
    const targetW = 160;
    const scale = targetW / logo.width;
    p2.drawImage(logo, { x: 40, y: ph2 - 80, width: targetW, height: logo.height * scale });
  }

  // Move “Security Audit” ~5 lines lower (about 70px)
  p2.drawText("Security Audit", {
    x: 40,
    y: ph2 - 150, // lower than before
    size: 16,
    font: bold,
    color: VINET_BLACK,
  });

  // Extra rows above Client IP
  let ay = ph2 - 180;
  const auditRow = (label, value) => {
    ay -= 18;
    p2.drawText(`${label}:`, { x: 40, y: ay, size: 10, font: bold, color: VINET_BLACK });
    p2.drawText(String(value || "—"), { x: 180, y: ay, size: 10, font, color: VINET_BLACK });
  };

  const authMethod = (sess?.otp_kind === "staff")
    ? "Vinet Staff Verification"
    : "OTP to mobile";

  auditRow("Agreement code", linkid);
  auditRow("Authentication / Verification method", authMethod);

  // Continue with your existing audit info
  const clientIp = (sess?.last_ip || sess?.audit_meta?.ip || "—");
  const clientUa = (sess?.last_ua || sess?.audit_meta?.ua || "—");
  auditRow("Client IP", clientIp);
  auditRow("Client agent", clientUa);

  // NOTE: No footer on security page
  // (as requested – footer appears on all other pages only)

  // Finish
  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: { "content-type": "application/pdf" },
  });
}
