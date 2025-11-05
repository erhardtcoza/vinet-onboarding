// /src/routes/api-terms.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";

export function mount(router) {
  router.add("GET", "/api/terms/msa", async (_req, env) => {
    const url = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
    const r = await fetch(url); const t = await r.text().catch(() => "");
    return new Response(JSON.stringify({ ok:true, text:t }), { headers:{ "content-type":"application/json" } });
  });
  router.add("GET", "/api/terms/debit", async (_req, env) => {
    const url = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
    const r = await fetch(url); const t = await r.text().catch(() => "");
    return new Response(JSON.stringify({ ok:true, text:t }), { headers:{ "content-type":"application/json" } });
  });
}
