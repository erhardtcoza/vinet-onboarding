// /src/routes/index.js
import { Router } from "../router.js";

// Existing route modules (already in your repo)
import * as publicRoutes from "./public.js";
import * as adminRoutes from "./admin.js";
import * as onboardRoutes from "./onboard.js";
import * as agreementsRoutes from "./agreements.js";
import * as pdfRoutes from "./pdf.js";
import * as apiOTP from "./api-otp.js";
import * as apiTerms from "./api-terms.js";

// ✅ Newly wired modules (already present in your repo but not mounted)
import * as publicLeads from "./public_leads.js";
import * as crmLeads from "./crm_leads.js";

export function mountAll(router /** @type {Router} */) {
  // --- Order matters: mount more specific paths first where needed ---

  // Public self-capture leads UI & API
  // (/lead, /api/leads/submit, etc.)
  publicLeads.mount?.(router);

  // CRM Leads Admin (list, match, sync, export)
  // (/crm, /api/leads/* for admin)
  crmLeads.mount?.(router);

  // OTP / Terms / PDFs / Agreements / Onboarding / Admin
  apiOTP.mount?.(router);
  apiTerms.mount?.(router);
  pdfRoutes.mount?.(router);
  agreementsRoutes.mount?.(router);
  onboardRoutes.mount?.(router);

  // Public “misc” (EFT info + PWA endpoints + root admin gate as before)
  publicRoutes.mount?.(router);

  // Fallback 404 (optional)
  router.add("ALL", "*", (_req) =>
    new Response("Not found", { status: 404 })
  );
}
