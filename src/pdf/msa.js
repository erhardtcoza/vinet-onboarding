// src/pdf/msa.js
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_MSA_TERMS_URL,
  HEADER_PHONE_DEFAULT,
  HEADER_WEBSITE_DEFAULT,
  PDF_CACHE_TTL,
  PDF_FONTS,
  VINET_BLACK,
  VINET_RED,
} from "../constants.js";
import {
  drawDashedLine,
  embedLogo,
  fetchR2Bytes,
  fetchTextCached,
  getWrappedLinesCached,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";

export async function renderMSAPdf(env, linkid, reqMeta = {}) {
  // Cache
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const terms = (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body); // Times
  const bold = await pdf.embedFont(PDF_FONTS.bold);

  const W = 595, H = 842, M = 40; // A4
  const GUTTER = 18;
  const MIN_FOOTER_Y = 110;

  // Header like DO, with dashed rule *below* logo so it doesn't overlap
  async function renderHeader(page, { continued = false } = {}) {
    let yTop = H - 40;
    const logoImg = await embedLogo(pdf, env);
    let logoBottom = yTop;

    if (logoImg) {
      const targetH = 52.5; // ~25% larger than the older ~42px
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      const ly = yTop - targetH; // top of page minus logo height
      page.drawImage(logoImg, { x: W - M - lw, y: ly, width: lw, height: targetH });
      logoBottom = ly; // y of bottom of title area
    }

    // Title (only on MSA pages, omitted on security audit; caller decides)
    if (continued) {
      page.drawText("Master Service Agreement (continued)", {
        x: M,
        y: yTop - 8,
        size: 18,
        font: bold,
        color: VINET_RED,
      });
    } else {
      page.drawText("Master Service Agreement", {
        x: M,
        y: yTop - 8,
        size: 18,
        font: bold,
        color: VINET_RED,
      });
    }

    // Contact line
    const contactY = yTop - 30;
    page.drawText(
      `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`,
      { x: M, y: contactY, size: 10, font, color: VINET_BLACK }
    );

    // Dashed rule placed safely below the logo/contact area
    const ruleY = Math.min(logoBottom - 6, contactY - 12);
    drawDashedLine(page, M, ruleY, W - M);

    return ruleY - 24; // next content Y
  }

  // Page 1
  let page = pdf.addPage([W, H]);
  let y = await renderHeader(page, { continued: false });

  // Top block layout
  const colW = (W - 2 * M - GUTTER) / 2;

  // Left column — Client details
  page.drawText("Client Details", { x: M, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  let yL = y;
  const leftRow = (k, v) => {
    page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: M + 120, y: yL, size: 10, font, color: VINET_BLACK });
    yL -= 14;
  };
  leftRow("Client code:", idOnly);
  leftRow("Full Name:", edits.full_name);
  leftRow("ID number:", edits.passport);
  leftRow("Email address:", edits.email);
  leftRow("Phone:", edits.phone);

  // Right column — Address, Payment method, IDs, Dates
  let xR = M + colW + GUTTER;
  let yR = y;
  page.drawText("Details", { x: xR, y: yR, size: 12, font: bold, color: VINET_RED });
  yR -= 16;

  const rightRow = (k, v) => {
    page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: xR + 120, y: yR, size: 10, font, color: VINET_BLACK });
    yR -= 14;
  };
  rightRow("Street:", edits.street);
  rightRow("City:", edits.city);
  rightRow("Postal code:", edits.zip);
  rightRow("Payment method:", sess.pay_method || "—");         // label only, no banking info
  rightRow("Agreement ID:", linkid);
  rightRow("Generated (date):", localDateZAISO().split("-").reverse().join("/"));

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M);

  // Terms — **two columns**, size 7
  let yText = infoBottom - 14;
  const sizeT = 7;
  const lineH = 10; // comfortable for 7pt
  const col1X = M;
  const col2X = M + colW + GUTTER;

  const wrapped = await getWrappedLinesCached(env, terms, font, sizeT, colW, "msa:cols7");
  let i = 0;
  let col = 1;

  function moveToNextColumnOrPage() {
    if (col === 1) {
      col = 2;
      yText = infoBottom - 14; // reset y for second column on first page
      return;
    }
    // New page (continued header)
    const np = pdf.addPage([W, H]);
    page = np;
    // For continuation pages, show "(continued)"
    // Returns the first content y for the page
    return renderHeader(page, { continued: true }).then((ny) => {
      // space down a bit before terms
      yText = ny - 2;
      col = 1;
    });
  }

  while (i < wrapped.length) {
    // If we’re too low for more text + footer, advance
    if (yText < MIN_FOOTER_Y) {
      // switch column or page
      if (col === 1) {
        col = 2;
        yText = infoBottom - 14;
      } else {
        const ny = await renderHeader(pdf.addPage([W, H]), { continued: true });
        page = pdf.getPages()[pdf.getPages().length - 1];
        yText = ny - 2;
        col = 1;
      }
    }

    const xDraw = (col === 1) ? col1X : col2X;
    page.drawText(wrapped[i], { x: xDraw, y: yText, size: sizeT, font, color: VINET_BLACK });
    yText -= lineH;
    i++;
  }

  // Footer with just: Full Name (left) | Signature (center) | Date (right)
  // If not enough space left on the current page for footer, push to new page
  if (yText < MIN_FOOTER_Y) {
    const last = pdf.addPage([W, H]);
    page = last;
    // Continuation header again
    const ny = await renderHeader(page, { continued: true });
    yText = ny - 2;
  }

  // Draw footer fields
  const footY = 90;

  // Full name (left)
  page.drawText("Full name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(String(edits.full_name || ""), {
    x: M + 70,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // Signature (center)
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  const centerX = W / 2;
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = 160;
    const sc = sigImg.scale(1);
    const sigH = (sc.height / sc.width) * sigW;
    page.drawText("Signature:", {
      x: centerX - 40,
      y: footY,
      size: 10,
      font: bold,
      color: VINET_BLACK,
    });
    page.drawImage(sigImg, {
      x: centerX + 28,
      y: footY - sigH + 8,
      width: sigW,
      height: sigH,
    });
  } else {
    page.drawText("Signature:", { x: centerX - 40, y: footY, size: 10, font: bold, color: VINET_BLACK });
  }

  // Date (right)
  const dateLabelX = W - M - 120;
  page.drawText("Date:", { x: dateLabelX, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(localDateZAISO().split("-").reverse().join("/"), {
    x: dateLabelX + 36,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // Security Audit page (NO MSA header text here)
  const audit = pdf.addPage([W, H]);
  // Render header without the title line: we’ll call a lightweight variant
  {
    let yTop = H - 40;
    const logoImg = await embedLogo(pdf, env);
    let logoBottom = yTop;

    if (logoImg) {
      const targetH = 52.5;
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      const ly = yTop - targetH;
      audit.drawImage(logoImg, { x: W - M - lw, y: ly, width: lw, height: targetH });
      logoBottom = ly;
    }

    const contactY = yTop - 30;
    audit.drawText(
      `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`,
      { x: M, y: contactY, size: 10, font, color: VINET_BLACK }
    );

    const ruleY = Math.min(logoBottom - 6, contactY - 12);
    drawDashedLine(audit, M, ruleY, W - M);

    // Now audit content
    let ay2 = ruleY - 20;
    audit.drawText("Security Audit", { x: M, y: ay2 + 14, size: 16, font: bold, color: VINET_RED });

    const meta = sess.audit_meta || {};
    const linesAudit = [
      `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
      `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${meta.asn || "n/a"}  •  Org: ${meta.asOrganization || "n/a"}`,
      `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${meta.country || "?"}`,
      `Device: ${meta.ua || sess.last_ua || "n/a"}`,
    ];
    let yAudit = ay2 - 10;
    for (const l of linesAudit) {
      audit.drawText(l, { x: M, y: yAudit, size: 10, font, color: VINET_BLACK });
      yAudit -= 14;
    }

    // Centered copyright at bottom
    const copyright = "© Vinet Internet Solutions (Pty) Ltd";
    const w = font.widthOfTextAtSize(copyright, 10);
    audit.drawText(copyright, { x: (W - w) / 2, y: 40, size: 10, font, color: VINET_BLACK });
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });

  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
