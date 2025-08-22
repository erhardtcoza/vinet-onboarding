// src/ui/debit.js
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  embedLogo,
  fetchR2Bytes,
  getWrappedLinesCached,
  localDateTimePrettyZA,
  localDateZAISO,
  VINET_BLACK,
} from "../helpers.js";

/**
 * Build the Debit Order PDF.
 *
 * @param {Env} env
 * @param {object} ctx
 *  - linkid: string
 *  - profile: { id, full_name, email, phone, street, city, zip, payment_method }
 *  - debit: { account_holder, id_number, bank_name, account_number, account_type, debit_day }
 *  - verification: "otp" | "staff"
 *  - audit: same shape as MSA
 *  - sigKey: R2 key for DEBIT signature PNG (optional)
 *  - generatedAt: number
 *  - termsText: string (Debit T&Cs body, optional)
 *
 * @returns {Promise<Uint8Array>}
 */
export async function buildDebitPdf(env, ctx) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logo = await embedLogo(pdf, env);
  const now = typeof ctx.generatedAt === "number" ? ctx.generatedAt : Date.now();
  const genPretty = localDateTimePrettyZA(now);
  const genISO = localDateZAISO(now);

  let sigImg = null;
  if (ctx.sigKey) {
    const sigBytes = await fetchR2Bytes(env, ctx.sigKey);
    if (sigBytes) {
      try { sigImg = await pdf.embedPng(sigBytes); } catch {}
    }
  }

  const mm = (v) => (v * 72) / 25.4;
  const pageSize = { w: mm(210), h: mm(297) };
  const margin = mm(18);

  function drawFooter(page) {
    const y = mm(18);
    const colW = (page.getWidth() - margin * 2) / 3;
    const labelsY = y - mm(6);

    const cols = [
      { label: "Full name", value: ctx.profile?.full_name || "" },
      { label: "Signature", value: "" },
      { label: "Date", value: genISO },
    ];
    cols.forEach((c, i) => {
      const xLeft = margin + i * colW;
      const centerX = xLeft + colW / 2;

      if (i === 1 && sigImg) {
        const sigMaxW = colW * 0.7;
        const sigMaxH = mm(18);
        const { width, height } = sigImg.scale(1);
        const scale = Math.min(sigMaxW / width, sigMaxH / height);
        const w = width * scale;
        const h = height * scale;
        page.drawImage(sigImg, {
          x: centerX - w / 2,
          y: y + mm(3),
          width: w,
          height: h,
        });
      } else {
        const text = i === 2 ? ctx.profile?.signedDate || genPretty : c.value;
        const tw = fontB.widthOfTextAtSize(text, 9);
        page.drawText(text, {
          x: centerX - tw / 2,
          y: y + mm(8),
          size: 9,
          font: fontB,
          color: VINET_BLACK,
        });
      }

      const lw = font.widthOfTextAtSize(c.label, 9);
      page.drawText(c.label, {
        x: centerX - lw / 2,
        y: labelsY,
        size: 9,
        font,
        color: VINET_BLACK,
      });
    });
  }

  function drawHeader(page, title = "Debit Order Agreement") {
    let y = page.getHeight() - margin;
    if (logo) {
      const maxW = mm(54); // match MSA logo width
      const scale = Math.min(maxW / logo.width, 1);
      page.drawImage(logo, {
        x: margin,
        y: y - logo.height * scale,
        width: logo.width * scale,
        height: logo.height * scale,
      });
      y -= logo.height * scale + mm(4);
    }
    page.drawText(title, { x: margin, y: y, size: 14, font: fontB, color: VINET_BLACK });
    page.drawText("www.vinet.co.za  |  021 007 0200", {
      x: page.getWidth() - margin - font.widthOfTextAtSize("www.vinet.co.za  |  021 007 0200", 9),
      y,
      size: 9,
      font,
      color: VINET_BLACK,
    });
  }

  // PAGE 1: Summary + Debit details
  let page = pdf.addPage([pageSize.w, pageSize.h]);
  drawHeader(page);

  const leftX = margin;
  const rightX = page.getWidth() / 2 + mm(6);
  const lh = 11.5;
  let y = page.getHeight() - margin - mm(18);

  const P = ctx.profile || {};
  const D = ctx.debit || {};

  function drawKV(list, x, startY) {
    let yy = startY;
    for (const [k, v] of list) {
      page.drawText(k, { x, y: yy, size: 10.5, font: fontB, color: VINET_BLACK });
      page.drawText(String(v), {
        x: x + mm(40),
        y: yy,
        size: 10.5,
        font,
        color: VINET_BLACK,
      });
      yy -= lh;
    }
    return yy;
  }

  const kvLeft = [
    ["Client code:", String(P.id || "")],
    ["Full Name:", P.full_name || ""],
    ["ID number:", P.passport || ""],
    ["Email address:", P.email || ""],
    ["Phone:", P.phone || ""],
  ];
  const kvRight = [
    ["Street:", P.street || ""],
    ["City:", P.city || ""],
    ["Postal code:", P.zip || ""],
    ["Agreement ID:", ctx.linkid || ""],
    ["Generated (date):", genPretty],
  ];
  drawKV(kvLeft, leftX, y);
  drawKV(kvRight, rightX, y);

  y = page.getHeight() - margin - mm(70);
  page.drawText("Debit Order Details", { x: margin, y, size: 12.5, font: fontB, color: VINET_BLACK });
  y -= mm(6);

  const kvDebit = [
    ["Account Holder", D.account_holder || ""],
    ["ID Number", D.id_number || ""],
    ["Bank", D.bank_name || ""],
    ["Account Number", D.account_number || ""],
    ["Account Type", (D.account_type || "").toUpperCase()],
    ["Debit Day", String(D.debit_day || "")],
  ];
  drawKV(kvDebit, margin, y);

  drawFooter(page);

  // PAGE 2: Terms (optional) + Security Audit (like MSA)
  // Terms page (render if provided)
  if (ctx.termsText) {
    page = pdf.addPage([pageSize.w, pageSize.h]);
    drawHeader(page, "Debit Order Terms");
    let by = page.getHeight() - margin - mm(18) - mm(6);
    const lines = (ctx.termsText || "").split(/\n{2,}/);
    for (const p of lines) {
      const wrapped = await getWrappedLinesCached(env, p, font, 10.5, page.getWidth() - margin * 2, "debit-terms");
      for (const ln of wrapped) {
        page.drawText(ln, { x: margin, y: by, size: 10.5, font, color: VINET_BLACK });
        by -= 13;
        if (by < margin + mm(30)) {
          drawFooter(page);
          page = pdf.addPage([pageSize.w, pageSize.h]);
          drawHeader(page, "Debit Order Terms");
          by = page.getHeight() - margin - mm(18);
        }
      }
      by -= 8;
      if (by < margin + mm(30)) {
        drawFooter(page);
        page = pdf.addPage([pageSize.w, pageSize.h]);
        drawHeader(page, "Debit Order Terms");
        by = page.getHeight() - margin - mm(18);
      }
    }
    drawFooter(page);
  }

  // Security page
  let sec = pdf.addPage([pageSize.w, pageSize.h]);
  drawHeader(sec, "Security Audit");

  let sy = sec.getHeight() - margin - mm(18) - 5 * 11; // push down by ~5 lines
  const audit = ctx.audit || {};
  const verify =
    ctx.verification === "staff"
      ? "Vinet Staff Verification"
      : "WhatsApp OTP";

  const secKV = [
    ["Generated (Africa/Johannesburg):", genPretty],
    ["Agreement code:", ctx.linkid || ""],
    ["Authentication / Verification method:", verify],
    [
      "Client IP:",
      `${audit.ip || "—"}  •  ASN: ${audit.asn || "—"}  •  Org: ${audit.asOrganization || "—"}`,
    ],
    [
      "Approx Location:",
      [audit.city, audit.region, audit.country].filter(Boolean).join(", ") || "—",
    ],
    ["Device:", audit.ua || "—"],
  ];

  for (const [k, v] of secKV) {
    sec.drawText(k, { x: margin, y: sy, size: 10.5, font: fontB, color: VINET_BLACK });
    const text = String(v);
    const wrapped = await getWrappedLinesCached(env, text, font, 10.5, sec.getWidth() - margin * 2 - mm(44), "debit-sec");
    let yy = sy;
    for (const ln of wrapped) {
      sec.drawText(ln, { x: margin + mm(44), y: yy, size: 10.5, font, color: VINET_BLACK });
      yy -= 12.5;
    }
    sy = Math.min(yy, sy) - 6;
  }
  // no footer here

  return await pdf.save();
}
