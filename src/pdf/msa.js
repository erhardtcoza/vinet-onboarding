import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_MSA_TERMS_URL,
  HEADER_PHONE_DEFAULT,
  HEADER_WEBSITE_DEFAULT,
  PDF_CACHE_TTL,
  PDF_FONTS,           // { body: TimesRoman, bold: TimesRomanBold }
  VINET_BLACK,
  VINET_RED,
} from "../constants.js";

import {
  drawDashedLine,
  embedLogo,
  fetchR2Bytes,
  fetchTextCached,
  getWrappedLinesCached, // cache key aware wrapper
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";

/**
 * Render the Vinet Master Service Agreement (PDF)
 * - Page 1: header + Client Details (L) / Agreement Details (R), then 2‑column terms
 * - Page N: "(continued)" header + 2‑column terms
 * - Final page: Client Details strip + signature block (Full Name / Signature / Date)
 */
export async function renderMSAPdf(env, linkid, reqMeta = {}) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  // Session + prerequisites
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_sig_key || !sess.agreement_signed) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const idOnly = String(linkid).split("_")[0];
  const edits = sess.edits || {};
  const termsSrc = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const terms = (await fetchTextCached(termsSrc, env, "terms:msa")) || "Terms unavailable.";

  // PDF setup
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body);
  const bold = await pdf.embedFont(PDF_FONTS.bold);

  // Page metrics
  const W = 595, H = 842, M = 40; // A4 portrait
  const lineH = 11.8;
  const paraGap = 3;

  // Common header
  const logoImg = await embedLogo(pdf, env);
  const header = (page, { continued = false } = {}) => {
    let y = H - 40;

    // Logo (25% larger than the old 42px target)
    if (logoImg) {
      const targetH = 52.5; // 42 * 1.25
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      page.drawImage(logoImg, { x: W - M - lw, y: y - targetH, width: lw, height: targetH });
    }

    page.drawText(
      continued ? "Master Service Agreement (continued)" : "Master Service Agreement",
      { x: M, y: y - 8, size: 18, font: bold, color: VINET_RED }
    );
    y -= 30;

    page.drawText(
      `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`,
      { x: M, y, size: 10, font, color: VINET_BLACK }
    );

    // Slightly lower dashed line for balance
    y -= 18;
    drawDashedLine(page, M, y, W - M);
    return y - 18; // content start Y
  };

  // Client + Agreement blocks (top of page 1)
  const drawClientAgreementTop = (page, yStart) => {
    const colW = (W - M * 2) / 2;
    let yL = yStart;
    let yR = yStart;

    // Sub‑headings
    page.drawText("Client Details", { x: M, y: yL, size: 12, font: bold, color: VINET_RED });
    page.drawText("Agreement Details", { x: M + colW + 12, y: yR, size: 12, font: bold, color: VINET_RED });
    yL -= 16;
    yR -= 16;

    // Left (client)
    const rowL = (k, v) => {
      page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
      page.drawText(String(v || ""), { x: M + 120, y: yL, size: 10, font, color: VINET_BLACK });
      yL -= 14;
    };
    rowL("Client code:", idOnly);
    rowL("Full Name:", edits.full_name);
    rowL("ID / Passport:", edits.passport);
    rowL("Email:", edits.email);
    rowL("Phone:", edits.phone);

    // Right (agreement info)
    const xR = M + colW + 12;
    const rowR = (k, v) => {
      page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
      page.drawText(String(v || ""), { x: xR + 120, y: yR, size: 10, font, color: VINET_BLACK });
      yR -= 14;
    };
    rowR("Agreement ID:", linkid);
    rowR("Generated (ZA):", localDateTimePrettyZA());
    rowR("Street:", edits.street);
    rowR("City:", edits.city);
    rowR("ZIP:", edits.zip);

    const yAfter = Math.min(yL, yR) - 8;
    drawDashedLine(page, M, yAfter, W - M);
    return yAfter - 14;
  };

  // Typeset terms in TWO COLUMNS across pages
  const drawTermsTwoColumns = async (page, yStart, text) => {
    const gap = 22;
    const colW = Math.floor((W - (M * 2) - gap) / 2);
    const size = 6.5;
    const wrapKey = "msa:twocol";
    let y = yStart;

    // Wrap once; then feed lines into columns
    const lines = await getWrappedLinesCached(env, text, font, size, colW, wrapKey);

    let col = 0; // 0 -> left, 1 -> right
    let idx = 0;

    const newPage = (continued = true) => {
      page = pdf.addPage([W, H]);
      const afterHeaderY = header(page, { continued });
      y = afterHeaderY;
      col = 0;
    };

    const xForCol = (c) => (c === 0 ? M : M + colW + gap);

    while (idx < lines.length) {
      // bottom margin guard – leave space for footer/signature page later (we will add signature on a dedicated last page)
      const bottom = 80;
      if (y < bottom) {
        // switch column or page
        if (col === 0) {
          // move to right column on the same page
          col = 1;
          y = yStart; // reset Y to top content start on this page
        } else {
          // add new page
          newPage(true);
        }
      }

      const ln = lines[idx++];
      page.drawText(ln, { x: xForCol(col), y, size, font, color: VINET_BLACK });
      y -= lineH;
      if (ln.trim() === "") y -= paraGap; // paragraph gap
    }

    // Return the last used page so the caller knows where we are
    return page;
  };

    // Footer style like debit: Full Name | Signature | Date
    const footY = sepY - 28;

    // Full Name
    page.drawText("Full Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(edits.full_name || ""), { x: M + 70, y: footY, size: 10, font, color: VINET_BLACK });

    // Signature block to the center/right
    page.drawText("Signature:", { x: M + (W / 2 - 50), y: footY, size: 10, font: bold, color: VINET_BLACK });
    const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sigBytes) {
      const sigImg = await pdf.embedPng(sigBytes);
      const sigW = 160;
      const sc = sigImg.scale(1);
      const sigH = (sc.height / sc.width) * sigW;
      page.drawImage(sigImg, {
        x: M + (W / 2 - 50) + 70,
        y: footY - sigH + 8,
        width: sigW,
        height: sigH,
      });
    }

    // Only the label “Date:” then actual date value (like DO)
    page.drawText("Date:", { x: W - M - 120, y: footY, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(localDateZAISO().split("-").reverse().join("/"), {
      x: W - M - 120 + 36,
      y: footY,
      size: 10,
      font,
      color: VINET_BLACK,
    });

    // Security audit summary (bottom area, small)
    const meta = sess.audit_meta || {};
    let ay = footY - 46;
    page.drawText("Security Audit", { x: M, y: ay, size: 11, font: bold, color: VINET_RED });
    ay -= 12;
    const auditLines = [
      `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
      `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${meta.asn || "n/a"}  •  Org: ${meta.asOrganization || "n/a"}`,
      `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${meta.country || "?"}`,
      `Device: ${meta.ua || sess.last_ua || "n/a"}`,
      `© Vinet Internet Solutions (Pty) Ltd`,
    ];
    for (const l of auditLines) {
      page.drawText(l, { x: M, y: ay, size: 9.5, font, color: VINET_BLACK });
      ay -= 12;
    }
  };

  // --- Build pages ---
  // Page 1: header + top details, then two‑column terms
  let page = pdf.addPage([W, H]);
  const yAfterHeader = header(page, { continued: false });
  const yAfterTop = drawClientAgreementTop(page, yAfterHeader);
  page = await drawTermsTwoColumns(page, yAfterTop, terms);

  // Final page for signature (separate page like DO uses footer area)
  await drawSignaturePage();

  // Save/cache/return
  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
