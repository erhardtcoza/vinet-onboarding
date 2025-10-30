// src/routes/api-onboard.js
// Minimal stub to satisfy `import { createOnboardingSession } ...`
// Returns a short onboarding code + full URL. You can wire persistence later if needed.

export async function createOnboardingSession(env, payload = {}) {
  const name = String((payload.name || "").trim() || "client");
  // use last token of name if possible, else first
  const parts = name.split(/\s+/).filter(Boolean);
  const base = (parts.length ? parts[parts.length - 1] : name).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  const code = `${base || "client"}_${rand}`;

  const url = `https://onboard.vinet.co.za/onboard/${code}`;

  // If you want to persist later, create an `onboard_sessions` table and insert here.
  // For now we just return values expected by callers.
  return { code, url };
}

// (Optional) tiny HTTP endpoint if your router expects a handler here later.
// Not required by the current error, safe to keep.
/*
export async function handleCreateOnboardingSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const result = await createOnboardingSession(env, body || {});
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
*/
