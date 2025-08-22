// src/routes/index.js
import * as publicRoutes from "./public.js";
import * as apiTerms from "./api-terms.js";
import * as apiOtp from "./api-otp.js";
import * as apiOnboard from "./api-onboard.js";
import * as pdfRoutes from "./pdf.js";
import * as agreements from "./agreements.js";
import * as admin from "./admin.js";
import * as onboard from "./onboard.js";
import { handleAdminApi } from "./api-admin.js";
import { handleSplynxApi } from "./api-splynx.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  console.log(`[router] ${method} ${path}`);

  if (path.startsWith("/api/splynx")) {
    return handleSplynxApi(request, env);
  }

  if (path.startsWith("/api/admin")) {
    return handleAdminApi(request, env);
  }

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
    if (m.match && m.handle && m.match(path, method)) {
      return m.handle(request, env);
    }
  }

  return new Response("Not found", { status: 404 });
}