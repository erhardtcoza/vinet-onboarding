// src/routes/pdf.js
import { renderMSAPdf } from "../pdf/msa.js";
import { renderDebitPdf } from "../pdf/debit.js";

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
