// src/router-onboarding.js
import { json, getIP, getUA, sendWhatsAppTemplate } from "./router-utils.js";
import { getClientMeta } from "./helpers.js";
import {
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
} from "./splynx.js";

export async function handleOnboardingRoutes({ path, method, url, env, request }) {
  /* ---- OTP send ---- */
  if (path === "/api/otp/send" && method === "POST") {
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, where: "pre", error: "Missing linkid" }, 400);

    if (!env.PHONE_NUMBER_ID || !env.WHATSAPP_TOKEN) {
      return json(
        { ok: false, where: "config", error: "WhatsApp credentials not configured" },
        500
      );
    }

    const splynxId = (linkid || "").split("_")[0];

    let msisdn = null;
    try {
      msisdn = await fetchCustomerMsisdn(env, splynxId);
    } catch (e) {
      return json(
        {
          ok: false,
          where: "splynx",
          error: "Splynx lookup failed",
          detail: String(e && e.message),
        },
        502
      );
    }

    if (!msisdn) {
      return json(
        {
          ok: false,
          where: "splynx",
          error: "No WhatsApp number on file",
          splynxId,
        },
        404
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    // save OTP + msisdn to KV for 10min
    await env.ONBOARD_KV.put(`otp/${linkid}`, code, { expirationTtl: 600 });
    await env.ONBOARD_KV.put(`otp_msisdn/${linkid}`, msisdn, {
      expirationTtl: 600,
    });

    try {
      await sendWhatsAppTemplate(env, msisdn, code, "en");
      return json({ ok: true, where: "ok", sent_to: msisdn });
    } catch (e) {
      return json(
        {
          ok: false,
          where: "wa",
          error: "WhatsApp send failed (template)",
          detail: String(e && e.message),
        },
        502
      );
    }
  }

  /* ---- OTP verify ---- */
  if (path === "/api/otp/verify" && method === "POST") {
    const { linkid, otp, kind } = await request.json().catch(() => ({}));
    if (!linkid || !otp)
      return json({ ok: false, error: "Missing params" }, 400);

    const key = kind === "staff" ? `staffotp/${linkid}` : `otp/${linkid}`;
    const expected = await env.ONBOARD_KV.get(key);

    const ok = !!expected && expected === otp;

    if (ok) {
      const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({
            ...sess,
            otp_verified: true,
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
      if (kind === "staff") {
        await env.ONBOARD_KV.delete(`staffotp/${linkid}`);
      }
    }

    return json({ ok });
  }

  /* ---- Upload docs -> R2 ---- */
  if (path === "/api/onboard/upload" && method === "POST") {
    const params = new URL(request.url).searchParams;
    const linkid = params.get("linkid");
    const fileName = params.get("filename") || "file.bin";
    const label = params.get("label") || "";

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Invalid link", { status: 404 });

    const bodyBuf = await request.arrayBuffer();
    const safeName = fileName.replace(/[^a-z0-9_.-]/gi, "_");
    const key = `uploads/${linkid}/${Date.now()}_${safeName}`;

    await env.R2_UPLOADS.put(key, bodyBuf);

    const uploads = Array.isArray(sess.uploads)
      ? sess.uploads.slice()
      : [];
    uploads.push({
      key,
      name: fileName,
      size: bodyBuf.byteLength,
      label,
    });

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        uploads,
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, key });
  }

  /* ---- Save progress ---- */
  if (path.startsWith("/api/progress/") && method === "POST") {
    // path like /api/progress/<linkid>
    const parts = path.split("/");
    // /api/progress/<idx 0>/ <1> / <2> / <3>
    // ["", "api", "progress", "<linkid>"]
    const linkid = parts[3];
    const body = await request.json().catch(() => ({}));

    const existing =
      (await env.ONBOARD_KV.get(`onboard/${linkid}`, "json")) || {};

    const next = {
      ...existing,
      ...body,
      last_ip: getIP(request),
      last_ua: getUA(request),
      last_time: Date.now(),
      updated: Date.now(),
      audit_meta: existing.audit_meta || getClientMeta(request),
    };

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify(next),
      { expirationTtl: 86400 }
    );

    return json({ ok: true });
  }

  /* ---- Debit details save ---- */
  if (path === "/api/debit/save" && method === "POST") {
    // supports JSON or formData
    const b = await request.json().catch(async () => {
      const form = await request.formData().catch(() => null);
      if (!form) return {};
      const o = {};
      for (const [k, v] of form.entries()) o[k] = v;
      return o;
    });

    const reqd = [
      "account_holder",
      "id_number",
      "bank_name",
      "account_number",
      "account_type",
      "debit_day",
    ];
    for (const k of reqd) {
      if (!b[k] || String(b[k]).trim() === "") {
        return json({ ok: false, error: `Missing ${k}` }, 400);
      }
    }

    const id =
      (b.splynx_id || b.client_id || "").toString().trim() ||
      "unknown";
    const ts = Date.now();
    const kvKey = `debit/${id}/${ts}`;

    const record = {
      ...b,
      splynx_id: id,
      created: ts,
      ip: getIP(request),
      ua: getUA(request),
    };

    // Keep 90 days
    await env.ONBOARD_KV.put(kvKey, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 90,
    });

    // attach to active session blob if we know linkid
    const linkidParam =
      (b.linkid && String(b.linkid)) ||
      url.searchParams.get("linkid") ||
      "";
    if (linkidParam) {
      const sess = await env.ONBOARD_KV.get(
        `onboard/${linkidParam}`,
        "json"
      );
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkidParam}`,
          JSON.stringify({
            ...sess,
            debit: { ...record },
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
    }

    return json({ ok: true, ref: kvKey });
  }

  /* ---- Debit signature upload ---- */
  if (path === "/api/debit/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (
      !linkid ||
      !dataUrl ||
      !/^data:image\/png;base64,/.test(dataUrl)
    ) {
      return json(
        { ok: false, error: "Missing/invalid signature" },
        400
      );
    }

    const pngB64 = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(pngB64), (c) =>
      c.charCodeAt(0)
    );

    const sigKey = `debit_agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (sess) {
      await env.ONBOARD_KV.put(
        `onboard/${linkid}`,
        JSON.stringify({
          ...sess,
          debit_signed: true,
          debit_sig_key: sigKey,
          updated: Date.now(),
        }),
        { expirationTtl: 86400 }
      );
    }

    return json({ ok: true, sigKey });
  }

  /* ---- Master Service Agreement signature ---- */
  if (path === "/api/sign" && method === "POST") {
    const { linkid, dataUrl } = await request.json().catch(() => ({}));
    if (
      !linkid ||
      !dataUrl ||
      !/^data:image\/png;base64,/.test(dataUrl)
    ) {
      return json(
        { ok: false, error: "Missing/invalid signature" },
        400
      );
    }

    const pngB64 = dataUrl.split(",")[1];
    const bytes = Uint8Array.from(atob(pngB64), (c) =>
      c.charCodeAt(0)
    );

    const sigKey = `agreements/${linkid}/signature.png`;

    await env.R2_UPLOADS.put(sigKey, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess)
      return json({ ok: false, error: "Unknown session" }, 404);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        agreement_signed: true,
        agreement_sig_key: sigKey,
        status: "pending",
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, sigKey });
  }

  /* ---- Turnstile verify ---- */
  if (path === "/api/turnstile/verify" && method === "POST") {
    const { token, linkid } = await request.json().catch(() => ({}));
    if (!token || !linkid) {
      return json(
        { ok: false, error: "Missing token/linkid" },
        400
      );
    }

    const form = new URLSearchParams();
    form.set("secret", env.TURNSTILE_SECRET_KEY || "");
    form.set("response", token);
    form.set(
      "remoteip",
      request.headers.get("CF-Connecting-IP") || ""
    );

    const ver = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = await ver.json().catch(() => ({}));

    if (data.success) {
      const sess = await env.ONBOARD_KV.get(
        `onboard/${linkid}`,
        "json"
      );
      if (sess) {
        await env.ONBOARD_KV.put(
          `onboard/${linkid}`,
          JSON.stringify({
            ...sess,
            human_ok: true,
            updated: Date.now(),
          }),
          { expirationTtl: 86400 }
        );
      }
    }

    return json({ ok: !!data.success, data });
  }

  /* ---- Splynx profile proxy ---- */
  if (path === "/api/splynx/profile" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "Missing id" }, 400);

    try {
      const prof = await fetchProfileForDisplay(env, id);
      return json(prof);
    } catch {
      return json({ error: "Lookup failed" }, 502);
    }
  }

  // not handled here
  return null;
}
