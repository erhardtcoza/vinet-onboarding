// /src/ui/public_lead.js
export async function renderPublicLeadHTML(env) {
  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vinet Lead Capture</title>
  <link rel="icon" href="https://static.vinet.co.za/logo.jpeg" />
  <style>
    :root {
      --red: #e10600;
      --black: #000;
      --white: #fff;
      --gray: #f6f6f6;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--gray);
      margin: 0; padding: 0;
    }
    header {
      background: var(--white);
      display: flex;
      align-items: center;
      padding: 10px 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    header img {
      height: 40px;
      margin-right: 10px;
    }
    h1 {
      font-size: 1.2rem;
      color: var(--red);
      margin: 0;
    }
    main {
      max-width: 480px;
      margin: 30px auto;
      background: var(--white);
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    label {
      display: block;
      font-weight: 600;
      margin-top: 15px;
      margin-bottom: 5px;
      color: var(--black);
    }
    input, select {
      width: 100%;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }
    input:focus {
      border-color: var(--red);
      outline: none;
      box-shadow: 0 0 0 2px rgba(225,6,0,0.1);
    }
    button {
      background: var(--red);
      color: var(--white);
      border: none;
      border-radius: 8px;
      padding: 12px;
      width: 100%;
      font-size: 1rem;
      font-weight: 600;
      margin-top: 25px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #c10500;
    }
    .turnstile {
      margin-top: 20px;
    }
    .toast {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--white);
      color: var(--black);
      border-radius: 10px;
      box-shadow: 0 3px 8px rgba(0,0,0,0.3);
      padding: 20px 25px;
      display: none;
      z-index: 999;
    }
    .toast.show {
      display: block;
    }
    #overlay {
      position: fixed;
      inset: 0;
      background: rgba(255,255,255,0.9);
      display: none;
      z-index: 99;
      justify-content: center;
      align-items: center;
      font-size: 1.2rem;
      color: var(--red);
      font-weight: 600;
    }
  </style>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>
  <header>
    <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo" />
    <h1>Vinet Lead Capture</h1>
  </header>
  <main>
    <form id="leadForm">
      <label>Admin Name</label>
      <input type="text" name="sales_user" placeholder="e.g. Erhardt" required />

      <label>Full Name</label>
      <input type="text" name="full_name" required />

      <label>Email</label>
      <input type="email" name="email" required />

      <label>Phone</label>
      <input type="text" name="phone" required />

      <label>City</label>
      <input type="text" name="city" />

      <label>Street</label>
      <input type="text" name="street" />

      <label>ZIP Code</label>
      <input type="text" name="zip" />

      <label>Source</label>
      <input type="text" name="source" placeholder="e.g. walk-in, website, WhatsApp" />

      <div class="turnstile" data-sitekey="0x4AAAAAAA5rLSlX9pV1I3nP" data-theme="light"></div>

      <button type="submit">Submit Lead</button>
    </form>
  </main>

  <div id="overlay">Please wait...</div>
  <div class="toast" id="toast"></div>

  <script>
    const form = document.getElementById('leadForm');
    const toast = document.getElementById('toast');
    const overlay = document.getElementById('overlay');

    function showToast(msg, ok=true) {
      toast.textContent = msg;
      toast.style.background = ok ? '#fff' : '#e10600';
      toast.style.color = ok ? '#000' : '#fff';
      toast.classList.add('show');
      setTimeout(()=> toast.classList.remove('show'), 3000);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      overlay.style.display = 'flex';
      const data = Object.fromEntries(new FormData(form));
      try {
        const res = await fetch('/api/public/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const json = await res.json();
        overlay.style.display = 'none';
        if (json.ok) {
          showToast('Lead submitted successfully! Ref: ' + json.ref, true);
          form.reset();
          window.turnstile?.reset();
        } else {
          showToast(json.error || 'Error submitting lead', false);
        }
      } catch (err) {
        overlay.style.display = 'none';
        showToast('Network error, please try again', false);
      }
    });
  </script>
</body>
</html>
`;
}
