import { fetchProfileForDisplay, splynxGET } from "../splynx.js";

export default async function handleApiSplynx(request, env, ctx, url) {
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

  // --- Example passthrough: GET /api/splynx/raw?ep=/admin/customers/123 ---
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

  return new Response("Not found", { status: 404 });
}
