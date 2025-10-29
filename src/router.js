// src/router.js
import { handleAdminRoutes } from "./router-admin.js";
import { handleOnboardingRoutes } from "./router-onboarding.js";
import { handleAssetRoutes } from "./router-assets.js";
import { handlePublicRoutes } from "./router-public.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Try each sub-router in order.
  // First one to return a Response wins.
  // Admin first (since / is admin dashboard)
  {
    const res = await handleAdminRoutes({
      path,
      method,
      url,
      env,
      request,
    });
    if (res) return res;
  }

  // Onboarding API (OTP, upload, etc)
  {
    const res = await handleOnboardingRoutes({
      path,
      method,
      url,
      env,
      request,
    });
    if (res) return res;
  }

  // Binary assets like signatures
  {
    const res = await handleAssetRoutes({
      path,
      method,
      url,
      env,
      request,
    });
    if (res) return res;
  }

  // Public pages / PDFs / terms
  {
    const res = await handlePublicRoutes({
      path,
      method,
      url,
      env,
      request,
    });
    if (res) return res;
  }

  // nothing matched
  return new Response("Not found", { status: 404 });
}
