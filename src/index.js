// index.js – Vinet Onboarding Worker (Updated with PDF on sign, fixes, and R2 paths)
// Merged from last working version + requested changes

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Restrict admin & API routes to allowed IP range
      const clientIP = request.headers.get("cf-connecting-ip") || "";
      const allowedCIDR = "160.226.128.0/20";
      if ((path.startsWith("/admin") || path.startsWith("/api")) && !ipInRange(clientIP, allowedCIDR)) {
        return new Response("Access denied", { status: 403 });
      }

      // ROUTES
      if (path === "/") return renderAdmin(env);
      if (path.startsWith("/onboard/")) return onboardHTML(path.split("/")[2], env);
      if (path.startsWith("/api/otp/send")) return sendOtp(request, env);
      if (path.startsWith("/api/otp/verify")) return verifyOtp(request, env);
      if (path.startsWith("/api/progress/")) return saveProgress(path.split("/")[3], request, env);
      if (path.startsWith("/api/finalize")) return finalizeSubmission(request, env);
      if (path.startsWith("/api/delete")) return deletePending(request, env);
      
if (path.startsWith("/api/upload")) return handleUpload(request, env);
      if (path.startsWith("/info/eft")) return eftHTML(url.searchParams.get("id"));
      if (path.startsWith("/info/debit")) return debitOrderHTML(url.searchParams.get("id"), env);

      if (path.startsWith("/r2/")) {
        return serveR2(path.replace("/r2/", ""), env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Worker exception: " + err.message, { status: 500 });
    }
  }
};

// ==================== HELPERS ====================

function ipInRange(ip, cidr) {
  const [range, bits = "32"] = cidr.split("/");
  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  const mask = ~(2 ** (32 - bits) - 1);
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

// ==================== ADMIN PAGE ====================

async function renderAdmin(env) {
  // This renders the main admin dashboard with the 5 sections
  const html = `
  <html>
  <head>
    <title>Vinet Onboarding Admin</title>
    <style>
      body { font-family: system-ui, sans-serif; padding:20px; background:#f4f4f4; }
      h1 { color:#e2001a; }
      .grid { display:grid; grid-template-columns: repeat(2,1fr); gap:20px; }
      .section { background:#fff; padding:20px; border-radius:10px; box-shadow:0 2px 5px #0002; }
      input, button { padding:8px; margin-top:5px; }
      .link-output { margin-top:10px; font-weight:bold; background:#fafafa; padding:5px; border-radius:5px; }
    </style>
  </head>
  <body>
    <h1>Vinet Onboarding Admin</h1>
    <div class="grid">
      <div class="section">
        <h2>1. Generate Onboarding Link</h2>
        <input type="text" id="clientId" placeholder="Client ID" />
        <button onclick="genLink()">Generate</button>
        <div id="linkResult" class="link-output"></div>
      </div>
      <div class="section">
        <h2>2. Generate OTP Code</h2>
        <input type="text" id="otpId" placeholder="Client ID" />
        <button onclick="genOtp()">Generate OTP</button>
      </div>
      <div class="section">
        <h2>3. Pending Onboarding</h2>
        <div id="pendingList">Loading...</div>
      </div>
      <div class="section">
        <h2>4. Awaiting Approval</h2>
        <div id="awaitingList">Loading...</div>
      </div>
      <div class="section">
        <h2>5. Approved</h2>
        <div id="approvedList">Loading...</div>
      </div>
    </div>
    <script>
      async function genLink(){
        const id = document.getElementById('clientId').value.trim();
        if(!id) return alert('Enter client ID');
        const r = await fetch('/api/genlink?id='+id);
        const data = await r.json();
        if(data.url){
          document.getElementById('linkResult').innerHTML = '<a href="'+data.url+'" target="_blank">'+data.url+'</a>';
        }
      }
      async function genOtp(){
        const id = document.getElementById('otpId').value.trim();
        if(!id) return alert('Enter client ID');
        await fetch('/api/otp/send',{method:'POST',body:JSON.stringify({linkid:id})});
        alert('OTP sent if possible');
      }
    </script>
  </body>
  </html>`;
  return new Response(html, { headers: { "content-type": "text/html" } });
}
// ==================== ONBOARDING FLOW ====================

async function onboardHTML(linkId, env) {
  // Extract ID and token
  const [id, token] = linkId.split("_");
  if (!id || !token) return new Response("Invalid link", { status: 400 });

  // Get customer/lead info from Splynx
  const splynxResp = await fetch(`${env.SPLYNX_API}/api/2.0/admin/customers/customer/${id}`, {
    headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
  });

  if (!splynxResp.ok) return new Response("Unable to load client data", { status: 500 });
  const customer = await splynxResp.json();

  // Ensure missing fields don't break UI
  const firstName = customer.first_name || "";
  const lastName = customer.last_name || "";
  const idNumber = customer.passport || ""; // Splynx "passport" field
  const street = (customer.street_1 || "").trim();
  const city = customer.city || "";
  const zip = customer.zip_code || "";
  const phone = customer.phone || "";
  const email = customer.email || "";

  const html = `
  <html>
  <head>
    <title>Vinet Onboarding</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; background:#f4f4f4; margin:0; padding:0; }
      header { background:#fff; padding:15px; text-align:center; }
      header img { max-width: 180px; height:auto; }
      .step { max-width:700px; margin:20px auto; background:#fff; padding:20px; border-radius:10px; box-shadow:0 2px 5px #0001; }
      h2 { color:#e2001a; }
      input, select { width:100%; padding:8px; margin:5px 0 15px; border-radius:5px; border:1px solid #ccc; }
      label { font-weight:bold; display:block; margin-top:10px; }
      .btn { background:#e2001a; color:#fff; padding:10px 20px; border:none; border-radius:5px; cursor:pointer; }
      .btn:disabled { opacity:0.5; cursor:not-allowed; }
      .tickbox { transform: scale(1.5); margin-right:10px; }
      .ref-block { background:#f8f8f8; padding:10px; border:1px dashed #e2001a; font-weight:bold; }
    </style>
  </head>
  <body>
    <header>
      <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo" />
    </header>

    <div class="step">
      <h2>Welcome</h2>
      <p>Let's run through a few questions and verify your details.</p>
      <button class="btn" onclick="nextStep()">Start</button>
    </div>

    <div class="step" style="display:none">
      <h2>Payment Method</h2>
      <p>Please select your preferred payment method:</p>
      <select id="paymentMethod" onchange="paymentChange()">
        <option value="">--Select--</option>
        <option value="EFT">EFT</option>
        <option value="Debit">Debit Order</option>
      </select>
      <div id="eftBlock" style="display:none">
        <p class="ref-block">Please use the correct reference when making EFT payments.<br>REF: ${id}</p>
        <button class="btn" onclick="window.open('/info/eft?id=${id}','_blank')">Print Banking Details</button>
      </div>
      <div id="debitBlock" style="display:none">
        <label>Bank Account Holder Name:</label><input id="do_name" />
        <label>Bank Account Holder ID no:</label><input id="do_id" />
        <label>Bank:</label><input id="do_bank" />
        <label>Bank Account No:</label><input id="do_accno" />
        <label>Bank Account Type:</label>
        <select id="do_type">
          <option value="cheque">Cheque</option>
          <option value="savings">Savings</option>
          <option value="transmission">Transmission</option>
        </select>
        <label>Debit Order Date:</label>
        <select id="do_date">
          <option value="1">1st</option>
          <option value="7">7th</option>
          <option value="15">15th</option>
          <option value="25">25th</option>
          <option value="29">29th</option>
          <option value="30">30th</option>
        </select>
        <label><input type="checkbox" class="tickbox" id="do_terms" /> I accept the Debit Order Terms</label>
        <iframe src="${env.TERMS_DEBIT_URL}" style="width:100%;height:200px"></iframe>
      </div>
      <button class="btn" onclick="nextStep()">Next</button>
    </div>

    <div class="step" style="display:none">
      <h2>Please verify your details</h2>
      <label>First Name:</label><input id="firstName" value="${firstName}" />
      <label>Last Name:</label><input id="lastName" value="${lastName}" />
      <label>ID / Passport No:</label><input id="idNumber" value="${idNumber}" />
      <label>Email:</label><input id="email" value="${email}" />
      <label>Mobile Number:</label><input id="phone" value="${phone}" />
      <label>Street Address:</label><input id="street" value="${street}" />
      <label>City:</label><input id="city" value="${city}" />
      <label>ZIP Code:</label><input id="zip" value="${zip}" />
      <button class="btn" onclick="nextStep()">Next</button>
    </div>

    <div class="step" style="display:none">
      <h2>Please upload your supporting documents</h2>
      <p>ID or Passport and proof of address (as per RICA regulations)</p>
      <input type="file" id="doc1" accept="image/*,application/pdf" />
      <input type="file" id="doc2" accept="image/*,application/pdf" />
      <button class="btn" onclick="nextStep()">Next</button>
    </div>

    <div class="step" style="display:none">
      <h2>Vinet Service Agreement</h2>
      <iframe src="${env.TERMS_MSA_URL}" style="width:100%;height:200px"></iframe>
      <label><input type="checkbox" class="tickbox" id="msa_terms" /> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label>
      <p>Signature:</p>
      <canvas id="signature" width="500" height="150" style="border:1px solid #ccc"></canvas>
      <button class="btn" onclick="finish()">Finish</button>
    </div>

    <div class="step" style="display:none">
      <h2>All set!</h2>
      <p>Thanks - we've recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at 021 007 0200 / sales@vinetco.za</p>
      <div id="downloadLinks"></div>
    </div>

    <script>
      let step = 0;
      function nextStep(){
        document.querySelectorAll('.step')[step].style.display='none';
        step++;
        document.querySelectorAll('.step')[step].style.display='block';
      }
      function paymentChange(){
        const v = document.getElementById('paymentMethod').value;
        document.getElementById('eftBlock').style.display = v==='EFT' ? 'block' : 'none';
        document.getElementById('debitBlock').style.display = v==='Debit' ? 'block' : 'none';
      }
      function finish(){
        // TODO: upload PDF + show links
        nextStep();
        document.getElementById('downloadLinks').innerHTML = '<a href="${env.R2_PUBLIC_URL}/agreements/${id}_${token}/msa.pdf" target="_blank">Download Service Agreement</a>';
      }
    </script>
  </body>
  </html>
  `;

  return new Response(html, { headers: { "content-type": "text/html" } });
}
/* ---------- ADMIN PAGE RENDER ---------- */
function adminHTML(data) {
  const { pending, awaiting, approved } = data;
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Vinet Onboarding Admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: system-ui, sans-serif; margin:0; background:#fafafa; }
      header { background:#e2001a; padding:1em; color:#fff; text-align:center; }
      h1 { margin:0; font-size:1.4em; }
      .container { max-width:1000px; margin:auto; padding:1em; }
      .section { background:#fff; padding:1em; margin-bottom:1em; border-radius:.5em; box-shadow:0 1px 4px #0001; }
      h2 { font-size:1.2em; margin-top:0; }
      table { width:100%; border-collapse:collapse; font-size:.9em; }
      th, td { border-bottom:1px solid #ddd; padding:.5em; text-align:left; }
      .btn { background:#e2001a; color:#fff; border:0; padding:.4em .8em; border-radius:.3em; cursor:pointer; }
      .link-output { background:#f5f5f5; padding:.5em; border-radius:.3em; font-size:.85em; word-break:break-all; margin-top:.5em; }
      .tab-section { display:flex; justify-content:center; gap:1em; margin-bottom:1em; }
    </style>
  </head>
  <body>
    <header><h1>Vinet Onboarding Admin</h1></header>
    <div class="container">

      <div class="tab-section">
        <div class="section" style="flex:1;">
          <h2>1. Generate Onboarding Link</h2>
          <form id="genLink">
            <input name="id" placeholder="Client ID" style="padding:.4em;width:70%;" required>
            <button class="btn">Generate</button>
          </form>
          <div id="genLinkOut"></div>
        </div>
        <div class="section" style="flex:1;">
          <h2>2. Generate Verification Code</h2>
          <form id="genCode">
            <input name="id" placeholder="Client ID" style="padding:.4em;width:70%;" required>
            <button class="btn">Generate</button>
          </form>
          <div id="genCodeOut"></div>
        </div>
      </div>

      <div class="section">
        <h2>Pending Onboarding</h2>
        ${tableHTML(pending)}
      </div>
      <div class="section">
        <h2>Completed - Awaiting Approval</h2>
        ${tableHTML(awaiting, true)}
      </div>
      <div class="section">
        <h2>Approved</h2>
        ${tableHTML(approved)}
      </div>
    </div>
    <script>
      document.getElementById('genLink').onsubmit = async e => {
        e.preventDefault();
        const id = e.target.id.value.trim();
        const r = await fetch('/admin/gen?id=' + encodeURIComponent(id));
        const d = await r.json();
        document.getElementById('genLinkOut').innerHTML = '<div class="link-output">'+d.url+'</div>';
      };
      document.getElementById('genCode').onsubmit = async e => {
        e.preventDefault();
        const id = e.target.id.value.trim();
        const r = await fetch('/admin/code?id=' + encodeURIComponent(id));
        const d = await r.json();
        document.getElementById('genCodeOut').innerHTML = '<div class="link-output">'+d.code+'</div>';
      };
    </script>
  </body>
  </html>`;
}

/* ---------- TABLE BUILDER ---------- */
function tableHTML(arr, reviewLinks=false) {
  if (!arr || !arr.length) return `<p class="note">No records found.</p>`;
  return `<table>
    <tr><th>ID</th><th>Name</th><th>Created</th>${reviewLinks?'<th>Review</th>':''}</tr>
    ${arr.map(row => `<tr>
      <td>${row.id}</td>
      <td>${row.name||''}</td>
      <td>${new Date(row.created).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})}</td>
      ${reviewLinks?`<td><a href="/admin/review?id=${row.id}" class="btn">Review</a></td>`:''}
    </tr>`).join('')}
  </table>`;
}

/* ---------- REVIEW PAGE ---------- */
function reviewHTML(record) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Review Onboarding</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: system-ui, sans-serif; margin:0; background:#fafafa; }
      header { background:#e2001a; padding:1em; color:#fff; text-align:center; }
      .container { max-width:800px; margin:auto; padding:1em; }
      .btn { background:#e2001a; color:#fff; border:0; padding:.4em .8em; border-radius:.3em; cursor:pointer; }
      a { color:#e2001a; }
    </style>
  </head>
  <body>
    <header><h1>Review Onboarding</h1></header>
    <div class="container">
      <p><strong>Name:</strong> ${record.name||''}</p>
      <p><strong>Email:</strong> ${record.email||''}</p>
      <p><strong>Phone:</strong> ${record.phone||''}</p>
      <p><strong>Created:</strong> ${new Date(record.created).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})}</p>

      <h3>Agreements</h3>
      <ul>
        ${record.msa_url ? `<li><a href="${record.msa_url}" target="_blank">MSA Agreement</a></li>` : ''}
        ${record.do_url ? `<li><a href="${record.do_url}" target="_blank">Debit Order Agreement</a></li>` : ''}
      </ul>

      <form method="POST" action="/admin/approve">
        <input type="hidden" name="id" value="${record.id}">
        <button class="btn">Approve & Push to Splynx</button>
      </form>
    </div>
  </body>
  </html>`;
}
// ==================== ONBOARDING FLOW (REPLACED) ====================

async function onboardHTML(linkId, env) {
  const [id, token] = (linkId || "").split("_");
  if (!id || !token) return new Response("Invalid link", { status: 400 });

  // Try customer then lead
  const prof = await fetchSplynxProfile(env, id);
  const firstName = prof.first_name || "";
  const lastName  = prof.last_name  || "";
  const idNumber  = prof.passport   || ""; // Splynx "passport"
  const street    = (prof.street_1 || prof.street || "") || "";
  const city      = prof.city || "";
  const zip       = prof.zip_code || prof.zip || "";
  const phone     = prof.phone_mobile || prof.phone || "";
  const email     = prof.email || "";

  const TERMS_MSA_URL = env.TERMS_SERVICE_URL || "https://onboarding-uploads.vinethosting.org/vinet-master-terms.txt";
  const TERMS_DEBIT_URL = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const R2_PUBLIC = "https://onboarding-uploads.vinethosting.org";

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Vinet Onboarding</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; background:#f4f4f4; margin:0; }
      header { background:#fff; padding:16px; text-align:center; box-shadow:0 1px 4px #0001; }
      header img { max-width: 200px; height:auto; }
      .wrap { max-width:760px; margin:20px auto; padding:0 12px; }
      .step { background:#fff; margin:16px 0; padding:16px; border-radius:12px; box-shadow:0 1px 6px #0002; }
      h2 { color:#e2001a; margin:0 0 10px; }
      label { font-weight:600; display:block; margin-top:10px; }
      input, select { width:100%; padding:10px; border:1px solid #dcdcdc; border-radius:8px; margin-top:6px; }
      .btn { background:#e2001a; color:#fff; border:0; border-radius:8px; padding:10px 18px; cursor:pointer; }
      .btn.outline { background:#fff; color:#e2001a; border:2px solid #e2001a; }
      .row { display:flex; gap:12px; flex-wrap:wrap; }
      .row > div { flex:1; min-width:240px; }
      .note { color:#666; font-size:0.92em; }
      .tick { transform:scale(1.6); margin-right:10px; }
      .ref { background:#fff7d6; border:1px dashed #e0b400; padding:10px; border-radius:8px; font-weight:700; }
      .center { text-align:center; }
      canvas#sig { width:100%; height:180px; border:1px dashed #bbb; border-radius:10px; background:#fff; touch-action:none; }
      .links a { display:block; margin:8px 0; }
    </style>
  </head>
  <body>
    <header><img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet logo"></header>
    <div class="wrap">
      <!-- Step 0: Welcome -->
      <div class="step" id="s0">
        <h2>Welcome to Vinet</h2>
        <p>We’ll guide you through a few quick steps to confirm your details and sign your agreements.</p>
        <button class="btn" id="startBtn">Start</button>
      </div>

      <!-- Step 1: Payment method -->
      <div class="step" id="s1" style="display:none">
        <h2>Payment Method</h2>
        <label>Choose one</label>
        <select id="pay">
          <option value="">— Select —</option>
          <option value="EFT">EFT</option>
          <option value="DEBIT">Debit order</option>
        </select>

        <div id="eftBox" style="display:none; margin-top:12px;">
          <div class="ref">Please use the correct reference when making EFT payments: REF <span>${id}</span></div>
          <div class="center" style="margin-top:10px;">
            <button class="btn" type="button" onclick="window.open('/info/eft?id=${id}','_blank')">Print banking details</button>
          </div>
        </div>

        <div id="doBox" style="display:none; margin-top:12px;">
          <div class="row">
            <div><label>Bank Account Holder Name</label><input id="do_name"></div>
            <div><label>Bank Account Holder ID no</label><input id="do_id"></div>
          </div>
          <div class="row">
            <div><label>Bank</label><input id="do_bank"></div>
            <div><label>Bank Account No</label><input id="do_acc"></div>
          </div>
          <div class="row">
            <div>
              <label>Bank Account Type</label>
              <select id="do_type">
                <option value="cheque">Cheque</option>
                <option value="savings">Savings</option>
                <option value="transmission">Transmission</option>
              </select>
            </div>
            <div>
              <label>Debit Order Date</label>
              <select id="do_day">
                <option value="1">1st</option><option value="7">7th</option><option value="15">15th</option>
                <option value="25">25th</option><option value="29">29th</option><option value="30">30th</option>
              </select>
            </div>
          </div>
          <div style="margin-top:10px;">
            <label><input id="do_agree" type="checkbox" class="tick"> I accept the Debit Order terms</label>
          </div>
          <div style="margin-top:8px;">
            <iframe src="${TERMS_DEBIT_URL}" style="width:100%;height:220px;border:1px solid #eee;border-radius:8px;"></iframe>
          </div>
        </div>

        <div class="row" style="margin-top:14px;">
          <div><button class="btn outline" id="s1Back">Back</button></div>
          <div class="center"><button class="btn" id="s1Next">Continue</button></div>
        </div>
      </div>

      <!-- Step 2: Personal info -->
      <div class="step" id="s2" style="display:none">
        <h2>Please verify your details and change if you see any errors</h2>
        <div class="row">
          <div><label>First name</label><input id="f_first" value="${escapeHtml(firstName)}"></div>
          <div><label>Last name</label><input id="f_last" value="${escapeHtml(lastName)}"></div>
        </div>
        <div class="row">
          <div><label>ID / Passport</label><input id="f_passport" value="${escapeHtml(idNumber)}"></div>
          <div><label>Mobile</label><input id="f_phone" value="${escapeHtml(phone)}"></div>
        </div>
        <label>Email</label><input id="f_email" value="${escapeHtml(email)}">
        <label>Street</label><input id="f_street" value="${escapeHtml(street)}">
        <div class="row">
          <div><label>City</label><input id="f_city" value="${escapeHtml(city)}"></div>
          <div><label>ZIP</label><input id="f_zip" value="${escapeHtml(zip)}"></div>
        </div>
        <div class="row" style="margin-top:14px;">
          <div><button class="btn outline" id="s2Back">Back</button></div>
          <div class="center"><button class="btn" id="s2Next">Continue</button></div>
        </div>
      </div>

      <!-- Step 3: Upload docs -->
      <div class="step" id="s3" style="display:none">
        <h2>Please upload your supporting documents</h2>
        <p class="note">ID or Passport and proof of address (as per RICA regulations)</p>
        <div><label>Document 1</label><input id="up1" type="file" accept="image/*,application/pdf"></div>
        <div><label>Document 2 (optional)</label><input id="up2" type="file" accept="image/*,application/pdf"></div>
        <div class="row" style="margin-top:14px;">
          <div><button class="btn outline" id="s3Back">Back</button></div>
          <div class="center"><button class="btn" id="s3Next">Continue</button></div>
        </div>
      </div>

      <!-- Step 4: Vinet Service Agreement -->
      <div class="step" id="s4" style="display:none">
        <h2>Vinet Service Agreement</h2>
        <div style="margin-bottom:8px;">
          <iframe src="${TERMS_MSA_URL}" style="width:100%;height:260px;border:1px solid #eee;border-radius:8px;"></iframe>
        </div>
        <label><input id="msa_ok" type="checkbox" class="tick"> I confirm the accuracy of the information contained in this Agreement and warrant that I am duly authorised to enter into an agreement with VINET on behalf of the customer/myself.</label>
        <div style="margin-top:10px;">
          <label>Draw your signature</label>
          <canvas id="sig"></canvas>
          <div class="row" style="margin-top:8px;">
            <div><button class="btn outline" id="clearSig">Clear</button></div>
          </div>
        </div>
        <div class="row" style="margin-top:14px;">
          <div><button class="btn outline" id="s4Back">Back</button></div>
          <div class="center"><button class="btn" id="finishBtn">Finish & Sign</button></div>
        </div>
      </div>

      <!-- Step 5: Done -->
      <div class="step" id="s5" style="display:none">
        <h2>All set!</h2>
        <p>Thanks - we've recorded your information. Our team will be in contact shortly. If you have any questions please contact our sales team at 021 007 0200 / sales@vinetco.za</p>
        <div id="dl" class="links"></div>
      </div>
    </div>

    <script>
      const linkid = ${JSON.stringify(linkId)};
      const idOnly = ${JSON.stringify(id)};
      const state = { pay: "", debit: null, info: {}, uploads: [] };

      // nav
      const show = i => { for (let n=0;n<=5;n++) document.getElementById('s'+n).style.display = (n===i?'block':'none'); };
      document.getElementById('startBtn').onclick = () => { show(1); };

      // payment
      const sel = document.getElementById('pay'), eftBox = document.getElementById('eftBox'), doBox = document.getElementById('doBox');
      sel.onchange = () => {
        const v = sel.value;
        eftBox.style.display = v==='EFT' ? 'block' : 'none';
        doBox.style.display  = v==='DEBIT' ? 'block' : 'none';
      };
      document.getElementById('s1Back').onclick = () => show(0);
      document.getElementById('s1Next').onclick = async () => {
        const v = sel.value;
        if (!v) { alert('Select a payment method'); return; }
        state.pay = v;
        if (v === 'DEBIT') {
          if (!document.getElementById('do_agree').checked) { alert('Please accept the Debit Order terms'); return; }
          state.debit = {
            account_holder: document.getElementById('do_name').value.trim(),
            id_number:      document.getElementById('do_id').value.trim(),
            bank_name:      document.getElementById('do_bank').value.trim(),
            account_number: document.getElementById('do_acc').value.trim(),
            account_type:   document.getElementById('do_type').value,
            debit_day:      document.getElementById('do_day').value
          };
        } else {
          state.debit = null;
        }
        show(2);
      };

      // info
      document.getElementById('s2Back').onclick = () => show(1);
      document.getElementById('s2Next').onclick = () => {
        state.info = {
          first_name: document.getElementById('f_first').value.trim(),
          last_name:  document.getElementById('f_last').value.trim(),
          passport:   document.getElementById('f_passport').value.trim(),
          phone:      document.getElementById('f_phone').value.trim(),
          email:      document.getElementById('f_email').value.trim(),
          street:     document.getElementById('f_street').value.trim(),
          city:       document.getElementById('f_city').value.trim(),
          zip:        document.getElementById('f_zip').value.trim(),
        };
        show(3);
      };

      // uploads
      document.getElementById('s3Back').onclick = () => show(2);
      document.getElementById('s3Next').onclick = async () => {
        const f1 = document.getElementById('up1').files[0];
        const f2 = document.getElementById('up2').files[0];
        state.uploads = [];
        if (f1) state.uploads.push(await doUpload(linkid, f1));
        if (f2) state.uploads.push(await doUpload(linkid, f2));
        show(4);
      };
      async function doUpload(linkid, file){
        const u = '/api/upload?linkid='+encodeURIComponent(linkid)+'&filename='+encodeURIComponent(file.name);
        const buf = await file.arrayBuffer();
        const r = await fetch(u, { method:'POST', body: buf });
        return await r.json().catch(()=>({}));
      }

      // signature pad
      const canvas = document.getElementById('sig');
      const ctx = canvas.getContext('2d');
      let drawing=false, last=null;
      function resize(){ const s=window.devicePixelRatio||1; const r=canvas.getBoundingClientRect(); canvas.width=Math.floor(r.width*s); canvas.height=Math.floor(180*s); ctx.scale(s,s); ctx.lineWidth=2; ctx.lineCap='round'; ctx.strokeStyle='#222'; }
      function pos(e){ const r=canvas.getBoundingClientRect(); const t=e.touches&&e.touches[0]; return {x:(t?t.clientX:e.clientX)-r.left, y:(t?t.clientY:e.clientY)-r.top}; }
      function down(e){ drawing=true; last=pos(e); e.preventDefault(); }
      function move(e){ if(!drawing) return; const p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; e.preventDefault(); }
      function up(){ drawing=false; last=null; }
      window.addEventListener('resize', resize); resize();
      canvas.addEventListener('mousedown',down); window.addEventListener('mouseup',up); canvas.addEventListener('mousemove',move);
      canvas.addEventListener('touchstart',down,{passive:false}); window.addEventListener('touchend',up); canvas.addEventListener('touchmove',move,{passive:false});
      document.getElementById('clearSig').onclick = (e)=>{ e.preventDefault(); ctx.clearRect(0,0,canvas.width,canvas.height); };

      document.getElementById('s4Back').onclick = () => show(3);
      document.getElementById('finishBtn').onclick = async () => {
        if (!document.getElementById('msa_ok').checked) { alert('Please confirm the agreement'); return; }
        const sig = canvas.toDataURL('image/png');
        const body = { linkid, id: idOnly, state, signature: sig };
        const r = await fetch('/api/finalize', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
        const d = await r.json().catch(()=>({}));
        show(5);
        const dl = document.getElementById('dl');
        const links = [];
        if (d.msa_url) links.push('<a target="_blank" href="'+d.msa_url+'">Download Vinet Service Agreement (MSA)</a>');
        if (d.do_url)  links.push('<a target="_blank" href="'+d.do_url+'">Download Debit Order Agreement</a>');
        dl.innerHTML = links.join('');
      };

      // bootstrap
      show(0);
    </script>
  </body>
  </html>`;
  return new Response(html, { headers: { "content-type":"text/html; charset=utf-8" } });
}

function escapeHtml(s=""){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function fetchSplynxProfile(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  for (const ep of [
    `/admin/customers/customer/${id}`,
    `/crm/leads/${id}`
  ]) {
    try { const r = await fetch(base + ep, { headers }); if (r.ok) return await r.json(); } catch {}
  }
  return {};
}
// ==================== SUPPORT ROUTES (APPEND) ====================

// EFT page (clean + bold REF)
async function eftHTML(id) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>EFT Details</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
    .card{max-width:720px;margin:24px auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 1px 6px #0002}
    .logo{display:block;margin:0 auto 8px;max-width:160px}
    h2{color:#e2001a;margin:8px 0 12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .row{display:flex;gap:10px}
    .f{background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
    .ref{background:#fff7d6;border:1px dashed #e0b400;border-radius:10px;padding:10px;font-weight:700}
    .c{text-align:center}
    .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
  </style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO}">
    <h2>Banking details</h2>
    <div class="grid">
      <div class="f"><b>Bank</b><br>First National Bank (FNB/RMB)</div>
      <div class="f"><b>Account name</b><br>Vinet Internet Solutions</div>
      <div class="f"><b>Account number</b><br>62757054996</div>
      <div class="f"><b>Branch code</b><br>250655</div>
    </div>
    <div class="ref" style="margin-top:10px">Please use the correct EFT reference: <b>REF ${id || ""}</b></div>
    <p style="color:#666">All accounts are payable on or before the 1st of every month.</p>
    <div class="c"><button class="btn" onclick="window.print()">Print banking details</button></div>
  </div></body></html>`, { headers: { "content-type":"text/html; charset=utf-8" }});
}

// Debit order page (terms + checkbox)
async function debitOrderHTML(id, env) {
  const LOGO = "https://static.vinet.co.za/logo.jpeg";
  const termsUrl = env.TERMS_DEBIT_URL || "https://onboarding-uploads.vinethosting.org/vinet-debitorder-terms.txt";
  const terms = await (await fetch(termsUrl)).text().catch(()=> "Terms unavailable.");
  return new Response(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Debit Order</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f4f4f4;margin:0}
    .card{max-width:760px;margin:24px auto;background:#fff;padding:18px;border-radius:12px;box-shadow:0 1px 6px #0002}
    .logo{display:block;margin:0 auto 8px;max-width:160px}
    h2{color:#e2001a;margin:8px 0 12px}
    label{font-weight:600;display:block;margin-top:10px}
    input,select{width:100%;padding:10px;border:1px solid #dcdcdc;border-radius:8px;margin-top:6px}
    .tick{transform:scale(1.6);margin-right:10px}
    .btn{background:#e2001a;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
    .row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:240px}
    pre{white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px}
  </style></head><body>
  <div class="card">
    <img class="logo" src="${LOGO}">
    <h2>Debit order details</h2>
    <form method="POST" action="/api/debit/save">
      <input type="hidden" name="splynx_id" value="${id || ""}">
      <div class="row">
        <div><label>Bank Account Holder Name</label><input name="account_holder" required></div>
        <div><label>Bank Account Holder ID no</label><input name="id_number" required></div>
      </div>
      <div class="row">
        <div><label>Bank</label><input name="bank_name" required></div>
        <div><label>Bank Account No</label><input name="account_number" required></div>
      </div>
      <div class="row">
        <div>
          <label>Bank Account Type</label>
          <select name="account_type"><option value="cheque">Cheque</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select>
        </div>
        <div>
          <label>Debit order date</label>
          <select name="debit_day"><option value="1">1st</option><option value="7">7th</option><option value="15">15th</option><option value="25">25th</option><option value="29">29th</option><option value="30">30th</option></select>
        </div>
      </div>
      <div style="margin-top:10px"><label><input class="tick" type="checkbox" name="agree" required> I accept the Debit Order terms</label></div>
      <pre>${escapeHtml(terms)}</pre>
      <div style="margin-top:10px"><button class="btn" type="submit">Submit</button></div>
    </form>
  </div></body></html>`, { headers: { "content-type":"text/html; charset=utf-8" }});
}

// WhatsApp OTP (same shape as before; template send then text fallback)
async function sendOtp(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  const splynxId = (linkid.split("_")[0] || "").trim();

  const msisdn = await findMsisdn(env, splynxId);
  if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

  const code = String(Math.floor(100000 + Math.random()*900000));
  await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });

  try {
    await waSendTemplate(env, msisdn, code);
    return json({ ok:true });
  } catch {
    try {
      await waSendText(env, msisdn, `Your Vinet verification code is: ${code}`);
      return json({ ok:true, note:"sent-as-text" });
    } catch {
      return json({ ok:false, error:"WhatsApp send failed" }, 502);
    }
  }
}

async function verifyOtp(request, env) {
  const { linkid, otp } = await request.json().catch(()=> ({}));
  if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
  const code = await env.ONBOARD_KV.get(`otp/${linkid}`);
  return json({ ok: !!code && code === otp });
}

// Save progress (lightweight KV merge)
async function saveProgress(linkid, request, env) {
  const body = await request.json().catch(()=> ({}));
  const cur = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json") || {};
  const next = { ...cur, ...body, last_time: Date.now() };
  await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
  return json({ ok:true });
}

// Upload to R2 (supporting docs)
async function handleUpload(request, env) {
  const u = new URL(request.url);
  const linkid = u.searchParams.get("linkid") || "";
  const name   = u.searchParams.get("filename") || "file.bin";
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  const buf = await request.arrayBuffer();
  const key = `uploads/${linkid}/${Date.now()}_${name}`;
  await env.R2_UPLOADS.put(key, buf);
  return json({ ok:true, key, url: `https://onboarding-uploads.vinethosting.org/${key}` });
}

// Finalize: generate PDFs immediately and store public URLs
async function finalizeSubmission(request, env) {
  const { linkid, id, state, signature } = await request.json().catch(()=> ({}));
  if (!linkid || !id || !state || !signature) return json({ ok:false, error:"Missing data" }, 400);

  // Save signature PNG to R2 (also used for drawing into PDF)
  const pngB64 = signature.split(",")[1] || "";
  const sigBytes = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
  const sigKey = `agreements/${linkid}/signature.png`;
  await env.R2_UPLOADS.put(sigKey, sigBytes.buffer, { httpMetadata:{ contentType:"image/png" } });

  // Build PDFs
  const msaOut = await buildMsaPdf(env, id, linkid, state, sigBytes);
  const doOut  = state.pay === "DEBIT" ? await buildDoPdf(env, id, linkid, state, sigBytes) : null;

  // Store PDFs (public)
  const msaKey = `agreements/${linkid}/msa.pdf`;
  await env.R2_UPLOADS.put(msaKey, msaOut, { httpMetadata:{ contentType:"application/pdf" } });

  let doKey = null;
  if (doOut) {
    doKey = `agreements/${linkid}/do.pdf`;
    await env.R2_UPLOADS.put(doKey, doOut, { httpMetadata:{ contentType:"application/pdf" } });
  }

  const pub = "https://onboarding-uploads.vinethosting.org";
  const resp = { ok:true, msa_url: `${pub}/${msaKey}` };
  if (doKey) resp.do_url = `${pub}/${doKey}`;
  return json(resp);
}

// Simple delete-pending (optional)
async function deletePending(request, env) {
  const { linkid } = await request.json().catch(()=> ({}));
  if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);
  await env.ONBOARD_KV.delete(`onboard/${linkid}`);
  await env.ONBOARD_KV.delete(`pending/${linkid}`);
  return json({ ok:true });
}

// Serve R2 (fallback if you still use /r2/* somewhere)
async function serveR2(key, env) {
  const obj = await env.R2_UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status:404 });
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  return new Response(obj.body, { headers: { "content-type": ct } });
}

// ==================== PDF BUILDERS ====================

async function buildMsaPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.MSA_TEMPLATE_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_MSA.pdf";
  const res = await fetch(tplUrl);
  const tpl = await res.arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm ? pdf.getForm() : null;

  // Fill known fields if form exists (names from your templates; missing ones are ignored)
  const fields = {
    full_name: `${state.info.first_name || ""} ${state.info.last_name || ""}`.trim(),
    passport: state.info.passport || "",
    customer_id: String(id),
    email: state.info.email || "",
    phone: state.info.phone || "",
    street: state.info.street || "",
    city: state.info.city || "",
    zip: state.info.zip || "",
    date: catNow(),
  };
  if (form) {
    for (const [k,v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Draw signature on page 4 (approx area bottom-right)
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(Math.min(3, pdf.getPageCount()-1)); // 4th page (index 3) or last available
    const { width } = page.getSize();
    const sigW = 180, sigH = 60;
    page.drawImage(png, { x: width - sigW - 80, y: 90, width: sigW, height: sigH });
  } catch {}

  // Append security stamp page
  appendStampPage(pdf, state);

  return await pdf.save();
}

async function buildDoPdf(env, id, linkid, state, sigBytes) {
  const tplUrl = env.DO_TEMPLATE_URL || "https://onboarding-uploads.vinethosting.org/templates/VINET_DO.pdf";
  const res = await fetch(tplUrl);
  const tpl = await res.arrayBuffer();
  const pdf = await PDFDocument.load(tpl);
  const form = pdf.getForm ? pdf.getForm() : null;

  const d = state.debit || {};
  const fields = {
    account_holder: d.account_holder || "",
    id_number: d.id_number || "",
    bank_name: d.bank_name || "",
    account_number: d.account_number || "",
    account_type: d.account_type || "",
    debit_day: String(d.debit_day || ""),
    customer_id: String(id),
    date: catNow(),
  };
  if (form) {
    for (const [k,v] of Object.entries(fields)) {
      try { form.getTextField(k).setText(String(v)); } catch {}
      try { form.getTextField(k.toUpperCase()).setText(String(v)); } catch {}
    }
    try { form.flatten(); } catch {}
  }

  // Signature: “between Debit Order Date and Date field” (approx mid-bottom)
  try {
    const png = await pdf.embedPng(sigBytes);
    const page = pdf.getPage(0);
    const { width } = page.getSize();
    const sigW = 180, sigH = 60;
    page.drawImage(png, { x: width/2 - sigW/2, y: 120, width: sigW, height: sigH });
  } catch {}

  // Append security stamp
  appendStampPage(pdf, state);

  return await pdf.save();
}

function appendStampPage(pdf, state) {
  const page = pdf.addPage([595, 842]); // A4
  const font = pdf.embedStandardFont ? pdf.embedStandardFont(StandardFonts.Helvetica) : null;
  const drawText = (txt, x, y, size=12) => {
    try {
      page.drawText(txt, { x, y, size, font, color: rgb(0,0,0) });
    } catch {}
  };
  let y = 800;
  drawText("Security Verification", 40, y, 18); y -= 24;
  drawText("Date/time (CAT): " + catNow(), 40, y); y -= 18;
  drawText("Device: " + (state.device || "n/a"), 40, y); y -= 18;
  drawText("Browser: " + (state.browser || "n/a"), 40, y); y -= 18;
  drawText("IP: " + (state.ip || "n/a"), 40, y);
}

function catNow() {
  return new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
}

// ==================== WA + Splynx helpers ====================

async function findMsisdn(env, id) {
  const headers = { Authorization: `Basic ${env.SPLYNX_AUTH}` };
  const base = env.SPLYNX_API || "https://splynx.vinet.co.za/api/2.0";
  const ok = s => /^27\d{8,13}$/.test(String(s||"").trim());
  for (const ep of [
    `/admin/customers/customer/${id}`,
    `/admin/customers/${id}/contacts`,
    `/crm/leads/${id}`,
    `/crm/leads/${id}/contacts`
  ]) {
    try {
      const r = await fetch(base + ep, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      const m = pickPhone(data, ok);
      if (m) return m;
    } catch {}
  }
  return null;
}

function pickPhone(obj, ok) {
  if (!obj) return null;
  const tryVals = v => (Array.isArray(v) ? v.map(tryVals).find(Boolean) : (ok(v) ? String(v).trim() : null));
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (ok(val)) return String(val).trim();
      const deep = tryVals(val);
      if (deep) return deep;
    }
  }
  return null;
}

async function waSendTemplate(env, to, code) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to, type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
      language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type:"text", text: code }] },
        // if template has URL button param length <=15, pass last 6
        { type: "button", sub_type:"url", index:"0", parameters:[{ type:"text", text: code.slice(-6) }] }
      ]
    }
  };
  const r = await fetch(endpoint, {
    method:"POST",
    headers: { "content-type":"application/json", Authorization:`Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

async function waSendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body } };
  const r = await fetch(endpoint, {
    method:"POST",
    headers: { "content-type":"application/json", Authorization:`Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}

// ==================== tiny helpers ====================
function json(o, status=200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type":"application/json" }});
}