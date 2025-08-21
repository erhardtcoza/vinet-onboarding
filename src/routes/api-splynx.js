// src/api-splynx.js
import { fetchProfileForDisplay, fetchCustomerMsisdn, splynxPUT } from "./splynx";

export async function handleSplynxAPI(request, env) {
  const url = new URL(request.url);

  // ---------------------
  // /api/splynx/profile?id=...
  // ---------------------
  if (url.pathname === "/api/splynx/profile" && request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    try {
      const profile = await fetchProfileForDisplay(env, id);
      if (!profile) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      // --- Debug logging ---
      console.log(`[API] Profile id=${id} keys=${Object.keys(profile).length}`);
      if (profile.normalised) {
        console.log(`[API] Normalised block present for id=${id}`);
      } else {
        console.log(`[API] Missing normalised block for id=${id}`);
      }

      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[API] Failed profile fetch for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // /api/splynx/msisdn?id=...
  // ---------------------
  if (url.pathname === "/api/splynx/msisdn" && request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    try {
      const data = await fetchCustomerMsisdn(env, id);
      if (!data) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      console.log(`[API] MSISDN fetch success for id=${id}`);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[API] Failed MSISDN fetch for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // /api/splynx/update?id=...
  // ---------------------
  if (url.pathname === "/api/splynx/update" && request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    try {
      const body = await request.json();
      const result = await splynxPUT(env, `/admin/customers/customer/${id}`, body);

      console.log(`[API] Updated customer id=${id}`);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error(`[API] Failed update for id=${id}: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // ---------------------
  // Fallback
  // ---------------------
  return new Response("Not found", { status: 404 });
}
