// src/routes/api-otp.js
import { fetchCustomerMsisdn } from "../splynx.js";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export function match(path, method) {
  return method === "POST" && (path === "/api/otp/send" || path === "/api/otp/verify");
}

/* ---------------- helpers ---------------- */

function formatMsisdn(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\D+/g, "");
  // SA: 0XXXXXXXXX -> 27XXXXXXXXX
  if (s.startsWith("0")) s = "27" + s.slice(1);
  // already 27 + 9 digits?
  if (/^27\d{9}$/.test(s)) return s;
  return "";
}

async function whatsappTemplateSend(env, to, code) {
  // Graph API send (template)
  const phoneId = env.PHONE_NUMBER_ID;
  const token   = env.WHATSAPP_TOKEN;
  const name    = env.WHATSAPP_TEMPLATE_NAME || "vinetotp";
  const lang    = env.WHATSAPP_TEMPLATE_LANG || "en_US";

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] }
      ]
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`WA ${res.status}: ${t}`);
  }
}

/* Try to get phone from the active session, else from Splynx */
async function getPhoneForLink(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  const fromSess = formatMsisdn(sess?.edits?.phone || sess?.phone || "");
  if (fromSess) return fromSess;

  const id = (linkid || "").split("_")[0];
  try {
    const data = await fetchCustomerMsisdn(env, id);
    const found =
      data?.phone ||
      data?.msisdn ||
      (Array.isArray(data?.phones) ? (data.phones.find(p => p?.phone)?.phone || "") : "") ||
      (Array.isArray(data) ? (data.find(x => x?.phone)?.phone || "") : "");
    const fromSplynx = formatMsisdn(found);
    if (fromSplynx) return fromSplynx;
  } catch (_) {}
  return "";
}

/* ---------------- handler ---------------- */

export async function handle(request, env) {
  const { pathname } = new URL(request.url);

  // SEND
  if (pathname === "/api/otp/send" && request.method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const to = await getPhoneForLink(env, linkid);
    if (!to) return json({ ok: false, error: "No valid phone on file" }, 400);

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await env.ONBOARD_KV.put(
      `otp:${linkid}`,
      JSON.stringify({ code, ts: Date.now() }),
      { expirationTtl: 300 } // 5 minutes
    );

    try {
      await whatsappTemplateSend(env, to, code);
      console.log(`[otp] sent to ${to} for ${linkid}`);
      return json({ ok: true });
    } catch (err) {
      console.log(`[otp] send failed for ${linkid}: ${err?.message || err}`);
      return json({ ok: false, error: "Failed to send" }, 500);
    }
  }

  // VERIFY
  if (pathname === "/api/otp/verify" && request.method === "POST") {
    const { linkid, otp, kind } = await request.json().catch(() => ({}));
    if (!linkid || !otp) return json({ ok: false, error: "Missing linkid/otp" }, 400);

    const rec = await env.ONBOARD_KV.get(`otp:${linkid}`, "json");
    if (!rec || String(rec.code) !== String(otp)) return json({ ok: false, error: "Invalid code" }, 400);

    // mark verified in session
    const sess = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const verified = { ...(sess.verified || {}), [kind || "wa"]: { ts: Date.now() } };
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, verified, updated: Date.now() }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}