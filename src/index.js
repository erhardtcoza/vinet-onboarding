// --- Vinet Onboarding Worker ---
// Handles admin dashboard, onboarding flow, EFT & Debit Order pages
// Updated to auto-show debit order form, load terms, and prefill EFT reference

const ALLOWED_IPS = [
  "160.226.128.0/20" // CIDR-style for your ASN range
];

const TERMS_DEBIT_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// --- Helpers ---
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  // CIDR 160.226.128.0/20 means first two octets fixed, third in 128-143
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) return "";
  return res.text();
}

// --- EFT Page ---
async function renderEFTPage(id) {
  return `
<!DOCTYPE html>
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

// --- Debit Order Page ---
async function renderDebitPage(id) {
  const terms = await fetchText(TERMS_DEBIT_URL);
  return `
<!DOCTYPE html>
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
</style>
</head>
<body>
<div class="container">
  <img src="${LOGO_URL}" height="60"><br><br>
  <h1>Debit Order Instruction</h1>
  <form method="POST" action="/submit-debit">
    <input type="hidden" name="client_id" value="${id || ''}">
    <label>Bank Account Holder Name</label>
    <input name="account_holder" required>
    <label>Bank Account Holder ID No</label>
    <input name="id_number" required>
    <label>Bank</label>
    <input name="bank" required>
    <label>Bank Account No</label>
    <input name="account_number" required>
    <label>Bank Account Type</label>
    <select name="account_type">
      <option value="cheque">Cheque</option>
      <option value="savings">Savings</option>
      <option value="transmission">Transmission</option>
    </select>
    <label>Debit Order Date</label>
    <select name="debit_date">
      <option value="1">1st</option>
      <option value="7">7th</option>
      <option value="15">15th</option>
      <option value="25">25th</option>
      <option value="29">29th</option>
      <option value="30">30th</option>
    </select>
    <div class="terms">${terms || 'Terms unavailable.'}</div>
    <label><input type="checkbox" name="agree" required> I agree to the Debit Order terms</label><br><br>
    <button type="submit">Submit</button>
    <button type="button" onclick="window.location.href='/info/eft?id=${id || ''}'" style="background: grey; margin-left:10px;">Prefer EFT?</button>
  </form>
</div>
</body>
</html>`;
}
// --- Splynx helpers (API v2.0, Basic auth via env) ---
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPUT(env, endpoint, payload) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Splynx PUT ${endpoint} ${r.status}`);
  return r.json().catch(() => ({}));
}

// pick any msisdn in 27xxxxxxxxx format from a messy object
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
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
  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id: id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city: src.city || "",
    street: src.street || "",
    zip: src.zip_code || src.zip || "",
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// --- Admin Dashboard HTML (at "/") ---
function renderAdminPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
  .card { background:#fff; max-width:1000px; margin:2.0em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.4em 1.6em; }
  .logo { display:block; margin:0 auto 1em; max-width:90px; }
  h1, h2 { color:#e2001a; }
  .tabs { display:flex; gap:.5em; flex-wrap:wrap; margin:.2em 0 1em; }
  .tab { padding:.55em 1.0em; border-radius:.7em; border:2px solid #e2001a; color:#e2001a; cursor:pointer; user-select:none; }
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
    <div class="tabs">
      <div class="tab active" data-tab="gen">1. Generate onboarding link</div>
      <div class="tab" data-tab="staff">2. Generate verification code</div>
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

// --- Admin client JS (served at /static/admin.js) ---
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
// --- Worker entry ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // small helpers
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "";
    const getUA = () => request.headers.get("user-agent") || "";

    // -------- Admin dashboard --------
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // -------- Info pages --------
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/info/debit" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderDebitPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // -------- Terms (service + debit) --------
    if (path === "/api/terms" && method === "GET") {
      const pay = (url.searchParams.get("pay") || "eft").toLowerCase();
      const svcUrl =
        env.TERMS_SERVICE_URL ||
        "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl =
        env.TERMS_DEBIT_URL ||
        "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

      async function getText(u) {
        try {
          const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } });
          return r.ok ? await r.text() : "";
        } catch {
          return "";
        }
      }
      const service = await getText(svcUrl);
      const debit = pay === "debit" ? await getText(debUrl) : "";

      const body = `
        <h3>Service Terms</h3>
        <pre style="white-space:pre-wrap">${(service || "").replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>
        ${debit ? `<hr/><h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${(debit || "").replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]))}</pre>` : ""}
      `;
      return new Response(body || "<p>Terms unavailable.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // -------- Debit save (from /info/debit and inline flow) --------
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const required = [
        "account_holder",
        "id_number",
        "bank_name",
        "account_number",
        "account_type",
        "debit_day",
      ];
      for (const k of required) {
        if (!b[k] || String(b[k]).trim() === "") {
          return json({ ok: false, error: `Missing ${k}` }, 400);
        }
      }
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = {
        ...b,
        splynx_id: id,
        created: ts,
        ip: getIP(),
        ua: getUA(),
      };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 90,
      });
      return json({ ok: true, ref: key });
    }

    // -------- Admin: generate link --------
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

    // -------- Admin: staff OTP code --------
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

    // -------- WhatsApp OTP send / verify --------
    async function sendWhatsAppTemplate(toMsisdn, code, lang = "en") {
      const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "template",
        template: {
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            // Button with URL param often expects <= 15 chars; we pass last 6 only
            { type: "button", sub_type: "url", index: "0",
              parameters: [{ type: "text", text: code.slice(-6) }] }
          ],
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
        // fallback to plain text if session window is open
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

    // (next: onboarding UI, uploads, progress, admin review, PDF)
    // -------- Onboarding UI --------
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // -------- Onboarding: submit data and uploads --------
    if (path === "/api/onboard/save" && method === "POST") {
      const { linkid, data } = await request.json().catch(() => ({}));
      if (!linkid || !data) return json({ ok: false, error: "Missing params" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Invalid link" }, 404);

      // store pending changes for admin approval
      await env.ONBOARD_KV.put(`pending/${linkid}`, JSON.stringify(data), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ ...sess, progress: 50, pending: true }),
        { expirationTtl: 86400 }
      );
      return json({ ok: true });
    }

    // -------- Onboarding: file uploads --------
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });

      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      return json({ ok: true, key });
    }

    // -------- Admin: list pending onboardings --------
    if (path === "/api/admin/pending" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const list = await env.ONBOARD_KV.list({ prefix: "pending/" });
      const out = [];
      for (const i of list.keys) {
        const data = await env.ONBOARD_KV.get(i.name, "json");
        out.push({ linkid: i.name.split("/")[1], data });
      }
      return json({ ok: true, items: out });
    }

    // -------- Admin: approve onboarding --------
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

      const pendingData = await env.ONBOARD_KV.get(`pending/${linkid}`, "json");
      if (!pendingData) return json({ ok: false, error: "No pending data" }, 404);

      // fill PDFs
      const msaPdf = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf");
      const doPdf = await fetch("https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf");
      const { PDFDocument } = await import("pdf-lib");

      async function fillPdf(templateRes, fields) {
        const bytes = new Uint8Array(await templateRes.arrayBuffer());
        const pdfDoc = await PDFDocument.load(bytes);
        const form = pdfDoc.getForm();
        for (const [k, v] of Object.entries(fields)) {
          try {
            form.getTextField(k).setText(String(v));
          } catch {}
        }
        form.flatten();
        return await pdfDoc.save();
      }

      const msaFields = {
        full_name: pendingData.full_name || "",
        id_number: pendingData.id_number || "",
        customer_id: pendingData.splynx_id || "",
        date: new Date().toLocaleDateString(),
      };
      const doFields = {
        account_holder: pendingData.bank_account_holder || "",
        id_number: pendingData.bank_account_holder_id || "",
        bank_name: pendingData.bank_name || "",
        account_number: pendingData.bank_account_no || "",
        account_type: pendingData.bank_account_type || "",
        debit_day: pendingData.debit_day || "",
      };

      const msaOut = await fillPdf(msaPdf, msaFields);
      const doOut = await fillPdf(doPdf, doFields);

      const msaKey = `approved/${linkid}_msa.pdf`;
      const doKey = `approved/${linkid}_do.pdf`;
      await env.R2_UPLOADS.put(msaKey, msaOut);
      await env.R2_UPLOADS.put(doKey, doOut);

      // push to Splynx here (customer update + docs upload)
      const pushRes = await pushToSplynx(env, pendingData);
      if (!pushRes.ok) return json({ ok: false, error: "Failed to push to Splynx" }, 502);

      await env.ONBOARD_KV.delete(`pending/${linkid}`);
      return json({ ok: true, msa_url: msaKey, do_url: doKey });
    }
    // -------- Save progress --------
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: getIP(), last_ua: getUA(), last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok: true });
    }

    // -------- Store signature + mark pending --------
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) {
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      }
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok: false, error: "Unknown session" }, 404);

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        ...sess,
        agreement_signed: true,
        agreement_sig_key: sigKey,
        status: "pending"  // waiting for admin approval
      }), { expirationTtl: 86400 });

      return json({ ok: true, sigKey });
    }

    // -------- Admin list (for tabs 3/4/5) --------
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

    // -------- Simple admin review page --------
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });

      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${
            uploads.map(u =>
              `<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em">
                <b>${u.label}</b> — ${u.name} • ${Math.round((u.size||0)/1024)} KB
              </li>`).join("")
          }</ul>`
        : `<div class="note">No files</div>`;

      return new Response(`
<!DOCTYPE html><html><head><meta charset="utf-8"/>
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

    // -------- Admin: reject (sets status) --------
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

    // -------- Onboarding UI renderer --------
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
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid = ${JSON.stringify(linkid)};
  const stepEl = document.getElementById('step');
  const progEl = document.getElementById('prog');
  let step = 0;
  let state = { progress: 0, edits: {}, uploads: [], pay_method: 'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
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
      '<h2>Contact Preferences</h2>',
      '<div class="field"><label>Preferred Language</label><select id="lang"><option value="en" '+(state.lang==='en'?'selected':'')+'>English</option><option value="af" '+(state.lang==='af'?'selected':'')+'>Afrikaans</option><option value="both" '+(state.lang==='both'?'selected':'')+'>Both</option></select></div>',
      '<div class="field"><label>Payment Method</label><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="field"><label>Secondary Contact (optional)</label><input id="secondary" placeholder="Name and number (optional)" value="'+(state.secondary||'')+'" /></div>',
      '<div class="row"><a class="btn-outline" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>'
    ].join('');

    function renderDebitForm(){
      const d = state.debit || {};
      const box = document.getElementById('debitBox');
      box.style.display = 'block';
      box.innerHTML = [
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
        '<div class="termsbox" id="debitTerms">Loading terms...</div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?pay=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();
    }
    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); save(); step2(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm();

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      state.lang = document.getElementById('lang').value;
      state.secondary = document.getElementById('secondary').value || '';
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
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Looks good</button></div>',
          '<div class="note">We\\u2019ll use these updates later to sync with our system.</div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML=[
      '<h2>Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field"><label><input type="checkbox" id="agreeChk"/> I have read and accept the terms</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const pay=(state.pay_method||'eft'); const r=await fetch('/api/terms?pay='+encodeURIComponent(pay)); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to accept the terms.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=5; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  function step5(){
    stepEl.innerHTML='<h2>All set!</h2><p>Thanks — we\\u2019ve recorded your onboarding. Our team will review and approve shortly.</p>';
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5][step](); }
  render();
})();
</script>
</body></html>`;
    }

    // -------- Splynx profile endpoint (used in UI) --------
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // -------- Push to Splynx (stub) --------
    async function pushToSplynx(env, pendingData) {
      // TODO: implement actual PUT/POST to Splynx using splynxPUT()/files upload
      // For now we just pretend it worked.
      return { ok: true };
    }

    // -------- Fallback 404 --------
    return new Response("Not found", { status: 404 });
  }
};
