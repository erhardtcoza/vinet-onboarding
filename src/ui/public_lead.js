// src/ui/public_lead.js
export function renderPublicLeadHTML(){
  return /*html*/`
<!doctype html><meta charset="utf-8"/>
<title>Vinet Lead Capture</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="https://static.vinet.co.za/favicon.ico"/>
<style>
  :root{--brand:#e2001a;--ink:#111;--line:#ddd;--bg:#f7f7fa}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--ink);max-width:680px;margin:40px auto;padding:20px;}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,.06);padding:22px;}
  .logo{width:160px;height:auto;display:block;margin:0 auto 10px}
  h1{color:var(--brand);text-align:center;margin:6px 0 20px;font-size:28px}
  label{display:block;margin:10px 0 6px;font-weight:600}
  input,select,textarea{width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;background:#fff;}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .actions{margin-top:18px}
  button{width:100%;background:var(--brand);color:#fff;border:none;border-radius:10px;padding:12px 14px;font-weight:700;cursor:pointer;}
  .toast{position:fixed;inset:auto 16px 16px 16px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 10px 28px rgba(0,0,0,.12);display:none;}
  .center{text-align:center}
</style>
<div class="card">
  <img class="logo" src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Internet Solutions"/>
  <h1>New Service Enquiry</h1>
  <form id="leadForm" novalidate>
    <div class="row">
      <div><label>Full Name *</label><input name="full_name" required/></div>
      <div><label>Phone (WhatsApp) *</label><input name="phone" required/></div>
    </div>
    <div class="row">
      <div><label>Email *</label><input name="email" type="email" required/></div>
      <div><label>Source *</label>
        <select name="source" required>
          <option value="">Select…</option><option>Website</option><option>Facebook</option>
          <option>Walk-in</option><option>Referral</option><option>Other</option>
        </select></div>
    </div>
    <div class="row">
      <div><label>City *</label><input name="city" required/></div>
      <div><label>ZIP *</label><input name="zip" required/></div>
    </div>
    <label>Street Address *</label><input name="street" required/>
    <label>Service Interested In *</label>
    <select name="service" required>
      <option value="">Select…</option>
      <option>FTTH (Fibre to the Home)</option><option>Fixed Wireless / Airfibre</option>
      <option>VoIP</option><option>Web Hosting</option>
    </select>
    <input type="hidden" name="partner" value="main"/>
    <input type="hidden" name="location" value="main"/>
    <label><input type="checkbox" name="consent" required/> I consent to Vinet contacting me.</label>
    <div class="actions"><button type="submit">Submit</button></div>
    <p class="center"><small>Support: 021 007 0200</small></p>
  </form>
</div>
<div id="toast" class="toast"></div>
<script>
const form=document.getElementById("leadForm");
const toast=document.getElementById("toast");
function showToast(html){toast.innerHTML=html;toast.style.display="block";setTimeout(()=>toast.style.display="none",6000);}
form.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const fd=new FormData(form);
  if(!fd.get("consent")){showToast("Please tick consent to proceed.");return;}
  const res=await fetch("/submit",{method:"POST",body:fd});
  const data=await res.json().catch(()=>({}));
  if(data&&data.ok){
    showToast('<div style="color:#0a7d2b;font-weight:700">Thank you! Your enquiry was received.</div><div>Reference: '+(data.ref||"-")+'</div>');
    form.reset();
  }else{
    const msg=(data&&(data.error||data.detail))?String(data.error||data.detail).slice(0,200):"Could not save. Please try again.";
    showToast("Error: "+msg);
  }
});
</script>`;
}
