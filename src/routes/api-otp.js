// src/routes/api-otp.js

// Minimal helpers
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const nowSec = () => Math.floor(Date.now() / 1000);
const rand6 = () => String(Math.floor(100000 + Math.random() * 900000));

export function match(pathname, method) {
  return (
    (pathname === "/api/otp/send" && method === "POST") ||
    (pathname === "/api/otp/verify" && method === "POST")
  );
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- SEND WhatsApp OTP ----------------------------------------------------
  if (path === "/api/otp/send" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const linkid = (body.linkid || "").trim();
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    // Generate 6-digit and store under otp:wa:<linkid> for 10 minutes
    const code = rand6();
    const ttl = 60 * 10; // 10 minutes
    const record = { code, exp: nowSec() + ttl, created: Date.now(), kind: "wa" };
    await env.ONBOARD_KV.put(`otp:wa:${linkid}`, JSON.stringify(record), { expirationTtl: ttl });

    // Try to send via WhatsApp (best-effort). If it fails, we still return ok:true.
    // We need a phone number; if you already have an endpoint to fetch it, call that from frontend
    // and pass it in body.msisdn. Otherwise this will just no-op.
    const msisdn = (body.msisdn || "").replace(/\D+/g, "");
    if (msisdn && env.WHATSAPP_TOKEN && env.PHONE_NUMBER_ID) {
      try {
        await fetch(`https://graph.facebook.com/v19.0/${env.PHONE_NUMBER_ID}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: msisdn,
            type: "template",
            template: {
              name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
              language: { code: env.WHATSAPP_TEMPLATE_LANG || "en_US" },
              components: [
                {
                  type: "body",
                  parameters: [{ type: "text", text: code }],
                },
              ],
            },
          }),
        });
      } catch (e) {
        // Log-only; don't fail the request
        console.log("WhatsApp send failed:", (e && e.message) || String(e));
      }
    }

    return json({ ok: true });
  }

  // --- VERIFY OTP (WA or STAFF) --------------------------------------------
  if (path === "/api/otp/verify" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const linkid = (body.linkid || "").trim();
    const otp = (body.otp || "").trim();
    const kind = (body.kind || "wa").toLowerCase(); // "wa" | "staff"

    if (!linkid || !otp) return json({ ok: false, error: "Missing linkid/otp" }, 400);

    const key = kind === "staff" ? `staff:${linkid}` : `otp:wa:${linkid}`;
    const rec = await env.ONBOARD_KV.get(key, "json");

    if (!rec || !rec.code) return json({ ok: false, error: "Invalid or expired code" }, 400);
    // Accept numeric strings; compare exact digits
    if (String(rec.code) !== String(otp)) return json({ ok: false, error: "Invalid code" }, 400);
    if (rec.exp && nowSec() > Number(rec.exp)) return json({ ok: false, error: "Code expired" }, 400);

    // One-time use: delete on success
    await env.ONBOARD_KV.delete(key);

    return json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}