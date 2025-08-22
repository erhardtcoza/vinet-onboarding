// src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const nowSec = () => Math.floor(Date.now() / 1000);
const rand6  = () => String(Math.floor(100000 + Math.random() * 900000));

export function match(pathname, method) {
  return (
    (pathname === "/api/otp/send"   && method === "POST") ||
    (pathname === "/api/otp/verify" && method === "POST")
  );
}

export async function handle(request, env) {
  const url  = new URL(request.url);
  const path = url.pathname;

  // -------- SEND WA OTP --------
  if (path === "/api/otp/send" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const linkid = (body.linkid || "").trim();
    if (!linkid) return json({ ok:false, error:"Missing linkid" }, 400);

    // Generate and persist 10‑minute OTP
    const code = rand6();
    const ttl  = 60 * 10;
    const record = { code, exp: nowSec() + ttl, created: Date.now(), kind: "wa" };
    await env.ONBOARD_KV.put(`otp:wa:${linkid}`, JSON.stringify(record), { expirationTtl: ttl });

    // Try to get phone if not provided
    let msisdn = (body.msisdn || "").replace(/\D+/g, "");
    if (!msisdn) {
      try {
        const splynxId = String(linkid).split("_")[0];
        const ms = await fetchCustomerMsisdn(env, splynxId);
        const guess = (ms?.phone || ms?.phones?.[0]?.phone || "").replace(/\D+/g, "");
        if (guess) msisdn = guess;
      } catch (e) {
        // ignore; we still saved the code so it can be used manually
      }
    }

    // Try to send via WhatsApp template (best‑effort)
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
                { type: "body", parameters: [{ type: "text", text: code }] }
              ]
            }
          }),
        });
      } catch (e) {
        console.log("WA send failed:", (e && e.message) || String(e));
      }
    }

    return json({ ok:true });
  }

  // -------- VERIFY (WA or STAFF) --------
  if (path === "/api/otp/verify" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const linkid = (body.linkid || "").trim();
    const otp    = (body.otp    || "").trim();
    const kind   = (body.kind   || "wa").toLowerCase(); // "wa" | "staff"

    if (!linkid || !otp) return json({ ok:false, error:"Missing linkid/otp" }, 400);

    const key = kind === "staff" ? `staff:${linkid}` : `otp:wa:${linkid}`;
    const rec = await env.ONBOARD_KV.get(key, "json");

    if (!rec || !rec.code)                    return json({ ok:false, error:"Invalid or expired code" }, 400);
    if (String(rec.code) !== String(otp))     return json({ ok:false, error:"Invalid code" }, 400);
    if (rec.exp && nowSec() > Number(rec.exp))return json({ ok:false, error:"Code expired" }, 400);

    // consume
    await env.ONBOARD_KV.delete(key);
    return json({ ok:true });
  }

  return new Response("Not found", { status: 404 });
}