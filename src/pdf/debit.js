// src/pdf/debit.js
//
// Build the Debit Order PDF mirroring the MSA styling:
// - Same logo size
// - 3‑column footer on all pages except Security Audit
// - Security page with Agreement code + Auth method
//
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const mm = (v) => v * 2.834645669;

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

async function drawHeader({ page, logoPng, title, fontBold, red }) {
  const top = page.getHeight() - mm(20);
  const LOGO_W = mm(42);
  const LOGO_H = mm(16);
  if (logoPng) {
    page.drawImage(logoPng, {
      x: mm(20),
      y: top - LOGO_H,
      width: LOGO_W,
      height: LOGO_H
    });
  }
  page.drawText(title, { x: mm(20), y: top - LOGO_H - mm(6), size: 16, font: fontBold, color: red });
  page.drawLine({
    start: { x: mm(20), y: top - LOGO_H - mm(9) },
    end: { x: page.getWidth() - mm(20), y: top - LOGO_H - mm(9) },
    thickness: 1,
    color: red
  });
}

function drawFooter({ page, font, fontBold, name, dateStr, sigImg, red }) {
  const y = mm(14);
  const left = mm(20);
  const right = page.getWidth() - mm(20);
  const w = right - left;
  const colW = w / 3;

  const drawCol = (i, label, value, img) => {
    const cx = left + i * colW + colW / 2;
    if (img) {
      const IH = mm(12), IW = mm(36);
      page.drawImage(img, { x: cx - IW/2, y, width: IW, height: IH });
    } else {
      const t = String(value ?? "");
      const wt = font.widthOfTextAtSize(t, 10);
      page.drawText(t, { x: cx - wt/2, y: y + mm(10), size: 10, font, color: rgb(0,0,0) });
    }
    const wl = fontBold.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: cx - wl/2, y, size: 10, font: fontBold, color: red });
  };

  drawCol(0, "Full name", name || "");
  drawCol(1, "Signature", "", sigImg || null);
  drawCol(2, "Date", dateStr || "");
}

function drawKeyVals({ page, font, fontBold, x, y, rows }) {
  let cy = y;
  for (const [k, v] of rows) {
    page.drawText(String(k), { x, y: cy, size: 10, font: fontBold, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(v ?? "—"), { x: x + mm(48), y: cy, size: 10, font, color: rgb(0.15,0.15,0.15) });
    cy -= mm(6);
  }
  return cy;
}

/**
 * Build the Debit Order PDF.
 *
 * @param {object} data
 * {
 *   logoBytes?: Uint8Array,
 *   signatureBytes?: Uint8Array,
 *   client: { code, full_name, passport, email, phone, street, city, zip },
 *   debit: { account_holder, id_number, bank_name, account_number, account_type, debit_day },
 *   agreementId: string,
 *   generatedAt?: Date|number|string,
 *   authMethod?: "otp"|"staff",
 *   audit?: { ip, asn, org, approx, ua },
 * }
 */
export async function buildDebitPdf(data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.886, 0, 0.102);
  const gray = rgb(0.15, 0.15, 0.15);
  const logoPng = data.logoBytes ? await doc.embedPng(data.logoBytes) : null;
  const sigImg = data.signatureBytes ? await doc.embedPng(data.signatureBytes) : null;

  const addPage = () => doc.addPage([mm(210), mm(297)]);
  const page = addPage();
  await drawHeader({ page, logoPng, title: "Vinet Debit Order Instruction", fontBold, red });

  // Two columns: Client Details & Debit Order Details
  const startY = page.getHeight() - mm(40);
  const leftX = mm(20);
  const rightX = page.getWidth() / 2 + mm(5);

  page.drawText("Client Details", { x: leftX, y: startY, size: 11, font: fontBold, color: red });
  let cyL = drawKeyVals({
    page, font, fontBold, x: leftX, y: startY - mm(8),
    rows: [
      ["Client code:", data?.client?.code],
      ["Full Name:", data?.client?.full_name],
      ["ID / Passport:", data?.client?.passport],
      ["Email:", data?.client?.email],
      ["Phone:", data?.client?.phone],
      ["Street:", data?.client?.street],
      ["City:", data?.client?.city],
      ["ZIP:", data?.client?.zip],
    ]
  });

  page.drawText("Debit Order Details", { x: rightX, y: startY, size: 11, font: fontBold, color: red });
  let cyR = drawKeyVals({
    page, font, fontBold, x: rightX, y: startY - mm(8),
    rows: [
      ["Account Holder Name:", data?.debit?.account_holder],
      ["Account Holder ID:", data?.debit?.id_number],
      ["Bank:", data?.debit?.bank_name],
      ["Bank Account No:", data?.debit?.account_number],
      ["Account Type:", data?.debit?.account_type],
      ["Debit Order Date:", data?.debit?.debit_day],
    ]
  });

  const bodyTop = Math.min(cyL, cyR) - mm(6);
  const marginX = mm(20);

  // Body blurb (existing debit mandate)
  const body = String(
    data?.bodyText ??
    "Debit Order Instruction Form This signed Authority and Mandate refers to our contract as dated as on signature hereof (the Agreement). " +
    "I / We hereby authorise you to issue and deliver payment instructions to the bank for collection against my/our above-mentioned account at my/our above-mentioned bank " +
    "(or any other bank or branch to which. I/We may transfer my/our account) on condition that the sum of such payment instructions will never exceed my/our obligations as agreed to in the Agreement, " +
    "and commencing on the commencement date and continuing until this Authority and Mandate is terminated by me/us by giving you notice in writing of and no less than 20 ordinary working days, " +
    "and sent by prepaid registered post or delivered to your address indicated above. " +
    "…"
  );

  const lineH = 11.5;
  const usableW = page.getWidth() - marginX * 2;
  let y = bodyTop;
  const words = body.split(/\s+/);
  let line = "";
  const measure = (s) => font.widthOfTextAtSize(s, 10);

  const drawFooterNow = () => drawFooter({
    page, font, fontBold, name: data?.client?.full_name || "",
    dateStr: fmtJohannesburg(data.generatedAt || Date.now()),
    sigImg, red
  });

  for (const w of words) {
    const test = (line ? line + " " : "") + w;
    if (measure(test) > usableW) {
      page.drawText(line, { x: marginX, y: y - lineH, size: 10, font, color: gray });
      y -= lineH;
      if (y < mm(28)) {
        drawFooterNow();
        const np = addPage();
        await drawHeader({ page: np, logoPng, title: "Vinet Debit Order Instruction", fontBold, red });
        y = np.getHeight() - mm(40);
        line = w;
        // switch context to new page
        page = np; // eslint-disable-line no-func-assign
        continue;
      }
      line = w;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x: marginX, y: y - lineH, size: 10, font, color: gray });

  // Footer on final content page
  drawFooterNow();

  // SECURITY PAGE
  const sec = addPage();
  await drawHeader({ page: sec, logoPng, title: "Security Audit", fontBold, red });

  let ys = sec.getHeight() - mm(40) - mm(10); // push down a bit
  const label = (k, v) => {
    sec.drawText(k, { x: marginX, y: ys, size: 10, font: fontBold, color: red });
    ys -= mm(6);
    sec.drawText(String(v ?? "—"), { x: marginX, y: ys, size: 10, font, color: gray });
    ys -= mm(8);
  };
  const genDate = fmtJohannesburg(data.generatedAt || Date.now());
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

  // No footer on security page

  return await doc.save();
}