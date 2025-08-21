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

  // Session & guards
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const terms = (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  // PDF
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body); // Times Roman family via constants
  const bold = await pdf.embedFont(PDF_FONTS.bold);

  const W = 595, H = 842, M = 40; // A4, portrait

  // Reusable header renderer (matches Debit Order)
  async function renderHeader(page, { continued = false } = {}) {
    const logoImg = await embedLogo(pdf, env);
    let y = H - 40;

    if (logoImg) {
      const targetH = 52.5; // 25% bigger than old ~42px
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      page.drawImage(logoImg, {
        x: W - M - lw,
        y: y - targetH,
        width: lw,
        height: targetH,
      });
    }

    const title = continued ? "Master Service Agreement (continued)" : "Master Service Agreement";
    page.drawText(title, { x: M, y: y - 8, size: 18, font: bold, color: VINET_RED });

    y -= 30;
    page.drawText(
      `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`,
      { x: M, y, size: 10, font, color: VINET_BLACK }
    );

    // Lower the dashed line slightly (like DO)
    y -= 18;
    drawDashedLine(page, M, y, W - M);

    return y - 24; // return next writable Y
  }

  // Page 1 - heading + client/agreement details (mirror DO layout)
  let page = pdf.addPage([W, H]);
  let y = await renderHeader(page, { continued: false });

  const colW = (W - M * 2) / 2;

  // Sub-headings in red
  page.drawText("Client Details", { x: M, y, size: 12, font: bold, color: VINET_RED });
  page.drawText("Agreement Details", { x: M + colW + 12, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  // Left column: client
  let yL = y;
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
  rowL("Street:", edits.street);
  rowL("City:", edits.city);
  rowL("ZIP:", edits.zip);

  // Right column: agreement meta (we include payment method; if debit chosen, show debit day)
  let xR = M + colW + 12;
  let yR = y;
  const rowR = (k, v) => {
    page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: xR + 140, y: yR, size: 10, font, color: VINET_BLACK });
    yR -= 14;
  };
  rowR("Payment Method:", sess.pay_method || "—");
  if (sess.pay_method === "debit") {
    const d = sess.debit || {};
    rowR("Debit Order Date:", d.debit_day || "—");
    rowR("Bank Account Type:", d.account_type || "—");
  }
  rowR("Agreement Status:", sess.status || "—");

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M);

  // Terms: single column (like DO), auto across pages
  let yText = infoBottom - 14;
  const sizeT = 7;                 // slightly larger than DO's 8 to improve legibility here
  const lineH = 10.6;
  const colWidth = W - M * 2;

  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "msa:wrapped");
  let i = 0;

  function addContinuationPage() {
    const p = pdf.addPage([W, H]);
    const ny = renderHeader(p, { continued: true });
    return { page: p, y: ny.then ? null : ny }; // handle both sync/async
  }

  while (i < lines.length) {
    if (yText < 120) {
      // new continuation page
      const cont = pdf.addPage([W, H]);
      yText = await renderHeader(cont, { continued: true });
      yText -= 2;
      page = cont;
    }
    page.drawText(lines[i], { x: M, y: yText, size: sizeT, font, color: VINET_BLACK });
    yText -= lineH;
    i++;
  }

  // Final page footer (Name | Signature | Date) matching DO positioning
  // If the current page is too low for footer, push to a fresh page
  const needNew = yText < 120;
  if (needNew) {
    const last = pdf.addPage([W, H]);
    yText = await renderHeader(last, { continued: true });
    page = last;
  }

  const footY = 90;
  // “Client Details” above footer, mirroring DO's last section
  page.drawText("Client Details", { x: M, y: footY + 38, size: 11, font: bold, color: VINET_RED });
  page.drawText("Agreement Details", { x: M + colW + 12, y: footY + 38, size: 11, font: bold, color: VINET_RED });

  // Light recap lines above the footer fields
  page.drawText("Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(String(edits.full_name || ""), { x: M + 45, y: footY, size: 10, font, color: VINET_BLACK });

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

  // Date (DD/MM/YYYY) — “Date” label only, like DO
  page.drawText("Date:", { x: W - M - 120, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(localDateZAISO().split("-").reverse().join("/"), {
    x: W - M - 120 + 42,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // Security Audit page (Cape Town time, IP, ASN, UA), like DO
  const audit = pdf.addPage([W, H]);
  let ay = await renderHeader(audit, { continued: false });
  audit.drawText("Security Audit", { x: M, y: ay + 16, size: 16, font: bold, color: VINET_RED });
  drawDashedLine(audit, M, ay - 8, W - M);

  const meta = sess.audit_meta || {};
  const linesAudit = [
    `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
    `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${meta.asn || "n/a"}  •  Org: ${meta.asOrganization || "n/a"}`,
    `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${meta.country || "?"}`,
    `Device: ${meta.ua || sess.last_ua || "n/a"}`,
    `© Vinet Internet Solutions (Pty) Ltd`,
  ];
  let ay2 = ay - 26;
  for (const l of linesAudit) {
    audit.drawText(l, { x: M, y: ay2, size: 10, font, color: VINET_BLACK });
    ay2 -= 14;
  }

  // Save + cache
  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });

  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
