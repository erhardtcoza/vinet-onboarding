// src/storage.js

/**
 * Fetch all onboarding sessions stored in KV
 */
export async function getOnboardAll(env) {
  const list = await env.SESSION_KV.list({ prefix: "onboard:" });
  const rows = [];

  for (const key of list.keys) {
    const raw = await env.SESSION_KV.get(key.name);
    if (!raw) continue;

    try {
      const row = JSON.parse(raw);

      // Ensure every row has a status
      if (!row.status) {
        // Fallback logic: assume new sessions are "inprogress"
        row.status = "inprogress";
      }

      // Ensure every row has an id (from key if not inside value)
      if (!row.id) {
        row.id = key.name.replace("onboard:", "");
      }

      rows.push(row);
    } catch (e) {
      console.error("Failed to parse row", key.name, e);
    }
  }

  return rows;
}

/**
 * Delete a specific onboarding session by ID
 */
export async function deleteOnboardAll(env, id) {
  await env.SESSION_KV.delete("onboard:" + id);
}
