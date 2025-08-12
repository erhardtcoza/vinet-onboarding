// --- Vinet Onboarding Worker ---
// Admin dashboard, onboarding flow, inline MSA & Debit PDFs (no template embeds)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";
const BRAND_RED = rgb(0.886, 0.0, 0.102); // #e2001a
const PAGE_W = 560;  // a bit narrower than A4 for consistent look
const PAGE_H = 792;  // Letter height; we center content
const CONTENT_L = 40;
const CONTENT_R = PAGE_W - 40;

// VNET ASN range (for /admin)
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return false;
  const parts = ip.split(".").map(Number);
  return parts[0] === 160 && parts[1] === 226 && parts[2] >= 128 && parts[2] <= 143;
}

// ---------- Small utils ----------
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

// ---------- Splynx helpers ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
async function splynxPATCH(env, endpoint, body) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    method: "PATCH",
    headers: {
      Authorization: `Basic ${env.SPLYNX_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return r;
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = (s) => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [
    obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
    obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone,
  ];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const m = pickPhone(it);
      if (m) return m;
    }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const m = pickPhone(obj[k]);
      if (m) return m;
    }
  }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map((k) => String(k).toLowerCase());
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
      continue;
    }
    if (cur && typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) {
          const s = String(v ?? "").trim();
          if (s) return s;
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
    try {
      const data = await splynxGET(env, ep);
      const m = pickPhone(data);
      if (m) return m;
    } catch {}
  }
  return null;
}
async function fetchProfileForDisplay(env, id) {
  let cust = null, lead = null, contacts = null, custInfo = null;
  try { cust = await splynxGET(env, `/admin/customers/customer/${id}`); } catch {}
  if (!cust) { try { lead = await splynxGET(env, `/admin/crm/leads/${id}`); } catch {} }
  try { contacts = await splynxGET(env, `/admin/customers/${id}/contacts`); } catch {}
  try { custInfo = await splynxGET(env, `/admin/customers/customer-info/${id}`); } catch {}

  const src = cust || lead || {};
  const phone = pickPhone({ ...src, contacts });

  const street =
    src.street || src.address || src.address_1 || src.street_1 ||
    pickFrom(src, ["street", "address", "address_1", "street_1"]) ||
    pickFrom(custInfo, ["street", "address", "address_1", "street_1"]) || "";

  const city =
    src.city || pickFrom(src, ["city", "town"]) || pickFrom(custInfo, ["city", "town"]) || "";

  const zip =
    src.zip_code || src.zip ||
    pickFrom(src, ["zip", "zip_code", "postal_code"]) ||
    pickFrom(custInfo, ["zip", "zip_code", "postal_code"]) || "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport", "id_number", "identity_number", "idnumber", "document_number", "id_card"]) || "";

  return {
    kind: cust ? "customer" : lead ? "lead" : "unknown",
    id,
    full_name: src.full_name || src.name || "",
    email: src.email || src.billing_email || "",
    phone: phone || "",
    city, street, zip, passport,
    partner: src.partner || src.location || "",
    payment_method: src.payment_method || "",
  };
}

// ---------- Root (simple create-link) ----------
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
.note{font-size:12px;color:#666;margin-top:10px}
#out a{word-break:break-all}
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
</script>
</body></html>`;
}

// ---------- Admin (tabbed) ----------
function renderAdminPage(restricted = false) {
  if (restricted) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Restricted</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc}
.card{background:#fff;max-width:760px;margin:48px auto;border-radius:16px;box-shadow:0 2px 12px #0002;padding:22px 26px;text-align:center}
h1{color:#e2001a}
.logo{height:72px;margin:0 auto 8px;display:block}
.note{color:#666}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet">
  <h1>Admin — Restricted</h1>
  <p class="note">Access is limited to the VNET network.</p>
</div></body></html>`;
  }

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
.badge{display:inline-block;background:#eee;border-radius:999px;padding:.2em .6em;font-size:.85em}
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
<script>
(()=> {
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
</script>
</body></html>`;
}

// ---------- WhatsApp senders ----------
async function sendWhatsAppTemplate(to, code, env) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] },
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

// ---------- PDF primitives ----------
function drawText(page, text, x, y, opts) {
  const { font, size = 11, color = rgb(0, 0, 0), maxWidth = null, lineHeight = 1.35 } = opts || {};
  if (!text) return y;
  const words = String(text).split(/\s+/);
  let line = "";
  let cursorY = y;
  const draw = (t) => { page.drawText(t, { x, y: cursorY, size, font, color }); cursorY -= size * lineHeight; };
  if (!maxWidth) { page.drawText(String(text), { x, y: cursorY, size, font, color }); return cursorY - size * lineHeight; }
  for (const w of words) {
    const tryLine = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width <= maxWidth) { line = tryLine; continue; }
    if (line) draw(line);
    line = w;
  }
  if (line) {
    page.drawText(line, { x, y: cursorY, size, font, color });
    cursorY -= size * lineHeight;
  }
  return cursorY;
}
async function fetchBytesFromUrl(urlStr) {
  const r = await fetch(urlStr, { cf: { cacheEverything: true, cacheTtl: 600 } });
  if (!r.ok) throw new Error(`fetch ${urlStr} ${r.status}`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}
async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}
function headerBlock(page, font, fontBold, title, logoImage, nowStr) {
  // Logo (top-right), title (top-left), contact line under logo
  const marginTop = PAGE_H - 40;
  // title
  page.drawText(title, { x: 40, y: marginTop, size: 18, font: fontBold, color: BRAND_RED });
  // logo
  if (logoImage) {
    const scale = 0.12; // slightly larger than before
    const { width, height } = logoImage.scale(scale);
    const x = CONTENT_R - width;
    const y = marginTop - (height - 12);
    page.drawImage(logoImage, { x, y, width, height });
    // contact line (a little lower to avoid cutting through numbers)
    const contactY = y - 8;
    page.drawText("www.vinet.co.za • 021 007 0200", {
      x: CONTENT_R - font.widthOfTextAtSize("www.vinet.co.za • 021 007 0200", 10) - 4,
      y: contactY, size: 10, font, color: rgb(0.2,0.2,0.2),
    });
    // red rule
    page.drawLine({ start: { x: 40, y: contactY - 8 }, end: { x: CONTENT_R }, thickness: 2, color: BRAND_RED });
  }
  // date on top-left small
  page.drawText(nowStr, { x: 40, y: PAGE_H - 62, size: 9, font, color: rgb(0.35,0.35,0.35) });
  return PAGE_H - 90; // return y cursor after header
}
function kv(page, font, fontBold, x, y, label, value, w = 240) {
  page.drawText(label, { x, y, size: 11, font: fontBold });
  return drawText(page, value || "", x, y - 14, { font, size: 11, maxWidth: w, lineHeight: 1.35 });
}
function signRow(page, font, fontBold, y, name, sigImg, dateStr) {
  const lineY = y - 12;
  // Name (left)
  page.drawText("Name", { x: 40, y, size: 11, font: fontBold });
  page.drawText(name || "", { x: 40, y: lineY - 12, size: 11, font });
  // Signature (center)
  const midX = 40 + (CONTENT_R - 40) / 2 - 80;
  page.drawText("Signature", { x: midX, y, size: 11, font: fontBold });
  if (sigImg) {
    page.drawImage(sigImg, { x: midX, y: lineY - 8, width: 160, height: 45 });
  } else {
    page.drawText("(drawn digitally)", { x: midX, y: lineY - 12, size: 10, font, color: rgb(0.4,0.4,0.4) });
  }
  // Date (right)
  const rightX = CONTENT_R - 140;
  page.drawText("Date", { x: rightX, y, size: 11, font: fontBold });
  page.drawText(dateStr, { x: rightX, y: lineY - 12, size: 11, font });
}

// ---------- Terms fetch ----------
async function getTerms(env, kind) {
  const svcUrl = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const debUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const url = kind === "debit" ? debUrl : svcUrl;
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  }
}

// ---------- PDF: MSA ----------
async function renderMsaPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) throw new Error("no_session_or_not_signed");

  const e = sess.edits || {};
  const id = (linkid || "").split("_")[0];
  const dateStr = new Date().toLocaleDateString();
  const terms = await getTerms(env, "service");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // preload logo
  let logoImg = null;
  try { const logoBytes = await fetchBytesFromUrl(LOGO_URL); logoImg = await pdf.embedJpg(logoBytes).catch(async()=>await pdf.embedPng(logoBytes)); } catch {}

  // page 1
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = headerBlock(page, font, fontBold, "Master Service Agreement", logoImg, dateStr);

  // Client info
  y = kv(page, font, fontBold, 40, y, "Full Name:", e.full_name || "");
  y = kv(page, font, fontBold, 40, y, "Email:", e.email || "");
  y = kv(page, font, fontBold, 40, y, "Phone:", e.phone || "");
  y = kv(page, font, fontBold, 40, y, "Street:", e.street || "");
  y = kv(page, font, fontBold, 40, y, "City:", e.city || "");
  y = kv(page, font, fontBold, 40, y, "ZIP:", e.zip || "");
  y = kv(page, font, fontBold, 40, y, "ID / Passport:", e.passport || "");
  y = kv(page, font, fontBold, 40, y, "Client Code:", id);

  // Terms title
  y -= 4;
  page.drawText("Terms & Conditions", { x: 40, y, size: 13, font: fontBold, color: BRAND_RED }); y -= 16;

  // Terms body (smaller so it fits)
  const startX = 40, bodyW = CONTENT_R - 40;
  const paraSize = 9; // slightly smaller per your feedback
  y = drawText(page, terms || "(Terms temporarily unavailable.)", startX, y, { font, size: paraSize, maxWidth: bodyW, lineHeight: 1.35 });

  // Signature block
  y -= 8;
  signRow(page, font, fontBold, y, e.full_name || "", null, dateStr);

  // Security page
  page = pdf.addPage([PAGE_W, PAGE_H]);
  let y2 = headerBlock(page, font, fontBold, "VINET — Agreement Security Summary", logoImg, dateStr);
  const secLines = [
    `Link ID: ${linkid}`,
    `Splynx ID: ${id}`,
    `IP Address: ${sess.last_ip || "n/a"}`,
    `Location: ${sess.geo || "n/a"}`,
    `Coordinates: ${sess.coords || "n/a"}`,
    `ASN / Org: ${sess.asn || "n/a"}`,
    `Cloudflare PoP: ${sess.colo || "n/a"}`,
    `User-Agent: ${sess.ua || "n/a"}`,
    `Device ID: ${sess.device || "n/a"}`,
    `Timestamp: ${new Date(sess.last_time || Date.now()).toISOString().slice(0,16).replace("T"," ")}`,
    "",
    "This page is appended for audit purposes and should accompany the agreement.",
  ];
  for (const line of secLines) {
    page.drawText(line, { x: 40, y: y2, size: 11, font });
    y2 -= 16;
  }

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- PDF: Debit Order ----------
async function renderDebitPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) throw new Error("no_session");
  const e = sess.edits || {};
  const d = sess.debit || {};
  const id = (linkid || "").split("_")[0];
  const dateStr = new Date().toLocaleDateString();
  const terms = await getTerms(env, "debit");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImg = null;
  try { const logoBytes = await fetchBytesFromUrl(LOGO_URL); logoImg = await pdf.embedJpg(logoBytes).catch(async()=>await pdf.embedPng(logoBytes)); } catch {}

  // page 1
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = headerBlock(page, font, fontBold, "Debit Order Instruction", logoImg, dateStr);

  // Client info
  y = kv(page, font, fontBold, 40, y, "Full Name:", e.full_name || "");
  y = kv(page, font, fontBold, 40, y, "Email:", e.email || "");
  y = kv(page, font, fontBold, 40, y, "Phone:", e.phone || "");
  y = kv(page, font, fontBold, 40, y, "Street:", e.street || "");
  y = kv(page, font, fontBold, 40, y, "City:", e.city || "");
  y = kv(page, font, fontBold, 40, y, "ZIP:", e.zip || "");
  y = kv(page, font, fontBold, 40, y, "ID / Passport:", e.passport || "");
  y = kv(page, font, fontBold, 40, y, "Client Code:", id);

  // Debit details block
  y -= 6;
  page.drawText("Debit Order Details", { x: 40, y, size: 13, font: fontBold, color: BRAND_RED }); y -= 16;

  const leftW = (CONTENT_R - 40 - 20) / 2;
  let yL = kv(page, font, fontBold, 40, y, "Account Holder Name:", d.account_holder || "", leftW);
  yL = kv(page, font, fontBold, 40, yL, "Account Holder ID / Passport:", d.id_number || "", leftW);
  let yR = kv(page, font, fontBold, 40 + leftW + 20, y, "Bank:", d.bank_name || "", leftW);
  yR = kv(page, font, fontBold, 40 + leftW + 20, yR, "Bank Account No:", d.account_number || "", leftW);
  const yNext = Math.min(yL, yR);
  let yL2 = kv(page, font, fontBold, 40, yNext, "Account Type:", d.account_type || "", leftW);
  let yR2 = kv(page, font, fontBold, 40 + leftW + 20, yNext, "Debit Order Date:", d.debit_day || "", leftW);
  y = Math.min(yL2, yR2) - 6;

  // Terms
  page.drawText("Debit Order Terms", { x: 40, y, size: 13, font: fontBold, color: BRAND_RED }); y -= 16;
  y = drawText(page, terms || "(Terms temporarily unavailable.)", 40, y, { font, size: 9, maxWidth: CONTENT_R - 40, lineHeight: 1.35 });
  y -= 8;

  // Signature row
  signRow(page, font, fontBold, y, e.full_name || "", null, dateStr);

  // Security page
  page = pdf.addPage([PAGE_W, PAGE_H]);
  let y2 = headerBlock(page, font, fontBold, "VINET — Agreement Security Summary", logoImg, dateStr);
  const secLines = [
    `Link ID: ${linkid}`,
    `Splynx ID: ${id}`,
    `IP Address: ${sess.last_ip || "n/a"}`,
    `Location: ${sess.geo || "n/a"}`,
    `Coordinates: ${sess.coords || "n/a"}`,
    `ASN / Org: ${sess.asn || "n/a"}`,
    `Cloudflare PoP: ${sess.colo || "n/a"}`,
    `User-Agent: ${sess.ua || "n/a"}`,
    `Device ID: ${sess.device || "n/a"}`,
    `Timestamp: ${new Date(sess.last_time || Date.now()).toISOString().slice(0,16).replace("T"," ")}`,
    "",
    "This page is appended for audit purposes and should accompany the agreement.",
  ];
  for (const line of secLines) {
    page.drawText(line, { x: 40, y: y2, size: 11, font });
    y2 -= 16;
  }

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- Onboarding UI (unchanged steps; OTP wording clarified) ----------
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
  function pct(){ return Math.min(100, Math.round(((step+1)/(6+1))*100)); }
  function setProg(){ progEl.style.width = pct() + '%'; }
  function save(){ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); }

  // OTP send
  async function sendOtp(){
    const m = document.getElementById('otpmsg');
    if (m) m.textContent = 'Sending code on WhatsApp...';
    try{
      const r = await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})});
      const d = await r.json().catch(()=>({ok:false}));
      if (d.ok) {
        if (m) m.textContent = d.mode==='text-fallback' ? 'Code sent on WhatsApp (standard message).' : 'Code sent on WhatsApp.';
      } else {
        if (d.error==='whatsapp-not-configured' || d.error==='whatsapp-send-failed') {
          if (m) m.textContent = 'WhatsApp sending is unavailable. Use the Staff code option below.';
          document.getElementById('waBox').style.display='none';
          document.getElementById('staffBox').style.display='block';
          document.getElementById('p-wa').classList.remove('active');
          document.getElementById('p-staff').classList.add('active');
        } else {
          if (m) m.textContent = d.error || 'Failed to send.';
        }
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

  // Steps
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
        document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
        document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=3; state.progress=step; setProg(); save(); render(); };
      }catch{ document.getElementById('box').textContent='Failed to load profile.'; }
    })();
  }

  function step3(){
    stepEl.innerHTML = [
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill active">EFT</span><span class="pill">Debit order (coming back later)</span></div></div>',
      '<div class="note">We\'re using EFT for now. You can still complete onboarding and sign the MSA.</div>',
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');
    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); };
    document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); step=4; state.progress=step; setProg(); save(); render(); };
  }

  function step4(){
    stepEl.innerHTML=[
      '<h2>Agreement</h2>',
      '<div class="termsbox" id="terms">Loading terms…</div>',
      '<div class="field bigchk" style="margin-top:10px;"><label><input type="checkbox" id="agreeChk"/> I confirm the accuracy of the information in this Agreement and that I am authorised to enter into this agreement with VINET.</label></div>',
      '<div class="field"><label>Draw your signature</label><canvas id="sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="clearSig">Clear</a><span class="note" id="sigMsg"></span></div></div>',
      '<div class="row"><a class="btn-outline" id="back4">Back</a><button class="btn" id="signBtn">Agree & Sign</button></div>'
    ].join('');
    (async()=>{ try{ const r=await fetch('/api/terms?kind=service'); const t=await r.text(); document.getElementById('terms').innerHTML=t||'Terms not available.'; }catch{ document.getElementById('terms').textContent='Failed to load terms.'; }})();
    const pad=sigPad(document.getElementById('sig'));
    document.getElementById('clearSig').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
    document.getElementById('back4').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
    document.getElementById('signBtn').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('sigMsg'); if(!document.getElementById('agreeChk').checked){ msg.textContent='Please tick the checkbox to confirm agreement.'; return; } msg.textContent='Uploading signature…';
      try{ const dataUrl=pad.dataURL(); const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,dataUrl})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=5; state.progress=step; setProg(); save(); render(); } else { msg.textContent=d.error||'Failed to save signature.'; } }catch{ msg.textContent='Network error.'; }
    };
  }

  function step5(){
    stepEl.innerHTML = [
      '<h2>All set!</h2>',
      '<p>Thanks — we’ve recorded your information. Our team will be in contact shortly. ',
      'If you have any questions please contact our sales team at <b>021 007 0200</b> / <b>sales@vinetco.za</b>.</p>',
      '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
      '<div class="field"><b>Your agreements</b> <span class="note">(available immediately after signing)</span></div>',
      '<ul style="margin:.4em 0 0 1em; padding:0; line-height:1.9">',
        '<li><a href="/agreements/pdf/msa/'+linkid+'" target="_blank">Master Service Agreement (PDF)</a></li>',
        '<li><a href="/agreements/pdf/debit/'+linkid+'" target="_blank">Debit Order Agreement (PDF)</a></li>',
      '</ul>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5][step](); }
  render();
})();
</script>
</body></html>`;
}

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "";

    // Root: simple creator
    if (path === "/" && method === "GET") {
      return new Response(renderRootPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Admin UI
    if (path === "/admin" && method === "GET") {
      if (!ipAllowed(request)) return new Response(renderAdminPage(true), { headers: { "content-type": "text/html; charset=utf-8" } });
      return new Response(renderAdminPage(false), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Terms blobs (service + debit)
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const service = await getTerms(env, "service");
      const debit = await getTerms(env, "debit");
      let body = "";
      if (kind === "debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(debit)}</pre>`;
      else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(service)}</pre>`;
      return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Generate onboarding link
    if (path === "/api/admin/genlink" && method === "POST") {
      const { id } = await request.json().catch(() => ({}));
      if (!id) return json({ error:"Missing id" }, 400);
      const token = Math.random().toString(36).slice(2,10);
      const linkid = `${id}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
      return json({ url: `${url.origin}/onboard/${linkid}` });
    }

    // Staff OTP generate (IP restricted)
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

    // WhatsApp OTP send
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(() => ({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      const msisdn = await fetchCustomerMsisdn(env, splynxId).catch(()=>null);
      if (!msisdn) {
        await env.ONBOARD_KV.put(`onboard/${linkid}:otp_err`, "msisdn_not_found", { expirationTtl: 1200 });
        return json({ ok:false, error:"No WhatsApp number on file" }, 404);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) {
        await env.ONBOARD_KV.put(`onboard/${linkid}:otp_err`, "wa_not_configured", { expirationTtl: 1200 });
        return json({ ok:false, error:"whatsapp-not-configured" }, 501);
      }
      try {
        await sendWhatsAppTemplate(msisdn, code, env);
        return json({ ok:true, mode:"template" });
      } catch {
        try {
          await sendWhatsAppText(msisdn, `Your Vinet verification code is: ${code}`, env);
          return json({ ok:true, mode:"text-fallback" });
        } catch {
          await env.ONBOARD_KV.put(`onboard/${linkid}:otp_err`, "wa_send_failed", { expirationTtl: 1200 });
          return json({ ok:false, error:"whatsapp-send-failed" }, 502);
        }
      }
    }

    // OTP verify
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

    // Onboarding entry
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Save session progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip:getIP(), last_time:Date.now(), ua: request.headers.get("user-agent") || "" };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Store MSA signature
    if (path === "/api/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl)) return json({ ok:false, error:"Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Unknown session" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, agreement_signed:true, agreement_sig_key:sigKey, status:"pending" }), { expirationTtl: 86400 });
      return json({ ok:true, sigKey });
    }

    // Admin list (IP restricted)
    if (path === "/api/admin/list" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const mode = url.searchParams.get("mode") || "pending";
      const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
      const items = [];
      for (const k of list.keys || []) {
        if (!k.name.startsWith("onboard/") || k.name.includes(":")) continue;
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

    // Admin soft delete (IP restricted)
    if (path === "/api/admin/delete" && method === "POST") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return json({ ok:false, error:"Not found" }, 404);
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, deleted:true, deleted_at:Date.now() }), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Admin review page (kept minimal)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const msaLink = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
      const doLink = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}a{color:#e2001a}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc(sess.id)}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b>: ${v?esc(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Agreements</h2>
  <div><a href="${msaLink}" target="_blank">Master Service Agreement (PDF)</a></div>
  <div style="margin-top:.5em"><a href="${doLink}" target="_blank">Debit Order Agreement (PDF)</a></div>
</div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // PDFs
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const parts = path.split("/");
      const type = parts[3];
      const linkid = parts[4] || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      try {
        if (type === "msa") return await renderMsaPdf(env, linkid);
        if (type === "debit") return await renderDebitPdf(env, linkid);
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error: "Lookup failed" }, 502); }
    }

    return new Response("Not found", { status: 404 });
  },
};
