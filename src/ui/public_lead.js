// /src/ui/public_lead.js
import { LOGO_URL } from "../constants.js";

export function renderPublicLeadHTML() {
  return /*html*/`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>New Service Enquiry</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#ED1C24"/>
  <script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
  <style>
    :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
    body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .card{max-width:720px;margin:1.5rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
    .logo{display:flex;align-items:center;gap:.6rem;margin-bottom:1rem}
    .logo img{width:38px;height:38px;border-radius:8px}
    h1{margin:.25rem 0 0;font-size:1.25rem}
    form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    label{display:flex;flex-direction:column;font-size:.9rem;color:var(--muted);gap:.35rem}
    input,select,textarea{padding:.7rem .75rem;border:1px solid #e5e7eb;border-radius:12px;font:inherit}
    .span2{grid-column:1 / -1}
    .actions{display:flex;gap:.75rem;justify-content:flex-end;margin-top:1rem}
    button{border:0;border-radius:999px;padding:.75rem 1.1rem;background:var(--red);color:#fff;font-weight:600;cursor:pointer}
    button.secondary{background:#111;color:#fff}
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <img src="${LOGO_URL}" alt="Vinet"/>
      <div><h1>New Service Enquiry</h1><div style="color:var(--muted)">Tell us where you need internet</div></div>
    </div>
    <form id="leadForm">
      <label class="span2">Full name
        <input name="name" required/>
      </label>
      <label>Phone
        <input name="phone" required/>
      </label>
      <label>Email
        <input name="email" type="email" required/>
      </label>
      <label class="span2">Street address
        <input name="street"/>
      </label>
      <label>City/Town
        <input name="city"/>
      </label>
      <label>ZIP
        <input name="zip"/>
      </label>
      <label class="span2">Notes
        <textarea name="notes" rows="3"></textarea>
      </label>
      <div class="actions span2">
        <button type="reset" class="secondary">Clear</button>
        <button type="submit">Submit</button>
      </div>
    </form>
    <div id="msg" class="span2" style="margin-top:1rem"></div>
  </main>
  <script type="module">
    const f = document.getElementById('leadForm');
    const msg = document.getElementById('msg');
    function safe(t){return String(t||'').replace(/[&<>"]/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
    f.addEventListener('submit', async (e)=>{
      e.preventDefault();
      msg.textContent = 'Submitting...';
      const data = Object.fromEntries(new FormData(f));
      try{
        const res = await fetch('/api/leads/submit', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify(data)
        });
        const j = await res.json();
        if(!res.ok) throw new Error(j?.error||res.statusText);
        msg.innerHTML = j?.message 
          ? safe(j.message)
          : 'Thanks! We\'ll be in touch shortly.';
        if (j?.lead_id) {
          msg.innerHTML += '<br/>Lead ID: ' + safe(j.lead_id);
        }
        f.reset();
      }catch(err){
        msg.textContent = 'Error: ' + (err?.message||String(err));
      }
    });
  </script>
</body>
</html>`;
}
