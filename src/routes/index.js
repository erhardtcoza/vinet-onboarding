// src/routes/index.js
import * as publicRoutes from "./public.js";
import * as apiTerms from "./api-terms.js";
import * as apiOtp from "./api-otp.js";
import * as apiOnboard from "./api-onboard.js";
import * as pdfRoutes from "./pdf.js";
import * as agreements from "./agreements.js";
import * as admin from "./admin.js";
import * as onboard from "./onboard.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
// src/routes/index.js
import { handleSplynxApi } from "./api-splynx.js";
// ...your other imports...

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // call modules until one returns a Response
  let res = null;

  // Splynx profile API (used by onboarding step 2)
  res = await handleSplynxApi(request, env, url, path, method);
  if (res) return res;

  // ...call the rest of your route modules here in whatever order you use...
  // e.g.
  // res = await publicRoutes(request, env, url, path, method); if (res) return res;
  // res = await adminRoutes(request, env, url, path, method); if (res) return res;
  // res = await otpRoutes(request, env, url, path, method); if (res) return res;
  // res = await termsRoutes(request, env, url, path, method); if (res) return res;
  // res = await onboardApiRoutes(request, env, url, path, method); if (res) return res;
  // res = await agreementsRoutes(request, env, url, path, method); if (res) return res;
  // res = await pdfRoutes(request, env, url, path, method); if (res) return res;
  // res = await onboardPageRoute(request, env, url, path, method); if (res) return res;

  return new Response("Not found", { status: 404 });
}
  // The order matters; earlier modules get first dibs.
  const modules = [
    publicRoutes,
    apiTerms,
    apiOtp,
    apiOnboard,
    pdfRoutes,
    agreements,
    admin,
    onboard,
  ];

  for (const m of modules) {
    if (m.match && m.handle && m.match(pathname, method)) {
      return m.handle(request, env);
    }
  }

  return new Response("Not found", { status: 404 });
}
