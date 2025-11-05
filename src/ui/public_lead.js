// /src/ui/public_lead.js
export function publicLeadHTML() {
  return `<!doctype html>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>New Service Enquiry · Vinet</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{
  --brand:#e2001a; --ink:#111; --muted:#6b7280; --line:#e6e7eb;
  --bg:#f7f7fa; --ok:#0a7d2b; --card:#fff;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;
  background:var(--bg);color:var(--ink);margin:0;
}
.wrap{max-width:940px;margin:18px auto 80px;padding:0 14px}
.card{
  background:var(--card);border:1px solid var(--line);border-radius:18px;
  box-shadow:0 8px 28px rgba(0,0,0,.06);padding:18px
}
.header{display:flex;align-items:center;gap:10px;margin:2px 2px 10px}
.logo-box{width:140px;max-width:32vw;aspect-ratio:16/9;display:grid;place-items:center}
.logo-box img{max-width:100%;max-height:100%;object-fit:contain}
h1{margin:.1rem 0 0;font-size:1.65rem;line-height:1.2}
.sub{color:var(--muted);margin:2px 0 6px}

.banner{
  display:flex;gap:10px;align-items:center;
  background:#f6fffb;border:1px solid #b7f0cf;color:#064e3b;
  border-radius:12px;padding:10px;margin:10px 0 14px;font-size:14px
}
.banner .dot{
  width:10px;height:10px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 0 3px #e6f8ef inset
}

label{display:block;margin:12px 0 6px;font-weight:650}
input,select,textarea{
  width:100%;padding:14px;border:1px solid #d7d9de;
  border-radius:12px;background:#fff;font-size:16px;
}
textarea{min-height:90px;resize:vertical}

.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:760px){
  .row{grid-template-columns:1fr}
  .wrap{margin:8px auto 86px}
  h1{font-size:1.45rem}
}

.help{color:var(--muted);font-size:.85rem;margin-top:4px}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  background:var(--brand);color:#fff;border:none;border-radius:14px;
  padding:14px 16px;font-weight:800;cursor:pointer;width:100%;font-size:1rem;
}
.actions{margin-top:16px}

.toast{
  position:fixed;left:16px;right:16px;bottom:16px;background:#fff;
  border:1px solid var(--line);border-radius:12px;padding:16px;
  box-shadow:0 12px 36px rgba(0,0,0,.16);display:none;z-index:20;
}
.ok{color:var(--ok);font-weight:700}

/* sticky submit on small screens */
.sticky{
  position:fixed;left:0;right:0;bottom:0;padding:10px;
  background:linear-gradient(#0000,#0001),var(--bg);z-index:15
}
@media (min-width:761px){ .sticky{display:none} }
.desktop-submit{display:none}
@media (min-width:761px){ .desktop-submit{display:block} }
</style>

<div class="wrap">
  <div class="card">
    <div class="header">
      <div class="logo-box">
        <img src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
      </div>
      <div>
        <h1>New Service Enquiry</h1>
        <div class="sub">Tell us where you need internet</div>
      </div>
    </div>

    <div class="banner" role="status" aria-live="polite">
      <div class="dot" aria-hidden="true"></div>
      <div><strong>Protected & Secure:</strong>
      Submissions are only accepted from sessions that passed our security check.</div>
    </div>

    <form id="f" novalidate>
      <div class="row">
        <div><label>Full name *</label><input name="full_name" autocomplete="name" required/></div>
        <div><label>Phone (WhatsApp) *</label><input name="phone" inputmode="tel" autocomplete="tel" required/></div>
      </div>

      <div class="row">
        <div><label>Email *</label><input name="email" type="email" autocomplete="email" required/></div>
        <div>
          <label>Service interested in *</label>
          <select name="service" required>
            <option value="">Select…</option>
            <option>FTTH (Fibre to the Home)</option>
            <option>Fixed Wireless / Airfibre</option>
            <option>VoIP</option>
            <option>Web Hosting</option>
          </select>
        </div>
      </div>

      <label>Street address (full line) *</label>
      <input name="street" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848" required/>
      <div class="help">We'll split this into Street / City / ZIP for you.</div>

      <div class="row">
        <div><label>City/Town *</label><input name="city" required/></div>
        <div><label>ZIP *</label><input name="zip" inputmode="numeric" required/></div>
      </div>

      <label>Notes</label>
      <textarea name="notes" placeholder="Anything else we should know?"></textarea>

      <input type="hidden" name="source" value="Website"/>
      <input type="hidden" name="partner" value="main"/>
      <input type="hidden" name="location" value="main"/>

      <label style="margin-top:10px;">
        <input type="checkbox" name="consent" required/>
        I consent to Vinet contacting me regarding this enquiry.
      </label>

      <div class="actions desktop-submit">
        <button class="btn" type="submit">Submit</button>
      </div>
    </form>
  </div>
</div>

<div class="sticky">
  <button class="btn" type="button" id="stickySubmit">Submit</button>
</div>

<div id="t" class="toast" role="alert"></div>

<script>
const f = document.getElementById('f');
const t = document.getElementById('t');
const stickyBtn = document.getElementById('stickySubmit');
const toast = (h) => { t.innerHTML = h; t.style.display = 'block'; setTimeout(()=>t.style.display='none', 6000); };

stickyBtn.addEventListener('click', () => f.requestSubmit());

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(f);
  if(!fd.get('consent')){ toast('Please tick consent to proceed.'); return; }

  try{
    const r = await fetch('/submit', { method:'POST', body:fd });
    const d = await r.json().catch(()=>({}));
    if(d && d.ok){
      toast('<div class="ok">Thank you! Your enquiry was received.</div><div>Reference: '+(d.ref||'-')+'</div>');
      f.reset(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }else{
      toast('Error: '+((d && (d.error||d.detail))||'Could not save.'));
    }
  }catch{ toast('Network error. Please try again.'); }
});
</script>`;
}
