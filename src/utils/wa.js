// src/utils/wa.js
export function normalizeMsisdn(s){
  let t = String(s||"").trim();
  if (t.startsWith("0")) t = "27" + t.slice(1);
  if (t.startsWith("+")) t = t.slice(1);
  return t.replace(/\D+/g, "");
}

async function postWA(env, body){
  const url = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`WA ${r.status}: ${await r.text()}`);
  return true;
}

/** Send onboarding link template
 * Template placeholders:
 *  - {{text}}  -> name
 *  - {{text2}} -> onboarding_url
 */
export async function sendOnboardingTemplate(env, msisdn_raw, name, onboardingUrl, lang="en_US") {
  const to = normalizeMsisdn(msisdn_raw);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "wa_onboarding",
      language: { code: lang },
      components: [
        { type: "body", parameters: [
          { type: "text", text: name || "there" },
          { type: "text", text: onboardingUrl }
        ]}
      ]
    }
  };
  return postWA(env, body);
}

/** Send OTP template (expects a single code param, adjust if yours differs) */
export async function sendOTP(env, msisdn_raw, code, lang="en_US") {
  const to = normalizeMsisdn(msisdn_raw);
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "vinetotp",
      language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] }
      ]
    }
  };
  return postWA(env, body);
}
