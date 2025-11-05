// /src/routes/api-terms.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";
import { fetchTextCached } from "../helpers.js";

export function mount(router) {
  router.add("GET", "/api/terms/:type", async (_req, env, _ctx, { type }) => {
    const key = type === "debit" ? "terms:debit:txt" : "terms:msa:txt";
    const src =
      type === "debit"
        ? (env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL)
        : (env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL);
    const text = (await fetchTextCached(src, env, key)) || "";
    return new Response(JSON.stringify({ ok: true, text }), { headers: { "content-type": "application/json" } });
  });
}
