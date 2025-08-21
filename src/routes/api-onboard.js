// src/routes/api-onboard.js

import { getClientMeta } from "../helpers.js";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export function match(pathname, method) {
  if (method !== "POST") return false;

  return (
    pathname.startsWith("/api/progress/") ||
    pathname === "/api/onboard/upload" ||
    pathname === "/api/debit/save" ||
    pathname === "/api/debit/sign" ||
    pathname === "/api/sign"
  );
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const getIP = () =>
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  const getUA = () => request.headers.get("user-agent") || "";

  // --- Save progress (and capture audit meta once) ---
  if (path.startsWith("/api/progress/") && method === "POST") {
    const linkid = path.split("/")[3];
    const body = await request.json().catch(() => ({}));
    const existing = (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};
    const next = {
      ...existing,
      ...body,
      last_ip: getIP(),
      last_ua: getUA(),
      last_time: Date.now(),
      audit_meta: existing.audit_meta || getClientMeta(request),
    };
    await env.ONBOARD_KV.put(`onboard/${linkid}`, JSON.stringify(next), { expirationTtl: 86400 });
    return json({ ok: true });
  }

  // --- Upload a supporting file (R2) ---
  if (path === "/api/onboard/upload" && method === "POST") {
    const params = new URL(request.url).searchParams;
    const linkid = params.get("linkid");
    const fileName = params.get("filename") || "file.bin";
    const label = params.get("label") || "";

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Invalid link", { status: 404 });

    const body = await request.arrayBuffer();
    const key = `uploads/${linkid}/${Date.now()}_${fileName.replace(/[^a-z0-9_.-]/gi, "_")}`;

    await env.R2_UPLOADS.put(key, body);

    const uploads = Array.isArray(sess.uploads) ? sess.uploads.slice() : [];
    uploads.push({ key, name: fileName, size: body.byteLength, label });

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, uploads }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true, key });
  }

  // --- Debit details save (metadata only) ---
  if (path === "/api/debit/save" && method === "POST") {
    const b = await request.json().catch(async () => {
      const form = await request.formData().catch(() => null);
      if (!form) return {};
      const o = {};
      for (const [k, v] of form.entries()) o[k] = v;
      return o;
    });

    const reqd = ["account_holder", "id_number", "bank_name", "account_number", "account_type", "debit_day"];
    for (const k of reqd) {
      if (!b[k] || String(b[k]).trim() === "") return json({ ok: false, error: `Missing ${k}` }, 400);
    }

    const id = (b.splynx_id || b.client_id || "").toString().trim() || "unknown";
    const ts = Date.now();
    const kvKey = `debit/${id}/${ts}`;
    const record = { ...b, splynx_id: id, created: ts, ip: getIP(), ua: getUA() };
    await env.ONBOARD_KV.put(kvKey, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 90 });

    const linkidParam = (b.linkid && String(b.linkid)) || url.searchParams.get("linkid") || "";
    if (linkidParam) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkidParam}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkidParam}`,
          JSON.stringify({ ...sess, debit: { ...record } }),
          { expirationTtl: 86400 }
        );
      }
    }
    return json({ ok: true, ref: kvKey });
  }

  // --- Debit signature (PNG data URL -> R2) ---
  if (path === "/api/debit/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
      return json({ ok: false, error: "Missing/invalid signature" }, 400);

    const png = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const sigKey = `debit_agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) {
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({ ...sess, debit_signed: true, debit_sig_key: sigKey }),
        { expirationTtl: 86400 }
      );
    }
    return json({ ok: true, sigKey });
  }

  // --- MSA signature (PNG data URL -> R2, mark agreement_signed) ---
  if (path === "/api/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (!linkid || !dataUrl || !/^data:image\/png;base64,/.test(dataUrl))
      return json({ ok: false, error: "Missing/invalid signature" }, 400);

    const png = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const sigKey = `agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, { httpMetadata: { contentType: "image/png" } });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown session" }, 404);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, agreement_signed: true, agreement_sig_key: sigKey, status: "pending" }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, sigKey });
  }

  // Fallback (should not hit because match() filters paths)
  return new Response("Not found", { status: 404 });
}
