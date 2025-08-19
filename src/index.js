import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ALLOWED_IPS = ["160.226.128.0/20"];
const LOGO_URL = "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";
const LOGO_LOWRES_URL = "https://static.vinet.co.za/Vinet%20Logo%20jpg_Full%20Logo.jpg";
const DEBIT_TERMS_FONT_SIZE = 8;
const MSA_TERMS_FONT_SIZE = 7;

const RED_COLOR = rgb(237 / 255, 28 / 255, 36 / 255);
const BLACK_COLOR = rgb(3 / 255, 3 / 255, 3 / 255);

async function fetchImageBytes(url) {
  const res = await fetch(url);
  return await res.arrayBuffer();
}

function safeText(text) {
  return text
    ? text.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
           .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
           .replace(/[^\x00-\x7F]/g, "")
    : "";
}

// ----- PDF: Debit Order -----
async function renderDebitPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();

  // Logo
  const logoBytes = await fetchImageBytes(LOGO_URL);
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoDims = logoImage.scale(0.5); // 50% bigger than old
  page.drawImage(logoImage, {
    x: 50,
    y: height - logoDims.height - 40,
    width: logoDims.width,
    height: logoDims.height,
  });

  // Tel + Website under logo
  page.drawText("Tel: 021 007 0200 | www.vinet.co.za", {
    x: 50,
    y: height - logoDims.height - 55,
    size: 10,
    font,
    color: BLACK_COLOR,
  });

  // Title in red
  page.drawText("Vinet Debit Order Instruction", {
    x: 300,
    y: height - 60,
    size: 16,
    font: fontBold,
    color: RED_COLOR,
  });

  // Dashed divider line
  page.drawLine({
    start: { x: 50, y: height - 70 },
    end: { x: width - 50, y: height - 70 },
    thickness: 1,
    dashArray: [3, 3],
    color: BLACK_COLOR,
  });

  // Left column (Client info)
  const leftStartY = height - 100;
  const leftLines = [
    `Client code: ${safeText(data.client_code)}`,
    `Full Name: ${safeText(data.full_name)}`,
    `ID / Passport: ${safeText(data.id_number)}`,
    `Email: ${safeText(data.email)}`,
    `Phone: ${safeText(data.phone)}`,
    `Street: ${safeText(data.street)}`,
    `City: ${safeText(data.city)}`,
    `ZIP: ${safeText(data.zip)}`,
  ];
  leftLines.forEach((line, i) => {
    page.drawText(line, {
      x: 50,
      y: leftStartY - i * 15,
      size: 10,
      font,
      color: BLACK_COLOR,
    });
  });

  // Right column (Debit Order details)
  const rightStartX = 320;
  const rightStartY = leftStartY;
  page.drawText("Debit Order Details", {
    x: rightStartX,
    y: rightStartY,
    size: 12,
    font: fontBold,
    color: BLACK_COLOR,
  });
  const rightLines = [
    `Account Holder Name: ${safeText(data.acc_holder)}`,
    `Account Holder ID: ${safeText(data.acc_holder_id)}`,
    `Bank: ${safeText(data.bank)}`,
    `Bank Account No: ${safeText(data.bank_account)}`,
    `Account Type: ${safeText(data.account_type)}`,
    `Debit Order Date: ${safeText(data.debit_date)}`,
  ];
  rightLines.forEach((line, i) => {
    page.drawText(line, {
      x: rightStartX,
      y: rightStartY - 20 - i * 15,
      size: 10,
      font,
      color: BLACK_COLOR,
    });
  });

  // End info divider
  page.drawLine({
    start: { x: 50, y: leftStartY - 130 },
    end: { x: width - 50, y: leftStartY - 130 },
    thickness: 1,
    dashArray: [3, 3],
    color: BLACK_COLOR,
  });

  // Terms (moved down)
  page.drawText(safeText(data.terms), {
    x: 50,
    y: leftStartY - 150,
    size: DEBIT_TERMS_FONT_SIZE,
    font,
    color: BLACK_COLOR,
    maxWidth: width - 100,
    lineHeight: 10,
  });

  // Signature/date
  const sigY = 100;
  page.drawText(safeText(data.full_name), {
    x: 50,
    y: sigY,
    size: 10,
    font,
    color: BLACK_COLOR,
  });
  page.drawText("Signature", {
    x: width / 2 - 30,
    y: sigY + 15,
    size: 10,
    font,
    color: BLACK_COLOR,
  });
  page.drawText(safeText(data.date), {
    x: width - 100,
    y: sigY,
    size: 10,
    font,
    color: BLACK_COLOR,
  });

  // Security audit page
  const secPage = pdfDoc.addPage([595.28, 841.89]);
  secPage.drawImage(logoImage, {
    x: 50,
    y: height - logoDims.height - 40,
    width: logoDims.width,
    height: logoDims.height,
  });
  secPage.drawText("Vinet Debit Order Instruction - Security Audit", {
    x: 50,
    y: height - 60,
    size: 14,
    font: fontBold,
    color: RED_COLOR,
  });
  secPage.drawLine({
    start: { x: 50, y: height - 70 },
    end: { x: width - 50, y: height - 70 },
    thickness: 1,
    dashArray: [3, 3],
    color: BLACK_COLOR,
  });
  secPage.drawText("Security audit details go here...", {
    x: 50,
    y: height - 100,
    size: 10,
    font,
    color: BLACK_COLOR,
  });

  return await pdfDoc.save();
}
// ----- PDF: MSA -----
async function renderMSAPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();

  // Logo
  const logoBytes = await fetchImageBytes(LOGO_URL);
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoDims = logoImage.scale(0.5);
  page.drawImage(logoImage, {
    x: 50,
    y: height - logoDims.height - 40,
    width: logoDims.width,
    height: logoDims.height,
  });

  // Title in red
  page.drawText("Vinet Internet Solutions Service Agreement", {
    x: 200,
    y: height - 60,
    size: 14,
    font: fontBold,
    color: RED_COLOR,
  });

  // Dashed divider line
  page.drawLine({
    start: { x: 50, y: height - 70 },
    end: { x: width - 50, y: height - 70 },
    thickness: 1,
    dashArray: [3, 3],
    color: BLACK_COLOR,
  });

  // Left column (personal info)
  const leftStartY = height - 100;
  const leftLines = [
    `Client code: ${safeText(data.client_code)}`,
    `Full Name: ${safeText(data.full_name)}`,
    `ID / Passport: ${safeText(data.id_number)}`,
    `Email: ${safeText(data.email)}`,
  ];
  leftLines.forEach((line, i) => {
    page.drawText(line, {
      x: 50,
      y: leftStartY - i * 15,
      size: 10,
      font,
      color: BLACK_COLOR,
    });
  });

  // Right column
  const rightStartX = 320;
  const rightStartY = leftStartY;
  const rightLines = [
    `Phone: ${safeText(data.phone)}`,
    `Street: ${safeText(data.street)}`,
    `City: ${safeText(data.city)}`,
    `ZIP: ${safeText(data.zip)}`,
  ];
  rightLines.forEach((line, i) => {
    page.drawText(line, {
      x: rightStartX,
      y: rightStartY - i * 15,
      size: 10,
      font,
      color: BLACK_COLOR,
    });
  });

  // End info divider
  page.drawLine({
    start: { x: 50, y: leftStartY - 80 },
    end: { x: width - 50, y: leftStartY - 80 },
    thickness: 1,
    dashArray: [3, 3],
    color: BLACK_COLOR,
  });

  // Terms in two columns
  const colWidth = (width - 120) / 2;
  const col1X = 50;
  const col2X = col1X + colWidth + 20;
  const terms = safeText(data.terms || "").split("\n");

  let y1 = leftStartY - 100;
  let y2 = leftStartY - 100;
  terms.forEach((line) => {
    if (y1 > 50) {
      page.drawText(line, {
        x: col1X,
        y: y1,
        size: MSA_TERMS_FONT_SIZE,
        font,
        color: BLACK_COLOR,
        maxWidth: colWidth,
      });
      y1 -= 10;
    } else {
      page.drawText(line, {
        x: col2X,
        y: y2,
        size: MSA_TERMS_FONT_SIZE,
        font,
        color: BLACK_COLOR,
        maxWidth: colWidth,
      });
      y2 -= 10;
    }
  });

  // New page if needed for overflow
  if (y2 <= 50) {
    const extraPage = pdfDoc.addPage([595.28, 841.89]);
    extraPage.drawText("(Continued...)", {
      x: 50,
      y: height - 100,
      size: 8,
      font,
      color: BLACK_COLOR,
    });
  }

  // Signature/date at end
  const sigY = 50;
  page.drawText(safeText(data.full_name), {
    x: 50,
    y: sigY,
    size: 10,
    font,
    color: BLACK_COLOR,
  });
  page.drawText("Signature", {
    x: width / 2 - 30,
    y: sigY + 15,
    size: 10,
    font,
    color: BLACK_COLOR,
  });
  page.drawText(safeText(data.date), {
    x: width - 100,
    y: sigY,
    size: 10,
    font,
    color: BLACK_COLOR,
  });

  return await pdfDoc.save();
}
// ---------- Helpers for KV / R2 / Terms ----------
const PDF_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_MSA_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
const DEFAULT_DEBIT_TERMS_URL = "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function ipAllowed(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 226 && c >= 128 && c <= 143;
}

function todayZA() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function kvGetJson(env, key) {
  try { return await env.ONBOARD_KV.get(key, "json"); } catch { return null; }
}

async function fetchTextCached(env, url, cacheKeyPrefix) {
  const key = `${cacheKeyPrefix}:${btoa(url).slice(0, 40)}`;
  const cached = await env.ONBOARD_KV.get(key);
  if (cached) return cached;
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 600 } });
    if (!res.ok) return "";
    const txt = await res.text();
    // sanitize for WinAnsi (strip smart quotes etc.)
    const safe = safeText(txt);
    await env.ONBOARD_KV.put(key, safe, { expirationTtl: PDF_CACHE_TTL });
    return safe;
  } catch {
    return "";
  }
}

async function getSession(env, linkid) {
  return await kvGetJson(env, `onboard/${linkid}`);
}

async function getDebitTerms(env) {
  const u = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
  return await fetchTextCached(env, u, "terms:debit");
}

async function getMsaTerms(env) {
  const u = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  return await fetchTextCached(env, u, "terms:msa");
}

async function getSignatureBytes(env, key) {
  if (!key) return null;
  try {
    const obj = await env.R2_UPLOADS.get(key);
    if (!obj) return null;
    return await obj.arrayBuffer();
  } catch {
    return null;
  }
}

// ---------- Builders for PDF payloads ----------
async function buildDebitPayload(env, linkid) {
  const sess = await getSession(env, linkid);
  if (!sess) throw new Error("Session not found");
  const edits = sess.edits || {};
  const d = sess.debit || {};
  const idOnly = String(linkid).split("_")[0];

  return {
    client_code: idOnly,
    full_name: edits.full_name || "",
    id_number: edits.passport || "",
    email: edits.email || "",
    phone: edits.phone || "",
    street: edits.street || "",
    city: edits.city || "",
    zip: edits.zip || "",

    acc_holder: d.account_holder || "",
    acc_holder_id: d.id_number || "",
    bank: d.bank_name || "",
    bank_account: d.account_number || "",
    account_type: d.account_type || "",
    debit_date: d.debit_day || "",

    terms: (await getDebitTerms(env)) || "Terms unavailable.",
    date: todayZA(),
    // signature image (optional embed in later part)
    sig_png_bytes: await getSignatureBytes(env, sess.debit_sig_key || ""),
  };
}

async function buildMsaPayload(env, linkid) {
  const sess = await getSession(env, linkid);
  if (!sess) throw new Error("Session not found");
  if (!sess.agreement_signed) throw new Error("MSA not signed yet");

  const edits = sess.edits || {};
  const idOnly = String(linkid).split("_")[0];

  return {
    client_code: idOnly,
    full_name: edits.full_name || "",
    id_number: edits.passport || "",
    email: edits.email || "",
    phone: edits.phone || "",
    street: edits.street || "",
    city: edits.city || "",
    zip: edits.zip || "",
    terms: (await getMsaTerms(env)) || "Terms unavailable.",
    date: todayZA(),
    // signature image (optional embed in later part)
    sig_png_bytes: await getSignatureBytes(env, sess.agreement_sig_key || ""),
  };
}

// ===============================
// Admin + Onboarding UI RENDERERS
// ===============================

const ADMIN_RED = "#e2001a";

function renderAdminPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Admin</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
.card{background:#fff;max-width:1000px;margin:2em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.4em 1.6em}
.logo{display:block;margin:0 auto 1em;max-width:120px}
h1,h2{color:${ADMIN_RED}}
.tabs{display:flex;gap:.5em;flex-wrap:wrap;margin:.2em 0 1em;justify-content:center}
.tab{padding:.55em 1em;border-radius:.7em;border:2px solid ${ADMIN_RED};color:${ADMIN_RED};cursor:pointer}
.tab.active{background:${ADMIN_RED};color:#fff}
.btn{background:${ADMIN_RED};color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}
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
    <div class="tab active" data-tab="gen">Generate onboarding link</div>
    <div class="tab" data-tab="staff">Generate verification code</div>
    <div class="tab" data-tab="inprog">Pending (in-progress)</div>
    <div class="tab" data-tab="pending">Completed (awaiting approval)</div>
    <div class="tab" data-tab="approved">Approved</div>
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
            const r=await fetch('/api/staff/gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
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

function renderOnboardUI(linkid) {
  // keeps your “smooth look” & step order that you approved
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<title>Onboarding</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}
  .card{background:#fff;max-width:650px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1,h2{color:${ADMIN_RED}}
  .btn{background:${ADMIN_RED};color:#fff;border:0;border-radius:.7em;padding:.7em 2em;font-size:1em;cursor:pointer;margin:.8em 0 0}
  .btn-outline{background:#fff;color:${ADMIN_RED};border:2px solid ${ADMIN_RED};border-radius:.7em;padding:.6em 1.4em}
  .field{margin:1em 0} input,select,textarea{width:100%;padding:.7em;font-size:1em;border-radius:.5em;border:1px solid #ddd}
  .note{font-size:12px;color:#666}
  .progressbar{height:7px;background:#eee;border-radius:5px;margin:1.4em 0 2.2em;overflow:hidden}
  .progress{height:100%;background:${ADMIN_RED};transition:width .4s}
  .row{display:flex;gap:.75em}.row>*{flex:1}
  .pill-wrap{display:flex;gap:.6em;flex-wrap:wrap;margin:.6em 0 0}
  .pill{border:2px solid ${ADMIN_RED};color:${ADMIN_RED};padding:.6em 1.2em;border-radius:999px;cursor:pointer}
  .pill.active{background:${ADMIN_RED};color:#fff}
  .termsbox{max-height:280px;overflow:auto;padding:1em;border:1px solid #ddd;border-radius:.6em;background:#fafafa}
  canvas.signature{border:1px dashed #bbb;border-radius:.6em;width:100%;height:180px;touch-action:none;background:#fff}
  .bigchk{display:flex;align-items:center;gap:.6em;font-weight:700}
  .bigchk input[type=checkbox]{width:22px;height:22px}
  .accent { height:8px; background:${ADMIN_RED}; border-radius:4px; width:60%; max-width:540px; margin:10px auto 18px; }
  .final p { margin:.35em 0 .65em; }
  .final ul { margin:.25em 0 0 1em; }
  .doclist { list-style:none; margin:.4em 0 0 0; padding:0; }
  .doclist .doc-item { display:flex; align-items:center; gap:.5em; margin:.45em 0; }
  .doclist .doc-ico { display:inline-flex; width:18px; height:18px; opacity:.9; }
  .doclist .doc-ico svg { width:18px; height:18px; }
  .doclist a { text-decoration:none; }
  .doclist a:hover { text-decoration:underline; }
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
      const r = await fetch('/api/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid})});
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
    document.getElementById('otpForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"wa"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('otpmsg').textContent='Invalid code. Try again.'; } };

    const staff=document.getElementById('staffBox');
    staff.innerHTML='<div class="note">Ask Vinet for a one-time staff code.</div><form id="staffForm" autocomplete="off" class="field"><div class="row"><input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code from Vinet" required /><button class="btn" type="submit">Verify</button></div></form><div id="staffMsg" class="note"></div>';
    document.getElementById('staffForm').onsubmit=async(e)=>{ e.preventDefault(); const otp=e.target.otp.value.trim(); const r=await fetch('/api/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({linkid,otp,kind:"staff"})}); const d=await r.json().catch(()=>({ok:false})); if(d.ok){ step=2; state.progress=step; setProg(); save(); render(); } else { document.getElementById('staffMsg').textContent='Invalid or expired staff code.'; } };

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
          await fetch('/api/debit/save?linkid='+encodeURIComponent(linkid), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...state.debit, splynx_id: id }) });
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
    const docIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5L18.5 8H14V3.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15zM8 9h4v1.5H8V9z"/></svg>';
    stepEl.innerHTML = [
      '<div class="final">',
        '<h2 style="color:${ADMIN_RED};margin:0 0 .2em">All set!</h2>',
        '<div class="accent"></div>',
        '<p>Thanks – we’ve recorded your information. Our team will be in contact shortly.</p>',
        '<p>If you have any questions, please contact our sales team:</p>',
        '<ul>',
          '<li><b>Phone:</b> <a href="tel:+27210070200">021 007 0200</a></li>',
          '<li><b>Email:</b> <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></li>',
        '</ul>',
        '<hr style="border:none;border-top:1px solid #e6e6e6;margin:16px 0">',
        '<div class="field"><b>Your agreements</b> <span class="note">(links work after signing; PDFs generate instantly)</span></div>',
        '<ul class="doclist">',
          '<li class="doc-item"><span class="doc-ico">', docIcon, '</span>',
            '<a href="/pdf/msa/', linkid, '" target="_blank">Master Service Agreement (PDF)</a>',
            ' &nbsp;•&nbsp; <a href="/agreements/msa/', linkid, '" target="_blank">View in browser</a>',
          '</li>',
          (showDebit
            ? '<li class="doc-item"><span class="doc-ico">' + docIcon + '</span>' +
              '<a href="/pdf/debit/' + linkid + '" target="_blank">Debit Order Agreement (PDF)</a>' +
              ' &nbsp;•&nbsp; <a href="/agreements/debit/' + linkid + '" target="_blank">View in browser</a>' +
              '</li>'
            : ''),
        '</ul>',
      '</div>'
    ].join('');
  }

  function render(){ setProg(); [step0,step1,step2,step3,step4,step5,step6][step](); }
  render();
})();
</script>
</body></html>`;
}

// ===============================
// ROUTE HANDLERS (no export here)
// ===============================

// Terms (for UI display)
async function handleGetTerms(env, kind) {
  const svcUrl = env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
  async function getText(u) {
    try { const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } }); return r.ok ? await r.text() : ""; }
    catch { return ""; }
  }
  const esc = s => s.replace(/[&<>]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[t]));
  const service = esc(await getText(svcUrl) || "");
  const debit = esc(await getText(debUrl) || "");
  let body = "";
  if ((kind||"").toLowerCase()==="debit") body = `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`;
  else body = `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;
  return new Response(body || "<p>Terms unavailable.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Admin: generate link
async function handleAdminGenLink(request, env, origin) {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
  const { id } = await request.json().catch(() => ({}));
  if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: { "content-type": "application/json" } });
  const token = Math.random().toString(36).slice(2, 10);
  const linkid = `${id}_${token}`;
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ id, created: Date.now(), progress: 0 }), { expirationTtl: 86400 });
  return new Response(JSON.stringify({ url: `${origin}/onboard/${linkid}` }), { headers: { "content-type": "application/json" } });
}

// Admin: list
async function handleAdminList(request, env, mode) {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
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
  items.sort((a, b) => b.updated - a.updated);
  return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } });
}

// Admin: review page
async function handleAdminReview(request, env, linkid) {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response("Not found", { status: 404 });
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const filesHTML = uploads.length
    ? `<ul style="list-style:none;padding:0">${uploads.map(u=>`<li style="margin:.35em 0;padding:.4em .6em;border:1px solid #eee;border-radius:.5em"><b>${escapeHtml(u.label||'File')}</b> — ${escapeHtml(u.name||'')} • ${Math.round((u.size||0)/1024)} KB</li>`).join("")}</ul>`
    : `<div class="note">No files</div>`;
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Review</title>
<style>body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232}.card{background:#fff;max-width:900px;margin:2em auto;border-radius:1em;box-shadow:0 2px 12px #0002;padding:1.2em 1.4em}h1,h2{color:${ADMIN_RED}}.btn{background:${ADMIN_RED};color:#fff;border:0;border-radius:.7em;padding:.55em 1em;cursor:pointer}.btn-outline{background:#fff;color:${ADMIN_RED};border:2px solid ${ADMIN_RED};border-radius:.7em;padding:.5em 1em}.note{color:#666;font-size:12px}</style></head><body>
<div class="card">
  <h1>Review & Approve</h1>
  <div class="note">Splynx ID: <b>${escapeHtml(sess.id||'')}</b> • LinkID: <code>${escapeHtml(linkid)}</code> • Status: <b>${escapeHtml(sess.status||'n/a')}</b></div>
  <h2>Edits</h2><div>${Object.entries(sess.edits||{}).map(([k,v])=>`<div><b>${escapeHtml(k)}</b>: ${v?escapeHtml(String(v)):''}</div>`).join("") || "<div class='note'>None</div>"}</div>
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

// Admin: reject / approve
async function handleAdminReject(request, env) {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
  const { linkid, reason } = await request.json().catch(() => ({}));
  if (!linkid) return new Response(JSON.stringify({ ok:false, error:"Missing linkid" }), { status: 400, headers: { "content-type":"application/json" } });
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return new Response(JSON.stringify({ ok:false, error:"Not found" }), { status: 404, headers: { "content-type":"application/json" } });
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, status:"rejected", reject_reason:String(reason||"").slice(0,300), rejected_at:Date.now() }), { expirationTtl:86400 });
  return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
}
async function handleAdminApprove(request, env) {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
  return new Response(JSON.stringify({ ok:true }), { headers: { "content-type":"application/json" } });
}

// Onboarding: OTP send / verify
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
  if (typeof obj === "string") return ok(obj) ? String(obj).trim() : null;
  if (Array.isArray(obj)) { for (const it of obj) { const m = pickPhone(it); if (m) return m; } return null; }
  if (typeof obj === "object") {
    const direct = [
      obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp,
      obj.msisdn, obj.primary_phone, obj.contact_number, obj.billing_phone,
      obj.contact_number_2nd, obj.contact_number_3rd, obj.alt_phone, obj.alt_mobile
    ];
    for (const v of direct) if (ok(v)) return String(v).trim();
    for (const [, v] of Object.entries(obj)) {
      if (typeof v === "string" && ok(v)) return String(v).trim();
      if (v && typeof v === "object") { const m = pickPhone(v); if (m) return m; }
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
    `/crm/leads/${id}/contacts`,
  ];
  for (const ep of eps) {
    try { const data = await splynxGET(env, ep); const m = pickPhone(data); if (m) return m; } catch {}
  }
  return null;
}
async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
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
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`WA template send failed ${r.status} ${t}`); }
}
async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to:toMsisdn, type:"text", text:{ body:bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`WA text send failed ${r.status} ${t}`); }
}

// Save small helpers used by routes in Part 5
function localDateDash() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
// =====================================
// Part 5/5 — Final Router + All Handlers
// =====================================

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });
}

function getIP(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    ""
  );
}
function getUA(request) {
  return request.headers.get("user-agent") || "";
}

// Small helper for agreement HTML routes
async function fetchTextSimple(url) {
  try {
    const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

// Agreements HTML (view in browser)
async function renderAgreementHtml(env, type, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess || !sess.agreement_signed)
    return new Response("Agreement not available yet.", { status: 404 });

  const e = sess.edits || {};
  const today = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  })();

  const name = escapeHtml(e.full_name || "");
  const email = escapeHtml(e.email || "");
  const phone = escapeHtml(e.phone || "");
  const street = escapeHtml(e.street || "");
  const city = escapeHtml(e.city || "");
  const zip = escapeHtml(e.zip || "");
  const passport = escapeHtml(e.passport || "");
  const debit = sess.debit || null;

  const msaTerms =
    (await fetchTextSimple(env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL)) ||
    "";
  const debitTerms =
    (await fetchTextSimple(env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL)) ||
    "";

  function page(title, body) {
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
        title
      )}</title><style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;background:#fafbfc;color:#222}
        .card{background:#fff;max-width:820px;margin:24px auto;border-radius:14px;box-shadow:0 2px 12px #0002;padding:22px 26px}
        h1{color:#e2001a;margin:.2em 0 .3em;font-size:28px}.b{font-weight:600}
        table{width:100%;border-collapse:collapse;margin:.6em 0}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
        .muted{color:#666;font-size:12px}.sig{margin-top:14px}.sig img{max-height:120px;border:1px dashed #bbb;border-radius:6px;background:#fff}
        .actions{margin-top:14px}.btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
        .logo{height:60px;display:block;margin:0 auto 10px}@media print {.actions{display:none}}
        pre.terms{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:12px;border-radius:8px}
      </style></head><body><div class="card">
        <img class="logo" src="${LOGO_URL}" alt="Vinet"><h1>${escapeHtml(
        title
      )}</h1>
        ${body}
        <div class="actions"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
        <div class="muted">Generated ${today} • Link ${escapeHtml(linkid)}</div>
      </div></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

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
      </div>
      <h2>Terms</h2>
      <pre class="terms">${escapeHtml(msaTerms || "Terms unavailable.")}</pre>`;
    return page("Master Service Agreement", body);
  }

  if (type === "debit") {
    const hasDebit = !!(debit && debit.account_holder && debit.account_number);
    const debitHtml = hasDebit
      ? `
      <table>
        <tr><th class="b">Account Holder</th><td>${escapeHtml(
          debit.account_holder || ""
        )}</td></tr>
        <tr><th class="b">ID Number</th><td>${escapeHtml(
          debit.id_number || ""
        )}</td></tr>
        <tr><th class="b">Bank</th><td>${escapeHtml(
          debit.bank_name || ""
        )}</td></tr>
        <tr><th class="b">Account No</th><td>${escapeHtml(
          debit.account_number || ""
        )}</td></tr>
        <tr><th class="b">Account Type</th><td>${escapeHtml(
          debit.account_type || ""
        )}</td></tr>
        <tr><th class="b">Debit Day</th><td>${escapeHtml(
          debit.debit_day || ""
        )}</td></tr>
      </table>`
      : `<p class="muted">No debit order details on file for this onboarding.</p>`;
    const body = `
      <p>This document represents your Debit Order Instruction.</p>
      ${debitHtml}
      <div class="sig"><div class="b">Signature</div>
        <img src="/agreements/sig-debit/${linkid}.png" alt="signature">
      </div>
      <h2>Terms</h2>
      <pre class="terms">${escapeHtml(debitTerms || "Terms unavailable.")}</pre>`;
    return page("Debit Order Agreement", body);
  }

  return new Response("Unknown agreement type", { status: 404 });
}

// Minimal profile display (for /api/splynx/profile)
async function handleProfile(env, id) {
  try {
    const tryGET = async (ep) => {
      try {
        const r = await fetch(`${env.SPLYNX_API}${ep}`, {
          headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    };
    const primary =
      (await tryGET(`/admin/customers/customer/${id}`)) ||
      (await tryGET(`/admin/customers/${id}`)) ||
      (await tryGET(`/crm/leads/${id}`)) ||
      {};
    const info =
      (await tryGET(`/admin/customers/customer-info/${id}`)) || {};
    const contacts =
      (await tryGET(`/admin/customers/${id}/contacts`)) ||
      (await tryGET(`/crm/leads/${id}/contacts`)) ||
      {};

    const pick = (...names) => {
      for (const n of names) {
        const v = primary?.[n];
        if (v) return String(v);
        const iv = info?.[n];
        if (iv) return String(iv);
      }
      return "";
    };

    // try phone via helper from Part 4
    let phone = pickPhone({ ...primary, contacts }) || "";

    // address bits
    const street =
      primary.street ||
      primary.address ||
      primary.address_1 ||
      primary.street_1 ||
      primary?.addresses?.street ||
      primary?.addresses?.address_1 ||
      "";
    const city = primary.city || primary?.addresses?.city || "";
    const zip =
      primary.zip_code ||
      primary.zip ||
      primary?.addresses?.zip ||
      primary?.addresses?.zip_code ||
      "";

    const passport =
      info.passport ||
      info.id_number ||
      info.identity_number ||
      primary.passport ||
      primary.id_number ||
      "";

    const out = {
      id,
      full_name: primary.full_name || primary.name || "",
      email: primary.email || primary.billing_email || "",
      phone,
      street,
      city,
      zip,
      passport,
    };
    return json(out);
  } catch {
    return json({ error: "Lookup failed" }, 502);
  }
}

// ==================
// Final Worker Export
// ==================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Root admin (IP restricted)
    if (path === "/" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      return new Response(renderAdminPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (path === "/static/admin.js" && method === "GET") {
      return new Response(adminJs(), {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }

    // Info: EFT
    if (path === "/info/eft" && method === "GET") {
      const id = url.searchParams.get("id") || "";
      return new Response(await renderEFTPage(id), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Terms for UI
    if (path === "/api/terms" && method === "GET") {
      const kind = url.searchParams.get("kind") || "";
      return handleGetTerms(env, kind);
    }

    // Admin APIs (IP restricted)
    if (path === "/api/admin/genlink" && method === "POST") {
      return handleAdminGenLink(request, env, url.origin);
    }
    if (path === "/api/admin/list" && method === "GET") {
      const mode = url.searchParams.get("mode") || "pending";
      return handleAdminList(request, env, mode);
    }
    if (path === "/admin/review" && method === "GET") {
      if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
      const linkid = url.searchParams.get("linkid") || "";
      if (!linkid) return new Response("Missing linkid", { status: 400 });
      return handleAdminReview(request, env, linkid);
    }
    if (path === "/api/admin/reject" && method === "POST") {
      return handleAdminReject(request, env);
    }
    if (path === "/api/admin/approve" && method === "POST") {
      return handleAdminApprove(request, env);
    }
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

    // OTP send/verify
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
      if (!msisdn)
        return json({ ok: false, error: "No WhatsApp number on file" }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, {
        expirationTtl: 600,
      });
      try {
        await sendWhatsAppTemplate(env, msisdn, code, "en");
        return json({ ok: true });
      } catch (e) {
        try {
          await sendWhatsAppTextIfSessionOpen(
            env,
            msisdn,
            `Your Vinet verification code is: ${code}`
          );
          return json({ ok: true, note: "sent-as-text" });
        } catch {
          return json(
            { ok: false, error: "WhatsApp send failed (template+text)" },
            502
          );
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
        if (sess)
          await env.ONBOARD_KV.put(
            `onboard/${linkid}`,
            JSON.stringify({ ...sess, otp_verified: true }),
            { expirationTtl: 86400 }
          );
        if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
      return json({ ok });
    }

    // Onboarding UI
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Uploads to R2
    if (path === "/api/onboard/upload" && method === "POST") {
      const q = new URL(request.url).searchParams;
      const linkid = q.get("linkid");
      const fileName = q.get("filename") || "file.bin";
      const label = q.get("label") || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Invalid link", { status: 404 });
      const body = await request.arrayBuffer();
      const key = `uploads/${linkid}/${Date.now()}_${fileName}`;
      await env.R2_UPLOADS.put(key, body);
      const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
      uploads.push({ key, name: fileName, size: body.byteLength, label });
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ ...sess, uploads }),
        { expirationTtl: 86400 }
      );
      return json({ ok: true, key });
    }

    // Save progress
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const existing =
        (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = {
        ...existing,
        ...body,
        last_ip: getIP(request),
        last_ua: getUA(request),
        last_time: Date.now(),
      };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), {
        expirationTtl: 86400,
      });
      return json({ ok: true });
    }

    // Debit order save/sign
    if (path === "/api/debit/save" && method === "POST") {
      const b =
        (await request.json().catch(async () => {
          const form = await request.formData().catch(() => null);
          if (!form) return {};
          const o = {};
          for (const [k, v] of form.entries()) o[k] = v;
          return o;
        })) || {};
      const required = [
        "account_holder",
        "id_number",
        "bank_name",
        "account_number",
        "account_type",
        "debit_day",
      ];
      for (const k of required)
        if (!b[k] || String(b[k]).trim() === "")
          return json({ ok: false, error: `Missing ${k}` }, 400);
      const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
      const ts = Date.now();
      const key = `debit/${id}/${ts}`;
      const record = {
        ...b,
        splynx_id: id,
        created: ts,
        ip: getIP(request),
        ua: getUA(request),
      };
      await env.ONBOARD_KV.put(key, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 90,
      });
      // optional session update when linkid is on query
      const linkid = url.searchParams.get("linkid") || "";
      if (linkid) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess)
          await env.ONBOARD_KV.put(
            `onboard/${linkid}`,
            JSON.stringify({ ...sess, debit: { ...record } }),
            { expirationTtl: 86400 }
          );
      }
      return json({ ok: true, ref: key });
    }
    if (path === "/api/debit/sign" && method === "POST") {
      const { linkid, dataUrl } = await request.json().catch(() => ({}));
      if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
        return json({ ok: false, error: "Missing/invalid signature" }, 400);
      const png = dataUrl.split(",")[1];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const sigKey = `debit_agreements/${linkid}/signature.png`;
      await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
        httpMetadata: { contentType: "image/png" },
      });
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({ ...sess, debit_signed: true, debit_sig_key: sigKey }),
          { expirationTtl: 86400 }
        );
      }
      return json({ ok: true, sigKey });
    }

    // Agreement signature PNGs
    if (path.startsWith("/agreements/sig/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.agreement_sig_key)
        return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }
    if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
      const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess || !sess.debit_sig_key)
        return new Response("Not found", { status: 404 });
      const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { "content-type": "image/png" } });
    }

    // Agreements HTML
    if (path.startsWith("/agreements/") && method === "GET") {
      const [, , type, linkid] = path.split("/");
      if (!type || !linkid) return new Response("Bad request", { status: 400 });
      return renderAgreementHtml(env, type, linkid);
    }

    // Splynx profile proxy
    if (path === "/api/splynx/profile" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      return handleProfile(env, id);
    }

    // Onboard UI (duplicate guard)
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = path.split("/")[2] || "";
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!sess) return new Response("Link expired or invalid", { status: 404 });
      return new Response(renderOnboardUI(linkid), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // PDF endpoints (from Part 3)
    if (path.startsWith("/pdf/msa/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderMSAPdf(env, linkid);
    }
    if (path.startsWith("/pdf/debit/") && method === "GET") {
      const linkid = path.split("/").pop();
      return await renderDebitPdf(env, linkid);
    }

    return new Response("Not found", { status: 404 });
  },
};
