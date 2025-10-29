// src/routes/api-terms.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";

export function match(path, method) {
  return path === "/api/terms" && method === "GET";
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") || "").toLowerCase();
  const svcUrl = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
  const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;

  async function getText(u) {
    try {
      const r = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 300 } });
      return r.ok ? await r.text() : "";
    } catch {
      return "";
    }
  }
  const esc = (s) => s.replace(/[&<>]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
  const service = esc((await getText(svcUrl)) || "");
  const debit = esc((await getText(debUrl)) || "");

  const body =
    kind === "debit"
      ? `<h3>Debit Order Terms</h3><pre style="white-space:pre-wrap">${debit}</pre>`
      : `<h3>Service Terms</h3><pre style="white-space:pre-wrap">${service}</pre>`;

  return new Response(body || "<p>Terms unavailable.</p>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
