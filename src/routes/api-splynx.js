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

  // --- Profile fetch ---
  if (path === "/api/splynx/profile") {
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
  if (path === "/api/splynx/raw") {
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

  return new Response("Not found", { status: 404 });
}
