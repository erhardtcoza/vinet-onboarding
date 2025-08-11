// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, EFT & Debit Order pages
// This build:
//  • Debit Order step: signature canvas + required checkbox
//  • Robust ID/Passport extraction from Splynx (customers & leads)
//  • Uploads step (ID + Proof of Address)
//  • OTP (WhatsApp + staff code) as in working copy
//  • Final page with downloadable agreements (PDF stamping from templates)
//  • Field-box tuner at /agreements/tuner (drag red boxes, save to KV)
//  • PDF stamping reads field boxes from KV (fallback to defaults)
//  • /agreements/pdf/{msa|debit}/{linkid}[?bbox=1] to render stamped PDFs

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ALLOWED_IPS = ["160.226.128.0/20"]; // VNET ASN range
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// ---- PDF template URLs (env overrides these) ----
const DEFAULT_MSA_PDF   = "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
const DEFAULT_DEBIT_PDF = "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";

// ---- Default field boxes (starting points; refine in tuner & save to KV) ----
const DEFAULT_FIELDS = {
  msa: [
    { name: "full_name", page: 0, x: 120, y: 640, w: 300, h: 16, fontSize: 12, align: "left", label: "Full name" },
    { name: "email",     page: 0, x: 120, y: 620, w: 300, h: 16, fontSize: 12, align: "left", label: "Email" },
    { name: "phone",     page: 0, x: 120, y: 600, w: 200, h: 16, fontSize: 12, align: "left", label: "Phone" },
    { name: "passport",  page: 0, x: 120, y: 580, w: 220, h: 16, fontSize: 12, align: "left", label: "ID / Passport" },
    { name: "street",    page: 0, x: 120, y: 560, w: 360, h: 16, fontSize: 12, align: "left", label: "Street" },
    { name: "city_zip",  page: 0, x: 120, y: 540, w: 260, h: 16, fontSize: 12, align: "left", label: "City + ZIP" },
    { name: "sig",       page: 0, x: 120, y: 300, w: 260, h: 40, fontSize: 12, align: "left", label: "Signature (image box)" },
    { name: "sig_date",  page: 0, x: 420, y: 300, w: 100, h: 16, fontSize: 12, align: "left", label: "Date" },
  ],
  debit: [
    { name: "account_holder", page: 0, x: 160, y: 640, w: 300, h: 16, fontSize: 12, align: "left", label: "Account holder" },
    { name: "id_number",      page: 0, x: 160, y: 620, w: 220, h: 16, fontSize: 12, align: "left", label: "ID number" },
    { name: "bank_name",      page: 0, x: 160, y: 600, w: 200, h: 16, fontSize: 12, align: "left", label: "Bank" },
    { name: "account_number", page: 0, x: 160, y: 580, w: 220, h: 16, fontSize: 12, align: "left", label: "Account no" },
    { name: "account_type",   page: 0, x: 160, y: 560, w: 160, h: 16, fontSize: 12, align: "left", label: "Type" },
    { name: "debit_day",      page: 0, x: 160, y: 540, w:  80, h: 16, fontSize: 12, align: "left", label: "Debit day" },
    { name: "sig",            page: 0, x: 120, y: 300, w: 260, h: 40, fontSize: 12, align: "left", label: "Signature (image box)" },
    { name: "sig_date",       page: 0, x: 420, y: 300, w: 100, h: 16, fontSize: 12, align: "left", label: "Date" },
  ],
};

// ---- Helpers for field storage ----
function kvFieldsKey(type) { return `tpl_fields/${type}`; }
function templateUrlFor(env, type) {
  return type === "msa"
    ? (env.SERVICE_PDF_KEY || DEFAULT_MSA_PDF)
    : (env.DEBIT_PDF_KEY   || DEFAULT_DEBIT_PDF);
}

// ---------- Generic helpers ----------
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) return "";
  return res.text();
}

// ---------- EFT Info Page ----------
async function renderEFTPage(id) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7fa}
.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{color:#e2001a;font-size:34px;margin:8px 0 18px}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.grid .full{grid-column:1 / -1}
label{font-weight:700;color:#333;font-size:14px}
input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}
button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}
.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${id||""}"></div>
  </div>
  <p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;
}

// ---------- Splynx helpers ----------
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
function pickFrom(obj, keyNames) {
  if (!obj) return null;
  const wanted = keyNames.map(k => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === 'object') {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? '').trim();
          if (s) return s;
        }
        if (v && typeof v === 'object') stack.push(v);
      }
    }
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
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street ?? src.address ?? src.address_1 ?? src.street_1 ??
    (src.addresses && (src.addresses.street || src.addresses.address_1)) ?? '';

  const city =
    src.city ?? (src.addresses && src.addresses.city) ?? '';

  const zip =
    src.zip_code ?? src.zip ??
    (src.addresses && (src.addresses.zip || src.addresses.zip_code)) ?? '';

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ['passport','id_number','idnumber','national_id','id_card','identity','identity_number','document_number']) ||
    '';

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- Admin Dashboard (HTML + JS) ----------
function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px} h1,h2{color:#e2001a}
.tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
.tab{padding:.55em 1em;border-radius:.7em;border:2px solid #e2001a;color:#e2001a;cursor:pointer}
.tab.active{background:#e2001a;color:#fff}
.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
.btn-secondary{background:#eee;color:#222;border:0;border-radius:.7em;padding:.5em 1em;text-decoration:none;display:inline-block}
.field{margin:.9em 0} input{width:100%;padding:.6em;border-radius:.5em;border:1px solid #ddd}
.row{display:flex;gap:.75em}.row>*{flex:1}
table{width:100%;border-collapse:collapse} th,td{padding:.6em .5em;border-bottom:1px solid #eee;text-align:left}
.note{font-size:12px;color:#666} #out a{word-break:break-all}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <h1 style="text-align:center">Admin Dashboard</h1>
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
</body></html>`;
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
    const node = html => { const d=document.createElement('div'); d.innerHTML=html; return d; };

    async function load(which){
      if (which==='gen') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Splynx Lead/Customer ID</label><div class="row"><input id="id" autocomplete="off"/><button class="btn" id="go">Generate</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const id=v.querySelector('#id').value.trim(); const out=v.querySelector('#out');
          if(!id){out.textContent='Please enter an ID.';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.url?'<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>':'Error generating link.';
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (which==='staff') {
        content.innerHTML='';
        const v=node('<div class="field" style="max-width:640px;margin:0 auto;"><label>Onboarding Link ID (e.g. 319_ab12cd34)</label><div class="row"><input id="linkid" autocomplete="off"/><button class="btn" id="go">Generate staff code</button></div><div id="out" class="field note" style="margin-top:.6em"></div></div>');
        v.querySelector('#go').onclick=async()=>{
          const linkid=v.querySelector('#linkid').value.trim(); const out=v.querySelector('#out');
          if(!linkid){out.textContent='Enter linkid';return;}
          out.textContent='Working...';
          try{
            const r=await fetch('/api/staff/gen',{method:'POST',body:JSON.stringify({linkid})});
            const d=await r.json().catch(()=>({}));
            out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> (valid 15 min)':(d.error||'Failed');
          }catch{out.textContent='Network error.';}
        };
        content.appendChild(v); return;
      }
      if (['inprog','pending','approved'].includes(which)) {
        content.innerHTML='Loading...';
        try{
          const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
          const rows=(d.items||[]).map(i=>'<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+(which==='pending'?'<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>':'<a class="btn-secondary" href="/onboard/'+i.linkid+'" target="_blank">Open</a>')+'</td></tr>').join('')||'<tr><td colspan="4">No records.</td></tr>';
          content.innerHTML='<table style="max-width:900px;margin:0 auto"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        }catch{content.innerHTML='Failed to load.';}
        return;
      }
    }
  })();`;
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // ----- Admin UI -----
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }

    // ----- Info pages -----
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Terms -----
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const pay = (url.searchParams.get("pay") || "").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
      const debUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
      async function getText(u){ try{ const r=await fetch(u,{cf:{cacheEverything:true,cacheTtl:300}}); return r.ok?await r.text():""; }catch{return "";} }
      const esc = s => s.replace(/[&<>]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[t]));
      const service = esc(await getText(svcUrl) || "");
      const debit = esc(await getText(debUrl) || "");
      let body = "";
      if (kind === "debit" || pay === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Debit save -----
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(async () => {
        const form = await request.formData().catch(()=>null);
        if (!form) return {};
        const o = {}; for (const [k,v] of form.entries()) o[k]=v; return o;
      });
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP(), ua:getUA() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      return json({ ok:true, ref:key });
    }

    // ----- Store debit-order signature -----
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // ----- Admin: generate link -----
    if (path === "/api/admin/genlink" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // ----- Admin: staff OTP -----
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    // ----- WhatsApp OTP send/verify -----
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
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] }
          ],
        },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const t = await r.text().catch(()=>""); throw new Error(`WA template send failed ${r.status} ${t}`); }
    }
    async function sendWhatsAppTextIfSessionOpen(toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"text", text:{ body:bodyText } };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const t = await r.text().catch(()=>""); throw new Error(`WA text send failed ${r.status} ${t}`); }
    }
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      let msisdn = null;
      try { msisdn = await fetchCustomerMsisdn(env, splynxId); } catch { return json({ ok:false, error:"Splynx lookup failed" }, 502); }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });
      try { await sendWhatsAppTemplate(msisdn, code, "en"); return json({ ok:true }); }
      catch(e){ try { await sendWhatsAppTextIfSessionOpen(msisdn, `Your Vinet verification code is: ${code}`); return json({ ok:true, note:"sent-as-text" }); }
        catch { return json({ ok:false, error:"WhatsApp send failed (template+text)" }, 502); } }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(() => ({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // ----- Onboarding UI -----
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Uploads (R2) -----
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      return json({ ok:true, key });
    }

    // ----- Save progress -----
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip:getIP(), last_ua:getUA(), last_time:Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // ----- Service agreement signature -----
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // ----- Admin list -----
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
        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // ----- Admin review -----
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${u.label}</b> — ${u.name} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${sess.id}</b> • LinkID: <code>${linkid}</code> • Status: <b>${sess.status||'n/a'}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${k}</b>: ${v?String(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreement</h2><div class="note">Accepted: ${sess.agreement_signed ? "Yes" : "No"}</div>
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    // ---------- Agreements (files) ----------
    const escapeHtml = (s) => String(s||'').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

    // Serve MSA signature PNG
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // Serve Debit signature PNG
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i,'');
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // ----- Agreement field boxes API (used by tuner) -----
    if (path === "/api/agreement/fields" && method === "GET") {
      const type = (url.searchParams.get("type") || "").toLowerCase();
      if (!["msa","debit"].includes(type)) {
        return new Response("Bad type", { status: 400 });
      }
      const stored = await env.ONBOARD_KV.get(kvFieldsKey(type), "json");
      const fields = Array.isArray(stored) ? stored : DEFAULT_FIELDS[type];
      return new Response(JSON.stringify({ ok: true, type, fields }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (path === "/api/agreement/fields" && method === "POST") {
      const body = await request.json().catch(()=> ({}));
      const type = String(body.type || "").toLowerCase();
      const fields = Array.isArray(body.fields) ? body.fields : null;
      if (!["msa","debit"].includes(type) || !fields) {
        return new Response(JSON.stringify({ ok:false, error:"Bad payload" }), {
          status: 400, headers:{ "content-type":"application/json" }
        });
      }
      await env.ONBOARD_KV.put(kvFieldsKey(type), JSON.stringify(fields));
      return new Response(JSON.stringify({ ok:true }), {
        headers: { "content-type": "application/json" }
      });
    }

    // ---------- PDF stamping endpoints ----------
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const parts = path.split("/");
      const type = parts[3];
      const linkid = parts[4] || "";
      const showBBox = url.searchParams.get("bbox") === "1";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      try {
        if (type === "msa")  return await renderMsaPdf(env, linkid, showBBox);
        if (type === "debit") return await renderDebitPdf(env, linkid, showBBox);
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed: " + (e?.message || String(e)), { status: 500 });
      }
    }

    // ----- Field-box tuner (drag red boxes over page 1; save to KV) -----
    if (path === "/agreements/tuner" && method === "GET") {
      const type = (url.searchParams.get("type") || "msa").toLowerCase();
      const linkid = url.searchParams.get("linkid") || "";
      if (!["msa","debit"].includes(type)) return new Response("Unknown type", { status: 400 });

      const tplUrl = templateUrlFor(env, type);
      if (!tplUrl) return new Response("Template URL not configured", { status: 500 });

      const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Template Tuner (${type.toUpperCase()})</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;background:#f6f7fb;margin:0;color:#222}
    .bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #eee;padding:10px 12px;display:flex;gap:8px;align-items:center}
    .bar .tag{background:#eef;border:1px solid #dde;padding:4px 8px;border-radius:8px}
    .wrap{max-width:940px;margin:16px auto;padding:0 12px}
    .stage{position:relative;margin:12px auto;display:inline-block;box-shadow:0 4px 16px #0002;background:#fff}
    canvas#pdf{display:block}
    .box{position:absolute;border:2px solid #e2001a;background:rgba(226,0,26,.08);border-radius:6px;cursor:move;user-select:none}
    .box .lbl{position:absolute;top:-18px;left:0;font-size:12px;background:#e2001a;color:#fff;border-radius:4px;padding:2px 6px}
    .row{display:flex;gap:12px;flex-wrap:wrap}
    button,.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
    .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a}
    input[type=range]{width:220px}
    pre{background:#f9f9fb;border:1px solid #eee;padding:10px;border-radius:8px;overflow:auto;max-height:220px}
  </style>
  </head><body>
  <div class="bar">
    <span class="tag">Type: <b>${type.toUpperCase()}</b></span>
    <span class="tag">Link: <code>${linkid || "-"}</code></span>
    <label>Zoom <input id="zoom" type="range" min="50" max="200" value="110"> <span id="zoomv">110%</span></label>
    <button id="save">Save to KV</button>
    <button class="btn-outline" id="copy">Copy JSON</button>
    <a class="btn-outline" id="preview" target="_blank" href="/agreements/pdf/${type}/${linkid || (type + '_demo')}?bbox=1">Open PDF Preview (bbox)</a>
  </div>

  <div class="wrap">
    <div id="msg"></div>
    <div id="stage" class="stage"><canvas id="pdf"></canvas></div>
    <h3>Current JSON</h3>
    <pre id="dump"></pre>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
  <script>
  (async function() {
    const TYPE = ${JSON.stringify(type)};
    const TPL_URL = ${JSON.stringify(tplUrl)};
    const LINKID = ${JSON.stringify(linkid || "")};
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const stage = document.getElementById('stage');
    const canvas = document.getElementById('pdf');
    const ctx = canvas.getContext('2d');
    const dump = document.getElementById('dump');
    const zoomInput = document.getElementById('zoom');
    const zoomVal   = document.getElementById('zoomv');
    const msg = document.getElementById('msg');

    let fields = [];
    try {
      const r = await fetch('/api/agreement/fields?type=' + encodeURIComponent(TYPE));
      const d = await r.json();
      fields = Array.isArray(d.fields) ? d.fields : [];
    } catch(e) { fields = []; }

    let pdfDoc = await pdfjsLib.getDocument(TPL_URL).promise;
    let page = await pdfDoc.getPage(1);

    function render() {
      const pct = parseInt(zoomInput.value, 10)/100;
      zoomVal.textContent = Math.round(pct*100) + '%';
      const vp = page.getViewport({ scale: pct });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      stage.style.width = canvas.width + 'px';
      stage.style.height = canvas.height + 'px';

      const renderTask = page.render({ canvasContext: ctx, viewport: vp });
      renderTask.promise.then(()=> {
        drawBoxes(vp);
      });
    }

    function drawBoxes(viewport) {
      [...stage.querySelectorAll('.box')].forEach(el => el.remove());
      const H = viewport.height, S = viewport.scale;
      const toPx = (pt) => pt * S;
      const fromPx = (px) => px / S;

      fields.forEach((f, i) => {
        const left = toPx(f.x);
        const top  = H - toPx(f.y) - toPx(f.h);
        const w    = toPx(f.w);
        const h    = toPx(f.h);

        const el = document.createElement('div');
        el.className = 'box';
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.dataset.idx = i;

        const lbl = document.createElement('div');
        lbl.className = 'lbl';
        lbl.textContent = f.label || f.name || ('field ' + (i+1));
        el.appendChild(lbl);

        let dragging = false, sx=0, sy=0, startLeft=0, startTop=0;
        const start = (e) => {
          dragging = true;
          const t = e.touches ? e.touches[0] : e;
          sx = t.clientX; sy = t.clientY;
          startLeft = el.offsetLeft; startTop = el.offsetTop;
          e.preventDefault();
        };
        const move = (e) => {
          if (!dragging) return;
          const t = e.touches ? e.touches[0] : e;
          const dx = t.clientX - sx;
          const dy = t.clientY - sy;
          const nl = Math.max(0, Math.min(startLeft + dx, canvas.width - el.offsetWidth));
          const nt = Math.max(0, Math.min(startTop + dy, canvas.height - el.offsetHeight));
          el.style.left = nl + 'px';
          el.style.top = nt + 'px';
          const newXpt = fromPx(nl);
          const newYpt = fromPx(H - nt - el.offsetHeight);
          fields[i].x = +newXpt.toFixed(2);
          fields[i].y = +newYpt.toFixed(2);
          dumpJSON();
        };
        const end = () => { dragging = false; };

        el.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        el.addEventListener('touchstart', start, { passive:false });
        window.addEventListener('touchmove', move, { passive:false });
        window.addEventListener('touchend', end);

        stage.appendChild(el);
      });

      dumpJSON();
    }

    function dumpJSON(){
      dump.textContent = JSON.stringify(fields, null, 2);
    }

    zoomInput.addEventListener('input', render);

    document.getElementById('save').onclick = async () => {
      msg.textContent = 'Saving…';
      try {
        const r = await fetch('/api/agreement/fields', {
          method:'POST',
          headers:{ 'content-type':'application/json' },
          body: JSON.stringify({ type: TYPE, fields })
        });
        const d = await r.json().catch(()=>({}));
        msg.textContent = d.ok ? 'Saved.' : (d.error || 'Failed to save');
        setTimeout(()=> msg.textContent = '', 2000);
      } catch(e) {
        msg.textContent = 'Network error.';
      }
    };

    document.getElementById('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(fields, null, 2)); } catch {}
    };

    render();
  })();
  </script>
  </body></html>`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- Legacy printable HTML agreements (kept for compatibility) -----
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });

      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status: 404 });

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
        .logo{height:60px;display:block;margin:0 auto 10px}@media print {.actions{display:none}}
      </style></head><body><div class="card">
        <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>${escapeHtml(title)}</h1>
        ${body}
        <div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
        <div class="muted">Generated ${today} • Link ${escapeHtml(linkid)}</div>
      </div></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});}

      if (type === "msa") {
        const body = `
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
        const body = `
          <p>This document represents your Debit Order Instruction.</p>
          ${debitHtml}
          <div class="sig"><div class="b">Signature</div>
            <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
          </div>`;
        return page("Debit Order Agreement", body);
      }

      return new Response("Unknown agreement type", { status: 404 });
    }

    // ----- Splynx profile -----
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    // ----- Admin approve stub -----
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
};

// ---------- PDF helpers & renderers ----------
const mm = (v) => v * 2.83464567; // mm -> PDF points

async function fetchBytesFromUrl(urlStr) {
  if (!urlStr) throw new Error("Template URL missing");
  const r = await fetch(urlStr, { cf: { cacheEverything: true, cacheTtl: 600 } });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`fetch ${urlStr} ${r.status} ${txt.slice(0,120)}`);
  }
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

// field helpers
async function getTemplateFields(env, type) {
  const stored = await env.ONBOARD_KV.get(kvFieldsKey(type), "json");
  const arr = Array.isArray(stored) ? stored : DEFAULT_FIELDS[type] || [];
  return Array.isArray(arr) ? arr : [];
}
function byName(arr) {
  const map = Object.create(null);
  for (const f of arr) if (f && f.name) map[f.name] = f;
  return map;
}

function drawText(page, text, x, y, opts) {
  const { font, size = 10, color = rgb(0,0,0), maxWidth = null, lineHeight = 1.2 } = opts || {};
  if (!text) return;
  const words = String(text).split(/\s+/);
  let line = "";
  let cursorY = y;
  const draw = (t) => page.drawText(t, { x, y: cursorY, size, font, color });
  if (!maxWidth) { draw(String(text)); return; }
  for (const w of words) {
    const tryLine = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width <= maxWidth) { line = tryLine; continue; }
    if (line) draw(line);
    line = w;
    cursorY -= size * lineHeight;
  }
  if (line) draw(line);
}
function drawBBox(page, x, y, w, h) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(1,0,0), borderWidth: 0.5, color: rgb(1,0,0), opacity: 0.05 });
}

async function renderMsaPdf(env, linkid, bbox=false) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status: 404 });
  const e = sess.edits || {};
  const dateStr = new Date().toLocaleDateString();

  const tplUrl = templateUrlFor(env, "msa");
  const tplBytes = await fetchBytesFromUrl(tplUrl);
  const pdf = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fieldsArr = await getTemplateFields(env, "msa");
  const F = byName(fieldsArr);

  const pages = pdf.getPages();

  const drawField = (name, value) => {
    const f = F[name]; if (!f) return;
    const p = pages[f.page || 0];
    const size = f.fontSize || 11;
    if (name === "sig") return; // handled later
    if (bbox && f.w) drawBBox(p, f.x, f.y - size*0.2, f.w, size*1.4);
    drawText(p, String(value || ""), f.x, f.y, { font, size, maxWidth: f.w || null });
  };

  // map edits to fields
  drawField("full_name", e.full_name || "");
  drawField("email", e.email || "");
  drawField("phone", e.phone || "");
  drawField("passport", e.passport || "");
  drawField("street", e.street || "");
  const cityZip = [e.city, e.zip].filter(Boolean).join(" ");
  drawField("city_zip", cityZip);
  drawField("sig_date", dateStr);

  // signature image
  if (sess.agreement_sig_key && F.sig) {
    const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sigBytes) {
      const png = await pdf.embedPng(sigBytes);
      const f = F.sig;
      const p = pages[f.page || 0];
      const { width, height } = png.scale(1);
      let w = f.w || width, h = (height/width)*w;
      if (f.h && h > f.h) { h = f.h; w = (width/height)*h; }
      if (bbox && f.w && f.h) drawBBox(p, f.x, f.y, f.w, f.h);
      p.drawImage(png, { x: f.x, y: f.y, width: w, height: h });
    }
  }

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "no-store" }
  });
}

async function renderDebitPdf(env, linkid, bbox=false) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });
  const d = sess.debit || {};
  const dateStr = new Date().toLocaleDateString();

  const tplUrl = templateUrlFor(env, "debit");
  const tplBytes = await fetchBytesFromUrl(tplUrl);
  const pdf = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const fieldsArr = await getTemplateFields(env, "debit");
  const F = byName(fieldsArr);

  const pages = pdf.getPages();

  const drawField = (name, value) => {
    const f = F[name]; if (!f) return;
    const p = pages[f.page || 0];
    const size = f.fontSize || 11;
    if (name === "sig") return;
    if (bbox && f.w) drawBBox(p, f.x, f.y - size*0.2, f.w, size*1.4);
    drawText(p, String(value || ""), f.x, f.y, { font, size, maxWidth: f.w || null });
  };

  drawField("account_holder", d.account_holder || "");
  drawField("id_number", d.id_number || "");
  drawField("bank_name", d.bank_name || "");
  drawField("account_number", d.account_number || "");
  drawField("account_type", d.account_type || "");
  drawField("debit_day", d.debit_day || "");
  drawField("sig_date", dateStr);

  if (sess.debit_sig_key && F.sig) {
    const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sigBytes) {
      const png = await pdf.embedPng(sigBytes);
      const f = F.sig;
      const p = pages[f.page || 0];
      const { width, height } = png.scale(1);
      let w = f.w || width, h = (height/width)*w;
      if (f.h && h > f.h) { h = f.h; w = (width/height)*h; }
      if (bbox && f.w && f.h) drawBBox(p, f.x, f.y, f.w, f.h);
      p.drawImage(png, { x: f.x, y: f.y, width: w, height: h });
    }
  }

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "no-store" }
  });
}

// ---------- Onboarding HTML renderer ----------
function renderOnboardUI(linkid) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:#e2001a}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.4em 0 2.2em;overflow:hidden}
  .progress{height:100%;background:#e2001a;transition:width .4s}
  .row{display:flex;gap:.75em}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid #e2001a;color:#e2001a;padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:#e2001a;color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
</style></head><body>
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

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); } // 0..6
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
    const ctx=canvas.getContext('2d'); let draw=false,last=null,dirty=false;
    function resize(){ const scale=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect(); canvas.width=Math.floor(rect.width*scale); canvas.height=Math.floor(rect.height*scale); ctx.scale(scale,scale); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
    resize(); window.addEventListener('resize',resize);
    function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top}; }
    function start(e){ draw=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!draw) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; dirty=true; e.preventDefault(); }
    function end(){ draw=false; last=null; }
    canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false}); canvas.addEventListener('touchmove',move,{passive:false}); window.addEventListener('touchend',end);
    return { clear(){ const r=canvas.getBoundingClientRect(); ctx.clearRect(0,0,r.width,r.height); dirty=false; }, dataURL(){ return canvas.toDataURL('image/png'); }, isEmpty(){ return !dirty; } };
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
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');

    function renderEft(){
      const id = (linkid||'').split('_')[0];
      const box = document.getElementById('eftBox');
      box.style.display='block';
      box.innerHTML = [
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please make sure you use the correct <b>Reference</b> when making EFT payments.</div>',
        '<div style="display:flex;justify-content:center;margin-top:.6em"><a class="btn-outline" href="/info/eft?id='+id+'" target="_blank" style="text-align:center;min-width:260px">Print banking details</a></div>'
      ].join('');
    }

    let dPad = null; // debit signature pad
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
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');

      (async()=>{ try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; } })();

      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick = (e)=>{ e.preventDefault(); dPad.clear(); };
    }

    function hideDebitForm(){ const box=document.getElementById('debitBox'); box.style.display='none'; box.innerHTML=''; dPad=null; }
    function hideEft(){ const box=document.getElementById('eftBox'); box.style.display='none'; box.innerHTML=''; }

    document.getElementById('pm-eft').onclick = ()=>{ state.pay_method='eft'; hideDebitForm(); renderEft(); save(); };
    document.getElementById('pm-debit').onclick = ()=>{ state.pay_method='debit'; hideEft(); renderDebitForm(); save(); };

    if (pay === 'debit') renderDebitForm(); else renderEft();

    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method === 'debit') {
        const msg = document.getElementById('d_msg');
        if (!document.getElementById('d_agree').checked) { msg.textContent='Please confirm you agree to the Debit Order terms.'; return; }
        if (!dPad || dPad.isEmpty()) { msg.textContent='Please add your signature for the Debit Order.'; return; }
        state.debit = {
          account_holder: document.getElementById('d_holder').value.trim(),
          id_number:      document.getElementById('d_id').value.trim(),
          bank_name:      document.getElementById('d_bank').value.trim(),
          account_number: document.getElementById('d_acc').value.trim(),
          account_type:   document.getElementById('d_type').value,
          debit_day:      document.getElementById('d_day').value,
          agreed:         true
        };
        try {
          const id = (linkid||'').split('_')[0];
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id }) });
          await fetch('/api/debit/sign', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ linkid, dataUrl: dPad.dataURL() }) });
        } catch {}
      }
      step=3; state.progress=step; setProg(); save(); render();
    };
  }

  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        const p=await r.json();
        const cur={ full_name: state.edits.full_name ?? p.full_name ?? '', email: state.edits.email ?? p.email ?? '', phone: state.edits.phone ?? p.phone ?? '', passport: state.edits.passport ?? p.passport ?? '', street: state.edits.street ?? p.street ?? '', city: state.edits.city ?? p.city ?? '', zip: state.edits.zip ?? p.zip ?? '' };
        document.getElementById('box').innerHTML=[
          '<div class="row"><div class="field"><label>Full name</label><input id="f_full" value="'+(cur.full_name||'')+'"/></div><div class="field"><label>ID / Passport</label><input id="f_id" value="'+(cur.passport||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Email</label><input id="f_email" value="'+(cur.email||'')+'"/></div><div class="field"><label>Phone</label><input id="f_phone" value="'+(cur.phone||'')+'"/></div></div>',
          '<div class="row"><div class="field"><label>Street</label><input id="f_street" value="'+(cur.street||'')+'"/></div><div class="field"><label>City</label><input id="f_city" value="'+(cur.city||'')+'"/></div></div>',
          '<div class="field"><label>ZIP Code</label><input id="f_zip" value="'+(cur.zip||'')+'"/></div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  // --- Step 4: Uploads (ID & Proof of Address) ---
  function step4(){
    stepEl.innerHTML = [
      '<h2>Upload documents</h2>',
      '<div class="note">Please upload your ID and Proof of Address (max 2 files, 5MB each).</div>',
      '<div class="field"><input type="file" id="file1" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div class="field"><input type="file" id="file2" accept=".png,.jpg,.jpeg,.pdf,image/*" /></div>',
      '<div id="uMsg" class="note"></div>',
      '<div class="row"><a class="btn-outline" id="back3">Back</a><button class="btn" id="next">Continue</button></div>'
    ].join('');

    document.getElementById('back3').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('next').onclick=async(e)=>{
      e.preventDefault();
      const msg = document.getElementById('uMsg');
      async function up(file, label){
        if (!file) return null;
        if (file.size > 5*1024*1024) { msg.textContent = 'Each file must be 5MB or smaller.'; throw new Error('too big'); }
        const buf = await file.arrayBuffer();
        const name = (file.name||'file').replace(/[^a-z0-9_.-]/gi,'_');
        const r = await fetch('/api/onboard/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(name)+'&label='+encodeURIComponent(label), { method:'POST', body: buf });
        const d = await r.json().catch(()=>({ok:false}));
        if (!d.ok) throw new Error('upload failed');
        return { key: d.key, name, size: file.size, label };
      }
      try {
        msg.textContent = 'Uploading...';
        const f1 = document.getElementById('file1').files[0];
        const f2 = document.getElementById('file2').files[0];
        const u1 = await up(f1, 'ID Document');
        const u2 = await up(f2, 'Proof of Address');
        state.uploads = [u1,u2].filter(Boolean);
        msg.textContent = 'Uploaded.';
        step=5; state.progress=step; setProg(); save(); render();
      } catch (err) { if (msg.textContent==='') msg.textContent='Upload failed.'; }
    };
  }

  // --- Step 5: Service Agreement + signature ---
  function step5(){
    stepEl.innerHTML=[
      '<h2>Master Service Agreement</h2>',
      '<div id="terms" class="termsbox">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=6; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  // --- Step 6: Done (with agreement download links) ---
  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we’ve recorded your information. Our team will be in contact shortly. ',
      'If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">',
        '<li><a href="/agreements/pdf/msa/'+linkid+'" target="_blank">Master Service Agreement (PDF)</a> — <a href="/agreements/pdf/msa/'+linkid+'?bbox=1" target="_blank" class="note">debug</a></li>',
        (showDebit ? '<li><a href="/agreements/pdf/debit/'+linkid+'" target="_blank">Debit Order Agreement (PDF)</a> — <a href="/agreements/pdf/debit/'+linkid+'?bbox=1" target="_blank" class="note">debug</a></li>' : ''),
      '</ul>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}
