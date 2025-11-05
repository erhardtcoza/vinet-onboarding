// /src/routes/agreements.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";
import { fetchTextCached } from "../helpers.js";

const html = (s, c = 200) =>
  new Response(s, { status: c, headers: { "content-type": "text/html; charset=utf-8" } });

export function mount(router) {
  // Signature passthroughs
  router.add("GET", "/agreements/sig/:linkid.png", async (req, env, _ctx, { linkid }) => {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess?.agreement_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  });

  router.add("GET", "/agreements/sig-debit/:linkid.png", async (req, env, _ctx, { linkid }) => {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess?.debit_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  });

  // Agreement HTML
  router.add("GET", "/agreements/:type/:linkid", async (req, env, _ctx, { type, linkid }) => {
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess?.agreement_signed) return html("Agreement not available yet.", 404);

    const esc = (s) => String(s || "").replace(/[&<>"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
    if (type === "msa") {
      const src = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:msa:html")) || "Terms unavailable.";
      return html(`<!doctype html><meta charset="utf-8"><title>Master Service Agreement</title>
<h2>Master Service Agreement</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`);
    }
    if (type === "debit") {
      const src = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:debit:html")) || "Terms unavailable.";
      return html(`<!doctype html><meta charset="utf-8"><title>Debit Order Instruction</title>
<h2>Debit Order Instruction</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`);
    }
    return html("Unknown agreement type", 400);
  });
}
