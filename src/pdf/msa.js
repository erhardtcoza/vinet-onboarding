// /src/pdf/msa.js
import { PDFDocument } from "pdf-lib";
import {
  HEADER_PHONE_DEFAULT,
  HEADER_WEBSITE_DEFAULT,
  PDF_CACHE_TTL,
  PDF_FONTS,
  VINET_BLACK,
  VINET_RED,
  DEFAULT_MSA_TERMS_URL,   // if not present in your constants, it will fall back below
} from "../constants.js";
import {
  drawDashedLine,
  embedLogo,
  fetchR2Bytes,
  fetchTextCached,
  getWrappedLinesCached,
  localDateTimePrettyZA,
} from "../helpers.js";

/**
 * Render the VINET Master Service Agreement as a paginated, two‑column PDF.
 * - Uses Times Roman family (via PDF_FONTS) to avoid WinAnsi errors.
 * - Header line moved down (clear of logo).
 * - Terms flow in two columns; each new page’s columns start at the top.
 * - Final page footer with Name (left), Signature (center), Date (right).
 * - Signature sits ABOVE the signature line and no longer overlaps the date.
 * - Copyright centered at bottom.
 * - Appends a “Security Audit” page at the very end.
 */
export async function renderMSAPdf(env, linkid, reqMeta = {}) {
  const cacheKey = `pdf:msa:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "public, max-age=86400",
      },
    });
  }

  // Session & inputs
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.msa_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  // Terms source (fallback chain is generous)
  const termsUrl =
    env.TERMS_MSA_URL ||
    env.TERMS_SERVICE_URL ||
    DEFAULT_MSA_TERMS_URL ||
    "https://vinet.co.za/msa.txt";
  const termsText =
    (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";

  // PDF setup
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body);
  const bold = await pdf.embedFont(PDF_FONTS.bold);
  const W = 595, H = 842, M = 40; // A4

  // ---------- Header (shared on page 1 only) ----------
  const page1 = pdf.addPage([W, H]);
  const logoImg = await embedLogo(pdf, env);

  let headerTopY = H - 40;
  if (logoImg) {
    const targetH = 52.5; // 25% larger than old ~42px
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    // Right-aligned logo
    page1.drawImage(logoImg, {
      x: W - M - lw,
      y: headerTopY - targetH,
      width: lw,
      height: targetH,
    });
  }

  // Title
  page1.drawText("Vinet Master Service Agreement", {
    x: M,
    y: headerTopY - 8,
    size: 18,
    font: bold,
    color: VINET_RED,
  });

  // Phone + Website below title (and below the logo area), then line lower down
  let y = (logoImg ? headerTopY - 52.5 - 12 : headerTopY - 24); // put below logo if present
  page1.drawText(
    `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${
      env.HEADER_PHONE || HEADER_PHONE_DEFAULT
    }`,
    { x: M, y, size: 10, font, color: VINET_BLACK }
  );

  // Lower the dashed line so it does not run “through” the logo
  y -= 24; // ~ “3 line entries” effect vs previous
  drawDashedLine(page1, M, y, W - M);
  y -= 18;

  // ---------- Client meta row(s) ----------
  // Left block heading in red
  page1.drawText("Client Details", {
    x: M,
    y,
    size: 12,
    font: bold,
    color: VINET_RED,
  });
  const colGap = 12;
  const colW = (W - M * 2) / 2;

  // left column
  let yL = y - 16;
  const rowL = (k, v) => {
    page1.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page1.drawText(String(v || ""), {
      x: M + 120,
      y: yL,
      size: 10,
      font,
      color: VINET_BLACK,
    });
    yL -= 14;
  };
  rowL("Client code:", idOnly);
  rowL("Full Name:", edits.full_name);
  rowL("ID / Passport:", edits.passport);
  rowL("Email:", edits.email);
  rowL("Phone:", edits.phone);
  rowL("Street:", edits.street);
  rowL("City:", edits.city);
  rowL("ZIP:", edits.zip);

  // Right column heading in red
  page1.drawText("Agreement Details", {
    x: M + colW + colGap,
    y,
    size: 12,
    font: bold,
    color: VINET_RED,
  });
  // You can place any relevant MSA-specific fields here if you store them
  let yR = y - 16;
  const rowR = (k, v) => {
    page1.drawText(k, {
      x: M + colW + colGap,
      y: yR,
      size: 10,
      font: bold,
      color: VINET_BLACK,
    });
    page1.drawText(String(v || ""), {
      x: M + colW + colGap + 140,
      y: yR,
      size: 10,
      font,
      color: VINET_BLACK,
    });
    yR -= 14;
  };
  // Example placeholders — remove or replace with real fields when available
  rowR("Service Package:", sess.package || "—");
  rowR("Term:", sess.term || "—");
  rowR("Start Date:", sess.start_date || "—");

  // Divider before terms
  const infoBottom = Math.min(yL, yR) - 10;
  drawDashedLine(page1, M, infoBottom, W - M);

  // ---------- Terms: two-column flow across pages ----------
  const textSize = 9, lineH = 12;
  const colInnerGap = 18;
  const colWidth = (W - M * 2 - colInnerGap) / 2;

  // Starting text Y for page1 columns (below infoBottom)
  let textY = infoBottom - 16;

  // Wrap terms once (cache key “msa:wrap”)
  const lines = await getWrappedLinesCached(
    env,
    termsText,
    font,
    textSize,
    colWidth,
    "msa:wrap"
  );

  // Utility to render a line and update cursor
  function drawLine(p, x, y, s) {
    p.drawText(s, { x, y, size: textSize, font, color: VINET_BLACK });
  }

  // Render text into two columns per page, creating more pages as needed,
  // and ensure that on *new pages* both columns start at the top area.
  let i = 0;
  let p = page1;
  let col = 0; // 0 = left, 1 = right
  let colXLeft = M;
  let colXRight = M + colWidth + colInnerGap;

  // “usable” heights per page for columns:
  const firstPageTopY = textY;
  const nextPagesTopY = H - 80; // start near top on subsequent pages
  const bottomY = 120; // leave space for final footer if the last page becomes the signature page

  function yTopForPage(pageIndex) {
    return pageIndex === 0 ? firstPageTopY : nextPagesTopY;
  }

  let pageIndex = 0;
  let yCursor = yTopForPage(pageIndex);

  function addNewPageForTerms() {
    p = pdf.addPage([W, H]);
    pageIndex += 1;
    col = 0;
    yCursor = yTopForPage(pageIndex); // start at page top for both columns
  }

  while (i < lines.length) {
    const x = col === 0 ? colXLeft : colXRight;

    if (yCursor < bottomY) {
      // Move to next column or next page
      if (col === 0) {
        // switch to right column on same page
        col = 1;
        yCursor = yTopForPage(pageIndex); // start at top for the second column of this page
      } else {
        // next page, left column again
        addNewPageForTerms();
      }
      continue;
    }

    drawLine(p, x, yCursor, lines[i]);
    yCursor -= lineH;
    i += 1;
  }

  // ---------- Final page footer (Name | Signature | Date) ----------
  // Ensure we have some space on the current page; otherwise new page
  if (yCursor < 160) {
    // Make a fresh page for the footer/sign
    p = pdf.addPage([W, H]);
    pageIndex += 1;
  }

  // Footer layout
  const labelY = 78;     // labels baseline
  const valueY = labelY + 20; // values (name/date) above labels
  const sigLineY = valueY - 2; // line where signature should sit above
  const leftX = M;
  const centerX = W / 2;
  const rightX = W - M;

  // Name (left)
  p.drawText("Full Name:", { x: leftX, y: labelY, size: 10, font: bold, color: VINET_BLACK });
  p.drawText(String(edits.full_name || ""), {
    x: leftX,
    y: valueY,
    size: 11,
    font,
    color: VINET_BLACK,
  });

  // Signature (center)
  const sigBytes = await fetchR2Bytes(env, sess.msa_sig_key);
  p.drawText("Signature", {
    x: centerX - 28,
    y: labelY,
    size: 10,
    font: bold,
    color: VINET_BLACK,
  });

  // Draw a thin signature line centered
  const sigLineW = 200;
  const sigLineX1 = centerX - sigLineW / 2;
  const sigLineX2 = centerX + sigLineW / 2;
  drawDashedLine(p, sigLineX1, sigLineY, sigLineX2, { dash: 2, gap: 2 });

  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const desiredW = 160;
    const sc = sigImg.scale(1);
    const desiredH = (sc.height / sc.width) * desiredW;
    // Place signature ABOVE the line (no overlap with date or labels)
    p.drawImage(sigImg, {
      x: centerX - desiredW / 2,
      y: sigLineY + 6,
      width: desiredW,
      height: desiredH,
    });
  }

  // Date (right)
  p.drawText("Date", { x: rightX - 100, y: labelY, size: 10, font: bold, color: VINET_BLACK });
  // We’ll use localDateTimePrettyZA() and strip the time for MSA if you prefer only date; here we keep date+time pretty.
  p.drawText(localDateTimePrettyZA(), {
    x: rightX - 100,
    y: valueY,
    size: 11,
    font,
    color: VINET_BLACK,
  });

  // Copyright (bottom center)
  p.drawText("© Vinet Internet Solutions (Pty) Ltd", {
    x: W / 2 - (font.widthOfTextAtSize("© Vinet Internet Solutions (Pty) Ltd", 9) / 2),
    y: 40,
    size: 9,
    font,
    color: VINET_BLACK,
  });

  // ---------- Security Audit page ----------
  const audit = pdf.addPage([W, H]);
  let ay = H - 40;
  if (logoImg) {
    const targetH = 36;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    audit.drawImage(logoImg, {
      x: W - M - lw,
      y: ay - targetH,
      width: lw,
      height: targetH,
    });
  }
  audit.drawText("Security Audit", { x: M, y: ay - 8, size: 16, font: bold, color: VINET_RED });
  ay -= 26;
  drawDashedLine(audit, M, ay, W - M);

  const meta = sess.audit_meta || {};
  const linesAudit = [
    `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
    `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${meta.asn || "n/a"}  •  Org: ${meta.asOrganization || "n/a"}`,
    `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${meta.country || "?"}`,
    `Device: ${meta.ua || sess.last_ua || "n/a"}`,
    `© Vinet Internet Solutions (Pty) Ltd`,
  ];
  let ay2 = ay - 20;
  for (const l of linesAudit) {
    audit.drawText(l, { x: M, y: ay2, size: 10, font, color: VINET_BLACK });
    ay2 -= 14;
  }

  // Save & cache
  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=86400",
    },
  });
}
