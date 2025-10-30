// src/integrations/whatsapp.js

/**
 * Send a WhatsApp template message via Meta Graph API.
 * Expects env vars:
 *  - WHATSAPP_TOKEN        (Bearer token)
 *  - PHONE_NUMBER_ID       (e.g. "104043025887306")
 *
 * Usage:
 *   await sendWATemplate(env, "+2772xxxxxxx", "wa_onboarding", "en", name, url);
 */
export async function sendWATemplate(env, to, templateName, lang = "en_US", ...bodyParams) {
  const token = env?.WHATSAPP_TOKEN || env?.WA_TOKEN || "";
  const phoneNumberId = env?.PHONE_NUMBER_ID || env?.WA_PHONE_NUMBER_ID || "";

  if (!token || !phoneNumberId) {
    // Fail fast but don't crash the worker
    return false;
  }

  // Normalise language (support "en" -> "en_US" default)
  const langCode = normaliseLang(lang);

  // Build body parameters array for the template
  const parameters = (bodyParams || [])
    .filter((v) => v != null && v !== "")
    .map((v) => ({ type: "text", text: String(v) }));

  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: templateName,
      language: { code: langCode },
      ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}),
    },
  };

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  // Consider 2xx as success
  if (r.ok) return true;

  // Soft-fail with console for debugging in tail/logs
  try {
    const t = await r.text();
    console.error("WA template send failed:", r.status, t);
  } catch {
    console.error("WA template send failed:", r.status);
  }
  return false;
}

function normaliseLang(input) {
  const s = String(input || "").trim();
  if (!s) return "en_US";
  if (s.includes("_")) return s;          // e.g. "en_US", "af_ZA"
  if (s.length === 2) {
    // Best-effort mapping
    const upper = s.toUpperCase();
    if (s === "en") return "en_US";
    if (s === "af") return "af_ZA";
    return `${s}_${upper}`;
  }
  return s;
}
