// /src/ui/public_lead.js
export function renderPublicLeadHTML({ secured = false, sessionId = "" } = {}) {
  return /*html*/ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>New Lead</title>
  <meta http-equiv="cache-control" content="no-store, no-cache, must-revalidate, max-age=0"/>
  <meta http-equiv="pragma" content="no-cache"/>
  <style>
    :root { --red:#ED1C24; --ink:#0b1320; --muted:#6b7280; --bg:#f7f7f8; --card:#fff; }
    body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}
    .wrap{max-width:780px;margin:2rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
    h1{margin:.25rem 0 1rem}
    form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.25rem}
    input,select,textarea{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #e5e7eb;border-radius:10px}
    textarea{min-height:96px;resize:vertical}
    .row{grid-column:span 1}
    .row-2{grid-column:span 2}
    .actions{display:flex;gap:.75rem;align-items:center;margin-top:.5rem}
    button{background:var(--red);color:#fff;border:0;border-radius:10px;padding:.65rem 1rem;font-weight:600;cursor:pointer}
    .note{margin-top:.75rem;color:var(--muted);font-size:.85rem}
    .banner{font-size:.8rem;color:#066e2b;background:#eaf7ee;border:1px solid #b7e2c4;padding:.45rem .6rem;border-radius:8px;margin:0 0 .75rem 0}
    .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111;color:#fff;padding:.6rem .9rem;border-radius:10px;opacity:.97}
    .muted{color:var(--muted);font-size:.85rem}
  </style>
</head>
<body>
  <main class="wrap">
    ${secured ? `<div class="banner">Secured connection • Session#${sessionId}</div>` : ``}
    <h1>Public Lead</h1>

    <form id="leadForm" autocomplete="off">
      <!-- visible fields -->
      <div class="row-2">
        <label>Full name</label>
        <input name="full_name" required />
      </div>

      <div class="row">
        <label>Phone number <span class="muted">(auto-normalised to ZA format)</span></label>
        <input name="phone" inputmode="tel" required />
      </div>

      <div class="row">
        <label>Email</label>
        <input name="email" type="email" required />
      </div>

      <div class="row">
        <label>City/Town</label>
        <input name="city" required />
      </div>

      <div class="row">
        <label>ZIP</label>
        <input name="zip" required />
      </div>

      <div class="row-2">
        <label>Street Address</label>
        <input name="street" required />
      </div>

      <div class="row">
        <label>Service</label>
        <select name="service" id="serviceSelect">
          <!-- populated dynamically; falls back below -->
          <option value="unknown">Loading services…</option>
        </select>
      </div>

      <div class="row">
        <label>Source</label>
        <input name="source" placeholder="website" />
      </div>

      <div class="row-2">
        <label>Message / Notes</label>
        <textarea name="message" placeholder="Anything we should know?"></textarea>
      </div>

      <!-- hidden defaults for Splynx mapping -->
      <input type="hidden" name="partner" value="Main"/>
      <input type="hidden" name="location" value="Main"/>
      <input type="hidden" name="score" value="1"/>
      <input type="hidden" name="billing_type" value="recurring"/>
      <input type="hidden" name="billing_email" id="billingEmailMirror" value=""/>

      <div class="row-2 actions">
        <button type="submit">Submit</button>
        <span class="note">We’ll save your details securely.</span>
      </div>
    </form>

    <p class="muted" style="margin-top:1rem">Service names/prices shown here may be display overrides managed in the admin dashboard. They won’t change what’s stored in Splynx.</p>
  </main>

  <script>
    // --- helpers ---
    function toast(msg) {
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }

    // Normalize SA phone numbers to international without plus, e.g.
    // "021 007 0200" -> "27210070200", "+27721234567" -> "27721234567"
    function normalizeZA(msisdn) {
      if (!msisdn) return "";
      let d = String(msisdn).replace(/\\D+/g, ""); // digits only
      if (d.startsWith("27")) return d;
      if (d.startsWith("0")) return "27" + d.slice(1);
      // If user typed +27... the + is removed above, so already covered,
      // Fallback: if it's 9 or 10 digits and not starting with 27, assume ZA local
      if (d.length === 9) return "27" + d;      // e.g. 218765432 -> 27218765432
      if (d.length === 10 && !d.startsWith("27")) {
        if (d.startsWith("0")) return "27" + d.slice(1);
        return "27" + d;
      }
      return d;
    }

    // Kill bfcache stickiness on back/refresh
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        const f = document.getElementById("leadForm");
        if (f) f.reset();
      }
    });

    const form = document.getElementById("leadForm");
    const serviceSelect = document.getElementById("serviceSelect");
    const emailInput = form.querySelector('input[name="email"]');
    const billingMirror = document.getElementById("billingEmailMirror");

    // keep billing_email mirrored to email
    emailInput.addEventListener("input", () => {
      billingMirror.value = emailInput.value.trim();
    });

    // Populate services from admin mapping endpoint (if available)
    async function loadServices() {
      try {
        const r = await fetch("/api/services/display", { headers: { "accept":"application/json" } });
        if (!r.ok) throw new Error("no services");
        const list = await r.json();
        if (!Array.isArray(list) || list.length === 0) throw new Error("empty");
        serviceSelect.innerHTML = "";
        // list items can be: { id, name, display_name, price, show_price, override_label }
        for (const s of list) {
          const value = s?.name || s?.id || "unknown";
          const labelBase = s?.override_label || s?.display_name || s?.name || "Service";
          const showPrice = !!s?.show_price;
          const price = s?.price != null ? String(s.price) : null;
          const label = showPrice && price ? (labelBase + " – R" + price) : labelBase;
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          serviceSelect.appendChild(opt);
        }
        // add a generic "Other" at bottom
        const other = document.createElement("option");
        other.value = "other";
        other.textContent = "Other / Not sure";
        serviceSelect.appendChild(other);
      } catch {
        // fallback list
        serviceSelect.innerHTML = \`
          <option value="fibre">Fibre</option>
          <option value="wireless">Wireless</option>
          <option value="voip">VoIP</option>
          <option value="hosting">Web Hosting</option>
          <option value="other">Other / Not sure</option>
        \`;
      }
    }
    loadServices();

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      // apply transformations/defaults
      data.phone = normalizeZA(data.phone);
      data.billing_email = (data.email || "").trim();
      if (!data.source) data.source = "website";
      if (!data.service) data.service = "unknown";
      // the hidden fields are already on the form; just ensure they're in data
      data.partner = data.partner || "Main";
      data.location = data.location || "Main";
      data.score = data.score || "1";
      data.billing_type = data.billing_type || "recurring";

      const res = await fetch("/lead/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });

      const out = await res.json().catch(() => ({ ok:false, error:"Invalid response" }));
      if (out.ok) {
        toast("Saved. Lead ID: " + (out.ref ?? "N/A"));
        form.reset();
        // ensure mirrors/defaults after reset
        billingMirror.value = "";
      } else {
        toast("Error: " + (out.error || "Could not save"));
      }
    });
  </script>
</body>
</html>`;
}
