// src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}

export function match(path, method) {
  return (path === "/api/otp/send" || path === "/api/otp/verify") && method === "POST";
}

async function sendWhatsAppTemplate(env, toMsisdn, code, lang = "en") {
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
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code.slice(-6) }] },
      ],
    },
  };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA template send failed ${r.status} ${await r.text().catch(() => "")}`);
}

async function sendWhatsAppTextIfSessionOpen(env, toMsisdn, bodyText) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to: toMsisdn, type: "text", text: { body: bodyText } };
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`WA text send failed ${r.status} ${await r.text().catch(() => "")}`);
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // /api/otp/send
  if (path === "/api/otp/send") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) {
      return json({ ok: false, error: "WhatsApp credentials not configured" }, 500);
    }
    const splynxId = (linkid || "").split("_")[0];
    let msisdn = null;
    try {
      msisdn = await fetchCustomerMsisdn(env, splynxId);
    } catch {
      return json({ ok: false, error: "Splynx lookup failed" }, 502);
    }
    if (!msisdn) return json({ ok: false, error: "No WhatsApp number on file" }, 404);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
    await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

    try {
      await sendWhatsAppTemplate(env, msisdn, code, "en");
      return json({ ok: true });
    } catch {
      try {
        await sendWhatsAppTextIfSessionOpen(env, msisdn, `Your Vinet verification code is: ${code}`);
        return json({ ok: true, note: "sent-as-text" });
      } catch {
        return json({ ok: false, error: "WhatsApp send failed (template+text)" }, 502);
      }
    }
  }

  // /api/otp/verify
  if (path === "/api/otp/verify") {
    const { linkid, otp, kind } = await request.json().catch(() => ({}));
    if (!linkid || !otp) return json({ ok: false, error: "Missing params" }, 400);
    const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
    const expected = await env.ONBOARD_KV.get(key);
    const ok = !!expected && expected === otp;
    if (ok) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({ ...sess, otp_verified: true }),
          { expirationTtl: 86400 }
        );
      }
      if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
    }
    return json({ ok });
  }

  return new Response("Not found", { status: 404 });
}
export function mount(router) {
  router.add("POST", "/api/otp/send", (req, env) => handle(req, env));
  router.add("POST", "/api/otp/verify", (req, env) => handle(req, env));
}
