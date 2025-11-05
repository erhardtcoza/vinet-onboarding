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
  // Decide what to mount by hostname
  router.add("ALL", "*", async (req, env, ctx, next) => {
    const host = new URL(req.url).hostname.toLowerCase();

    if (host === "new.vinet.co.za") {
      // Public self-signup
      publicRoutes.mount?.(router);
      publicLeads.mount?.(router);

      // Shared APIs
      apiOTP.mount?.(router);
      apiTerms.mount?.(router);
      pdfRoutes.mount?.(router);
      agreementsRoutes.mount?.(router);
    } else if (host === "crm.vinet.co.za") {
      // CRM intake dashboard
      crmLeads.mount?.(router);
      adminRoutes.mount?.(router);

      // Shared APIs
      apiOTP.mount?.(router);
      apiTerms.mount?.(router);
      pdfRoutes.mount?.(router);
      agreementsRoutes.mount?.(router);
    } else if (host === "onboard.vinet.co.za") {
      // Onboarding links + flow
      onboardRoutes.mount?.(router);

      // Shared APIs
      apiOTP.mount?.(router);
      apiTerms.mount?.(router);
      pdfRoutes.mount?.(router);
      agreementsRoutes.mount?.(router);
    } else {
      // Fallback: behave like public
      publicRoutes.mount?.(router);
      publicLeads.mount?.(router);
      apiOTP.mount?.(router);
      apiTerms.mount?.(router);
      pdfRoutes.mount?.(router);
      agreementsRoutes.mount?.(router);
    }

    return next();
  });

  // Final 404 with explicit content-type (prevents Safari “download”)
  router.add(
    "ALL",
    "*",
    () =>
      new Response(
        "<!doctype html><meta charset='utf-8'><title>Not found</title><p>Not found</p>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
      )
  );
}
