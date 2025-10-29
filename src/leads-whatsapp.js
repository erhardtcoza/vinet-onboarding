// src/leads-whatsapp.js
export async function sendOnboardingInvite(env, msisdn, name, url) {
  if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID)
    throw new Error("WhatsApp not configured");

  const endpoint = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: msisdn.replace(/\D/g, ""), // digits only
    type: "template",
    template: {
      name: "wa_onboarding",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: name || "Customer" },
            { type: "text", text: url },
          ],
        },
      ],
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp send failed: ${err}`);
  }
  return true;
}
