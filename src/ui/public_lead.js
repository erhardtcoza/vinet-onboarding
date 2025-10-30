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
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .card{max-width:720px;margin:1.5rem auto;background:var(--card);border-radius:16px;box-shadow:0 4px 20px #0001;padding:1.25rem}
    .logo{display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem}
    .logo img{width:38px;height:38px;border-radius:8px}
    h1{margin:.25rem 0 0;font-size:1.25rem}
    .sub{color:var(--muted);margin-bottom:1rem}
    form{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    label{display:flex;flex-direction:column;font-size:.9rem;color:var(--muted);gap:.35rem}
    input,select,textarea{padding:.7rem .75rem;border:1px solid #e5e7eb;border-radius:12px;font:inherit}
    input[type="tel"]{letter-spacing:.4px}
    .span2{grid-column:1 / -1}
    .row{display:flex;gap:.75rem}
    .pill{border:0;border-radius:999px;padding:.8rem 1.2rem;background:#111;color:#fff;font-weight:700;cursor:pointer}
    .pill.primary{background:var(--red)}
    .actions{display:flex;gap:.75rem;justify-content:flex-end;margin-top:.75rem}
    .hint{color:var(--muted);font-size:.85rem}
    /* success overlay */
    .overlay{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center;padding:1rem}
    .sheet{background:#fff;max-width:520px;width:100%;border-radius:18px;box-shadow:0 16px 44px #0004;padding:1.2rem}
    .sheet h2{margin:.1rem 0 .5rem 0;font-size:1.6rem}
    .sheet p{margin:.25rem 0}
    .sheet .cta{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
    .link{color:#0b5cab;text-decoration:underline}
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <img src="\${LOGO_URL}" alt="Vinet"/>
      <div>
        <h1>New Service Enquiry</h1>
        <div class="sub">Tell us where you need internet</div>
      </div>
    </div>

    <form id="leadForm" autocomplete="on">
      <label class="span2">Full name
        <input name="name" id="name" autocomplete="name" required/>
      </label>

      <label>Phone
        <input name="phone" id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+27 71 234 5678" required/>
      </label>

      <label>Email
        <input name="email" id="email" type="email" autocomplete="email" required/>
      </label>

      <!-- One-line address the user can paste/type or auto-fill from geolocation -->
      <label class="span2">Street address (full line)
        <input name="address_line" id="address_line" placeholder="e.g. 20 Main Road, Villiersdorp, WC, 6848"/>
        <div class="hint">We’ll split this into Street / City / ZIP for you.</div>
      </label>

      <label>City/Town
        <input name="city" id="city"/>
      </label>

      <label>ZIP
        <input name="zip" id="zip" inputmode="numeric" pattern="[0-9]*"/>
      </label>

      <label class="span2">Notes
        <textarea name="notes" id="notes" rows="3" placeholder="Any extra details? (optional)"></textarea>
      </label>

      <div class="row span2" style="margin-top:.25rem">
        <button type="button" class="pill" id="btnGeo">Use my location</button>
        <button type="button" class="pill" id="btnContacts">Pick from contacts</button>
      </div>

      <div class="actions span2">
        <button type="button" class="pill" id="btnBack">Back</button>
        <button type="reset" class="pill">Clear</button>
        <button type="submit" class="pill primary">Submit</button>
      </div>
      <div id="msg" class="span2" style="margin-top:.4rem"></div>
    </form>
  </main>

  <!-- Success overlay -->
  <div class="overlay" id="okOverlay" role="dialog" aria-modal="true">
    <div class="sheet">
      <h2>Thank you!</h2>
      <p id="okRef" style="font-weight:800;font-size:1.15rem"></p>
      <p>Our team will contact you shortly.</p>
      <p class="hint">Need help? Support: <a class="link" href="tel:0210070200">021 007 0200</a> · <a class="link" href="mailto:sales@vinet.co.za">sales@vinet.co.za</a></p>
      <div class="cta">
        <button class="pill" id="okHome">Back to start</button>
        <button class="pill primary" id="okClose">Close</button>
      </div>
    </div>
  </div>

  <script type="module">
    const f   = document.getElementById('leadForm');
    const msg = document.getElementById('msg');

    const el = (id)=>document.getElementById(id);
    const nameEl = el('name'), phoneEl = el('phone'), emailEl = el('email');
    const lineEl = el('address_line'), cityEl = el('city'), zipEl = el('zip');

    const overlay = el('okOverlay'), okRef = el('okRef');
    el('okHome').onclick = ()=>{ window.location.href = "/"; };
    el('okClose').onclick = ()=>{ overlay.style.display = "none"; };

    el('btnBack').onclick = ()=>{ window.location.href = "/"; };

    function safe(t){return String(t||'').replace(/[&<>"]/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}

    // Heuristic normalizers
    function normalizeMsisdn(v){
      let s = String(v||"").replace(/[^0-9+]/g,"");
      if (s.startsWith("0")) s = "+27" + s.slice(1);
      if (/^27[0-9]/.test(s)) s = "+" + s;
      if (!s.startsWith("+") && /^[0-9]{9,15}$/.test(s)) s = "+" + s;
      return s;
    }

    // Split one-line address into street/city/zip
    function splitAddress(full){
      const out = { street:"", city:"", zip:"" };
      if(!full) return out;
      const parts = String(full).split(",").map(s=>s.trim()).filter(Boolean);
      if(parts.length){
        // ZIP: last token that is purely digits (3–6)
        for (let i = parts.length-1; i >= 0; i--){
          if (/^[0-9]{3,6}$/.test(parts[i])) { out.zip = parts[i]; parts.splice(i,1); break; }
        }
        // City: last remaining token
        if (parts.length){ out.city = parts[parts.length-1]; parts.pop(); }
        // Street: whatever is left
        out.street = parts.join(", ").trim();
      }
      return out;
    }

    // Reverse geocode helper (Nominatim); polite + fallback
    async function reverseGeocode(lat, lon){
      try{
        const u = new URL("https://nominatim.openstreetmap.org/reverse");
        u.searchParams.set("format","jsonv2");
        u.searchParams.set("lat", String(lat));
        u.searchParams.set("lon", String(lon));
        u.searchParams.set("zoom","18");
        u.searchParams.set("addressdetails","1");
        const r = await fetch(u.toString(), { headers:{ "accept":"application/json" }});
        const j = await r.json().catch(()=>null);
        const addr = j && j.address ? j.address : {};
        const streetBits = [addr.road, addr.house_number].filter(Boolean).join(" ").trim() || j.display_name || "";
        const city = addr.city || addr.town || addr.village || addr.suburb || "";
        const zip  = addr.postcode || "";
        return { street: streetBits, city, zip, line: j.display_name || "" };
      }catch(_e){
        return null;
      }
    }

    // Use my location
    el('btnGeo').onclick = async ()=>{
      msg.textContent = "Locating…";
      if (!navigator.geolocation){ msg.textContent = "Geolocation not available."; return; }
      navigator.geolocation.getCurrentPosition(async (pos)=>{
        const { latitude:lat, longitude:lon } = pos.coords || {};
        let filled = false;
        const rg = await reverseGeocode(lat,lon);
        if (rg){
          lineEl.value = rg.line || (rg.street && rg.city ? \`\${rg.street}, \${rg.city}\` : "");
          if (rg.street) { /* street goes in address_line; server will split too */ }
          if (rg.city && !cityEl.value) cityEl.value = rg.city;
          if (rg.zip && !zipEl.value) zipEl.value = rg.zip;
          msg.textContent = "Location filled.";
          filled = true;
        }
        if (!filled){
          lineEl.value = \`(\${lat.toFixed(5)}, \${lon.toFixed(5)})\`;
          msg.textContent = "Couldn’t reverse-geocode; captured coordinates.";
        }
      }, (err)=>{
        msg.textContent = "Location blocked or failed.";
      }, { enableHighAccuracy:true, timeout:7000 });
    };

    // Pick from contacts (Chromium/Android + some iOS PWAs)
    el('btnContacts').onclick = async ()=>{
      if (!("contacts" in navigator) || !("select" in navigator.contacts)){
        msg.textContent = "Contact picker not supported on this device.";
        return;
      }
      try{
        const props = ["name","email","tel","address"];
        const opts = { multiple:false };
        const [c] = await navigator.contacts.select(props, opts);
        if (!c){ msg.textContent = "No contact selected."; return; }
        if ((c.name||[])[0] && !nameEl.value) nameEl.value = c.name[0];
        if ((c.tel||[])[0]  && !phoneEl.value) phoneEl.value = c.tel[0];
        if ((c.email||[])[0]&& !emailEl.value) emailEl.value = c.email[0];
        const a = (c.address||[])[0];
        if (a){
          const line = [a.addressLine && a.addressLine.join(" "), a.city, a.postalCode].filter(Boolean).join(", ");
          if (line && !lineEl.value) lineEl.value = line;
          if (a.city && !cityEl.value) cityEl.value = a.city;
          if (a.postalCode && !zipEl.value) zipEl.value = a.postalCode;
        }
        msg.textContent = "Contact applied.";
      }catch(e){
        msg.textContent = "Contact picker cancelled.";
      }
    };

    // Submit
    f.addEventListener('submit', async (e)=>{
      e.preventDefault();
      msg.textContent = 'Submitting…';

      // phone + address split helpers
      phoneEl.value = normalizeMsisdn(phoneEl.value);
      if (!cityEl.value || !zipEl.value){
        const guess = splitAddress(lineEl.value);
        cityEl.value = cityEl.value || guess.city;
        zipEl.value  = zipEl.value  || guess.zip;
      }

      const payload = {
        name: nameEl.value.trim(),
        phone: phoneEl.value.trim(),
        email: (emailEl.value||"").trim(),
        street: (lineEl.value||"").trim(),
        city: (cityEl.value||"").trim(),
        zip: (zipEl.value||"").trim(),
        source: "web",
        service: "general"
      };

      try{
        const res = await fetch('/submit', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify(payload)
        });
        const j = await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(j?.error || res.statusText);

        // Big, centered success sheet with ref + contacts
        okRef.textContent = j?.ref ? \`Reference: \${j.ref}\` : "Reference generated.";
        overlay.style.display = "flex";

        // Reset form for next user
        f.reset();
        msg.textContent = '';
      }catch(err){
        msg.textContent = 'Error: ' + (err?.message||String(err));
      }
    });
  </script>
</body>
</html>`;
}
