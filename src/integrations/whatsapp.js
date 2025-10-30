export async function sendWATemplate(env, msisdn, templateName, lang, nameText, urlText) {
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${env.PHONE_NUMBER_ID}/messages`, {
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
          name: templateName,
          language: { code: lang },
          components: [{
            type: "body",
            parameters: [{ type: "text", text: nameText }, { type: "text", text: urlText }],
          }],
        },
      }),
    });
    if (!r.ok) {
      console.log("WA fail", r.status, await r.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.log("WA exc:", e);
    return false;
  }
}
