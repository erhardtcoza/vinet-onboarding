// src/pdf/debit.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  embedLogo,
  getWrappedLinesCached,
  localDateTimePrettyZA,
  fetchR2Bytes,
} from "../helpers.js";
import { VINET_BLACK } from "../constants.js";

// ---------- Public wrapper used by routes.js ----------
export async function renderDebitPdf(env, linkid) {
  try {
    const { bytes, filename } = await buildDebitPdf(env, { linkid });
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    return new Response(`Debit PDF error: ${msg}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

// ---------- Builder ----------
export async function buildDebitPdf(env, { linkid }) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json").catch(() => null) || {};
  const idStr = String(linkid || "");
  const splynxId = idStr.split("_")[0] || (sess.splynx_id || "");
  const name =
    (sess.edits && (sess.edits.full_name || sess.edits.name)) ||
    sess.full_name ||
    sess.name ||
    "";

  const generatedAt = localDateTimePrettyZA(Date.now());
  const r2SigKey = sess.debit_sig_key || ""; // PNG stored by /api/debit/sign
  const sigBytes = await fetchR2Bytes(env, r2SigKey);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const MARGIN = 48;
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  function drawHeader(page, title) {
    page.drawText(title, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 18,
      size: 18,
      font: fontBold,
      color: rgb(0.89, 0, 0.10),
    });
  }

  async function drawFooter(page, isSecurityPage = false) {
    if (isSecurityPage) return;

    const footerY = 58;
    const colW = CONTENT_W / 3;
    const labels = ["Full name", "Signature", "Date"];
    const values = [
      name || "—",
      "(signed)",
      localDateTimePrettyZA(sess.debit_signed_at || sess.updated || Date.now()),
    ];

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

    for (let i = 0; i < 3; i++) {
      const left = MARGIN + colW * i;
      const centerX = left + colW / 2;

      const val = values[i];
      const valW = font.widthOfTextAtSize(val, 10);
      page.drawText(val, {
        x: centerX - valW / 2,
        y: footerY + 28,
        size: 10,
        font,
        color: VINET_BLACK,
      });

      const lab = labels[i];
      const labW = fontBold.widthOfTextAtSize(lab, 9.5);
      page.drawText(lab, {
        x: centerX - labW / 2,
        y: footerY + 12,
        size: 9.5,
        font: fontBold,
        color: VINET_BLACK,
      });

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
  drawHeader(page1, "Debit Order Agreement");

  // Logo (use the same size as MSA for consistency)
  try {
    const img = await embedLogo(pdf, env);
    if (img) {
      const W = 140;
      const H = (img.height / img.width) * W;
      page1.drawImage(img, { x: PAGE_W - MARGIN - W, y: PAGE_H - MARGIN - H, width: W, height: H });
    }
  } catch {}

  // Summary
  let y = PAGE_H - MARGIN - 40;
  const L = MARGIN;
  page1.drawText(`Customer: ${name || "—"}`, { x: L, y, size: 12, font, color: VINET_BLACK }); y -= 16;
  page1.drawText(`Splynx ID: ${splynxId || "—"}`, { x: L, y, size: 12, font, color: VINET_BLACK }); y -= 16;
  page1.drawText(`Generated (date): ${generatedAt}`, { x: L, y, size: 12, font, color: VINET_BLACK }); y -= 18;

  // Terms (paragraph aware) – reusing the "debit" terms content you serve
  const termsDebit = await env.ONBOARD_KV.get("terms:debit", "text").catch(() => "") || "";
  const paras = termsDebit.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  for (const p of paras) {
    const lines = await getWrappedLinesCached(env, p, font, 10.5, CONTENT_W, "debit-terms");
    for (const ln of lines) {
      page1.drawText(ln, { x: L, y, size: 10.5, font, color: VINET_BLACK });
      y -= 13;
      if (y < 100) break;
    }
    y -= 6;
    if (y < 100) break;
  }
  await drawFooter(page1, false);

  // If there’s more text, add continuation pages
  if (y < 100 && paras.length > 0) {
    let idx = 0;
    // Rough continuation (draw remaining paragraphs on more pages)
    while (idx < paras.length) {
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      drawHeader(page, "Debit Order Agreement (cont.)");
      let y2 = PAGE_H - MARGIN - 28;
      while (y2 > 100 && idx < paras.length) {
        const p = paras[idx++];
        const lines = await getWrappedLinesCached(env, p, font, 10.5, CONTENT_W, "debit-terms");
        for (const ln of lines) {
          page.drawText(ln, { x: L, y: y2, size: 10.5, font, color: VINET_BLACK });
          y2 -= 13;
          if (y2 <= 100) break;
        }
        y2 -= 6;
      }
      await drawFooter(page, false);
    }
  }

  // --- Security Audit page (same treatment)
  const sec = pdf.addPage([PAGE_W, PAGE_H]);
  const secTitleY = PAGE_H - MARGIN - 40 - 60; // push down ~5 lines
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
  // no footer on security page

  const bytes = await pdf.save();
  return { bytes, filename: `debit_${splynxId || "document"}.pdf` };
}
