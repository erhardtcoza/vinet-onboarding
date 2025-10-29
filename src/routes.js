import { handlePublicRoutes } from "./router-public.js";
import { handleAdminRoutes } from "./router-admin.js";
import { handleOnboardingRoutes } from "./router-onboarding.js";
import { handleAssetRoutes } from "./router-assets.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Try each sub-router in order.
  // First match that returns a Response wins.

  let res;

  res = await handleAdminRoutes({ path, method, url, env, request });
  if (res) return res;

  res = await handleOnboardingRoutes({ path, method, url, env, request });
  if (res) return res;

  res = await handleAssetRoutes({ path, method, url, env, request });
  if (res) return res;

  res = await handlePublicRoutes({ path, method, url, env, request });
  if (res) return res;

  // fallback
  return new Response("Not found", { status: 404 });
}
