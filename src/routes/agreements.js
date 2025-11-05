// /src/routes/agreements.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";
import { fetchTextCached } from "../helpers.js";

export function mount(router) {
  // Signature image passthroughs
  router.add("GET", "/agreements/sig/:linkid", async (req, env) => {
    const linkid = req.params.linkid?.replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess?.agreement_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  });

  router.add("GET", "/agreements/sig-debit/:linkid", async (req, env) => {
    const linkid = req.params.linkid?.replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess?.debit_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  });

  // Terms (HTML viewers)
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));

  router.add("GET", "/agreements/msa/:linkid", async (_req, env) => {
    const src = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
    const text = (await fetchTextCached(src, env, "terms:msa:html")) || "Terms unavailable.";
    const body = `<!doctype html><meta charset="utf-8"><title>Master Service Agreement</title>
<h2>Master Service Agreement</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`;
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  });

  router.add("GET", "/agreements/debit/:linkid", async (_req, env) => {
    const src = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
    const text = (await fetchTextCached(src, env, "terms:debit:html")) || "Terms unavailable.";
    const body = `<!doctype html><meta charset="utf-8"><title>Debit Order Instruction</title>
<h2>Debit Order Instruction</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`;
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  });
}
