// /src/ui/public_lead.js
// Mobile-friendly public lead form (requires ts_ok=1 cookie to submit)

export function renderPublicLeadHTML() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vinet · New Service Enquiry</title>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
:root{
  --brand:#ED1C24; --ink:#0b1320; --muted:#6b7280; --line:#e5e7eb;
  --bg:#f7f7fa; --ok:#0a7d2b; --card:#fff;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;
}
.wrap{max-width:820px;margin:12px auto 90px;padding:0 12px}
.card{
  background:var(--card); border:1px solid var(--line); border-radius:16px;
  box-shadow:0 8px 26px rgba(0,0,0,.06); padding:18px 16px;
}
.header{display:flex;gap:12px;align-items:center;justify-content:center}
.logo{height:min(42px,10vw); aspect-ratio:16/6; object-fit:contain}
h1{margin:8px 0 4px; text-align:center; font-size:clamp(20px,4.8vw,28px)}
.sub{color:var(--muted); text-align:center; margin:.25rem 0 1rem}

.banner{display:flex;gap:10px;align-items:center;background:#f6fffb;border:1px solid #b7f0cf;
  color:#064e3b;border-radius:10px;padding:10px;margin-bottom:12px;font-size:14px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--ok)}

form{display:grid;gap:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:700px){ .row{grid-template-columns:1fr} }

label{display:block;font-weight:600;margin:2px 0 6px}
input,select{
  width:100%; padding:12px 12px; border:1px solid #cfd4dc; border-radius:12px; background:#fff;
  font-size:16px;
}
.actions{margin-top:6px;display:flex;gap:10px;flex-wrap:wrap}
button.btn{
  flex:1 1 220px; background:var(--brand); color:#fff; border:0; border-radius:12px;
  padding:12px 14px; font-weight:800; cursor:pointer; font-size:16px;
}
button.ghost{background:#111}
.small{display:block;text-align:center;color:var(--muted);margin-top:8px}

.toast{
  position:fixed; left:16px; right:16px; bottom:16px; background:#fff;
  border:1px solid var(--line); border-radius:12px; padding:14px;
  box-shadow:0 10px 28px rgba(0,0,0,.12); display:none; z-index:50
}
.toast.ok{border-color:#b7f0cf}

.tape{
  position:fixed; left:0; right:0; bottom:0;
  background:repeating-linear-gradient(-45deg,#0000 0 10px,#ED1C2499 10px 20px);
  color:#fff; padding:12px 16px; font-weight:800; text-align:center;
}
.tape.ok{ background:#0a7d2b; }
</style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <div class="header">
        <img class="logo" src="https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png" alt="Vinet"/>
      </div>
      <h1>New Service Enquiry</h1>
      <p class="sub">Tell us where you need internet</p>

      <div id="secureBanner" class="banner" role="status" aria-live="polite" style="display:none">
        <div class="dot" aria-hidden="true"></div>
        <div><strong>Protected & Secure:</strong> This form is protected by a verified session.</div>
      </div>

      <form id="f" novalidate>
        <div class="row">
          <div><label>Full name *</label><input name="full_name" required autocomplete="name"/></div>
          <div><label>Phone (WhatsApp) *</label><input name="phone" required inputmode="tel" autocomplete="tel"/></div>
        </div>

        <div class="row">
          <div><label>Email *</label><input name="email" type="email" required autocomplete="email"/></div>
          <div>
            <label>Source *</label>
            <select name="source" required>
              <option value="">Select…</option>
              <option>Website</option><option>Facebook</option><option>Walk-in</option>
              <option>Referral</option><option>Other</option>
            </select>
          </div>
        </div>

        <div class="row">
          <div><label>City/Town *</label><input name="city" required autocomplete="address-level2"/></div>
          <div><label>ZIP *</label><input name="zip" required inputmode="numeric" autocomplete="postal-code"/></div>
        </div>

        <label>Street address (full line) *</label>
        <input name="street" required autocomplete="street-address" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848"/>

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

        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="consent" required/>
          <span>I consent to Vinet contacting me regarding this enquiry.</span>
        </label>

        <div class="actions">
          <button type="submit" class="btn">Submit</button>
          <button type="button" id="clearBtn" class="btn ghost">Clear</button>
        </div>
        <span class="small">Support: 021 007 0200</span>
      </form>
    </div>
  </main>

  <div id="toast" class="toast" role="alert"></div>
  <div id="tape" class="tape">Securing connection…</div>

<script>
(function(){
  const t  = document.getElementById('toast');
  const f  = document.getElementById('f');
  const tape = document.getElementById('tape');
  const banner = document.getElementById('secureBanner');
  const clearBtn = document.getElementById('clearBtn');

  const hasSecure = document.cookie.split(/;\\s*/).some(p => p.trim()==="ts_ok=1");
  if(hasSecure){
    tape.classList.add('ok'); tape.textContent = "Secured connection";
    banner.style.display = "flex";
  }

  function toast(html, ok=false){
    t.innerHTML = html; t.classList.toggle('ok', ok); t.style.display='block';
    setTimeout(()=>t.style.display='none', 6000);
  }

  clearBtn.addEventListener('click', ()=> f.reset());

  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(f);
    if(!fd.get('consent')){ toast('Please tick consent to proceed.'); return; }

    try{
      const r = await fetch('/submit', { method:'POST', body: fd });
      const d = await r.json().catch(()=>({}));
      if(d && d.ok){
        toast('<div style="font-weight:700;color:#0a7d2b">Thank you! Your enquiry was received.</div><div>Reference: '+(d.ref||'-')+'</div>', true);
        f.reset();
      }else{
        toast('Error: '+((d && (d.error||d.detail))||'Could not save.'));
      }
    }catch(_){
      toast('Network error — please try again.');
    }
  });
})();
</script>
</body>
</html>`;
}
