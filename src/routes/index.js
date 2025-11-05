// /src/routes/index.js
import { Router } from "../router.js";

// Route modules (each must export `mount(router)`)
import * as publicRoutes from "./public.js";
import * as adminRoutes from "./admin.js";
import * as onboardRoutes from "./onboard.js";
import * as agreementsRoutes from "./agreements.js";
import * as pdfRoutes from "./pdf.js";
import * as apiOTP from "./api-otp.js";
import * as apiTerms from "./api-terms.js";
import * as publicLeads from "./public_leads.js";
import * as crmLeads from "./crm_leads.js";

export function mountAll(router /** @type {Router} */) {
  // Public self-signup + general pages
  publicRoutes.mount?.(router);
  publicLeads.mount?.(router);

  // CRM / Admin (queue, match, submit, WA, etc.)
  crmLeads.mount?.(router);
  adminRoutes.mount?.(router);

  // Onboarding flow + static agreement viewers
  onboardRoutes.mount?.(router);
  agreementsRoutes.mount?.(router);

  // PDFs + Utility APIs (OTP, Terms)
  pdfRoutes.mount?.(router);
  apiOTP.mount?.(router);
  apiTerms.mount?.(router);

  // Fallback
  router.add("ALL", "*", () => new Response("Not found", { status: 404 }));
}
