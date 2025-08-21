// src/routes/api-splynx.js
import {
  splynxGET,
  splynxPUT,
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  mapEditsToSplynxPayload,
  splynxCreateAndUpload
} from "../splynx.js";

export default async function handleApiSplynx(request, env) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  try {
    // GET profile (lead or customer)
    if (pathname === "/api/splynx/profile" && request.method === "GET") {
      const id = searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
      const profile = await fetchProfileForDisplay(env, id);
      return new Response(JSON.stringify(profile), { status: 200 });
    }

    // GET msisdn + passport
    if (pathname === "/api/splynx/msisdn" && request.method === "GET") {
      const id = searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
      const result = await fetchCustomerMsisdn(env, id);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // PUT update profile (admin edits)
    if (pathname === "/api/splynx/update" && request.method === "PUT") {
      const id = searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });

      const edits = await request.json();
      const payload = mapEditsToSplynxPayload(edits);

      // Try both customer and lead
      let result;
      try {
        result = await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
      } catch {
        result = await splynxPUT(env, `/admin/crm/leads/${id}`, payload);
      }

      return new Response(JSON.stringify(result), { status: 200 });
    }

    // POST upload file (ID, POA, MSA, DO)
    if (pathname === "/api/splynx/upload" && request.method === "POST") {
      const id = searchParams.get("id");
      const type = searchParams.get("type"); // "lead" or "customer"
      if (!id || !type) {
        return new Response(JSON.stringify({ error: "Missing id or type" }), { status: 400 });
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!file) return new Response(JSON.stringify({ error: "Missing file" }), { status: 400 });

      const result = await splynxCreateAndUpload(env, type, id, file);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
