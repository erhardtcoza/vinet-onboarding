// src/routes/api-splynx.js
import {
  splynxGET,
  splynxPUT,
  splynxPOST,
  fetchProfileForDisplay,
  fetchCustomerMsisdn
} from "../splynx.js";

export async function handleSplynxApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Fetch profile (customer/lead) ---
  if (path === "/api/splynx/fetch-profile") {
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type") || "customer";
    if (!id) return new Response("Missing id", { status: 400 });

    try {
      const profile = await fetchProfileForDisplay(env, id, type);
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Fetch profile error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  // --- PUT generic ---
  if (path === "/api/splynx/put" && request.method === "POST") {
    try {
      const { endpoint, data } = await request.json();
      if (!endpoint || !data)
        return new Response("Missing endpoint/data", { status: 400 });

      const res = await splynxPUT(env, endpoint, data);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `PUT error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  // --- GET generic ---
  if (path === "/api/splynx/get") {
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) return new Response("Missing endpoint", { status: 400 });

    try {
      const res = await splynxGET(env, endpoint);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `GET error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  // --- POST generic ---
  if (path === "/api/splynx/post" && request.method === "POST") {
    try {
      const { endpoint, data } = await request.json();
      if (!endpoint || !data)
        return new Response("Missing endpoint/data", { status: 400 });

      const res = await splynxPOST(env, endpoint, data);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `POST error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  // --- Fetch MSISDN ---
  if (path === "/api/splynx/fetch-msisdn") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });

    try {
      const msisdn = await fetchCustomerMsisdn(env, id);
      return new Response(JSON.stringify(msisdn), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `MSISDN error: ${err.message}` }),
        { status: 500 }
      );
    }
  }

  return new Response("Not found", { status: 404 });
}
