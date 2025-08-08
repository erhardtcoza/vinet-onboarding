// src/index.js
// Vinet Onboarding — modular worker (shell pages + APIs)
// Static assets are served from STATIC_BASE (R2 public site/CDN)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib"; // you added this dep

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------- Config ----------
    const STATIC_BASE =
      env.STATIC_BASE ||
      "https://onboarding-uploads.vinethosting.org/static";
    const API_BASE = env.API_URL || ""; // e.g. https://onboard.vinet.co.za
    const SPLYNX = {
      base: env.SPLYNX_API,
      auth: env.SPLYNX_AUTH, // base64 client_id:secret
    };
    const OTP = {
      wabaPhoneId: env.PHONE_NUMBER_ID,
      token: env.WHATSAPP_TOKEN,
      verifyToken: env.VERIFY_TOKEN,
      businessId: env.BUSINESS_ID,
      templateName: env.WABA_TEMPLATE || "vinetotp",
    };
    const TERMS = {
      serviceUrl:
        env.TERMS_SERVICE_URL ||
        "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt",
      debitUrl:
        env.TERMS_DEBIT_URL ||
        "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt",
      // PDF templates for filled agreements
      msaPdf:
        env.TEMPLATE_MSA_URL ||
        "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf",
      doPdf:
        env.TEMPLATE_DO_URL ||
        "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf",
    };

    // ---------- Helpers ----------
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "";
    async function readJson(req) {
      try {
        return await req.json();
      } catch {
        return {};
      }
    }
    function json(data, init = 200) {
      return new Response(JSON.stringify(data), {
        status: typeof init === "number" ? init : 200,
        headers: { "content-type": "application/json" },
      });
    }
    function htmlShell({ title, entry, props = {} }) {
      const v = Date.now(); // cache-bust
      const boot = {
        apiBase: API_BASE || "",
        staticBase: STATIC_BASE,
        props,
      };
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title || "Vinet")}</title>
<link rel="preload" as="style" href="${STATIC_BASE}/styles.css?v=${v}">
<link rel="stylesheet" href="${STATIC_BASE}/styles.css?v=${v}">
</head>
<body>
  <div id="app" data-entry="${entry}"></div>
  <script>window.__VINET__=${JSON.stringify(boot)};</script>
  <script src="${STATIC_BASE}/${entry}.js?v=${v}" defer></script>
</body>
</html>`,
        { headers: { "content-type": "text/html" } }
      );
    }
    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }
    async function kvGetJson(k) {
      const v = await env.ONBOARD_KV.get(k, "json");
      return v || null;
    }
    async function kvPutJson(k, v, ttlSec) {
      const opts = ttlSec ? { expirationTtl: ttlSec } : {};
      await env.ONBOARD_KV.put(k, JSON.stringify(v), opts);
    }

    // ---------- HTML Shell routes ----------
    if (path === "/" && method === "GET") {
      // Admin dashboard shell
      return htmlShell({
        title: "Vinet Admin",
        entry: "admin",
      });
    }

    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2];
      // validate it exists
      const session = await kvGetJson(`onboard/${linkid}`);
      if (!session) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>Expired</title>
<link rel="stylesheet" href="${STATIC_BASE}/styles.css">
<div class="card"><img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="logo">
<h2 class="err">Invalid or expired link</h2>
<p>Please contact support to request a new onboarding link.</p></div>`,
          { headers: { "content-type": "text/html" } }
        );
      }
      return htmlShell({
        title: "Onboarding",
        entry: "onboard",
        props: { linkid },
      });
    }

    // Info pages — simple shells but driven by onboard.js helpers
    if (path === "/info/eft" && method === "GET") {
      const id = new URL(request.url).searchParams.get("id") || "";
      return htmlShell({
        title: "EFT Payment Details",
        entry: "onboard", // same bundle renders info pages too
        props: { infoPage: "eft", id },
      });
    }
    if (path === "/info/debit" && method === "GET") {
      const id = new URL(request.url).searchParams.get("id") || "";
      return htmlShell({
        title: "Debit Order Instruction",
        entry: "onboard",
        props: { infoPage: "debit", id },
      });
    }

    // ---------- Admin APIs ----------
    // Generate onboarding link
    if (path === "/admin/gen" && method === "POST") {
      const { id } = await readJson(request);
      if (!id) return json({ error: "Missing id" }, 400);
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await kvPutJson(
        `onboard/${linkid}`,
        {
          id: String(id),
          created: Date.now(),
          progress: 0,
          status: "pending", // in-progress
        },
        86400 * 30
      );
      return json({ url: `/onboard/${linkid}` });
    }

    // Generate manual verification code (for staff)
    if (path === "/admin/otp" && method === "POST") {
      const { id } = await readJson(request);
      if (!id) return json({ error: "Missing id" }, 400);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`manual-otp/${id}`, code, { expirationTtl: 900 });
      return json({ ok: true, code });
    }

    // List queues for admin
    if (path === "/admin/list" && method === "POST") {
      const { scope = "pending" } = await readJson(request);
      // We'll keep a lightweight index set in KV for completed/approved
      const key = `index/${scope}`;
      const list = (await kvGetJson(key)) || [];
      // Fetch minimal session preview
      const items = [];
      for (const lk of list.slice(0, 200)) {
        const s = await kvGetJson(`onboard/${lk}`);
        if (s) {
          items.push({
            linkid: lk,
            id: s.id,
            created: s.created,
            method: s.payment_method || "",
            completedAt: s.completedAt || null,
            pdfs: s.pdfs || {},
            uploads: s.uploads || {},
          });
        }
      }
      return json({ items });
    }

    // Approve item -> push to Splynx (deferred)
    if (path === "/admin/approve" && method === "POST") {
      const { linkid } = await readJson(request);
      if (!linkid) return json({ error: "Missing linkid" }, 400);
      const s = await kvGetJson(`onboard/${linkid}`);
      if (!s) return json({ error: "Not found" }, 404);

      // Mark approved; actual push will come later or via another endpoint/cron
      s.status = "approved";
      s.approvedAt = Date.now();
      await kvPutJson(`onboard/${linkid}`, s, 86400 * 30);

      // Update indices
      await indexRemove(env, "completed", linkid);
      await indexAdd(env, "approved", linkid);

      return json({ ok: true });
    }

    // ---------- OTP APIs ----------
    // Send OTP via WhatsApp template or fallback to manual code if available
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await readJson(request);
      if (!linkid) return json({ error: "Missing linkid" }, 400);
      const s = await kvGetJson(`onboard/${linkid}`);
      if (!s) return json({ error: "Invalid session" }, 400);

      // Pull msisdn from Splynx
      const msisdn = await findMsisdnFromSplynx(SPLYNX, s.id);
      if (!msisdn) {
        return json({ ok: false, reason: "no-msisdn" }, 200);
      }

      // generate + store OTP
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });

      // try WA template send
      const ok = await sendWAOtp(OTP, msisdn, code, linkid, API_BASE).catch(
        (e) => {
          console.error("WA send failed", e);
          return false;
        }
      );
      return json({ ok });
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await readJson(request);
      if (!linkid || !otp) return json({ ok: false }, 200);
      const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
      const ok = !!code && code === String(otp).trim();
      return json({ ok }, 200);
    }

    // ---------- Terms ----------
    if (path === "/api/terms/service" && method === "GET") {
      const r = await fetch(TERMS.serviceUrl);
      return new Response(r.body, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/api/terms/debit" && method === "GET") {
      const r = await fetch(TERMS.debitUrl);
      return new Response(r.body, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // ---------- Splynx profile fetch (for confirm step) ----------
    if (path === "/api/splynx/profile" && method === "POST") {
      const { id } = await readJson(request);
      if (!id) return json({ error: "Missing id" }, 400);
      const profile = await getSplynxProfile(SPLYNX, id).catch(() => null);
      return json({ profile });
    }

    // ---------- Session save ----------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const s = await readJson(request);
      const ip = getIP();
      s.last_ip = ip;
      s.last_time = Date.now();
      await kvPutJson(`onboard/${linkid}`, s, 86400 * 30);
      return json({ ok: true });
    }

    // ---------- Uploads (ID / POA) ----------
    // POST /api/upload/:linkid?type=id|poa   body: raw file
    if (path.startsWith("/api/upload/") && method === "POST") {
      const linkid = path.split("/")[3];
      const type = url.searchParams.get("type"); // id or poa
      if (!["id", "poa"].includes(type || "")) {
        return json({ error: "type must be id or poa" }, 400);
      }
      const contentType = request.headers.get("content-type") || "";
      const len = Number(request.headers.get("content-length") || "0");
      if (len > 5 * 1024 * 1024) {
        return json({ error: "File too large (max 5MB)" }, 413);
      }
      if (
        !/pdf|jpeg|jpg|png/i.test(contentType) &&
        !/application\/octet-stream/i.test(contentType)
      ) {
        // still accept but warn
      }
      const buf = await request.arrayBuffer();
      const ext = guessExt(contentType);
      const key = `uploads/${linkid}/${type}${ext}`;
      await env.R2_UPLOADS.put(key, buf, { httpMetadata: { contentType } });

      const s = (await kvGetJson(`onboard/${linkid}`)) || { id: "unknown" };
      s.uploads = s.uploads || {};
      s.uploads[type] = r2PublicUrl(env, key);
      await kvPutJson(`onboard/${linkid}`, s, 86400 * 30);

      return json({ ok: true, url: s.uploads[type] });
    }

    // ---------- Agreement signing -> Generate PDFs ----------
    // POST /api/agreement/sign { linkid, fullName, email, phone, street, city, zip, payment_method, debit?{...}, signaturePng }
    if (path === "/api/agreement/sign" && method === "POST") {
      const body = await readJson(request);
      const {
        linkid,
        fullName,
        email,
        phone,
        street,
        city,
        zip,
        payment_method,
        debit = null,
        signaturePng, // data URL (png)
      } = body || {};
      if (!linkid || !fullName || !email) return json({ error: "Missing" }, 400);

      const s = (await kvGetJson(`onboard/${linkid}`)) || {};
      const stamp = new Date().toISOString();
      const ip = getIP();

      // Build context for PDFs
      const ctx = {
        fullName,
        email,
        phone,
        street,
        city,
        zip,
        customerId: s.id || "",
        when: stamp,
        ip,
      };

      // Generate MSA
      const msaBytes = await fillPdfFromUrl(TERMS.msaPdf, ctx, signaturePng);
      const msaKey = `agreements/${linkid}/MSA.pdf`;
      await env.R2_UPLOADS.put(msaKey, msaBytes, {
        httpMetadata: { contentType: "application/pdf" },
      });

      let doUrl = null;
      if (payment_method === "debit" && debit) {
        const doCtx = { ...ctx, ...debit };
        const doBytes = await fillPdfFromUrl(TERMS.doPdf, doCtx, signaturePng);
        const doKey = `agreements/${linkid}/DO.pdf`;
        await env.R2_UPLOADS.put(doKey, doBytes, {
          httpMetadata: { contentType: "application/pdf" },
        });
        doUrl = r2PublicUrl(env, doKey);
      }

      s.pdfs = {
        msa: r2PublicUrl(env, msaKey),
        do: doUrl,
      };
      s.status = "completed";
      s.completedAt = Date.now();
      await kvPutJson(`onboard/${linkid}`, s, 86400 * 30);

      // update indices
      await indexAdd(env, "completed", linkid);
      await indexRemove(env, "pending", linkid);

      return json({ ok: true, pdfs: s.pdfs });
    }

    // ---------- Standalone Debit page submit ----------
    // POST /api/debit/save  { id, details:{...}, accept:true }
    if (path === "/api/debit/save" && method === "POST") {
      const body = await readJson(request);
      const { id, details, accept } = body || {};
      if (!id || !accept) return json({ error: "Missing" }, 400);

      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_debit_${token}`;
      const s = {
        id: String(id),
        created: Date.now(),
        progress: 5,
        status: "completed",
        payment_method: "debit",
        debit: details || {},
      };

      // optional: generate DO PDF only (no MSA here)
      const sig = null;
      const ctx = {
        fullName: details.holder || "",
        email: details.email || "",
        phone: details.phone || "",
        street: "",
        city: "",
        zip: "",
        customerId: String(id),
        when: new Date().toISOString(),
        ip: getIP(),
        ...details,
      };
      const doBytes = await fillPdfFromUrl(TERMS.doPdf, ctx, sig);
      const doKey = `agreements/${linkid}/DO.pdf`;
      await env.R2_UPLOADS.put(doKey, doBytes, {
        httpMetadata: { contentType: "application/pdf" },
      });
      s.pdfs = { do: r2PublicUrl(env, doKey) };

      await kvPutJson(`onboard/${linkid}`, s, 86400 * 30);
      await indexAdd(env, "completed", linkid);

      return json({ ok: true, linkid, pdfs: s.pdfs });
    }

    // ---------- Fallback ----------
    return new Response("Not found", { status: 404 });

    // ====== Internal fns ======
    async function sendWAOtp(otpCfg, msisdn, code, linkid, apiBase) {
      const url = `https://graph.facebook.com/v20.0/${otpCfg.wabaPhoneId}/messages`;
      // Template with a single body parameter (code).
      // If your template includes a URL button param, add it here as needed.
      const payload = {
        messaging_product: "whatsapp",
        to: msisdn,
        type: "template",
        template: {
          name: otpCfg.templateName,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
          ],
        },
      };
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${otpCfg.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("WA template send failed", r.status, t);
        return false;
      }
      return true;
    }

    async function findMsisdnFromSplynx(cfg, id) {
      try {
        // Try customer, then lead
        const h = { Authorization: `Basic ${cfg.auth}` };
        let r = await fetch(`${cfg.base}/admin/customers/${id}`, { headers: h });
        if (r.ok) {
          const data = await r.json();
          return tidyMsisdn(data?.phone || data?.billing_phone || "");
        }
        r = await fetch(`${cfg.base}/admin/crm/leads/${id}`, { headers: h });
        if (r.ok) {
          const data = await r.json();
          return tidyMsisdn(data?.phone || "");
        }
      } catch {}
      return "";
    }

    async function getSplynxProfile(cfg, id) {
      const h = { Authorization: `Basic ${cfg.auth}` };
      // Prefer customer
      let r = await fetch(`${cfg.base}/admin/customers/${id}`, { headers: h });
      if (r.ok) {
        const c = await r.json();
        return mapProfile(c);
      }
      // fallback lead
      r = await fetch(`${cfg.base}/admin/crm/leads/${id}`, { headers: h });
      if (r.ok) {
        const l = await r.json();
        return mapProfile(l);
      }
      return null;
    }

    function mapProfile(p) {
      return {
        full_name: p?.full_name || p?.name || "",
        email: p?.email || p?.billing_email || "",
        phone: tidyMsisdn(p?.phone || p?.billing_phone || ""),
        street: p?.street || "",
        city: p?.city || "",
        zip: p?.zip_code || p?.zip || "",
      };
    }

    function tidyMsisdn(s) {
      return String(s || "").replace(/[^0-9]/g, "");
    }

    function guessExt(ct) {
      if (/pdf/i.test(ct)) return ".pdf";
      if (/png/i.test(ct)) return ".png";
      if (/jpeg|jpg/i.test(ct)) return ".jpg";
      return "";
    }

    function r2PublicUrl(env, key) {
      // Your R2 is fronted by your vinethosting.org bucket
      return `https://onboarding-uploads.vinethosting.org/${key}`;
    }

    async function indexAdd(env, scope, linkid) {
      const k = `index/${scope}`;
      const arr = (await kvGetJson(k)) || [];
      if (!arr.includes(linkid)) {
        arr.unshift(linkid);
        await kvPutJson(k, arr.slice(0, 1000), 86400 * 60);
      }
    }
    async function indexRemove(env, scope, linkid) {
      const k = `index/${scope}`;
      const arr = (await kvGetJson(k)) || [];
      const nxt = arr.filter((x) => x !== linkid);
      await kvPutJson(k, nxt, 86400 * 60);
    }

    async function fillPdfFromUrl(templateUrl, data, signaturePngDataUrl) {
      const r = await fetch(templateUrl);
      if (!r.ok) throw new Error("Template fetch failed");
      const bytes = await r.arrayBuffer();
      const pdfDoc = await PDFDocument.load(bytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Simple strategy: add a small text layer on first page with key fields.
      // (If you want precise field mapping, send me coordinates.)
      const p1 = pdfDoc.getPage(0);
      const draw = (txt, x, y, size = 10) => {
        p1.drawText(String(txt || ""), { x, y, size, font, color: rgb(0, 0, 0) });
      };

      // Top-left text block (adjust positions as needed for your forms)
      let y = p1.getHeight() - 50;
      const x = 50;
      const line = (k, v) => {
        draw(`${k}: ${v || ""}`, x, y);
        y -= 12;
      };
      line("Name", data.fullName || data.holder || "");
      line("Email", data.email || "");
      line("Phone", data.phone || "");
      line("Street", data.street || "");
      line("City", data.city || "");
      line("ZIP", data.zip || "");
      if (data.customerId) line("Customer ID", data.customerId);
      if (data.bank) line("Bank", data.bank);
      if (data.account_no) line("Account No", data.account_no);
      if (data.branch_code) line("Branch Code", data.branch_code);
      if (data.account_type) line("Account Type", data.account_type);
      if (data.debit_day) line("Debit Day", data.debit_day);
      line("Signed at", data.ip || "");
      line("Signed on", data.when || new Date().toISOString());

      // Signature (if provided)
      if (signaturePngDataUrl && signaturePngDataUrl.startsWith("data:image/png")) {
        const pngBytes = decodeDataUrl(signaturePngDataUrl);
        const png = await pdfDoc.embedPng(pngBytes);
        const sigW = 160;
        const sigH = (png.height / png.width) * sigW;
        p1.drawImage(png, { x: 50, y: 60, width: sigW, height: sigH });
        draw("Authorised Signature", 50, 50);
      }

      return await pdfDoc.save();
    }

    function decodeDataUrl(dataUrl) {
      const b64 = dataUrl.split(",")[1] || "";
      const raw = atob(b64);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
  },
};
