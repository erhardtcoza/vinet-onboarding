// WhatsApp helpers (two parameters required by your template)
export function normalizeMsisdn(s){
  let t = String(s||"").trim();
  if (t.startsWith("0")) t = "27" + t.slice(1);
  if (t.startsWith("+")) t = t.slice(1);
  return t.replace(/\D+/g, "");
}

const WA_TEMPLATE_NAME = "wa_onboarding";
const WA_TEMPLATE_LANG = "en_US"; // change to 'af' if needed

export async function sendOnboardingWA(env, msisdn, name, onboardingUrl){
  try {
    const url = `https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: msisdn,
      type: "template",
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          { type:"body", parameters: [
            { type:"text", text: name },           // {{text}} Name
            { type:"text", text: onboardingUrl }   // {{text2}} onboarding_url
          ]}
        ]
      }
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      console.log("WA error:", r.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.log("WA exc:", String(e));
    return false;
  }
}
