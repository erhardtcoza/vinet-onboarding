// src/pdf/msa.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  embedLogo,
  getWrappedLinesCached,
  localDateTimePrettyZA,
  fetchR2Bytes,
} from "../helpers.js";
import { VINET_BLACK } from "../constants.js";

// ---------- Public wrapper used by routes.js ----------
export async function renderMSAPdf(env, linkid) {
  try {
    const { bytes, filename } = await buildMsaPdf(env, { linkid });
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    return new Response(`MSA PDF error: ${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

// ---------- Builder ----------
export async function buildMsaPdf(env, { linkid }) {
  // Load session (for names, payment, signature, audit)
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json").catch(() => null) || {};
  const idStr = String(linkid || "");
  const splynxId = idStr.split("_")[0] || (sess.splynx_id || "");
  const name =
    (sess.edits && (sess.edits.full_name || sess.edits.name)) ||
    sess.full_name ||
    sess.name ||
    "";

  const paymentMethod = (sess.pay_method || sess.payment_method || "").toLowerCase() === "debit"
    ? "Debit Order"
    : "Cash / EFT";

  const generatedAt = localDateTimePrettyZA(Date.now());
  const r2SigKey = sess.agreement_sig_key || ""; // PNG stored by /api/sign
  const sigBytes = await fetchR2Bytes(env, r2SigKey);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // --- Common metrics
  const MARGIN = 48;
  const PAGE_W = 595.28; // A4 width @72dpi
  const PAGE_H = 841.89; // A4 height
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // --- Header with logo + title
  function drawHeader(page, title) {
    page.drawText(title, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 18,
      size: 18,
      font: fontBold,
      color: rgb(0.89, 0, 0.10),
    });
  }

  // --- Paragraph text block (with blank line = new paragraph)
  async function drawParagraphs(page, text, x, yStart, width, lineSize = 10, lead = 3) {
    const paras = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n\s*\n/) // blank line -> new paragraph
      .map((s) => s.trim())
      .filter(Boolean);

    let y = yStart;
    for (const p of paras) {
      const lines = await getWrappedLinesCached(env, p, font, lineSize, width, "msa-terms");
      for (const ln of lines) {
        page.drawText(ln, { x, y, size: lineSize, font, color: VINET_BLACK });
        y -= lineSize + lead;
      }
      y -= lineSize * 0.6; // paragraph gap
      if (y < 90) { // safety; let caller paginate
        break;
      }
    }
    return y;
  }

  // --- Footer: 3 equal columns, centered, except on Security page
  async function drawFooter(page, isSecurityPage = false) {
    if (isSecurityPage) return;

    const footerY = 58;
    const colW = CONTENT_W / 3;
    const labels = ["Full name", "Signature", "Date"];
    const values = [
      name || "—",
      "(signed)",
      localDateTimePrettyZA(sess.signed_at || sess.updated || Date.now()),
    ];

    // Try to paint signature above its label (centered)
    if (sigBytes) {
      try {
        const sigImg = await pdf.embedPng(sigBytes);
        const sigW = 140, sigH = (sigImg.height / sigImg.width) * sigW;
        const cx = MARGIN + colW * 1 + colW / 2;
        page.drawImage(sigImg, {
          x: cx - sigW / 2,
          y: footerY + 10,
          width: sigW,
          height: sigH,
        });
      } catch {}
    }

    // Labels + values (centered)
    for (let i = 0; i < 3; i++) {
      const left = MARGIN + colW * i;
      const centerX = left + colW / 2;

      // value (slightly above label)
      const val = values[i];
      const valW = font.widthOfTextAtSize(val, 10);
      page.drawText(val, {
        x: centerX - valW / 2,
        y: footerY + 28,
        size: 10,
        font,
        color: VINET_BLACK,
      });

      // label
      const lab = labels[i];
      const labW = fontBold.widthOfTextAtSize(lab, 9.5);
      page.drawText(lab, {
        x: centerX - labW / 2,
        y: footerY + 12,
        size: 9.5,
        font: fontBold,
        color: VINET_BLACK,
      });

      // underline
      page.drawLine({
        start: { x: left + 14, y: footerY + 24 },
        end: { x: left + colW - 14, y: footerY + 24 },
        thickness: 0.8,
        color: VINET_BLACK,
      });
    }
  }

  // --- First page
  const page1 = pdf.addPage([PAGE_W, PAGE_H]);
  drawHeader(page1, "Master Service Agreement");

  // Logo (same size we’ll reuse for Debit)
  try {
    const img = await embedLogo(pdf, env);
    if (img) {
      const W = 140; // make both PDFs consistent
      const H = (img.height / img.width) * W;
      page1.drawImage(img, { x: PAGE_W - MARGIN - W, y: PAGE_H - MARGIN - H, width: W, height: H });
    }
  } catch {}

  // Left column: customer basics
  let y = PAGE_H - MARGIN - 40;
  const L = MARGIN, R = PAGE_W - MARGIN;
  page1.drawText(`Customer: ${name || "—"}`, { x: L, y, size: 12, font, color: VINET_BLACK }); y -= 16;
  page1.drawText(`Splynx ID: ${splynxId || "—"}`, { x: L, y, size: 12, font, color: VINET_BLACK }); y -= 16;

  // Right column: payment + generated date
  const colX = R - 240;
  const payLbl = "Payment method:";
  const genLbl = "Generated (date):";
  page1.drawText(payLbl, { x: colX, y: PAGE_H - MARGIN - 40, size: 11, font: fontBold, color: VINET_BLACK });
  page1.drawText(paymentMethod, { x: colX + 124, y: PAGE_H - MARGIN - 40, size: 11, font, color: VINET_BLACK });
  page1.drawText(genLbl, { x: colX, y: PAGE_H - MARGIN - 56, size: 11, font: fontBold, color: VINET_BLACK });
  page1.drawText(localDateTimePrettyZA(Date.now()), { x: colX + 124, y: PAGE_H - MARGIN - 56, size: 11, font, color: VINET_BLACK });

  // Terms body (paragraph aware)
  const termsService = await env.ONBOARD_KV.get("terms:service", "text").catch(() => "") || "";
  y -= 12;
  const startY = y;
  const drawnY = await drawParagraphs(page1, termsService, L, startY, CONTENT_W, 10.5, 2.5);
  await drawFooter(page1, false);

  // If text overflowed, paginate the rest
  let remainingText = "";
  if (drawnY < 90) {
    const parts = termsService.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    // crude splitter: keep drawing pages until text fits; we’ll put the whole terms on extra page(s)
    let idx = 0;
    let carry = "";
    function paraAt(i){ return i < parts.length ? parts[i] : null; }

    // We already drew the first page; draw subsequent pages with the rest
    while (idx < parts.length) {
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      drawHeader(page, "Master Service Agreement (cont.)");
      let y2 = PAGE_H - MARGIN - 28;
      while (y2 > 100 && idx < parts.length) {
        const p = paraAt(idx);
        const lines = await getWrappedLinesCached(env, p, font, 10.5, CONTENT_W, "msa-terms");
        for (const ln of lines) {
          page.drawText(ln, { x: L, y: y2, size: 10.5, font, color: VINET_BLACK });
          y2 -= 13;
          if (y2 <= 100) break;
        }
        y2 -= 6;
        idx++;
      }
      await drawFooter(page, false);
    }
  }

  // --- Security Audit page
  const sec = pdf.addPage([PAGE_W, PAGE_H]);

  // Drop title ~5 lines lower (≈ line height 12 → 60px)
  const secTitleY = PAGE_H - MARGIN - 40 - 60;
  drawHeader(sec, "Security Audit");

  const audit = sess.audit_meta || {};
  const ip = sess.last_ip || audit.ip || "—";
  const method = (sess.verif_kind || (sess.staff_verified ? "staff" : "wa")) === "staff"
    ? "Vinet Staff Verification"
    : "OTP to mobile";

  let ys = secTitleY - 26;
  const row = (k, v) => {
    sec.drawText(k, { x: L, y: ys, size: 11, font: fontBold, color: VINET_BLACK });
    sec.drawText(String(v || "—"), { x: L + 160, y: ys, size: 11, font, color: VINET_BLACK });
    ys -= 16;
  };
  row("Agreement code", linkid);
  row("Authentication / Verification method", method);
  row("Client IP", ip);
  row("User-Agent", audit.ua || "—");
  row("ASN", audit.asn || "—");
  row("AS Org", audit.asOrganization || "—");
  row("City", audit.city || "—");
  row("Region", audit.region || "—");
  row("Country", audit.country || "—");

  // (No footer on security page)
  const bytes = await pdf.save();
  return { bytes, filename: `msa_${splynxId || "document"}.pdf` };
}
