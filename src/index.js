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
// Agreement pages (HTML printable -> browser "Save as PDF")
if (path.startsWith("/agreements/") && method === "GET") {
  const [, , type, linkid] = path.split("/");
  if (!type || !linkid) return new Response("Bad request", { status: 400 });

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) {
    return new Response("Agreement not available yet.", { status: 404 });
  }

  // fetch & escape terms (server-side)
  async function fetchTerms(kind) {
    const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
    const debUrl = env.TERMS_DEBIT_URL   || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
    const url = kind === "debit" ? debUrl : svcUrl;
    try {
      const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
      const t = r.ok ? await r.text() : "";
      return escapeHtml(t || "Terms unavailable.");
    } catch {
      return "Terms unavailable.";
    }
  }

  const e = sess.edits || {};
  const today = new Date().toLocaleDateString();
  const name  = escapeHtml(e.full_name||'');
  const email = escapeHtml(e.email||'');
  const phone = escapeHtml(e.phone||'');
  const street= escapeHtml(e.street||'');
  const city  = escapeHtml(e.city||'');
  const zip   = escapeHtml(e.zip||'');
  const passport = escapeHtml(e.passport||'');
  const debit = sess.debit || null;

  function page(title, body){ return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
    .card{background:#fff;max-width:820px;margin:24px auto;border-radius:14px;box-shadow:0 2px 12px #0002;padding:22px 26px}
    h1{color:#e2001a;margin:.2em 0 .3em;font-size:28px}.b{font-weight:600}
    table{width:100%;border-collapse:collapse;margin:.6em 0}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
    .muted{color:#666;font-size:12px}.sig{margin-top:14px}.sig img{max-height:120px;border:1px dashed #bbb;border-radius:6px;background:#fff}
    .actions{margin-top:14px}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
    .logo{height:60px;display:block;margin:0 auto 10px}
    .terms{white-space:pre-wrap;border:1px solid #eee;border-radius:8px;background:#fafafa;padding:12px;margin-top:8px}
    @media print {.actions{display:none}}
  </style></head><body><div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>${escapeHtml(title)}</h1>
    ${body}
    <div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
    <div class="muted">Generated ${today} • Link ${escapeHtml(linkid)}</div>
  </div></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});}

  if (type === "msa") {
    let body = `
      <p>This document represents your Master Service Agreement with Vinet Internet Solutions.</p>
      <table>
        <tr><th class="b">Customer</th><td>${name}</td></tr>
        <tr><th class="b">Email</th><td>${email}</td></tr>
        <tr><th class="b">Phone</th><td>${phone}</td></tr>
        <tr><th class="b">ID / Passport</th><td>${passport}</td></tr>
        <tr><th class="b">Address</th><td>${street}, ${city}, ${zip}</td></tr>
        <tr><th class="b">Date</th><td>${today}</td></tr>
      </table>
      <div class="sig"><div class="b">Signature</div>
        <img src="/agreements/sig/${linkid}.png" alt="signature">
      </div>`;

    const terms = await fetchTerms("service");
    body += `
      <h2 style="margin-top:16px;">Terms & Conditions</h2>
      <div class="terms">${terms}</div>`;

    return page("Master Service Agreement", body);
  }

  if (type === "debit") {
    const hasDebit = !!(debit && debit.account_holder && debit.account_number);
    const debitHtml = hasDebit ? `
      <table>
        <tr><th class="b">Account Holder</th><td>${escapeHtml(debit.account_holder||'')}</td></tr>
        <tr><th class="b">ID Number</th><td>${escapeHtml(debit.id_number||'')}</td></tr>
        <tr><th class="b">Bank</th><td>${escapeHtml(debit.bank_name||'')}</td></tr>
        <tr><th class="b">Account No</th><td>${escapeHtml(debit.account_number||'')}</td></tr>
        <tr><th class="b">Account Type</th><td>${escapeHtml(debit.account_type||'')}</td></tr>
        <tr><th class="b">Debit Day</th><td>${escapeHtml(debit.debit_day||'')}</td></tr>
      </table>` : `<p class="muted">No debit order details on file for this onboarding.</p>`;

    let body = `
      <p>This document represents your Debit Order Instruction.</p>
      ${debitHtml}
      <div class="sig"><div class="b">Signature</div>
        <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
      </div>`;

    const terms = await fetchTerms("debit");
    body += `
      <h2 style="margin-top:16px;">Debit Order Terms</h2>
      <div class="terms">${terms}</div>`;

    return page("Debit Order Agreement", body);
  }

  return new Response("Unknown agreement type", { status: 404 });
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
