// src/utils/wa.js
import { WA_TEMPLATE_NAME, WA_TEMPLATE_LANG } from "../constants.js";

export async function sendOnboardingTemplate(env, msisdn, name, onboardingUrl) {
  // normalise msisdn
  let t = String(msisdn || "").trim();
  if (t.startsWith("0")) t = "27" + t.slice(1);
  if (t.startsWith("+")) t = t.slice(1);
  t = t.replace(/\D+/g, "");

  const url = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: t,
    type: "template",
    template: {
      name: WA_TEMPLATE_NAME,
      language: { code: WA_TEMPLATE_LANG },
      components: [
        { type: "body", parameters: [
          { type: "text", text: name || "there" },        // {{text}}
          { type: "text", text: onboardingUrl || "" }     // {{text2}}
        ] }
      ]
    }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`WA ${r.status}: ${await r.text().catch(()=> "")}`);
  return true;
}
