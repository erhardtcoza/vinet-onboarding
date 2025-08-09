// --- Vinet Onboarding Worker (rolled-back + fixes + client PDF links) ---
// Single-file Worker with:
// - Admin dashboard (IP allowlisted)
// - Onboarding flow (OTP via WhatsApp, payment select, confirm details, uploads, agreement, finish)
// - Inline EFT + "View EFT page" link
// - Debit Order page (GET/POST), saved to KV, read-only in admin
// - Terms endpoints
// - R2 uploads (ID + POA, 5MB each)
// - PDF generation on signature -> client download links

const TERMS_DEBIT_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
const TERMS_SERVICE_URL_DEFAULT = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TEMPLATE_MSA_URL = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const TEMPLATE_DO_URL  = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// ---------- Helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143; // 160.226.128.0/20
}

async function fetchText(url) {
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
  return r.ok ? r.text() : "";
}

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const getIP = (req) =>
  req.headers.get("CF-Connecting-IP") ||
  req.headers.get("x-forwarded-for") ||
  req.headers.get("x-real-ip") ||
  "";

const getUA = (req) => req.headers.get("user-agent") || "";

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = (s) => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
    obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) {
    for (const it of obj) { const m = pickPhone(it); if (m) return m; }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; }
  }
  return null;
}

async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
  }
  return null;
}

async function fetchProfileForDisplay(env, id) {
  let cust=null, lead=null, contacts=null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street ||
    [src.street_1, src.street_2].filter(Boolean).join(" ") ||
    src.address ||
    "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id: id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city: src.city || "",
    street,
    zip: src.zip_code || src.zip || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- Admin HTML ----------
function renderAdminPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
  .card { background:#fff; max-width:1100px; margin:2.0em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.4em 1.6em; }
  .logo { display:block; margin:0 auto 1em; max-width:90px; }
  h1, h2 { color:#e2001a; }
  .tabs { display:grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap:.6em; justify-content:center; margin:.6em auto 1.2em; max-width:680px; }
  .tabs.bottom { grid-template-columns: repeat(3, minmax(200px, 1fr)); max-width:820px; margin-top:.2em; }
  .tab { text-align:center; padding:.7em 1.2em; border-radius:.9em; border:2px solid #e2001a; color:#e2001a; cursor:pointer; user-select:none; font-weight:600; background:#fff; }
  .tab.active { background:#e2001a; color:#fff; }
  .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.55em 1.0em; font-size:1em; cursor:pointer; }
  .btn-outline { background:#fff; color:#e2001a; border:2px solid #e2001a; border-radius:.7em; padding:.5em 1.0em; }
  .btn-secondary { background:#eee; color:#222; border:0; border-radius:.7em; padding:.5em 1.0em; text-decoration:none; display:inline-block; }
  .field { margin:.9em 0; }
  input, select { width:100%; padding:.6em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
  .row { display:flex; gap:.75em; }
  .row > * { flex:1; }
  table { width:100%; border-collapse: collapse; }
  th, td { padding:.6em .5em; border-bottom:1px solid #eee; text-align:left; }
  .note { font-size:12px; color:#666; }
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
    <h1>Admin Dashboard</h1>

    <div class="tabs top">
      <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
      <div class="tab" data-tab="staff">2. Generate verification code</div>
    </div>
    <div class="tabs bottom">
      <div class="tab" data-tab="inprog">3. Pending (in-progress)</div>
      <div class="tab" data-tab="pending">4. Completed (awaiting approval)</div>
      <div class="tab" data-tab="approved">5. Approved</div>
    </div>

    <div id="content"></div>
  </div>
  <script src="/static/admin.js"></script>
</body>
</html>`;
}

function adminJs() {
  return `(()=> {
    const tabs = document.querySelectorAll('.tab');
    const content = document.getElementById('content');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      load(t.getAttribute('data-tab'));
    });
    load('gen');

    function node(html){ const d=document.createElement('div'); d.innerHTML=html; return d; }

    async function load(which){
      if (which==='gen') {
        content.innerHTML = '';
        const v = node(
          '<div class="field"><label>Splynx Lead/Customer ID</label>'+
          '<div class="row"><input id="id" autocomplete="off" />'+
          '<button class="btn" id="go">Generate</button></div></div>'+
          '<div id="out" class="field"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const id = v.querySelector('#id').value.trim();
          const out = v.querySelector('#out');
          if (!id) { out.textContent = 'Please enter an ID.'; return; }
          out.textContent = 'Working...';
          try {
            const r = await fetch('/api/admin/genlink', {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ id })
            });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.url
              ? '<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'
              : 'Error generating link.';
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (which==='staff') {
        content.innerHTML='';
        const v = node(
          '<div class="field"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label>'+
          '<div class="row"><input id="linkid" autocomplete="off" />'+
          '<button class="btn" id="go">Generate staff code</button></div></div>'+
          '<div id="out" class="field note"></div>'
        );
        v.querySelector('#go').onclick = async ()=>{
          const linkid = v.querySelector('#linkid').value.trim();
          const out = v.querySelector('#out');
          if (!linkid) { out.textContent='Enter linkid'; return; }
          out.textContent='Working...';
          try {
            const r = await fetch('/api/staff/gen', { method:'POST', body: JSON.stringify({ linkid }) });
            const d = await r.json().catch(()=>({}));
            out.innerHTML = d.ok ? 'Staff code: <b>'+d.code+'</b> (valid 15 min)' : (d.error || 'Failed');
          } catch { out.textContent = 'Network error.'; }
        };
        content.appendChild(v);
        return;
      }

      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML = 'Loading...';
        try {
          const r = await fetch('/api/admin/list?mode='+which);
          const d = await r.json();
          const rows = (d.items||[]).map(i =>
            '<tr>'+
              '<td>'+i.id+'</td>'+
              '<td>'+i.linkid+'</td>'+
              '<td>'+new Date(i.updated).toLocaleString()+'</td>'+
              '<td>'+(which==='pending'
                 ? '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>'
                 : '<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+
              '</td></tr>'
          ).join('') || '<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML = '<table><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        } catch {
          content.innerHTML = 'Failed to load.';
        }
        return;
      }
    }
  })();`;
}

// ---------- EFT Page ----------
async function renderEFTPage(id) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>EFT Payment Details</title>
<style>
body { font-family: Arial, sans-serif; background: #f7f7fa; }
.container { max-width: 700px; margin: 40px auto; background: #fff; padding: 20px; border-radius: 12px; }
h1 { color: #e2001a; }
input { width: 100%; padding: 8px; margin: 5px 0 15px; border: 1px solid #ccc; border-radius: 6px; }
button { background: #e2001a; color: #fff; padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; }
.note { font-size: 12px; color: #555; }
</style>
</head>
<body>
<div class="container">
  <img src="${LOGO_URL}" height="60"><br><br>
  <h1>EFT Payment Details</h1>
  <label>Bank</label>
  <input readonly value="First National Bank (FNB/RMB)">
  <label>Account Name</label>
  <input readonly value="Vinet Internet Solutions">
  <label>Account Number</label>
  <input readonly value="62757054996">
  <label>Branch Code</label>
  <input readonly value="250655">
  <label>Reference</label>
  <input readonly value="${id || ''}">
  <p class="note">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <button onclick="window.print()">Print</button>
</div>
</body>
</html>`;
}

// ---------- Debit Order Page (GET + POST) ----------
async function renderDebitPage(id) {
  const terms = await fetchText(TERMS_DEBIT_URL);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Debit Order Instruction</title>
<style>
body { font-family: Arial, sans-serif; background: #f7f7fa; }
.container { max-width: 800px; margin: 40px auto; background: #fff; padding: 20px; border-radius: 12px; }
h1 { color: #e2001a; }
input, select { width: 100%; padding: 8px; margin: 5px 0 15px; border: 1px solid #ccc; border-radius: 6px; }
button { background: #e2001a; color: #fff; padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; }
label { font-weight: bold; }
.terms { background: #f9f9f9; padding: 10px; margin-top: 15px; border: 1px solid #ccc; max-height: 200px; overflow-y: scroll; }
input[type=checkbox] { transform: scale(1.4); transform-origin: left center; margin-right: 8px; }
</style>
</head>
<body>
<div class="container">
  <img src="${LOGO_URL}" height="60"><br><br>
  <h1>Debit Order Instruction</h1>
  <form method="POST" action="/info/debit?id=${encodeURIComponent(id || '')}">
    <input type="hidden" name="client_id" value="${id || ''}">
    <label>Bank Account Holder Name</label>
    <input name="account_holder" required>
    <label>Bank Account Holder ID No</label>
    <input name="id_number" required>
    <label>Bank</label>
    <input name="bank_name" required>
    <label>Bank Account No</label>
    <input name="account_number" required>
    <label>Bank Account Type</label>
    <select name="account_type" required>
      <option value="cheque">Cheque</option>
      <option value="savings">Savings</option>
      <option value="transmission">Transmission</option>
    </select>
    <label>Debit Order Date</label>
    <select name="debit_day" required>
      <option value="1">1st</option>
      <option value="7">7th</option>
      <option value="15">15th</option>
      <option value="25">25th</option>
      <option value="29">29th</option>
      <option value="30">30th</option>
    </select>
    <div class="terms">${terms || 'Terms unavailable.'}</div>
    <label style="display:flex;align-items:center;margin-top:10px;">
      <input type="checkbox" name="agree" required> I agree to the Debit Order terms
    </label><br/>
    <button type="submit">Submit</button>
    <button type="button" onclick="window.location.href='/info/eft?id=${id || ''}'" style="background: grey; margin-left:10px;">Prefer EFT?</button>
  </form>
</div>
</body>
</html>`;
}

// ---------- PDF generation (client download on sign) ----------
async function generateAgreementPDFs(env, linkid, sess, sigBytes) {
  // Load pdf-lib dynamically
  const { PDFDocument } = await import("pdf-lib");

  // Gather basic data
  const splynx_id = (linkid || "").split("_")[0];
  const full_name = (sess.edits && sess.edits.full_name) || "";
  const email     = (sess.edits && sess.edits.email) || "";
  const phone     = (sess.edits && sess.edits.phone) || "";
  const street    = (sess.edits && sess.edits.street) || "";
  const city      = (sess.edits && sess.edits.city) || "";
  const zip       = (sess.edits && sess.edits.zip) || "";
  const debit     = sess.debit || null;
  const today     = new Date().toLocaleDateString("en-ZA");

  async function fillAndStamp(url, fields, sigOpts) {
    const tplRes = await fetch(url);
    const pdfDoc = await PDFDocument.load(await tplRes.arrayBuffer());

    // Try to fill forms if fields exist
    try {
      const form = pdfDoc.getForm();
      for (const [k, v] of Object.entries(fields)) {
        try { form.getTextField(k).setText(String(v ?? "")); } catch {}
      }
      form.flatten();
    } catch {
      // no form – ignore
    }

    // Stamp signature (bottom-right by default)
    if (sigBytes) {
      const png = await pdfDoc.embedPng(sigBytes);
      const pages = pdfDoc.getPages();
      const page = pages[pages.length - 1];
      const { width, height } = page.getSize();
      const sigW = Math.min(220, width * 0.35);
      const sigH = (png.height / png.width) * sigW;
      const x = (sigOpts?.x ?? (width - sigW - 40));
      const y = (sigOpts?.y ?? (40));
      page.drawImage(png, { x, y, width: sigW, height: sigH });
      // date text near signature
      page.drawText(`Signed: ${today}`, { x, y: y + sigH + 8, size: 10 });
      if (full_name) page.drawText(full_name, { x, y: y + sigH + 22, size: 10 });
    }

    return await pdfDoc.save();
  }

  // MSA is always generated
  const msaFields = {
    "Client Full Name": full_name,
    "Client ID": "", // we don't collect SA ID on service form – leave blank or map if available
    "Client Address": `${street} ${city} ${zip}`.trim(),
    "Client Email": email,
    "Client Phone": phone,
    "Vinet Customer ID": String(splynx_id),
    "Agreement Date": today,
    "Signature Name": full_name,
  };
  const msaPdf = await fillAndStamp(TEMPLATE_MSA_URL, msaFields);

  // DO only if debit chosen
  let doPdf = null;
  if (debit) {
    const doFields = {
      "Bank Account Holder Name": debit.account_holder || "",
      "Bank Account Holder ID no": debit.id_number || "",
      "Bank": debit.bank_name || "",
      "Bank Account No": debit.account_number || "",
      "Bank Account Type": debit.account_type || "",
      "Debit Order Date": String(debit.debit_day || ""),
      "Client Full Name": full_name,
      "Agreement Date": today,
    };
    doPdf = await fillAndStamp(TEMPLATE_DO_URL, doFields);
  }

  // Save to R2
  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaPdf, { httpMetadata: { contentType: "application/pdf" } });
  let doKey = null;
  if (doPdf) {
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doPdf, { httpMetadata: { contentType: "application/pdf" } });
  }

  // Public URLs (served by R2 public bucket or via API gateway if configured)
  const base = env.API_URL || "";
  // If your R2 is public via the bucket domain, replace with that here.
  const msaUrl = `${base}/r2/${encodeURIComponent(msaKey)}`; // adjust if you have a CDN mapping
  const doUrl  = doKey ? `${base}/r2/${encodeURIComponent(doKey)}` : null;

  return { msaKey, doKey, msaUrl, doUrl };
}

// ---------- Worker ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Admin gate
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // Info: EFT
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Info: Debit GET/POST
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderDebitPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/info/debit" && method === "POST") {
      const id = url.searchParams.get("id") || "";
      const form = await request.formData();
      const payload = {
        splynx_id: id || form.get("client_id") || "",
        account_holder: form.get("account_holder") || "",
        id_number: form.get("id_number") || "",
        bank_name: form.get("bank_name") || "",
        account_number: form.get("account_number") || "",
        account_type: form.get("account_type") || "",
        debit_day: form.get("debit_day") || "",
        agree: form.get("agree") === "on",
        via: "public-form",
        at: Date.now(),
        ip: getIP(request),
        ua: getUA(request),
      };
      if (!payload.splynx_id || !payload.agree) {
        return new Response("<p>Missing required fields.</p>", { status: 400, headers: { "content-type": "text/html" } });
      }
      await env.ONBOARD_KV.put(`debit/${payload.splynx_id}/${payload.at}`, JSON.stringify(payload), {
        expirationTtl: 60 * 60 * 24 * 90,
      });
      return new Response(`<!doctype html><meta charset="utf-8"><div style="font-family:sans-serif;padding:2rem;">
        <img src="${LOGO_URL}" height="50" style="display:block;margin-bottom:10px"/>
        <h2>Thanks - we've recorded your information.</h2>
        <p>Our team will be in contact shortly.</p>
        <p>If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinet.co.za</b></p>
      </div>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Terms API (service + optional debit)
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay") || "eft").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || TERMS_SERVICE_URL_DEFAULT;
      const debUrl = env.TERMS_DEBIT_URL || TERMS_DEBIT_URL;

      const [service, debit] = await Promise.all([
        fetchText(svcUrl).catch(() => ""),
        pay === "debit" ? fetchText(debUrl).catch(() => "") : ""
      ]);

      const esc = (s) => (s || "").replace(/[&<>]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
      const body = `
        <h3>Service Terms</h3>
        <pre style="white-space:pre-wrap">${esc(service)}</pre>
        ${debit ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(debit)}</pre>` : ""}
      `;
      return new Response(body || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Admin: generate link
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error: "Missing id" }, 400);
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ id, created: Date.now(), progress: 0 }),
        { expirationTtl: 86400 }
      );
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Admin: staff OTP
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok: true, linkid, code });
    }

    // WhatsApp OTP send / verify
    async function sendWhatsAppTemplate(toMsisdn, code, lang = "en") {
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "template",
        template: {
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || "en_US" },
          components: [{ type: "body", parameters: [{ type: "text", text: code }] }],
        },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`WA template send failed ${r.status} ${t}`);
      }
    }
    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "text",
        text: { body: bodyText },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`WA text send failed ${r.status} ${t}`);
      }
    }

    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];

      let msisdn = null;
      try {
        msisdn = await fetchCustomerMsisdn(env, splynxId);
      } catch {
        return json({ ok: false, error: "Splynx lookup failed" }, 502);
      }
      if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      try {
        await sendWhatsAppTemplate(msisdn, code, "en");
        return json({ ok: true });
      } catch (e) {
        try {
          await sendWhatsAppTextIfSessionOpen(msisdn, `Your Vinet verification code is: ${code}`);
          return json({ ok: true, note: "sent-as-text" });
        } catch {
          return json({ ok: false, error: "WhatsApp send failed (template+text)" }, 502);
        }
      }
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) {
          await env.ONBOARD_KV.put(
            `onboard/${linkid}`,
            JSON.stringify({ ...sess, otp_verified: true }),
            { expirationTtl: 86400 }
          );
        }
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: getIP(request), last_ua: getUA(request), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok: true });
    }

    // Store signature + mark pending + GENERATE PDFs + return URLs
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const sigBytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata: { contentType: "image/png" } });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown session" }, 404);

      // Generate PDFs and get URLs
      let pdfUrls = { msaUrl: null, doUrl: null };
      try {
        pdfUrls = await generateAgreementPDFs(env, linkid, sess, sigBytes);
      } catch (e) {
        // If PDF generation fails, still mark as pending but return without URLs
      }

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        ...sess,
        agreement_signed: true,
        agreement_sig_key: sigKey,
        status: "pending",
        downloads: { msa: pdfUrls.msaUrl, do: pdfUrls.doUrl }
      }), { expirationTtl: 86400 });

      return json({ ok: true, ...pdfUrls });
    }

    // File uploads (ID + POA), 5MB cap
    if (path === "/api/onboard/upload" && method === "POST") {
      const q = new URL(request.url).searchParams;
      const linkid = q.get("linkid");
      const label = q.get("label") || "file";
      const name = q.get("filename") || "file.bin";
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

      const body = await request.arrayBuffer();
      if (body.byteLength > 5 * 1024 * 1024) return json({ ok: false, error: "File too large (max 5MB)" }, 413);

      const key = `uploads/${linkid}/${Date.now()}_${name}`;
      await env.R2_UPLOADS.put(key, body);
      // Track in session
      const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      uploads.push({ key, label, name, size: body.byteLength });
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, uploads }), { expirationTtl: 86400 });
      return json({ ok: true, key });
    }

    // Admin: list tabs
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;

        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id: s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id: s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id: s.id, updated });
      }
      items.sort((a,b)=> b.updated - a.updated);
      return json({ items });
    }

    // Admin: review page (read-only debit details + uploads)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });

      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u =>
            `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
              <b>${u.label}</b> — ${u.name} • ${Math.round((u.size||0)/1024)} KB
            </li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;

      const debit = sess.debit || {};
      const debitHTML = Object.keys(debit).length
        ? `<div style="border:1px solid #eee;border-radius:.6em;padding:.7em">
            <div><b>Account Holder:</b> ${debit.account_holder||''}</div>
            <div><b>ID No:</b> ${debit.id_number||''}</div>
            <div><b>Bank:</b> ${debit.bank_name||''}</div>
            <div><b>Account No:</b> ${debit.account_number||''}</div>
            <div><b>Type:</b> ${debit.account_type||''}</div>
            <div><b>Debit Day:</b> ${debit.debit_day||''}</div>
          </div>`
        : `<div class="note">No debit order details</div>`;

      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}
h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}
.note{color:#666;font-size:12px}
</style>
</head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${sess.id}</b> • LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'n/a'}</b></div>

  <h2>Edits</h2>
  <div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${k}</b>: ${v?String(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>

  <h2>Debit Order</h2>
  ${debitHTML}

  <h2>Uploads</h2>
  ${filesHTML}

  <h2>Agreement</h2>
  <div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>

  <div style="margin-top:12px">
    <button class="btn" id="approve">Approve & Push</button>
    <button class="btn-outline" id="reject">Reject</button>
  </div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg = document.getElementById('msg');
  document.getElementById('approve').onclick = async () => {
    msg.textContent = 'Pushing...';
    try {
      const r = await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})});
      const d = await r.json().catch(()=>({ok:false}));
      msg.textContent = d.ok ? 'Approved and pushed.' : (d.error || 'Failed.');
    } catch { msg.textContent = 'Network error.'; }
  };
  document.getElementById('reject').onclick = async () => {
    const reason = prompt('Reason for rejection?') || '';
    msg.textContent = 'Rejecting...';
    try {
      const r = await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})});
      const d = await r.json().catch(()=>({ok:false}));
      msg.textContent = d.ok ? 'Rejected.' : (d.error || 'Failed.');
    } catch { msg.textContent = 'Network error.'; }
  };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Admin approve (status only; PDFs already generated for client)
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "No session" }, 404);

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status: "approved" }), {
        expirationTtl: 86400,
      });
      return json({ ok: true });
    }

    // Admin reject
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        ...sess,
        status: "rejected",
        reject_reason: String(reason || "").slice(0, 300),
        rejected_at: Date.now()
      }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Onboarding UI renderer (uploads step + final downloads)
    function renderOnboardUI(linkid) {
      return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
  .card { background:#fff; max-width:650px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
  .logo { display:block; margin:0 auto 1em; max-width:90px; }
  h1, h2 { color:#e2001a; }
  .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
  .btn-outline { background:#fff; color:#e2001a; border:2px solid #e2001a; border-radius:.7em; padding:.6em 1.4em; }
  .field { margin:1em 0; }
  input, select, textarea { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
  .note { font-size:12px; color:#666; }
  .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
  .progress { height:100%; background:#e2001a; transition:width .4s; }
  .row { display:flex; gap:.75em; }
  .row > * { flex:1; }
  .pill-wrap { display:flex; gap:.6em; flex-wrap:wrap; margin:.6em 0 0; }
  .pill { border:2px solid #e2001a; color:#e2001a; padding:.6em 1.2em; border-radius:999px; cursor:pointer; user-select:none; }
  .pill.active { background:#e2001a; color:#fff; }
  .termsbox { max-height: 280px; overflow:auto; padding:1em; border:1px solid #ddd; border-radius:.6em; background:#fafafa; }
  canvas.signature { border:1px dashed #bbb; border-radius:.6em; width:100%; height:180px; touch-action: none; background:#fff; }
  input[type=checkbox]{ transform: scale(1.35); transform-origin: left center; margin-right: 8px; }
  .eftbox { background:#f9f9f9; border:1px solid #eee; border-radius:.7em; padding: .8em 1em; }
  .downloads a { display:inline-block; margin-right:10px; }
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:12%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft', downloads: {} };

  const TOTAL_STEPS = 6;
  function pct(){ return Math.min(100, Math.round(((step+1)/(TOTAL_STEPS+1))*100)); }
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code to WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (m) m.textContent = d.ok ? 'Code sent. Check your WhatsApp.' : (d.error||'Failed to send.');
    }catch{ if(m) m.textContent='Network error.'; }
  }

  function sigPad(canvas){
    const ctx=canvas.getContext('2d'); let draw=false,last=null;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); }, dataURL(){ return canvas.toDataURL('image/png'); } };
  }

  function step0(){
    stepEl.innerHTML = '<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  function step1(){
    stepEl.innerHTML = [
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>'
    ].join('');

    function renderEFT(){
      const id=(linkid||'').split('_')[0]||'';
      document.getElementById('eftBox').innerHTML =
        '<div class="eftbox">'+
        '<div><b>Bank:</b> First National Bank (FNB/RMB)</div>'+
        '<div><b>Account Name:</b> Vinet Internet Solutions</div>'+
        '<div><b>Account Number:</b> 62757054996</div>'+
        '<div><b>Branch Code:</b> 250655</div>'+
        '<div><b>Reference:</b> '+id+'</div>'+
        '<div class="note" style="margin-top:.5em">Accounts payable on or before the 1st of every month.</div>'+
        '<div style="margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank">View EFT page</a></div>'+
        '</div>';
    }

    function renderDebit(){
      const d = state.debit || {};
      document.getElementById('debitBox').innerHTML = [
        '<div class="row">',
          '<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" required /></div>',
          '<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" required /></div>',
          '<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'" required /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading debit order terms...</div>'
      ].join('');
      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();
    }

    if (pay==='eft') renderEFT(); else renderDebit();

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; document.getElementById('debitBox').style.display='none'; document.getElementById('eftBox').style.display='block'; renderEFT(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; document.getElementById('eftBox').style.display='none'; document.getElementById('debitBox').style.display='block'; renderDebit(); save(); };

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id }) });
        } catch {}
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  function step3(){
    stepEl.innerHTML='<h2>Confirm your details</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'" /></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'" /></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'" /></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'" /></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'" /></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'" /></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>',
          '<div class="note">We\\u2019ll use these updates later to sync with our system.</div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML = [
      '<h2>Upload supporting documents</h2>',
      '<div class="note">Please upload a photo/scan of your ID and Proof of Address. Max 5 MB each.</div>',
      '<div class="field"><label>Identity Document</label><input type="file" id="idFile" accept=".pdf,.png,.jpg,.jpeg" /></div>',
      '<div class="field"><label>Proof of Address</label><input type="file" id="poaFile" accept=".pdf,.png,.jpg,.jpeg" /></div>',
      '<div id="upMsg" class="note" style="margin:.5em 0 0"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };

    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('upMsg');
      const idF = document.getElementById('idFile').files[0];
      const poaF = document.getElementById('poaFile').files[0];

      async function uploadOne(file, label){
        if (!file) return true;
        if (file.size > 5*1024*1024) { msg.textContent = label+': file too large (max 5MB)'; return false; }
        const arr = await file.arrayBuffer();
        const q = new URLSearchParams({ linkid, label, filename: file.name });
        const r = await fetch('/api/onboard/upload?'+q.toString(), { method:'POST', body: arr });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) { msg.textContent = 'Failed to upload '+label; return false; }
        return true;
      }

      msg.textContent='Uploading...';
      const ok1 = await uploadOne(idF, 'Identity Document');
      if (!ok1) return;
      const ok2 = await uploadOne(poaF, 'Proof of Address');
      if (!ok2) return;

      msg.textContent='Uploaded.';
      step=5; state.progress=step; setProg(); save(); render();
    };
  }

  function step5(){
    stepEl.innerHTML=[
      '<h2>Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field"><label style="display:flex;align-items:center"><input type="checkbox" id="agreeChk"/> <span>I have read and accept the terms</span></label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const pay=(state.pay_method||'eft'); const r=await fetch('/api/terms?pay='+encodeURIComponent(pay)); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; } msg.textContent='Finalising…';
      try{
        const dataUrl=pad.dataURL();
        const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})});
        const d=await r.json().catch(()=>({ok:false}));
        if(d.ok){
          state.downloads = { msa: d.msaUrl || '', do: d.doUrl || '' };
          step=6; state.progress=step; setProg(); save(); render();
        } else {
          msg.textContent=d.error||'Failed to finalise.';
        }
      }catch{ msg.textContent='Network error.'; }
    };
  }

  function step6(){
    const a = [];
    if (state.downloads && state.downloads.msa) a.push('<a class="btn-outline" target="_blank" href="'+state.downloads.msa+'">Download MSA</a>');
    if (state.pay_method==='debit' && state.downloads && state.downloads.do) a.push('<a class="btn-outline" target="_blank" href="'+state.downloads.do+'">Download Debit Order</a>');
    stepEl.innerHTML=[
      '<h2>All set!</h2>',
      '<p>Thanks - we\\u2019ve recorded your information. Our team will be in contact shortly.</p>',
      '<p>If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinet.co.za</b></p>',
      (a.length?('<div class="downloads" style="margin-top:.6em">'+a.join(' ')+'</div>'):'')
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
    }

    // Splynx profile for UI
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // Store inline debit JSON (used from step 2)
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id: id, created: ts, ip: getIP(request), ua: getUA(request) };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref:key });
    }

    // Default 404
    return new Response("Not found", { status: 404 });
  }
};
