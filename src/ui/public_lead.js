// /src/ui/public_lead.js
// Renders the secure public lead form (mobile-first)

export function renderPublicLeadHTML({ secured = false, sessionId = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet · New Service Enquiry</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{
  --brand:#ED1C24; --ink:#0b1320; --muted:#6b7280; --bg:#f7f7fa; --line:#e6e7ea;
  --ok:#0a7d2b; --danger:#7a2a2a; --chip:#eef2f7;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
.wrap{max-width:720px;margin:22px auto; padding:0 14px}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 10px 28px #00000012;padding:18px 16px 22px}
.logo{display:block;margin:4px auto 6px; width:min(46vw,160px); height:auto; object-fit:contain}
h1{margin:6px 0 0; text-align:center; font-size:clamp(22px,5vw,30px)}
.sub{color:var(--muted); text-align:center; margin:2px 0 18px}
label{display:block; font-weight:650; margin:10px 0 6px}
input,select{width:100%; padding:12px 12px; border:1px solid #cfd2d7; border-radius:12px; font-size:16px; background:#fff}
.row{display:grid; grid-template-columns:1fr 1fr; gap:12px}
@media (max-width:560px){ .row{grid-template-columns:1fr} }
.actions{margin-top:18px; display:grid; gap:10px}
button{border:0; border-radius:12px; padding:13px 14px; font-weight:800; cursor:pointer}
button.primary{background:var(--brand); color:#fff}
button.alt{background:#111; color:#fff}

.consent{display:flex; align-items:flex-start; gap:10px; margin:16px 2px 6px}
.consent input{width:20px; height:20px; margin-top:2px}
.consent .box{background:#fff; border:1px solid #d9dbe1; border-radius:10px; padding:8px 10px; font-size:13px; line-height:1.25}

.toast{position:fixed; left:16px; right:16px; bottom:16px; background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; box-shadow:0 12px 32px #0000001f; display:none}
.toast.ok{border-color:#b7f0cf}
.small{color:var(--muted); font-size:13px; text-align:center}

.ribbon{position:fixed; inset:auto 0 0 0; height:46px; display:flex; align-items:center; justify-content:center; font-weight:900; color:#fff; background:
  repeating-linear-gradient(135deg, #ff9595 0 14px, #fff 14px 22px) ;}
.ribbon.ok{background:#167a3a}
.ribbon .id{font-weight:700; opacity:.9}

.helper{height:4px; background:var(--brand); border-radius:999px; width:94%; margin:8px auto 2px}
</style>

<div class="wrap">
  <div class="card">
    <img class="logo" src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
    <div class="helper"></div>
    <h1>New Service Enquiry</h1>
    <p class="sub">Tell us where you need internet</p>

    <form id="f" novalidate>
      <div class="row">
        <div>
          <label>Full name *</label>
          <input name="full_name" autocomplete="name" required/>
        </div>
        <div>
          <label>Phone (WhatsApp) *</label>
          <input name="phone" inputmode="tel" autocomplete="tel" required/>
        </div>
      </div>

      <div class="row">
        <div>
          <label>Email *</label>
          <input name="email" type="email" autocomplete="email" required/>
        </div>
        <div>
          <label>How did you hear about us? *</label>
          <select name="source" required>
            <option value="">Select…</option>
            <option>Website</option><option>Facebook</option><option>Instagram</option>
            <option>Referral</option><option>Walk-in</option><option>Other</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label>City/Town *</label>
          <input name="city" required/>
        </div>
        <div>
          <label>ZIP *</label>
          <input name="zip" inputmode="numeric" required/>
        </div>
      </div>

      <label>Street address (full line) *</label>
      <input name="street" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848" required/>

      <label>Service interested in *</label>
      <select name="service" required>
        <option value="">Select…</option>
        <option>FTTH (Fibre to the Home)</option>
        <option>Fixed Wireless / Airfibre</option>
        <option>VoIP</option>
        <option>Web Hosting</option>
      </select>

      <input type="hidden" name="partner" value="main"/>
      <input type="hidden" name="location" value="main"/>

      <div class="consent">
        <input id="c" type="checkbox" name="consent" required/>
        <div class="box"><label for="c">I consent to Vinet contacting me regarding this enquiry.</label></div>
      </div>

      <div class="actions">
        <button class="primary" type="submit">Submit</button>
        <button class="alt" type="button" id="clearBtn">Clear</button>
      </div>

      <p class="small">Support: 021 007 0200</p>
    </form>
  </div>
</div>

<div id="t" class="toast" role="status" aria-live="polite"></div>
<div class="ribbon ${secured ? "ok" : ""}" id="rb">
  ${secured ? `Secured connection • Session <span class="id">#${sessionId}</span>` : "Securing connection…"}
</div>

<script>
const f = document.getElementById('f');
const t = document.getElementById('t');
const rb = document.getElementById('rb');

function toast(html, ok=false){
  t.classList.toggle('ok', ok);
  t.innerHTML = html;
  t.style.display = 'block';
  setTimeout(()=> t.style.display='none', 6000);
}

document.getElementById('clearBtn').onclick = () => f.reset();

f.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(f);
  if(!fd.get('consent')){ toast('Please tick consent to proceed.'); return; }

  try{
    const r = await fetch('/submit', { method:'POST', body: fd });
    const d = await r.json().catch(()=> ({}));
    if(d && d.ok){
      toast('<strong>Thank you!</strong> Your enquiry was received.<br/>Reference: '+(d.ref||'-'), true);
      f.reset();
    }else{
      toast('Error: ' + (d && (d.error || d.detail) || 'Could not save.'));
    }
  }catch(err){
    toast('Error: ' + (err && err.message || 'Could not save.'));
  }
});
</script>
</html>`;
}
