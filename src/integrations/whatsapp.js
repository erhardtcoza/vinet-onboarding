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

// Temp WA template sender (no-op success). Replace with real Cloud API later.
export async function sendWATemplate(_env, _msisdn, _tplName, _lang, _name, _urlText) {
  // You can log here if needed.
  return true; // pretend success for now
}
