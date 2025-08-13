// index.js — Vinet Onboarding Worker (merged)
// - Keeps your original admin + onboarding flow UX
// - Generates MSA & Debit PDFs from data (with terms, ID/POA pages, audit page)
// - Robust: if ID/POA missing, prints NO ID UPLOADED / NO POA UPLOADED
// - Approve/Push: syncs info + uploads PDFs/files to Splynx via create-then-upload

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* =========================
   Config & Small Utilities
   ========================= */
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const TERMS_SERVICE_FALLBACK = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const TERMS_DEBIT_FALLBACK   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));

/* IP allow-list for /admin (VNET 160.226.128.0/20) */
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}
const getIP = (req) => req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
const getUA = (req) => req.headers.get("user-agent") || "";

/* =========================
   Splynx Helpers
   ========================= */
async function splynxGET(env, ep) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, { headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` } });
  if (!r.ok) throw new Error(`GET ${ep} ${r.status}`);
  return r.json();
}
async function splynxPATCH(env, ep, body) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: "PATCH",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}`, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`PATCH ${ep} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}
async function splynxPOST(env, ep, body) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: "POST",
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}`, "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(`POST ${ep} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}
async function splynxPOSTForm(env, ep, formData) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, { method: "POST", headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }, body: formData });
  if (!r.ok) throw new Error(`POSTF ${ep} ${r.status}`);
  try { return await r.json(); } catch { return {}; }
}

/* Phone scraping */
function pickPhone(obj) {
  if (!obj) return null;
  const ok = (s) => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; } }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map((k) => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim(); if (s) return s;
        }
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return null;
}
async function fetchCustomerMsisdn(env, id) {
  const eps = [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}`,
    `/admin/crm/leads/${id}`,
    `/admin/customers/${id}/contacts`,
    `/admin/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
  }
  return null;
}
async function fetchProfileForDisplay(env, id) {
  let cust=null, lead=null, contacts=null, custInfo=null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street = src.street || src.address || src.address_1 || src.street_1 || pickFrom(src, ["street","address","address_1","street_1"]) || pickFrom(custInfo, ["street","address","address_1","street_1"]) || "";
  const city   = src.city   || pickFrom(src, ["city","town"]) || pickFrom(custInfo, ["city","town"]) || "";
  const zip    = src.zip_code || src.zip || pickFrom(src, ["zip","zip_code","postal_code"]) || pickFrom(custInfo, ["zip","zip_code","postal_code"]) || "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","identity_number","idnumber","document_number","id_card"]) || "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id, full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
  };
}

/* =========================
   WhatsApp OTP (template + fallback)
   ========================= */
async function sendWATemplate(env, to, code) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] }
      ]
    }
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template ${r.status} ${await r.text()}`);
}
async function sendWAText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text ${r.status} ${await r.text()}`);
}

/* =========================
   R2 Helpers
   ========================= */
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

/* =========================
   Terms Fetch
   ========================= */
async function getTerms(env, kind) {
  const url = kind === "debit" ? (env.TERMS_DEBIT_URL || TERMS_DEBIT_FALLBACK)
                               : (env.TERMS_SERVICE_URL || TERMS_SERVICE_FALLBACK);
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}

/* =========================
   PDF Makers (no templates)
   ========================= */
function drawWrappedText(page, text, x, y, maxWidth, font, size, lineHeight=1.3) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) page.drawText(line, { x, y: cy, size, font, color: rgb(0,0,0) });
      line = w;
      cy -= size * lineHeight;
    }
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color: rgb(0,0,0) });
  return cy;
}

async function renderMSA(env, sess, linkid) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const idOnly = (linkid || "").split("_")[0];
  const e = sess.edits || {};
  const terms = await getTerms(env, "service");

  // Page 1 — Header & basics
  let page = pdf.addPage([595, 842]);
  let y = 800;
  page.drawText("Master Service Agreement", { x: 50, y, size: 18, font: titleFont, color: rgb(0.88,0,0.1) });
  y -= 40;
  page.drawText(`Full Name: ${e.full_name || ""}`, { x: 125, y: y-0, size: 12, font });
  page.drawText(`ID / Passport: ${e.passport || ""}`, { x: 125, y: y-35, size: 12, font });
  page.drawText(`Vinet Client Code: ${idOnly}`, { x: 145, y: y-65, size: 12, font });

  // Page 2 — Terms
  page = pdf.addPage([595, 842]); y = 800;
  page.drawText("Service Terms", { x: 50, y, size: 14, font: titleFont, color: rgb(0.2,0.2,0.2) });
  y -= 24;
  drawWrappedText(page, terms || "Terms not available.", 50, y, 495, font, 10);

  // Page 3 — ID
  page = pdf.addPage([595, 842]); y = 800;
  page.drawText("ID Document", { x: 50, y, size: 14, font: titleFont });
  y -= 20;
  const idUpload = (sess.uploads || []).find(u => /id/i.test(u?.label || ""));
  if (idUpload) {
    const bytes = await fetchR2Bytes(env, idUpload.key);
    if (bytes) {
      try {
        const mime = (idUpload.name||"").toLowerCase().endsWith(".pdf") ? "pdf" : "img";
        if (mime === "img") {
          const tryPng = await (async () => { try { return await pdf.embedPng(bytes); } catch { return null; }})();
          const img = tryPng || await pdf.embedJpg(bytes);
          const iw = 450, ih = (img.height / img.width) * iw;
          page.drawImage(img, { x: 50, y: 300, width: iw, height: ih });
        } else {
          page.drawText("Attached file is PDF — preview not embedded.", { x: 50, y: 760, size: 10, font, color: rgb(0.5,0,0) });
        }
      } catch {
        page.drawText("Could not render ID preview.", { x: 50, y: 760, size: 10, font, color: rgb(0.6,0,0) });
      }
    } else {
      page.drawText("NO ID UPLOADED", { x: 50, y: 760, size: 14, font, color: rgb(1,0,0) });
    }
  } else {
    page.drawText("NO ID UPLOADED", { x: 50, y: 760, size: 14, font, color: rgb(1,0,0) });
  }

  // Page 4 — POA
  page = pdf.addPage([595, 842]); y = 800;
  page.drawText("Proof of Address", { x: 50, y, size: 14, font: titleFont });
  y -= 20;
  const poaUpload = (sess.uploads || []).find(u => /address|poa/i.test(u?.label || "") );
  if (poaUpload) {
    const bytes = await fetchR2Bytes(env, poaUpload.key);
    if (bytes) {
      try {
        const mime = (poaUpload.name||"").toLowerCase().endsWith(".pdf") ? "pdf" : "img";
        if (mime === "img") {
          const tryPng = await (async () => { try { return await pdf.embedPng(bytes); } catch { return null; }})();
          const img = tryPng || await pdf.embedJpg(bytes);
          const iw = 450, ih = (img.height / img.width) * iw;
          page.drawImage(img, { x: 50, y: 300, width: iw, height: ih });
        } else {
          page.drawText("Attached file is PDF — preview not embedded.", { x: 50, y: 760, size: 10, font, color: rgb(0.5,0,0) });
        }
      } catch {
        page.drawText("Could not render POA preview.", { x: 50, y: 760, size: 10, font, color: rgb(0.6,0,0) });
      }
    } else {
      page.drawText("NO POA UPLOADED", { x: 50, y: 760, size: 14, font, color: rgb(1,0,0) });
    }
  } else {
    page.drawText("NO POA UPLOADED", { x: 50, y: 760, size: 14, font, color: rgb(1,0,0) });
  }

  // Page 5 — Signature & Date block
  page = pdf.addPage([595, 842]); y = 800;
  page.drawText("Agreement Confirmation", { x: 50, y, size: 14, font: titleFont }); y -= 30;
  page.drawText(`Full Name: ${e.full_name || ""}`, { x: 50, y, size: 12, font }); y -= 20;
  page.drawText(`Date: ${new Date(sess.last_time || Date.now()).toLocaleDateString()}`, { x: 50, y, size: 12, font }); y -= 20;
  if (sess.agreement_sig_key) {
    const sigBytes = await fetchR2Bytes(env, sess.agreement_sig_key);
    if (sigBytes) {
      try {
        const img = await (async()=>{ try { return await pdf.embedPng(sigBytes);} catch { return null; } })();
        if (img) {
          const w=180, h=(img.height/img.width)*w;
          page.drawText("Signature:", { x: 50, y: y+110, size: 12, font });
          page.drawImage(img, { x: 50, y: y, width: w, height: h });
        }
      } catch {}
    }
  }

  // Page 6 — Audit
  await appendAuditPage(pdf, sess, linkid);

  return await pdf.save();
}

async function renderDebit(env, sess, linkid) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const idOnly = (linkid || "").split("_")[0];
  const d = sess.debit || {};
  let page = pdf.addPage([595, 842]); let y=800;

  page.drawText("VINET — Debit Order Instruction", { x: 50, y, size: 18, font: bold }); y-=40;
  const rows = [
    ["Account Holder Name:", d.account_holder || ""],
    ["Account Holder ID / Passport:", d.id_number || ""],
    ["Bank:", d.bank_name || ""],
    ["Bank account no:", d.account_number || ""],
    ["Bank account type:", d.account_type || ""],
    ["Debit order date:", d.debit_day || ""],
    ["Vinet Client Code:", idOnly],
    ["Date:", new Date(sess.last_time || Date.now()).toLocaleDateString()]
  ];
  for (const [k,v] of rows) { page.drawText(`${k} ${v}`, { x: 50 + (k.startsWith("Account Holder ID") ? 15 : 0), y, size: 12, font }); y -= 26; }

  // Signature
  if (sess.debit_sig_key) {
    const sigBytes = await fetchR2Bytes(env, sess.debit_sig_key);
    if (sigBytes) {
      try {
        const img = await (async()=>{ try { return await pdf.embedPng(sigBytes);} catch { return null; } })();
        if (img) {
          page.drawText("Signature:", { x: 50, y: y-10, size: 12, font }); 
          const w=160, h=(img.height/img.width)*w;
          page.drawImage(img, { x: 120, y: y-40, width: w, height: h });
        }
      } catch {}
    }
  }

  // Terms page
  page = pdf.addPage([595, 842]); y=800;
  page.drawText("Debit Order Terms", { x: 50, y, size: 14, font: bold }); y -= 24;
  const terms = await getTerms(env, "debit");
  drawWrappedText(page, terms || "Terms not available.", 50, y, 495, font, 10);

  // Audit page
  await appendAuditPage(pdf, sess, linkid);

  return await pdf.save();
}

async function appendAuditPage(pdf, sess, linkid) {
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const t = (sess.last_time) ? new Date(sess.last_time) : new Date();
  const pad = (n)=>String(n).padStart(2,"0");
  const catTime = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const loc = sess.last_loc || {};
  let y = 800;

  page.drawText("VINET — Agreement Security Summary", { x: 50, y, size: 16, font: bold, color: rgb(0.88,0,0.1) }); y -= 28;
  const lines = [
    ["Link ID", linkid],
    ["Splynx ID", (linkid||"").split("_")[0]],
    ["IP Address", sess.last_ip || "n/a"],
    ["Location", [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "n/a"],
    ["Coordinates", (loc.latitude!=null && loc.longitude!=null) ? `${loc.latitude}, ${loc.longitude}` : "n/a"],
    ["ASN / Org", [loc.asn, loc.asOrganization].filter(Boolean).join(" • ") || "n/a"],
    ["Cloudflare PoP", loc.colo || "n/a"],
    ["User-Agent", sess.last_ua || "n/a"],
    ["Device ID", sess.device_id || "n/a"],
    ["Timestamp", catTime]
  ];
  for (const [k,v] of lines) {
    page.drawText(`${k}:`, { x: 50, y, size: 11, font, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(v||""), { x: 170, y, size: 11, font, color: rgb(0,0,0) }); y -= 18;
  }
  page.drawText("This page is appended for audit purposes and should accompany the agreement.", { x: 50, y: 40, size: 10, font, color: rgb(0.4,0.4,0.4) });
}

/* =========================
   Admin & Onboarding UI (kept same layout/flow as agreed)
   ========================= */
function renderRootPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vinet Onboarding</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}
.logo{height:72px;margin:0 auto 6px;display:block}
h1{color:#e2001a;margin:.2em 0 .6em}
.row{display:flex;gap:10px;justify-content:center}
input{padding:.7em .9em;border:1px solid #ddd;border-radius:10px;min-width:300px}
.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:.7em 1.4em;cursor:pointer}
a.btn-secondary{background:#fff;border:2px solid #e2001a;color:#e2001a;border-radius:10px;padding:.6em 1.2em;text-decoration:none;display:inline-block;margin-left:.5em}
.note{font-size:12px;color:#666;margin-top:10px} #out a{word-break:break-all}
</style></head><body>
<div class="card">
  <img src="${LOGO_URL}" class="logo" alt="Vinet">
  <h1>Create onboarding link</h1>
  <div class="row"><input id="id" placeholder="Splynx Lead/Customer ID" autocomplete="off"><button class="btn" id="go">Generate</button></div>
  <div id="out" class="note"></div>
  <div style="margin-top:14px"><a href="/admin" class="btn-secondary">Go to Admin dashboard</a></div>
</div>
<script>
document.getElementById('go').onclick=async()=>{
  const id=document.getElementById('id').value.trim(); const out=document.getElementById('out');
  if(!id){out.textContent='Please enter an ID.';return;}
  out.textContent='Working...';
  try{
    const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    out.innerHTML=d.url?('<b>Onboarding link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'):'Error generating link.';
  }catch{out.textContent='Network error.';}
};
</script></body></html>`;
}

function renderAdminPage(restricted=false) {
  if (restricted) {
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;background:#fafbfc}.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}h1{color:#e2001a}.logo{height:72px;margin:0 auto 8px;display:block}.note{color:#666}</style>
<div class="card"><img class="logo" src="${LOGO_URL}"><h1>Admin — Restricted</h1><p class="note">Access is limited to the VNET network.</p></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin</title>
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
.badge{display:inline-block;background:#eee;border-radius:999px;padding:.2em .6em;font-size:.85em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet"/>
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
<script>
(()=> {
  const tabs = document.querySelectorAll('.tab');
  const content = document.getElementById('content');
  tabs.forEach(t => t.onclick = () => { tabs.forEach(x => x.classList.remove('active')); t.classList.add('active'); load(t.dataset.tab); });
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
          out.innerHTML=d.ok?'Staff code: <b>'+d.code+'</b> <span class="badge">valid 15 min</span>':(d.error||'Failed');
        }catch{out.textContent='Network error.';}
      };
      content.appendChild(v); return;
    }
    if (['inprog','pending','approved'].includes(which)) {
      content.innerHTML='Loading...';
      try{
        const r=await fetch('/api/admin/list?mode='+which); const d=await r.json();
        const rows=(d.items||[]).map(i=>{
          let actions='';
          if(which==='inprog'){
            actions = '<a class="btn-secondary" href="/onboard/'+encodeURIComponent(i.linkid)+'" target="_blank">Open</a> '+
                      '<button class="btn" data-del="'+i.linkid+'">Delete</button>';
          } else if (which==='pending'){
            actions = '<a class="btn" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Review</a>';
          } else {
            actions = '<a class="btn-secondary" href="/admin/review?linkid='+encodeURIComponent(i.linkid)+'">Open</a>';
          }
          return '<tr><td>'+i.id+'</td><td>'+i.linkid+'</td><td>'+new Date(i.updated).toLocaleString()+'</td><td>'+actions+'</td></tr>';
        }).join('')||'<tr><td colspan="4">No records.</td></tr>';
        content.innerHTML='<table style="max-width:900px;margin:0 auto"><thead><tr><th>Splynx ID</th><th>Link ID</th><th>Updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
        document.querySelectorAll('[data-del]').forEach(btn=>{
          btn.onclick=async()=>{
            if(!confirm('Delete this pending link?')) return;
            btn.disabled=true;
            await fetch('/api/admin/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:btn.getAttribute('data-del')})}).catch(()=>{});
            load(which);
          };
        });
      }catch{content.innerHTML='Failed to load.';}
      return;
    }
  }
})();
</script></body></html>`;
}

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
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:800}
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
      if (d.ok) {
        if (m) m.textContent = d.mode==='text-fallback' ? 'Code sent as a WhatsApp text. Check your WhatsApp.' : 'Code sent. Check your WhatsApp.';
      } else {
        if (m) m.textContent = d.error || 'Failed to send.';
        document.getElementById('waBox').style.display='none';
        document.getElementById('staffBox').style.display='block';
        document.getElementById('p-wa').classList.remove('active');
        document.getElementById('p-staff').classList.add('active');
      }
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
    let dPad=null;
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
          await fetch('/api/debit/save', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id, linkid }) });
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
  function step6(){
    const showDebit = (state && state.pay_method === 'debit');
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we’ve recorded your information. Our team will be in contact shortly. ',
      'If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">',
        '<li><a href="/agreements/pdf/msa/'+linkid+'" target="_blank">Master Service Agreement (PDF)</a></li>',
        (showDebit ? '<li><a href="/agreements/pdf/debit/'+linkid+'" target="_blank">Debit Order Agreement (PDF)</a></li>' : ''),
      '</ul>'
    ].join('');
  }
  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script></body></html>`;
}

/* =========================
   Splynx Create-then-Upload Docs
   ========================= */
async function splynxCreateDoc(env, kind, id, title) {
  // kind: "lead" | "customer"
  // Create doc record (type: contract), return doc id
  if (kind === "lead") {
    // POST /admin/crm/leads/{id}/documents
    const body = { title: title || "Agreement", type: "contract", visible_by_customer: 0 };
    const res = await splynxPOST(env, `/admin/crm/leads/${id}/documents`, body);
    return res?.id || res?.data?.id || res?.document_id || null;
  } else {
    // POST /admin/customers/customer/{id}/documents
    const body = { title: title || "Agreement", type: "contract", visible_by_customer: 0 };
    const res = await splynxPOST(env, `/admin/customers/customer/${id}/documents`, body);
    return res?.id || res?.data?.id || res?.document_id || null;
  }
}
async function splynxUploadToDoc(env, kind, docId, fileName, bytes, contentType) {
  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type: contentType || "application/octet-stream" }), fileName || "file.bin");
  if (kind === "lead") {
    // POST /admin/crm/leads-documents/{docId}--upload
    await splynxPOSTForm(env, `/admin/crm/leads-documents/${docId}--upload`, fd);
  } else {
    // POST /admin/customers/customer-documents/${docId}--upload
    await splynxPOSTForm(env, `/admin/customers/customer-documents/${docId}--upload`, fd);
  }
}

/* =========================
   Worker
   ========================= */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};

    /* Root + Admin */
    if (path === "/" && method === "GET") return new Response(renderRootPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response(renderAdminPage(true), { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response(renderAdminPage(false), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    /* Terms HTML */
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const txt = await getTerms(env, kind === "debit" ? "debit" : "service");
      const body = (kind==="debit")
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(txt)}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(txt)}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    /* Generate link */
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    /* Staff OTP */
    if (path === "/api/staff/gen" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown linkid" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
      return json({ ok:true, linkid, code });
    }

    /* OTP send/verify */
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      const msisdn = await fetchCustomerMsisdn(env, splynxId).catch(()=>null);
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) return json({ ok:false, error:"whatsapp-not-configured" }, 501);
      try { await sendWATemplate(env, msisdn, code); return json({ ok:true, mode:"template" }); }
      catch { try { await sendWAText(env, msisdn, `Your Vinet verification code is: ${code}`); return json({ ok:true, mode:"text-fallback" }); }
             catch { return json({ ok:false, error:"whatsapp-send-failed" }, 502); } }
    }
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
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

    /* Onboarding UI */
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    /* Session progress + uploads */
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=>({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const last_loc = {
        city: cf.city || "", region: cf.region || "", country: cf.country || "",
        latitude: cf.latitude || "", longitude: cf.longitude || "",
        timezone: cf.timezone || "", postalCode: cf.postalCode || "",
        asn: cf.asn || "", asOrganization: cf.asOrganization || "", colo: cf.colo || ""
      };
      const next = { ...existing, ...body, last_ip: getIP(request), last_ua: getUA(request), last_loc, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }
    if (path === "/api/onboard/upload" && method === "POST") {
      const q = url.searchParams;
      const linkid = q.get("linkid"); const filename = q.get("filename") || "file.bin";
      const label = q.get("label") || "File";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${filename}`;
      await env.R2_UPLOADS.put(key, body);
      const rec = { key, name: filename, size: body.byteLength, label };
      const next = { ...sess, uploads: [...(sess.uploads||[]), rec] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    /* Signatures */
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
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
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      await env.ONBOARD_KV.put(key, JSON.stringify({ ...b, splynx_id:id, created:ts, ip:getIP(request) }), { expirationTtl: 60*60*24*90 });
      if (b.linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${b.linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${b.linkid}`, JSON.stringify({ ...sess, debit: { ...b } }), { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    /* Admin list/review */
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
        if (mode === "inprog" && !s.agreement_signed && !s.deleted) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending" && !s.deleted) items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved" && !s.deleted) items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${esc(u.label)}</b> — ${esc(u.name)} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      const msaLink = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
      const doLink = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;
      return new Response(`<!doctype html><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}a{color:#e2001a}</style>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id)}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b>: ${v?esc(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreements</h2>
  <div><a href="${msaLink}" target="_blank">Master Service Agreement (PDF)</a></div>
  ${sess.debit_sig_key ? `<div style="margin-top:.5em"><a href="${doLink}" target="_blank">Debit Order Agreement (PDF)</a></div>` : '<div class="note" style="margin-top:.5em">No debit order on file.</div>'}
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button> <button class="btn-outline" id="reject">Reject</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
  document.getElementById('reject').onclick=async()=>{ const reason=prompt('Reason for rejection?')||''; msg.textContent='Rejecting...'; try{ const r=await fetch('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)},reason})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Rejected.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, deleted:true, deleted_at:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }
    if (path === "/api/admin/reject" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid, reason } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl:86400 });
      return json({ ok:true });
    }

    /* PDFs (inline) */
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      try {
        if (type === "msa") {
          if (!sess.agreement_signed) return new Response("Not signed", { status: 400 });
          const bytes = await renderMSA(env, sess, linkid);
          return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="MSA_${(linkid||"").split("_")[0]}.pdf"` } });
        }
        if (type === "debit") {
          const bytes = await renderDebit(env, sess, linkid);
          return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="DO_${(linkid||"").split("_")[0]}.pdf"` } });
        }
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    /* Splynx profile proxy */
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    /* Approve & Push: PATCH + create+upload docs (lead/customer) */
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      const id = (linkid || "").split("_")[0];

      // Detect lead/customer
      let kind = "lead";
      try { await splynxGET(env, `/admin/crm/leads/${id}`); kind = "lead"; }
      catch { try { await splynxGET(env, `/admin/customers/customer/${id}`); kind = "customer"; } catch { return json({ ok:false, error:"id_unknown" }, 404); } }

      // 1) PATCH info
      try {
        const e = sess.edits || {};
        if (kind === "lead") {
          await splynxPATCH(env, `/admin/crm/leads/${id}`, {
            name: e.full_name || undefined,
            email: e.email || undefined,
            billing_email: e.email || undefined,
            phone: e.phone || undefined,
            street_1: e.street || undefined,
            city: e.city || undefined,
            zip_code: e.zip || undefined
          });
        } else {
          // customer core & customer-info (passport)
          await splynxPATCH(env, `/admin/customers/customer/${id}`, {
            full_name: e.full_name || undefined,
            email: e.email || undefined,
            billing_email: e.email || undefined,
            phone: e.phone || undefined,
            street_1: e.street || undefined,
            city: e.city || undefined,
            zip_code: e.zip || undefined
          });
          if (e.passport) {
            try { await splynxPATCH(env, `/admin/customers/customer-info/${id}`, { passport: e.passport }); } catch {}
          }
        }
      } catch (err) {
        return json({ ok:false, error:`patch_failed:${err.message}` }, 502);
      }

      // 2) Build PDFs and upload to Splynx (create -> upload)
      try {
        // MSA (always, once signed)
        if (sess.agreement_signed) {
          const msaBytes = await renderMSA(env, sess, linkid);
          const docId = await splynxCreateDoc(env, kind, id, `MSA_${id}.pdf`);
          if (docId) await splynxUploadToDoc(env, kind, docId, `MSA_${id}.pdf`, msaBytes, "application/pdf");
        }
        // Debit Order (if signed)
        if (sess.debit_sig_key) {
          const doBytes = await renderDebit(env, sess, linkid);
          const docId = await splynxCreateDoc(env, kind, id, `Debit_Order_${id}.pdf`);
          if (docId) await splynxUploadToDoc(env, kind, docId, `Debit_Order_${id}.pdf`, doBytes, "application/pdf");
        }
        // Extra uploaded files
        const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
        for (const u of uploads) {
          const obj = await env.R2_UPLOADS.get(u.key);
          if (!obj) continue;
          const arr = await obj.arrayBuffer();
          const docId = await splynxCreateDoc(env, kind, id, u.name || "upload.bin");
          if (docId) await splynxUploadToDoc(env, kind, docId, u.name || "upload.bin", arr, obj.httpMetadata?.contentType || "application/octet-stream");
        }
      } catch (err) {
        // keep going; still mark approved (files can be retried manually)
      }

      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", approved_at:Date.now() }), { expirationTtl: 60*60*24*30 });
      return json({ ok: true });
    }

    /* EFT printable */
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const body = `<!doctype html><meta charset="utf-8"><title>EFT Payment Details</title>
<style>body{font-family:Arial,sans-serif;background:#f7f7fa}.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}h1{color:#e2001a;font-size:34px;margin:8px 0 18px}.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}.grid .full{grid-column:1 / -1}label{font-weight:700;color:#333;font-size:14px}input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}.note{font-size:13px;color:#555}.logo{display:block;margin:0 auto 8px;height:68px}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style>
<div class="container"><img src="${LOGO_URL}" class="logo"><h1>EFT Payment Details</h1>
<div class="grid"><div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div><div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div><div><label>Account Number</label><input readonly value="62757054996"></div><div><label>Branch Code</label><input readonly value="250655"></div><div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${esc(id)}"></div></div><p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p><div style="margin-top:14px"><button onclick="window.print()">Print</button></div></div>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  }
};