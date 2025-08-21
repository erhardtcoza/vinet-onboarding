// src/routes/admin.js
import { ipAllowed } from "../branding.js";
import { renderAdminReviewHTML } from "../ui/admin.js";
import { getClientMeta } from "../helpers.js";
import { deleteOnboardAll } from "../storage.js";
import {
  splynxGET,
  splynxPOST,
  splynxPUT,
  fetchProfileForDisplay,
  fetchCustomerMsisdn,
  mapEditsToSplynxPayload,
  splynxCreateAndUpload
} from "../splynx.js";

// ---------------- Routes ----------------
export async function onAdminRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Access control
  if (!(await ipAllowed(request, env))) {
    return new Response("Forbidden", { status: 403 });
  }

  // Admin dashboard main page
  if (path === "/admin") {
    return renderAdminReviewHTML(env);
  }

  // Fetch customer/lead profile for review
  if (path.startsWith("/admin/api/profile/")) {
    const id = path.split("/").pop();
    try {
      const data = await fetchProfileForDisplay(env, id);
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Apply edits to a customer/lead profile
  if (path.startsWith("/admin/api/edit/") && request.method === "POST") {
    const id = path.split("/").pop();
    const edits = await request.json();
    const payload = mapEditsToSplynxPayload(edits);

    try {
      // Decide whether to push to customer or lead
      let result;
      if (edits.type === "customer") {
        result = await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
      } else {
        result = await splynxPUT(env, `/admin/crm/leads/${id}`, payload);
      }
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Upload document (ID, POA, etc.)
  if (path.startsWith("/admin/api/upload/") && request.method === "POST") {
    const parts = path.split("/");
    const type = parts[parts.length - 2]; // "customer" or "lead"
    const id = parts[parts.length - 1];

    const formData = await request.formData();
    const file = formData.get("file");

    try {
      const result = await splynxCreateAndUpload(env, type, id, file);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Delete onboarding session
  if (path.startsWith("/admin/api/delete/")) {
    const id = path.split("/").pop();
    await deleteOnboardAll(env, id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Fallback
  return new Response("Not found", { status: 404 });
}
