// src/routes/agreements.js
import { DEFAULT_MSA_TERMS_URL, DEFAULT_DEBIT_TERMS_URL } from "../constants.js";
import { fetchTextCached } from "../helpers.js";

export function match(path, method) {
  if (method !== "GET") return false;
  if (path.startsWith("/agreements/sig/")) return true;
  if (path.startsWith("/agreements/sig-debit/")) return true;
  if (path.startsWith("/agreements/")) return true;
  return false;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Signature passthroughs
  if (path.startsWith("/agreements/sig/")) {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  }
  if (path.startsWith("/agreements/sig-debit/")) {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.debit_sig_key) return new Response("Not found", { status: 404 });
    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": "image/png" } });
  }

  // Agreement HTML
  if (path.startsWith("/agreements/")) {
    const [, , type, linkid] = path.split("/");
    if (!type || !linkid) return new Response("Bad request", { status: 400 });
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_signed) return new Response("Agreement not available yet.", { status: 404 });

    const esc = (s) => String(s || "").replace(/[&<>"]/g, (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[t]));
    if (type === "msa") {
      const src = env.TERMS_MSA_URL || env.TERMS_SERVICE_URL || DEFAULT_MSA_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:msa:html")) || "Terms unavailable.";
      const body = `<!doctype html><meta charset="utf-8"><title>Master Service Agreement</title>
<h2>Master Service Agreement</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (type === "debit") {
      const src = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      const text = (await fetchTextCached(src, env, "terms:debit:html")) || "Terms unavailable.";
      const body = `<!doctype html><meta charset="utf-8"><title>Debit Order Instruction</title>
<h2>Debit Order Instruction</h2><pre style="white-space:pre-wrap">${esc(text)}</pre>`;
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Unknown agreement type", { status: 400 });
  }

  return new Response("Not found", { status: 404 });
}
