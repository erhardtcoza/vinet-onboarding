import { LOGO_URL } from "./constants.js";

/* basic json helper */
export const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json" },
  });

export function getIP(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    ""
  );
}

export function getUA(req) {
  return req.headers.get("user-agent") || "";
}

/* Branded 403 page (Admin lock) */
export function restrictedResponse(request) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Restricted Access • Vinet</title>
  <style>
    :root { --vinet:#e2001a; --ink:#222; --muted:#666; --card:#fff; --bg:#f7f8fb; }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif}
    .wrap{max-width:900px;margin:56px auto;padding:0 22px}
    .card{background:var(--card);border-radius:18px;box-shadow:0 6px 24px #00000012,0 1px 2px #0001;padding:26px;text-align:center}
    .logo{display:block;margin:0 auto 16px;max-width:520px;width:100%;height:auto}
    h1{margin:10px 0 8px;font-size:26px;color:var(--vinet);font-weight:900}
    p{margin:8px 0;font-size:16px;color:#333}
    .muted{color:var(--muted);font-size:14px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <img class="logo" src="${LOGO_URL}" alt="Vinet Internet Solutions" />
      <h1>Restricted Access</h1>
      <p>Sorry, this page is only accessible from within the <b>Vinet Internet Solutions</b> network.</p>
      <p class="muted">If you have any questions please contact our office on <b>021&nbsp;007&nbsp;0200</b> or <a href="mailto:support@vinet.co.za">support@vinet.co.za</a>.</p>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/* WhatsApp send helper */
export async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
  const templateName = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toMsisdn,
    type: "template",
    template: {
      name: templateName,
      language: { code: env.WHATSAPP_TEMPLATE_LANG || lang },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code.slice(-6) }],
        },
      ],
    },
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WA template send failed ${r.status} ${body}`);
  }
}
