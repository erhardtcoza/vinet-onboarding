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
    .wrap{max-width:720px;margin:2rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
    h1{margin:.25rem 0 1rem}
    form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.25rem}
    input,select{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #e5e7eb;border-radius:10px}
    .row{grid-column:span 1}
    .row-2{grid-column:span 2}
    .actions{display:flex;gap:.75rem;align-items:center;margin-top:.5rem}
    button{background:var(--red);color:#fff;border:0;border-radius:10px;padding:.65rem 1rem;font-weight:600;cursor:pointer}
    .note{margin-top:.75rem;color:var(--muted);font-size:.85rem}
    .banner{font-size:.8rem;color:#066e2b;background:#eaf7ee;border:1px solid #b7e2c4;padding:.45rem .6rem;border-radius:8px;margin:0 0 .75rem 0}
    .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111;color:#fff;padding:.6rem .9rem;border-radius:10px;opacity:.97}
  </style>
</head>
<body>
  <main class="wrap">
    ${secured ? `<div class="banner">Secured connection • Session#${sessionId}</div>` : ``}
    <h1>Public Lead</h1>
    <form id="leadForm" autocomplete="off">
      <div class="row-2">
        <label>Full name</label>
        <input name="full_name" required />
      </div>
      <div class="row"><label>Phone</label><input name="phone" required /></div>
      <div class="row"><label>Email</label><input name="email" type="email" required /></div>
      <div class="row"><label>City/Town</label><input name="city" required /></div>
      <div class="row"><label>ZIP</label><input name="zip" required /></div>
      <div class="row-2"><label>Street Address</label><input name="street" required /></div>
      <div class="row"><label>Service</label>
        <select name="service">
          <option value="unknown">Select…</option>
          <option value="fibre">Fibre</option>
          <option value="wireless">Wireless</option>
          <option value="voip">VoIP</option>
          <option value="hosting">Web Hosting</option>
        </select>
      </div>
      <div class="row"><label>Source</label><input name="source" placeholder="website" /></div>
      <div class="row-2 actions">
        <button type="submit">Submit</button>
        <span class="note">We’ll save your details securely.</span>
      </div>
    </form>
  </main>

  <script>
    // kill bfcache form stickiness on back/refresh
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        const f = document.getElementById("leadForm");
        if (f) f.reset();
      }
    });

    const form = document.getElementById("leadForm");
    function toast(msg) {
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2500);
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      // send JSON to avoid formData/ct issues
      const res = await fetch("/lead/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({ ok:false, error:"Invalid response" }));
      if (out.ok) {
        toast("Saved. Lead ID: " + (out.ref ?? "N/A"));
        // hard reset so fields don't stick
        form.reset();
        // also disable autofill history across refresh/back-forward cache
        if ('requestSubmit' in form) {
          // No-op, here to ensure layout reflow after reset
          void form.offsetHeight;
        }
      } else {
        toast("Error: " + (out.error || "Could not save"));
      }
    });
  </script>
</body>
</html>`;
}
