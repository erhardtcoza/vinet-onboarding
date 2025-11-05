// /src/routes/pdf.js
import { renderMSAPdf } from "../pdf/msa.js";
import { renderDebitPdf } from "../pdf/debit.js";

export function mount(router) {
  router.add("GET", "/pdf/msa/:linkid", async (_req, env, _ctx, { linkid }) => renderMSAPdf(env, linkid));
  router.add("GET", "/pdf/debit/:linkid", async (_req, env, _ctx, { linkid }) => renderDebitPdf(env, linkid));
}
