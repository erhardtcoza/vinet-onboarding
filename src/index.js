export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- ADMIN PAGE ---
    if (path === "/admin2") {
      return page(`
        <h1>Generate Onboarding Link</h1>
        <div class="field">
          <label>Splynx Lead/Customer ID</label>
          <input id="splynx_id" autocomplete="off" />
        </div>
        <button class="btn" id="genLinkBtn" type="button">Generate Link</button>
        <div id="link"></div>
        <script>
          const input = document.getElementById("splynx_id");
          const btn   = document.getElementById("genLinkBtn");
          const out   = document.getElementById("link");

          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              btn.click();
            }
          });

          btn.addEventListener("click", async () => {
            const id = input.value.trim();
            if (!id) { out.innerHTML = '<div class="err">Please enter an ID.</div>'; return; }
            out.innerHTML = '<div style="color:#666">Generating…</div>';
            try {
              const resp = await fetch("/admin2/gen?id=" + encodeURIComponent(id));
              const data = await resp.json();
              if (data && data.url) {
                out.innerHTML = '<div class="success">Onboarding link: <a href="' + data.url + '" target="_blank">' + data.url + '</a></div>';
              } else {
                out.innerHTML = '<div class="err">Unexpected response.</div>';
              }
            } catch {
              out.innerHTML = '<div class="err">Fetch failed.</div>';
            }
          });
        <\/script>
      `, "Vinet Onboarding Admin");
    }

    // --- GENERATE LINK ENDPOINT ---
    if (path === "/admin2/gen") {
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing ID", { status: 400 });

      // Fetch client phone from Splynx
      const splynxResp = await fetch(`${env.SPLYNX_URL}/api/2.0/admin/customers/customer/${id}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` }
      });
      if (!splynxResp.ok) return new Response("Failed to fetch from Splynx", { status: 500 });
      const splynxData = await splynxResp.json();
      const phone = splynxData.phone || "";

      const token = Math.random().toString(36).substring(2, 10);
      await env.SESSION_KV.put(`session_${id}_${token}`, JSON.stringify({ id, phone }), { expirationTtl: 86400 });
      const onboardPath = `/onboard/${id}_${token}`;
      return new Response(JSON.stringify({ url: `${url.origin}${onboardPath}` }), {
        headers: { "content-type": "application/json" }
      });
    }

    // --- ONBOARDING PAGE ---
    if (path.startsWith("/onboard/")) {
      return page(`
        <div id="progressWrap" class="progressbar"><div class="progress" id="progress" style="width:10%"></div></div>

        <div id="step1">
          <h1>Verify OTP</h1>
          <p>We’ve sent an OTP to your WhatsApp number.</p>
          <input id="otp" placeholder="Enter OTP" />
          <button class="btn" onclick="verifyOTP()">Verify</button>
        </div>

        <div id="step2" style="display:none">
          <h1>Personal Details</h1>
          <input id="fullname" placeholder="Full Name" />
          <input id="secondary" placeholder="Secondary Contact (optional)" />
          <label>Preferred Language</label>
          <select id="language">
            <option>English</option>
            <option>Afrikaans</option>
            <option>Both</option>
          </select>
          <button class="btn" onclick="nextStep()">Next</button>
        </div>

        <div id="step3" style="display:none">
          <h1>Documents</h1>
          <p>Upload your ID Document:</p>
          <input type="file" id="idDoc" />
          <button class="btn" onclick="finish()">Finish</button>
        </div>

        <script>
          const steps = ["step1","step2","step3"];
          let currentStep = 0;
          function showStep(i) {
            steps.forEach((s, idx) => document.getElementById(s).style.display = idx === i ? "block" : "none");
            document.getElementById("progress").style.width = ((i+1)/steps.length*100) + "%";
            currentStep = i;
          }
          function nextStep() { showStep(currentStep+1); }
          function verifyOTP() { // TODO: OTP verification API
            nextStep();
          }
          function finish() { alert("Onboarding complete!"); }
          showStep(0);

          // Capture IP/device
          fetch("https://ipapi.co/json").then(r=>r.json()).then(data=>{
            console.log("IP info", data);
          });
        <\/script>
      `, "Vinet Onboarding");
    }

    return new Response("Not found", { status: 404 });
  }
};

function page(content, title) {
  const body = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui,sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:520px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .field { margin:1em 0; }
    input, select { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .5s; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${content}
  </div>
</body>
</html>`;
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; img-src https://static.vinet.co.za data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src *;"
    }
  });
}
