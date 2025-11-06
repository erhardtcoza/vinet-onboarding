// /src/ui/landing.js
export async function renderLandingHTML() {
  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vinet Internet Solutions</title>
  <link rel="icon" href="https://static.vinet.co.za/logo.jpeg" />
  <style>
    :root {
      --red: #e10600;
      --black: #000;
      --white: #fff;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--white);
      margin: 0;
      text-align: center;
      color: var(--black);
    }
    header {
      padding: 40px 20px 10px;
    }
    header img {
      height: 80px;
      width: auto;
    }
    h1 {
      font-size: 1.6rem;
      margin: 10px 0;
      color: var(--red);
    }
    p {
      max-width: 460px;
      margin: 10px auto;
      font-size: 1rem;
      color: #444;
    }
    a.button {
      display: inline-block;
      background: var(--red);
      color: var(--white);
      padding: 12px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 25px;
      transition: background 0.2s;
    }
    a.button:hover {
      background: #c10500;
    }
  </style>
</head>
<body>
  <header>
    <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo" />
    <h1>Welcome to Vinet Internet Solutions</h1>
  </header>
  <main>
    <p>Fast, reliable, and proudly local internet.  
    Capture new leads, manage customers, and connect faster than ever.</p>
    <a href="/lead" class="button">Start Capturing Leads</a>
  </main>
</body>
</html>
`;
}
