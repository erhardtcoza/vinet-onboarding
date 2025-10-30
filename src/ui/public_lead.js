import { LOGO_URL } from "../constants.js";

export function renderPublicLeadHTML() {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>New Service Enquiry</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#ED1C24"/>
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
  .row{display:flex;gap:.5rem}
  .actions{display:flex;gap:.75rem;justify-content:flex-end;margin-top:1rem}
  button{border:0;border-radius:999px;padding:.75rem 1.1rem;background:var(--red);color:#fff;font-weight:600;cursor:pointer}
  button.secondary{background:#111;color:#fff}
  .hint{color:var(--muted);font-size:.85rem}
</style>
</head><body>
  <main class="card">
    <div class="logo">
      <img src="${LOGO_URL}" alt="Vinet"/>
      <div><h1>New Service Enquiry</h1><div style="color:var(--muted)">Tell us where you need internet</div></div>
    </div>

    <form id="leadForm" autocomplete="on">
      <label class="span2">Full name
        <input name="name" autocomplete="name" required/>
      </label>
      <label>Phone
        <input name="phone" inputmode="tel" autocomplete="tel" required/>
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="email" required/>
      </label>

      <label class="span2">Street address
        <input name="street" autocomplete="street-address"/>
      </label>
      <label>City/Town
        <input name="city" autocomplete="address-level2"/>
      </label>
      <label>ZIP
        <input name="zip" autocomplete="postal-code"/>
      </label>

      <label class="span2">Notes
        <textarea name="notes" rows="3" autocomplete="off"></textarea>
      </label>

      <div class="row span2">
        <button type="button" id="locBtn" class="secondary">Use my location</button>
        <button type="button" id="pickBtn" class="secondary">Pick from contacts</button>
        <span class="hint" id="locMsg"></span>
      </div>

      <div class="actions span2">
        <button type="reset" class="secondary">Clear</button>
        <button type="submit">Submit</button>
      </div>
    </form>

    <div id="msg" class="span2" style="margin-top:1rem"></div>
  </main>

<script type="module">
const f   = document.getElementById('leadForm');
const msg = document.getElementById('msg');
const locBtn = document.getElementById('locBtn');
const pickBtn= document.getElementById('pickBtn');
const locMsg = document.getElementById('locMsg');

function safe(t){return String(t||'').replace(/[&<>"]/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function normPhone(p){
  const d = String(p||"").replace(/\\D+/g,"");
  if (d.startsWith("0")) return "27"+d.slice(1);
  if (d.startsWith("27")) return d;
  return d;
}

// Contact Picker API (optional)
pickBtn.addEventListener('click', async ()=>{
  try{
    if (!('contacts' in navigator) || !('select' in navigator.contacts)) throw new Error('Not supported');
    const props = ['name','email','tel'];
    const opts  = { multiple:false };
    const [c] = await navigator.contacts.select(props, opts);
    if (c){
      const name = (c.name && c.name[0]) || "";
      const email = (c.email && c.email[0]) || "";
      const tel = (c.tel && c.tel[0]) || "";
      if (name)  f.elements.name.value = name;
      if (email) f.elements.email.value = email;
      if (tel)   f.elements.phone.value = tel;
    }
  }catch(e){
    msg.textContent = "Contact picker not available on this device.";
    setTimeout(()=>msg.textContent="", 3000);
  }
});

// Geolocation + reverse geocode
locBtn.addEventListener('click', async ()=>{
  try{
    locMsg.textContent = "Locating…";
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:10000}));
    const { latitude:lat, longitude:lng } = pos.coords;
    locMsg.textContent = "Resolving address…";
    const r = await fetch(\`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=\${lat}&lon=\${lng}\`,{
      headers:{'accept':'application/json'}
    });
    const j = await r.json();
    const a = j.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ") || j.display_name || "";
    const city   = a.town || a.city || a.village || a.suburb || "";
    const zip    = a.postcode || "";
    if (street) f.elements.street.value = street;
    if (city)   f.elements.city.value   = city;
    if (zip)    f.elements.zip.value    = zip;
    locMsg.textContent = "Address filled from your location.";
    setTimeout(()=>locMsg.textContent="", 4000);
    // Keep coordinates in dataset for submit
    f.dataset.lat = String(lat);
    f.dataset.lng = String(lng);
  }catch(e){
    locMsg.textContent = "Could not get location.";
    setTimeout(()=>locMsg.textContent="", 3000);
  }
});

f.addEventListener('submit', async (e)=>{
  e.preventDefault();
  msg.textContent = 'Submitting...';
  const data = Object.fromEntries(new FormData(f));
  data.phone = normPhone(data.phone);
  if (f.dataset.lat) data.lat = Number(f.dataset.lat);
  if (f.dataset.lng) data.lng = Number(f.dataset.lng);

  try{
    const res = await fetch('/submit', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify(data)
    });
    const j = await res.json();
    if(!res.ok) throw new Error(j?.error||res.statusText);
    msg.innerHTML = j?.message ? safe(j.message) : "Thanks! We'll be in touch shortly.";
    if (j?.ref) msg.innerHTML += "<br/>Ref: " + safe(j.ref);
    f.reset(); delete f.dataset.lat; delete f.dataset.lng;
  }catch(err){
    msg.textContent = 'Error: ' + (err?.message||String(err));
  }
});
</script>
</body></html>`;
}
