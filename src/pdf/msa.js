import { PDFDocument } from "pdf-lib";
import { DEFAULT_DEBIT_TERMS_URL, HEADER_PHONE_DEFAULT, HEADER_WEBSITE_DEFAULT, PDF_CACHE_TTL, PDF_FONTS, VINET_BLACK, VINET_RED } from "../constants.js";
import { drawDashedLine, embedLogo, fetchR2Bytes, fetchTextCached, getWrappedLinesCached, localDateZAISO, localDateTimePrettyZA } from "../helpers.js";

export async function renderDebitPdf(env, linkid) {
  const cacheKey = `pdf:debit:${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) return new Response(cached, { headers: { "content-type":"application/pdf", "cache-control":"public, max-age=86400" } });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) return new Response("Debit Order not available for this link.", { status: 409 });

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
  const terms = (await fetchTextCached(termsUrl, env, "terms:debit")) || "Terms unavailable.";

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body);
  const bold = await pdf.embedFont(PDF_FONTS.bold);
  let page = pdf.addPage([595, 842]); // A4
  const W=595,H=842,M=40;

  // Header (logo 25% bigger; phone+web below)
  const logoImg = await embedLogo(pdf, env);
  let y = H - 40;
  if (logoImg) {
    const targetH = 52.5; // 42 * 1.25
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    page.drawImage(logoImg, { x: W - M - lw, y: y - targetH, width: lw, height: targetH });
  }
  page.drawText("Vinet Debit Order Instruction", { x:M, y:y-8, size:18, font:bold, color:VINET_RED });
  y -= 30;
  page.drawText(`${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${env.HEADER_PHONE || HEADER_PHONE_DEFAULT}`, { x:M, y, size:10, font, color:VINET_BLACK });

  // Lower the dashed line slightly
  y -= 18;
  drawDashedLine(page, M, y, W-M);
  y -= 24;

  // Sub-headings
  const colW = (W - M*2)/2;
  page.drawText("Client Details", { x:M, y, size:12, font:bold, color:VINET_RED });
  page.drawText("Debit Order Details", { x:M+colW+12, y, size:12, font:bold, color:VINET_RED });
  y -= 16;

  // Left column: client
  let yL = y;
  const rowL=(k,v)=>{ page.drawText(k,{x:M,y:yL,size:10,font:bold,color:VINET_BLACK}); page.drawText(String(v||""),{x:M+120,y:yL,size:10,font,color:VINET_BLACK}); yL-=14; };
  rowL("Client code:", idOnly);
  rowL("Full Name:", edits.full_name);
  rowL("ID / Passport:", edits.passport);
  rowL("Email:", edits.email);
  rowL("Phone:", edits.phone);
  rowL("Street:", edits.street);
  rowL("City:", edits.city);
  rowL("ZIP:", edits.zip);

  // Right column: debit
  let xR = M + colW + 12;
  let yR = y;
  const rowR=(k,v)=>{ page.drawText(k,{x:xR,y:yR,size:10,font:bold,color:VINET_BLACK}); page.drawText(String(v||""),{x:xR+140,y:yR,size:10,font,color:VINET_BLACK}); yR-=14; };
  rowR("Account Holder Name:", d.account_holder);
  rowR("Account Holder ID:", d.id_number);
  rowR("Bank:", d.bank_name);
  rowR("Bank Account No:", d.account_number);
  rowR("Account Type:", d.account_type);
  rowR("Debit Order Date:", d.debit_day);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W-M);

  // Terms (8pt, single col), leave space for footer
  let yT = infoBottom - 14;
  const sizeT=8, lineH=11.2, colWidth=W-M*2;
  const lines = await getWrappedLinesCached(env, terms, font, sizeT, colWidth, "debit");
  for (const ln of lines) {
    if (yT < 120) break;
    page.drawText(ln, { x:M, y:yT, size:sizeT, font, color:VINET_BLACK });
    yT -= lineH;
  }

  // Footer Name | Signature | Date
  const footY = 90;
  page.drawText("Name:", { x:M, y:footY, size:10, font:bold, color:VINET_BLACK });
  page.drawText(String(edits.full_name||""), { x:M+45, y:footY, size:10, font, color:VINET_BLACK });

  page.drawText("Signature:", { x:M + (W/2 - 50), y:footY, size:10, font:bold, color:VINET_BLACK });
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = 160;
    const sc = sigImg.scale(1);
    const sigH = (sc.height/sc.width) * sigW;
    // place signature so it does NOT overlap date
    page.drawImage(sigImg, { x: M + (W/2 - 50) + 70, y: footY - sigH + 8, width: sigW, height: sigH });
  }

  // “Date” label only (per request)
  page.drawText("Date:", { x: W - M - 120, y: footY, size:10, font:bold, color:VINET_BLACK });
  page.drawText(localDateZAISO().split("-").reverse().join("/"), { x: W - M - 120 + 42, y: footY, size:10, font, color:VINET_BLACK });

  // Page 2: Security audit header (with Cape Town time, IP, ASN, UA)
  const audit = pdf.addPage([W,H]);
  let ay = H - 40;
  if (logoImg) {
    const targetH = 36;
    const sc = logoImg.scale(1);
    const ratio = targetH / sc.height;
    const lw = sc.width * ratio;
    audit.drawImage(logoImg, { x: W - M - lw, y: ay - targetH, width: lw, height: targetH });
  }
  audit.drawText("Security Audit", { x:M, y:ay-8, size:16, font:bold, color:VINET_RED });
  ay -= 26;
  drawDashedLine(audit, M, ay, W-M);

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
    audit.drawText(l, { x:M, y:ay2, size:10, font, color:VINET_BLACK });
    ay2 -= 14;
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, { headers: { "content-type":"application/pdf", "cache-control":"public, max-age=86400" } });
}
