// src/pdf/msa.js
//
// Build the Master Service Agreement PDF with paragraph-aware terms,
// repeated 3‑column footer (except on Security Audit page), and
// first-page extras (Payment method, Generated date).
//
// Requires: pdf-lib ^1.17.1
//
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Small helpers */
const mm = (v) => v * 2.834645669; // mm -> pt
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function fmtJohannesburg(dt) {
  try {
    return new Date(dt).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).replace(",", "");
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Paragraph-aware text layout with automatic paging.
 * Splits on blank lines to make paragraphs, keeps an extra gap between paragraphs,
 * and uses slightly looser line height for readability.
 */
function layoutParagraphs({
  doc, page, font, size, color = rgb(0, 0, 0),
  x, y, w, h, text, lineGap = 0.25, // extra line spacing
  addPage, drawFooter,
}) {
  const lineHeight = size * (1.2 + clamp(lineGap, 0, 1)); // slightly more generous
  const paragraphGap = lineHeight * 0.6;

  const wordsWidth = (s) => font.widthOfTextAtSize(s, size);
  const spaceW = wordsWidth(" ");

  let cursorY = y;
  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g);

  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    let line = "";
    let firstWordInLine = true;

    const flushLine = () => {
      if (!line) return;
      if (cursorY - lineHeight < h) {
        // New page
        drawFooter?.(page); // close current page
        page = addPage();
        cursorY = page.getHeight() - mm(30); // fresh top margin
      }
      page.drawText(line, { x, y: cursorY - lineHeight, size, font, color, maxWidth: w });
      cursorY -= lineHeight;
      line = "";
      firstWordInLine = true;
    };

    for (const word of words) {
      const test = firstWordInLine ? word : line + " " + word;
      const width = wordsWidth(test);
      if (width > w && !firstWordInLine) {
        flushLine();
        line = word;
        firstWordInLine = false;
      } else {
        line = test;
        firstWordInLine = false;
      }
    }
    flushLine();
    cursorY -= paragraphGap;
  }

  return { page, y: cursorY };
}

/** Header with logo + title */
async function drawHeader({ page, logoPng, title, font, fontBold, red }) {
  const pw = page.getWidth();
  const top = page.getHeight() - mm(20);

  // Logo (consistent size for MSA & Debit)
  const LOGO_W = mm(42); // ~ same across docs
  const LOGO_H = mm(16);
  if (logoPng) {
    page.drawImage(logoPng, {
      x: mm(20),
      y: top - LOGO_H,
      width: LOGO_W,
      height: LOGO_H,
    });
  }

  page.drawText(title, {
    x: mm(20),
    y: top - LOGO_H - mm(6),
    size: 16,
    font: fontBold,
    color: red,
  });

  // red hairline
  page.drawLine({
    start: { x: mm(20), y: top - LOGO_H - mm(9) },
    end: { x: pw - mm(20), y: top - LOGO_H - mm(9) },
    thickness: 1,
    color: red,
  });
}

/** Two-column key/value block */
function drawKeyVals({ page, font, fontBold, x, y, colGap, colW, rows }) {
  let cy = y;
  const keyCol = x;
  const valCol = x + colW + colGap;
  for (const [k, v] of rows) {
    page.drawText(String(k), { x: keyCol, y: cy, size: 10, font: fontBold, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(v ?? ""), { x: valCol, y: cy, size: 10, font, color: rgb(0.15,0.15,0.15) });
    cy -= mm(6);
  }
  return cy;
}

/** 3-column centered footer used on all pages except the Security Audit page */
function drawFooter({ page, font, fontBold, name, dateStr, sigImg, red }) {
  const ph = page.getHeight();
  const y = mm(14);
  const left = mm(20);
  const right = page.getWidth() - mm(20);
  const w = right - left;
  const colW = w / 3;

  const drawCol = (colIdx, label, value, img) => {
    const cx = left + colIdx * colW + colW / 2;
    // Value (e.g., name/signature/date) above label, centered
    if (img) {
      const IH = mm(12); const IW = mm(36);
      page.drawImage(img, { x: cx - IW/2, y: y + mm(8), width: IW, height: IH });
    } else {
      const text = String(value ?? "");
      const wv = font.widthOfTextAtSize(text, 10);
      page.drawText(text, { x: cx - wv/2, y: y + mm(10), size: 10, font, color: rgb(0,0,0) });
    }
    const wl = fontBold.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: cx - wl/2, y: y, size: 10, font: fontBold, color: red });
  };

  drawCol(0, "Full name", name || "");
  drawCol(1, "Signature", "", sigImg || null);
  drawCol(2, "Date", dateStr || "");
}

/**
 * Build the MSA PDF.
 *
 * @param {object} data
 * {
 *   logoBytes?: Uint8Array,
 *   signatureBytes?: Uint8Array,           // customer's drawn signature (PNG)
 *   termsText: string,                      // the big MSA text (paragraphs by blank lines)
 *   client: {
 *     code, full_name, passport, email, phone,
 *     street, city, zip, payment_method   // "eft" | "debit" | "cash" etc.
 *   },
 *   agreementId: string,                   // onboarding session id
 *   generatedAt?: string|number|Date,      // if omitted, uses Date.now()
 *   authMethod?: "otp" | "staff",          // for security page
 *   audit?: { ip, asn, org, approx, ua },  // security page
 * }
 * @returns Uint8Array
 */
export async function buildMSAPdf(data) {
  const doc = await PDFDocument.create();

  // Embeds & colors
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.886, 0, 0.102);
  const gray = rgb(0.15, 0.15, 0.15);

  const logoPng = data.logoBytes ? await doc.embedPng(data.logoBytes) : null;
  const sigImg = data.signatureBytes ? await doc.embedPng(data.signatureBytes) : null;

  // Page factory
  const addPage = () => doc.addPage([mm(210), mm(297)]); // A4 portrait
  let page = addPage();

  await drawHeader({ page, logoPng, title: "Master Service Agreement", font, fontBold, red });

  // First-page client details — two columns
  const topStart = page.getHeight() - mm(40);
  const x = mm(20);
  const colGap = mm(12);
  const colW = (page.getWidth() - mm(40) - colGap) / 2;

  const payMethodFriendly = (() => {
    const m = String(data?.client?.payment_method || "").toLowerCase();
    if (m.startsWith("debit")) return "Debit Order";
    if (m === "cash" || m === "eft" || m.includes("eft")) return "Cash/EFT";
    return m || "—";
  })();

  const genDate = fmtJohannesburg(data.generatedAt || Date.now());

  let cyLeft = drawKeyVals({
    page, font, fontBold, x, y: topStart, colGap, colW,
    rows: [
      ["Client code:", data?.client?.code ?? "—"],
      ["Full Name:", data?.client?.full_name ?? "—"],
      ["ID number:", data?.client?.passport ?? "—"],
      ["Email address:", data?.client?.email ?? "—"],
      ["Phone:", data?.client?.phone ?? "—"],
    ]
  });

  let cyRight = drawKeyVals({
    page, font, fontBold, x: x + colW + colGap, y: topStart, colGap, colW,
    rows: [
      ["Street:", data?.client?.street ?? "—"],
      ["City:", data?.client?.city ?? "—"],
      ["Postal code:", data?.client?.zip ?? "—"],
      ["Payment method:", payMethodFriendly],
      ["Agreement ID:", data?.agreementId ?? "—"],
      ["Generated (date):", genDate],
    ]
  });

  // Terms – paragraph aware
  const textTop = Math.min(cyLeft, cyRight) - mm(6);
  const marginX = mm(20);
  const usableW = page.getWidth() - marginX * 2;
  const bottomMargin = mm(28);

  const drawFooterIfNeeded = (p) => drawFooter({
    page: p, font, fontBold, name: data?.client?.full_name || "",
    dateStr: genDate, sigImg, red
  });

  const flowed = layoutParagraphs({
    doc,
    page,
    font,
    size: 9.5,
    color: gray,
    x: marginX,
    y: textTop,
    w: usableW,
    h: bottomMargin,
    text: data.termsText || "",
    lineGap: 0.25,
    addPage: () => {
      const np = addPage();
      // header on continuation pages
      drawHeader({ page: np, logoPng, title: "Master Service Agreement (continued)", font, fontBold, red });
      return np;
    },
    drawFooter: drawFooterIfNeeded
  });

  // Footer on the last terms page
  drawFooterIfNeeded(flowed.page);

  // SECURITY AUDIT PAGE
  const sec = addPage();
  await drawHeader({ page: sec, logoPng, title: "Security Audit", font, fontBold, red });

  // push the heading down “about 5 lines”
  let ySec = sec.getHeight() - mm(40) - mm(10);

  const label = (k, v) => {
    sec.drawText(k, { x: marginX, y: ySec, size: 10, font: fontBold, color: red });
    ySec -= mm(6);
    sec.drawText(String(v ?? "—"), { x: marginX, y: ySec, size: 10, font, color: gray });
    ySec -= mm(8);
  };

  label("Generated (Africa/Johannesburg):", genDate);
  label("Agreement code:", data?.agreementId ?? "—");
  label("Authentication / Verification method:",
    (data?.authMethod === "staff" ? "Vinet Staff Verification"
      : data?.authMethod === "otp" ? "OTP to mobile" : "—"));

  label("Client IP:", data?.audit?.ip ?? "—");
  label("ASN:", data?.audit?.asn ?? "—");
  label("Org:", data?.audit?.org ?? "—");
  label("Approx Location:", data?.audit?.approx ?? "—");
  label("Device:", data?.audit?.ua ?? "—");

  // NOTE: NO footer on the security page

  return await doc.save();
}