export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------- Utilities ----------
    const getIP = () =>
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "";

    const getUA = () => request.headers.get("user-agent") || "";

    async function parseJSON(req) {
      try { return await req.json(); } catch { return {}; }
    }

    function html(content, title = "Vinet Onboarding") {
      const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; background:#fafbfc; color:#232; }
    .card { background:#fff; max-width:560px; margin:2.5em auto; border-radius:1.25em; box-shadow:0 2px 12px #0002; padding:1.75em; }
    .logo { display:block; margin:0 auto 1em; max-width:90px; }
    h1, h2 { color:#e2001a; }
    .btn { background:#e2001a; color:#fff; border:0; border-radius:.7em; padding:.7em 2em; font-size:1em; cursor:pointer; margin:.8em 0 0; }
    .field { margin:1em 0; }
    input, select { width:100%; padding:.7em; font-size:1em; border-radius:.5em; border:1px solid #ddd; }
    .note { font-size:12px; color:#666; }
    .err { color:#c00; }
    .success { color:#090; }
    .progressbar { height:7px; background:#eee; border-radius:5px; margin:1.4em 0 2.2em; overflow:hidden; }
    .progress { height:100%; background:#e2001a; transition:width .4s; }
    .row { display:flex; gap:.75em; }
    .row > * { flex:1; }
    a.btnlink { display:inline-block; background:#eee; color:#222; padding:.5em .8em; border-radius:.6em; text-decoration:none; margin-top:.8em; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo"/>
    ${content}
    <noscript><div class="err">JavaScript is required for this page.</div></noscript>
  </div>
  <script>/* marker so we know inline JS ran */<\/script>
</body>
</html>`;
      return new Response(body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          // allow inline JS so our steps render
          "content-security-policy":
            "default-src 'self'; img-src 'self' https://static.vinet.co.za data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self';",
          // avoid caching onboarding pages
          "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
          "pragma": "no-cache",
          "expires": "0",
        },
      });
    }

    // ---------- Splynx helpers ----------
    async function splynxGET(env, endpointPath) {
      const resp = await fetch(`${env.SPLYNX_API}${endpointPath}`, {
        headers: { Authorization: `Basic ${env.SPLYNX_AUTH}` },
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`Splynx GET ${endpointPath} ${resp.status} ${t}`);
      }
      return resp.json();
    }

    // Try a few endpoints to find a customer/lead phone (expecting "27XXXXXXXXX" format)
    async function fetchCustomerMsisdn(env, id) {
      const endpoints = [
        `/admin/customers/customer/${id}`,
        `/admin/customers/${id}`,
        `/crm/leads/${id}`,
      ];
      for (const ep of endpoints) {
        try {
          const data = await splynxGET(env, ep);
          const msisdn = pickPhone(data);
          if (msisdn) return msisdn;
        } catch (_) {}
      }
      // Also try contacts lists
      const contactLists = [
        `/admin/customers/${id}/contacts`,
        `/crm/leads/${id}/contacts`,
      ];
      for (const ep of contactLists) {
        try {
          const data = await splynxGET(env, ep);
          const msisdn = pickPhone(data);
          if (msisdn) return msisdn;
        } catch (_) {}
      }
      return null;
    }

    function pickPhone(obj) {
      if (!obj) return null;
      const tryField = (v) => {
        if (!v) return null;
        const s = String(v).trim();
        // expects already 27xxxxxxxxx per your setup
        if (/^27\d{8,13}$/.test(s)) return s;
        return null;
      };
      // direct fields commonly used
      const direct = [
        obj.phone_mobile, obj.mobile, obj.phone, obj.whatsapp, obj.msisdn, obj.primary_phone,
      ];
      for (const v of direct) {
        const m = tryField(v);
        if (m) return m;
      }
      // arrays/objects
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const x = pickPhone(item);
          if (x) return x;
        }
      } else if (typeof obj === "object") {
        for (const k of Object.keys(obj)) {
          const x = pickPhone(obj[k]);
          if (x) return x;
        }
      }
      return null;
    }

    // ---------- WhatsApp ----------
    async function sendWhatsApp(env, toMsisdn, bodyText) {
      const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: toMsisdn,
        type: "text",
        text: { body: bodyText },
      };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        console.error("WhatsApp send failed", resp.status, txt);
        throw new Error(`WhatsApp ${resp.status}`);
      }
    }

    function parseLinkId(pathname) {
      const id = pathname.split("/")[2] || "";
      return id; // e.g. "319_ab12cd34"
    }
    function extractSplynxId(linkid) {
      return (linkid || "").split("_")[0];
    }

    // =====================================================================
    // ADMIN UI (no surprises: server-side form + optional JS helper)
    // =====================================================================
    if (path === "/admin2" && method === "GET") {
      return html(`
        <h1>Generate Onboarding Link</h1>

        <form action="/admin2/gen" method="GET" autocomplete="off" class="field">
          <label>Splynx Lead/Customer ID</label>
          <div class="row">
            <input name="id" required autocomplete="off" />
            <button class="btn" type="submit">Generate Link</button>
          </div>
        </form>

        <div class="note">Press Enter to submit. This works without JavaScript.</div>

        <hr style="margin:1.2em 0;border:0;border-top:1px solid #eee"/>

        <div class="note">Or test via GET: <code>/admin2/gen?id=319</code></div>
      `, "Admin - Generate Link");
    }

    if (path === "/admin2/gen" && method === "GET") {
      const splynxId = url.searchParams.get("id");
      if (!splynxId) return new Response("Missing id", { status: 400 });

      // create KV session (basic seed; phone will be fetched on OTP send)
      const token = Math.random().toString(36).slice(2, 10);
      const linkid = `${splynxId}_${token}`;
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({
        id: splynxId,
        created: Date.now(),
        progress: 0,
      }), { expirationTtl: 86400 });
      const full = `${url.origin}/onboard/${linkid}`;
      return new Response(JSON.stringify({ url: full }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
      // (If you prefer an HTML result page, swap to html(...) instead of JSON)
    }

    // =====================================================================
    // ONBOARDING PAGE (client)
    // =====================================================================
    if (path.startsWith("/onboard/") && method === "GET") {
      const linkid = parseLinkId(path);

      // minimal existence check (optional)
      const session = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (!session) {
        return html(`<h2 class="err">Invalid or expired link.</h2>`, "Onboarding");
      }

      return html(`
        <div class="progressbar"><div id="prog" class="progress" style="width:${(session.progress || 0) * 20 + 20}%"></div></div>

        <div id="step"></div>

        <script>
          const linkid = ${JSON.stringify(linkid)};
          let state = ${JSON.stringify(session)};
          let step = state.progress || 0; // 0..5
          const total = 5;

          function setProgress() {
            const pct = Math.min(100, Math.round(((step+1)/ (total+1)) * 100));
            document.getElementById("prog").style.width = pct + "%";
          }

          function save() {
            fetch("/api/progress/" + linkid, { method:"POST", body: JSON.stringify(state) });
          }

          async function sendOtp() {
            const msg = document.getElementById("otpmsg");
            msg.textContent = "Sending code to WhatsApp...";
            try {
              const r = await fetch("/api/otp/send", { method:"POST", body: JSON.stringify({ linkid }) });
              const data = await r.json().catch(()=>({ok:false}));
              if (data.ok) msg.textContent = "Code sent. Check your WhatsApp.";
              else msg.textContent = "Could not send code. Please contact support.";
            } catch {
              msg.textContent = "Network error sending code.";
            }
          }

          function render() {
            setProgress();
            const el = document.getElementById("step");

            // STEP 0: OTP
            if (step === 0) {
              el.innerHTML = \`
                <h2>Verify your number</h2>
                <p class="note">We’re using the WhatsApp number on your account.</p>
                <div id="otpmsg" class="note" style="margin:.4em 0 1em;"></div>
                <form id="otpForm" autocomplete="off" class="field">
                  <div class="row">
                    <input name="otp" maxlength="6" pattern="\\\\d{6}" placeholder="6-digit code" required />
                    <button class="btn" type="submit">Verify</button>
                  </div>
                </form>
                <a class="btnlink" id="resend">Resend code</a>
              \`;
              sendOtp();
              document.getElementById("resend").onclick = (e) => { e.preventDefault(); sendOtp(); };
              document.getElementById("otpForm").onsubmit = async (e) => {
                e.preventDefault();
                const otp = e.target.otp.value.trim();
                const r = await fetch("/api/otp/verify", { method:"POST", body: JSON.stringify({ linkid, otp }) });
                const data = await r.json().catch(()=>({ok:false}));
                const msg = document.getElementById("otpmsg");
                if (data.ok) {
                  step = 1; state.progress = step; save(); render();
                } else {
                  msg.textContent = "Invalid code. Try again.";
                }
              };
              return;
            }

            // STEP 1: Language + Secondary contact (optional)
            if (step === 1) {
              el.innerHTML = \`
                <h2>Contact Preferences</h2>
                <form id="prefs" autocomplete="off">
                  <div class="field">
                    <label>Preferred Language</label>
                    <select name="lang" required>
                      <option value="en" \${state.lang==='en'?'selected':''}>English</option>
                      <option value="af" \${state.lang==='af'?'selected':''}>Afrikaans</option>
                      <option value="both" \${state.lang==='both'?'selected':''}>Both</option>
                    </select>
                  </div>
                  <div class="field">
                    <label>Secondary Contact (optional)</label>
                    <input name="secondary" placeholder="Name and number (optional)" value="\${state.secondary||''}" />
                  </div>
                  <div class="row">
                    <button class="btn" type="submit">Continue</button>
                    <a class="btnlink" id="skip">Skip</a>
                  </div>
                </form>
              \`;
              document.getElementById("skip").onclick = (e)=>{ e.preventDefault(); step=2; state.progress=step; save(); render(); };
              document.getElementById("prefs").onsubmit = (e)=>{
                e.preventDefault();
                state.lang = e.target.lang.value;
                state.secondary = e.target.secondary.value || '';
                step = 2; state.progress = step; save(); render();
              };
              return;
            }

            // STEP 2: Confirm details (placeholder — fetch from Splynx later)
            if (step === 2) {
              el.innerHTML = \`
                <h2>Confirm Your Details</h2>
                <p class="note">We will fetch and display your details here for confirmation.</p>
                <button class="btn" id="next">Looks good</button>
              \`;
              document.getElementById("next").onclick = ()=>{ step=3; state.progress=step; save(); render(); };
              return;
            }

            // STEP 3: Uploads (placeholder UI)
            if (step === 3) {
              el.innerHTML = \`
                <h2>Upload ID/POA</h2>
                <p class="note">Upload interface coming next. You can continue for now.</p>
                <button class="btn" id="next">Continue</button>
              \`;
              document.getElementById("next").onclick = ()=>{ step=4; state.progress=step; save(); render(); };
              return;
            }

            // STEP 4: Agreements (placeholder)
            if (step === 4) {
              el.innerHTML = \`
                <h2>Service Agreement</h2>
                <p class="note">Terms and signature step coming next.</p>
                <button class="btn" id="finish">Finish</button>
              \`;
              document.getElementById("finish").onclick = ()=>{ step=5; state.progress=step; save(); render(); };
              return;
            }

            // DONE
            el.innerHTML = \`
              <h2>All set!</h2>
              <p>Thanks — we’ve recorded your onboarding.</p>
            \`;
          }

          render();
        <\\/script>
      `, "Onboarding");
    }

    // =====================================================================
    // API: OTP send/verify (server)
    // =====================================================================
    if (path === "/api/otp/send" && method === "POST") {
      const { linkid } = await parseJSON(request);
      if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);

      // fetch msisdn from Splynx by ID in link
      const splynxId = extractSplynxId(linkid);
      let msisdn = null;
      try {
        msisdn = await fetchCustomerMsisdn(env, splynxId);
      } catch (e) {
        return json({ ok:false, error:"Splynx lookup failed" }, 502);
      }
      if (!msisdn) return json({ ok:false, error:"No WhatsApp number on file" }, 404);

      // generate/store code (10 minutes)
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
      await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

      try {
        await sendWhatsApp(env, msisdn, `Your Vinet verification code is: ${code}`);
        return json({ ok:true });
      } catch (e) {
        return json({ ok:false, error:"WhatsApp send failed" }, 502);
      }
    }

    if (path === "/api/otp/verify" && method === "POST") {
      const { linkid, otp } = await parseJSON(request);
      if (!linkid || !otp) return json({ ok:false, error:"Missing params" }, 400);
      const expected = await env.ONBOARD_KV.get(`otp/${linkid}`);
      const ok = !!expected && expected === otp;
      if (ok) {
        const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
        if (sess) {
          await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified: true }), { expirationTtl: 86400 });
        }
      }
      return json({ ok });
    }

    // =====================================================================
    // API: Save progress + IP/device (server)
    // =====================================================================
    if (path.startsWith("/api/progress/") && method === "POST") {
      const linkid = path.split("/")[3];
      const body = await parseJSON(request);
      if (!linkid || !body) return json({ ok:false }, 400);

      const ip = getIP();
      const ua = getUA();
      const now = Date.now();

      const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
      const next = { ...existing, ...body, last_ip: ip, last_ua: ua, last_time: now };
      await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });

      return json({ ok:true });
    }

    // =====================================================================
    // 404
    // =====================================================================
    return new Response("Not found", { status: 404 });

    // ---------- helpers ----------
    function json(obj, status = 200) {
      return new Response(JSON.stringify(obj), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }
}
