// src/routes/api-splynx.js
import { splynxGET, splynxPUT, splynxPOST } from "../splynx.js";

/**
 * Handles all /api/splynx/* requests
 */
export async function handleSplynxApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/splynx/, "");

  // Example: GET /api/splynx/customer/123
  if (request.method === "GET") {
    return splynxGET(env, path);
  }

  if (request.method === "PUT") {
    const data = await request.json();
    return splynxPUT(env, path, data);
  }

  if (request.method === "POST") {
    const data = await request.json();
    return splynxPOST(env, path, data);
  }

  return new Response(JSON.stringify({ error: "Unsupported method" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
