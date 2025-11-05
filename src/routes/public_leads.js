// /src/ui/public_lead.js
// Mobile-friendly public lead form with a bottom "security" tape.
// Pass { secured: true } to show a green "Secured connection" banner.

export function renderPublicLeadHTML({ secured = false } = {}) {
  const tapeText = secured ? "Secured connection" : "Securing connection…";
  const tapeColor = secured ? "#137a2d" : "#ED1C24";

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>Vinet · New Service Enquiry</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
  :root{
    --red:#ED1C24; --ink:#0b1320; --muted:#6b7280; --bg:#f7f7f8; --card:#fff;
    --line:#E5E7EB; --ok:#137a2d;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:820px;margin:20px auto;padding:16px}
  .card{background:var(--card);border-radius:20px;box-shadow:0 10px 36px #0002;padding:16px}
  .head{display:flex;align-items:center;gap:12px;margin:6px 4px 14px}
  .logo{width:min(220px,60vw);height:auto;display:block}
  h1{font-size:1.75rem;margin:.25rem 0 0}
  p.sub{margin:.25rem 0 0;color:var(--muted)}
  form{margin-top:10px}
  label{display:block;font-weight:600;margin:10px 0 6px}
  input,select,button{font:inherit}
  input,select{
    width:100%;padding:12px 14px;border:1px solid var(--line);
    border-radius:12px;background:#fff;outline:none
  }
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media (max-width:640px){ .row{grid-template-columns:1fr} }
  .actions{display:flex;gap:12px;margin-top:16px}
  .btn{flex:1;display:inline-block;text-align:center;padding:12px 14px;border-radius:12px;
       border:0;color:#fff;background:var(--red);font-weight:800;cursor:pointer}
  .btn.secondary{background:#111}
  .fine{color:var(--muted);font-size:.9rem;margin:10px 4px 0}
  .toast{position:fixed;left:16px;right:16px;bottom:86px;background:#fff;border:1px solid var(--line);
         border-radius:12px;padding:14px;box-shadow:0 10px 28px #0002;display:none}
  .ok{color:var(--ok);font-weight:700}
  /* bottom tape */
  .tape{position:fixed;left:0;right:0;bottom:0;padding:14px 18px;color:#fff;
        font-weight:900;text-align:center;letter-spacing:.2px;background:${tapeColor}}
</style>
</head><body>
  <main class="wrap">
    <section class="card">
      <div class="head">
        <img class="logo" src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
      </div>
      <h1>New Service Enquiry</h1>
      <p class="sub">Tell us where you need internet. We’ll split the address into City and ZIP for you.</p>

      <form id="f" novalidate>
        <div class="row">
          <div>
            <label for="full_name">Full name *</label>
            <input id="full_name" name="full_name" autocomplete="name" required />
          </div>
          <div>
            <label for="phone">Phone (WhatsApp) *</label>
            <input id="phone" name="phone" inputmode="tel" autocomplete="tel" required />
          </div>
        </div>

        <div class="row">
          <div>
            <label for="email">Email *</label>
            <input id="email" type="email" name="email" autocomplete="email" required />
          </div>
          <div>
            <label for="source">How did you hear about us? *</label>
            <select id="source" name="source" required>
              <option value="">Select…</option>
              <option>Website</option><option>Facebook</option>
              <option>Walk-in</option><option>Referral</option><option>Other</option>
            </select>
          </div>
        </div>

        <label for="street">Street address (full line) *</label>
        <input id="street" name="street" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848" required />

        <div class="row">
          <div>
            <label for="city">City/Town *</label>
            <input id="city" name="city" required />
          </div>
          <div>
            <label for="zip">ZIP *</label>
            <input id="zip" name="zip" inputmode="numeric" required />
          </div>
        </div>

        <label for="service">Service interested in *</label>
        <select id="service" name="service" required>
          <option value="">Select…</option>
          <option>FTTH (Fibre to the Home)</option>
          <option>Fixed Wireless / Airfibre</option>
          <option>VoIP</option>
          <option>Web Hosting</option>
        </select>

        <input type="hidden" name="partner" value="main"/>
        <input type="hidden" name="location" value="main"/>

        <label style="display:flex;gap:.6rem;align-items:center;margin-top:12px">
          <input type="checkbox" id="consent" name="consent" required />
          <span>I consent to Vinet contacting me regarding this enquiry.</span>
        </label>

        <div class="actions">
          <button type="submit" class="btn">Submit</button>
          <a class="btn secondary" href="/landing" role="button">Back</a>
        </div>

        <p class="fine">Support: 021&nbsp;007&nbsp;0200</p>
      </form>
    </section>
  </main>

  <div id="t" class="toast"></div>
  <div class="tape" id="tape">${tapeText}</div>

<script>
  const f = document.getElementById('f');
  const t = document.getElementById('t');
  const tape = document.getElementById('tape');

  // if the cookie is set after arriving here, flip the tape to green
  try{
    if (document.cookie.split('; ').some(c=>c.startsWith('ts_ok=1'))) {
      tape.textContent = 'Secured connection';
      tape.style.background = '#137a2d';
    }
  }catch{}

  const toast = (h) => { t.innerHTML = h; t.style.display = 'block'; setTimeout(()=>t.style.display='none', 6000); }

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    if (!fd.get('consent')) { toast('Please tick consent to proceed.'); return; }
    const r = await fetch('/submit', { method:'POST', body: fd });
    const d = await r.json().catch(()=>({}));
    if (d && d.ok) {
      toast('<div class="ok">Thank you! Your enquiry was received.</div><div>Reference: ' + (d.ref || '-') + '</div>');
      f.reset();
    } else {
      toast('Error: ' + ((d && (d.error||d.detail)) || 'Could not save.'));
    }
  });
</script>
</body></html>`;
}
