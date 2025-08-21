// src/routes/api-splynx.js
import { fetchProfileForDisplay, splynxGET } from "../splynx.js";

export async function handleSplynxApi(request, env, ctx, url) {
  // --- Profile fetch ---
  if (url.pathname === "/api/splynx/profile") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response("Missing id", { status: 400 });
    }

    try {
      const profile = await fetchProfileForDisplay(env, id);
      if (!profile) {
        return new Response("Profile not found", { status: 404 });
      }
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response("Splynx fetch failed: " + err.message, {
        status: 500,
      });
    }
  }

  // --- Raw passthrough for debugging ---
  // Example: /api/splynx/raw?ep=/admin/customers/319
  if (url.pathname === "/api/splynx/raw") {
    const ep = url.searchParams.get("ep");
    if (!ep) {
      return new Response("Missing ep", { status: 400 });
    }
    try {
      const data = await splynxGET(env, ep);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response("Splynx fetch failed: " + err.message, {
        status: 500,
      });
    }
  }

  // No route match
  return new Response("Not found", { status: 404 });
}
