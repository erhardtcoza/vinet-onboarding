// src/routes/api-splynx.js
import { fetchProfileForDisplay, fetchCustomerMsisdn, splynxPUT, splynxGET } from "../splynx.js";

export function match(path, method) {
  return (
    path.startsWith("/api/splynx/profile") ||
    path.startsWith("/api/splynx/raw") ||
    path.startsWith("/api/splynx/msisdn") ||
    path.startsWith("/api/splynx/update")
  );
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  console.log(`[api-splynx] Handling ${method} ${path}`);

  // ---------------------
  // Profile
  // ---------------------
  if (path === "/api/splynx/profile" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    try {
      const profile = await fetchProfileForDisplay(env, id);
      if (!profile) {
        console.log(`[api-splynx] Profile not found for id=${id}`);
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      console.log(`[api-splynx] Profile id=${id} keys=${Object.keys(profile).length}`);
      if (profile.normalised) {
        console.log(`[api-splynx] Normalised block present for id=${id}`);
      }

      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] Error fetching profile for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // Raw passthrough
  // ---------------------
  if (path === "/api/splynx/raw" && method === "GET") {
    const ep = url.searchParams.get("ep");
    if (!ep) {
      return new Response(JSON.stringify({ error: "Missing ep" }), { status: 400 });
    }
    try {
      console.log(`[api-splynx] Fetching raw endpoint ${ep}`);
      const data = await splynxGET(env, ep);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] Raw fetch failed for ep=${ep}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // MSISDN lookup
  // ---------------------
  if (path === "/api/splynx/msisdn" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }
    try {
      const data = await fetchCustomerMsisdn(env, id);
      if (!data) {
        console.log(`[api-splynx] MSISDN not found for id=${id}`);
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      console.log(`[api-splynx] MSISDN success for id=${id}`);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] MSISDN fetch failed for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // Update customer
  // ---------------------
  if (path === "/api/splynx/update" && method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    try {
      const body = await request.json();
      const result = await splynxPUT(env, `/admin/customers/customer/${id}`, body);

      console.log(`[api-splynx] Updated customer id=${id}`);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[api-splynx] Update failed for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // Fallback
  // ---------------------
  return new Response("Not found", { status: 404 });
}
