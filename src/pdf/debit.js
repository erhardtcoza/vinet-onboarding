// src/pdf/debit.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  fetchTextCached,
  getLogoBytes,
  fetchR2Bytes,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";
import { VINET_BLACK, LOGO_URL } from "../constants.js";

async function loadLogo(pdf, env) {
  const bytes = await getLogoBytes(env);
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
  return cursor;
}

function threeColFooter({ page, font, bold, size = 10, y = 60, fullName, dateStr, sigImg, pageWidth }) {
  const colW = pageWidth / 3;
  const centers = [colW / 2, colW + colW / 2, 2 * colW + colW / 2];
  const labels = ["Full name", "Signature", "Date"];
  const values = [fullName || "", sigImg ? "(signed)" : "", dateStr || ""];
  const labelY = y;
  const valueY = y + 16;

  for (let i = 0; i < 3; i++) {
    const label = labels[i];
    const value = values[i];

    const lw = bold.widthOfTextAtSize(label, size);
    page.drawText(label, { x: centers[i] - lw / 2, y: labelY, size, font: bold, color: VINET_BLACK });

    if (i !== 1) {
      const vw = font.widthOfTextAtSize(value, size + 1);
      page.drawText(value, { x: centers[i] - vw / 2, y: valueY, size: size + 1, font, color: VINET_BLACK });
    }
  }

  if (sigImg) {
    const sigWidth = 140;
    const sigHeight = 45;
    page.drawImage(sigImg, { x: centers[1] - sigWidth / 2, y: valueY + 6, width: sigWidth, height: sigHeight });
  }
}

const isSecurityAuditPage = (i) => i === 1;

// Main -------------------------------------------------------------------

export async function renderDebitPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json").catch(() => null);
  if (!sess) return new Response("Unknown session", { status: 404 });

  const id = String(linkid || "").split("_")[0];
  const fullName = (sess?.edits?.account_holder || sess?.edits?.full_name || sess?.full_name || "").trim();
  const email = (sess?.email || "").trim();
  const phone = (sess?.phone || "").trim();
  const generatedPretty = localDateTimePrettyZA(Date.now());

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf, env);

  // Signature for the debit agreement
  let sigImage = null;
  const sigKey = sess?.debit_sig_key || `debit_agreements/${linkid}/signature.png`;
  const sigBytes = await fetchR2Bytes(env, sigKey);
  if (sigBytes) {
    try { sigImage = await pdf.embedPng(sigBytes); } catch { /* ignore */ }
  }

  // Terms (debit specific)
  const termsUrl = env.DEBIT_TERMS_URL || LOGO_URL;
  const termsText = await fetchTextCached(termsUrl, env, "debit_terms");

  // Page 1 ---------------------------------------------------------------
  const page = pdf.addPage([595.28, 841.89]);
  const { width: pw, height: ph } = page.getSize();

  // Logo (match MSA size)
  if (logo) {
    const targetW = 160;
    const scale = targetW / logo.width;
    page.drawImage(logo, { x: 40, y: ph - 80, width: targetW, height: logo.height * scale });
  }

  // Title
  page.drawText("Debit Order Agreement", {
    x: 40, y: ph - 110, size: 18, font: bold, color: VINET_BLACK,
  });

  // Right-hand quick details
  const rx = 320; let ry = ph - 110;
  const row = (label, value) => {
    ry -= 18;
    page.drawText(`${label}:`, { x: rx, y: ry, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(value || "—"), { x: rx + 110, y: ry, size: 10, font, color: VINET_BLACK });
  };
  row("Customer", fullName);
  row("Splynx ID", id);
  row("Generated (date)", generatedPretty);

  // Body terms with paragraph rendering
  drawParagraphs({
    page,
    text: termsText,
    font,
    size: 10,
    x: 40,
    y: ry - 40,
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

  // Page 2 – Security Audit (same treatment as MSA) ----------------------
  const p2 = pdf.addPage([595.28, 841.89]);
  const { width: pw2, height: ph2 } = p2.getSize();

  if (logo) {
    const targetW = 160;
    const scale = targetW / logo.width;
    p2.drawImage(logo, { x: 40, y: ph2 - 80, width: targetW, height: logo.height * scale });
  }

  p2.drawText("Security Audit", {
    x: 40, y: ph2 - 150, size: 16, font: bold, color: VINET_BLACK,
  });

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
  auditRow("Client IP", (sess?.last_ip || sess?.audit_meta?.ip || "—"));
  auditRow("Client agent", (sess?.last_ua || sess?.audit_meta?.ua || "—"));

  // No footer on security page
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf" } });
}
