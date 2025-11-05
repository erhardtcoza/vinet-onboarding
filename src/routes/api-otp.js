// /src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

async function sendTemplate(env, to, code, lang = "en") {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env.WHATSAPP_TEMPLATE_NAME || "vinetotp",
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
  if (!r.ok) throw new Error(await r.text().catch(() => `WA ${r.status}`));
}

async function sendText(env, to, body) {
  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `WA ${r.status}`));
}

export function mount(router) {
  router.add("POST", "/api/otp/send", async (req, env) => {
    const { linkid } = await req.json().catch(() => ({}));
    if (!linkid) return j({ ok: false, error: "Missing linkid" }, 400);
    if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) return j({ ok: false, error: "WA not configured" }, 500);

    const id = (linkid || "").split("_")[0];
    let msisdn = null;
    try { msisdn = await fetchCustomerMsisdn(env, id); } catch {}
    if (!msisdn) return j({ ok: false, error: "No WhatsApp number on file" }, 404);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
    await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, { expirationTtl: 600 });

    try { await sendTemplate(env, msisdn, code, "en"); return j({ ok: true }); }
    catch { try { await sendText(env, msisdn, `Your Vinet verification code is: ${code}`); return j({ ok: true, note: "sent-as-text" }); }
            catch { return j({ ok: false, error: "WA send failed (template+text)" }, 502); } }
  });

  router.add("POST", "/api/otp/verify", async (req, env) => {
    const { linkid, otp, kind } = await req.json().catch(() => ({}));
    if (!linkid || !otp) return j({ ok: false, error: "Missing params" }, 400);
    const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
    const expected = await env.ONBOARD_KV.get(key);
    const ok = !!expected && expected === otp;
    if (ok) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, otp_verified: true }), { expirationTtl: 86400 });
      if (kind === "staff") await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
    }
    return j({ ok });
  });
}
