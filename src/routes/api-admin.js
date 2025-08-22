// src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export function match(path, method) {
  return method === "POST" && (path === "/api/otp/send" || path === "/api/otp/verify");
}

function formatMsisdn(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\D+/g, "");
  // SA: if it starts with 0, convert to 27…
  if (s.startsWith("0")) s = "27" + s.slice(1);
  if (s.startsWith("27") && s.length === 11) return s;
  // already intl like 2771...
  if (/^27\d{9}$/.test(s)) return s;
  return "";
}

async function sendWhatsAppTemplate(env, msisdn, code) {
  // Meta WA template send
  const id = env.PHONE_NUMBER_ID;
  const token = env.WHATSAPP_TOKEN;
  const name = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
  const lang = (env.WHATSAPP_TEMPLATE_LANG || "en_US");

  const url = `https://graph.facebook.com/v20.0/${id}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: msisdn,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        ...(env.WHATSAPP_BUTTON_URL ? [{
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }]
        }] : [])
      ]
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`WA send failed ${res.status}: ${txt}`);
  }
}

async function getSessionPhone(env, linkid) {
  // Try the KV session first (if UI captured/edited)
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  const raw = sess?.edits?.phone || sess?.phone || "";
  const msisdn1 = formatMsisdn(raw);
  if (msisdn1) return msisdn1;

  // Fallback: read Splynx customer/lead
  const id = (linkid || "").split("_")[0];
  try {
    const data = await fetchCustomerMsisdn(env, id);
    const num =
      data?.phone ||
      data?.msisdn ||
      (Array.isArray(data?.phones) ? data.phones.find(p => p?.phone)?.phone : "") ||
      (Array.isArray(data) ? (data.find(x => x?.phone)?.phone || "") : "");
    const msisdn2 = formatMsisdn(num);
    if (msisdn2) return msisdn2;
  } catch (_) {}
  return "";
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/otp/send" && request.method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return j({ ok: false, error: "Missing linkid" }, 400);

    const to = await getSessionPhone(env, linkid);
    if (!to) return j({ ok: false, error: "No valid phone number on file" }, 400);

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Save OTP (5 minutes)
    await env.ONBOARD_KV.put(`otp:${linkid}`, JSON.stringify({ code, ts: Date.now() }), { expirationTtl: 300 });

    try {
      await sendWhatsAppTemplate(env, to, code);
      console.log(`[otp] sent to ${to} for ${linkid}`);
      return j({ ok: true });
    } catch (err) {
      console.log(`[otp] whatsapp send failed: ${err?.message || err}`);
      return j({ ok: false, error: "Failed to send via WhatsApp" }, 500);
    }
  }

  if (path === "/api/otp/verify" && request.method === "POST") {
    const { linkid, otp, kind } = await request.json().catch(() => ({}));
    if (!linkid || !otp) return j({ ok: false, error: "Missing linkid/otp" }, 400);

    const val = await env.ONBOARD_KV.get(`otp:${linkid}`, "json");
    if (!val || String(val.code) !== String(otp)) return j({ ok: false, error: "Invalid code" }, 400);

    // Mark verified in session
    const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const now = Date.now();
    const verified = {
      ...(sess.verified || {}),
      [kind || "wa"]: { ts: now }
    };
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify({ ...sess, verified, updated: now }), { expirationTtl: 86400 });

    return j({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}