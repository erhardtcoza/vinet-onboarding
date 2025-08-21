// src/routes/api-admin.js

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);

  // --- Generate onboarding link ---
  if (url.pathname === "/api/admin/genlink" && request.method === "POST") {
    try {
      const data = await request.json();
      const id = data.id;
      if (!id) {
        return new Response(JSON.stringify({ error: "missing id" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      // Generate short random token
      const rand = Math.random().toString(36).substring(2, 8);
      const token = `${id}_${rand}`;

      // Save session to KV with 24h expiry
      await env.SESSION_KV.put(
        `onboard:${token}`,
        JSON.stringify({ id, status: "pending" }),
        { expirationTtl: 86400 }
      );

      // Build onboarding link
      const link = `https://onboard.vinet.co.za/${token}`;

      return new Response(JSON.stringify({ link }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "genlink_failed",
          details: e.message || String(e),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // --- Not found fallback ---
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}
