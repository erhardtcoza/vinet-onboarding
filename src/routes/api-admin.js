// src/routes/api-admin.js
import { fetchProfileForDisplay, mapEditsToSplynxPayload, splynxPUT } from "../splynx.js";
import { deleteOnboardAll } from "../storage.js";

/**
 * Handles admin API routes
 */
export async function handleApiAdmin(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  // --- List sessions by status ---
  if (path === "/api/admin/list") {
    const status = url.searchParams.get("status") || "inprogress";
    const { results } = await env.DB.prepare(
      "SELECT * FROM onboard WHERE status = ? ORDER BY created_at DESC"
    )
      .bind(status)
      .all();
    return Response.json(results);
  }

  // --- Fetch a single profile ---
  if (path === "/api/admin/profile") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });

    const profile = await fetchProfileForDisplay(env, id);
    return Response.json(profile || {});
  }

  // --- Update profile fields ---
  if (path === "/api/admin/update" && req.method === "POST") {
    const body = await req.json();
    const id = body.id;
    if (!id) return new Response("Missing id", { status: 400 });

    // Update DB fields
    const editableFields = [
      "full_name",
      "email",
      "billing_email",
      "phone",
      "passport",
      "address",
      "city",
      "zip",
      "payment_method",
      "bank_name",
      "bank_account",
      "bank_branch",
      "signed_ip",
      "signed_device",
      "signed_date",
    ];

    const updates = {};
    for (const f of editableFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(", ");
      const values = Object.values(updates);
      values.push(id);

      await env.DB.prepare(
        `UPDATE onboard SET ${sets} WHERE id = ?`
      ).bind(...values).run();
    }

    // Sync to Splynx (best effort)
    try {
      const payload = mapEditsToSplynxPayload(body);
      if (Object.keys(payload).length > 0) {
        await splynxPUT(env, `/admin/customers/customer/${id}`, payload);
      }
    } catch (err) {
      console.error("Splynx sync failed", err);
    }

    return new Response("OK");
  }

  // --- Approve / Reject status updates ---
  if (path === "/api/admin/status" && req.method === "POST") {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) return new Response("Missing id or status", { status: 400 });

    // Only allow approved/rejected
    if (!["approved", "rejected"].includes(status)) {
      return new Response("Invalid status", { status: 400 });
    }

    await env.DB.prepare(
      "UPDATE onboard SET status = ? WHERE id = ?"
    ).bind(status, id).run();

    return Response.json({ id, status });
  }

  // --- Delete session completely ---
  if (path === "/api/admin/delete" && req.method === "POST") {
    const body = await req.json();
    const id = body.id;
    if (!id) return new Response("Missing id", { status: 400 });

    await deleteOnboardAll(env, id);
    await env.DB.prepare("DELETE FROM onboard WHERE id = ?").bind(id).run();

    return new Response("Deleted");
  }

  return new Response("Not found", { status: 404 });
}
