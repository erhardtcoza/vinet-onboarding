// /src/routes/index.js
import { Router } from "../router.js";

// Route modules
import * as publicRoutes from "./public.js";
import * as adminRoutes from "./admin.js";
import * as onboardRoutes from "./onboard.js";
import * as agreementsRoutes from "./agreements.js";
import * as pdfRoutes from "./pdf.js";
import * as apiOTP from "./api-otp.js";
import * as apiTerms from "./api-terms.js";
import * as publicLeads from "./public_leads.js";
import * as crmLeads from "./crm_leads.js";

// Mount every module (each one internally checks path/host where needed)
export function mountAll(router /** @type {Router} */) {
  // Public (Turnstile splash + landing + self-signup)
  publicRoutes.mount?.(router);
  publicLeads.mount?.(router);

  // CRM (admin queue, match, submit, WA, etc.)
  adminRoutes.mount?.(router);
  crmLeads.mount?.(router);

  // Onboarding app (list + per-link UI)
  onboardRoutes.mount?.(router);

  // Agreements / PDFs / OTP / Terms
  agreementsRoutes.mount?.(router);
  pdfRoutes.mount?.(router);
  apiOTP.mount?.(router);
  apiTerms.mount?.(router);

  // Last-chance 404 (HTML so Safari never “downloads”)
  router.add("ALL", "*", () =>
    new Response(
      "<!doctype html><meta charset='utf-8'><title>Not found</title><p style='font-family:system-ui'>Not found.</p>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    )
  );
}
