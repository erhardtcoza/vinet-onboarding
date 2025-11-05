// src/routes/index.js
import * as selfSignup from "./self-signup.js";
import * as crm from "./crm_leads.js";
import * as onboard from "./onboard.js";

// Optional APIs (provide no-op mounts to avoid build warnings if missing)
import * as apiOTP from "./api-otp.js";
import * as apiTerms from "./api-terms.js";
import * as pdfRoutes from "./pdf.js";
import * as agreementsRoutes from "./agreements.js";

export function mountAll(router) {
  router.add("ALL", "*", async (req, env, ctx, next) => {
    const host = new URL(req.url).hostname;

    if (host === "new.vinet.co.za") {
      selfSignup.mount?.(router);
    } else if (host === "crm.vinet.co.za") {
      crm.mount?.(router);
    } else if (host === "onboard.vinet.co.za") {
      onboard.mount?.(router);
    } else {
      // default: still mount common APIs so deep links work in all hosts
      selfSignup.mount?.(router);
      crm.mount?.(router);
      onboard.mount?.(router);
    }

    // Common APIs available on all hosts
    apiOTP.mount?.(router);
    apiTerms.mount?.(router);
    pdfRoutes.mount?.(router);
    agreementsRoutes.mount?.(router);

    return next();
  });
}
