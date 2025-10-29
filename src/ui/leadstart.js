// src/ui/leadstart.js
import { LOGO_URL } from "../constants.js";

export function renderLeadStartPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Get Connected • Vinet</title>
<style>
  body{font-family:system-ui,sans-serif;background:#fafbfc;color:#232;margin:0;padding:24px}
  .card{background:#fff;max-width:680px;margin:2.5em auto;border-radius:1.25em;box-shadow:0 2px 12px #0002;padding:1.75em}
  .logo{display:block;margin:0 auto 1em;max-width:160px}
  h1{color:#e2001a;font-size:1.4rem;margin:.2em 0 .6em;text-align:center;font-weight:700}
  p.lead{color:#444;font-size:.95rem;text-align:center;margin-top:0;margin-bottom:1.25em;line-height:1.4}
  .field{margin:1em 0}
  label{display:block;font-size:.9rem;font-weight:600;color:#333;margin-bottom:.4em}
  input{width:100%;padding:.75em .8em;font-size:1rem;border-radius:.6em;border:1px solid #ccc}
  .row{display:flex;gap:.75em;flex-wrap:wrap}
  .row>*{flex:1}
  .btn{background:#e2001a;color:#fff;border:0;border-radius:.7em;padding:.8em 1em;font-size:1rem;font-weight:600;cursor:pointer;width:100%;margin-top:1em}
  .note{font-size:.8rem;color:#666;text-align:center;margin-top:1em;line-height:1.4}
  .okmsg{color:#2e7d32;font-size:.95rem;font-weight:600;text-align:center;margin-top:1em}
  .errmsg{color:#b00020;font-size:.9rem;text-align:center;margin-top:1em}
  .hidden{display:none}
</style>
</head>
<body>
  <div class="card" id="card">
    <img class="logo" src="${LOGO_URL}" alt="Vinet Logo"/>
    <h1>Get connected with Vinet</h1>
    <p class="lead">
      Tell us where you’d like internet installed and how to contact you.
      We’ll confirm availability and send you the next step to complete RICA & sign.
    </p>

    <form id="leadForm" autocomplete="off">
      <div class="field">
        <label>Full name</label>
        <input name="full_name" required />
      </div>

      <div class="row">
        <div class="field">
          <label>Phone (WhatsApp)</label>
          <input name="phone" required />
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" type="email" required />
        </div>
      </div>

      <div class="field">
        <label>Street address</label>
        <input name="street" required />
      </div>

      <div class="row">
        <div class="field">
          <label>City / Town</label>
          <input name="city" required />
        </div>
        <div class="field">
          <label>ZIP</label>
          <input name="zip" required />
        </div>
      </div>

      <button class="btn" type="submit" id="submitBtn">Send my request</button>

      <div id="resp_ok" class="okmsg hidden">
        Thank you! A Vinet consultant will review and contact you shortly.
      </div>
      <div id="resp_err" class="errmsg hidden"></div>

      <div class="note">
        We’ll never share your details. We just use this info to check coverage
        and prepare your service agreement.
      </div>
    </form>
  </div>

<script>
(function(){
  const form = document.getElementById("leadForm");
  const btn  = document.getElementById("submitBtn");
  const okEl = document.getElementById("resp_ok");
  const errEl= document.getElementById("resp_err");

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    errEl.classList.add("hidden");
    okEl.classList.add("hidden");

    btn.disabled = true;
    btn.textContent = "Sending...";

    const fd = new FormData(form);
    const payload = {
      full_name: fd.get("full_name") || "",
      phone:     fd.get("phone")     || "",
      email:     fd.get("email")     || "",
      street:    fd.get("street")    || "",
      city:      fd.get("city")      || "",
      zip:       fd.get("zip")       || ""
    };

    try {
      const r = await fetch("/api/lead/create", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify(payload)
      });
      const d = await r.json().catch(()=>({}));

      if (d && d.ok) {
        okEl.classList.remove("hidden");
        form.querySelectorAll("input").forEach(i=>i.disabled=true);
        btn.style.display="none";
      } else {
        errEl.textContent = (d && d.error) ? d.error : "Something went wrong. Please try again.";
        errEl.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Send my request";
      }
    } catch (e2) {
      errEl.textContent = "Network error. Please try again.";
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Send my request";
    }
  });
})();
</script>

</body>
</html>`;
}
