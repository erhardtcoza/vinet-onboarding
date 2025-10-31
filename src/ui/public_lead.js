// src/ui/public_lead.js
// Public self-signup with: address auto-split, geolocation fill, contact picker,
// success modal, and smart autofill (URL params + last submit memory)
import { LOGO_URL } from "../constants.js";

export function renderPublicLeadHTML() {
  return /*html*/`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>New Service Enquiry</title>
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ED1C24"/>
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js");}</script>
<style>
  :root{--red:#ED1C24;--ink:#0b1320;--muted:#6b7280;--bg:#f7f7f8;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink)}
  .card{max-width:720px;margin:1.6rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
  .logo{display:flex;align-items:center;gap:.6rem;margin-bottom:1rem}
  .logo img{width:38px;height:38px;border-radius:8px}
  h1{margin:.25rem 0 0;font-size:1.25rem}
  form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
  label{display:flex;flex-direction:column;font-size:.9rem;color:var(--muted);gap:.35rem}
  input,select,textarea{padding:.7rem .75rem;border:1px solid #e5e7eb;border-radius:12px;font:inherit}
  .hint{color:var(--muted);font-size:.85rem}
  .span2{grid-column:1 / -1}
  .actions{display:flex;gap:.75rem;justify-content:space-between;margin-top:.5rem}
  .left{display:flex;gap:.5rem;flex-wrap:wrap}
  button{border:0;border-radius:999px;padding:.75rem 1.1rem;background:#111;color:#fff;font-weight:700;cursor:pointer}
  button.primary{background:var(--red)}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;padding:16px}
  .sheet{background:#fff;max-width:560px;width:100%;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:20px}
  .sheet h2{margin:.25rem 0 .25rem;font-size:1.6rem}
  .rowbtns{display:flex;gap:.5rem;justify-content:flex-start;margin-top:.75rem}
</style>
</head><body>
  <main class="card">
    <div class="logo">
      <img src="${LOGO_URL}" alt="Vinet"/>
      <div><h1>New Service Enquiry</h1><div style="color:var(--muted)">Tell us where you need internet</div></div>
    </div>

    <form id="leadForm" autocomplete="on">
      <label class="span2">Full name
        <input name="name" autocomplete="name" autocapitalize="words" spellcheck="false" required/>
      </label>
      <label>Phone
        <input name="phone" type="tel" autocomplete="tel" inputmode="tel" pattern="^[0-9+()\\s-]{6,}$" required/>
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="email" inputmode="email" required/>
      </label>

      <label class="span2">Street address (full line)
        <input name="full_line" autocomplete="street-address" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848"/>
        <div class="hint">We’ll split this into Street / City / ZIP for you.</div>
      </label>

      <label>City/Town
        <input name="city" autocomplete="address-level2"/>
      </label>
      <label>ZIP
        <input name="zip" autocomplete="postal-code" inputmode="numeric" pattern="\\d{3,6}"/>
      </label>

      <label class="span2">Notes
        <textarea name="notes" rows="3" autocomplete="off"></textarea>
      </label>

      <div class="actions span2">
        <div class="left">
          <button type="button" id="geo">Use my location</button>
          <button type="button" id="pick">Pick from contacts</button>
          <button type="button" id="back">Back</button>
          <button type="reset">Clear</button>
        </div>
        <div>
          <button type="submit" class="primary">Submit</button>
        </div>
      </div>
    </form>
  </main>

  <div class="modal" id="done">
    <div class="sheet">
      <h2>Thank you!</h2>
      <div id="refline" style="font-weight:800;margin:.25rem 0 .5rem"></div>
      <div>Our team will contact you shortly.</div>
      <div class="hint" style="margin-top:.5rem">Need help? Support: <a href="tel:0210070200">021&nbsp;007&nbsp;0200</a> · <a href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></div>
      <div class="rowbtns">
        <button id="close">Close</button>
        <button id="home" class="primary">Back to start</button>
      </div>
    </div>
  </div>

<script type="module">
  const f   = document.getElementById('leadForm');
  const geo = document.getElementById('geo');
  const pick= document.getElementById('pick');
  const back= document.getElementById('back');
  const md  = document.getElementById('done');
  const refline = document.getElementById('refline');

  function splitAddress(full){
    const out = { street:"", city:"", zip:"" };
    if(!full) return out;
    const parts = String(full).split(",").map(s=>s.trim()).filter(Boolean);
    for(let i=parts.length-1;i>=0;i--){
      if(/^[0-9]{3,6}$/.test(parts[i])){ out.zip = parts[i]; parts.splice(i,1); break; }
    }
    if(parts.length){ out.city = parts[parts.length-1]; parts.pop(); }
    out.street = parts.join(", ").trim();
    return out;
  }

  // ---------- SMART AUTOFILL ----------
  function tryURLPrefill(){
    const u = new URL(location.href);
    const q = (k)=>u.searchParams.get(k) || "";
    if(q("name"))  f.name.value  = q("name");
    if(q("phone")) f.phone.value = q("phone");
    if(q("email")) f.email.value = q("email");
    if(q("addr"))  f.full_line.value = q("addr");
    if(!f.city.value || !f.zip.value){
      const s = splitAddress(f.full_line.value);
      if(s.city && !f.city.value) f.city.value = s.city;
      if(s.zip  && !f.zip.value)  f.zip.value  = s.zip;
    }
  }
  function tryMemoryPrefill(){
    try{
      const raw = localStorage.getItem("vinet_last_lead");
      if(!raw) return;
      const v = JSON.parse(raw);
      if(v.name && !f.name.value)   f.name.value = v.name;
      if(v.phone && !f.phone.value) f.phone.value = v.phone;
      if(v.email && !f.email.value) f.email.value = v.email;
      if(v.full_line && !f.full_line.value) f.full_line.value = v.full_line;
      if(v.city && !f.city.value) f.city.value = v.city;
      if(v.zip  && !f.zip.value)  f.zip.value  = v.zip;
    }catch{}
  }
  tryURLPrefill();
  tryMemoryPrefill();

  // Auto-split when user leaves the full-line field
  const fullInput = f.querySelector('input[name="full_line"]');
  fullInput.addEventListener('blur', ()=>{
    const s = splitAddress(fullInput.value);
    if(s.city && !f.city.value) f.city.value = s.city;
    if(s.zip  && !f.zip.value)  f.zip.value  = s.zip;
  });

  // Geolocation -> reverse geocode (Nominatim)
  geo.onclick = async ()=>{
    try{
      if (navigator.permissions && navigator.permissions.query) {
        await navigator.permissions.query({name:"geolocation"});
      }
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:8000}));
      const { latitude:lat, longitude:lon } = pos.coords;
      const r = await fetch(\`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=\${lat}&lon=\${lon}\`, {headers:{'Accept':'application/json'}});
      const j = await r.json();
      const line = j?.display_name || "";
      f.full_line.value = line;
      const s = splitAddress(line);
      if (s.city) f.city.value = s.city;
      if (s.zip)  f.zip.value  = s.zip;
    }catch(e){ alert("Could not get your location."); }
  };

  // Contact Picker (if supported)
  pick.onclick = async ()=>{
    try{
      if(!('contacts' in navigator) || !('select' in navigator.contacts)) throw 0;
      const props = ['name','tel','email'];
      const result = await navigator.contacts.select(props,{multiple:false});
      const c = (result && result[0]) || {};
      const name = (c.name && c.name[0]) || "";
      const tel  = (c.tel  && c.tel[0])  || "";
      const em   = (c.email&& c.email[0])|| "";
      if(name) f.name.value = name;
      if(tel)  f.phone.value = tel;
      if(em)   f.email.value = em;
    }catch(_){ alert("Contact picker not available on this device."); }
  };

  back.onclick = ()=>{ location.href = "/"; };

  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    const s = splitAddress(data.full_line);
    data.street = s.street || data.street || data.full_line || "";
    data.city   = data.city || s.city || "";
    data.zip    = data.zip  || s.zip  || "";
    data.source = data.source || "web";

    const res = await fetch('/api/leads/submit', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({
        name: data.name, phone: data.phone, email: data.email,
        street: data.street, city: data.city, zip: data.zip,
        notes: data.notes, source: data.source, service_interested: data.service
      })
    });
    const j = await res.json().catch(()=>null);
    if(res.ok && j?.ok){
      try{
        localStorage.setItem("vinet_last_lead", JSON.stringify({
          name:data.name, phone:data.phone, email:data.email,
          full_line:data.full_line, city:data.city, zip:data.zip
        }));
      }catch{}
      refline.textContent = "Reference: " + (j.ref || "-");
      md.style.display = "flex";
      f.reset();
    }else{
      alert("Error: " + (j?.error || res.statusText));
    }
  });

  document.getElementById('home').onclick  = ()=>location.href="/";
  document.getElementById('close').onclick = ()=>{ md.style.display = "none"; };
</script>
</body></html>`;
}
