import { html, json } from "../utils/http.js";
import { isAllowedIP, DATE_TODAY, nowSec, normalizeMsisdn } from "../utils/misc.js";
import { ensureLeadSchema } from "../db/schema.js";
import { splynx } from "../integrations/splynx.js";
import { sendWATemplate } from "../integrations/whatsapp.js";
import { adminHTML } from "../admin/ui.js";

const WA_TEMPLATE_NAME = "wa_onboarding";
const WA_TEMPLATE_LANG = "en";

export async function handleAdmin(request, env) {
  if (!isAllowedIP(request)) return html("<h1 style='color:#e2001a'>Access Denied</h1>", 403);
  const url =
