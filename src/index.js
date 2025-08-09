Thanks for the quick turnaround. Here’s a **full updated `index.js`** with the fixes applied:

* Staff code endpoint no longer reads a body (fixes “Failed”).
* WhatsApp OTP **auto-sends** when the OTP step appears; only **Resend** is shown.
* Broader Splynx phone mapping so OTP finds the mobile number.
* Admin UI kept as your preferred 2-top / 2-bottom layout.
* Everything else from the merged build remains (Pending list actions, centered “Print banking details”, Debit signature pad, uploads, instant PDFs, delete cleans R2).

Paste this over your Worker:

```js
// index.js — Vinet Onboarding (merged A+B, hotfixes applied)
// - Admin: two-top / two-bottom layout, Pending list with Review + Delete
// - Client: OTP (auto WhatsApp or staff code) → Payment (EFT / Debit + signature) → Details → Uploads → MSA + signature → Completed
// - PDFs (msa.pdf, do.pdf) written to R2 immediately upon signing
// - EFT: removed "View EFT page", centered "Print banking details"
// - Delete also removes R2 agreement files

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname, searchParams } = url;

      const api = makeApi(env);

      if (request.method === "OPTIONS") {
        return withCORS(new Response(null, { status: 204 }));
      }

      // Admin UI
      if (request.method === "GET" && pathname === "/") {
        return htmlResponse(adminPage());
      }

      // Onboarding UI
      if (request.method === "GET" && pathname.startsWith("/onboard/")) {
        const linkId = pathname.split("/").pop();
        if (!linkId) return notFound();
        return htmlResponse(onboardPage(linkId));
      }

      // Printable EFT info page
      if (request.method === "GET" && pathname === "/info/eft") {
        const id = searchParams.get("id") || "";
        return htmlResponse(printableEftPage(id));
      }

      // Serve PDFs & assets from R2
      if (request.method === "GET" && pathname.startsWith("/agreements/")) {
        return api.serveAgreementFile(pathname);
      }

      // ---------- Admin APIs ----------
      if (pathname === "/api/admin/create_link" && request.method === "POST") {
        return withCORS(await api.createLink(await request.json()));
      }
      if (pathname === "/api/admin/list" && request.method === "GET") {
        return withCORS(await api.listLinks(searchParams.get("status")));
      }
      if (pathname === "/api/admin/staff_code" && request.method === "POST") {
        // no body required
        return withCORS(await api.createStaffCode({}));
      }
      if (pathname === "/api/admin/delete" && request.method === "POST") {
        return withCORS(await api.deleteLink(await request.json()));
      }

      // ---------- Client APIs ----------
      if (pathname === "/api/session" && request.method === "GET") {
        return withCORS(await api.getSession(searchParams.get("id")));
      }
      if (pathname === "/api/send-otp" && request.method === "POST") {
        return withCORS(await api.sendOtp(await request.json()));
      }
      if (pathname === "/api/verify-otp" && request.method === "POST") {
        return withCORS(await api.verifyOtp(await request.json()));
      }
      if (pathname === "/api/verify-staff" && request.method === "POST") {
        return withCORS(await api.verifyStaff(await request.json()));
      }
      if (pathname === "/api/save-payment" && request.method === "POST") {
        return withCORS(await api.savePayment(await request.json()));
      }
      if (pathname === "/api/save-debit-signature" && request.method === "POST") {
        return withCORS(await api.saveDebitSignature(await request.json()));
      }
      if (pathname === "/api/save-details" && request.method === "POST") {
        return withCORS(await api.saveDetails(await request.json()));
      }
      if (pathname === "/api/upload" && request.method === "POST") {
        return withCORS(await api.uploadFiles(request));
      }
      if (pathname === "/api/sign-msa" && request.method === "POST") {
        return withCORS(await api.signMsa(await request.json()));
      }
      if (pathname === "/api/complete" && request.method === "POST") {
        return withCORS(await api.complete(await request.json()));
      }

      return notFound();
    } catch (err) {
      console.error("Unhandled error:", err);
      return withCORS(
        new Response(JSON.stringify({ ok: false, error: "Server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};

// ---------- Helpers ----------

function withCORS(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "*");
  return resp;
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const htmlResponse = (html) =>
  new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const notFound = () => new Response("Not found", { status: 404 });

function randSlug(len = 8) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  crypto.getRandomValues(new Uint8Array(len)).forEach((v) => (out += alphabet[v % alphabet.length]));
  return out;
}
const now = () => Date.now();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ---------- API core (uses env) ----------

function makeApi(env) {
  const KV = env.ONBOARD_KV || env.LEAD_KV || env.SESSION_KV;
  if (!KV) console.warn("⚠️ No KV bound (ONBOARD_KV/LEAD_KV/SESSION_KV).");
  const R2 = env.R2_BUCKET || env.R2 || env.UPLOADS;
  if (!R2) console.warn("⚠️ No R2 bound (R2_BUCKET/R2/UPLOADS).");

  const R2_PUBLIC_BASE = env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";
  const SPLYNX_URL = (env.SPLYNX_URL || "").replace(/\/$/, "");
  const SPLYNX_AUTH = env.SPLYNX_AUTH || "";
  const WAPP = {
    phoneId: env.PHONE_NUMBER_ID || "",
    token: env.WHATSAPP_TOKEN || "",
  };

  const prefixes = {
    ob: "ob:", // sessions by linkId
    otp: "otp:", // otp by linkId
    staff: "staff:", // staff code
  };

  async function getClientFromSplynx(id) {
    if (!SPLYNX_URL || !SPLYNX_AUTH) return null;
    const headers = { Authorization: `Basic ${SPLYNX_AUTH}` };
    const tryEndpoints = [
      `${SPLYNX_URL}/api/2.0/admin/crm/leads/${id}`,
      `${SPLYNX_URL}/api/2.0/admin/customers/customer/${id}`,
    ];
    for (const u of tryEndpoints) {
      try {
        const r = await fetch(u, { headers });
        if (r.ok) {
          const data = await r.json();
          const name =
            data?.full_name || [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "";
          const email = data?.email || data?.billing_email || "";
          const phone = (
            data?.phone ||
            data?.phone1 ||
            data?.phone_1 ||
            data?.mobile ||
            data?.mobile_phone ||
            data?.cell ||
            data?.contact_phone ||
            data?.contacts?.mobile ||
            data?.contacts?.phone ||
            ""
          )
            .toString()
            .replace(/[^\d]/g, "");
          const addr = {
            street: data?.street || data?.address1 || "",
            city: data?.city || data?.town || "",
            zip: data?.zip || data?.zip_code || "",
          };
          return { name, email, phone, address: addr, kind: u.includes("/leads/") ? "lead" : "customer" };
        }
      } catch (_) {}
    }
    return null;
  }

  async function putSession(s) {
    s.updated = now();
    await KV.put(prefixes.ob + s.linkId, JSON.stringify(s));
    return s;
  }
  async function getSessionById(linkId) {
    const raw = await KV.get(prefixes.ob + linkId);
    return raw ? JSON.parse(raw) : null;
  }
  async function listSessions() {
    const out = [];
    let cursor;
    do {
      const page = await KV.list({ prefix: prefixes.ob, cursor });
      for (const k of page.keys) {
        const raw = await KV.get(k.name);
        if (raw) out.push(JSON.parse(raw));
      }
      cursor = page.cursor;
    } while (cursor);
    return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  // WhatsApp OTP
  async function sendWhatsApp(to, body) {
    if (!WAPP.phoneId || !WAPP.token) return false;
    const url = `https://graph.facebook.com/v17.0/${WAPP.phoneId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WAPP.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return r.ok;
  }

  // Minimal PDF generator
  function generateSimplePdf({ title, lines }) {
    const esc = (s) => s.replace(/([()\\])/g, "\\$1");
    const content = [
      `%PDF-1.4`,
      `1 0 obj<<>>endobj`,
      `2 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj`,
      `3 0 obj<< /Type /Page /Parent 4 0 R /Resources << /Font << /F1 2 0 R >> >> /MediaBox [0 0 595 842] /Contents 5 0 R>>endobj`,
      `4 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj`,
      `5 0 obj<< /Length 6 0 R >>stream`,
      `BT /F1 16 Tf 60 780 Td (${esc(title)}) Tj`,
      ...lines.map((ln) => `0 -22 Td (${esc(ln)}) Tj`),
      `ET`,
      `endstream`,
      `endobj`,
      `6 0 obj 0 endobj`,
      `xref`,
      `0 7`,
      `0000000000 65535 f `,
      `0000000010 00000 n `,
      `0000000051 00000 n `,
      `0000000117 00000 n `,
      `0000000280 00000 n `,
      `0000000000 00000 n `,
      `0000000000 00000 n `,
      `trailer<< /Root 7 0 R /Size 7 >>`,
      `7 0 obj<< /Type /Catalog /Pages 4 0 R >>endobj`,
      `startxref`,
      `472`,
      `%%EOF`,
    ].join("\n");
    return new Blob([content], { type: "application/pdf" });
  }

  // R2 helpers
  async function r2Put(path, body, type) {
    await R2.put(path, body, { httpMetadata: { contentType: type } });
    return `${R2_PUBLIC_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  }
  async function r2Serve(path) {
    const obj = await R2.get(path.slice(1)); // strip leading '/'
    if (!obj) return notFound();
    return new Response(obj.body, {
      headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream" },
    });
  }
  async function r2DeletePrefix(prefix) {
    let cursor;
    do {
      const res = await R2.list({ prefix, cursor });
      for (const o of res.objects) await R2.delete(o.key);
      cursor = res.truncated ? res.cursor : null;
    } while (cursor);
  }

  return {
    serveAgreementFile: (pathname) => r2Serve(pathname),

    // Admin
    createLink: async ({ id }) => {
      id = String(id || "").trim();
      if (!id) return json({ ok: false, error: "Missing id" }, 400);

      const client = await getClientFromSplynx(id);

      const linkId = `${id}_${randSlug(8)}`;
      const rec = {
        linkId,
        splynxId: id,
        status: "inprogress",
        created: now(),
        updated: now(),
        otpVerifiedAt: 0,
        msaSignedAt: 0,
        doSignedAt: 0,
        client: client || {},
        payment: { method: "eft" },
        uploads: [],
      };
      await putSession(rec);
      const link = `${new URL("/", "https://onboard.vinet.co.za").origin}/onboard/${linkId}`;
      return json({ ok: true, link, linkId });
    },

    listLinks: async (status) => {
      const list = await listSessions();
      const filtered = status
        ? list.filter((x) => {
            if (status === "inprogress") return x.status === "inprogress";
            if (status === "completed") return x.status === "completed";
            if (status === "approved") return x.status === "approved";
            return true;
          })
        : list;
      return json({
        ok: true,
        rows: filtered.map((x) => ({
          splynxId: x.splynxId,
          linkId: x.linkId,
          updated: x.updated,
          status: x.status,
        })),
      });
    },

    createStaffCode: async ({ minutes = 10 }) => {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const ttl = clamp(Number(minutes) || 10, 1, 60) * 60;
      await KV.put(prefixes.staff + code, JSON.stringify({ code, created: now() }), {
        expirationTtl: ttl,
      });
      return json({ ok: true, code, expires_in: ttl });
    },

    deleteLink: async ({ linkId }) => {
      if (!linkId) return json({ ok: false, error: "Missing linkId" }, 400);
      await KV.delete(prefixes.ob + linkId);
      await KV.delete(prefixes.otp + linkId);
      await r2DeletePrefix(`agreements/${linkId}/`);
      return json({ ok: true });
    },

    // Client session
    getSession: async (id) => {
      const s = await getSessionById(id);
      if (!s) return json({ ok: false, error: "Not found" }, 404);
      return json({ ok: true, session: s, r2: R2_PUBLIC_BASE });
    },

    // OTP
    sendOtp: async ({ linkId }) => {
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session not found" }, 404);
      const client = s.client || (await getClientFromSplynx(s.splynxId)) || {};
      // prefer WhatsApp/phone
      const to = (client.phone || "").replace(/[^\d]/g, "");
      if (!to || to.length < 8) return json({ ok: false, error: "No mobile number on file" }, 400);

      const metaRaw = await KV.get(prefixes.otp + linkId);
      let meta = metaRaw ? JSON.parse(metaRaw) : { attempts: 0, last: 0, code: "" };
      const nowMs = now();
      if (meta.last && nowMs - meta.last < 60 * 1000) {
        return json({ ok: false, error: "Please wait before resending" }, 429);
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      meta = { code, last: nowMs, attempts: 0, exp: nowMs + 10 * 60 * 1000 };
      await KV.put(prefixes.otp + linkId, JSON.stringify(meta), { expirationTtl: 11 * 60 });

      const name = client.name ? `Hi ${client.name.split(" ")[0]}, ` : "";
      const sent = await sendWhatsApp(
        to,
        `${name}your Vinet verification code is: ${code}\n\nThis code expires in 10 minutes.`
      );
      if (!sent) return json({ ok: false, error: "Failed to send WhatsApp" }, 500);
      return json({ ok: true });
    },

    verifyOtp: async ({ linkId, code }) => {
      const metaRaw = await KV.get(prefixes.otp + linkId);
      if (!metaRaw) return json({ ok: false, error: "No code sent yet" }, 400);
      const meta = JSON.parse(metaRaw);
      const nowMs = now();
      if (nowMs > meta.exp) return json({ ok: false, error: "Code expired" }, 400);
      meta.attempts = (meta.attempts || 0) + 1;
      if (meta.attempts > 5) {
        await KV.delete(prefixes.otp + linkId);
        return json({ ok: false, error: "Too many attempts" }, 429);
      }
      if (String(code).trim() !== String(meta.code)) {
        await KV.put(prefixes.otp + linkId, JSON.stringify(meta), { expirationTtl: 10 * 60 });
        return json({ ok: false, error: "Incorrect code" }, 400);
      }
      await KV.delete(prefixes.otp + linkId);
      const s = await getSessionById(linkId);
      s.otpVerifiedAt = now();
      await putSession(s);
      return json({ ok: true });
    },

    verifyStaff: async ({ linkId, code }) => {
      const raw = await KV.get(prefixes.staff + String(code || "").trim());
      if (!raw) return json({ ok: false, error: "Invalid or expired code" }, 400);
      await KV.delete(prefixes.staff + String(code || "").trim());
      const s = await getSessionById(linkId);
      s.otpVerifiedAt = now();
      await putSession(s);
      return json({ ok: true });
    },

    // Payment & signatures
    savePayment: async ({ linkId, method, eft }) => {
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);
      s.payment = s.payment || {};
      s.payment.method = method || "eft";
      if (method === "eft") {
        s.payment.eft = {
          bank: eft?.bank || "First National Bank (FNB/RMB)",
          account_name: eft?.account_name || "Vinet Internet Solutions",
          account_number: eft?.account_number || "62757054996",
          branch_code: eft?.branch_code || "250655",
          reference: s.splynxId,
        };
      }
      await putSession(s);
      return json({ ok: true });
    },

    saveDebitSignature: async ({ linkId, holder_name, holder_id, bank, account_no, account_type, debit_day, agree, signatureDataURL }) => {
      if (!agree) return json({ ok: false, error: "Please accept the terms" }, 400);
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);
      s.payment = s.payment || {};
      s.payment.method = "debit";
      s.payment.debit = {
        holder_name,
        holder_id,
        bank,
        account_no,
        account_type,
        debit_day,
        agreedAt: now(),
      };
      if (signatureDataURL && R2) {
        const png = dataUrlToBlob(signatureDataURL);
        await r2Put(`agreements/${linkId}/debit_signature.png`, png, "image/png");
      }
      s.doSignedAt = now();
      await putSession(s);

      const pdf = generateSimplePdf({
        title: "Debit Order Agreement",
        lines: [
          `Name: ${holder_name || ""}`,
          `ID/Passport: ${holder_id || ""}`,
          `Bank: ${bank || ""}`,
          `Account: ${account_no || ""} (${account_type || ""})`,
          `Debit Day: ${debit_day || ""}`,
          `Signed: ${new Date(s.doSignedAt).toLocaleString()}`,
        ],
      });
      await r2Put(`agreements/${linkId}/do.pdf`, pdf, "application/pdf");

      return json({ ok: true });
    },

    // Personal details
    saveDetails: async ({ linkId, name, idno, email, phone, street, city, zip }) => {
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);
      s.client = {
        ...(s.client || {}),
        name: name || s.client?.name || "",
        email: email || s.client?.email || "",
        phone: phone || s.client?.phone || "",
        address: {
          street: street || s.client?.address?.street || "",
          city: city || s.client?.address?.city || "",
          zip: zip || s.client?.address?.zip || "",
        },
        idno: idno || s.client?.idno || "",
      };
      await putSession(s);
      return json({ ok: true });
    },

    // Uploads
    uploadFiles: async (request) => {
      const url = new URL(request.url);
      const linkId = url.searchParams.get("id");
      if (!linkId) return json({ ok: false, error: "Missing id" }, 400);

      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.startsWith("multipart/form-data")) {
        return json({ ok: false, error: "Expected multipart/form-data" }, 400);
      }
      const form = await request.formData();
      const files = ["file1", "file2"]
        .map((k) => form.get(k))
        .filter((f) => f && typeof f === "object");

      if (!files.length) return json({ ok: false, error: "No files" }, 400);
      if (files.length > 2) return json({ ok: false, error: "Max 2 files" }, 400);

      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);

      s.uploads = s.uploads || [];
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) return json({ ok: false, error: "Max 5MB per file" }, 400);
        const key = `agreements/${linkId}/uploads/${Date.now()}_${(f.name || "file").replace(/[^\w.\-]/g, "_")}`;
        await r2Put(key, f.stream(), f.type || "application/octet-stream");
        s.uploads.push({ key, type: f.type || "", name: f.name || "file" });
      }
      await putSession(s);
      return json({ ok: true, uploads: s.uploads });
    },

    signMsa: async ({ linkId, signatureDataURL, agree }) => {
      if (!agree) return json({ ok: false, error: "Please accept the MSA" }, 400);
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);
      s.msaSignedAt = now();
      await putSession(s);
      if (signatureDataURL && R2) {
        const png = dataUrlToBlob(signatureDataURL);
        await r2Put(`agreements/${linkId}/msa_signature.png`, png, "image/png");
      }
      const cl = s.client || {};
      const pdf = generateSimplePdf({
        title: "Master Service Agreement",
        lines: [
          `Customer: ${cl.name || ""}`,
          `Email: ${cl.email || ""}  Phone: ${cl.phone || ""}`,
          `Address: ${cl.address?.street || ""}, ${cl.address?.city || ""}, ${cl.address?.zip || ""}`,
          `Signed: ${new Date(s.msaSignedAt).toLocaleString()}`,
        ],
      });
      await r2Put(`agreements/${linkId}/msa.pdf`, pdf, "application/pdf");
      return json({ ok: true });
    },

    complete: async ({ linkId }) => {
      const s = await getSessionById(linkId);
      if (!s) return json({ ok: false, error: "Session" }, 404);
      s.status = "completed";
      await putSession(s);
      return json({ ok: true });
    },
  };
}

// ---------- Binary utils ----------

function dataUrlToBlob(dataURL) {
  const [meta, b64] = String(dataURL || "").split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || "application/octet-stream";
  const bin = atob(b64 || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ---------- Admin Page (UI) ----------

function adminPage() {
  const css = baseCss();
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin Dashboard — Vinet Onboarding</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="card">
      <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" class="logo" />
      <h1 class="title">Admin Dashboard</h1>

      <div class="tab-grid">
        <button class="tab active" data-tab="gen">1) Generate onboarding link</button>
        <button class="tab" data-tab="staff">2) Generate staff verification code</button>
        <button class="tab" data-tab="pending">3) Pending (in progress)</button>
        <button class="tab" data-tab="completed">4) Completed (awaiting approval)</button>
        <button class="tab" data-tab="approved">5) Approved</button>
      </div>

      <div id="tab-gen" class="panel show">
        <label class="label">Splynx Lead/Customer ID</label>
        <div class="row">
          <input id="gen-id" class="input" placeholder="" />
          <button id="gen-btn" class="btn primary">Generate</button>
        </div>
        <div id="gen-out" class="muted"></div>
      </div>

      <div id="tab-staff" class="panel">
        <div class="row">
          <button id="staff-btn" class="btn">Generate Code</button>
          <div id="staff-out" class="muted"></div>
        </div>
      </div>

      <div id="tab-pending" class="panel">
        <table class="table">
          <thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody id="pending-body"><tr><td colspan="4" class="muted">No records.</td></tr></tbody>
        </table>
      </div>

      <div id="tab-completed" class="panel">
        <table class="table">
          <thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody id="completed-body"><tr><td colspan="4" class="muted">No records.</td></tr></tbody>
        </table>
      </div>

      <div id="tab-approved" class="panel">
        <table class="table">
          <thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th></tr></thead>
          <tbody id="approved-body"><tr><td colspan="3" class="muted">No records.</td></tr></tbody>
        </table>
      </div>
    </div>

    <script>
      const $ = (s) => document.querySelector(s);
      const out = (id, html) => ($("#" + id).innerHTML = html);
      const fmtTime = (ms) => new Date(ms).toLocaleString();

      // tabs
      document.querySelectorAll(".tab").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
          btn.classList.add("active");
          const t = btn.dataset.tab;
          document.querySelectorAll(".panel").forEach(p=>p.classList.remove("show"));
          $("#tab-" + t).classList.add("show");
          if (t==="pending") loadList("inprogress","pending-body");
          if (t==="completed") loadList("completed","completed-body");
          if (t==="approved") loadList("approved","approved-body");
        });
      });

      $("#gen-btn").addEventListener("click", async () => {
        const id = $("#gen-id").value.trim();
        if (!id) return out("gen-out","<div class='err'>Enter an ID</div>");
        const r = await fetch("/api/admin/create_link", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})}).then(r=>r.json());
        if (!r.ok) return out("gen-out","<div class='err'>"+(r.error||"Failed")+"</div>");
        out("gen-out", "<div>Onboarding link: <a href='"+r.link+"' target='_blank'>"+r.link+"</a></div>");
      });

      $("#staff-btn").addEventListener("click", async ()=>{
        const r = await fetch("/api/admin/staff_code",{method:"POST"}).then(r=>r.json());
        if (!r.ok) return out("staff-out","<div class='err'>Failed</div>");
        out("staff-out", "<div><b>Code:</b> "+r.code+" &nbsp; <span class='muted'>(expires in "+Math.round(r.expires_in/60)+" min)</span></div>");
      });

      async function loadList(status, bodyId){
        const r = await fetch("/api/admin/list?status="+status).then(r=>r.json());
        if (!r.ok) { out(bodyId, "<tr><td colspan='4' class='err'>Failed to load</td></tr>"); return; }
        const rows = r.rows;
        if (!rows.length) { out(bodyId, "<tr><td colspan='4' class='muted'>No records.</td></tr>"); return; }
        const cells = rows.map(x=>{
          const link = location.origin + "/onboard/" + x.linkId;
          const openBtn = "<a class='btn-link' target='_blank' href='"+link+"'>Review</a>";
          const delBtn = "<button class='btn danger' data-del='"+x.linkId+"'>Delete</button>";
          const tds = status==="approved"
            ? "<td>"+x.splynxId+"</td><td>"+x.linkId+"</td><td>"+fmtTime(x.updated)+"</td>"
            : "<td>"+x.splynxId+"</td><td>"+x.linkId+"</td><td>"+fmtTime(x.updated)+"</td><td>"+openBtn+" &nbsp; "+delBtn+"</td>";
          return "<tr>"+tds+"</tr>";
        }).join("");
        out(bodyId, cells);

        document.querySelectorAll("button[data-del]").forEach(b=>{
          b.onclick = async ()=>{
            if (!confirm("Delete this link and all files?")) return;
            const linkId = b.dataset.del;
            const r = await fetch("/api/admin/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId})}).then(r=>r.json());
            if (r.ok) loadList(status, bodyId);
          };
        });
      }
    </script>
  </body>
  </html>`;
}

// ---------- Onboarding Page (UI) ----------

function onboardPage(linkId) {
  const css = baseCss();
  return `<!DOCTYPE html>
  <html lang="en"><head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Onboarding — ${linkId}</title>
    <style>${css}</style>
  </head>
  <body>
    <div class="card card-wide">
      <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet" class="logo" />
      <div class="progress"><div id="bar" class="bar" style="width:10%"></div></div>

      <div id="step-otp" class="step show">
        <h2>Verify your identity</h2>
        <div class="pill-row">
          <button id="btn-whatsapp" class="pill active">WhatsApp OTP</button>
          <button id="btn-staff" class="pill">I have a staff code</button>
        </div>
        <div id="otp-area">
          <div id="otp-msg" class="muted">Sending a code to your WhatsApp…</div>
          <div class="row">
            <input id="otp-code" class="input" placeholder="Enter code" />
            <button id="verify-otp" class="btn primary">Verify</button>
          </div>
          <button id="resend" class="btn ghost small">Resend code</button>
        </div>
        <div id="staff-area" class="hide">
          <div class="row">
            <input id="staff-code" class="input" placeholder="Enter staff code" />
            <button id="verify-staff" class="btn primary">Verify</button>
          </div>
        </div>
      </div>

      <div id="step-payment" class="step">
        <h2>Payment Method</h2>
        <div class="pill-row">
          <button class="pill active" data-pay="eft">EFT</button>
          <button class="pill" data-pay="debit">Debit order</button>
        </div>

        <div id="panel-eft" class="panel show">
          <div class="grid">
            <div><label>Bank</label><input id="bank" class="input" value="First National Bank (FNB/RMB)" /></div>
            <div><label>Account Name</label><input id="accname" class="input" value="Vinet Internet Solutions" /></div>
            <div><label>Account Number</label><input id="accnum" class="input" value="62757054996" /></div>
            <div><label>Branch Code</label><input id="branch" class="input" value="250655" /></div>
            <div><label>Reference</label><input id="ref" class="input" value="${(linkId.split('_')[0])}" /></div>
          </div>
          <div class="row center">
            <button id="print-eft" class="btn">Print banking details</button>
          </div>
          <div class="row space">
            <button class="btn" data-prev>Back</button>
            <button class="btn primary" id="go-details">Continue</button>
          </div>
        </div>

        <div id="panel-debit" class="panel">
          <div class="grid">
            <div><label>Bank Account Holder Name</label><input id="d_name" class="input" /></div>
            <div><label>Bank Account Holder ID no</label><input id="d_idno" class="input" /></div>
            <div><label>Bank</label><input id="d_bank" class="input" /></div>
            <div><label>Bank Account No</label><input id="d_acc" class="input" /></div>
            <div>
              <label>Bank Account Type</label>
              <select id="d_type" class="input">
                <option>Cheque / Current</option>
                <option>Savings</option>
                <option>Transmission</option>
              </select>
            </div>
            <div>
              <label>Debit Order Date</label>
              <select id="d_day" class="input">
                ${Array.from({length:28},(_,i)=>`<option>${i+1}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="terms">
            <h3>Debit Order Terms</h3>
            <div class="scroll">
              <pre class="pre">
Debit Order Instruction Form

This signed Authority and Mandate refers to our contract as dated as on signature hereof ("the Agreement"). I / We hereby authorize you to issue and deliver payment instructions to the bank for collection against my/our above-mentioned account at my/our above-mentioned bank (or any other bank or branch to which, I/we may transfer my/our account) on condition that the sum of such payment instructions will never exceed my/our obligations as agreed to in the Agreement, and commencing on the commencement date and continuing until this Authority and Mandate is terminated by me/us by giving you notice in writing of 6 or no less than 20 ordinary working days...
              </pre>
            </div>
            <label class="check"><input type="checkbox" id="d_agree" /> I agree to the Debit Order terms</label>
          </div>

          <div>
            <label>Draw your signature for Debit Order</label>
            <canvas id="sig" width="600" height="180" class="sig"></canvas>
            <div class="row">
              <button id="sig-clear" class="btn">Clear</button>
            </div>
          </div>

          <div class="row space">
            <button class="btn" data-prev>Back</button>
            <button class="btn primary" id="save-debit">Continue</button>
          </div>
        </div>
      </div>

      <div id="step-details" class="step">
        <h2>Please verify your details and change if you see any errors</h2>
        <div class="grid">
          <div><label>Full name</label><input id="c_name" class="input" /></div>
          <div><label>ID / Passport</label><input id="c_id" class="input" /></div>
          <div><label>Email</label><input id="c_email" class="input" /></div>
          <div><label>Phone</label><input id="c_phone" class="input" /></div>
          <div><label>Street</label><input id="c_street" class="input" /></div>
          <div><label>City</label><input id="c_city" class="input" /></div>
          <div><label>ZIP Code</label><input id="c_zip" class="input" /></div>
        </div>
        <div class="row space">
          <button class="btn" data-prev>Back</button>
          <button class="btn primary" id="to-uploads">Continue</button>
        </div>
      </div>

      <div id="step-uploads" class="step">
        <h2>Upload documents</h2>
        <p class="muted">Please upload your ID and Proof of Address (max 2 files, 5MB each).</p>
        <form id="upload-form" enctype="multipart/form-data">
          <input type="file" name="file1" />
          <input type="file" name="file2" />
        </form>
        <div class="row space">
          <button class="btn" data-prev>Back</button>
          <button class="btn primary" id="to-msa">Continue</button>
        </div>
      </div>

      <div id="step-msa" class="step">
        <h2>Master Service Agreement</h2>
        <div class="terms">
          <div class="scroll">
            <pre class="pre">
Master Service Agreement (summary)
By continuing, you agree to Vinet's Master Service Agreement available at https://www.vinet.co.za/msa/ . Please sign below to confirm acceptance.
            </pre>
          </div>
          <label class="check"><input type="checkbox" id="msa_agree" /> I have read and accept the Master Service Agreement</label>
        </div>
        <div>
          <label>Draw your signature for MSA</label>
          <canvas id="sig-msa" width="600" height="180" class="sig"></canvas>
          <div class="row"><button id="sig-msa-clear" class="btn">Clear</button></div>
        </div>
        <div class="row space">
          <button class="btn" data-prev>Back</button>
          <button class="btn primary" id="finish">Continue</button>
        </div>
      </div>

      <div id="step-done" class="step">
        <h2>All set!</h2>
        <p>Thanks — we've recorded your information. Our team will be in contact shortly.</p>
        <p>If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinet.co.za</b>.</p>
        <hr/>
        <div id="links"></div>
      </div>
    </div>

    <script>
      const linkId = ${JSON.stringify(linkId)};
      const $ = (s)=>document.querySelector(s);
      const bar = (p)=> $("#bar").style.width = p + "%";
      const toast = (msg)=> alert(msg);

      // Payment tabs
      document.querySelectorAll('[data-pay]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          document.querySelectorAll('[data-pay]').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          const which = btn.dataset.pay;
          document.querySelectorAll('#panel-eft,#panel-debit').forEach(p=>p.classList.remove('show'));
          if (which==='eft') $('#panel-eft').classList.add('show');
          else $('#panel-debit').classList.add('show');
        });
      });

      // OTP panel toggle
      $("#btn-whatsapp").onclick = ()=>{ $("#btn-whatsapp").classList.add("active"); $("#btn-staff").classList.remove("active"); $("#otp-area").classList.remove("hide"); $("#staff-area").classList.add("hide"); }
      $("#btn-staff").onclick = ()=>{ $("#btn-staff").classList.add("active"); $("#btn-whatsapp").classList.remove("active"); $("#staff-area").classList.remove("hide"); $("#otp-area").classList.add("hide"); }

      let canProceed = false;
      let otpSentOnce = false;

      async function loadSession(){
        const r = await fetch("/api/session?id="+encodeURIComponent(linkId)).then(r=>r.json());
        if (!r.ok) return;
        const s = r.session;
        if (s.otpVerifiedAt) { canProceed = true; }
        const c = s.client || {};
        $("#c_name").value = c.name||"";
        $("#c_email").value = c.email||"";
        $("#c_phone").value = c.phone||"";
        $("#c_street").value = c.address?.street||"";
        $("#c_city").value = c.address?.city||"";
        $("#c_zip").value = c.address?.zip||"";
      }
      loadSession();

      async function requestOtp() {
        const r = await fetch("/api/send-otp", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ linkId })
        }).then(r=>r.json());
        const msg = r.ok ? "Code sent. Check your WhatsApp." : (r.error || "Could not send code");
        const el = $("#otp-msg");
        if (el) el.textContent = msg;
      }

      function showStep(id){
        document.querySelectorAll(".step").forEach(x=>x.classList.remove("show"));
        document.querySelector(id).classList.add("show");
        if (id === "#step-otp" && !otpSentOnce) { otpSentOnce = true; requestOtp(); }
      }

      // Navigation
      document.querySelectorAll("[data-prev]").forEach(b=>{
        b.onclick = ()=> prevStep();
      });

      function nextStep(){
        const current = document.querySelector(".step.show")?.id||"step-otp";
        if (current==="step-otp"){
          if (!canProceed) return toast("Please verify first");
          showStep("#step-payment"); bar(30);
        } else if (current==="step-payment"){
          if ($("#panel-eft").classList.contains("show")){
            const eft = {
              bank: $("#bank").value, account_name: $("#accname").value,
              account_number: $("#accnum").value, branch_code: $("#branch").value
            };
            fetch("/api/save-payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId, method:"eft", eft})});
          }
          showStep("#step-details"); bar(45);
        } else if (current==="step-details"){
          showStep("#step-uploads"); bar(60);
        } else if (current==="step-uploads"){
          showStep("#step-msa"); bar(80);
        } else if (current==="step-msa"){
          showStep("#step-done"); bar(95);
        }
      }
      function prevStep(){
        const id = document.querySelector(".step.show")?.id;
        if (id==="step-payment"){ showStep("#step-otp"); bar(10); }
        if (id==="step-details"){ showStep("#step-payment"); bar(30); }
        if (id==="step-uploads"){ showStep("#step-details"); bar(45); }
        if (id==="step-msa"){ showStep("#step-uploads"); bar(60); }
        if (id==="step-done"){ showStep("#step-msa"); bar(80); }
      }

      $("#go-details").onclick = () => nextStep();

      // Resend OTP
      $("#resend").onclick = requestOtp;

      // Verify OTP / Staff
      $("#verify-otp").onclick = async ()=>{
        const code = $("#otp-code").value.trim();
        const r = await fetch("/api/verify-otp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId, code})}).then(r=>r.json());
        if (r.ok){ canProceed = true; nextStep(); } else toast(r.error||"Invalid code");
      };
      $("#verify-staff").onclick = async ()=>{
        const code = $("#staff-code").value.trim();
        const r = await fetch("/api/verify-staff",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId, code})}).then(r=>r.json());
        if (r.ok){ canProceed = true; nextStep(); } else toast(r.error||"Invalid code");
      };

      // Debit signature
      const canvas = $("#sig");
      const ctx = canvas.getContext("2d");
      let drawing = false;
      canvas.addEventListener("mousedown", e=>{drawing=true; ctx.beginPath(); ctx.moveTo(e.offsetX,e.offsetY);});
      canvas.addEventListener("mousemove", e=>{ if(drawing){ ctx.lineTo(e.offsetX,e.offsetY); ctx.stroke(); }});
      canvas.addEventListener("mouseup", ()=> drawing=false);
      $("#sig-clear").onclick = ()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); };

      $("#save-debit").onclick = async ()=>{
        if (!$("#d_agree").checked) return toast("Please accept the terms");
        const signatureDataURL = canvas.toDataURL("image/png");
        const payload = {
          linkId,
          holder_name: $("#d_name").value,
          holder_id: $("#d_idno").value,
          bank: $("#d_bank").value,
          account_no: $("#d_acc").value,
          account_type: $("#d_type").value,
          debit_day: $("#d_day").value,
          agree: true,
          signatureDataURL
        };
        const r = await fetch("/api/save-debit-signature",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(r=>r.json());
        if (r.ok) nextStep(); else toast(r.error||"Failed");
      };

      // Details save
      $("#to-uploads").onclick = async ()=>{
        const payload = {
          linkId,
          name: $("#c_name").value, idno: $("#c_id").value, email: $("#c_email").value, phone: $("#c_phone").value,
          street: $("#c_street").value, city: $("#c_city").value, zip: $("#c_zip").value
        };
        const r = await fetch("/api/save-details",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(r=>r.json());
        if (r.ok) nextStep(); else toast(r.error||"Failed");
      };

      // Uploads
      $("#to-msa").onclick = async ()=>{
        const fd = new FormData($("#upload-form"));
        const r = await fetch("/api/upload?id="+encodeURIComponent(linkId),{method:"POST", body: fd}).then(r=>r.json());
        if (r.ok) nextStep(); else toast(r.error||"Upload failed");
      };

      // MSA signature
      const c2 = $("#sig-msa"), ctx2 = c2.getContext("2d");
      let d2 = false;
      c2.addEventListener("mousedown", e=>{d2=true; ctx2.beginPath(); ctx2.moveTo(e.offsetX,e.offsetY);});
      c2.addEventListener("mousemove", e=>{ if(d2){ ctx2.lineTo(e.offsetX,e.offsetY); ctx2.stroke(); }});
      c2.addEventListener("mouseup", ()=> d2=false);
      $("#sig-msa-clear").onclick = ()=> ctx2.clearRect(0,0,c2.width,c2.height);

      $("#finish").onclick = async ()=>{
        if (!$("#msa_agree").checked) return toast("Please accept the MSA");
        const signatureDataURL = c2.toDataURL("image/png");
        let r = await fetch("/api/sign-msa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId, signatureDataURL, agree:true})}).then(r=>r.json());
        if (!r.ok) return toast(r.error||"Failed");
        r = await fetch("/api/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId})}).then(r=>r.json());
        if (!r.ok) return toast("Could not finalise");
        const msa = "/agreements/"+linkId+"/msa.pdf";
        const dob = "/agreements/"+linkId+"/do.pdf";
        $("#links").innerHTML = '<div class="links"><div>Your agreements:</div><ul><li><a href="'+msa+'" target="_blank">Master Service Agreement (PDF)</a></li><li><a href="'+dob+'" target="_blank">Debit Order Agreement (PDF)</a></li></ul></div>';
        nextStep();
        bar(100);
      };

      // Print EFT
      $("#print-eft").onclick = ()=> window.open("/info/eft?id="+encodeURIComponent(linkId), "_blank");

      // show first step (auto-sends OTP once)
      showStep("#step-otp");
    </script>
  </body></html>`;
}

// ---------- Printable EFT page ----------

function printableEftPage(id) {
  const css = `
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; padding:32px;}
    .box{border:1px solid #ddd; border-radius:12px; padding:24px; max-width:720px;}
    h1{margin:0 0 8px 0; font-size:22px;}
    .muted{color:#555}
    table{width:100%; border-collapse:separate; border-spacing:0 8px}
    td:first-child{font-weight:600; width:240px}
    .print{margin-top:16px; padding:10px 16px; border:1px solid #e2001a; border-radius:999px; color:#e2001a; background:#fff}
  `;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>EFT Details</title><style>${css}</style></head>
  <body>
    <div class="box">
      <h1>Banking Details</h1>
      <div class="muted">Use the reference number exactly as shown.</div>
      <table>
        <tr><td>Bank</td><td>First National Bank (FNB/RMB)</td></tr>
        <tr><td>Account Name</td><td>Vinet Internet Solutions</td></tr>
        <tr><td>Account Number</td><td>62757054996</td></tr>
        <tr><td>Branch Code</td><td>250655</td></tr>
        <tr><td>Reference</td><td>${(id||"").split('_')[0]}</td></tr>
      </table>
      <button class="print" onclick="window.print()">Print</button>
    </div>
  </body></html>`;
}

// ---------- Shared CSS ----------

function baseCss() {
  return `
  :root{
    --red:#e2001a; --txt:#23262b; --sub:#4b5563; --bg:#f7f7fa; --card:#fff; --bd:#e5e7eb;
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--bg); color:var(--txt); font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue";}
  .card{max-width:980px; margin:56px auto; background:var(--card); border:1px solid var(--bd); border-radius:22px; padding:28px 28px 36px; box-shadow:0 2px 20px rgba(0,0,0,0.03)}
  .card-wide{max-width:860px}
  .logo{width:140px; display:block; margin:12px auto 8px}
  .title{font-size:40px; text-align:center; margin:8px 0 24px; color:var(--red)}
  .tab-grid{display:grid; grid-template-columns:repeat(2,auto); justify-content:center; gap:16px 24px; margin:8px 0 24px}
  .tab{padding:12px 18px; border:2px solid var(--red); color:var(--red); background:#fff; border-radius:16px}
  .tab.active{background:var(--red); color:#fff}
  .panel{display:none}
  .panel.show{display:block}
  .label{display:block; margin:12px 0 8px; color:#2b2f33; font-weight:600}
  .row{display:flex; gap:12px; align-items:center; margin:8px 0}
  .row.center{justify-content:center}
  .row.space{justify-content:space-between}
  .input{padding:12px 14px; border:1px solid var(--bd); border-radius:10px; flex:1; min-width:160px}
  .btn{padding:12px 18px; border:2px solid var(--red); color:var(--red); background:#fff; border-radius:16px; cursor:pointer}
  .btn.small{padding:8px 14px}
  .btn.primary{background:var(--red); color:#fff}
  .btn.ghost{border-color:#cbd5e1; color:#334155}
  .btn.danger{border-color:#b91c1c; color:#b91c1c}
  .btn-link{color:var(--red); text-decoration:underline}
  .muted{color:#6b7280}
  .err{color:#b91c1c}
  .table{width:100%; border-collapse:collapse; margin-top:8px}
  .table th, .table td{padding:12px; border-bottom:1px solid var(--bd); text-align:left}
  .progress{height:8px; background:#eee; border-radius:999px; overflow:hidden; margin:8px 0 24px}
  .bar{height:100%; background:var(--red); width:0}
  .step{display:none}
  .step.show{display:block}
  .pill-row{display:flex; gap:12px; margin:8px 0 16px}
  .pill{padding:10px 16px; border:2px solid var(--red); color:var(--red); border-radius:999px; background:#fff}
  .pill.active{background:var(--red); color:#fff}
  .grid{display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px}
  .terms{margin:12px 0}
  .scroll{max-height:220px; overflow:auto; border:1px solid var(--bd); border-radius:12px; padding:12px; background:#fafafa}
  .pre{white-space:pre-wrap; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,"Liberation Mono",monospace; font-size:12px; color:#222}
  .check{display:flex; align-items:center; gap:8px; margin:12px 0}
  .sig{border:1px dashed #cbd5e1; border-radius:12px; background:#fff}
  .hide{display:none}
  @media (max-width:720px){
    .grid{grid-template-columns:1fr}
    .tab-grid{grid-template-columns:1fr}
  }
  `;
}
```

If anything still feels off after redeploy (especially the OTP message), ping me and I’ll tweak it fast.
