// --- Vinet Onboarding Worker (A4-narrow, branded PDFs, audit page, OTP) ---
// Build: 2025-08-13

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ==============================
   CONFIG
   ============================== */
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// Terms (plaintext) — can override with Wrangler env
const DEFAULT_MSA_TERMS_URL   = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// CF IP allow for admin
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143; // 160.226.128.0/20
}

/* ==============================
   SMALL UTILS
   ============================== */
const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers: { "content-type":"application/json" }});
const esc  = (s) => String(s??"").replace(/[&<>"]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const nowStr = (ms=Date.now())=>{
  const d=new Date(ms); const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
async function getText(url) {
  try { const r=await fetch(url, { cf:{ cacheEverything:true, cacheTtl:600 }}); return r.ok?await r.text():""; }
  catch { return ""; }
}

function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  const direct = [obj.phone_mobile,obj.mobile,obj.phone,obj.whatsapp,obj.msisdn,obj.primary_phone,obj.contact_number,obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; } }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map(k=>String(k).toLowerCase());
  const stack=[obj];
  while (stack.length) {
    const cur=stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k,v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) { const s=String(v??"").trim(); if (s) return s; }
        if (v && typeof v==="object") stack.push(v);
      }
    }
  }
  return null;
}

/* ==============================
   SPLYNX HELPERS (GET / PUT / doc create & upload)
   ============================== */
async function splynxGET(env, ep) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, { headers:{ Authorization:`Basic ${env.SPLYNX_AUTH}` }});
  if (!r.ok) throw new Error(`Splynx GET ${ep} ${r.status}`);
  return r.json();
}
async function splynxPUT(env, ep, data) {
  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: "PUT",
    headers: { Authorization:`Basic ${env.SPLYNX_AUTH}`, "content-type":"application/json" },
    body: JSON.stringify(data||{})
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Splynx PUT ${ep} ${r.status} ${t||""}`);
  }
  try { return await r.json(); } catch { return {}; }
}

// create empty document, returns {id}
async function splynxCreateDoc(env, kind, id, title, filename) {
  // kind: "customer" or "lead"
  const ep = (kind==="lead")
    ? `/admin/crm/leads-documents/${id}`     // POST create returns doc id
    : `/admin/customers/customer-documents/${id}`;

  const payload = {
    title: title || filename || "Agreement",
    visible_by_customer: 0,
    type: "contract",           // as agreed
    filename_uploaded: filename || undefined
  };

  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: "POST",
    headers: { Authorization:`Basic ${env.SPLYNX_AUTH}`, "content-type":"application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`Splynx create-doc ${ep} ${r.status}`);
  return r.json(); // should include { id: ... }
}

// then upload file bytes to that document id
async function splynxUploadDocFile(env, kind, id, docId, bytes, contentType) {
  // upload endpoints differ
  const ep = (kind==="lead")
    ? `/admin/crm/leads-documents/${docId}--upload`
    : `/admin/customers/customer-documents/${docId}--upload`;

  const fd = new FormData();
  fd.set("file", new Blob([bytes], { type: contentType||"application/pdf" }), "document.pdf");

  const r = await fetch(`${env.SPLYNX_API}${ep}`, {
    method: "POST",
    headers: { Authorization:`Basic ${env.SPLYNX_AUTH}` },
    body: fd
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Splynx upload ${ep} ${r.status} ${t||""}`);
  }
  try { return await r.json(); } catch { return {}; }
}

// detect lead vs customer
async function detectKind(env, id) {
  try { await splynxGET(env, `/admin/crm/leads/${id}`); return "lead"; } catch {}
  try { await splynxGET(env, `/admin/customers/customer/${id}`); return "customer"; } catch {}
  return "unknown";
}

// fetch profile for onboard display
async function fetchProfileForDisplay(env, id) {
  let cust=null, lead=null, contacts=null, custInfo=null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });
  const street = src.street || src.address || src.street_1 || pickFrom(src,["street","address","street_1"]) || pickFrom(custInfo,["street","address","street_1"]) || "";
  const city   = src.city   || pickFrom(src,["city","town"]) || pickFrom(custInfo,["city","town"]) || "";
  const zip    = src.zip_code || src.zip || pickFrom(src,["zip","zip_code","postal_code"]) || pickFrom(custInfo,["zip","zip_code","postal_code"]) || "";
  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","identity_number","idnumber","document_number","id_card"]) || "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    street, city, zip, passport
  };
}

/* ==============================
   R2 + KV helpers
   ============================== */
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

/* ==============================
   BRANDING PDF ENGINE (A4-narrow)
   ============================== */
// Page size: Slightly narrower than A4 for a consistent look
const PAGE_W = 560;   // A4 width ~595; make it a bit narrower
const PAGE_H = 842;
const MARGIN = 36;

// Draw header: title (TL), logo + contact (TR), rule under it
async function drawHeader(pdf, page, title, env) {
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const small = await pdf.embedFont(StandardFonts.Helvetica);
  const titleSize = 18;
  const contactSize = 11;

  // Title top-left
  page.drawText(title, { x: MARGIN, y: PAGE_H - MARGIN - titleSize, size: titleSize, font, color: rgb(0.88, 0.0, 0.10) });

  // Logo + contact top-right
  let yTop = PAGE_H - MARGIN - 6; // move a bit down from very top
  try {
    const lr = await fetch(LOGO_URL, { cf:{cacheEverything:true, cacheTtl:300}});
    const lb = await lr.arrayBuffer();
    const logo = (LOGO_URL.toLowerCase().includes(".png"))
      ? await pdf.embedPng(lb)
      : await pdf.embedJpg(lb); // jpeg at URL, but handle either
    const targetW = 120; // 10% bigger than before
    const scale = targetW / logo.width;
    const w = targetW;
    const h = logo.height * scale;

    // place logo a bit lower so line doesn't cross phone number
    const x = PAGE_W - MARGIN - w;
    const y = yTop - h;
    page.drawImage(logo, { x, y, width: w, height: h });
    yTop = y - 6; // below the logo for contact text
  } catch {
    // no logo — just leave title; not fatal
  }

  // Contact (TR under logo)
  const contact = "www.vinet.co.za • 021 007 0200";
  const textW = small.widthOfTextAtSize(contact, contactSize);
  page.drawText(contact, { x: PAGE_W - MARGIN - textW, y: yTop - contactSize, size: contactSize, font: small, color: rgb(0,0,0) });

  // Rule a bit lower (so it doesn't run through phone number)
  page.drawLine({
    start: { x: MARGIN, y: yTop - contactSize - 10 },
    end:   { x: PAGE_W - MARGIN, y: yTop - contactSize - 10 },
    thickness: 1,
    color: rgb(0.9,0.9,0.9)
  });

  return yTop - contactSize - 20; // contentTopY
}

// simple text wrap
function drawWrapped(page, font, text, x, y, maxWidth, size, leading=1.35) {
  const words = String(text||"").split(/\s+/);
  let line="", cy=y;
  for (const w of words) {
    const tryLine = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) { line = tryLine; continue; }
    if (line) page.drawText(line, { x, y: cy, size, font, color: rgb(0,0,0) });
    line = w; cy -= size*leading;
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color: rgb(0,0,0) });
  return cy - size*leading;
}

// signature row: Name (L), Signature (C image), Date (R)
async function drawSignatureRow(pdf, page, nameStr, dateStr, signKeyBytesOrNull, y) {
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold    = await pdf.embedFont(StandardFonts.HelveticaBold);
  const labelSize=11, valueSize=12;

  const colW = (PAGE_W - 2*MARGIN)/3 - 8;

  // Name (left)
  page.drawText("Full name", { x:MARGIN, y:y, size:labelSize, font:bold, color:rgb(0.2,0.2,0.2) });
  page.drawText(nameStr||"", { x:MARGIN, y:y-14, size:valueSize, font:regular, color:rgb(0,0,0) });

  // Signature (center)
  const cx = MARGIN + colW + 12;
  page.drawText("Signature", { x:cx, y:y, size:labelSize, font:bold, color:rgb(0.2,0.2,0.2) });
  if (signKeyBytesOrNull) {
    let png;
    try { png = await pdf.embedPng(signKeyBytesOrNull); } catch { png = null; }
    if (png) {
      const maxW = colW, maxH = 42;
      const { width, height } = png.scale(1);
      let w = maxW, h = (height/width)*w;
      if (h > maxH) { h = maxH; w = (width/height)*h; }
      page.drawImage(png, { x:cx, y:y-14-h+4, width:w, height:h });
    }
  }

  // Date (right)
  const rx = MARGIN + 2*(colW+12) + 12;
  page.drawText("Date", { x:rx, y:y, size:labelSize, font:bold, color:rgb(0.2,0.2,0.2) });
  page.drawText(dateStr||"", { x:rx, y:y-14, size:valueSize, font:regular, color:rgb(0,0,0) });

  return y - 60;
}

// append audit / security page
async function appendAuditPage(pdf, sess, linkid) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular   = await pdf.embedFont(StandardFonts.Helvetica);

  // header
  page.drawText("VINET — Agreement Security Summary", {
    x: MARGIN, y: PAGE_H - MARGIN - 18, size: 18, font: titleFont, color: rgb(0.88, 0.0, 0.10)
  });

  const loc = sess.last_loc || {};
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
    ["Timestamp", nowStr(sess.last_time||Date.now())]
  ];

  let y = PAGE_H - MARGIN - 48;
  const keyW = 120, lineH=16, size=11;
  for (const [k,v] of lines) {
    page.drawText(k + ":", { x:MARGIN, y, size, font:regular, color:rgb(0.2,0.2,0.2) });
    page.drawText(String(v||""), { x:MARGIN + keyW, y, size, font:regular, color:rgb(0,0,0) });
    y -= lineH;
  }

  page.drawText("This page is appended for audit purposes and should accompany the agreement.", {
    x:MARGIN, y: MARGIN, size: 10, font: regular, color: rgb(0.4,0.4,0.4)
  });
}

/* ==============================
   BRANDED PDF BUILDERS (no embedded uploads)
   ============================== */
async function buildMSA(env, sess, linkid) {
  // required: must be signed
  if (!sess || !sess.agreement_signed) throw new Error("MSA not signed");

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold    = await pdf.embedFont(StandardFonts.HelveticaBold);

  // collect details
  const idOnly = (linkid||"").split("_")[0];
  const e = sess.edits||{};
  const fullName = e.full_name || "";
  const email    = e.email || "";
  const phone    = e.phone || "";
  const passport = e.passport || "";
  const street   = e.street || "";
  const city     = e.city || "";
  const zip      = e.zip || "";
  const dateStr  = nowStr();

  // page 1
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = await drawHeader(pdf, page, "Master Service Agreement", env);

  // client info block
  const labelSize=11, valueSize=12;
  const gap = 16;

  const row = (label, value) => {
    y -= gap;
    page.drawText(label, { x:MARGIN, y, size:labelSize, font:bold, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(value||""), { x:MARGIN+150, y, size:valueSize, font:regular, color: rgb(0,0,0) });
  };

  row("Client code", idOnly);
  row("Full name", fullName);
  row("Email", email);
  row("Phone", phone);
  row("ID / Passport", passport);
  row("Street", street);
  row("City", city);
  row("ZIP", zip);

  y -= 18;

  // MSA Terms (smaller by ~5pt: use 10 instead of 15/14)
  const terms = await getText(env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL);
  page.drawText("Terms of Service", { x:MARGIN, y, size:13, font:bold, color: rgb(0.1,0.1,0.1) });
  y -= 18;
  y = drawWrapped(page, regular, terms || "Terms unavailable.", MARGIN, y, PAGE_W - 2*MARGIN, 10, 1.4);
  y -= 22;

  // signature row
  const sigBytes = sess.agreement_sig_key ? await fetchR2Bytes(env, sess.agreement_sig_key) : null;
  y = await drawSignatureRow(pdf, page, fullName, dateStr, sigBytes, y);

  // append audit page
  await appendAuditPage(pdf, sess, linkid);

  return await pdf.save();
}

async function buildDebit(env, sess, linkid) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold    = await pdf.embedFont(StandardFonts.HelveticaBold);

  // collect details
  const idOnly = (linkid||"").split("_")[0];
  const e = sess.edits||{};
  const fullName = e.full_name || "";
  const email    = e.email || "";
  const street   = e.street || "";
  const city     = e.city || "";
  const zip      = e.zip || "";

  const d = sess.debit || {};
  const dateStr  = nowStr();

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = await drawHeader(pdf, page, "Debit Order Instruction", env);

  // client + debit details
  const labelSize=11, valueSize=12, gap=16;
  const row = (label, value) => {
    y -= gap;
    page.drawText(label, { x:MARGIN, y, size:labelSize, font:bold, color: rgb(0.2,0.2,0.2) });
    page.drawText(String(value||""), { x:MARGIN+180, y, size:valueSize, font:regular, color: rgb(0,0,0) });
  };

  row("Client code", idOnly);
  row("Account holder", d.account_holder || "");
  row("Holder ID / Passport", d.id_number || "");
  row("Bank", d.bank_name || "");
  row("Account number", d.account_number || "");
  row("Account type", d.account_type || "");
  row("Debit day", d.debit_day || "");
  row("Contact", email || "");
  row("Street", street || "");
  row("City", city || "");
  row("ZIP", zip || "");

  y -= 18;

  // Debit terms (smaller font ~10pt)
  const terms = await getText(env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL);
  page.drawText("Debit Order Terms", { x:MARGIN, y, size:13, font:bold, color: rgb(0.1,0.1,0.1) });
  y -= 18;
  y = drawWrapped(page, regular, terms || "Terms unavailable.", MARGIN, y, PAGE_W - 2*MARGIN, 10, 1.4);
  y -= 22;

  // signature row
  const sigBytes = sess.debit_sig_key ? await fetchR2Bytes(env, sess.debit_sig_key) : null;
  y = await drawSignatureRow(pdf, page, fullName, dateStr, sigBytes, y);

  // audit page
  await appendAuditPage(pdf, sess, linkid);

  return await pdf.save();
}
/* ==============================
   WhatsApp senders
   ============================== */
async function sendWhatsAppTemplate(to, code, env) {
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
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template ${r.status} ${await r.text()}`);
}
async function sendWhatsAppText(to, body, env) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text ${r.status} ${await r.text()}`);
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

/* ==============================
   Minimal Root page (create link) & Admin page w/ tabs
   ============================== */
function renderRoot() {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vinet Onboarding</title>
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}
.logo{height:72px;margin:0 auto 6px;display:block}
h1{color:#e2001a;margin:.2em 0 .6em}
.row{display:flex;gap:10px;justify-content:center}
input{padding:.7em .9em;border:1px solid #ddd;border-radius:10px;min-width:300px}
.btn{background:#e2001a;color:#fff;border:0;border-radius:10px;padding:.7em 1.4em;cursor:pointer}
.note{font-size:12px;color:#666;margin-top:10px}
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Create onboarding link</h1>
  <div class="row"><input id="id" placeholder="Splynx Lead/Customer ID" autocomplete="off"><button class="btn" id="go">Generate</button></div>
  <div id="out" class="note"></div>
  <div style="margin-top:14px"><a href="/admin">Go to Admin</a></div>
</div>
<script>
document.getElementById('go').onclick=async()=>{
  const id=document.getElementById('id').value.trim(); const out=document.getElementById('out');
  if(!id){out.textContent='Please enter an ID.';return;}
  out.textContent='Working...';
  try{
    const r=await fetch('/api/admin/genlink',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    out.innerHTML=d.url?('<b>Link:</b> <a href="'+d.url+'" target="_blank">'+d.url+'</a>'):'Error.';
  }catch{out.textContent='Network error.';}
};
</script>`;
}
function renderAdmin(restricted=false) {
  if (restricted) return `<!doctype html><meta charset="utf-8"><title>Restricted</title>
  <div style="font-family:system-ui;padding:2em;max-width:640px;margin:0 auto">
  <h1 style="color:#e2001a">Admin — Restricted</h1><p>Access is limited to the VNET network.</p></div>`;

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px}
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
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" />
  <h1 style="text-align:center;color:#e2001a">Admin Dashboard</h1>
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
  const tabs=[...document.querySelectorAll('.tab')];
  const content=document.getElementById('content');
  tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');load(t.dataset.tab);});
  load('gen');

  const node=html=>{const d=document.createElement('div');d.innerHTML=html;return d;};

  async function load(which){
    if(which==='gen'){
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
    if(which==='staff'){
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
      content.appendChild(v);return;
    }
    if(['inprog','pending','approved'].includes(which)){
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
</script>`;
}

function renderOnboard(linkid) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onboarding</title>
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
</style>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="progressbar"><div id="prog" class="progress" style="width:14%"></div></div>
  <div id="step"></div>
</div>
<script>
(function(){
  const linkid=${JSON.stringify(linkid)};
  const stepEl=document.getElementById('step'), progEl=document.getElementById('prog');
  let step=0;
  let state={ progress:0, edits:{}, uploads:[], pay_method:'eft' };

  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
  function setProg(){ progEl.style.width=pct()+'%'; }
  function save(){ fetch('/api/progress/'+linkid,{method:'POST',body:JSON.stringify(state)}).catch(()=>{}); }

  // OTP send
  async function sendOtp(){
    const m=document.getElementById('otpmsg');
    if(m) m.textContent='Sending code to WhatsApp...';
    try{
      const r=await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d=await r.json().catch(()=>({ok:false}));
      if(d.ok){
        if(m) m.textContent = d.mode==='text-fallback' ? 'Code sent as a WhatsApp text.' : 'Code sent. Check your WhatsApp.';
      } else {
        if (m) m.textContent = d.error || 'Failed to send.';
      }
    }catch{ if(m) m.textContent='Network error.'; }
  }

  // signature pad
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
    stepEl.innerHTML='<h2>Welcome</h2><p>We’ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let’s begin</button>';
    document.getElementById('start').onclick=()=>{ step=1; state.progress=step; setProg(); save(); render(); };
  }

  function step1(){
    stepEl.innerHTML=[
      '<h2>Verify your identity</h2>',
      '<div class="pill-wrap"><span class="pill active" id="p-wa">WhatsApp OTP</span><span class="pill" id="p-staff">I have a staff code</span></div>',
      '<div id="waBox" class="field" style="margin-top:10px;"></div>',
      '<div id="staffBox" class="field" style="margin-top:10px; display:none;"></div>'
    ].join('');

    const wa=document.getElementById('waBox');
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

    const pwa=document.getElementById('p-wa'), pst=document.getElementById('p-staff');
    pwa.onclick=()=>{ pwa.classList.add('active'); pst.classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    pst.onclick=()=>{ pst.classList.add('active'); pwa.classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  function step2(){
    stepEl.innerHTML='<h2>Payment Method</h2><div class="pill-wrap"><span class="pill active" id="pm-eft">EFT</span><span class="pill" id="pm-debit">Debit order</span></div><div id="box" class="field"></div><div class="row"><a class="btn-outline" id="back1">Back</a><button class="btn" id="cont">Continue</button></div>';
    const pmE=document.getElementById('pm-eft'), pmD=document.getElementById('pm-debit'), box=document.getElementById('box');

    function renderEFT(){
      const id=(linkid||'').split('_')[0];
      box.innerHTML=[
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
    async function renderDebitForm(){
      const d=state.debit||{};
      box.innerHTML=[
        '<div class="row">',
          '<div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'" /></div>',
          '<div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'" /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'" /></div>',
          '<div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'" /></div>',
        '</div>',
        '<div class="row">',
          '<div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
          '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div>',
        '</div>',
        '<div class="termsbox" id="debitTerms">Loading terms...</div>',
        '<div class="field bigchk" style="margin-top:.8em"><label style="display:flex;align-items:center;gap:.55em"><input id="d_agree" type="checkbox"> I agree to the Debit Order terms</label></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');
      try{ const r=await fetch('/api/terms?kind=debit'); const t=await r.text(); document.getElementById('debitTerms').innerHTML = t || 'Terms not available.'; }catch{ document.getElementById('debitTerms').textContent='Failed to load terms.'; }
      dPad = sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick=(e)=>{e.preventDefault();dPad.clear();};
    }

    pmE.onclick=()=>{ state.pay_method='eft'; renderEFT(); save(); pmE.classList.add('active'); pmD.classList.remove('active'); };
    pmD.onclick=()=>{ state.pay_method='debit'; renderDebitForm(); save(); pmD.classList.add('active'); pmE.classList.remove('active'); };

    renderEFT();

    document.getElementById('back1').onclick=(e)=>{e.preventDefault(); step=1; state.progress=step; setProg(); save(); render();};
    document.getElementById('cont').onclick=async(e)=>{
      e.preventDefault();
      if (state.pay_method==='debit') {
        const msg=document.getElementById('d_msg');
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
          const id=(linkid||'').split('_')[0];
          await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ ...state.debit, splynx_id:id, linkid })});
          await fetch('/api/debit/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ linkid, dataUrl: dPad.dataURL() })});
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
          '<div class="field bigchk"><label><input type="checkbox" id="agreeChk"/> I agree to the Master Service Agreement terms below and confirm the details above are true and correct.</label></div>',
          '<div id="terms" class="termsbox">Loading terms…</div>',
          '<div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'
        ].join('');
        (async()=>{ try{ const tr=await fetch('/api/terms?kind=service'); const tt=await tr.text(); document.getElementById('terms').innerHTML = tt || 'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; } })();
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault();
          if(!document.getElementById('agreeChk').checked){ alert('Please agree to the terms to continue.'); return; }
          state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() };
          step=4; state.progress=step; setProg(); save(); render(); 
        };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step4(){
    stepEl.innerHTML = [
      '<h2>Sign the MSA</h2>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{e.preventDefault();pad.clear();};
    document.getElementById('back4').onclick=(e)=>{e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg');
      if (pad.isEmpty()) { msg.textContent='Please draw your signature.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false}));
        if(d.ok){ step=5; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  function step5(){
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

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5][step](); }
  render();
})();
</script>`;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cf = request.cf || {};
    const getIP = () => request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    const getUA = () => request.headers.get("user-agent") || "";

    // Root
    if (path === "/" && method === "GET") {
      return new Response(renderRoot(), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Admin UI
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response(renderAdmin(true), { headers: { "content-type":"text/html; charset=utf-8" }});
      return new Response(renderAdmin(false), { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || sess.deleted) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboard(linkid), { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // Admin: generate onboarding link
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(()=>({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Admin list
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        const s = await env.ONBOARD_KV.get(k.name, "json");
        if (!s || s.deleted) continue;
        const linkid = k.name.split("/")[1];
        const updated = s.last_time || s.created || 0;
        if (mode === "inprog" && !s.agreement_signed) items.push({ linkid, id:s.id, updated });
        if (mode === "pending" && s.status === "pending") items.push({ linkid, id:s.id, updated });
        if (mode === "approved" && s.status === "approved") items.push({ linkid, id:s.id, updated });
      }
      items.sort((a,b)=>b.updated-a.updated);
      return json({ items });
    }

    // Admin soft delete + session get/review pages
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, deleted:true, deleted_at: Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const msaLink = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
      const doLink  = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;
      return new Response(`<!doctype html><meta charset="utf-8"><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}a{color:#e2001a}</style>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id || (linkid.split("_")[0]) )}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b>: ${v?esc(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Agreements</h2>
  <div><a href="${msaLink}" target="_blank">Master Service Agreement (PDF)</a></div>
  ${sess.debit_sig_key ? `<div style="margin-top:.5em"><a href="${doLink}" target="_blank">Debit Order Agreement (PDF)</a></div>` : '<div class="note" style="margin-top:.5em">No debit order on file.</div>'}
  <div style="margin-top:12px"><button class="btn" id="approve">Approve & Push</button></div>
  <div id="msg" class="note" style="margin-top:8px"></div>
</div>
<script>
  const msg=document.getElementById('msg');
  document.getElementById('approve').onclick=async()=>{ msg.textContent='Pushing...'; try{ const r=await fetch('/api/admin/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid:${JSON.stringify(linkid)}})}); const d=await r.json().catch(()=>({ok:false})); msg.textContent=d.ok?'Approved and pushed.':(d.error||'Failed.'); }catch{ msg.textContent='Network error.'; } };
</script>`, { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // Terms blobs
    if (path === "/api/terms" && method === "GET") {
      const kind=(url.searchParams.get("kind")||"").toLowerCase();
      const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const debUrl = env.TERMS_DEBIT_URL   || DEFAULT_DEBIT_TERMS_URL;
      const body = (kind==="debit")
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(await getText(debUrl))}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(await getText(svcUrl))}</pre>`;
      return new Response(body, { headers: { "content-type":"text/html; charset=utf-8" }});
    }

    // OTP generate (staff) — IP restricted
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

    // OTP send (WA template -> fallback to text)
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid||"").split("_")[0];
      const msisdn = await fetchCustomerMsisdn(env, splynxId).catch(()=>null);
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) return json({ ok:false, error:"whatsapp-not-configured" }, 501);
      try { await sendWhatsAppTemplate(msisdn, code, env); return json({ ok:true, mode:"template" }); }
      catch { try { await sendWhatsAppText(msisdn, `Your Vinet verification code is: ${code}`, env); return json({ ok:true, mode:"text-fallback" }); }
             catch { return json({ ok:false, error:"whatsapp-send-failed" }, 502); } }
    }

    // OTP verify
    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp, kind } = await request.json().catch(()=>({}));
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const key = kind==="staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
      const expected = await env.ONBOARD_KV.get(key);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified:true }), { expirationTtl: 86400 });
        if (kind==="staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Save progress (capture audit bits)
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
      const last_ip = getIP();
      const last_ua = getUA();
      const baseForDev = [last_ua, last_ip, cf.asn || "", cf.colo || "", (linkid || "").slice(0,8)];
      const device_id = existing.device_id || (await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baseForDev.join("|")))
        .then(h=>Array.from(new Uint8Array(h)).slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join("")));
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads: we keep support (stored in R2), though PDFs no longer embed them
    if (path === "/api/onboard/upload" && method === "POST") {
      const urlParams = new URL(request.url).searchParams;
      const linkid = urlParams.get("linkid");
      const fileName = urlParams.get("filename") || "file.bin";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status:404 });
      const bodyArr = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, bodyArr);
      const rec = { key, name:fileName, size: bodyArr.byteLength };
      const next = { ...sess, uploads:[...(sess.uploads||[]), rec] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // MSA signature
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c=>c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata:{ contentType:"image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // Debit save + signature
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

      // attach to session for PDF
      const linkid = (b.linkid || "");
      if (linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit: { ...b } }), { expirationTtl: 86400 });
      }
      return json({ ok:true, ref:key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(()=>({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), c=>c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata:{ contentType:"image/png" }});
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status:404 });
      try {
        let bytes;
        if (type === "msa") {
          // must always be agreed & signed
          bytes = await buildMSA(env, sess, linkid);
        } else if (type === "debit") {
          bytes = await buildDebit(env, sess, linkid);
        } else {
          return new Response("Unknown type", { status:404 });
        }
        return new Response(bytes, { headers: { "content-type":"application/pdf", "cache-control":"no-store" }});
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    // EFT printable
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      const body = `<!doctype html><meta charset="utf-8"><title>Vinet EFT Details</title>
      <style>body{font-family:system-ui,sans-serif;margin:2em;color:#232} h1{color:#e2001a}</style>
      <h1>Electronic Funds Transfer (EFT)</h1>
      <p><b>Account:</b> Vinet Internet Solutions</p>
      <p><b>Bank:</b> First National Bank (FNB/RMB)</p>
      <p><b>Account No:</b> 62757054996</p>
      <p><b>Branch Code:</b> 250655</p>
      <p class="note"><b>Reference:</b> ${esc(id)}</p>`;
      return new Response(body, { headers: { "content-type":"text/html; charset=utf-8" } });
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error:"Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error:"Lookup failed" }, 502); }
    }

    // Approve & Push (PUT + create-doc -> upload) — remains lead/customer (no conversion)
    if (path === "/api/admin/approve" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      const idOnly = (linkid||"").split("_")[0];
      const kind = await detectKind(env, idOnly);
      if (kind==="unknown") return json({ ok:false, error:"Splynx id not found" }, 404);

      // 1) Update info (PUT) — email + billing_email same, plus phone, passport, address
      const e = sess.edits||{};
      const info = {
        email: e.email || "",
        billing_email: e.email || "",
        phone: e.phone || "",
        street_1: e.street || e.address || "",
        city: e.city || "",
        zip_code: e.zip || "",
      };
      try {
        if (kind==="lead") await splynxPUT(env, `/admin/crm/leads/${idOnly}`, info);
        else await splynxPUT(env, `/admin/customers/customer/${idOnly}`, info);
      } catch (err) {
        return json({ ok:false, error:`patch_failed:${err.message}` }, 502);
      }

      // separately update passport into customer-info (if customer) / customers-info if exists
      if (e.passport) {
        try {
          if (kind==="customer") {
            await splynxPUT(env, `/admin/customers/customer-info/${idOnly}`, { passport: e.passport });
          } else {
            // leads don't always expose customer-info; best-effort: store into lead body too
            await splynxPUT(env, `/admin/crm/leads/${idOnly}`, { passport: e.passport });
          }
        } catch {}
      }

      // 2) Generate fresh PDFs and upload to Splynx (create doc then upload)
      try {
        // MSA (must exist — always signed to finish flow)
        const msaBytes = await buildMSA(env, sess, linkid);
        const msaDoc = await splynxCreateDoc(env, kind, idOnly, "MSA", `MSA_${idOnly}.pdf`);
        await splynxUploadDocFile(env, kind, idOnly, msaDoc.id, msaBytes, "application/pdf");
      } catch (e) { /* allow continue even if one doc fails */ }

      try {
        // Debit if signed
        if (sess.debit_sig_key) {
          const doBytes = await buildDebit(env, sess, linkid);
          const doDoc = await splynxCreateDoc(env, kind, idOnly, "Debit Order", `DO_${idOnly}.pdf`);
          await splynxUploadDocFile(env, kind, idOnly, doDoc.id, doBytes, "application/pdf");
        }
      } catch (e) { /* ignore */ }

      // mark approved
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"approved", approved_at: Date.now() }), { expirationTtl: 60*60*24*30 });
      return json({ ok:true });
    }

    return new Response("Not found", { status: 404 });
  }
};
