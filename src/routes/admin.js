// src/routes/admin.js
import {
  splynxGET,
  splynxPUT,
  splynxCreateAndUpload,
  mapEditsToSplynxPayload,
  fetchProfileForDisplay
} from "../splynx.js";
import { getClientMeta } from "../helpers.js";
import { deleteOnboardAll } from "../storage.js";
import { renderAdminReviewHTML } from "../ui/admin.js";

export default async function handleAdminRoutes(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ----- Admin Review Dashboard -----
  if (path === "/admin/review" && method === "GET") {
    const html = await renderAdminReviewHTML(env);
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  // ----- Fetch Splynx Profile -----
  if (path === "/api/splynx/profile" && method === "GET") {
    const id = url.searchParams.get("id");
    const type = url.searchParams.get("type") || "customer"; // default
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const profile = await fetchProfileForDisplay(env, id);
      return new Response(JSON.stringify(profile), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ----- Apply Admin Edits (Customers + Leads) -----
  if (path === "/api/splynx/edit" && method === "POST") {
    const body = await req.json();
    const { id, type = "customer", edits } = body;

    if (!id || !edits) {
      return new Response(JSON.stringify({ error: "Missing id or edits" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const payload = mapEditsToSplynxPayload(edits);

      let endpoint;
      if (type === "customer") {
        endpoint = `/admin/customers/customer/${id}`;
      } else if (type === "lead") {
        endpoint = `/admin/crm/leads/${id}`;
      } else {
        return new Response(JSON.stringify({ error: "Invalid type" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await splynxPUT(env, endpoint, payload);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ----- Upload Document -----
  if (path === "/api/splynx/upload" && method === "POST") {
    const form = await req.formData();
    const id = form.get("id");
    const type = form.get("type"); // "lead" or "customer"
    const file = form.get("file");

    if (!id || !type || !file) {
      return new Response(JSON.stringify({ error: "Missing id, type, or file" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const result = await splynxCreateAndUpload(env, type, id, file);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ----- Delete Onboarding Session -----
  if (path === "/api/admin/delete" && method === "POST") {
    const body = await req.json();
    const { key } = body;
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      await deleteOnboardAll(env, key);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ----- Fallback -----
  return new Response("Not found", { status: 404 });
}
