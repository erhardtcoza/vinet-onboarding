// --- Vinet Onboarding Worker ---
// Clean PDFs (no template pages), security/audit page, onboarding flow, admin review/push scaffolding

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------- Config ----------
const LOGO_URL = "https://static.vinet.co.za/logo.jpeg";

// Terms text sources (kept as TXT so you can edit externally)
const DEFAULT_TERMS_SERVICE = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_TERMS_DEBIT   = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

// VNET ASN /20 (for /admin IP gate)
function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a,b,c] = ip.split(".").map(Number);
  return a===160 && b===226 && c>=128 && c<=143;
}

// ---------- Small utils ----------
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));

function catTime(ts) {
  const d = new Date(ts || Date.now());
  const pad = (n) => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 }});
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}

async function fetchBytes(url) {
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 }});
  if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

async function fetchR2Bytes(env, key) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return new Uint8Array(ab);
}

function wrapText(page, text, x, y, maxWidth, opts) {
  const { font, size=11, line=1.3, color=rgb(0,0,0) } = opts || {};
  if (!text) return y;
  const words = String(text).split(/\s+/);
  let lineTxt = "", cy = y;
  for (const w of words) {
    const tryLine = lineTxt ? lineTxt + " " + w : w;
    const width = font.widthOfTextAtSize(tryLine, size);
    if (width <= maxWidth) { lineTxt = tryLine; continue; }
    if (lineTxt) page.drawText(lineTxt, { x, y: cy, size, font, color });
    lineTxt = w; cy -= size * line;
  }
  if (lineTxt) page.drawText(lineTxt, { x, y: cy, size, font, color });
  return cy;
}

// ---------- Splynx helpers (read-only used in onboarding prefill) ----------
async function splynxGET(env, endpoint) {
  const r = await fetch(`${env.SPLYNX_API}${endpoint}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
  });
  if (!r.ok) throw new Error(`Splynx GET ${endpoint} ${r.status}`);
  return r.json();
}
function pickPhone(obj) {
  if (!obj) return null;
  const ok = s => /^27\d{8,13}$/.test(String(s || "").trim());
  const direct = [obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone];
  for (const v of direct) if (ok(v)) return String(v).trim();
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } }
  else if (typeof obj === "object") { for (const k of Object.keys(obj)) { const m = pickPhone(obj[k]); if (m) return m; } }
  return null;
}
function pickFrom(obj, keys) {
  if (!obj) return null;
  const wanted = keys.map(k => String(k).toLowerCase());
  const stack=[obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue; }
    if (cur && typeof cur === "object") {
      for (const [k,v] of Object.entries(cur)) {
        if (wanted.includes(String(k).toLowerCase())) { const s = String(v ?? "").trim(); if (s) return s; }
        if (v && typeof v === "object") stack.push(v);
      }
    }
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

  const street = src.street || src.address || src.address_1 || pickFrom(src, ["street","address","address_1"]) || pickFrom(custInfo, ["street","address","address_1"]) || "";
  const city   = src.city   || pickFrom(src, ["city","town"]) || pickFrom(custInfo, ["city","town"]) || "";
  const zip    = src.zip_code || src.zip || pickFrom(src, ["zip","zip_code","postal_code"]) || pickFrom(custInfo, ["zip","zip_code","postal_code"]) || "";

  const passport =
    (custInfo && (custInfo.passport || custInfo.id_number || custInfo.identity_number)) ||
    src.passport || src.id_number ||
    pickFrom(src, ["passport","id_number","identity_number","idnumber","document_number","id_card"]) || "";

  return {
    kind: cust ? "customer" : (lead ? "lead" : "unknown"),
    id,
    full_name: src.full_name || src.name || [src.first_name||"", src.last_name||""].join(" ").trim(),
    email: src.email || src.billing_email || "",
    phone: phone || "",
    street, city, zip, passport
  };
}

// ---------- PDF layout helpers (no imported templates) ----------
const PAGE_W = 540;      // slightly narrower than A4 (595)
const PAGE_H = 780;      // slightly less than A4 height (842) for look + margins
const MARGIN = 36;

async function drawHeader(pdf, page, fontBold, title) {
  // Logo on the right, contact line just below, divider under header
  let yTop = PAGE_H - MARGIN;
  try {
    const logoBytes = await fetchBytes(LOGO_URL);
    const logo = LOGO_URL.toLowerCase().endsWith(".png") ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes);
    const targetW = 132; // ~10% bigger than before
    const scale = targetW / logo.width;
    const lw = logo.width * scale, lh = logo.height * scale;
    page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: yTop - lh, width: lw, height: lh });
  } catch {
    // fallback: brand text if logo fails
    page.drawText("VINET", { x: PAGE_W - MARGIN - 120, y: yTop - 20, size: 20, font: fontBold, color: rgb(0.88,0,0.1) });
  }

  // Title (left)
  page.drawText(title, { x: MARGIN, y: yTop - 16, size: 20, font: fontBold, color: rgb(0.88,0,0.1) });

  // Contact line (right, under logo), nudged down a bit so divider never crosses it
  page.drawText("www.vinet.co.za • 021 007 0200", {
    x: PAGE_W - MARGIN - 210,
    y: yTop - 52, // drop a little to avoid divider overlap
    size: 10,
    font: fontBold,
    color: rgb(0.2,0.2,0.2)
  });

  // Divider slightly lower than before
  const divY = yTop - 68;
  page.drawLine({
    start: { x: MARGIN, y: divY },
    end:   { x: PAGE_W - MARGIN, y: divY },
    thickness: 2,
    color: rgb(0.88,0,0.1)
  });
  return divY - 14;
}

function drawKVBlock(page, font, fontBold, pairs, x, y) {
  const LH = 14;
  let cy = y;
  for (const [k,v] of pairs) {
    page.drawText(`${k}:`, { x, y: cy, size: 11, font: fontBold, color: rgb(0.15,0.15,0.2) });
    page.drawText(String(v||"").trim(), { x: x+130, y: cy, size: 11, font, color: rgb(0,0,0) });
    cy -= LH;
  }
  return cy;
}

async function drawSignatureBlock(pdf, page, font, fontBold, sigBytes, name, dateStr, y) {
  const labelY = y;
  const colW = (PAGE_W - MARGIN*2) / 3;

  // Name (left)
  page.drawText("Name", { x: MARGIN + 4, y: labelY, size: 10, font: fontBold, color: rgb(0.25,0.25,0.25) });
  page.drawText(String(name || ""), { x: MARGIN + 4, y: labelY - 14, size: 11, font, color: rgb(0,0,0) });

  // Signature (center)
  page.drawText("Signature", { x: MARGIN + colW + 4, y: labelY, size: 10, font: fontBold, color: rgb(0.25,0.25,0.25) });
  if (sigBytes) {
    try {
      const png = await pdf.embedPng(sigBytes);
      // fit into a tidy box height
      const boxH = 46, boxW = colW - 8;
      let w = boxW, h = (png.height/png.width)*w;
      if (h > boxH) { h = boxH; w = (png.width/png.height)*h; }
      page.drawImage(png, { x: MARGIN + colW + 4, y: labelY - 14 - h + 4, width: w, height: h });
    } catch {
      page.drawText("(signature image failed to load)", { x: MARGIN + colW + 4, y: labelY - 14, size: 10, font, color: rgb(0.4,0,0) });
    }
  } else {
    page.drawText("(no signature on file)", { x: MARGIN + colW + 4, y: labelY - 14, size: 10, font, color: rgb(0.4,0,0) });
  }

  // Date (right)
  page.drawText("Date", { x: MARGIN + colW*2 + 4, y: labelY, size: 10, font: fontBold, color: rgb(0.25,0.25,0.25) });
  page.drawText(dateStr, { x: MARGIN + colW*2 + 4, y: labelY - 14, size: 11, font, color: rgb(0,0,0) });

  return labelY - 70;
}

async function appendSecurityPage(pdf, sess, linkid) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText("VINET — Agreement Security Summary", {
    x: MARGIN, y: PAGE_H - MARGIN - 18, size: 16, font: fontB, color: rgb(0.88,0,0.1)
  });

  const t = catTime(sess?.last_time || Date.now());
  const loc = sess?.last_loc || {};
  const lines = [
    ["Link ID", linkid],
    ["Splynx ID", (linkid||"").split("_")[0]],
    ["IP Address", sess?.last_ip || "n/a"],
    ["Location", [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "n/a"],
    ["Coordinates", (loc.latitude!=null && loc.longitude!=null) ? `${loc.latitude}, ${loc.longitude}` : "n/a"],
    ["ASN / Org", [loc.asn, loc.asOrganization].filter(Boolean).join(" • ") || "n/a"],
    ["Cloudflare PoP", loc.colo || "n/a"],
    ["User-Agent", sess?.last_ua || "n/a"],
    ["Device ID", sess?.device_id || "n/a"],
    ["Timestamp", t],
  ];
  let y = PAGE_H - MARGIN - 48;
  for (const [k,v] of lines) {
    page.drawText(`${k}:`, { x:MARGIN, y, size:11, font:fontB, color:rgb(0.2,0.2,0.2) });
    page.drawText(String(v||""), { x:MARGIN+120, y, size:11, font, color:rgb(0,0,0) });
    y -= 16;
  }

  page.drawText("This page is appended for audit purposes and should accompany the agreement.", {
    x: MARGIN, y: MARGIN, size: 10, font, color: rgb(0.4,0.4,0.4)
  });
}

// ---------- PDF: MSA (no file attachments, clean layout) ----------
async function renderMsaPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed) return new Response("Not signed", { status: 404 });

  const e = sess.edits || {};
  const code = String(linkid).split("_")[0];
  const dateStr = new Date().toLocaleDateString();

  const terms = await fetchText(env.TERMS_SERVICE_URL || DEFAULT_TERMS_SERVICE);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = await drawHeader(pdf, page, fontB, "Master Service Agreement");

  // Client info block
  y = drawKVBlock(page, font, fontB, [
    ["Full Name", e.full_name || ""],
    ["Email",     e.email || ""],
    ["Phone",     e.phone || ""],
    ["Street",    e.street || ""],
    ["City",      e.city || ""],
    ["ZIP",       e.zip || ""],
    ["ID / Passport", e.passport || ""],
    ["Client Code", code],
  ], MARGIN, y);

  y -= 10;

  // Terms (slightly smaller so content fits nicely)
  page.drawText("Terms & Conditions", { x: MARGIN, y, size: 12, font: fontB, color: rgb(0.15,0.15,0.2) });
  y -= 16;
  y = wrapText(page, terms || "Terms unavailable.", MARGIN, y, PAGE_W - MARGIN*2, { font, size: 9, line: 1.35, color: rgb(0,0,0) });
  y -= 18;

  // Signature block (uses MSA signature)
  const sigBytes = sess.agreement_sig_key ? await fetchR2Bytes(env, sess.agreement_sig_key) : null;
  await drawSignatureBlock(pdf, page, font, fontB, sigBytes, e.full_name || "", dateStr, y);

  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- PDF: Debit Order (clean layout + smaller terms text) ----------
async function renderDebitPdf(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });

  const e = sess.edits || {};
  const d = sess.debit || {};
  const code = String(linkid).split("_")[0];
  const dateStr = new Date().toLocaleDateString();

  const terms = await fetchText(env.TERMS_DEBIT_URL || DEFAULT_TERMS_DEBIT);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = await drawHeader(pdf, page, fontB, "Debit Order Instruction");

  // Client info
  y = drawKVBlock(page, font, fontB, [
    ["Full Name", e.full_name || ""],
    ["Email",     e.email || ""],
    ["Phone",     e.phone || ""],
    ["Street",    e.street || ""],
    ["City",      e.city || ""],
    ["ZIP",       e.zip || ""],
    ["ID / Passport", e.passport || ""],
    ["Client Code", code],
  ], MARGIN, y);

  y -= 10;

  // Debit order details
  page.drawText("Debit Order Details", { x: MARGIN, y, size: 12, font: fontB, color: rgb(0.15,0.15,0.2) });
  y -= 16;
  y = drawKVBlock(page, font, fontB, [
    ["Account Holder Name", d.account_holder || ""],
    ["Account Holder ID / Passport", d.id_number || ""],
    ["Bank", d.bank_name || ""],
    ["Bank Account No", d.account_number || ""],
    ["Account Type", d.account_type || ""],
    ["Debit Order Date", d.debit_day || ""],
  ], MARGIN, y);

  y -= 6;

  // Terms (reduced by ~5 points from body size)
  page.drawText("Debit Order Terms", { x: MARGIN, y, size: 12, font: fontB, color: rgb(0.15,0.15,0.2) });
  y -= 16;
  y = wrapText(page, terms || "Terms unavailable.", MARGIN, y, PAGE_W - MARGIN*2, { font, size: 9, line: 1.35, color: rgb(0,0,0) });
  y -= 18;

  // Signature block (uses debit signature if present; else shows marker)
  const sigBytes = sess.debit_sig_key ? await fetchR2Bytes(env, sess.debit_sig_key) : null;
  await drawSignatureBlock(pdf, page, font, fontB, sigBytes, e.full_name || "", dateStr, y);

  await appendSecurityPage(pdf, sess, linkid);

  const bytes = await pdf.save();
  return new Response(bytes, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- Minimal UIs (unchanged visuals you liked) ----------
function renderOnboardUI(linkid) {
  // Note: clearer error message when profile fetch fails.
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
  .hr{height:3px;background:#e2001a;border-radius:3px;margin:.6em 0 1em}
</style></head><body>
<div class="card">
  <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
  <div class="hr"></div>
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
  const setProg = ()=>{ const pct=Math.min(100,Math.round(((step+1)/(6+1))*100)); progEl.style.width=pct+'%'; };
  const save = ()=>{ fetch('/api/progress/'+linkid, { method:'POST', body: JSON.stringify(state) }).catch(()=>{}); };

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
    stepEl.innerHTML='<h2>Welcome</h2><p>We\\u2019ll quickly verify you and confirm a few details.</p><button class="btn" id="start">Let\\u2019s begin</button>';
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
    wa.innerHTML='<div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div><form id="otpForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required /><button class="btn" type="submit">Verify</button></div></form><a class="btn-outline" id="resend">Resend code</a>';
    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    function sendOtp(){ const m=document.getElementById('otpmsg'); m.textContent='Sending code to WhatsApp...'; fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid})}).then(r=>r.json()).then(d=>{ if(d.ok){ m.textContent=d.mode==='text-fallback'?'Code sent as text. Check WhatsApp.':'Code sent. Check WhatsApp.'; } else { m.textContent=d.error||'Failed to send.'; document.getElementById('waBox').style.display='none'; document.getElementById('staffBox').style.display='block'; document.getElementById('p-wa').classList.remove('active'); document.getElementById('p-staff').classList.add('active'); }}).catch(()=>{ m.textContent='Network error.'; }); }
    sendOtp();
    document.getElementById('resend').onclick=(e)=>{ e.preventDefault(); sendOtp(); };
    document.getElementById('otpForm').onsubmit=(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"wa"})}).then(r=>r.json()).then(d=>{ if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } }); };
    document.getElementById('staffForm').onsubmit=(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); fetch('/api/otp/verify',{method:'POST',body:JSON.stringify({linkid,otp,kind:"staff"})}).then(r=>r.json()).then(d=>{ if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } }); };
    document.getElementById('p-wa').onclick=()=>{ document.getElementById('p-wa').classList.add('active'); document.getElementById('p-staff').classList.remove('active'); wa.style.display='block'; staff.style.display='none'; };
    document.getElementById('p-staff').onclick=()=>{ document.getElementById('p-staff').classList.add('active'); document.getElementById('p-wa').classList.remove('active'); wa.style.display='none'; staff.style.display='block'; };
  }

  function step2(){
    const pay = state.pay_method || 'eft';
    stepEl.innerHTML=[
      '<h2>Payment Method</h2>',
      '<div class="field"><div class="pill-wrap"><span class="pill '+(pay==='eft'?'active':'')+'" id="pm-eft">EFT</span><span class="pill '+(pay==='debit'?'active':'')+'" id="pm-debit">Debit order</span></div></div>',
      '<div id="eftBox" class="field" style="display:'+(pay==='eft'?'block':'none')+';"></div>',
      '<div id="debitBox" class="field" style="display:'+(pay==='debit'?'block':'none')+';"></div>',
      '<div class="row"><a class="btn-outline" id="back1" style="flex:1;text-align:center">Back</a><button class="btn" id="cont" style="flex:1">Continue</button></div>'
    ].join('');
    function renderEft(){
      const id=(linkid||'').split('_')[0];
      document.getElementById('eftBox').innerHTML=[
        '<div class="row"><div class="field"><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"/></div>',
        '<div class="field"><label>Account Name</label><input readonly value="Vinet Internet Solutions"/></div></div>',
        '<div class="row"><div class="field"><label>Account Number</label><input readonly value="62757054996"/></div>',
        '<div class="field"><label>Branch Code</label><input readonly value="250655"/></div></div>',
        '<div class="field"><label><b>Reference</b></label><input readonly style="font-weight:900" value="'+id+'"/></div>',
        '<div class="note">Please use the correct <b>Reference</b> when paying via EFT.</div>'
      ].join('');
    }
    function renderDebit(){
      const d=state.debit||{};
      document.getElementById('debitBox').innerHTML=[
        '<div class="row"><div class="field"><label>Bank Account Holder Name</label><input id="d_holder" value="'+(d.account_holder||'')+'"/></div><div class="field"><label>Bank Account Holder ID no</label><input id="d_id" value="'+(d.id_number||'')+'"/></div></div>',
        '<div class="row"><div class="field"><label>Bank</label><input id="d_bank" value="'+(d.bank_name||'')+'"/></div><div class="field"><label>Bank Account No</label><input id="d_acc" value="'+(d.account_number||'')+'"/></div></div>',
        '<div class="row"><div class="field"><label>Bank Account Type</label><select id="d_type"><option value="cheque" '+((d.account_type||'')==='cheque'?'selected':'')+'>Cheque / Current</option><option value="savings" '+((d.account_type||'')==='savings'?'selected':'')+'>Savings</option><option value="transmission" '+((d.account_type||'')==='transmission'?'selected':'')+'>Transmission</option></select></div>',
        '<div class="field"><label>Debit Order Date</label><select id="d_day">',[1,7,15,25,29,30].map(x=>'<option '+((d.debit_day||'')==x?'selected':'')+' value="'+x+'">'+x+'</option>').join(''),'</select></div></div>',
        '<div class="field"><label>Draw your signature for Debit Order</label><canvas id="d_sig" class="signature"></canvas><div class="row"><a class="btn-outline" id="d_clear">Clear</a><span class="note" id="d_msg"></span></div></div>'
      ].join('');
      const pad=sigPad(document.getElementById('d_sig'));
      document.getElementById('d_clear').onclick=(e)=>{ e.preventDefault(); pad.clear(); };
      document.getElementById('cont').onclick=async(e)=>{ e.preventDefault(); const msg=document.getElementById('d_msg'); if(pad.isEmpty()){ msg.textContent='Please add your signature.'; return; }
        state.debit={ account_holder:document.getElementById('d_holder').value.trim(), id_number:document.getElementById('d_id').value.trim(), bank_name:document.getElementById('d_bank').value.trim(), account_number:document.getElementById('d_acc').value.trim(), account_type:document.getElementById('d_type').value, debit_day:document.getElementById('d_day').value };
        try{ const id=(linkid||'').split('_')[0]; await fetch('/api/debit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ ...state.debit, splynx_id:id, linkid })}); await fetch('/api/debit/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ linkid, dataUrl: pad.dataURL() })}); }catch{}
        step=3; state.progress=step; setProg(); save(); render();
      };
    }
    if (pay==='eft') renderEft(); else renderDebit();
    document.getElementById('pm-eft').onclick=()=>{ state.pay_method='eft'; document.getElementById('debitBox').innerHTML=''; renderEft(); save(); };
    document.getElementById('pm-debit').onclick=()=>{ state.pay_method='debit'; document.getElementById('eftBox').innerHTML=''; renderDebit(); save(); };
    document.getElementById('back1').onclick=(e)=>{ e.preventDefault(); step=1; state.progress=step; setProg(); save(); render(); };
    if (pay==='eft') document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); step=3; state.progress=step; setProg(); save(); render(); };
  }

  function step3(){
    stepEl.innerHTML='<h2>Please verify your details and change if you see any errors</h2><div id="box" class="note">Loading…</div>';
    (async()=>{
      try{
        const id=(linkid||'').split('_')[0];
        const r=await fetch('/api/splynx/profile?id='+encodeURIComponent(id));
        if(!r.ok) throw new Error('profile '+r.status);
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
      }catch(err){ document.getElementById('box').innerHTML='<div class="note" style="color:#b00">Failed to load profile. Please continue and enter details manually.</div><div class="row"><div class="field"><label>Full name</label><input id="f_full"/></div><div class="field"><label>ID / Passport</label><input id="f_id"/></div></div><div class="row"><div class="field"><label>Email</label><input id="f_email"/></div><div class="field"><label>Phone</label><input id="f_phone"/></div></div><div class="row"><div class="field"><label>Street</label><input id="f_street"/></div><div class="field"><label>City</label><input id="f_city"/></div></div><div class="field"><label>ZIP Code</label><input id="f_zip"/></div><div class="row"><a class="btn-outline" id="back2">Back</a><button class="btn" id="cont">Continue</button></div>'; document.getElementById('back2').onclick=(e)=>{ e.preventDefault(); step=2; state.progress=step; setProg(); save(); render(); }; document.getElementById('cont').onclick=(e)=>{ e.preventDefault(); state.edits={ full_name:document.getElementById('f_full').value.trim(), email:document.getElementById('f_email').value.trim(), phone:document.getElementById('f_phone').value.trim(), passport:document.getElementById('f_id').value.trim(), street:document.getElementById('f_street').value.trim(), city:document.getElementById('f_city').value.trim(), zip:document.getElementById('f_zip').value.trim() }; step=4; state.progress=step; setProg(); save(); render(); }; }
    })();
  }

  function step4(){
    stepEl.innerHTML=[
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

    // Onboarding entry
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Terms (HTML view for the UI)
    if (path === "/api/terms" && method === "GET") {
      const kind = (url.searchParams.get("kind") || "").toLowerCase();
      const svc = await fetchText(env.TERMS_SERVICE_URL || DEFAULT_TERMS_SERVICE);
      const deb = await fetchText(env.TERMS_DEBIT_URL   || DEFAULT_TERMS_DEBIT);
      const body = (kind==="debit")
        ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${esc(deb)}</pre>`
        : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${esc(svc)}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Save progress (audit info captured here)
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(()=>({}));
      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const cf = request.cf || {};
      const last_loc = {
        city: cf.city || "", region: cf.region || "", country: cf.country || "",
        latitude: cf.latitude || "", longitude: cf.longitude || "",
        timezone: cf.timezone || "", postalCode: cf.postalCode || "",
        asn: cf.asn || "", asOrganization: cf.asOrganization || "", colo: cf.colo || ""
      };
      const last_ip = getIP();
      const last_ua = request.headers.get("user-agent") || "";
      const device_id = existing.device_id || `${(cf.asn||"")}-${(cf.colo||"")}-${(linkid||"").slice(0,8)}`;
      const next = { ...existing, ...body, last_ip, last_ua, last_loc, device_id, last_time: Date.now() };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true });
    }

    // Uploads to R2 (kept for admin review; not embedded into PDFs anymore)
    if (path === "/api/onboard/upload" && method === "POST") {
      const qs = url.searchParams;
      const linkid = qs.get("linkid");
      const fileName = qs.get("filename") || "file.bin";
      const label = qs.get("label") || "File";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const rec = { key, name: fileName, size: body.byteLength, label };
      const next = { ...sess, uploads: [...(sess.uploads||[]), rec] };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
      return json({ ok:true, key });
    }

    // OTP (send/verify) — unchanged behaviour
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await request.json().catch(()=>({}));
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
      const splynxId = (linkid || "").split("_")[0];
      // Best-effort phone look-up
      let msisdn = "";
      try {
        const prof = await fetchProfileForDisplay(env, splynxId);
        msisdn = prof.phone || "";
      } catch {}
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) {
        return json({ ok:false, error:"whatsapp-not-configured" }, 501);
      }
      // Try template, then fallback to text
      const ep = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const send = (payload) => fetch(ep,{method:"POST",headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
      try {
        const payload = {
          messaging_product:"whatsapp", to: msisdn, type:"template",
          template: { name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp", language:{ code: env.WHATSAPP_TEMPLATE_LANG || "en" },
            components:[ { type:"body", parameters:[{ type:"text", text: code }] } ] }
        };
        const r = await send(payload); if (!r.ok) throw 0;
        return json({ ok:true, mode:"template" });
      } catch {
        try {
          const payload = { messaging_product:"whatsapp", to: msisdn, type:"text", text:{ body:`Your Vinet verification code is: ${code}` } };
          const r = await send(payload); if (!r.ok) throw 0;
          return json({ ok:true, mode:"text-fallback" });
        } catch { return json({ ok:false, error:"whatsapp-send-failed" }, 502); }
      }
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

    // Store MSA signature
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

    // Debit save/sign
    if (path === "/api/debit/save" && method === "POST") {
      const b = await request.json().catch(()=>({}));
      const required = ["account_holder","id_number","bank_name","account_number","account_type","debit_day"];
      for (const k of required) if (!b[k] || String(b[k]).trim()==="") return json({ ok:false, error:`Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = { ...b, splynx_id:id, created:ts, ip:getIP() };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), { expirationTtl: 60*60*24*90 });
      // also attach in session for PDF
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
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, debit_signed:true, debit_sig_key:sigKey }), { expirationTtl: 86400 });
      }
      return json({ ok:true, sigKey });
    }

    // Simple profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error:"Missing id" }, 400);
      try { const prof = await fetchProfileForDisplay(env, id); return json(prof); }
      catch { return json({ error:"Lookup failed" }, 502); }
    }

    // Agreements (PDFs)
    if (path.startsWith("/agreements/pdf/") && method === "GET") {
      const [, , , type, linkid] = path.split("/");
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      try {
        if (type === "msa")   return await renderMsaPdf(env, linkid);
        if (type === "debit") return await renderDebitPdf(env, linkid);
        return new Response("Unknown type", { status: 404 });
      } catch (e) {
        return new Response("PDF render failed", { status: 500 });
      }
    }

    // Admin review (kept minimal)
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Not found", { status: 404 });
      const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
      const filesHTML = uploads.length
        ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${esc(u.label)}</b> — ${esc(u.name)} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
        : `<div class="note">No files</div>`;
      const msaLink = `/agreements/pdf/msa/${encodeURIComponent(linkid)}`;
      const doLink = `/agreements/pdf/debit/${encodeURIComponent(linkid)}`;
      return new Response(`<!doctype html><meta charset="utf-8"><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:#e2001a}.btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:#e2001a;border:2px solid #e2001a;border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}a{color:#e2001a}</style>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${esc((linkid||'').split('_')[0])}</b> • LinkID: <code>${esc(linkid)}</code> • Status: <b>${esc(sess.status||'pending')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${esc(k)}</b>: ${v?esc(v):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
  <h2>Uploads</h2>${filesHTML}
  <h2>Agreements</h2>
  <div><a href="${msaLink}" target="_blank">Master Service Agreement (PDF)</a></div>
  ${sess.debit_sig_key ? `<div style="margin-top:.5em"><a href="${doLink}" target="_blank">Debit Order Agreement (PDF)</a></div>` : '<div class="note" style="margin-top:.5em">No debit order on file.</div>'}
</div>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // Fallback
    return new Response("Not found", { status: 404 });
  }
};
