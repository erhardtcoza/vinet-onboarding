// src/routes/admin.js
import { ipAllowed } from "../branding.js";
import { renderAdminReviewHTML } from "../ui/admin.js";
import { getClientMeta } from "../helpers.js";
import { deleteOnboardAll } from "../storage.js";
import {
  fetchProfileForDisplay,
  splynxGET,
  splynxPUT,
  mapEditsToSplynxPayload,
  splynxCreateAndUpload,
} from "../splynx.js";

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}

export function match(path, method) {
  if (path === "/api/admin/genlink" && method === "POST") return true;
  if (path === "/api/admin/list" && method === "GET") return true;
  if (path === "/admin/review" && method === "GET") return true;
  if (path === "/api/admin/reject" && method === "POST") return true;
  if (path === "/api/admin/delete" && method === "POST") return true;
  if (path === "/api/admin/approve" && method === "POST") return true;
  if (path === "/api/staff/gen" && method === "POST") return true;
  return false;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // genlink
  if (path === "/api/admin/genlink") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { id } = await request.json().catch(() => ({}));
    if (!id) return json({ error: "Missing id" }, 400);
    const token = Math.random().toString(36).slice(2, 10);
    const linkid = `${id}_${token}`;
    const meta = getClientMeta(request);
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ id, created: Date.now(), progress: 0, audit_meta: meta }),
      { expirationTtl: 86400 }
    );
    return json({ url: `${url.origin}/onboard/${linkid}` });
  }

  // staff OTP (generate)
  if (path === "/api/staff/gen") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Unknown linkid" }, 404);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.ONBOARD_KV.put(`staffotp/${linkid}`, code, { expirationTtl: 900 });
    return json({ ok: true, linkid, code });
  }

  // list
  if (path === "/api/admin/list") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const mode = url.searchParams.get("mode") || "pending";
    const m = mode === "completed" ? "pending" : mode;
    const list = await env.ONBOARD_KV.list({ prefix: "onboard/", limit: 1000 });
    const items = [];
    for (const k of list.keys || []) {
      const s = await env.ONBOARD_KV.get(k.name, "json");
      if (!s) continue;
      const linkid = k.name.split("/")[1];
      const updated = s.last_time || s.created || 0;
      if (m === "inprog" && !s.agreement_signed) items.push({ linkid, id: s.id, updated });
      if (m === "pending" && s.status === "pending") items.push({ linkid, id: s.id, updated });
      if (m === "approved" && s.status === "approved") items.push({ linkid, id: s.id, updated });
    }
    items.sort((a, b) => b.updated - a.updated);
    return json({ items });
  }

  // review
  if (path === "/admin/review") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const linkid = url.searchParams.get("linkid") || "";
    if (!linkid) return new Response("Missing linkid", { status: 400 });

    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return new Response("Not found", { status: 404 });
    const r2PublicBase = env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";

    let original = null;
    try {
      const id = String(sess.id || "").trim();
      if (id) original = await fetchProfileForDisplay(env, id);
    } catch {
      original = null;
    }

    return new Response(renderAdminReviewHTML({ linkid, sess, r2PublicBase, original }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // reject
  if (path === "/api/admin/reject") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid, reason } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
    if (!sess) return json({ ok: false, error: "Not found" }, 404);
    await env.ONBOARD_KV.put(
      `onboard/${linkid}`,
      JSON.stringify({ ...sess, status: "rejected", reject_reason: String(reason || "").slice(0, 300), rejected_at: Date.now() }),
      { expirationTtl: 86400 }
    );
    return json({ ok: true });
  }

  // delete
  if (path === "/api/admin/delete") {
    if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { linkid } = await request.json().catch(() => ({}));
    if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);
    try {
      const res = await deleteOnboardAll(env, linkid);
      return json({ ok: true, ...res });
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
  }

// ----- Admin: approve (push to Splynx + mark approved) -----
if (path === "/api/admin/approve" && method === "POST") {
  if (!ipAllowed(request)) return new Response("Forbidden", { status: 403 });
  const { linkid } = await request.json().catch(() => ({}));
  if (!linkid) return json({ ok: false, error: "Missing linkid" }, 400);

  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return json({ ok: false, error: "Not found" }, 404);

  const id = String(sess.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing customer/lead id in session" }, 400);

  // Decide entity: try CUSTOMER, else LEAD
  let entity = "customer";
  try {
    await splynxGET(env, `/admin/customers/customer/${id}`);
    entity = "customer";
  } catch {
    entity = "lead";
  }

  // Build updates
  const uploads = Array.isArray(sess.uploads) ? sess.uploads : [];
  const r2Base = env.R2_PUBLIC_BASE || "https://onboarding-uploads.vinethosting.org";
  const publicFiles = uploads.map((u) => `${r2Base}/${u.key}`);

  const updateBody = mapEditsToSplynxPayload(
    sess.edits || {},
    sess.pay_method,
    sess.debit,
    publicFiles
  );

  // Push updates to both sides (best-effort)
  try { await splynxPUT(env, `/admin/customers/customer/${id}`, updateBody); } catch {}
  try { await splynxPUT(env, `/admin/customers/${id}`, updateBody); } catch {}
  try { await splynxPUT(env, `/admin/crm/leads/${id}`, updateBody); } catch {}
  try { await splynxPUT(env, `/admin/customers/${id}/contacts`, updateBody); } catch {}
  try { await splynxPUT(env, `/admin/crm/leads/${id}/contacts`, updateBody); } catch {}

  // Helpers
  async function readR2Bytes(key) {
    const obj = await env.R2_UPLOADS.get(key);
    if (!obj) return null;
    const bytes = await obj.arrayBuffer();
    const mime =
      (obj.httpMetadata && obj.httpMetadata.contentType) ||
      (obj.customMetadata && obj.customMetadata.contentType) ||
      "application/octet-stream";
    return { bytes, mime };
  }

  async function createAndUpload(title, description, filename, mime, bytes) {
    try {
      await splynxCreateAndUpload(env, entity, id, {
        title,
        description,
        filename,
        mime,
        bytes
      });
    } catch (e) {
      // Optional: console.log for debugging in Wrangler logs
      // console.log(`${title} upload failed:`, String(e && e.message || e));
    }
  }

  // RICA uploads (ID + Proof of Address only)
  for (const u of uploads) {
    const isID  = /id\s*document/i.test(u.label || "");
    const isPOA = /proof\s*of\s*address/i.test(u.label || "");
    if (!isID && !isPOA) continue;

    const file = await readR2Bytes(u.key);
    if (!file) continue;

    const title = isID ? "ID Document" : "Proof of Address";
    const description = isID ? "RICA ID upload" : "RICA Proof of Address (≤ 3 months)";
    const filename = u.name || (isID ? "id-document" : "proof-of-address");

    await createAndUpload(title, description, filename, file.mime || "application/octet-stream", file.bytes);
  }

  // Robust PDF fetch (cache-bypass, tolerant content-type)
  async function fetchPdfBytes(kind) {
    const ts = Date.now();
    const endpoint = kind === "msa"
      ? `${url.origin}/pdf/msa/${linkid}?_=${ts}`
      : `${url.origin}/pdf/debit/${linkid}?_=${ts}`;

    const res = await fetch(endpoint, { cf: { cacheTtl: 0 } });
    if (!res.ok) throw new Error(`${kind.toUpperCase()} fetch ${res.status}`);
    return await res.arrayBuffer();
  }

  // Upload MSA PDF (always, once agreement is signed)
  try {
    const msaBytes = await fetchPdfBytes("msa");
    await createAndUpload(
      "Vinet Master Service Agreement",
      "Signed MSA PDF",
      `MSA_${id}.pdf`,
      "application/pdf",
      msaBytes
    );
  } catch (e) {
    // console.log("MSA upload failed:", String(e && e.message || e));
  }

  // Upload Debit Order PDF if the debit form was actually signed
  if (sess.debit_signed) {
    try {
      const doBytes = await fetchPdfBytes("debit");
      await createAndUpload(
        "Debit Order Instruction",
        "Signed Debit Order PDF",
        `DO_${id}.pdf`,
        "application/pdf",
        doBytes
      );
    } catch (e) {
      // console.log("Debit upload failed:", String(e && e.message || e));
    }
  }

  // Mark approved
  await env.ONBOARD_KV.put(
    `onboard/${linkid}`,
    JSON.stringify({ ...sess, status: "approved", approved_at: Date.now() }),
    { expirationTtl: 86400 }
  );

  return json({ ok: true });
}
  return new Response("Not found", { status: 404 });
}
