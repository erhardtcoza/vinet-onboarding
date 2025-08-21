// src/routes/api-splynx.js
import { fetchProfileForDisplay, splynxGET } from "../splynx.js";

export function match(path, method) {
  return (
    path.startsWith("/api/splynx/profile") ||
    path.startsWith("/api/splynx/raw")
  );
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  console.log(`[api-splynx] Handling request: ${path}`);

  // --- Profile fetch ---
  if (path === "/api/splynx/profile") {
    const id = url.searchParams.get("id");
    if (!id) {
      console.log("[api-splynx] Missing id param");
      return new Response("Missing id", { status: 400 });
    }

    try {
      const profile = await fetchProfileForDisplay(env, id);
      if (!profile) {
        console.log(`[api-splynx] No profile found for id=${id}`);
        return new Response("Profile not found", { status: 404 });
      }
      console.log(`[api-splynx] Returning profile for id=${id}`);
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] Error fetching profile: ${err.message}`);
      return new Response("Splynx fetch failed: " + err.message, {
        status: 500,
      });
    }
  }

  // --- Raw passthrough for debugging ---
  // Example: /api/splynx/raw?ep=/admin/customers/319
  if (path === "/api/splynx/raw") {
    const ep = url.searchParams.get("ep");
    if (!ep) {
      console.log("[api-splynx] Missing ep param");
      return new Response("Missing ep", { status: 400 });
    }
    try {
      console.log(`[api-splynx] Fetching raw endpoint: ${ep}`);
      const data = await splynxGET(env, ep);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] Raw fetch failed: ${err.message}`);
      return new Response("Splynx fetch failed: " + err.message, {
        status: 500,
      });
    }
  }

  return new Response("Not found", { status: 404 });
}
