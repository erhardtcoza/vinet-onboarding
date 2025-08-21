// src/storage.js

/**
 * Delete *everything* related to an onboarding linkid:
 * - KV: session, otps, staff code, any cached pdf bytes
 * - R2: user-uploaded files under uploads/:linkid, and signatures
 *
 * Returns a small summary object so callers can show/debug counts if needed.
 */
export async function deleteOnboardAll(env, linkid) {
  const result = {
    kv_deleted: [],
    r2_deleted: [],
    errors: []
  };

  // ---- Helper to delete KV keys (best-effort) ----
  async function delKV(key) {
    try {
      await env.ONBOARD_KV.delete(key);
      result.kv_deleted.push(key);
    } catch (e) {
      result.errors.push(`KV ${key}: ${String(e && e.message || e)}`);
    }
  }

  // ---- Helper to delete an R2 object (best-effort) ----
  async function delR2(key) {
    try {
      await env.R2_UPLOADS.delete(key);
      result.r2_deleted.push(key);
    } catch (e) {
      result.errors.push(`R2 ${key}: ${String(e && e.message || e)}`);
    }
  }

  // ---- 1) Load the session (if present) to discover keys ----
  let sess = null;
  try {
    sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  } catch {
    /* ignore */
  }

  // ---- 2) KV keys we know about for this linkid ----
  const kvKeys = [
    `onboard/${linkid}`,
    `otp/${linkid}`,
    `otp_msisdn/${linkid}`,
    `staffotp/${linkid}`,

    // optional PDF byte caches (if you ever enabled caching)
    `pdf:msa:${linkid}`,
    `pdf:debit:${linkid}`,
    `cache:pdf:msa:${linkid}`,
    `cache:pdf:debit:${linkid}`
  ];

  // Delete the obvious KV keys
  await Promise.all(kvKeys.map(delKV));

  // ---- 3) R2: delete signatures if referenced in session ----
  if (sess && sess.agreement_sig_key) {
    await delR2(sess.agreement_sig_key); // agreements/${linkid}/signature.png
  }
  if (sess && sess.debit_sig_key) {
    await delR2(sess.debit_sig_key);     // debit_agreements/${linkid}/signature.png
  }

  // ---- 4) R2: delete all uploaded files under uploads/${linkid}/ ----
  try {
    const prefix = `uploads/${linkid}/`;
    // Paginate just in case (Cloudflare R2 may return up to 1000 keys/page)
    let cursor = undefined;
    do {
      const list = await env.R2_UPLOADS.list({ prefix, cursor });
      cursor = list.truncated ? list.cursor : undefined;
      const keys = (list.objects || []).map(o => o.key);
      await Promise.all(keys.map(delR2));
    } while (cursor);
  } catch (e) {
    result.errors.push(`R2 list uploads/${linkid}/: ${String(e && e.message || e)}`);
  }

  // ---- 5) Also attempt to remove well-known signature paths even if sess is missing ----
  await delR2(`agreements/${linkid}/signature.png`).catch(()=>{});
  await delR2(`debit_agreements/${linkid}/signature.png`).catch(()=>{});

  return result;
}
