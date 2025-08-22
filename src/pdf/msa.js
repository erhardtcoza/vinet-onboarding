// src/pdf/msa.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  embedLogo,
  fetchTextCached,
  getWrappedLinesCached,
  fetchR2Bytes,
  localDateZAISO,
  localDateTimePrettyZA,
} from "../helpers.js";
import { VINET_BLACK, LOGO_URL } from "../constants.js";
import { fetchProfileForDisplay } from "../splynx.js";

/** Small utilities */
const mm = (n) => (n * 72) / 25.4;

function paraSplit(txt) {
  // Split on blank lines; keep simple Windows/mac line endings robustly
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
  const y = mm(15); // footer baseline
  const colW = (width - margin * 2) / 3;
  const centerX = (i) => margin + colW * (i + 0.5);

  // labels
  const labelSize = 9;
  const valueSize = 11;

  // 0: Full name
  {
    const cx = centerX(0);
    page.drawText("Full name", { x: cx - 28, y: y + 18, size: labelSize, font, color: VINET_BLACK });
    page.drawText(name || "—", {
      x: cx - (font.widthOfTextAtSize(name || "—", valueSize) / 2),
      y,
      size: valueSize,
      font,
      color: VINET_BLACK,
    });
  }

  // 1: Signature (image if present, else dash)
  {
    const cx = centerX(1);
    page.drawText("Signature", { x: cx - 28, y: y + 18, size: labelSize, font, color: VINET_BLACK });
    if (sigImg) {
      const w = mm(32);
      const h = (w * sigImg.height) / sigImg.width;
      page.drawImage(sigImg, { x: cx - w / 2, y: y - 2, width: w, height: h, opacity: 0.9 });
    } else {
      page.drawText("—", { x: cx - 3, y, size: valueSize, font, color: VINET_BLACK });
    }
  }

  // 2: Date
  {
    const cx = centerX(2);
    page.drawText("Date", { x: cx - 12, y: y + 18, size: labelSize, font, color: VINET_BLACK });
    page.drawText(dateStr || "—", {
      x: cx - (font.widthOfTextAtSize(dateStr || "—", valueSize) / 2),
      y,
      size: valueSize,
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

export async function renderMSAPdf(env, linkid) {
  // ---- Load session + profile + terms
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  const id = String(linkid || "").split("_")[0];
  const profile = await fetchProfileForDisplay(env, id);

  const termsHtml = await fetchTextCached(env.TERMS_SERVICE_URL, env, "terms:msa");
  const paragraphs = paraSplit(termsHtml);

  // ---- PDF init
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, env);
  const sigImg = await loadSigImage(pdf, env, sess?.agreement_sig_key);
  const generated = localDateTimePrettyZA(Date.now());

  // ---- Common measurements
  const A4 = { w: mm(210), h: mm(297) };
  const margin = mm(18);
  const contentW = A4.w - margin * 2;

  // ---- Page helper
  let pageIndex = 0;
  const pages = [];
  const addPage = () => {
    const p = pdf.addPage([A4.w, A4.h]);
    pages.push(p);
    pageIndex = pages.length - 1;
    // header
    if (logo) {
      const lw = mm(42);
      const lh = (lw * logo.height) / logo.width;
      p.drawImage(logo, { x: margin, y: A4.h - margin - lh, width: lw, height: lh });
    }
    p.drawText("Master Service Agreement", {
      x: margin,
      y: A4.h - margin - mm(16),
      size: 16,
      font: bold,
      color: VINET_BLACK,
    });
    // top rule
    p.drawLine({
      start: { x: margin, y: A4.h - margin - mm(20) },
      end: { x: A4.w - margin, y: A4.h - margin - mm(20) },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });
    return p;
  };

  // ---- Page 1 (cover with key fields)
  let p = addPage();
  let cursorY = A4.h - margin - mm(28);

  // Two-column overview (left company, right customer + meta)
  const colGap = mm(10);
  const colW = (contentW - colGap) / 2;

  // Right column info block
  const rightX = margin + colW + colGap;

  const rightLines = [
    ["Customer", profile.full_name || "—"],
    ["Splynx ID", id],
    ["Passport / ID", profile.passport || "—"],
    ["Email", profile.email || "—"],
    ["Phone", profile.phone || "—"],
    ["Address", [profile.street, profile.city, profile.zip].filter(Boolean).join(", ") || "—"],
    ["Payment method", (sess?.pay_method === "debit" ? "Debit Order" : "Cash/EFT")],
    ["Generated (date)", generated],
  ];

  let yInfo = cursorY;
  rightLines.forEach(([k, v]) => {
    p.drawText(`${k}:`, { x: rightX, y: yInfo, size: 10, font: bold, color: VINET_BLACK });
    const vs = String(v);
    p.drawText(vs, {
      x: rightX + mm(35),
      y: yInfo,
      size: 10,
      font,
      color: VINET_BLACK,
    });
    yInfo -= mm(7);
  });

  // Move cursor to start of terms below
  cursorY = yInfo - mm(6);

  // ---- Terms flow (paragraphs, word wrap)
  const bodySize = 10.5;
  const lineGap = 1.25; // requested slight increase
  const usableHeight = cursorY - mm(22); // keep room for footer

  for (let i = 0; i < paragraphs.length; i++) {
    let text = paragraphs[i];
    let lines = await getWrappedLinesCached(env, text, font, bodySize, contentW, `msa:p${i}`);

    // paginate
    for (let li = 0; li < lines.length; li++) {
      if (cursorY - bodySize < mm(28)) {
        // footer (skip on Security Audit page only, which comes later)
        drawFooterTriplet(p, font, profile.full_name, sigImg, localDateZAISO(Date.now()));
        // new page
        p = addPage();
        cursorY = A4.h - margin - mm(28);
      }
      p.drawText(lines[li], { x: margin, y: cursorY, size: bodySize, font, color: VINET_BLACK });
      cursorY -= bodySize * lineGap + 1;
    }
    cursorY -= mm(2); // paragraph gap
  }

  // Finalize page with footer
  drawFooterTriplet(p, font, profile.full_name, sigImg, localDateZAISO(Date.now()));

  // ---- Security Audit page
  const sec = addPage();
  let ySec = A4.h - margin - mm(28);

  // push heading down “about 5 lines”
  ySec -= mm(5 * 4); // ~20mm
  sec.drawText("Security Audit", { x: margin, y: ySec, size: 14, font: bold, color: VINET_BLACK });
  ySec -= mm(8);

  // Details required above client IP
  const auth =
    sess?.wa_verified ? "OTP to mobile"
      : sess?.staff_verified ? "Vinet Staff Verification"
      : "Unknown";

  const secLines = [
    ["Agreement code", linkid],
    ["Authentication / Verification", auth],
    ["Client IP", sess?.last_ip || sess?.audit_meta?.ip || "—"],
    ["User agent", sess?.last_ua || sess?.audit_meta?.ua || "—"],
    ["Audit time (ZA)", localDateTimePrettyZA(sess?.audit_meta?.at || Date.now())],
  ];

  secLines.forEach(([k, v]) => {
    sec.drawText(`${k}:`, { x: margin, y: ySec, size: 11, font: bold, color: VINET_BLACK });
    sec.drawText(String(v), { x: margin + mm(55), y: ySec, size: 11, font, color: VINET_BLACK });
    ySec -= mm(7);
  });

  // (No footer on security page as requested)

  // ---- Return response
  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="msa_${linkid}.pdf"`,
    },
  });
}
