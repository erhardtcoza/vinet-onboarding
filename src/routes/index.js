// src/routes/index.js
import * as admin from "./admin.js";
import * as otp from "./api-otp.js";
import * as onboard from "./api-onboard.js";
import * as terms from "./api-terms.js";
import * as pdf from "./pdf.js";
import * as agreements from "./agreements.js";
import * as publicPages from "./public.js";
import * as onboardPage from "./onboard.js";

export async function route(request, env) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  const method = request.method;

  // Order matters (more specific first)
  if (pathname === "/" && method === "GET") return publicPages.dashboard(request, env);
  if (pathname === "/info/eft" && method === "GET") return publicPages.eft(request, env);

  if (pathname === "/api/terms" && method === "GET") return terms.get(request, env);

  if (pathname === "/api/otp/send" && method === "POST") return otp.send(request, env);
  if (pathname === "/api/otp/verify" && method === "POST") return otp.verify(request, env);

  if (pathname.startsWith("/api/onboard/upload") && method === "POST") return onboard.upload(request, env);
  if (pathname.startsWith("/api/progress/") && method === "POST") return onboard.saveProgress(request, env);

  if (pathname === "/api/admin/genlink" && method === "POST") return admin.genlink(request, env);
  if (pathname === "/api/staff/gen" && method === "POST") return admin.staffGen(request, env);
  if (pathname === "/api/admin/list" && method === "GET") return admin.list(request, env);
  if (pathname === "/admin/review" && method === "GET") return admin.reviewPage(request, env);
  if (pathname === "/api/admin/approve" && method === "POST") return admin.approve(request, env);
  if (pathname === "/api/admin/reject" && method === "POST") return admin.reject(request, env);
  if (pathname === "/api/admin/delete" && method === "POST") return admin.del(request, env);

  if (pathname.startsWith("/agreements/sig-debit/") && method === "GET") return agreements.sigDebit(request, env);
  if (pathname.startsWith("/agreements/sig/") && method === "GET") return agreements.sigMsa(request, env);
  if (pathname.startsWith("/agreements/") && method === "GET") return agreements.html(request, env);

  if (pathname.startsWith("/pdf/msa/") && method === "GET") return pdf.msa(request, env);
  if (pathname.startsWith("/pdf/debit/") && method === "GET") return pdf.debit(request, env);

  if (pathname.startsWith("/onboard/") && method === "GET") return onboardPage.page(request, env);

  return new Response("Not found", { status: 404 });
}
