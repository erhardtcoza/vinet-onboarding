// /src/ui/splash.js
export async function renderSplashHTML() {
  return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome · Vinet Internet Solutions</title>
  <link rel="icon" href="https://static.vinet.co.za/logo.jpeg" />
  <style>
    :root {
      --red: #e10600;
      --black: #000;
      --white: #fff;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--white);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .splash {
      text-align: center;
      animation: fadein 1.5s ease;
    }
    img {
      width: 120px;
      height: auto;
      animation: pop 1.6s ease;
    }
    h1 {
      font-size: 1.3rem;
      color: var(--red);
      margin-top: 20px;
    }
    @keyframes pop {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes fadein {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="splash">
    <img src="https://static.vinet.co.za/logo.jpeg" alt="Vinet Logo" />
    <h1>Vinet Internet Solutions</h1>
  </div>
  <script>
    // notify worker we've visited splash
    fetch('/api/visited', { method: 'POST' });
    // redirect to landing after short delay
    setTimeout(()=> location.href = '/lead', 1800);
  </script>
</body>
</html>
`;
}
