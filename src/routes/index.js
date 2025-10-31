// /src/routes/index.js
import { Router } from "../router.js";

// Existing route modules
import * as publicRoutes from "./public.js";
import * as adminRoutes from "./admin.js";
import * as onboardRoutes from "./onboard.js";
import * as agreementsRoutes from "./agreements.js";
import * as pdfRoutes from "./pdf.js";
import * as apiOTP from "./api-otp.js";
import * as apiTerms from "./api-terms.js";

// Newly wired modules
import * as publicLeads from "./public_leads.js";
import * as crmLeads from "./crm_leads.js";

export function mountAll(router /** @type {Router} */) {
  // Public self-capture leads UI & API
  publicLeads.mount?.(router);

  // CRM Leads Admin
  crmLeads.mount?.(router);

  // OTP / Terms / PDFs / Agreements / Onboarding / Admin
  apiOTP.mount?.(router);
  apiTerms.mount?.(router);
  pdfRoutes.mount?.(router);
  agreementsRoutes.mount?.(router);
  onboardRoutes.mount?.(router);
  adminRoutes.mount?.(router);

  // Public (landing + splash + PWA + EFT)
  publicRoutes.mount?.(router);

  // Fallback 404
  router.add("ALL", "*", () => new Response("Not found", { status: 404 }));
}
