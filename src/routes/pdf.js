// src/routes/pdf.js
import { renderMSAPdf } from "../pdf/msa.js";
import { renderDebitPdf } from "../pdf/debit.js";

/* ---------- NEW: router-based wiring (preferred) ---------- */
export function mount(router) {
  router.add("GET", "/pdf/msa/:linkid", async (req, env) => {
    const linkid = req.params.linkid;
    return await renderMSAPdf(env, linkid);
  });

  router.add("GET", "/pdf/debit/:linkid", async (req, env) => {
    const linkid = req.params.linkid;
    return await renderDebitPdf(env, linkid);
  });
}

/* ---------- LEGACY: keep existing match/handle working ---------- */
export function match(path, method) {
  if (method !== "GET") return false;
  if (path.startsWith("/pdf/msa/")) return true;
  if (path.startsWith("/pdf/debit/")) return true;
  return false;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/pdf/msa/")) {
    const linkid = path.split("/").pop();
    return await renderMSAPdf(env, linkid);
  }
  if (path.startsWith("/pdf/debit/")) {
    const linkid = path.split("/").pop();
    return await renderDebitPdf(env, linkid);
  }
  return new Response("Not found", { status: 404 });
}
