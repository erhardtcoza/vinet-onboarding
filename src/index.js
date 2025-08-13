import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const DEFAULT_MSA_TERMS = "https://www.vinet.co.za/msa/";
const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

// Helper: Get readable date
function nowLocalDate() {
  const now = new Date();
  return now.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Helper: Fetch terms text
async function fetchTextCached(url, env) {
  const cacheKey = `cached-terms-${url}`;
  const cached = await env.ONBOARD_KV.get(cacheKey);
  if (cached) return cached;
  const r = await fetch(url);
  if (!r.ok) return "";
  const text = await r.text();
  await env.ONBOARD_KV.put(cacheKey, text, { expirationTtl: PDF_CACHE_TTL });
  return text;
}

// Helper: Embed logo image
async function embedLogo(pdf) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  try {
    const r = await fetch(LOGO_URL);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const img = await pdf.embedJpg(bytes).catch(() => pdf.embedPng(bytes));
    return img;
  } catch (err) {
    console.warn("Logo embed failed", err);
    return null;
  }
}
// Main: Render MSA PDF
async function renderMSA(env, linkid) {
  const cacheKey = `pdf-msa-${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "public, max-age=86400"
      }
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed || !sess.agreement_sig_key) {
    return new Response("MSA not signed or data missing", { status: 409 });
  }

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsText = await fetchTextCached(DEFAULT_MSA_TERMS, env);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([540, 800]);
  const M = 28;
  let y = 750;

  // Title + Header
  page.drawText("Master Service Agreement", { x: M, y, size: 18, font: bold });
  y -= 28;
  const logo = await embedLogo(pdf);
  if (logo) {
    const scale = logo.scale(1);
    const w = 100;
    const h = (scale.height / scale.width) * w;
    page.drawImage(logo, { x: 540 - M - w, y: 740, width: w, height: h });
  }

  // Client Info Block
  const drawRow = (k, v) => {
    page.drawText(k, { x: M, y, size: 10, font: bold });
    page.drawText(String(v || ""), { x: M + 130, y, size: 10, font });
    y -= 16;
  };
  drawRow("Full Name:", edits.full_name);
  drawRow("Email:", edits.email);
  drawRow("Phone:", edits.phone);
  drawRow("Street:", edits.street);
  drawRow("City:", edits.city);
  drawRow("ZIP:", edits.zip);
  drawRow("ID / Passport:", edits.passport);
  drawRow("Client Code:", idOnly);

  // Terms block
  y -= 10;
  page.drawText("MSA Terms", { x: M, y, size: 13, font: bold });
  y -= 18;

  const wrapText = (text, x, y, width, lineHeight) => {
    const words = text.split(/\s+/);
    let line = "";
    for (const word of words) {
      const testLine = line + word + " ";
      const testWidth = font.widthOfTextAtSize(testLine, 10);
      if (testWidth > width) {
        page.drawText(line.trim(), { x, y, size: 10, font });
        y -= lineHeight;
        line = word + " ";
      } else {
        line = testLine;
      }
    }
    if (line) page.drawText(line.trim(), { x, y, size: 10, font });
    return y;
  };

  y = wrapText(termsText, M, y, 540 - M * 2, 14);

  // Signature
  y -= 20;
  page.drawText("Signature", { x: M, y, size: 10, font: bold });
  const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
  if (sigBytes) {
    const img = await pdf.embedPng(sigBytes);
    const w = 160;
    const h = (img.scale(1).height / img.scale(1).width) * w;
    page.drawImage(img, { x: M + 100, y: y - h + 8, width: w, height: h });
  }

  page.drawText("Date", { x: 540 - M - 60, y, size: 10, font: bold });
  page.drawText(nowLocalDate(), { x: 540 - M - 60, y: y - 16, size: 10, font });

  // Save and cache PDF
  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });

  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store"
    }
  });
}
async function renderDEBIT(env, linkid) {
  const cacheKey = `pdf-debit-${linkid}`;
  const cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
  if (cached) {
    return new Response(cached, {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "public, max-age=86400"
      }
    });
  }

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.debit_sig_key) {
    return new Response("Debit data not signed or missing", { status: 409 });
  }

  const d = sess.debit || {};
  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];
  const termsText = await fetchTextCached(DEFAULT_DEBIT_TERMS, env);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([540, 800]);
  const M = 28;
  let y = 750;

  page.drawText("Debit Order Instruction", { x: M, y, size: 18, font: bold });
  y -= 28;
  const logo = await embedLogo(pdf);
  if (logo) {
    const scale = logo.scale(1);
    const w = 100;
    const h = (scale.height / scale.width) * w;
    page.drawImage(logo, { x: 540 - M - w, y: 740, width: w, height: h });
  }

  const drawRow = (k, v) => {
    page.drawText(k, { x: M, y, size: 10, font: bold });
    page.drawText(String(v || ""), { x: M + 160, y, size: 10, font });
    y -= 16;
  };

  // Info
  drawRow("Full Name:", edits.full_name);
  drawRow("Email:", edits.email);
  drawRow("Phone:", edits.phone);
  drawRow("Street:", edits.street);
  drawRow("City:", edits.city);
  drawRow("ZIP:", edits.zip);
  drawRow("ID / Passport:", edits.passport);
  drawRow("Client Code:", idOnly);
  y -= 10;

  page.drawText("Debit Order Details", { x: M, y, size: 13, font: bold });
  y -= 18;
  drawRow("Bank:", d.bank_name);
  drawRow("Account Number:", d.account_number);
  drawRow("Account Type:", d.account_type);
  drawRow("Debit Day:", d.debit_day);

  // Terms
  y -= 12;
  page.drawText("Terms", { x: M, y, size: 12, font: bold });
  y -= 14;
  const wrapText = (text, x, y, width, lineHeight) => {
    const words = text.split(/\s+/);
    let line = "";
    for (const word of words) {
      const testLine = line + word + " ";
      const testWidth = font.widthOfTextAtSize(testLine, 9);
      if (testWidth > width) {
        page.drawText(line.trim(), { x, y, size: 9, font });
        y -= lineHeight;
        line = word + " ";
      } else {
        line = testLine;
      }
    }
    if (line) page.drawText(line.trim(), { x, y, size: 9, font });
    return y;
  };
  y = wrapText(termsText, M, y, 540 - M * 2, 13);

  y -= 16;
  page.drawText("Signature", { x: M, y, size: 10, font: bold });
  const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
  if (sigBytes) {
    const img = await pdf.embedPng(sigBytes);
    const w = 160;
    const h = (img.scale(1).height / img.scale(1).width) * w;
    page.drawImage(img, { x: M + 100, y: y - h + 8, width: w, height: h });
  }

  page.drawText("Date", { x: 540 - M - 60, y, size: 10, font: bold });
  page.drawText(nowLocalDate(), { x: 540 - M - 60, y: y - 16, size: 10, font });

  const bytes = await pdf.save();
  await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: PDF_CACHE_TTL });

  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store"
    }
  });
}

// ------------------------ PDF HELPERS ------------------------
async function embedLogo(pdf) {
  try {
    const r = await fetch(LOGO_URL, { cf: { cacheTtl: 1800, cacheEverything: true } });
    const bytes = new Uint8Array(await r.arrayBuffer());
    return await pdf.embedJpg(bytes).catch(() => pdf.embedPng(bytes));
  } catch {
    return null;
  }
}

async function fetchTextCached(url, env) {
  const key = `msa-terms-cache-${btoa(url).slice(0, 16)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const text = await (await fetch(url)).text();
    await env.ONBOARD_KV.put(key, text, { expirationTtl: PDF_CACHE_TTL });
    return text;
  } catch {
    return "Terms unavailable.";
  }
}

async function fetchR2Bytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_BUCKET.get(key);
    return obj ? await obj.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// ------------------------ ROUTER HANDLERS ------------------------
router.get("/pdf/msa/:id", async ({ env, params }) => renderMSA(env, params.id));
router.get("/pdf/debit/:id", async ({ env, params }) => renderDEBIT(env, params.id));
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
    },
  });
}

// --------- DRAW WRAPPED PARAGRAPH ---------
function drawWrapped(page, text, x, y, maxWidth, font, size, color, lineHeight) {
  const words = text.split(/\s+/);
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + " ";
    const { width } = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && line !== "") {
      page.drawText(line.trim(), { x, y, size, font, color });
      line = words[i] + " ";
      y -= size * lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) page.drawText(line.trim(), { x, y, size, font, color });
  return y - size * lineHeight;
}

// --------- FETCH TERMS WITH CACHE ---------
async function fetchTextCached(url, cacheKey, env) {
  const cached = await env.ONBOARD_KV.get(cacheKey);
  if (cached) return cached;

  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const text = await r.text();
    await env.ONBOARD_KV.put(cacheKey, text, { expirationTtl: 7 * 24 * 3600 });
    return text;
  } catch (err) {
    return null;
  }
}

// --------- FETCH IMAGE FROM R2 ---------
async function fetchR2Bytes(env, key) {
  if (!key || !env.R2_BUCKET) return null;
  const obj = await env.R2_BUCKET.get(key);
  if (!obj) return null;
  return await obj.arrayBuffer();
}

// --------- UTIL: Local date/time ---------
function nowLocalDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
// --------- HANDLER: MSA PDF ---------
async function handleMsaPdf(request, env, ctx, linkid) {
  try {
    const cacheKey = `msa_pdf_${linkid}`;
    let cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
    if (cached) {
      return new Response(cached, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    const response = await renderMSA(env, linkid);
    if (response.status === 200) {
      const bytes = await response.arrayBuffer();
      await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 604800 }); // 7 days
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    return response;
  } catch (err) {
    return new Response("PDF render failed", { status: 500 });
  }
}

// --------- HANDLER: DEBIT PDF ---------
async function handleDebitPdf(request, env, ctx, linkid) {
  try {
    const cacheKey = `debit_pdf_${linkid}`;
    let cached = await env.ONBOARD_KV.get(cacheKey, "arrayBuffer");
    if (cached) {
      return new Response(cached, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    const response = await renderDEBIT(env, linkid);
    if (response.status === 200) {
      const bytes = await response.arrayBuffer();
      await env.ONBOARD_KV.put(cacheKey, bytes, { expirationTtl: 604800 }); // 7 days
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    return response;
  } catch (err) {
    return new Response("PDF render failed", { status: 500 });
  }
}

// --------- MAIN FETCH HANDLER ---------
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // PDF endpoints
    if (pathname.startsWith("/pdf/msa/")) {
      const linkid = pathname.split("/").pop();
      return await handleMsaPdf(request, env, ctx, linkid);
    }

    if (pathname.startsWith("/pdf/debit/")) {
      const linkid = pathname.split("/").pop();
      return await handleDebitPdf(request, env, ctx, linkid);
    }

    // TODO: Admin routes, dashboard, file download, onboarding etc.
    // (If you're ready, we continue into the next part now)
    
    return new Response("Not found", { status: 404 });
  }
};
// ---------- UTILITY: Auth check ----------
function isAdmin(req) {
  const cookie = req.headers.get("Cookie") || "";
  return cookie.includes("admin_auth=vinet");
}

// ---------- API ROUTES ----------
async function handleAdminRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Admin: dashboard data (lead entries)
  if (path === "/api/admin/leads" && method === "GET") {
    if (!isAdmin(request)) return new Response("Unauthorized", { status: 401 });

    const rows = await env.DB.prepare("SELECT * FROM leads ORDER BY created DESC LIMIT 500").all();
    return new Response(JSON.stringify(rows.results), {
      headers: { "content-type": "application/json" },
    });
  }

  // Admin: delete entry
  if (path.startsWith("/api/admin/delete") && method === "POST") {
    if (!isAdmin(request)) return new Response("Unauthorized", { status: 401 });

    const { id, kv_key, r2_key } = await request.json();

    if (id) {
      await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run().catch(() => {});
    }

    if (kv_key) {
      await env.ONBOARD_KV.delete(kv_key).catch(() => {});
    }

    if (r2_key && env.R2_BUCKET) {
      await env.R2_BUCKET.delete(r2_key).catch(() => {});
    }

    return new Response("Deleted", { status: 200 });
  }

  // Admin: file download
  if (path.startsWith("/api/admin/file") && method === "GET") {
    if (!isAdmin(request)) return new Response("Unauthorized", { status: 401 });

    const key = url.searchParams.get("key");
    if (!key || !env.R2_BUCKET) return new Response("Missing key", { status: 400 });

    const object = await env.R2_BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404 });

    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "content-disposition": `inline; filename="${key.split("/").pop()}"`,
      },
    });
  }

  return new Response("Not found", { status: 404 });
}
// ---------- STATIC ROUTES ----------
async function serveStaticPage(path, env) {
  if (path === "/dashboard" || path === "/admin") {
    const html = await env.ONBOARD_KV.get(path === "/dashboard" ? "dashboard.html" : "admin.html");
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Admin JS
  if (path === "/static/admin.js") {
    const js = await env.ONBOARD_KV.get("admin.js");
    return new Response(js, {
      headers: { "content-type": "application/javascript" },
    });
  }

  return null;
}

// ---------- WORKER ENTRY ----------
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Static pages (admin, dashboard)
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin") || pathname.startsWith("/static/")) {
      const resp = await serveStaticPage(pathname, env);
      if (resp) return resp;
    }

    // Admin API endpoints
    if (pathname.startsWith("/api/admin/")) {
      return await handleAdminRoutes(request, env, ctx);
    }

    // Onboarding flow
    if (pathname === "/" || pathname.startsWith("/step")) {
      return await handleOnboardingFlow(request, env, ctx);
    }

    // Submit, sync, delete
    if (pathname === "/submit" || pathname === "/sync") {
      return await handleSubmission(request, env, ctx);
    }

    // PDF generation
    if (pathname.startsWith("/pdf/msa")) {
      return await renderMSA(env, pathname.split("/pdf/msa/")[1]);
    }

    if (pathname.startsWith("/pdf/debit")) {
      return await renderDEBIT(env, pathname.split("/pdf/debit/")[1]);
    }

    return new Response("Not found", { status: 404 });
  },
};
