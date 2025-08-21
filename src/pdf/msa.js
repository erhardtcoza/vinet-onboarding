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
  // ✅ Correct cache key for MSA
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

  // ✅ Load session & verify MSA signature exists
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not available for this link.", { status: 409 });
  }

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  // ✅ Use MSA terms (not debit)
  const termsUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const terms =
    (await fetchTextCached(termsUrl, env, "terms:msa")) || "Terms unavailable.";

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(PDF_FONTS.body); // Times Roman
  const bold = await pdf.embedFont(PDF_FONTS.bold); // Times Roman Bold

  // A4 page
  let page = pdf.addPage([595, 842]);
  const W = 595,
    H = 842,
    M = 40;

  // ---------- Header ----------
  const logoImg = await embedLogo(pdf, env);
  let y = H - 40;
  if (logoImg) {
    // 25% bigger than original 42
    const targetH = 52.5;
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

  page.drawText("Vinet Internet Solutions Service Agreement", {
    x: M,
    y: y - 8,
    size: 18,
    font: bold,
    color: VINET_RED,
  });

  y -= 30;
  page.drawText(
    `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${
      env.HEADER_PHONE || HEADER_PHONE_DEFAULT
    }`,
    { x: M, y, size: 10, font, color: VINET_BLACK }
  );

  // Lower the dashed divider slightly to better size the page
  y -= 18;
  drawDashedLine(page, M, y, W - M);
  y -= 24;

  // ---------- Client block (two columns) with red sub-headings ----------
  const colW = (W - M * 2) / 2;

  // left column heading
  page.drawText("Client Details", {
    x: M,
    y,
    size: 12,
    font: bold,
    color: VINET_RED,
  });
  // right column heading
  page.drawText("Additional Details", {
    x: M + colW + 12,
    y,
    size: 12,
    font: bold,
    color: VINET_RED,
  });
  y -= 16;

  // Left column fields
  let yL = y;
  const rowL = (k, v) => {
    page.drawText(k, { x: M, y: yL, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), {
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

  // Right column fields
  const xR = M + colW + 12;
  let yR = y;
  const rowR = (k, v) => {
    page.drawText(k, { x: xR, y: yR, size: 10, font: bold, color: VINET_BLACK });
    page.drawText(String(v || ""), {
      x: xR + 100,
      y: yR,
      size: 10,
      font,
      color: VINET_BLACK,
    });
    yR -= 14;
  };
  rowR("Phone:", edits.phone);
  rowR("Street:", edits.street);
  rowR("City:", edits.city);
  rowR("ZIP:", edits.zip);

  const infoBottom = Math.min(yL, yR) - 8;
  drawDashedLine(page, M, infoBottom, W - M);

  // ---------- Terms: 2 columns @ 7pt flowing across pages ----------
  const sizeT = 7;
  const colGap = 16;
  const colWidth = (W - M * 2 - colGap) / 2;
  const lineH = 9.6;
  const wrapped = await getWrappedLinesCached(
    env,
    terms,
    font,
    sizeT,
    colWidth,
    "msa"
  );

  let xCol = M;
  let yCol = infoBottom - 14;
  let whichCol = 0; // 0 left, 1 right

  const paintHeader = (pg) => {
    let hy = H - 40;
    if (logoImg) {
      const targetH = 36;
      const sc = logoImg.scale(1);
      const ratio = targetH / sc.height;
      const lw = sc.width * ratio;
      pg.drawImage(logoImg, {
        x: W - M - lw,
        y: hy - targetH,
        width: lw,
        height: targetH,
      });
    }
    pg.drawText("Vinet Internet Solutions Service Agreement", {
      x: M,
      y: hy - 8,
      size: 16,
      font: bold,
      color: VINET_RED,
    });
    hy -= 24;
    pg.drawText(
      `${env.HEADER_WEBSITE || HEADER_WEBSITE_DEFAULT}  |  ${
        env.HEADER_PHONE || HEADER_PHONE_DEFAULT
      }`,
      { x: M, y: hy, size: 9, font, color: VINET_BLACK }
    );
    hy -= 12;
    drawDashedLine(pg, M, hy, W - M);
    return hy - 14;
  };

  for (let i = 0; i < wrapped.length; i++) {
    // footer/signature area reserved only on the final page;
    // while flowing text, just keep columns within margins
    if (yCol < 90) {
      if (whichCol === 0) {
        whichCol = 1;
        xCol = M + colWidth + colGap;
        yCol = infoBottom - 14;
      } else {
        // new page for continued terms
        page = pdf.addPage([W, H]);
        const top = paintHeader(page);
        xCol = M;
        yCol = top;
        whichCol = 0;
      }
    }
    page.drawText(wrapped[i], {
      x: xCol,
      y: yCol,
      size: sizeT,
      font,
      color: VINET_BLACK,
    });
    yCol -= lineH;
  }

  // ---------- Footer (on the last page we’re on) ----------
  const footY = 90;
  page.drawText("Name:", {
    x: M,
    y: footY,
    size: 10,
    font: bold,
    color: VINET_BLACK,
  });
  page.drawText(String(edits.full_name || ""), {
    x: M + 45,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  page.drawText("Signature:", {
    x: M + (W / 2 - 50),
    y: footY,
    size: 10,
    font: bold,
    color: VINET_BLACK,
  });
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    const sigImg = await pdf.embedPng(sigBytes);
    const sigW = 160;
    const sc = sigImg.scale(1);
    const sigH = (sc.height / sc.width) * sigW;
    // Place signature so it does NOT overlap the date
    page.drawImage(sigImg, {
      x: M + (W / 2 - 50) + 70,
      y: footY - sigH + 8,
      width: sigW,
      height: sigH,
    });
  }

  // “Date” label only (per request)
  page.drawText("Date:", {
    x: W - M - 120,
    y: footY,
    size: 10,
    font: bold,
    color: VINET_BLACK,
  });
  page.drawText(localDateZAISO().split("-").reverse().join("/"), {
    x: W - M - 120 + 42,
    y: footY,
    size: 10,
    font,
    color: VINET_BLACK,
  });

  // ---------- Page 2: Security Audit ----------
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
  audit.drawText("Security Audit", {
    x: M,
    y: ay - 8,
    size: 16,
    font: bold,
    color: VINET_RED,
  });
  ay -= 26;
  drawDashedLine(audit, M, ay, W - M);

  const meta = sess.audit_meta || {};
  const linesAudit = [
    `Generated (Africa/Johannesburg): ${localDateTimePrettyZA()}`,
    `Client IP: ${meta.ip || sess.last_ip || "n/a"}  •  ASN: ${
      meta.asn || "n/a"
    }  •  Org: ${meta.asOrganization || "n/a"}`,
    `Approx Location: ${meta.city || "?"}, ${meta.region || "?"}, ${
      meta.country || "?"
    }`,
    `Device: ${meta.ua || sess.last_ua || "n/a"}`,
    `© Vinet Internet Solutions (Pty) Ltd`,
  ];
  let ay2 = ay - 20;
  for (const l of linesAudit) {
    audit.drawText(l, { x: M, y: ay2, size: 10, font, color: VINET_BLACK });
    ay2 -= 14;
  }

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=86400",
    },
  });
}
