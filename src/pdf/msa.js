// src/pdf/msa.js
import { PDFDocument } from "pdf-lib";
import {
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
  getWrappedLinesCached,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";

// IMPORTANT: named export exactly as used by routes
export async function renderMSAPdf(env, linkid, reqMeta = {}) {
  const cacheKey = `pdf:msa:${linkid}`;          // <-- distinct MSA cache key
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_sig_key) {        // <-- check agreement_sig_key (MSA)
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body);
  const bold = await pdf.embedFont(PDF_FONTS.bold);
  const W = 595, H = 842, M = 40;

  // PAGE 1
  const page = pdf.addPage([W, H]);
  let y = H - 40;

  // header
  const logoImg = await embedLogo(pdf, env);
  if (logoImg) {
    const targetH = 52.5; // 25% larger than 42
    const ratio = targetH / logoImg.scale(1).height;
    const lw = logoImg.scale(1).width * ratio;
    page.drawImage(logoImg, { x: W - M - lw, y: y - targetH, width: lw, height: targetH });
  }
  page.drawText("Vinet Master Service Agreement", { x: M, y: y - 8, size: 18, font: bold, color: VINET_RED });
  y -= 30;
  page.drawText(
    `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`,
    { x: M, y, size: 10, font, color: VINET_BLACK }
  );

  // dashed rule a little lower
  y -= 18;
  drawDashedLine(page, M, y, W - M);
  y -= 24;

  // headings
  page.drawText("Client Details", { x: M, y, size: 12, font: bold, color: VINET_RED });
  y -= 16;

  // client block
  let yL = y;
  const row = (k, v) => {
    page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), { x: M + 120, y: yL, size: 10, font, color: VINET_BLACK });
    yL -= 14;
  };
  row("Client code:", idOnly);
  row("Full Name:", edits.full_name);
  row("ID / Passport:", edits.passport);
  row("Email:", edits.email);
  row("Phone:", edits.phone);
  row("Street:", edits.street);
  row("City:", edits.city);
  row("ZIP:", edits.zip);

  const infoBottom = yL - 8;
  drawDashedLine(page, M, infoBottom, W - M);

  // (You can draw MSA body text here, if needed, using getWrappedLinesCached like the debit form)

  // footer: name | signature | date (no overlap)
  const footY = 90;
  page.drawText("Name:", { x: M, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(String(edits.full_name || ""), { x: M + 45, y: footY, size: 10, font, color: VINET_BLACK });

  page.drawText("Signature:", { x: M + (W / 2 - 50), y: footY, size: 10, font: bold, color: VINET_BLACK });
  // NOTE: use agreement_sig_key for MSA signature
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = 160;
    const ratioSig = sigImg.scale(1);
    const sigH = (ratioSig.height / ratioSig.width) * sigW;
    page.drawImage(sigImg, {
      x: M + (W / 2 - 50) + 70,
      y: footY - sigH + 8,
      width: sigW,
      height: sigH,
    });
  }

  page.drawText("Date:", { x: W - M - 120, y: footY, size: 10, font: bold, color: VINET_BLACK });
  page.drawText(localDateZAISO().split("-").reverse().join("/"), {
    x: W - M - 120 + 42,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // PAGE 2 — Security Audit
  const audit = pdf.addPage([W, H]);
  let ay = H - 40;
  if (logoImg) {
    const targetH = 36;
    const ratio2 = targetH / logoImg.scale(1).height;
    const lw2 = logoImg.scale(1).width * ratio2;
    audit.drawImage(logoImg, { x: W - M - lw2, y: ay - targetH, width: lw2, height: targetH });
  }
  audit.drawText("Security Audit", { x: M, y: ay - 8, size: 16, font: bold, color: VINET_RED });
  ay -= 26;
  drawDashedLine(audit, M, ay, W - M);

  const meta = sess.audit_meta || {};
  const auditLines = [
    `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
    `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${meta.asn || "n/a"}  •  Org: ${meta.asOrganization || "n/a"}`,
    `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${meta.country || "?"}`,
    `Device: ${meta.ua || sess.last_ua || "n/a"}`,
    `© Vinet Internet Solutions (Pty) Ltd`,
  ];
  let ay2 = ay - 20;
  for (const line of auditLines) {
    audit.drawText(line, { x: M, y: ay2, size: 10, font, color: VINET_BLACK });
    ay2 -= 14;
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "public, max-age=86400" },
  });
}
