// src/router-admin.js
import { ipAllowed } from "./branding.js";
import { json, restrictedResponse } from "./router-utils.js";
import { renderAdminPage, renderAdminReviewHTML } from "./ui/admin.js";
import { getClientMeta } from "./helpers.js";
import {
  fetchProfileForDisplay,
  detectEntityKind,
  splynxPUT,
  uploadAllSessionFilesToSplynx,
} from "./splynx.js";
import { deleteOnboardAll } from "./storage.js";

export async function handleAdminRoutes({ path, method, url, env, request }) {
  // Dashboard home
  if (path === "/" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse();
    return new Response(renderAdminPage(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Admin review page
  if (path === "/admin/review" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return new Response("Missing linkid", { status: 400 });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Not found", { status: 404 });

    const r2PublicBase =
      env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";

    let original = null;
    try {
      const id = String(sess.id || "").trim();
      if (id) original = await fetchProfileForDisplay(env, id);
    } catch {
      original = null;
    }

    return new Response(
      renderAdminReviewHTML({
        linkid,
        sess,
        r2PublicBase,
        original,
      }),
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // Admin: create onboarding link
  if (path === "/api/admin/genlink" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const { id } = await request.json().catch(() => ({}));
    if (!id) return json({ error: "Missing id" }, 400);

    const token = Math.random().toString(36).slice(2, 10);
    const linkid = `${id}_${token}`;

    const meta = getClientMeta(request);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        id,
        created: Date.now(),
        updated: Date.now(),
        progress: 0,
        status: "inprogress",
        audit_meta: meta,
        edits: {},
        uploads: [],
      }),
      { expirationTtl: 86400 }
    );

    return json({ url: `${url.origin}/onboard/${linkid}`, linkid });
  }

  // Admin: generate one-time staff OTP
  if (path === "/api/staff/gen" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, {
      expirationTtl: 900,
    });

    return json({ ok: true, linkid, code });
  }

  // Admin: list sessions
  if (path === "/api/admin/list" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const mode = url.searchParams.get("mode") || "pending";
    const m = mode === "completed" ? "pending" : mode; // alias

    const list = await env.ONBOARD_KV.list({
      prefix: "onboard/",
      limit: 1000,
    });

    const items = [];
    for (const k of list.keys || []) {
      const s = await env.ONBOARD_KV.get(k.name, "json");
      if (!s) continue;
      const linkid = k.name.split("/")[1];
      const updated = s.updated || s.last_time || s.created || 0;

      if (m === "inprog" && (s.status === "inprogress" || !s.agreement_signed))
        items.push({ linkid, id: s.id, updated });
      if (m === "pending" && s.status === "pending")
        items.push({ linkid, id: s.id, updated });
      if (m === "approved" && s.status === "approved")
        items.push({ linkid, id: s.id, updated });
    }

    items.sort((a, b) => b.updated - a.updated);
    return json({ ok: true, items });
  }

  // Admin: reject
  if (path === "/api/admin/reject" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const { linkid, reason } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);

    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "rejected",
        reject_reason: String(reason || "").slice(0, 300),
        rejected_at: Date.now(),
        updated: Date.now(),
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true });
  }

  // Admin: delete full session bundle
  if (path === "/api/admin/delete" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    try {
      const res = await deleteOnboardAll(env, linkid);
      return json({ ok: true, ...res });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
  }

  // Admin diagnostics: list related KV keys
  if (path === "/api/admin/session/keys" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const prefixes = ["onboard/", "link:", "session:", "sess:", "inprogress:"];
    const keysOut = [];

    for (const p of prefixes) {
      const l = await env.ONBOARD_KV.list({ prefix: p });
      for (const k of l.keys) {
        if (k.name.includes(linkid)) {
          keysOut.push({
            key: k.name,
            bytes: k.size || k.metadata?.size || 0,
          });
        }
      }
    }

    const raw = await env.ONBOARD_KV.get(linkid);
    if (raw) keysOut.push({ key: linkid, bytes: raw.length });

    return json({ ok: true, linkid, keys: keysOut });
  }

  // Admin diagnostics: get session blob
  if (path === "/api/admin/session/get" && method === "GET") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    return json({
      ok: true,
      linkid,
      found: !!sess,
      session: sess || null,
    });
  }

  // Admin approve -> push to Splynx / upload docs
  if (path === "/api/admin/approve" && method === "POST") {
    if (!ipAllowed(request, env)) return restrictedResponse();

    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);

    const id = String(sess.id || "").trim();
    if (!id) return json({ ok: false, error: "Missing Splynx ID" }, 400);

    // Build payload for Splynx
    const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
    const r2Base =
      env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";
    const publicFiles = uploads.map((u) => `${r2Base}/${u.key}`);

    const body = {
      name: sess.edits?.full_name || undefined,
      email: sess.edits?.email || undefined,
      phone_mobile: sess.edits?.phone || undefined,
      street_1: sess.edits?.street || undefined,
      city: sess.edits?.city || undefined,
      zip_code: sess.edits?.zip || undefined,
      attachments: publicFiles.length ? publicFiles : undefined,
      payment_method: sess.pay_method || undefined,
      debit: sess.debit || undefined,
    };

    // Detect whether this is a lead or customer
    let kind = "unknown";
    try {
      kind = await detectEntityKind(env, id);
    } catch {
      // ignore
    }

    const attempts = [];
    const tryPut = async (endpoint) => {
      try {
        await splynxPUT(env, endpoint, body);
        attempts.push({ endpoint, ok: true });
      } catch (e) {
        console.warn(
          `approve: splynx PUT failed ${endpoint}: ${e && e.message}`
        );
        attempts.push({
          endpoint,
          ok: false,
          error: String(e && e.message),
        });
      }
    };

    if (kind === "customer") {
      await tryPut(`/admin/customers/customer/${id}`);
    } else if (kind === "lead") {
      await tryPut(`/admin/crm/leads/${id}`);
    } else {
      await tryPut(`/admin/customers/customer/${id}`);
      await tryPut(`/admin/crm/leads/${id}`);
    }

    // Upload docs/PDFs to Splynx
    let docUpload = null;
    try {
      docUpload = await uploadAllSessionFilesToSplynx(env, linkid);
    } catch (e) {
      docUpload = { ok: false, error: String(e && e.message) };
    }

    // Mark session approved
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({
        ...sess,
        status: "approved",
        approved_at: Date.now(),
        updated: Date.now(),
        push_attempts: attempts,
        splynx_docs_result: docUpload,
      }),
      { expirationTtl: 86400 }
    );

    return json({ ok: true, kind, attempts, docs: docUpload });
  }

  // not an admin route
  return null;
}
