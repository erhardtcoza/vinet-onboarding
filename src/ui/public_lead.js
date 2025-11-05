// /src/ui/public_lead.js
export function renderPublicLeadHTML({ secured = false } = {}) {
  const safe = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

  return /*html*/ `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>New Service Enquiry · Vinet</title>
  <link rel="icon" href="/favicon.ico"/>
  <style>
    :root{
      --red:#ED1C24; --black:#0B1320; --ink:#111827; --muted:#6b7280;
      --bg:#f7f7f8; --card:#fff; --ok:#147a3d; --error:#a31212;
      --chip:#eef2f7; --radius:18px;
    }
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
    .wrap{max-width:760px;margin:28px auto;padding:0 14px}
    .card{background:var(--card);border-radius:var(--radius);box-shadow:0 10px 36px #0002;padding:20px 20px 28px}
    .brand{display:flex;align-items:center;gap:14px;margin:6px 0 2px}
    .brand img{height:40px;width:auto}
    h1{font:700 28px/1.1 system-ui;margin:8px 0 6px}
    .sub{color:var(--muted);margin:0 0 10px}
    label{display:block;font:700 16px/1.2 system-ui;margin:14px 4px 8px}
    input,select,textarea{
      width:100%;border:2px solid #e5e7eb;border-radius:14px;padding:14px 15px;
      font:600 16px/1.1 system-ui;background:#fff;outline:none;
    }
    input:focus,select:focus,textarea:focus{border-color:#c7d2fe;box-shadow:0 0 0 3px #e0e7ff}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    @media (max-width:640px){ .row{grid-template-columns:1fr} }
    .btn{
      display:block;width:100%;padding:14px 18px;border-radius:16px;border:0;color:#fff;
      font:800 18px/1 system-ui;cursor:pointer;transition:transform .04s ease;
    }
    .btn:active{transform:translateY(1px)}
    .btn-red{background:var(--red)}
    .btn-dark{background:#111}
    .consent{
      display:flex;align-items:flex-start;gap:10px;background:#fafafa;border:1px solid #e8e8ea;border-radius:12px;
      padding:10px 12px;margin:12px 0 8px
    }
    .consent small{font:600 14px/1.25 system-ui;color:#1f2937}
    .ribbon{
      position:sticky;bottom:0;left:0;right:0;background:#10893e;color:#fff;
      font:800 16px/1.1 system-ui;padding:12px 16px;text-align:center;z-index:20;
    }
    .toast{
      position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
      background:#111;color:#fff;border-radius:16px;padding:14px 18px;font:800 16px/1 system-ui;
      box-shadow:0 10px 30px #0005;max-width:86vw;z-index:30;display:none
    }
    .toast.ok{background:#136c2e}.toast.err{background:#a31212}
    .hint{color:#9ca3af;font-weight:600}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="brand">
        <img src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
      </div>
      <h1>New Service Enquiry</h1>
      <p class="sub">Tell us where you need internet</p>

      <form id="leadForm" novalidate>
        <label for="name">Full name *</label>
        <input id="name" name="name" autocomplete="name" required placeholder="Your full name"/>

        <label for="phone">Phone (WhatsApp) *</label>
        <input id="phone" name="phone" inputmode="tel" autocomplete="tel" required placeholder="+27 71 234 5678"/>

        <label for="email">Email *</label>
        <input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"/>

        <label for="source">How did you hear about us? *</label>
        <select id="source" name="source" required>
          <option value="">Select…</option>
          <option>Facebook</option>
          <option>Instagram</option>
          <option>Google Search</option>
          <option>Friend / Family</option>
          <option>Billboard / Flyer</option>
          <option>At an event</option>
          <option>Other</option>
        </select>

        <div class="row">
          <div>
            <label for="city">City/Town *</label>
            <input id="city" name="city" required placeholder="e.g. Villiersdorp"/>
          </div>
          <div>
            <label for="zip">ZIP *</label>
            <input id="zip" name="zip" inputmode="numeric" pattern="[0-9]*" required placeholder="e.g. 6848"/>
          </div>
        </div>

        <label for="street">Street address (full line) *</label>
        <input id="street" name="street" required placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848"/>

        <label for="service">Service interested in *</label>
        <select id="service" name="service" required>
          <option value="">Select…</option>
          <option>Fibre Internet</option>
          <option>Fixed Wireless (Airfibre/Standard)</option>
          <option>VoIP</option>
          <option>Web Hosting</option>
        </select>

        <div class="consent">
          <input id="consent" name="consent" type="checkbox" required aria-describedby="consentText"/>
          <small id="consentText">I consent to Vinet contacting me regarding this enquiry.</small>
        </div>

        <div class="row" style="margin-top:10px">
          <button class="btn btn-red" type="submit">Submit</button>
          <button class="btn btn-dark" type="button" id="clearBtn">Clear</button>
        </div>
      </form>
    </div>
  </div>

  <div id="ribbon" class="ribbon"></div>
  <div id="toast" class="toast"></div>

<script>
(() => {
  const secured = ${secured ? "true" : "false"};
  // session id for ribbon + server log correlation
  const SID_KEY = "vinet_public_session";
  let sid = sessionStorage.getItem(SID_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem(SID_KEY, sid);
  }
  const ribbon = document.getElementById("ribbon");
  ribbon.textContent = secured
    ? "Secured connection • Session#" + sid
    : "Unsecured preview (session disabled)";

  const $ = (id) => document.getElementById(id);
  const fields = ["name","phone","email","source","city","zip","street","service"];
  // --- simple autofill from localStorage
  fields.forEach(k => {
    const v = localStorage.getItem("lead_"+k);
    if (v) $(k).value = v;
  });

  // helpers
  const toast = (msg, ok=false) => {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast " + (ok ? "ok":"err");
    el.style.display = "block";
    setTimeout(()=>{ el.style.display="none"; }, 3500);
  };

  $("clearBtn").addEventListener("click", () => {
    $("leadForm").reset();
    fields.forEach(k => localStorage.removeItem("lead_"+k));
    toast("Cleared.", true);
  });

  // persist on change
  fields.forEach(k => $(k).addEventListener("input", e => {
    localStorage.setItem("lead_"+k, e.target.value);
  }));

  $("leadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {};
    for (const k of fields) {
      const v = $(k).value.trim();
      if (!v) { toast("Please complete: " + k, false); return; }
      data[k] = v;
    }
    if (!$("consent").checked) { toast("Please accept consent.", false); return; }

    // post to worker
    try {
      const res = await fetch("/lead/submit", {
        method: "POST",
        headers: {"content-type":"application/json"},
        body: JSON.stringify({ ...data, consent: true, session_id: sid })
      });
      if (!res.ok) {
        const t = await res.text().catch(()=> "Error");
        toast("Error: " + t, false);
        return;
      }
      const out = await res.json().catch(()=>({ ok:false }));
      if (out.ok) {
        toast("Saved! Lead ID: " + (out.id ?? "—"), true);
        // keep name/phone/email for convenience; clear the rest
        ["source","city","zip","street","service"].forEach(k => localStorage.removeItem("lead_"+k));
        $("leadForm").reset();
      } else {
        toast("Error: Could not save.", false);
      }
    } catch (err) {
      toast("Network error", false);
    }
  });
})();
</script>
</body>
</html>`;
}
