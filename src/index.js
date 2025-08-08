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
