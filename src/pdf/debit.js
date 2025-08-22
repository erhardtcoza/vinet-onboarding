// src/pdf/debit.js
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  embedLogo,
  fetchTextCached,
  getWrappedLinesCached,
  fetchR2Bytes,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";
import { VINET_BLACK } from "../constants.js";
import { fetchProfileForDisplay } from "../splynx.js";

const mm = (n) => (n * 72) / 25.4;

function paraSplit(txt) {
  return String(txt || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function drawFooterTriplet(page, font, name, sigImg, dateStr) {
  const { width } = page.getSize();
  const margin = mm(15);
  const y = mm(15);
  const colW = (width - margin * 2) / 3;
  const centerX = (i) => margin + colW * (i + 0.5);

  // 0: Full name
  {
    const cx = centerX(0);
    page.drawText("Full name", { x: cx - 28, y: y + 18, size: 9, font, color: VINET_BLACK });
    page.drawText(name || "—", {
      x: cx - (font.widthOfTextAtSize(name || "—", 11) / 2),
      y,
      size: 11,
      font,
      color: VINET_BLACK,
    });
  }
  // 1: Signature
  {
    const cx = centerX(1);
    page.drawText("Signature", { x: cx - 28, y: y + 18, size: 9, font, color: VINET_BLACK });
    if (sigImg) {
      const w = mm(32);
      const h = (w * sigImg.height) / sigImg.width;
      page.drawImage(sigImg, { x: cx - w / 2, y: y - 2, width: w, height: h, opacity: 0.9 });
    } else {
      page.drawText("—", { x: cx - 3, y, size: 11, font, color: VINET_BLACK });
    }
  }
  // 2: Date
  {
    const cx = centerX(2);
    page.drawText("Date", { x: cx - 12, y: y + 18, size: 9, font, color: VINET_BLACK });
    page.drawText(dateStr || "—", {
      x: cx - (font.widthOfTextAtSize(dateStr || "—", 11) / 2),
      y,
      size: 11,
      font,
      color: VINET_BLACK,
    });
  }
}

async function loadSigImage(pdf, env, sigKey) {
  const bytes = await fetchR2Bytes(env, sigKey);
  if (!bytes) return null;
  try {
    return await pdf.embedPng(bytes);
  } catch {
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

export async function renderDebitPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  const id = String(linkid || "").split("_")[0];
  const profile = await fetchProfileForDisplay(env, id);

  const termsHtml = await fetchTextCached(env.TERMS_DEBIT_URL, env, "terms:debit");
  const paragraphs = paraSplit(termsHtml);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, env); // make it same visual size as MSA
  const sigImg = await loadSigImage(pdf, env, sess?.debit_sig_key);

  const A4 = { w: mm(210), h: mm(297) };
  const margin = mm(18);
  const contentW = A4.w - margin * 2;

  const addPage = () => {
    const p = pdf.addPage([A4.w, A4.h]);
    // header (logo same size as MSA)
    if (logo) {
      const lw = mm(42);
      const lh = (lw * logo.height) / logo.width;
      p.drawImage(logo, { x: margin, y: A4.h - margin - lh, width: lw, height: lh });
    }
    p.drawText("Debit Order Agreement", {
      x: margin,
      y: A4.h - margin - mm(16),
      size: 16,
      font: bold,
      color: VINET_BLACK,
    });
    p.drawLine({
      start: { x: margin, y: A4.h - margin - mm(20) },
      end: { x: A4.w - margin, y: A4.h - margin - mm(20) },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
    return p;
  };

  // Cover with basic details
  let p = addPage();
  let y = A4.h - margin - mm(28);

  const rows = [
    ["Customer", profile.full_name || "—"],
    ["Splynx ID", id],
    ["Passport / ID", profile.passport || "—"],
    ["Email", profile.email || "—"],
    ["Phone", profile.phone || "—"],
    ["Address", [profile.street, profile.city, profile.zip].filter(Boolean).join(", ") || "—"],
    ["Generated (date)", localDateTimePrettyZA(Date.now())],
  ];
  rows.forEach(([k, v]) => {
    p.drawText(`${k}:`, { x: margin, y, size: 10, font: bold, color: VINET_BLACK });
    p.drawText(String(v), { x: margin + mm(40), y, size: 10, font, color: VINET_BLACK });
    y -= mm(7);
  });

  // Terms
  y -= mm(5);
  const bodySize = 10.5;
  const lineGap = 1.25;

  for (let i = 0; i < paragraphs.length; i++) {
    let lines = await getWrappedLinesCached(env, paragraphs[i], font, bodySize, contentW, `debit:p${i}`);
    for (let li = 0; li < lines.length; li++) {
      if (y - bodySize < mm(28)) {
        drawFooterTriplet(p, font, profile.full_name, sigImg, localDateZAISO(Date.now()));
        p = addPage();
        y = A4.h - margin - mm(28);
      }
      p.drawText(lines[li], { x: margin, y, size: bodySize, font, color: VINET_BLACK });
      y -= bodySize * lineGap + 1;
    }
    y -= mm(2);
  }
  drawFooterTriplet(p, font, profile.full_name, sigImg, localDateZAISO(Date.now()));

  // Security Audit page (same rules)
  const sec = addPage();
  let y2 = A4.h - margin - mm(28) - mm(20); // push down ~5 lines
  sec.drawText("Security Audit", { x: margin, y: y2, size: 14, font: bold, color: VINET_BLACK });
  y2 -= mm(8);

  const auth =
    sess?.wa_verified ? "OTP to mobile"
      : sess?.staff_verified ? "Vinet Staff Verification"
      : "Unknown";

  const secRows = [
    ["Agreement code", linkid],
    ["Authentication / Verification", auth],
    ["Client IP", sess?.last_ip || sess?.audit_meta?.ip || "—"],
    ["User agent", sess?.last_ua || sess?.audit_meta?.ua || "—"],
    ["Audit time (ZA)", localDateTimePrettyZA(sess?.audit_meta?.at || Date.now())],
  ];
  secRows.forEach(([k, v]) => {
    sec.drawText(`${k}:`, { x: margin, y: y2, size: 11, font: bold, color: VINET_BLACK });
    sec.drawText(String(v), { x: margin + mm(55), y: y2, size: 11, font, color: VINET_BLACK });
    y2 -= mm(7);
  });
  // no footer on this page

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="debit_${linkid}.pdf"`,
    },
  });
}
