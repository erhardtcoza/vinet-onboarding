// src/routes/api-admin.js
import { splynxPUT, mapEditsToSplynxPayload, fetchProfileForDisplay } from "../splynx.js";
import { getClientMeta } from "../helpers.js";

/**
 * Handle API routes for admin actions (update profile, approve, etc.)
 */
export async function handleApiAdmin(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  // --- Update customer/lead profile ---
  if (path === "/api/admin/update" && req.method === "POST") {
    const edits = await req.json();

    if (!edits.id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = mapEditsToSplynxPayload(edits);

    // Try both customer + lead endpoints
    const endpoints = [
      `/admin/customers/customer/${edits.id}`,
      `/admin/crm/leads/${edits.id}`,
    ];

    let updated = null;
    for (const ep of endpoints) {
      try {
        updated = await splynxPUT(env, ep, payload);
        if (updated) break;
      } catch (e) {
        // continue trying
      }
    }

    if (!updated) {
      return new Response(JSON.stringify({ error: "Update failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch fresh profile to return
    const refreshed = await fetchProfileForDisplay(env, edits.id);
    return new Response(JSON.stringify(refreshed), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Fetch mapped profile for review ---
  if (path === "/api/admin/profile" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const profile = await fetchProfileForDisplay(env, id);
    if (!profile) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Fallback: Not found ---
  return new Response("Not found", { status: 404 });
}
