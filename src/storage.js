// Delete an entire onboarding session and all traces (KV + R2 + optional D1)
export async function deleteOnboardAll(env, linkid) {
  const sess = await env.ONBOARD_KV.get(`onboard/${linkid}`, "json");
  if (!sess) return { ok:true, deleted:false };

  // Delete R2 uploads under prefixes we control
  const prefixes = [
    `uploads/${linkid}/`,
    `agreements/${linkid}/`,
    `debit_agreements/${linkid}/`,
  ];
  for (const p of prefixes) {
    let cursor=undefined;
    do {
      const list = await env.R2_UPLOADS.list({ prefix: p, cursor });
      for (const o of list.objects || []) await env.R2_UPLOADS.delete(o.key);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }

  // Delete temp OTPs / sig pointers
  const kvKeys = [
    `onboard/${linkid}`,
    `otp/${linkid}`,
    `otp_msisdn/${linkid}`,
    `staffotp/${linkid}`,
  ];
  for (const k of kvKeys) { try { await env.ONBOARD_KV.delete(k); } catch {} }

  // If you also mirrored anything into D1, delete those rows here.
  // (Left intact as you said: keep all code active; you can uncomment custom D1 deletes if needed.)
  return { ok:true, deleted:true };
}
