// src/routes/admin.js
import { ipAllowed } from "../branding.js";
import { renderAdminReviewHTML } from "../ui/admin.js";
import { getClientMeta } from "../helpers.js";
import { deleteOnboardAll } from "../storage.js";
import {
  splynxGET,
  splynxPUT,
  splynxPOST,
  splynxCreateAndUpload,
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  mapEditsToSplynxPayload
} from "../splynx.js";

export async function handleAdminRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Access Control ---
  if (!ipAllowed(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  // --- Admin Dashboard UI ---
  if (path === "/admin") {
    return new Response(await renderAdminReviewHTML(env), {
      headers: { "Content-Type": "text/html" }
    });
  }

  // --- Delete all onboarding sessions ---
  if (path === "/admin/delete-all" && request.method === "POST") {
    await deleteOnboardAll(env);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // --- Fetch profile for review ---
  if (path.startsWith("/admin/fetch-profile")) {
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type") || "customer";
    if (!id) return new Response("Missing ID", { status: 400 });

    try {
      const profile = await fetchProfileForDisplay(env, id, type);
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(`Error fetching profile: ${err.message}`, { status: 500 });
    }
  }

  // --- Push edits to Splynx ---
  if (path === "/admin/push-edits" && request.method === "POST") {
    try {
      const body = await request.json();
      const { id, type, edits } = body;
      if (!id || !type) return new Response("Missing id/type", { status: 400 });

      const payload = mapEditsToSplynxPayload(edits);
      const endpoint =
        type === "customer"
          ? `/admin/customers/customer/${id}`
          : `/admin/crm/leads/${id}`;

      const res = await splynxPUT(env, endpoint, payload);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(`Error pushing edits: ${err.message}`, { status: 500 });
    }
  }

  // --- Upload documents ---
  if (path === "/admin/upload-doc" && request.method === "POST") {
    try {
      const formData = await request.formData();
      const type = formData.get("type");
      const id = formData.get("id");
      const file = formData.get("file");
      if (!id || !type || !file)
        return new Response("Missing type/id/file", { status: 400 });

      const res = await splynxCreateAndUpload(env, type, id, file);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(`Error uploading doc: ${err.message}`, { status: 500 });
    }
  }

  // --- Fetch customer MSISDN ---
  if (path.startsWith("/admin/fetch-msisdn")) {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });

    try {
      const msisdn = await fetchCustomerMsisdn(env, id);
      return new Response(JSON.stringify(msisdn), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(`Error fetching msisdn: ${err.message}`, { status: 500 });
    }
  }

  return new Response("Not found", { status: 404 });
}
