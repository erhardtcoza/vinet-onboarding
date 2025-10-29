// src/router-assets.js

export async function handleAssetRoutes({ path, method, env }) {
  // /agreements/sig/<linkid>.png
  if (path.startsWith("/agreements/sig/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_sig_key)
      return new Response("Not found", { status: 404 });

    const obj = await env.R2_UPLOADS.get(sess.agreement_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });

    return new Response(obj.body, {
      headers: { "content-type": "image/png" },
    });
  }

  // /agreements/sig-debit/<linkid>.png
  if (path.startsWith("/agreements/sig-debit/") && method === "GET") {
    const linkid = (path.split("/").pop() || "").replace(/\.png$/i, "");
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.debit_sig_key)
      return new Response("Not found", { status: 404 });

    const obj = await env.R2_UPLOADS.get(sess.debit_sig_key);
    if (!obj) return new Response("Not found", { status: 404 });

    return new Response(obj.body, {
      headers: { "content-type": "image/png" },
    });
  }

  return null;
}
