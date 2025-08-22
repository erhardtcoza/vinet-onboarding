// src/ui/msa.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  embedLogo,
  fetchR2Bytes,
  fetchTextCached,
  getWrappedLinesCached,
  localDateTimePrettyZA,
  localDateZAISO,
  VINET_BLACK,
} from "../helpers.js";
import { LOGO_URL } from "../constants.js";

/**
 * Build the MSA PDF.
 *
 * @param {Env}   env
 * @param {object} ctx
 *  - linkid: string (session id / agreement code)
 *  - profile: { id, full_name, email, phone, street, city, zip, payment_method }
 *  - termsUrl: string (HTML/text source for the MSA terms)  OR
 *  - termsText: string (raw text; if both present, termsText wins)
 *  - verification: "otp" | "staff" (for Security Audit page)
 *  - audit: { ip, asn, asOrganization, city, region, country, ua, at }  // from getClientMeta
 *  - sigKey: R2 key for MSA signature PNG (optional)
 *  - generatedAt: number (ms) optional; defaults now()
 *
 * @returns {Promise<Uint8Array>}
 */
export async function buildMsaPdf(env, ctx) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logo = await embedLogo(pdf, env); // PNG/JPG logo
  const now = typeof ctx.generatedAt === "number" ? ctx.generatedAt : Date.now();
  const genPretty = localDateTimePrettyZA(now);
  const genISO = localDateZAISO(now);

  // Pull signature (optional)
  let sigImg = null;
  if (ctx.sigKey) {
    const sigBytes = await fetchR2Bytes(env, ctx.sigKey);
    if (sigBytes) {
      try { sigImg = await pdf.embedPng(sigBytes); } catch { /* ignore */ }
    }
  }

  // ----- Helpers -----
  const mm = (v) => (v * 72) / 25.4;
  const pageSize = { w: mm(210), h: mm(297) }; // A4
  const margin = mm(18);

  function drawFooter(page) {
    // not used on Security Audit page (we'll skip calling this there)
    const y = mm(18); // footer block top
    const colW = (page.getWidth() - margin * 2) / 3;
    const labelsY = y - mm(6); // label baseline below the value

    // centered value + label per column
    const cols = [
      { label: "Full name", value: ctx.profile?.full_name || "" },
      { label: "Signature", value: "" }, // signature image drawn above label
      { label: "Date", value: genISO },
    ];

    // draw values
    cols.forEach((c, i) => {
      const xLeft = margin + i * colW;
      const centerX = xLeft + colW / 2;

      // Value (name/date) or signature
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

      // Label
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

  function drawHeader(page, title = "Master Service Agreement") {
    // logo same size for MSA and Debit
    let y = page.getHeight() - margin;
    if (logo) {
      const maxW = mm(54); // consistent logo width
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

  // Nicely render paragraphs with spacing
  async function drawParagraphs(page, text, x, y, maxWidth, options = {}) {
    const size = options.size ?? 10.5;
    const lineGap = options.lineGap ?? 2.5; // increased
    const paraGap = options.paraGap ?? 8;   // spacing between paragraphs

    const paragraphs = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n{2,}/); // split on blank lines

    for (const p of paragraphs) {
      const lines = await getWrappedLinesCached(env, p, font, size, maxWidth, "msa-terms");
      for (const ln of lines) {
        page.drawText(ln, { x, y, size, font, color: VINET_BLACK });
        y -= size + lineGap;
        if (y < margin + mm(30)) {
          drawFooter(page);
          page = pdf.addPage([pageSize.w, pageSize.h]);
          drawHeader(page);
          y = page.getHeight() - margin - mm(24);
        }
      }
      y -= paraGap;
      if (y < margin + mm(30)) {
        drawFooter(page);
        page = pdf.addPage([pageSize.w, pageSize.h]);
        drawHeader(page);
        y = page.getHeight() - margin - mm(24);
      }
    }
    return { page, y };
  }

  // -------- Page 1: Client summary --------
  let page = pdf.addPage([pageSize.w, pageSize.h]);
  drawHeader(page);

  const leftX = margin;
  const rightX = page.getWidth() / 2 + mm(6);

  const lh = 11.5;
  let y = page.getHeight() - margin - mm(18);

  const P = ctx.profile || {};
  const kvLeft = [
    ["Client code:", String(P.id || "")],
    ["Full Name:", P.full_name || ""],
    ["ID number:", P.passport || ""], // this now comes from your fetchProfileForDisplay
    ["Email address:", P.email || ""],
    ["Phone:", P.phone || ""],
  ];
  const kvRight = [
    ["Details", ""],
    ["Street:", P.street || ""],
    ["City:", P.city || ""],
    ["Postal code:", P.zip || ""],
    ["Payment method:", (P.payment_method || "").toLowerCase() === "debit" ? "Debit Order" : "Cash / EFT"],
    ["Agreement ID:", ctx.linkid || ""],
    ["Generated (date):", genPretty],
  ];

  function drawKV(list, x, startY) {
    let yy = startY;
    for (const [k, v] of list) {
      if (k === "Details") {
        page.drawText("Details", { x, y: yy, size: 11.5, font: fontB, color: VINET_BLACK });
        yy -= lh;
        continue;
      }
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

  drawKV(kvLeft, leftX, y);
  drawKV(kvRight, rightX, y);

  // Divider title
  y = page.getHeight() - margin - mm(70);
  page.drawText("Master Service Agreement", { x: margin, y, size: 12.5, font: fontB, color: VINET_BLACK });
  y -= mm(4);

  // Terms body
  const termsText =
    (ctx.termsText && String(ctx.termsText)) ||
    (ctx.termsUrl ? await fetchTextCached(ctx.termsUrl, env, "msa-terms") : "");
  const bodyX = margin;
  const bodyYStart = y - mm(4);
  const bodyW = page.getWidth() - margin * 2;

  let res = await drawParagraphs(page, termsText, bodyX, bodyYStart, bodyW, {
    size: 10.5,
    lineGap: 2.5,
    paraGap: 8,
  });
  page = res.page;

  // Final line on the last non-security page
  drawFooter(page);

  // -------- Security Audit page --------
  let sec = pdf.addPage([pageSize.w, pageSize.h]);
  drawHeader(sec, "Security Audit");

  // push heading down ~5 lines
  let sy = sec.getHeight() - margin - mm(18) - 5 * 11;

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
    const wrapped = await getWrappedLinesCached(env, text, font, 10.5, page.getWidth() - margin * 2 - mm(44), "msa-sec");
    let yy = sy;
    for (const ln of wrapped) {
      const tw = font.widthOfTextAtSize(ln, 10.5);
      sec.drawText(ln, { x: margin + mm(44), y: yy, size: 10.5, font, color: VINET_BLACK });
      yy -= 12.5;
    }
    sy = Math.min(yy, sy) - 6;
  }

  // No footer on the security page (per requirement)

  return await pdf.save();
}
