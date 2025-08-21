// src/routes/api-splynx.js
import { splynxGET, splynxPUT, splynxPOST } from "../splynx.js";

/**
 * GET /api/splynx/customer/:id
 */
export async function handleGetCustomer(request, env) {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return Response.json({ error: "Missing customer ID" }, { status: 400 });
  }

  try {
    const data = await splynxGET(env, `/admin/customers/customer/${id}`);
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET /api/splynx/lead/:id
 */
export async function handleGetLead(request, env) {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return Response.json({ error: "Missing lead ID" }, { status: 400 });
  }

  try {
    const data = await splynxGET(env, `/admin/crm/leads/${id}`);
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/splynx/update
 * Body: { type: "customer"|"lead", id: string|number, updates: object }
 */
export async function handleUpdateProfile(request, env) {
  try {
    const body = await request.json();
    const { type, id, updates } = body;

    if (!id || !type) {
      return Response.json({ error: "Missing type or id" }, { status: 400 });
    }

    const endpoint =
      type === "customer"
        ? `/admin/customers/customer/${id}`
        : `/admin/crm/leads/${id}`;

    const result = await splynxPUT(env, endpoint, updates);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
