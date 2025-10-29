// src/router-public.js
import {
  DEFAULT_MSA_TERMS_URL,
  DEFAULT_DEBIT_TERMS_URL,
} from "./constants.js";
import { renderOnboardHTMLShell } from "./ui/onboard.js";
import { fetchTextCached } from "./helpers.js";
import { renderMSAPdf } from "./pdf/msa.js";
import { renderDebitPdf } from "./pdf/debit.js";

export async function handlePublicRoutes({ path, method, url, env }) {
  // onboarding shell HTML
  if (path.startsWith("/onboard/") && method === "GET") {
    const linkid = path.split("/")[2] || "";
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess)
      return new Response("Link expired or invalid", {
        status: 404,
      });

    const siteKey = env.TURNSTILE_SITE_KEY || "";
    return new Response(renderOnboardHTMLShell({ linkid, siteKey }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // onboarding front-end bundle (served from KV)
  if (path === "/onboard-app.js" && method === "GET") {
    const js = await env.ONBOARD_KV.get("static/onboard-app.js");
    if (!js) {
      return new Response("// not found", {
        status: 404,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
        },
      });
    }
    return new Response(js, {
      headers: {
        "content-type":
          "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  }

  // EFT printable helper
  if (path === "/info/eft" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    const LOGO_URL_LOCAL =
      "https://static.vinet.co.za/Vinet%20Logo%20Png_Full%20Logo.png";

    const escapeHtml = (s) =>
      String(s || "").replace(/[&<>"]/g, (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        }[m])
      );

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EFT Payment Details</title>
<style>
body{font-family:Arial,sans-serif;background:#f7f7fa}
.container{max-width:900px;margin:40px auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.06)}
h1{color:#e2001a;font-size:34px;margin:8px 0 18px}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.grid .full{grid-column:1 / -1}
label{font-weight:700;color:#333;font-size:14px}
input{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ddd;border-radius:8px;background:#fafafa}
button{background:#e2001a;color:#fff;padding:12px 18px;border:none;border-radius:10px;cursor:pointer;width:100%;font-weight:700}
.note{font-size:13px;color:#555}
.logo{display:block;margin:0 auto 8px;height:68px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="container">
  <img src="${LOGO_URL_LOCAL}" class="logo" alt="Vinet">
  <h1>EFT Payment Details</h1>
  <div class="grid">
    <div><label>Bank</label><input readonly value="First National Bank (FNB/RMB)"></div>
    <div><label>Account Name</label><input readonly value="Vinet Internet Solutions"></div>
    <div><label>Account Number</label><input readonly value="62757054996"></div>
    <div><label>Branch Code</label><input readonly value="250655"></div>
    <div class="full"><label style="font-weight:900">Reference</label><input style="font-weight:900" readonly value="${escapeHtml(
      id || ""
    )}"></div>
  </div>
  <p class="note" style="margin-top:16px">Please remember that all accounts are payable on or before the 1st of every month.</p>
  <div style="margin-top:14px"><button onclick="window.print()">Print</button></div>
</div>
</body></html>`;

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Terms proxy (MSA + Debit)
  if (path === "/api/terms" && method === "GET") {
    const kind = (url.searchParams.get("kind") || "").toLowerCase();

    const svcUrl =
      env.TERMS_MSA_URL ||
      env.TERMS_SERVICE_URL ||
      DEFAULT_MSA_TERMS_URL;
    const debUrl = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;

    async function getText(u) {
      try {
        const r = await fetch(u, {
          cf: { cacheEverything: true, cacheTtl: 300 },
        });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    }

    const esc = (s) =>
      s.replace(/[&<>"]/g, (t) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        }[t])
      );

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

  // Agreement "view in browser" (terms-only view)
  if (path.startsWith("/agreements/") && method === "GET") {
    // /agreements/<type>/<linkid>
    const [, , type, linkid] = path.split("/");
    if (!type || !linkid)
      return new Response("Bad request", { status: 400 });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess || !sess.agreement_signed)
      return new Response("Agreement not available yet.", {
        status: 404,
      });

    const esc = (s) =>
      String(s || "").replace(/[&<>"]/g, (t) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        }[t])
      );

    if (type === "msa") {
      const src =
        env.TERMS_MSA_URL ||
        env.TERMS_SERVICE_URL ||
        DEFAULT_MSA_TERMS_URL;
      const text =
        (await fetchTextCached(src, env, "terms:msa:html")) ||
        "Terms unavailable.";

      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Master Service Agreement</title><h2>Master Service Agreement</h2><pre style="white-space:pre-wrap">${esc(
          text
        )}</pre>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    if (type === "debit") {
      const src = env.TERMS_DEBIT_URL || DEFAULT_DEBIT_TERMS_URL;
      const text =
        (await fetchTextCached(
          src,
          env,
          "terms:debit:html"
        )) || "Terms unavailable.";

      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Debit Order Instruction</title><h2>Debit Order Instruction</h2><pre style="white-space:pre-wrap">${esc(
          text
        )}</pre>`,
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    return new Response("Unknown agreement type", {
      status: 400,
    });
  }

  // PDF output
  if (path.startsWith("/pdf/msa/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderMSAPdf(env, linkid);
  }

  if (path.startsWith("/pdf/debit/") && method === "GET") {
    const linkid = path.split("/").pop();
    return await renderDebitPdf(env, linkid);
  }

  // not handled in public layer
  return null;
}
