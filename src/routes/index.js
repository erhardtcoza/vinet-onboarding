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
